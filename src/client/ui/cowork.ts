import type { CoworkChatInfo, ServerMsg, WorkerInfo } from '../../shared/protocol';
import { floorPalette } from '../../shared/floors';
import type { Net } from '../net';
import { store } from '../state';
import { h, openModal, timeAgo } from './dom';

// Bringing a Cowork chat into the office (it carries on as a Claude Code worker at a desk), and
// sending a worker to another floor, conversation and all. The office does both by copying the
// session's transcript to where Claude Code looks for it on the new floor (server/sessions.ts).

const listWaiters = new Set<(msg: Extract<ServerMsg, { t: 'cowork.list' }>) => void>();

export function routeCoworkMessage(msg: ServerMsg) {
  if (msg.t === 'cowork.list') for (const fn of listWaiters) fn(msg);
}

/** Pick a Cowork chat to seat at `deskId` (or the first free seat) on the floor you're on. */
export function openCoworkPicker(net: Net, deskId?: string) {
  const list = h('div.repo-list', { role: 'listbox', 'aria-label': 'Cowork chats' }, h('p.empty', { style: 'padding:10px' }, 'Looking for your Cowork chats…'));
  const status = h('div');
  const close = h('button.btn.close', { type: 'button', 'aria-label': 'Close' }, '✕');
  const el = h(
    'div.modal.elevator',
    { role: 'dialog', 'aria-label': 'Bring in a Cowork chat' },
    h('header', {}, h('h2', {}, '📥 Bring in a Cowork chat'), close),
    h(
      'div.body',
      {},
      h('p.intro', {}, 'Pick a chat from Claude’s Cowork mode on this computer. A worker sits down with the whole conversation and carries on from where it left off, as Claude Code. The chat stays in Cowork too.'),
      list,
      status,
    ),
  );
  const onList = (msg: Extract<ServerMsg, { t: 'cowork.list' }>) => {
    const chats = msg.chats.filter((c) => !c.archived);
    list.replaceChildren(
      ...(chats.length ? chats.map(row) : [h('p.empty', { style: 'padding:10px' }, msg.error ? '' : 'No Cowork chats on this computer yet.')]),
    );
    status.replaceChildren(...(msg.error ? [h('p.err', {}, msg.error)] : []));
  };
  const row = (c: CoworkChatInfo) => {
    const r = h(
      'div.repo',
      { role: 'option', title: c.floor ? `Already a worker on ${c.floor}` : `Bring “${c.title}” in` },
      h('span.nm', {}, c.title),
      h('span.desc', {}, ''),
      c.floor ? h('span.pill', {}, `on ${c.floor}`) : c.lastActivityAt ? h('span.when', {}, timeAgo(c.lastActivityAt)) : null,
    );
    if (!c.floor)
      r.addEventListener('click', () => {
        net.send({ t: 'cowork.import', chat: c.id, deskId });
        modal.close();
      });
    return r;
  };
  listWaiters.add(onList);
  const modal = openModal(el, { doing: '📥 bringing in a Cowork chat', onClose: () => listWaiters.delete(onList) });
  close.addEventListener('click', () => modal.close());
  net.send({ t: 'cowork.list' });
}

/** Why `w` can't move floors, if it can't (the office checks again). */
export function cantMove(w: WorkerInfo): string | undefined {
  if (w.kind !== 'agent' || (w.provider ?? store.project?.defaultProvider) !== 'claude') return 'Only Claude Code workers can move floors';
  if (w.meeting) return `${w.name} is in a meeting`;
  if (w.worktree) return `${w.name} works in its own worktree of this floor`;
  if (!w.sessionId) return `${w.name} hasn't started a conversation yet`;
  return undefined;
}

/**
 * Where to send `w`: the reception desk on this floor (when `reception`, it's free), or another floor.
 * `noFloors` says why it can't change floors, if it can't.
 */
export function openMoveFloor(net: Net, w: WorkerInfo, reception = false, noFloors?: string) {
  const others = noFloors ? [] : store.floors.filter((f) => f.id !== store.floor && !f.cloning);
  const close = h('button.btn.close', { type: 'button', 'aria-label': 'Close' }, '✕');
  const buttons = others.map((f) => {
    const p = floorPalette(f.palette);
    const b = h(
      'button.floor-btn',
      { type: 'button', title: `Send ${w.name} to ${f.name}` },
      h('span.floor-no', { style: `background:${p.trim}` }, String(store.floors.indexOf(f) + 1)),
      h('span.floor-text', {}, h('span.floor-name', {}, f.name), h('span.floor-sub', {}, f.repo ?? f.dir)),
      h('span.floor-stats', {}, h('span', { title: 'Workers at desks' }, `💻 ${f.workers}`)),
    );
    b.addEventListener('click', () => {
      net.send({ t: 'worker.move', workerId: w.id, floor: f.id });
      modal.close();
    });
    return b;
  });
  const desk = reception
    ? h(
        'button.floor-btn',
        { type: 'button', title: `Seat ${w.name} at reception` },
        h('span.floor-no', { style: 'background:#2b2d42' }, '🛎️'),
        h('span.floor-text', {}, h('span.floor-name', {}, 'Reception, on this floor'), h('span.floor-sub', {}, `${w.name} moves to the front desk by the elevator and keeps working`)),
        h('span.floor-stats'),
      )
    : null;
  desk?.addEventListener('click', () => {
    net.send({ t: 'worker.seat', workerId: w.id, deskId: 'reception' });
    modal.close();
  });
  const el = h(
    'div.modal.elevator',
    { role: 'dialog', 'aria-label': `Move ${w.name}` },
    h('header', {}, h('h2', {}, `🛗 Move ${w.name}`), close),
    h(
      'div.body',
      {},
      desk ? h('div.floors', { style: 'margin-bottom:14px' }, desk) : null,
      h('p.intro', {}, noFloors ? `To another floor: ${noFloors}.` : `To another floor: ${w.name} packs up here and sits down there with its whole conversation, working in that floor’s folder from then on. If it’s in the middle of something, that stops; ask it to carry on once it’s there.`),
      h('div.floors', {}, ...(buttons.length ? buttons : noFloors ? [] : [h('p.empty', {}, 'There’s no other floor yet — add one in the elevator.')])),
    ),
  );
  const modal = openModal(el, { doing: '🛗 moving a worker' });
  close.addEventListener('click', () => modal.close());
}
