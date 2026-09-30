import * as THREE from 'three';
import { FURNITURE, FURNITURE_COLORS, FURNITURE_KINDS, MAX_LENGTH, MIN_LENGTH, MOVABLE_DESKS, clampToFloor, cleanAngle, widthOf, type FurnitureItem, type FurnitureKind, type FurniturePlacement } from '../../shared/furniture';
import { DESK_BY_ID, FLOOR } from '../../shared/layout';
import type { Net } from '../net';
import { store } from '../state';
import { buildPiece, type FurnitureView } from '../world/furniture';
import type { Office } from '../world/office';
import { h } from './dom';

// Build mode, the way building games do it: you keep walking about in first person (or third), and
// what you hold goes down where you look. I (or Tab) opens the catalog; pick a piece and it's in your
// hands, a see-through ghost on the floor ahead; the wheel turns it, [ and ] stretch it, C repaints it,
// a click puts it down (and you keep holding another, for a run of walls). Look at something already
// there, or a desk, and click to select it: G picks it up to move, the wheel or R turns it, C repaints,
// X takes it away (or puts a desk back). Everyone on the floor sees each change as it's made.

const STEP = Math.PI / 12;
const SNAP = 0.25;
/** How far away you can put something down, or pick it out. */
const REACH = 14;

type Selection = { type: 'item'; id: string } | { type: 'desk'; id: string };
type Holding = { kind: FurnitureKind; rotY: number; length?: number; color?: string; text?: string; moving?: Selection };

export interface BuildOptions {
  net: Net;
  canvas: HTMLCanvasElement;
  scene: THREE.Scene;
  office: Office;
  furniture: FurnitureView;
  /** Opens or closes the catalog: the player lets go of the mouse while it's open, and takes it back after. */
  setCatalog(open: boolean): void;
  onToggle(active: boolean): void;
}

export class BuildMode {
  active = false;
  catalogOpen = false;
  private catalog: HTMLElement;
  private bar: HTMLElement;
  private holding: Holding | null = null;
  private selected: Selection | null = null;
  private looking: Selection | null = null;
  private ghost: THREE.Group | null = null;
  private selBox: THREE.BoxHelper | null = null;
  private lookBox: THREE.BoxHelper | null = null;
  private ray = new THREE.Raycaster();
  private ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private at: { x: number; z: number } | null = null;
  private signText = 'Office';
  /** Turns of the wheel on something already down, sent once the wheel stops. */
  private wheelTurn = { steps: 0, timer: 0 };
  private barKey = '';

  constructor(private o: BuildOptions) {
    this.catalog = h('div.build-panel.hidden', { role: 'dialog', 'aria-label': 'Build catalog' });
    this.bar = h('div.build-bar.hidden');
    document.body.append(this.catalog, this.bar);
    // Ahead of the camera's own zoom: while you hold (or have picked) something, the wheel turns it.
    window.addEventListener(
      'wheel',
      (e) => {
        if (!this.active || this.catalogOpen || (!this.holding && !this.selected)) return;
        if (e.target !== o.canvas && !(document.pointerLockElement === o.canvas)) return;
        e.preventDefault();
        e.stopPropagation();
        this.turn(e.deltaY > 0 ? 1 : -1);
      },
      { passive: false, capture: true },
    );
    window.addEventListener('mousedown', (e) => {
      if (this.active && !this.catalogOpen && e.button === 2) this.cancel();
    });
    o.canvas.addEventListener('contextmenu', (e) => this.active && e.preventDefault());
    store.on('furniture', () => this.active && this.refreshSelection());
  }

  toggle() {
    if (this.active) this.stop();
    else this.start();
  }

  start() {
    if (this.active || !store.floor || store.floor.startsWith('@')) return;
    this.active = true;
    this.bar.classList.remove('hidden');
    this.o.onToggle(true);
    this.paintBar(true);
  }

  stop() {
    if (!this.active) return;
    this.closeCatalog();
    this.cancel();
    this.select(null);
    this.setLooking(null);
    this.active = false;
    this.bar.classList.add('hidden');
    this.o.onToggle(false);
  }

  /** Every frame while active: where you're aiming (normalized screen coordinates) with `camera`. */
  update(ndc: THREE.Vector2 | null, camera: THREE.Camera) {
    if (!this.active) return;
    this.at = null;
    let look: Selection | null = null;
    if (ndc && !this.catalogOpen) {
      this.ray.setFromCamera(ndc, camera);
      this.ray.far = REACH;
      const hit = this.ray.ray.intersectPlane(this.ground, new THREE.Vector3());
      if (hit && hit.distanceTo(this.ray.ray.origin) <= REACH && hit.x > FLOOR.minX && hit.x < FLOOR.maxX && hit.z > FLOOR.minZ && hit.z < FLOOR.maxZ) {
        this.at = clampToFloor(Math.round(hit.x / SNAP) * SNAP, Math.round(hit.z / SNAP) * SNAP);
      }
      if (!this.holding) look = this.pick();
    }
    this.placeGhost();
    this.setLooking(look && (look.type !== this.selected?.type || look.id !== this.selected.id) ? look : null);
    this.selBox?.update();
    this.lookBox?.update();
    this.paintBar();
  }

  /** A click while active (the crosshair in first person, the mouse in third). */
  click() {
    if (!this.active || this.catalogOpen) return;
    const p = this.holding;
    if (p) {
      if (!this.at) return;
      const { x, z } = this.at;
      if (p.moving?.type === 'item') this.o.net.send({ t: 'furn.update', id: p.moving.id, item: { x, z, rotY: p.rotY } });
      else if (p.moving?.type === 'desk') this.o.net.send({ t: 'furn.desk', deskId: p.moving.id, place: { x, z, rotY: p.rotY } });
      else {
        const item: FurniturePlacement = { kind: p.kind, x, z, rotY: p.rotY, length: p.length, color: p.color, text: p.text };
        this.o.net.send({ t: 'furn.add', item });
        // Keep putting down more of the same (a run of walls), until right-click, Esc or another pick.
        return;
      }
      const sel = p.moving;
      this.cancel();
      this.select(sel);
      return;
    }
    this.select(this.looking ?? this.pick());
  }

  /** A key while active; true when build mode used it (movement is left to the player). */
  key(e: KeyboardEvent): boolean {
    if (!this.active) return false;
    if (this.catalogOpen) {
      if (e.code === 'Escape' || e.code === 'KeyI' || e.code === 'Tab' || e.code === 'KeyK') this.closeCatalog();
      return true;
    }
    switch (e.code) {
      case 'KeyK':
        this.stop();
        return true;
      case 'KeyI':
      case 'Tab':
        this.openCatalog();
        return true;
      case 'Escape':
        if (this.holding) this.cancel();
        else if (this.selected) this.select(null);
        else this.stop();
        return true;
      case 'KeyR':
        this.turn(e.shiftKey ? -1 : 1);
        return true;
      case 'BracketLeft':
      case 'Minus':
        this.stretch(-0.5);
        return true;
      case 'BracketRight':
      case 'Equal':
        this.stretch(0.5);
        return true;
      case 'KeyC':
        this.recolor(e.shiftKey ? -1 : 1);
        return true;
      case 'KeyG':
        if (this.selected) this.pickUp(this.selected);
        return true;
      case 'KeyX':
      case 'Delete':
      case 'Backspace':
        this.removeSelected();
        return true;
    }
    return false;
  }

  // ---- The catalog ------------------------------------------------------------------------------

  openCatalog() {
    if (!this.active || this.catalogOpen) return;
    this.catalogOpen = true;
    this.paintCatalog();
    this.catalog.classList.remove('hidden');
    this.o.setCatalog(true);
  }

  private closeCatalog() {
    if (!this.catalogOpen) return;
    this.catalogOpen = false;
    this.catalog.classList.add('hidden');
    this.o.setCatalog(false);
  }

  private paintCatalog() {
    const groups = ['Walls', 'Furniture', 'Decor'] as const;
    const close = h('button.btn', { type: 'button' }, 'Close');
    close.addEventListener('click', () => this.closeCatalog());
    const done = h('button.btn.primary', { type: 'button' }, '✅ Stop building');
    done.addEventListener('click', () => this.stop());
    const signIn = h('input', { type: 'text', value: this.signText, maxlength: 40, placeholder: 'Sign text', 'aria-label': 'Text for new signs' }) as HTMLInputElement;
    signIn.addEventListener('input', () => (this.signText = signIn.value || 'Office'));
    signIn.addEventListener('keydown', (e) => e.stopPropagation());
    this.catalog.replaceChildren(
      h('h3', {}, '🛠️ Catalog'),
      ...groups.flatMap((g) => [
        h('div.build-group', {}, g),
        h(
          'div.build-items',
          {},
          ...FURNITURE_KINDS.filter((k) => FURNITURE[k].group === g).map((k) => {
            const def = FURNITURE[k];
            const b = h('button.build-item', { type: 'button', title: `Hold a ${def.label.toLowerCase()} to put down` }, h('span', {}, def.emoji), def.label);
            b.addEventListener('click', () => this.hold(k));
            return b;
          }),
        ),
      ]),
      h('div.build-group', {}, 'Sign text'),
      signIn,
      h('div.build-foot', {}, close, done),
    );
  }

  private hold(kind: FurnitureKind) {
    this.closeCatalog();
    this.select(null);
    this.cancel();
    const def = FURNITURE[kind];
    this.holding = { kind, rotY: 0, length: def.stretch ? def.w : undefined, color: def.colored ? def.color : undefined, text: kind === 'sign' ? this.signText : undefined };
    this.makeGhost();
  }

  // ---- What you're holding ----------------------------------------------------------------------

  private makeGhost() {
    this.dropGhost();
    const p = this.holding;
    if (!p) return;
    let g: THREE.Group;
    if (p.moving?.type === 'desk') {
      const view = this.o.office.desks.get(p.moving.id);
      if (!view) return;
      g = view.group.clone(true);
      g.position.set(0, 0, 0);
      g.rotation.set(0, 0, 0);
      g.traverse((obj) => (obj.visible = true));
    } else g = buildPiece(p);
    g.traverse((obj) => {
      const m = obj as THREE.Mesh;
      if (!m.isMesh) return;
      const mat = (Array.isArray(m.material) ? m.material[0] : m.material).clone() as THREE.MeshToonMaterial;
      mat.transparent = true;
      mat.opacity = Math.min(mat.opacity, 0.55);
      mat.depthWrite = false;
      m.material = mat;
      m.castShadow = false;
      m.raycast = () => {};
    });
    this.ghost = g;
    this.o.scene.add(g);
    this.placeGhost();
  }

  private dropGhost() {
    if (!this.ghost) return;
    this.o.scene.remove(this.ghost);
    this.ghost.traverse((obj) => {
      const m = obj as THREE.Mesh;
      if (m.isMesh) (m.material as THREE.Material).dispose();
    });
    this.ghost = null;
  }

  private placeGhost() {
    if (!this.ghost || !this.holding) return;
    this.ghost.visible = !!this.at;
    if (!this.at) return;
    this.ghost.position.set(this.at.x, 0.01, this.at.z);
    this.ghost.rotation.y = this.holding.rotY;
  }

  /** Lets go of what you're holding; something being moved goes back where it was. */
  private cancel() {
    const moving = this.holding?.moving;
    if (moving?.type === 'item') this.o.furniture.hide(moving.id, false);
    if (moving?.type === 'desk') {
      const v = this.o.office.desks.get(moving.id);
      if (v) v.group.visible = true;
    }
    this.holding = null;
    this.dropGhost();
  }

  // ---- What you're looking at, and what's selected ----------------------------------------------

  /** The piece, or the desk, the aim is on. */
  private pick(): Selection | null {
    const roots = [this.o.furniture.group, ...[...MOVABLE_DESKS].map((id) => this.o.office.desks.get(id)?.group).filter((g): g is THREE.Group => !!g)];
    for (const hit of this.ray.intersectObjects(roots, true)) {
      let obj: THREE.Object3D | null = hit.object;
      if (obj.userData.furnitureId) return { type: 'item', id: obj.userData.furnitureId };
      while (obj) {
        const desk = [...MOVABLE_DESKS].find((id) => this.o.office.desks.get(id)?.group === obj);
        if (desk) return { type: 'desk', id: desk };
        obj = obj.parent;
      }
    }
    return null;
  }

  private objectOf(s: Selection): THREE.Object3D | undefined {
    return s.type === 'item' ? this.o.furniture.object(s.id) : this.o.office.desks.get(s.id)?.group;
  }

  private setLooking(s: Selection | null) {
    if (s?.type === this.looking?.type && s?.id === this.looking?.id) return;
    this.looking = s;
    if (this.lookBox) {
      this.o.scene.remove(this.lookBox);
      this.lookBox.dispose();
      this.lookBox = null;
    }
    const obj = s && this.objectOf(s);
    if (obj) {
      this.lookBox = new THREE.BoxHelper(obj, '#fffaf3');
      this.o.scene.add(this.lookBox);
    }
  }

  private select(sel: Selection | null) {
    this.selected = sel;
    if (this.selBox) {
      this.o.scene.remove(this.selBox);
      this.selBox.dispose();
      this.selBox = null;
    }
    const obj = sel && this.objectOf(sel);
    if (obj) {
      this.selBox = new THREE.BoxHelper(obj, '#ff8a5b');
      this.o.scene.add(this.selBox);
    }
    this.paintBar(true);
  }

  private refreshSelection() {
    const s = this.selected;
    if (s?.type === 'item' && !this.item(s.id)) return this.select(null);
    // Its object was rebuilt with the change: box the new one.
    if (s) this.select(s);
  }

  private item(id: string): FurnitureItem | undefined {
    return store.furniture.items.find((it) => it.id === id);
  }

  /** Picks up what's selected, to put it down somewhere else with a click. */
  private pickUp(s: Selection) {
    if (s.type === 'item') {
      const it = this.item(s.id);
      if (!it) return;
      this.holding = { kind: it.kind, rotY: it.rotY, length: it.length, color: it.color, text: it.text, moving: s };
      this.o.furniture.hide(s.id, true);
    } else {
      const def = DESK_BY_ID.get(s.id);
      if (!def) return;
      this.holding = { kind: 'table', rotY: def.rotY, moving: s };
      this.makeGhost();
      const v = this.o.office.desks.get(s.id);
      if (v) v.group.visible = false;
      this.select(null);
      return;
    }
    this.select(null);
    this.makeGhost();
  }

  private turn(dir: number) {
    if (this.holding) {
      this.holding.rotY = cleanAngle(this.holding.rotY + dir * STEP);
      this.placeGhost();
      return;
    }
    const s = this.selected;
    if (!s) return;
    // The wheel clicks fast: turn it in one go once it stops.
    this.wheelTurn.steps += dir;
    clearTimeout(this.wheelTurn.timer);
    this.wheelTurn.timer = window.setTimeout(() => {
      const steps = this.wheelTurn.steps;
      this.wheelTurn.steps = 0;
      if (!steps) return;
      if (s.type === 'item') {
        const it = this.item(s.id);
        if (it) this.o.net.send({ t: 'furn.update', id: s.id, item: { rotY: cleanAngle(it.rotY + steps * STEP) } });
      } else {
        const def = DESK_BY_ID.get(s.id);
        if (def) this.o.net.send({ t: 'furn.desk', deskId: s.id, place: { x: def.x, z: def.z, rotY: cleanAngle(def.rotY + steps * STEP) } });
      }
    }, 180);
  }

  private stretch(by: number) {
    if (this.holding) {
      if (!FURNITURE[this.holding.kind].stretch || this.holding.moving?.type === 'desk') return;
      this.holding.length = Math.min(MAX_LENGTH, Math.max(MIN_LENGTH, (this.holding.length ?? FURNITURE[this.holding.kind].w) + by));
      this.makeGhost();
      return;
    }
    const s = this.selected;
    if (s?.type !== 'item') return;
    const it = this.item(s.id);
    if (!it || !FURNITURE[it.kind].stretch) return;
    this.o.net.send({ t: 'furn.update', id: s.id, item: { length: Math.min(MAX_LENGTH, Math.max(MIN_LENGTH, widthOf(it) + by)) } });
  }

  private recolor(dir: number) {
    const next = (c: string | undefined, kind: FurnitureKind) => {
      const i = FURNITURE_COLORS.indexOf(c ?? FURNITURE[kind].color);
      return FURNITURE_COLORS[(i + dir + FURNITURE_COLORS.length) % FURNITURE_COLORS.length];
    };
    if (this.holding) {
      if (!FURNITURE[this.holding.kind].colored || this.holding.moving?.type === 'desk') return;
      this.holding.color = next(this.holding.color, this.holding.kind);
      this.makeGhost();
      return;
    }
    const s = this.selected;
    if (s?.type !== 'item') return;
    const it = this.item(s.id);
    if (it && FURNITURE[it.kind].colored) this.o.net.send({ t: 'furn.update', id: s.id, item: { color: next(it.color, it.kind) } });
  }

  private removeSelected() {
    const s = this.selected;
    if (s?.type === 'item') {
      this.o.net.send({ t: 'furn.remove', id: s.id });
      this.select(null);
    } else if (s?.type === 'desk' && store.furniture.desks[s.id]) this.o.net.send({ t: 'furn.desk', deskId: s.id, place: null });
  }

  // ---- The bar along the bottom -----------------------------------------------------------------

  private paintBar(force = false) {
    const k = (key: string, what: string) => h('span.build-key', {}, h('kbd', {}, key), what);
    const name = (s: Selection) => (s.type === 'desk' ? `🖥️ ${DESK_BY_ID.get(s.id)?.label ?? 'Desk'}` : (() => {
      const it = this.item(s.id);
      return it ? `${FURNITURE[it.kind].emoji} ${FURNITURE[it.kind].label}` : '';
    })());
    let key: string;
    let parts: (HTMLElement | string)[];
    const p = this.holding;
    if (p) {
      const def = FURNITURE[p.kind];
      const what = p.moving ? `Moving ${name(p.moving)}` : `Holding ${def.emoji} ${def.label}${p.length && def.stretch ? ` · ${p.length.toFixed(1)} m` : ''}`;
      key = `hold|${what}|${!!this.at}`;
      parts = [
        h('strong', {}, what),
        this.at ? k('Click', 'put it down') : h('span.build-key', {}, 'Look at the floor'),
        k('Wheel', 'turn'),
        def.stretch && p.moving?.type !== 'desk' ? k('[ ]', 'length') : '',
        def.colored && p.moving?.type !== 'desk' ? k('C', 'color') : '',
        k('Right-click', p.moving ? 'put it back' : 'drop it'),
      ];
    } else if (this.selected) {
      const s = this.selected;
      const it = s.type === 'item' ? this.item(s.id) : undefined;
      key = `sel|${s.id}|${it ? JSON.stringify(it) : store.furniture.desks[s.id] ? 'moved' : ''}`;
      parts = [
        h('strong', {}, name(s)),
        k('G', 'move'),
        k('Wheel / R', 'turn'),
        it && FURNITURE[it.kind].stretch ? k('[ ]', `length ${widthOf(it).toFixed(1)} m`) : '',
        it && FURNITURE[it.kind].colored ? k('C', 'color') : '',
        it ? k('X', 'remove') : store.furniture.desks[s.id] ? k('X', 'put it back') : '',
        k('Esc', 'done'),
      ];
    } else {
      key = `idle|${this.looking?.id ?? ''}`;
      parts = [
        h('strong', {}, '🛠️ Build mode'),
        k('I', 'catalog'),
        this.looking ? k('Click', `select ${name(this.looking)}`) : h('span.build-key', {}, 'Look at something to change it'),
        k('K', 'stop building'),
      ];
    }
    if (!force && key === this.barKey) return;
    this.barKey = key;
    this.bar.replaceChildren(...parts);
  }
}
