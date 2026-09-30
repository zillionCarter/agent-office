import { h, openModal } from './dom';

// E at a screen on one of your models (see world/screens.ts): the page on it, big enough to use. The
// address bar changes the page on the screen for everyone on the floor. Some sites won't show inside
// another page at all (they say so to the browser); for those there's Open in a tab.

export interface BrowserOptions {
  title: string;
  url?: string;
  /** A new address was typed: the screen shows it from now on. */
  onNavigate(url: string): void;
}

/** Turns what was typed into a link: a site's name gets https://, anything else is a search. */
export function toUrl(typed: string): string | undefined {
  const t = typed.trim();
  if (!t) return undefined;
  if (/^https?:\/\//i.test(t)) return t;
  if (/^[\w-]+(\.[\w-]+)+(:\d+)?(\/\S*)?$/.test(t) || /^localhost(:\d+)?(\/\S*)?$/.test(t)) return `${t.startsWith('localhost') ? 'http' : 'https'}://${t}`;
  return `https://duckduckgo.com/?q=${encodeURIComponent(t)}`;
}

export function openBrowser(opts: BrowserOptions) {
  const input = h('input', { type: 'text', value: opts.url ?? '', placeholder: 'Type an address or search…', 'aria-label': 'Address', spellcheck: 'false', autocomplete: 'off' }) as HTMLInputElement;
  const go = h('button.btn.primary', { type: 'button' }, 'Go');
  const reload = h('button.btn', { type: 'button', title: 'Reload' }, '↻');
  const tab = h('a.btn', { href: opts.url ?? '#', target: '_blank', rel: 'noopener noreferrer', title: 'Open it in a browser tab (for a site that won’t show here)' }, '↗ Open in a tab');
  const frame = h('iframe.browser-frame', { sandbox: 'allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads', referrerpolicy: 'no-referrer', allow: 'fullscreen; clipboard-read; clipboard-write' }) as HTMLIFrameElement;
  const empty = h('p.empty.browser-empty', {}, 'No page on this screen yet: type an address above.');
  const close = h('button.btn.close', { type: 'button', 'aria-label': 'Close' }, '✕');
  const load = (url: string | undefined) => {
    frame.classList.toggle('hidden', !url);
    empty.classList.toggle('hidden', !!url);
    if (url) frame.src = url;
    (tab as HTMLAnchorElement).href = url ?? '#';
  };
  const submit = () => {
    const url = toUrl(input.value);
    if (!url) return input.focus();
    input.value = url;
    load(url);
    opts.onNavigate(url);
  };
  go.addEventListener('click', submit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.isComposing) {
      e.preventDefault();
      submit();
    }
  });
  reload.addEventListener('click', () => {
    if (frame.src) frame.src = frame.src;
  });
  const el = h(
    'div.modal.browser',
    { role: 'dialog', 'aria-label': opts.title },
    h('header', {}, h('h2', {}, `🖥️ ${opts.title}`), close),
    h('div.browser-bar', {}, reload, input, go, tab),
    h('div.browser-view', {}, frame, empty),
    h('footer', {}, h('span.grow', {}, 'Everyone on the floor sees this page on the screen. A blank page means the site doesn’t allow being shown inside another: use Open in a tab.')),
  );
  const modal = openModal(el, { doing: `🖥️ using ${opts.title}` });
  close.addEventListener('click', () => modal.close());
  load(opts.url);
  if (!opts.url) setTimeout(() => input.focus(), 30);
}
