import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Mailbox, loadMailConfig, mailPrompt, mailToken, sendReply, threadKey } from '../src/server/mail.js';
import { buildRequest, formatMail, parseArgs } from '../bin/office-queue.js';

function scratch(t: { after(fn: () => void): void }) {
  const dir = mkdtempSync(path.join(tmpdir(), 'agent-office-mail-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('a follow-up in a thread goes back to whoever had it', (t) => {
  const box = new Mailbox(scratch(t));
  const { mail, thread } = box.add({ from: 'Me@Example.com', subject: 'Invoices', text: 'Make one for SMA' });
  assert.equal(thread, undefined);
  box.assign(mail, 'w-byte', 'Byte');
  assert.equal(box.add({ from: 'me@example.com', subject: 'Re: RE: invoices', text: 'thanks!' }).thread, 'w-byte');
  assert.equal(box.add({ from: 'me@example.com', subject: 'Something else', text: '' }).thread, undefined);
  assert.equal(threadKey('A@b.c', 'Fwd: Re: Hi'), 'a@b.c|hi');
});

test('the config and token are read from the office folder', (t) => {
  const dir = scratch(t);
  assert.equal(loadMailConfig(dir), undefined);
  writeFileSync(path.join(dir, 'mail.json'), JSON.stringify({ floor: 'home-base', from: 'Desk <desk@x.dev>', allow: ['Me@X.dev'], resendKey: 're_1' }));
  assert.deepEqual(loadMailConfig(dir)?.allow, ['me@x.dev']);
  const token = mailToken(dir);
  assert.ok(token.length >= 32);
  assert.equal(mailToken(dir), token, 'made once, then kept');
});

test('a reply goes to the sender only, in its thread', async (t) => {
  const box = new Mailbox(scratch(t));
  const { mail } = box.add({ from: 'me@x.dev', subject: 'Hello', text: 'hi', messageId: '<abc@x.dev>' });
  let sent: { url: string; init: RequestInit } | undefined;
  const fake = (async (url: string, init: RequestInit) => {
    sent = { url, init };
    return new Response('{"id":"1"}', { status: 200 });
  }) as unknown as typeof fetch;
  const err = await sendReply({ floor: 'f', from: 'Desk <desk@x.dev>', allow: [], resendKey: 're_1' }, mail, 'Hi back', fake);
  assert.equal(err, undefined);
  assert.equal(sent!.url, 'https://api.resend.com/emails');
  const body = JSON.parse(String(sent!.init.body));
  assert.deepEqual(body.to, ['me@x.dev']);
  assert.equal(body.subject, 'Re: Hello');
  assert.equal(body.headers['In-Reply-To'], '<abc@x.dev>');
  const refused = (async () => new Response('{"message":"domain not verified"}', { status: 403 })) as unknown as typeof fetch;
  assert.match((await sendReply({ floor: 'f', from: 'd@x.dev', allow: [], resendKey: 'k' }, mail, 'x', refused))!, /403.*domain not verified/);
});

test('whoever gets an email is told how to answer it and pass it on', (t) => {
  const box = new Mailbox(scratch(t));
  const { mail } = box.add({ from: 'me@x.dev', subject: 'Help', text: 'Put me through to Byte' });
  const p = mailPrompt(mail, '/abs/office-queue', { by: 'Sprocket', note: 'invoice question' });
  assert.match(p, /Sprocket put an email through to you/);
  assert.match(p, new RegExp(`/abs/office-queue mail reply ${mail.id}`));
  assert.match(p, /mail transfer/);
});

test('office-queue mail reply, transfer and list', () => {
  const office = { url: 'http://127.0.0.1:9', worker: 'w1', token: 't' };
  const reply = buildRequest(parseArgs(['mail', 'reply', 'ab12cd']), office, 'Thanks!\n');
  assert.equal(new URL(reply.url).pathname, '/office/mail');
  assert.deepEqual(JSON.parse(reply.body!), { action: 'reply', mail: 'ab12cd', text: 'Thanks!' });
  const transfer = buildRequest(parseArgs(['mail', 'transfer', 'ab12cd', 'Byte', '--note', 'invoices']), office);
  assert.deepEqual(JSON.parse(transfer.body!), { action: 'transfer', mail: 'ab12cd', to: 'Byte', note: 'invoices' });
  assert.equal(buildRequest(parseArgs(['mail', 'list']), office).method, 'GET');
  assert.throws(() => parseArgs(['mail', 'transfer', 'ab12cd']), /coworker/);
  assert.throws(() => buildRequest(parseArgs(['mail', 'reply', 'ab12cd']), office, '  '), /empty/);
  assert.match(formatMail({ mails: [{ id: 'ab12cd', at: 0, from: 'me@x.dev', subject: 'Hi', assigneeName: 'Byte', replies: [{ by: 'Byte' }] }] }), /ab12cd .* me@x.dev · Hi · with Byte\n\s+↳ Byte replied/);
});
