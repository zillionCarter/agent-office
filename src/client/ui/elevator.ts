import type { FloorInfo, FolderListing, RepoChoice, ServerMsg } from '../../shared/protocol';
import { floorPalette, normalizeRepo, sameRepo } from '../../shared/floors';
import { ROOF, ROOF_NAME } from '../../shared/rooftop';
import type { Net } from '../net';
import { store } from '../state';
import { h, openModal, timeAgo, type Modal } from './dom';
import { confirmDialog } from './prompt';

// The elevator's panel: a button for every floor (every project), and "add a project", which clones
// one of the repositories the office's gh login can see and makes it a new floor, or makes any folder
// on the office's machine a floor as it is, or sets up a personal assistant's floor. The first time
// the office runs there are no floors, and this is where you start. Admins can take a floor off the
// building here too; its checkout stays on disk.

export interface ElevatorOptions {
  net: Net;
  ride(floorId: string): void;
}

/** How many repositories the list shows at once; typing narrows it down. */
const SHOWN = 60;
/** Ask gh for the repositories again after this long. */
const REPOS_STALE_MS = 5 * 60_000;

const addedWaiters = new Set<(msg: Extract<ServerMsg, { t: 'floor.added' }>) => void>();
const browseWaiters = new Set<(listing: FolderListing) => void>();

/** Main feeds server messages through here, so a panel waiting on its clone hears back. */
export function routeElevatorMessage(msg: ServerMsg) {
  if (msg.t === 'floor.added') for (const fn of addedWaiters) fn(msg);
  if (msg.t === 'floor.browse') for (const fn of browseWaiters) fn(msg);
}

/** Where a new floor comes from: a GitHub repository, a folder that's already on this machine, or a new assistant's folder. */
type AddMode = 'repo' | 'folder' | 'assistant';
const MODE_KEY = 'agent-office.elevator-mode';

let current: Modal | null = null;

export function elevatorPanelOpen(): boolean {
  return !!current;
}

export function openElevator(opts: ElevatorOptions): void {
  if (current) return;
  // Nowhere to go yet: the panel stays until there's a floor to ride to.
  const setup = !store.floor;
  const { net } = opts;
  let filter = '';
  let selected: string | null = null;
  let adding: string | null = null;
  let error = '';
  let showAdd = setup || !store.floors.length;
  let mode: AddMode = 'repo';
  try {
    const saved = localStorage.getItem(MODE_KEY);
    if (saved === 'folder' || saved === 'assistant') mode = saved;
  } catch {
    // storage blocked
  }
  /** The search box and list are in place (rebuilding them would lose the focus mid-typing). */
  let built = false;

  const floorsEl = h('div.floors');
  const addEl = h('div.add');
  const input = h('input', { type: 'text', placeholder: 'Search your repositories, or type owner/name', 'aria-label': 'Repository', autocomplete: 'off', spellcheck: 'false' }) as HTMLInputElement;
  const listEl = h('div.repo-list', { role: 'listbox', 'aria-label': 'Repositories' });
  const statusEl = h('div');
  const addBtn = h('button.btn.primary', { type: 'button' }, '🛗 Add floor');
  const refreshBtn = h('button.btn', { type: 'button', title: 'Ask GitHub for the list again' }, '↻');
  const close = setup ? null : h('button.btn.close', { 'aria-label': 'Close' }, '✕');

  // Where clones go. Admins can move it right here: a new office's elevator can't be closed to reach
  // ⚙️ Settings until it has a floor, and the first project is when it matters.
  const dirInput = h('input', { type: 'text', placeholder: '~/Workspace', 'aria-label': 'Workspace folder', spellcheck: 'false', autocomplete: 'off' }) as HTMLInputElement;
  const dirSave = h('button.btn.primary', { type: 'button' }, 'Save');
  const dirCancel = h('button.btn', { type: 'button' }, 'Cancel');
  const dirEl = h('div.webhook.dir-pick.hidden', {}, dirInput, dirSave, dirCancel);
  const editDir = (on: boolean) => {
    dirEl.classList.toggle('hidden', !on);
    if (!on) return;
    dirInput.value = store.projectsDir.dir;
    setTimeout(() => dirInput.focus(), 0);
  };
  const saveDir = () => {
    const dir = dirInput.value.trim();
    if (!dir) return dirInput.focus();
    // The server says why it can't, if it can't; the folder moving closes this.
    if (dir === store.projectsDir.dir) editDir(false);
    else net.send({ t: 'floor.projectsDir', dir });
  };
  dirSave.addEventListener('click', saveDir);
  dirCancel.addEventListener('click', () => editDir(false));
  dirInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.isComposing) saveDir();
  });

  const needRepos = () => {
    const r = store.repos;
    if (r.loading || (r.at && Date.now() - r.at < REPOS_STALE_MS && !r.error)) return;
    store.repos = { ...r, loading: true };
    net.send({ t: 'floor.repos' });
  };

  /** What "Add floor" would add: the row picked, else what's typed if it's owner/name. */
  const choice = (): string | undefined => selected ?? normalizeRepo(filter);

  const floorButton = (f: FloorInfo, i: number) => {
    const here = f.id === store.floor;
    const p = floorPalette(f.palette);
    const stats: (HTMLElement | string)[] = [];
    if (f.cloning) stats.push('⏳ Cloning…');
    else {
      if (f.busy) stats.push(h('span', { title: 'Working' }, `👷 ${f.busy}`));
      if (f.waiting) stats.push(h('span.waiting', { title: 'Waiting on someone' }, `🙋 ${f.waiting}`));
      stats.push(h('span', { title: 'Workers at desks' }, `💻 ${f.workers}`));
      if (f.people) stats.push(h('span', { title: 'People on this floor' }, `🧑 ${f.people}`));
    }
    const btn = h(
      'button.floor-btn',
      { type: 'button', class: here ? 'here' : '', disabled: f.cloning || here, title: here ? "You're on this floor" : f.cloning ? 'Still being cloned' : `Ride to ${f.name}` },
      h('span.floor-no', { style: `background:${p.trim}` }, String(i + 1)),
      h('span.floor-text', {}, h('span.floor-name', {}, f.name, here ? h('span.here-tag', {}, 'you are here') : null), h('span.floor-sub', {}, f.repo ?? f.dir)),
      h('span.floor-stats', {}, ...stats.flatMap((s, j) => (j ? [' ', s] : [s]))),
    );
    btn.addEventListener('click', () => {
      if (here || f.cloning) return;
      modal.close();
      opts.ride(f.id);
    });
    return btn;
  };

  /** The floor's button, with a 🗑 beside it for admins to take it off the building. */
  const floorRow = (f: FloorInfo, i: number) => {
    const btn = floorButton(f, i);
    if (!store.me.admin || f.cloning) return btn;
    const off = h('button.btn.floor-off', { type: 'button', title: `Take ${f.name} off the building`, 'aria-label': `Remove ${f.name}` }, '🗑');
    off.addEventListener('click', () => confirmRemove(f));
    return h('div.floor-row', {}, btn, off);
  };

  const confirmRemove = (f: FloorInfo) => {
    const next = store.floors.find((o) => o.id !== f.id && !o.cloning);
    const workers = f.workers ? `Its ${f.workers} worker${f.workers === 1 ? '' : 's'} stop${f.workers === 1 ? 's' : ''}. ` : '';
    const people = f.people ? `Everyone on it rides the elevator to ${next ? next.name : 'the lobby'}. ` : '';
    // The office was started in it: its accounts, password and chat live in that .agent-office too, and stay.
    const own = f.local ? ' The office keeps its own settings there too, so it carries on as before, just without this floor.' : '';
    confirmDialog(`Take ${f.name} off the building?`, `${workers}${people}Nothing is deleted: its checkout stays in ${f.dir}, .agent-office folder and all.${own}`, '🗑 Remove floor', () => net.send({ t: 'floor.remove', floor: f.id }));
  };

  /** The roof, over every floor: the rooftop bar. */
  const roofButton = () => {
    const here = store.floor === ROOF;
    const people = [...store.peers.values()].filter((p) => p.floor === ROOF).length;
    const btn = h(
      'button.floor-btn',
      { type: 'button', class: here ? 'here' : '', disabled: here, title: here ? "You're up on the roof" : `Ride up to the ${ROOF_NAME.toLowerCase()}` },
      h('span.floor-no', { style: 'background:#2b2d42' }, '🍸'),
      h('span.floor-text', {}, h('span.floor-name', {}, ROOF_NAME, here ? h('span.here-tag', {}, 'you are here') : null), h('span.floor-sub', {}, 'The roof: a DJ playing drum and bass, a bar, and the city all around')),
      h('span.floor-stats', {}, people ? h('span', { title: 'People up there' }, `🧑 ${people}`) : ''),
    );
    btn.addEventListener('click', () => {
      if (here) return;
      modal.close();
      opts.ride(ROOF);
    });
    return btn;
  };

  const renderFloors = () => {
    const floors = store.floors;
    // Top floor first, the way an elevator's buttons stack, with the roof over them and floor 1 at the bottom.
    floorsEl.replaceChildren(
      ...(floors.some((f) => !f.cloning) ? [roofButton()] : []),
      ...(floors.length ? floors.map(floorRow).reverse() : [h('p.empty', {}, 'No floors yet.')]),
    );
  };

  const repoRow = (r: RepoChoice) => {
    const floor = store.floors.find((f) => sameRepo(f.repo, r.name));
    const row = h(
      'div.repo',
      { role: 'option', class: selected && sameRepo(selected, r.name) ? 'sel' : '', 'aria-selected': String(!!selected && sameRepo(selected, r.name)), title: r.description ?? r.name },
      h('span.nm', {}, r.name),
      r.private ? h('span', { title: 'Private' }, '🔒') : null,
      h('span.desc', {}, r.description ?? ''),
      floor ? h('span.pill', {}, floor.id === store.floor ? 'you are here' : `floor ${store.floors.indexOf(floor) + 1}`) : r.pushedAt ? h('span.when', {}, timeAgo(r.pushedAt)) : null,
    );
    row.addEventListener('click', () => {
      if (adding) return;
      if (floor) {
        // Already a floor: the button takes you there.
        if (floor.id !== store.floor && !floor.cloning) {
          modal.close();
          opts.ride(floor.id);
        }
        return;
      }
      selected = r.name;
      renderAdd();
    });
    row.addEventListener('dblclick', () => {
      if (!floor) add(r.name);
    });
    return row;
  };

  const renderAdd = () => {
    if (!showAdd) {
      const open = h('button.btn', { type: 'button' }, '➕ Add a floor');
      open.addEventListener('click', () => {
        showAdd = true;
        if (mode === 'repo') needRepos();
        if (mode === 'folder') browse('~');
        renderAdd();
        setTimeout(() => input.focus(), 0);
      });
      addEl.replaceChildren(open);
      addBtn.classList.add('hidden');
      return;
    }
    addBtn.classList.remove('hidden');
    const r = store.repos;
    const q = filter.trim().toLowerCase();
    const typed = normalizeRepo(filter);
    const matches = r.list.filter((x) => !q || x.name.toLowerCase().includes(q) || (x.description ?? '').toLowerCase().includes(q));
    const rows: HTMLElement[] = [];
    // owner/name that isn't in the list (someone else's public repository): offer it anyway.
    if (typed && !r.list.some((x) => sameRepo(x.name, typed))) rows.push(repoRow({ name: typed, private: false, description: 'Not in your list — the office will try to clone it' }));
    rows.push(...matches.slice(0, SHOWN).map(repoRow));
    if (!rows.length) rows.push(h('p.empty', { style: 'padding:10px' }, r.loading ? 'Asking GitHub for your repositories…' : r.error ? '' : q ? 'Nothing matches. Type owner/name to clone any repository.' : 'No repositories.'));
    if (matches.length > SHOWN) rows.push(h('p.empty', { style: 'padding:8px 10px' }, `…and ${matches.length - SHOWN} more — type to narrow it down`));
    listEl.replaceChildren(...rows);
    const pick = choice();
    const dest = pick ? `${store.projectsDir.dir}/${pick}` : `${store.projectsDir.dir}/<owner>/<repo>`;
    const change = store.me.admin ? h('button.btn.dir-change', { type: 'button', title: 'Clone new projects into another folder on the office’s machine' }, '📁 Change folder') : null;
    change?.addEventListener('click', () => editDir(true));
    statusEl.replaceChildren(
      adding
        ? h('p.note.busy', {}, `⏳ Cloning ${adding} into ${store.projectsDir.dir}/${adding}… A big repository can take a minute.`)
        : h('p.note', {}, `Cloned into ${dest} with this machine's gh login. Everything on the new floor works in that checkout.`, change),
      ...[r.error, error].filter(Boolean).map((e) => h('p.err', {}, e)),
    );
    if (mode === 'repo') {
      addBtn.disabled = !!adding || !pick || store.floors.some((f) => sameRepo(f.repo, pick));
      addBtn.textContent = adding ? '⏳ Cloning…' : pick ? `🛗 Add ${pick}` : '🛗 Add floor';
    }
    input.disabled = !!adding;
    if (!built) {
      built = true;
      addEl.replaceChildren(h('h3', {}, setup && !store.floors.length ? 'Pick your first floor' : '➕ Add a floor'), tabsEl, repoPane, folderPane, assistantPane);
    }
    paintMode();
  };

  // ---- Tabs: where the new floor comes from ----
  const tabsEl = h('div.seg.add-tabs', { role: 'tablist', 'aria-label': 'Add a floor from' });
  const repoPane = h('div', {}, h('div.repo-search', {}, input, refreshBtn), listEl, statusEl, dirEl);
  const TABS: [AddMode, string][] = [
    ['repo', '🐙 GitHub repo'],
    ['folder', '📁 Folder on this computer'],
    ['assistant', '🤝 Personal assistant'],
  ];
  const setMode = (m: AddMode) => {
    if (adding || m === mode) return;
    mode = m;
    error = '';
    try {
      localStorage.setItem(MODE_KEY, m);
    } catch {
      // storage blocked
    }
    if (m === 'repo') needRepos();
    if (m === 'folder' && !listing) browse(folderInput.value || '~');
    renderAdd();
  };
  const paintMode = () => {
    tabsEl.replaceChildren(...TABS.map(([m, label]) => h('button.btn', { type: 'button', role: 'tab', 'aria-selected': String(m === mode), class: m === mode ? 'on' : '', disabled: !!adding && m !== mode, onclick: () => setMode(m) }, label)));
    repoPane.classList.toggle('hidden', mode !== 'repo');
    folderPane.classList.toggle('hidden', mode !== 'folder');
    assistantPane.classList.toggle('hidden', mode !== 'assistant');
    if (mode === 'folder') renderFolder();
    if (mode === 'assistant') renderAssistant();
  };

  // ---- A folder on the office's machine, as it is ----
  let listing: FolderListing | null = null;
  const folderInput = h('input', { type: 'text', placeholder: '~/Documents/my-stuff', 'aria-label': 'Folder', spellcheck: 'false', autocomplete: 'off' }) as HTMLInputElement;
  const folderGo = h('button.btn', { type: 'button', title: 'Open this folder' }, 'Go');
  const folderUp = h('button.btn', { type: 'button', title: 'The folder this one is in' }, '⬆');
  const folderList = h('div.repo-list', { role: 'listbox', 'aria-label': 'Folders' });
  const folderName = h('input', { type: 'text', placeholder: 'Floor name (optional)', 'aria-label': 'Floor name', maxlength: 100, autocomplete: 'off' }) as HTMLInputElement;
  const folderCreate = h('input', { type: 'checkbox', id: 'folder-create' }) as HTMLInputElement;
  const folderStatus = h('div');
  const folderPane = h(
    'div.hidden',
    {},
    h('div.repo-search', {}, folderUp, folderInput, folderGo),
    folderList,
    h('div.repo-search', { style: 'margin-top:8px' }, folderName),
    h('label.check-row', { for: 'folder-create' }, folderCreate, 'Make the folder if it isn’t there yet'),
    folderStatus,
  );
  const browse = (dir: string) => {
    listing = null;
    folderList.replaceChildren(h('p.empty', { style: 'padding:10px' }, 'Looking…'));
    net.send({ t: 'floor.browse', dir });
  };
  const onBrowse = (l: FolderListing) => {
    listing = l;
    if (!l.error) folderInput.value = l.dir;
    renderFolder();
  };
  browseWaiters.add(onBrowse);
  const join = (dir: string, name: string) => `${dir.replace(/\/+$/, '')}/${name}`;
  const renderFolder = () => {
    const l = listing;
    if (l) {
      const rows: HTMLElement[] = l.folders.map((name) => {
        const row = h('div.repo', { role: 'option', title: join(l.dir, name) }, h('span.nm', {}, `📁 ${name}`));
        row.addEventListener('click', () => browse(join(l.dir, name)));
        return row;
      });
      if (!rows.length) rows.push(h('p.empty', { style: 'padding:10px' }, l.error ? '' : 'No folders in here. You can still make this one a floor.'));
      folderList.replaceChildren(...rows);
      folderUp.disabled = !l.parent;
    }
    const here = l && !l.error ? l.dir : folderInput.value.trim();
    const floor = l?.floor ? store.floors.find((f) => f.id === l.floor) : undefined;
    folderStatus.replaceChildren(
      adding ? h('p.note.busy', {}, `⏳ Setting up ${adding}…`) : h('p.note', {}, 'Any folder works: a project, a git checkout or not, your documents. Workers on the floor start in it. Click a folder to open it, then add the one you’re in.'),
      ...[l?.error, floor ? `${floor.name} is already this folder's floor` : '', error].filter(Boolean).map((e) => h('p.err', {}, e as string)),
    );
    // The whole disk, or the whole home folder, is too big to be a floor (the office says so too).
    const whole = here === '~' || here === '/' || here === '~/';
    addBtn.disabled = !!adding || !here || !!floor || whole;
    addBtn.textContent = adding ? '⏳ Adding…' : here ? `🛗 Add ${here.split('/').filter(Boolean).pop() ?? here}` : '🛗 Add floor';
    folderInput.disabled = !!adding;
  };
  folderGo.addEventListener('click', () => browse(folderInput.value.trim() || '~'));
  folderUp.addEventListener('click', () => listing?.parent && browse(listing.parent));
  folderInput.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.isComposing) return;
    e.preventDefault();
    browse(folderInput.value.trim() || '~');
  });
  folderInput.addEventListener('input', () => {
    // What's typed is what gets added, until it's opened.
    listing = null;
    renderFolder();
  });

  // ---- A personal assistant's floor ----
  const assistantDir = h('input', { type: 'text', 'aria-label': 'Assistant folder', spellcheck: 'false', autocomplete: 'off' }) as HTMLInputElement;
  const assistantName = h('input', { type: 'text', 'aria-label': 'Floor name', maxlength: 100, value: 'Personal assistant', autocomplete: 'off' }) as HTMLInputElement;
  const assistantStatus = h('div');
  const assistantPane = h(
    'div.hidden',
    {},
    h(
      'p.note',
      { style: 'margin-top:0' },
      'A floor for help with anything, not only code: questions, research, writing, plans, your files. Everyone you hire here is a personal assistant (pick Researcher, Writer or Planner when hiring for a specialist). ',
      'They start in its folder, read ABOUT-ME.md there to learn about you, and keep their notes in notes/.',
    ),
    h('label', { style: 'display:block;font-weight:800;margin:10px 0 4px' }, 'Floor name'),
    h('div.repo-search', {}, assistantName),
    h('label', { style: 'display:block;font-weight:800;margin:10px 0 4px' }, 'Its folder (made if it isn’t there)'),
    h('div.repo-search', {}, assistantDir),
    assistantStatus,
  );
  const renderAssistant = () => {
    if (!assistantDir.value) assistantDir.value = `${store.projectsDir.dir}/assistant`;
    assistantStatus.replaceChildren(adding ? h('p.note.busy', {}, `⏳ Setting up ${adding}…`) : '', ...(error ? [h('p.err', {}, error)] : []));
    addBtn.disabled = !!adding || !assistantDir.value.trim();
    addBtn.textContent = adding ? '⏳ Adding…' : '🤝 Add assistant floor';
    assistantDir.disabled = assistantName.disabled = !!adding;
  };
  assistantDir.addEventListener('input', renderAssistant);

  const addFolder = (dir: string, name: string | undefined, create: boolean, assistant: boolean) => {
    if (adding || !dir) return;
    adding = dir;
    error = '';
    renderAdd();
    net.send({ t: 'floor.addFolder', dir, name: name || undefined, create, kind: assistant ? 'assistant' : undefined });
  };
  const addCurrent = () => {
    if (mode === 'folder') {
      const dir = listing && !listing.error ? listing.dir : folderInput.value.trim();
      addFolder(dir, folderName.value.trim(), folderCreate.checked, false);
    } else if (mode === 'assistant') addFolder(assistantDir.value.trim(), assistantName.value.trim(), true, true);
    else {
      const pick = choice();
      if (pick) add(pick);
    }
  };

  const add = (repo: string) => {
    if (adding) return;
    adding = repo;
    error = '';
    renderAdd();
    net.send({ t: 'floor.add', repo });
  };

  const onAdded = (msg: Extract<ServerMsg, { t: 'floor.added' }>) => {
    if (!adding || msg.repo !== adding) return;
    adding = null;
    if (msg.error || !msg.floor) {
      error = msg.error ?? 'The floor could not be added';
      renderAdd();
      return;
    }
    modal.close();
    opts.ride(msg.floor);
  };
  addedWaiters.add(onAdded);

  input.addEventListener('input', () => {
    filter = input.value;
    // Typing something else drops the row that was picked, unless it's still what's typed.
    if (selected && !sameRepo(selected, normalizeRepo(filter))) selected = null;
    renderAdd();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.isComposing) return;
    e.preventDefault();
    const q = filter.trim().toLowerCase();
    const matches = store.repos.list.filter((x) => !store.floors.some((f) => sameRepo(f.repo, x.name)) && (x.name.toLowerCase().includes(q) || (x.description ?? '').toLowerCase().includes(q)));
    const pick = choice() ?? (q && matches.length === 1 ? matches[0].name : undefined);
    if (pick) add(pick);
  });
  addBtn.addEventListener('click', addCurrent);
  refreshBtn.addEventListener('click', () => {
    store.repos = { ...store.repos, loading: true, error: undefined };
    renderAdd();
    net.send({ t: 'floor.repos', refresh: true });
  });

  const intro = setup
    ? h(
        'p.intro',
        {},
        store.floors.length
          ? 'Every project is a floor of this building. Pick a floor to ride to, or add another project.'
          : "Every project is a floor of this building, and it doesn't have any yet. Pick one of your repositories (the office clones it), any folder on this computer, or set up a personal assistant: it becomes the first floor.",
      )
    : null;
  const el = h(
    'div.modal.elevator',
    { role: 'dialog', 'aria-label': 'Elevator' },
    h('header', {}, h('h2', {}, setup ? '🏢 Welcome to Agent Office' : '🛗 Elevator'), close),
    h('div.body', {}, intro, floorsEl, addEl),
    h('footer', {}, h('span.grow', {}, setup ? 'Your office, one floor per project' : 'Pick a floor · Esc to stay here'), addBtn),
  );
  const unsubs = [store.on('floors', () => (renderFloors(), renderAdd())), store.on('repos', renderAdd), store.on('projectsDir', () => (editDir(false), renderAdd())), store.on('floor', renderFloors), store.on('peers', renderFloors), store.on('me', () => (renderFloors(), renderAdd()))];
  const modal = openModal(el, {
    doing: '🛗 at the elevator',
    escCloses: !setup,
    backdropCloses: !setup,
    onClose: () => {
      current = null;
      addedWaiters.delete(onAdded);
      browseWaiters.delete(onBrowse);
      for (const off of unsubs) off();
    },
  });
  current = modal;
  close?.addEventListener('click', () => modal.close());
  renderFloors();
  if (showAdd && mode === 'repo') needRepos();
  if (showAdd && mode === 'folder') browse('~');
  renderAdd();
  if (showAdd && mode === 'repo') setTimeout(() => input.focus(), 30);
}
