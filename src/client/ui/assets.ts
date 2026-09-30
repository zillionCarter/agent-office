import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { MAX_SCALE, MIN_SCALE, type AssetInfo, type AssetScreen, type AssetSeat } from '../../shared/assets';
import type { Net } from '../net';
import { store } from '../state';
import { loadModel } from '../world/assets';
import { h, openModal, toast } from './dom';

// Your own things: the library of models and pictures (upload, put down, set up, take out), and the
// setup window for a model, where you click on it to say where people sit, where a worker sits at
// it (a desk), and where its screen is (a TV or a computer that shows a web page).

const kb = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** Sends a file to the library. Resolves to the new asset, or throws why not. */
export async function uploadAsset(file: File): Promise<AssetInfo> {
  const res = await fetch(`/api/assets?name=${encodeURIComponent(file.name)}`, { method: 'POST', body: file, credentials: 'same-origin' });
  const body = (await res.json().catch(() => ({}))) as { asset?: AssetInfo; error?: string };
  if (!res.ok || !body.asset) throw new Error(body.error ?? `The office said ${res.status}`);
  return body.asset;
}

export interface LibraryOptions {
  net: Net;
  /** Put one of your models in your hands, in build mode. */
  hold(asset: AssetInfo): void;
}

/** The library window. */
export function openLibrary(opts: LibraryOptions) {
  const { net } = opts;
  const list = h('div.asset-list');
  const file = h('input', { type: 'file', accept: '.glb,.png,.jpg,.jpeg,.webp', multiple: true, style: 'display:none' }) as HTMLInputElement;
  const upload = h('button.btn.primary', { type: 'button' }, '⬆️ Upload a model or picture');
  const status = h('p.setting-note', { style: 'margin:8px 0 0' }, 'Models: .glb (in Blender, File → Export → glTF 2.0, format glTF Binary), with their own colors and materials. Pictures (PNG, JPEG, WebP) are for floors.');
  upload.addEventListener('click', () => file.click());
  file.addEventListener('change', async () => {
    for (const f of [...(file.files ?? [])]) {
      status.textContent = `Uploading ${f.name}…`;
      try {
        const a = await uploadAsset(f);
        status.textContent = `${a.name} is in the library.`;
      } catch (err) {
        status.textContent = `${f.name}: ${(err as Error).message}`;
      }
    }
    file.value = '';
  });
  const close = h('button.btn.close', { type: 'button', 'aria-label': 'Close' }, '✕');
  const el = h('div.modal.assets', { role: 'dialog', 'aria-label': 'Your models and pictures' }, h('header', {}, h('h2', {}, '📦 Your models and pictures'), close), h('div.body', {}, h('div', {}, upload, file), status, list));
  const paint = () => {
    const models = store.assets.filter((a) => a.type === 'model');
    const pictures = store.assets.filter((a) => a.type === 'image');
    const row = (a: AssetInfo) => {
      const uses = [a.desk ? '🖥️ desk' : '', a.seats.length ? `🪑 ${a.seats.length} seat${a.seats.length === 1 ? '' : 's'}` : '', a.screen ? '📺 screen' : '', a.solid ? '' : '👻 walk-through'].filter(Boolean).join(' · ');
      const btns: HTMLElement[] = [];
      if (a.type === 'model') {
        const place = h('button.btn', { type: 'button', title: 'Hold it in build mode, to put it down' }, '✋ Place');
        place.addEventListener('click', () => {
          modal.close();
          opts.hold(a);
        });
        const setup = h('button.btn', { type: 'button', title: 'Its size, and where people sit, where a worker sits, where its screen is' }, '⚙️ Set up');
        setup.addEventListener('click', () => openAssetSetup(net, a));
        btns.push(place, setup);
      } else {
        const use = h('button.btn', { type: 'button', title: 'Lay it as this floor’s floor' }, '🟫 Use as floor');
        use.addEventListener('click', () => net.send({ t: 'furn.floor', floor: { style: 'image', image: a.id, tile: 2 } }));
        btns.push(use);
      }
      const del = h('button.btn', { type: 'button', title: 'Take it out of the library (and off every floor)' }, '🗑');
      del.addEventListener('click', () => {
        if (confirm(`Take ${a.name} out of the library? Every copy of it comes off every floor.`)) net.send({ t: 'asset.remove', id: a.id });
      });
      btns.push(del);
      return h('div.asset-row', {}, h('span.asset-icon', {}, a.type === 'model' ? '📦' : '🖼️'), h('div.asset-text', {}, h('strong', {}, a.name), h('small', {}, [kb(a.bytes), uses].filter(Boolean).join(' · '))), h('div.asset-btns', {}, ...btns));
    };
    list.replaceChildren(
      h('h3', {}, 'Models'),
      ...(models.length ? models.map(row) : [h('p.empty', {}, 'No models yet.')]),
      h('h3', {}, 'Pictures'),
      ...(pictures.length ? pictures.map(row) : [h('p.empty', {}, 'No pictures yet.')]),
    );
  };
  paint();
  const off = store.on('assets', paint);
  const modal = openModal(el, { doing: '📦 looking through the library', onClose: off });
  close.addEventListener('click', () => modal.close());
}

type Tool = 'seat' | 'desk' | 'screen' | null;

/**
 * A model's setup: its name, how big it goes down, whether it's solid, and — clicking on it in the
 * preview — where people sit on it, where a worker sits at it, and where its screen is.
 */
export function openAssetSetup(net: Net, a: AssetInfo) {
  const draft = { name: a.name, scale: a.scale, solid: a.solid, seats: a.seats.map((s) => ({ ...s })), desk: a.desk ? { ...a.desk } : undefined, screen: a.screen ? { ...a.screen } : undefined } as {
    name: string;
    scale: number;
    solid: boolean;
    seats: AssetSeat[];
    desk?: AssetSeat;
    screen?: AssetScreen;
  };
  let tool: Tool = null;
  const canvas = h('canvas.asset-canvas', { 'aria-label': 'The model: drag to turn, scroll to zoom, click to place' }) as HTMLCanvasElement;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight('#ffffff', '#b7a58f', 2.2));
  const sun = new THREE.DirectionalLight('#ffffff', 1.6);
  sun.position.set(3, 6, 4);
  scene.add(sun);
  const grid = new THREE.GridHelper(20, 20, '#8d99ae', '#ced4da');
  scene.add(grid);
  const camera = new THREE.PerspectiveCamera(40, 1, 0.01, 1000);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  const model = new THREE.Group();
  scene.add(model);
  const markers = new THREE.Group();
  scene.add(markers);
  let size = new THREE.Vector3(1, 1, 1);
  const sizeText = h('span.asset-size');
  let raf = 0;
  let disposed = false;

  void loadModel(a.id).then((m) => {
    if (disposed) return;
    model.add(m.clone(true));
    size = m.userData.size as THREE.Vector3;
    const r = Math.max(size.x, size.y, size.z);
    camera.position.set(r * 1.4, r * 1.1, r * 1.8);
    controls.target.set(0, size.y / 2, 0);
    camera.near = r / 200;
    camera.far = r * 50;
    camera.updateProjectionMatrix();
    grid.scale.setScalar(Math.max(1, r / 8));
    paintSize();
    paintMarkers();
  }, (err) => toast(`Couldn't load ${a.name}: ${(err as Error).message}`, 'warn'));

  const fit = () => {
    const w = canvas.clientWidth;
    const hgt = canvas.clientHeight;
    if (!w || !hgt) return;
    renderer.setSize(w, hgt, false);
    camera.aspect = w / hgt;
    camera.updateProjectionMatrix();
  };
  const frame = () => {
    fit();
    controls.update();
    renderer.render(scene, camera);
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);

  // ---- Markers: what's been set up, drawn on the model ----
  const arrow = (s: AssetSeat, color: string) => {
    const g = new THREE.Group();
    const r = Math.max(0.08, Math.max(size.x, size.z) / 30);
    g.add(new THREE.Mesh(new THREE.SphereGeometry(r, 12, 10), new THREE.MeshBasicMaterial({ color })));
    const cone = new THREE.Mesh(new THREE.ConeGeometry(r * 0.7, r * 2.2, 12), new THREE.MeshBasicMaterial({ color }));
    cone.rotation.x = Math.PI / 2;
    cone.position.z = r * 1.8;
    g.add(cone);
    g.position.set(s.x, s.y, s.z);
    g.rotation.y = s.rotY;
    return g;
  };
  const paintMarkers = () => {
    for (const c of [...markers.children]) markers.remove(c);
    for (const s of draft.seats) markers.add(arrow(s, '#06d6a0'));
    if (draft.desk) markers.add(arrow(draft.desk, '#ff8a5b'));
    if (draft.screen) {
      const sc = draft.screen;
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(sc.w, sc.h), new THREE.MeshBasicMaterial({ color: '#4f86f7', transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthTest: false }));
      plane.position.set(sc.x, sc.y, sc.z);
      plane.rotation.set(sc.tilt ?? 0, sc.rotY, 0, 'YXZ');
      markers.add(plane);
    }
    paintLists();
  };

  // ---- Clicking on the model ----
  const ray = new THREE.Raycaster();
  let downAt: { x: number; y: number } | null = null;
  canvas.addEventListener('pointerdown', (e) => (downAt = { x: e.clientX, y: e.clientY }));
  canvas.addEventListener('pointerup', (e) => {
    if (!downAt || Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 5 || !tool) return;
    downAt = null;
    const r = canvas.getBoundingClientRect();
    ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
    const hit = ray.intersectObject(model, true)[0];
    // A worker (or someone sitting) can be on the floor beside it, as with a desk and no chair: the ground counts there.
    const ground = !hit && tool !== 'screen' ? ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), new THREE.Vector3()) : null;
    if (!hit && !ground) return;
    const p = hit ? hit.point : ground!;
    // Facing you, the way you're looking at it from.
    const toCam = new THREE.Vector3().subVectors(camera.position, p);
    const rotY = Math.round(Math.atan2(toCam.x, toCam.z) / (Math.PI / 12)) * (Math.PI / 12);
    if (tool === 'seat') draft.seats.push({ x: p.x, y: p.y, z: p.z, rotY });
    // A worker faces the desk: the way you're looking, from behind their chair.
    else if (tool === 'desk') draft.desk = { x: p.x, y: p.y, z: p.z, rotY: rotY + Math.PI };
    else if (tool === 'screen' && hit) {
      // Flat on the surface where you clicked, whichever way it faces: upright, or leaning back like a laptop's lid.
      const n = hit.face ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld).normalize() : toCam.normalize();
      if (n.dot(toCam) < 0) n.negate();
      const face = Math.atan2(n.x, n.z);
      const tilt = -Math.asin(Math.max(-1, Math.min(1, n.y)));
      const w = draft.screen?.w ?? Math.max(0.3, Math.min(size.x, size.z) * 0.8);
      draft.screen = { x: p.x + n.x * 0.004, y: p.y + n.y * 0.004, z: p.z + n.z * 0.004, w, h: draft.screen?.h ?? w * 0.5625, rotY: face, tilt };
    }
    paintMarkers();
  });

  // ---- The controls beside it ----
  const name = h('input', { type: 'text', value: draft.name, maxlength: 60, 'aria-label': 'Name' }) as HTMLInputElement;
  name.addEventListener('input', () => (draft.name = name.value));
  const scale = h('input', { type: 'number', min: String(MIN_SCALE), max: String(MAX_SCALE), step: '0.05', value: String(draft.scale), 'aria-label': 'Size' }) as HTMLInputElement;
  const paintSize = () => (sizeText.textContent = `${(size.x * draft.scale).toFixed(2)} × ${(size.z * draft.scale).toFixed(2)} m, ${(size.y * draft.scale).toFixed(2)} m tall`);
  scale.addEventListener('input', () => {
    const v = Number(scale.value);
    if (v >= MIN_SCALE && v <= MAX_SCALE) draft.scale = v;
    paintSize();
  });
  const solid = h('input', { type: 'checkbox', id: 'asset-solid', checked: draft.solid }) as HTMLInputElement;
  solid.addEventListener('change', () => (draft.solid = solid.checked));
  const tools = h('div.seg.asset-tools');
  const lists = h('div.asset-lists');
  const toolHelp: Record<Exclude<Tool, null>, string> = {
    seat: 'Click where someone sits (a cushion, a chair seat). They face the way you’re looking from: turn the model to face its front first.',
    desk: 'Stand behind where the worker sits (turn the model so you look at the desk from their chair), then click their chair, or the floor there. Their laptop goes on the desk in front of them.',
    screen: 'Click the middle of the screen: it lies flat on the surface you click, tilted the same. Then size it below.',
  };
  const help = h('p.setting-note', { style: 'margin:6px 0 0' });
  const paintTools = () => {
    tools.replaceChildren(
      ...(
        [
          ['seat', '🪑 Add seats'],
          ['desk', '🖥️ Worker desk'],
          ['screen', '📺 Screen'],
        ] as const
      ).map(([t, label]) => {
        const b = h('button.btn', { type: 'button', class: tool === t ? 'on' : '' }, label);
        b.addEventListener('click', () => {
          tool = tool === t ? null : t;
          paintTools();
        });
        return b;
      }),
    );
    help.textContent = tool ? toolHelp[tool] : 'Drag to turn it, scroll to zoom. Pick a tool, then click on the model.';
    canvas.classList.toggle('placing', !!tool);
  };
  const turnBtn = (label: string, fn: () => void) => {
    const b = h('button.btn.mini', { type: 'button' }, label);
    b.addEventListener('click', () => (fn(), paintMarkers()));
    return b;
  };
  const paintLists = () => {
    const rows: HTMLElement[] = [];
    draft.seats.forEach((s, i) =>
      rows.push(
        h(
          'div.asset-mark',
          {},
          `🪑 Seat ${i + 1}`,
          turnBtn('⟲', () => (s.rotY -= Math.PI / 12)),
          turnBtn('⟳', () => (s.rotY += Math.PI / 12)),
          turnBtn('🗑', () => draft.seats.splice(i, 1)),
        ),
      ),
    );
    if (draft.desk) {
      const d = draft.desk;
      rows.push(h('div.asset-mark', {}, '🖥️ Worker sits here', turnBtn('⟲', () => (d.rotY -= Math.PI / 12)), turnBtn('⟳', () => (d.rotY += Math.PI / 12)), turnBtn('🗑', () => (draft.desk = undefined))));
    }
    if (draft.screen) {
      const sc = draft.screen;
      const w = h('input', { type: 'number', step: '0.05', min: '0.05', value: sc.w.toFixed(2), 'aria-label': 'Screen width', title: 'Width (as exported)' }) as HTMLInputElement;
      const hh = h('input', { type: 'number', step: '0.05', min: '0.05', value: sc.h.toFixed(2), 'aria-label': 'Screen height', title: 'Height (as exported)' }) as HTMLInputElement;
      w.addEventListener('change', () => ((sc.w = Math.max(0.05, Number(w.value) || sc.w)), paintMarkers()));
      hh.addEventListener('change', () => ((sc.h = Math.max(0.05, Number(hh.value) || sc.h)), paintMarkers()));
      rows.push(
        h(
          'div.asset-mark',
          {},
          '📺 Screen',
          w,
          '×',
          hh,
          turnBtn('⟲', () => (sc.rotY -= Math.PI / 12)),
          turnBtn('⟳', () => (sc.rotY += Math.PI / 12)),
          turnBtn('▲', () => (sc.y += Math.max(0.01, sc.h / 20))),
          turnBtn('▼', () => (sc.y -= Math.max(0.01, sc.h / 20))),
          turnBtn('↶ tip', () => (sc.tilt = (sc.tilt ?? 0) - Math.PI / 36)),
          turnBtn('↷ tip', () => (sc.tilt = (sc.tilt ?? 0) + Math.PI / 36)),
          turnBtn('🗑', () => (draft.screen = undefined)),
        ),
      );
    }
    lists.replaceChildren(...(rows.length ? rows : [h('p.empty', {}, 'Nothing set up yet: it’s just a model.')]));
  };
  paintTools();
  paintLists();

  const save = h('button.btn.primary', { type: 'button' }, 'Save');
  const cancel = h('button.btn', { type: 'button' }, 'Cancel');
  const el = h(
    'div.modal.asset-setup',
    { role: 'dialog', 'aria-label': `Set up ${a.name}` },
    h('header', {}, h('h2', {}, `⚙️ ${a.name}`)),
    h(
      'div.body',
      {},
      canvas,
      h(
        'div.asset-side',
        {},
        h('label', {}, 'Name'),
        name,
        h('label', {}, 'Size (1 is as exported)'),
        h('div', { style: 'display:flex;gap:8px;align-items:center' }, scale, sizeText),
        h('label.check-row', { for: 'asset-solid', style: 'display:flex;gap:8px;align-items:center;margin-top:8px;font-weight:700;cursor:pointer' }, solid, 'Solid: people bump into its walls and sides'),
        h('label', {}, 'What it’s for'),
        tools,
        help,
        lists,
      ),
    ),
    h('footer', {}, h('span.grow', {}, 'Green: seats · Orange: where a worker sits · Blue: its screen'), cancel, save),
  );
  const modal = openModal(el, {
    doing: `⚙️ setting up ${a.name}`,
    onClose: () => {
      disposed = true;
      cancelAnimationFrame(raf);
      controls.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    },
  });
  cancel.addEventListener('click', () => modal.close());
  save.addEventListener('click', () => {
    // null, not undefined, so a desk or screen that was taken off goes (undefined would drop out of the message).
    net.send({ t: 'asset.update', id: a.id, asset: { name: draft.name, scale: draft.scale, solid: draft.solid, seats: draft.seats, desk: draft.desk ?? null, screen: draft.screen ?? null } as unknown as Partial<AssetInfo> });
    modal.close();
  });
}
