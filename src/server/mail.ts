import { randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { MailInfo } from '../shared/protocol.js';

// Email for the front desk. Something outside the office (a relay behind a tunnel, taking Resend's
// inbound webhook) hands each email over on the loopback hook port with the office's mail token. The
// office keeps it, and types it into the terminal of whoever is at reception on the mail floor — or,
// when it's a reply in a thread someone was put through to, straight to that worker. They answer with
// `office-queue mail reply`, which the office sends through Resend, back to the sender only; or put
// the sender through to a coworker with `office-queue mail transfer`.
//
// mail.json in the office's .agent-office folder sets it up:
//   { "floor": "home-base", "domain": "mail.example.com", "desk": "admino", "allow": ["me@example.com"], "resendKey": "re_…" }
// The front desk is <desk>@<domain>, and every worker has an address of its own, its name at the same
// domain (Byte is byte@…): email to it goes straight to that worker, and its replies come from it.
// Mail from anyone not on `allow` is dropped. The token the relay needs is in mail-token beside it.

export interface MailConfig {
  /** The floor whose reception gets the mail. */
  floor: string;
  /** The domain every address is at: one Resend receives and sends for. */
  domain: string;
  /** The front desk's address (before the @), and the name its replies come from. */
  desk: string;
  /** Who may write in; everyone else is dropped. Lower-cased. */
  allow: string[];
  resendKey: string;
}

/** An email as the office keeps it. */
export interface Mail extends MailInfo {
  /** The email's own Message-ID, for threading the replies. */
  messageId?: string;
}

const KEEP = 300;
/** A follow-up with the same subject from the same sender goes to whoever had the thread, this long after. */
const THREAD_MS = 14 * 24 * 3600_000;

export function loadMailConfig(dataDir: string): MailConfig | undefined {
  try {
    const raw = JSON.parse(readFileSync(path.join(dataDir, 'mail.json'), 'utf8')) as Partial<MailConfig> & { from?: string };
    // An older mail.json named one address to send from: its domain, and its name as the desk.
    const old = typeof raw.from === 'string' ? /([^<\s@]+)@([^>\s]+)/.exec(raw.from) : null;
    const domain = typeof raw.domain === 'string' && raw.domain ? raw.domain : old?.[2];
    const desk = mailbox(typeof raw.desk === 'string' && raw.desk ? raw.desk : (old?.[1] ?? 'desk'));
    if (typeof raw.floor !== 'string' || !domain || !desk || typeof raw.resendKey !== 'string' || !Array.isArray(raw.allow)) return undefined;
    return { floor: raw.floor, domain: domain.toLowerCase(), desk, resendKey: raw.resendKey, allow: raw.allow.filter((a): a is string => typeof a === 'string').map((a) => a.trim().toLowerCase()) };
  } catch {
    return undefined;
  }
}

/** The token a relay presents to hand mail over, made the first time it's asked for. */
export function mailToken(dataDir: string): string {
  const file = path.join(dataDir, 'mail-token');
  try {
    const t = readFileSync(file, 'utf8').trim();
    if (t.length >= 32) return t;
  } catch {
    // not made yet
  }
  const t = randomBytes(24).toString('hex');
  writeFileSync(file, t + '\n', { mode: 0o600 });
  return t;
}

export function sameToken(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** A name as the part of an address before the @: Penny Lane is penny.lane. */
export function mailbox(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.+|\.+$/g, '')
    .slice(0, 48);
}

/** Who a reply is from: the front desk's name and address for whoever's at reception, else the worker's own. */
export function senderFor(cfg: MailConfig, name: string, atDesk: boolean): string {
  const display = atDesk ? cfg.desk.charAt(0).toUpperCase() + cfg.desk.slice(1) : name.replace(/[<>"]/g, '');
  return `${display} <${atDesk ? cfg.desk : mailbox(name) || cfg.desk}@${cfg.domain}>`;
}

/** The addresses among `to` at the office's domain, as their names before the @. */
export function officeRecipients(cfg: MailConfig, to: string[]): string[] {
  const out: string[] = [];
  for (const t of to) {
    const m = /([^<\s@"]+)@([^>\s"]+)/.exec(t);
    if (m && m[2].toLowerCase() === cfg.domain) out.push(m[1].toLowerCase());
  }
  return out;
}

/** The subject without its Re:/Fwd: prefixes, for telling which thread an email is in. */
export function threadKey(from: string, subject: string): string {
  return `${from.toLowerCase()}|${subject.replace(/^\s*((re|fwd?|aw)\s*:\s*)+/i, '').trim().toLowerCase()}`;
}

/** The mail a floor has had, newest last, in its .agent-office/mail.json. */
export class Mailbox {
  private mails: Mail[] = [];
  private file: string;

  constructor(dataDir: string) {
    this.file = path.join(dataDir, 'mail.json');
    try {
      if (existsSync(this.file)) {
        const saved = JSON.parse(readFileSync(this.file, 'utf8')) as Mail[];
        if (Array.isArray(saved)) this.mails = saved.filter((m) => m && typeof m.id === 'string');
      }
    } catch {
      // unreadable: start over
    }
  }

  list(): Mail[] {
    return this.mails;
  }

  get(id: string): Mail | undefined {
    return this.mails.find((m) => m.id === id);
  }

  /** Files a new email, and says who had its thread last, if anyone did lately. */
  add(m: { from: string; subject: string; text: string; messageId?: string }): { mail: Mail; thread?: string } {
    const key = threadKey(m.from, m.subject);
    const earlier = [...this.mails].reverse().find((x) => x.assignee && Date.now() - x.at < THREAD_MS && threadKey(x.from, x.subject) === key);
    const mail: Mail = {
      id: randomBytes(3).toString('hex'),
      from: m.from,
      subject: m.subject.slice(0, 300) || '(no subject)',
      text: m.text.slice(0, 20000),
      at: Date.now(),
      messageId: m.messageId,
      replies: [],
    };
    this.mails.push(mail);
    if (this.mails.length > KEEP) this.mails.splice(0, this.mails.length - KEEP);
    this.save();
    return { mail, thread: earlier?.assignee };
  }

  assign(mail: Mail, workerId: string, name: string) {
    mail.assignee = workerId;
    mail.assigneeName = name;
    this.save();
  }

  noteReply(mail: Mail, reply: MailInfo['replies'][number]) {
    mail.replies.push(reply);
    this.save();
  }

  save() {
    try {
      writeFileSync(this.file, JSON.stringify(this.mails, null, 2), { mode: 0o600 });
    } catch (err) {
      console.error(`agent-office: couldn't save the mail: ${(err as Error).message}`);
    }
  }
}

/** Sends `text` back to whoever sent `mail`, in its thread, from `from` (see senderFor). Resolves to an error, if any. */
export async function sendReply(cfg: MailConfig, mail: Mail, text: string, from: string, fetchImpl: typeof fetch = fetch): Promise<string | undefined> {
  const subject = /^\s*re\s*:/i.test(mail.subject) ? mail.subject : `Re: ${mail.subject}`;
  const headers: Record<string, string> = {};
  if (mail.messageId) {
    headers['In-Reply-To'] = mail.messageId;
    headers.References = mail.messageId;
  }
  try {
    const res = await fetchImpl('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${cfg.resendKey}`, 'content-type': 'application/json', 'user-agent': 'agent-office' },
      body: JSON.stringify({ from, to: [mail.from], subject, text, ...(Object.keys(headers).length ? { headers } : {}) }),
      signal: AbortSignal.timeout(20_000),
    });
    if (res.ok) return undefined;
    const body = await res.text().catch(() => '');
    return `Resend said ${res.status}${body ? `: ${body.slice(0, 300)}` : ''}`;
  } catch (err) {
    return `Couldn't reach Resend: ${(err as Error).message}`;
  }
}

/** What whoever gets an email is told: the email, and how to answer it or pass it on. */
export function mailPrompt(mail: Mail, tool: string, transfer?: { by: string; note?: string }, sender?: string): string {
  const lines = [
    transfer ? `📧 ${transfer.by} put an email through to you (#${mail.id}).${transfer.note ? ` Their note: ${transfer.note}` : ''}` : `📧 New email #${mail.id}`,
    `From: ${mail.from}`,
    `Subject: ${mail.subject}`,
    '',
    mail.text.trim() || '(no text)',
    '',
    '---',
    `Answer it by email (it goes back to ${mail.from} only, in the same thread${sender ? `, from ${sender}` : ''}; no need to ask first, this is what the email is for):`,
    `  ${tool} mail reply ${mail.id} <<'EOF'`,
    '  …your reply…',
    '  EOF',
    `Put them through to a coworker who's better placed, or who they asked for (see who's here with ${tool} workers):`,
    `  ${tool} mail transfer ${mail.id} <name> --note "what they need"`,
    'Do the work first if the email asks for something you can do, then reply with the result. Keep replies short and friendly, and sign off with your name.',
  ];
  return lines.join('\n');
}
