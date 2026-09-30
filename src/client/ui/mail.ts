import type { MailInfo, ServerMsg } from '../../shared/protocol';
import type { Net } from '../net';
import { store } from '../state';
import { h, openModal, timeAgo, type Modal } from './dom';

// The front desk's inbox: the email that came in for this floor, who has each one (the receptionist,
// or whoever it was put through to), and what they answered. You can put one through yourself.

let current: { modal: Modal; paint: (msg: Extract<ServerMsg, { t: 'mail.list' }>) => void } | null = null;

export function routeMailMessage(msg: ServerMsg) {
  if (msg.t === 'mail.list') current?.paint(msg);
}

export function openMail(net: Net) {
  if (current) return;
  const list = h('div.mail-list', {}, h('p.empty', {}, 'Opening the inbox…'));
  const close = h('button.btn.close', { type: 'button', 'aria-label': 'Close' }, '✕');
  const el = h('div.modal.mail', { role: 'dialog', 'aria-label': 'Front desk mail' }, h('header', {}, h('h2', {}, '📬 Front desk mail'), close), h('div.body', {}, list));

  const card = (m: MailInfo) => {
    const agents = [...store.workers.values()].filter((w) => w.kind === 'agent' && w.id !== m.assignee);
    const pick = h('select', { 'aria-label': 'Put through to' }, h('option', { value: '' }, 'Put through to…'), ...agents.map((w) => h('option', { value: w.id }, w.name))) as HTMLSelectElement;
    pick.addEventListener('change', () => {
      if (pick.value) net.send({ t: 'mail.transfer', mail: m.id, workerId: pick.value });
    });
    const body = h('pre.mail-text', {}, m.text.trim() || '(no text)');
    return h(
      'article.mail-card',
      {},
      h('div.mail-head', {}, h('strong', {}, m.subject), h('span.when', {}, timeAgo(m.at))),
      h('div.mail-meta', {}, `From ${m.from}`, m.assigneeName ? ` · with ${m.assigneeName}` : ' · nobody has it yet'),
      body,
      ...m.replies.map((r) => h('div.mail-reply', { class: r.error ? 'failed' : '' }, h('div.mail-meta', {}, `↳ ${r.by} replied ${timeAgo(r.at)}${r.error ? ` — not sent: ${r.error}` : ''}`), h('pre.mail-text', {}, r.text))),
      agents.length ? h('div.mail-actions', {}, pick) : null,
    );
  };
  const paint = (msg: Extract<ServerMsg, { t: 'mail.list' }>) => {
    const mails = [...msg.mails].reverse();
    list.replaceChildren(
      ...(mails.length
        ? mails.map(card)
        : [h('p.empty', {}, msg.configured ? 'No email yet. It shows up here, and in the receptionist’s terminal, as it comes in.' : 'Email isn’t set up for this floor.')]),
    );
  };
  const modal = openModal(el, { doing: '📬 reading the mail', onClose: () => (current = null) });
  current = { modal, paint };
  close.addEventListener('click', () => modal.close());
  net.send({ t: 'mail.list' });
}
