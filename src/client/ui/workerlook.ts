import { GLASSES, HATS, HAT_COLORS } from '../../shared/avatar';
import type { WorkerInfo, WorkerOutfit } from '../../shared/protocol';
import type { Net } from '../net';
import { h, openModal } from './dom';

// U at a worker's desk: rename it, repaint it, give it a hat and glasses, and standing instructions
// of its own (added to its brief every time it starts, and told to it now if you like).

const COLORS = ['#ff8a5b', '#4f86f7', '#06d6a0', '#ef476f', '#ffd166', '#9d4edd', '#00b4d8', '#f77f00', '#8d99ae', '#2b2d42'];

export function openWorkerLook(net: Net, w: WorkerInfo) {
  let color = w.color;
  const outfit: WorkerOutfit = { hat: w.outfit?.hat ?? 0, hatColor: w.outfit?.hatColor ?? 0, glasses: w.outfit?.glasses ?? 0 };
  const shell = w.kind === 'shell';
  const name = h('input', { type: 'text', maxlength: 24, value: w.name.replace(/ 🐚$/, ''), 'aria-label': 'Name', autocomplete: 'off' }) as HTMLInputElement;
  const colors = h('div.swatches', { role: 'radiogroup', 'aria-label': 'Color' });
  const picker = h('input.swatch.custom', { type: 'color', value: w.color, 'aria-label': 'Any color', title: 'Pick any color' }) as HTMLInputElement;
  picker.addEventListener('input', () => ((color = picker.value), paint()));
  const hats = h('div.seg', { role: 'radiogroup', 'aria-label': 'Hat' });
  const hatColors = h('div.swatches', { role: 'radiogroup', 'aria-label': 'Hat color' });
  const glasses = h('div.seg', { role: 'radiogroup', 'aria-label': 'Glasses' });
  const notes = h('textarea', { rows: 4, maxlength: 4000, placeholder: 'e.g. Write in British English. Always check with me before booking anything.', 'aria-label': 'Standing instructions' }) as HTMLTextAreaElement;
  notes.value = w.instructions ?? '';
  const tell = h('input', { type: 'checkbox', id: 'look-tell', checked: true }) as HTMLInputElement;

  const swatch = (c: string, on: boolean, choose: () => void, label: string) =>
    h('button.swatch', { type: 'button', role: 'radio', 'aria-checked': String(on), style: `background:${c}`, class: on ? 'sel' : '', 'aria-label': label, title: label, onclick: choose });
  const seg = (row: HTMLElement, names: string[], on: number, choose: (i: number) => void) =>
    row.replaceChildren(...names.map((n, i) => h('button.btn', { type: 'button', role: 'radio', 'aria-checked': String(i === on), class: i === on ? 'on' : '', onclick: () => (choose(i), paint()) }, n)));
  const paint = () => {
    colors.replaceChildren(...COLORS.map((c) => swatch(c, c === color, () => ((color = c), paint()), `Color ${c}`)), picker);
    picker.classList.toggle('sel', !COLORS.includes(color));
    seg(hats, HATS, outfit.hat, (i) => (outfit.hat = i));
    hatColors.replaceChildren(...HAT_COLORS.map((c, i) => swatch(c, i === outfit.hatColor, () => ((outfit.hatColor = i), paint()), `Hat color ${i + 1}`)));
    hatColors.classList.toggle('hidden', HATS[outfit.hat] === 'None');
    seg(glasses, GLASSES, outfit.glasses, (i) => (outfit.glasses = i));
  };
  paint();

  const save = h('button.btn.primary', { type: 'submit' }, 'Save');
  const cancel = h('button.btn', { type: 'button' }, 'Cancel');
  const form = h(
    'form.modal.charsel.worker-look',
    { role: 'dialog', 'aria-label': `Customize ${w.name}` },
    h('header', {}, h('h2', {}, `🎨 ${w.name}`)),
    h(
      'div.body',
      { style: 'display:block' },
      h(
        'div.charsel-opts',
        {},
        h('label', {}, 'Name'),
        name,
        h('label', {}, 'Color'),
        colors,
        h('label', {}, 'Hat'),
        hats,
        hatColors,
        h('label', {}, 'Glasses'),
        glasses,
        shell ? null : h('label', {}, 'Standing instructions'),
        shell ? null : notes,
        shell ? null : h('p.setting-note', { style: 'margin:6px 0 0' }, 'Part of their brief every time they start (after a resume, or moving floors).'),
        shell ? null : h('label.check-row', { for: 'look-tell', style: 'display:flex;gap:8px;align-items:center;margin-top:6px;font-weight:700;cursor:pointer' }, tell, 'Tell them now too'),
      ),
    ),
    h('footer', {}, h('span.grow'), cancel, save),
  ) as HTMLFormElement;
  const modal = openModal(form, { doing: `🎨 dressing ${w.name}` });
  cancel.addEventListener('click', () => modal.close());
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const newName = name.value.trim();
    if (!newName) return name.focus();
    net.send({
      t: 'worker.customize',
      workerId: w.id,
      name: newName !== w.name.replace(/ 🐚$/, '') ? newName : undefined,
      color,
      outfit,
      instructions: shell ? undefined : notes.value,
      tell: tell.checked,
    });
    modal.close();
  });
  setTimeout(() => name.focus(), 30);
}
