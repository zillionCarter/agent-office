import * as THREE from 'three';
import { FURNITURE, FURNITURE_COLORS, FURNITURE_KINDS, MAX_LENGTH, MIN_LENGTH, MOVABLE_DESKS, clampToFloor, cleanAngle, widthOf, type FurnitureItem, type FurnitureKind, type FurniturePlacement } from '../../shared/furniture';
import { DESK_BY_ID, FLOOR } from '../../shared/layout';
import type { Net } from '../net';
import { store } from '../state';
import { buildPiece, type FurnitureView } from '../world/furniture';
import type { Office } from '../world/office';
import { h } from './dom';

// Build mode: the floor seen from above, with the ceiling and the floors overhead out of the way.
// Pick a piece from the palette and click to put it down (walls and dividers to make offices, glass,
// doorways, couches, plants…), or click one that's there, or a desk, to move, turn, stretch,
// repaint or remove it. Everyone on the floor sees each change as it's made.

const STEP = Math.PI / 12;
const SNAP = 0.25;

type Selection = { type: 'item'; id: string } | { type: 'desk'; id: string };

export interface BuildOptions {
  net: Net;
  canvas: HTMLCanvasElement;
  scene: THREE.Scene;
  office: Office;
  furniture: FurnitureView;
  /** Called when build mode starts or stops, so the rest of the page can step aside or come back. */
  onToggle(active: boolean): void;
}

export class BuildMode {
  active = false;
  readonly camera = new THREE.PerspectiveCamera(45, 1, 0.5, 400);
  private focus = new THREE.Vector3(0, 0, 0);
  private height = 34;
  private hidden: THREE.Object3D[] = [];
  private panel: HTMLElement;
  private selBar: HTMLElement;
  /** What's being put down or moved: a new piece of a kind, or something already there. */
  private placing: { kind: FurnitureKind; rotY: number; length?: number; color?: string; text?: string; moving?: Selection } | null = null;
  private selected: Selection | null = null;
  private ghost: THREE.Group | null = null;
  private highlight: THREE.BoxHelper | null = null;
  private ray = new THREE.Raycaster();
  private ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private at: { x: number; z: number } | null = null;
  private pan: { x: number; y: number; fx: number; fz: number } | null = null;
  private signText = 'Office';

  constructor(private o: BuildOptions) {
    this.panel = h('div.build-panel.hidden', { role: 'toolbar', 'aria-label': 'Build mode' });
    this.selBar = h('div.build-sel.hidden');
    document.body.append(this.panel, this.selBar);
    const c = o.canvas;
    c.addEventListener('pointermove', (e) => this.active && this.move(e));
    c.addEventListener('pointerdown', (e) => this.active && this.down(e));
    window.addEventListener('pointerup', () => (this.pan = null));
    c.addEventListener('contextmenu', (e) => this.active && e.preventDefault());
    c.addEventListener(
      'wheel',
      (e) => {
        if (!this.active) return;
        e.preventDefault();
        e.stopPropagation();
        if (e.shiftKey && this.placing) return this.turn(e.deltaY > 0 ? 1 : -1);
        this.height = Math.min(48, Math.max(7, this.height * (e.deltaY > 0 ? 1.1 : 0.9)));
      },
      { passive: false, capture: true },
    );
    store.on('furniture', () => this.active && this.paintSelection());
  }

  toggle() {
    if (this.active) this.stop();
    else this.start();
  }

  start() {
    if (this.active || !store.floor || store.floor.startsWith('@')) return;
    this.active = true;
    this.focus.set(0, 0, 0);
    this.height = 34;
    // The ceiling, its lamps' shades and the floors overhead are in the way from up here.
    this.o.office.group.updateMatrixWorld(true);
    const bb = new THREE.Box3();
    this.o.office.group.traverse((obj) => {
      if (!(obj as THREE.Mesh).isMesh || !obj.visible) return;
      bb.setFromObject(obj);
      if (bb.min.y > 4.2) {
        obj.visible = false;
        this.hidden.push(obj);
      }
    });
    this.paintPanel();
    this.panel.classList.remove('hidden');
    this.o.onToggle(true);
  }

  stop() {
    if (!this.active) return;
    this.active = false;
    for (const obj of this.hidden) obj.visible = true;
    this.hidden = [];
    this.cancel();
    this.select(null);
    this.panel.classList.add('hidden');
    this.o.onToggle(false);
  }

  /** Keeps the overhead camera framed on the canvas; called every frame while active. */
  frame() {
    const c = this.o.canvas;
    this.camera.aspect = c.clientWidth / Math.max(1, c.clientHeight);
    this.camera.updateProjectionMatrix();
    this.camera.position.set(this.focus.x, this.height, this.focus.z + this.height * 0.42);
    this.camera.lookAt(this.focus);
    this.highlight?.update();
  }

  /** A key while build mode is on; true when build mode used it. */
  key(e: KeyboardEvent): boolean {
    if (!this.active) return false;
    const pan = (dx: number, dz: number) => {
      const k = this.height * 0.04;
      this.focus.x = Math.min(FLOOR.maxX, Math.max(FLOOR.minX, this.focus.x + dx * k));
      this.focus.z = Math.min(FLOOR.maxZ, Math.max(FLOOR.minZ, this.focus.z + dz * k));
    };
    switch (e.code) {
      case 'Escape':
        if (this.placing) this.cancel();
        else if (this.selected) this.select(null);
        else this.stop();
        return true;
      case 'KeyK':
        this.stop();
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
      case 'KeyM':
        if (this.selected) this.pickUp(this.selected);
        return true;
      case 'Delete':
      case 'Backspace':
        this.removeSelected();
        return true;
      case 'KeyW':
      case 'ArrowUp':
        pan(0, -1);
        return true;
      case 'KeyS':
      case 'ArrowDown':
        pan(0, 1);
        return true;
      case 'KeyA':
      case 'ArrowLeft':
        pan(-1, 0);
        return true;
      case 'KeyD':
      case 'ArrowRight':
        pan(1, 0);
        return true;
    }
    return true;
  }

  // ---- The palette ------------------------------------------------------------------------------

  private paintPanel() {
    const groups = ['Walls', 'Furniture', 'Decor'] as const;
    const done = h('button.btn.primary', { type: 'button' }, '✅ Done');
    done.addEventListener('click', () => this.stop());
    const signIn = h('input', { type: 'text', value: this.signText, maxlength: 40, placeholder: 'Sign text', 'aria-label': 'Text for new signs' }) as HTMLInputElement;
    signIn.addEventListener('input', () => (this.signText = signIn.value || 'Office'));
    signIn.addEventListener('keydown', (e) => e.stopPropagation());
    this.panel.replaceChildren(
      h('h3', {}, '🛠️ Build mode'),
      ...groups.flatMap((g) => [
        h('div.build-group', {}, g),
        h(
          'div.build-items',
          {},
          ...FURNITURE_KINDS.filter((k) => FURNITURE[k].group === g).map((k) => {
            const def = FURNITURE[k];
            const b = h('button.build-item', { type: 'button', title: `Put down a ${def.label.toLowerCase()}`, class: this.placing?.kind === k && !this.placing.moving ? 'on' : '' }, h('span', {}, def.emoji), def.label);
            b.addEventListener('click', () => this.startPlacing(k));
            return b;
          }),
        ),
      ]),
      h('div.build-group', {}, 'Sign text'),
      signIn,
      h(
        'p.build-help',
        {},
        'Click to put it down · R to turn (Shift+R back) · [ ] shorter / longer · Click something (or a desk) to change it · Scroll to zoom · WASD to look around · Esc to stop',
      ),
      done,
    );
  }

  private startPlacing(kind: FurnitureKind) {
    this.select(null);
    this.cancel();
    const def = FURNITURE[kind];
    this.placing = { kind, rotY: 0, length: def.stretch ? def.w : undefined, color: def.colored ? def.color : undefined, text: kind === 'sign' ? this.signText : undefined };
    this.makeGhost();
    this.paintPanel();
  }

  private makeGhost() {
    this.dropGhost();
    const p = this.placing;
    if (!p) return;
    let g: THREE.Group;
    if (p.moving?.type === 'desk') {
      const view = this.o.office.desks.get(p.moving.id);
      if (!view) return;
      g = view.group.clone(true);
      g.position.set(0, 0, 0);
      g.rotation.set(0, 0, 0);
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
    });
    g.visible = !!this.at;
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
    if (!this.ghost || !this.placing) return;
    this.ghost.visible = !!this.at;
    if (!this.at) return;
    this.ghost.position.set(this.at.x, 0.01, this.at.z);
    this.ghost.rotation.y = this.placing.rotY;
  }

  private cancel() {
    const moving = this.placing?.moving;
    if (moving?.type === 'item') this.o.furniture.hide(moving.id, false);
    if (moving?.type === 'desk') {
      const v = this.o.office.desks.get(moving.id);
      if (v) v.group.visible = true;
    }
    this.placing = null;
    this.dropGhost();
    if (this.active) this.paintPanel();
  }

  // ---- The mouse --------------------------------------------------------------------------------

  private pointerRay(e: PointerEvent | MouseEvent) {
    const r = this.o.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(ndc, this.camera);
  }

  private move(e: PointerEvent) {
    if (this.pan) {
      const k = this.height / this.o.canvas.clientHeight;
      this.focus.x = Math.min(FLOOR.maxX, Math.max(FLOOR.minX, this.pan.fx - (e.clientX - this.pan.x) * k));
      this.focus.z = Math.min(FLOOR.maxZ, Math.max(FLOOR.minZ, this.pan.fz - (e.clientY - this.pan.y) * k));
      return;
    }
    this.pointerRay(e);
    const hit = this.ray.ray.intersectPlane(this.ground, new THREE.Vector3());
    const snap = e.altKey ? 0.05 : SNAP;
    this.at = hit ? clampToFloor(Math.round(hit.x / snap) * snap, Math.round(hit.z / snap) * snap) : null;
    this.placeGhost();
  }

  private down(e: PointerEvent) {
    if (e.button === 2 || e.button === 1) {
      this.pan = { x: e.clientX, y: e.clientY, fx: this.focus.x, fz: this.focus.z };
      return;
    }
    if (e.button !== 0) return;
    this.move(e);
    const p = this.placing;
    if (p && this.at) {
      const { x, z } = this.at;
      if (p.moving?.type === 'item') this.o.net.send({ t: 'furn.update', id: p.moving.id, item: { x, z, rotY: p.rotY } });
      else if (p.moving?.type === 'desk') this.o.net.send({ t: 'furn.desk', deskId: p.moving.id, place: { x, z, rotY: p.rotY } });
      else {
        const item: FurniturePlacement = { kind: p.kind, x, z, rotY: p.rotY, length: p.length, color: p.color, text: p.text };
        this.o.net.send({ t: 'furn.add', item });
        // Keep putting down more of the same (a run of walls), until Esc or another pick.
        return;
      }
      const sel = p.moving;
      this.cancel();
      this.select(sel);
      return;
    }
    this.select(this.pick());
  }

  /** The piece, or the desk, under the mouse. */
  private pick(): Selection | null {
    const hits = this.ray.intersectObjects([this.o.furniture.group, ...[...MOVABLE_DESKS].map((id) => this.o.office.desks.get(id)?.group).filter((g): g is THREE.Group => !!g)], true);
    for (const hit of hits) {
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

  // ---- What's selected --------------------------------------------------------------------------

  private item(id: string): FurnitureItem | undefined {
    return store.furniture.items.find((it) => it.id === id);
  }

  private select(sel: Selection | null) {
    this.selected = sel;
    if (this.highlight) {
      this.o.scene.remove(this.highlight);
      this.highlight.dispose();
      this.highlight = null;
    }
    this.paintSelection();
  }

  private paintSelection() {
    const sel = this.selected;
    if (sel?.type === 'item' && !this.item(sel.id)) this.selected = null;
    if (!this.selected) {
      this.selBar.classList.add('hidden');
      if (this.highlight) {
        this.o.scene.remove(this.highlight);
        this.highlight = null;
      }
      return;
    }
    const s = this.selected;
    const obj = s.type === 'item' ? this.o.furniture.object(s.id) : this.o.office.desks.get(s.id)?.group;
    if (obj && !this.highlight) {
      this.highlight = new THREE.BoxHelper(obj, '#ff8a5b');
      this.o.scene.add(this.highlight);
    } else if (obj && this.highlight) this.highlight.setFromObject(obj);
    const btn = (label: string, title: string, fn: () => void) => {
      const b = h('button.btn', { type: 'button', title }, label);
      b.addEventListener('click', fn);
      return b;
    };
    const parts: (HTMLElement | string)[] = [];
    if (s.type === 'desk') {
      const def = DESK_BY_ID.get(s.id);
      parts.push(h('strong', {}, `🖥️ ${def?.label ?? 'Desk'}`));
      parts.push(btn('✋ Move', 'Pick it up and put it somewhere else (M)', () => this.pickUp(s)));
      parts.push(btn('⟳ Turn', 'Turn it (R)', () => this.turn(1)));
      if (store.furniture.desks[s.id]) parts.push(btn('↩︎ Put back', 'Back where the office puts it', () => this.o.net.send({ t: 'furn.desk', deskId: s.id, place: null })));
    } else {
      const it = this.item(s.id)!;
      const def = FURNITURE[it.kind];
      parts.push(h('strong', {}, `${def.emoji} ${def.label}`));
      parts.push(btn('✋ Move', 'Pick it up and put it somewhere else (M)', () => this.pickUp(s)));
      parts.push(btn('⟳ Turn', 'Turn it (R)', () => this.turn(1)));
      if (def.stretch) {
        parts.push(btn('－', 'Shorter ([)', () => this.stretch(-0.5)));
        parts.push(h('span.build-len', {}, `${widthOf(it).toFixed(1)} m`));
        parts.push(btn('＋', 'Longer (])', () => this.stretch(0.5)));
      }
      if (it.kind === 'sign') {
        const text = h('input', { type: 'text', value: it.text ?? '', maxlength: 40, 'aria-label': 'Sign text' }) as HTMLInputElement;
        text.addEventListener('keydown', (e) => {
          e.stopPropagation();
          if (e.key === 'Enter') this.o.net.send({ t: 'furn.update', id: it.id, item: { text: text.value } });
        });
        text.addEventListener('change', () => this.o.net.send({ t: 'furn.update', id: it.id, item: { text: text.value } }));
        parts.push(text);
      }
      if (def.colored) {
        parts.push(
          h(
            'span.build-colors',
            {},
            ...FURNITURE_COLORS.map((c) => {
              const sw = h('button.swatch', { type: 'button', style: `background:${c}`, class: (it.color ?? def.color) === c ? 'sel' : '', 'aria-label': `Color ${c}`, title: c });
              sw.addEventListener('click', () => this.o.net.send({ t: 'furn.update', id: it.id, item: { color: c } }));
              return sw;
            }),
          ),
        );
      }
      parts.push(btn('🗑 Remove', 'Take it away (Delete)', () => this.removeSelected()));
    }
    this.selBar.replaceChildren(...parts);
    this.selBar.classList.remove('hidden');
  }

  /** Picks up what's selected, to put it down somewhere else with a click. */
  private pickUp(s: Selection) {
    if (s.type === 'item') {
      const it = this.item(s.id);
      if (!it) return;
      this.placing = { kind: it.kind, rotY: it.rotY, length: it.length, color: it.color, text: it.text, moving: s };
      this.o.furniture.hide(s.id, true);
    } else {
      const def = DESK_BY_ID.get(s.id);
      if (!def) return;
      this.placing = { kind: 'table', rotY: def.rotY, moving: s };
      const v = this.o.office.desks.get(s.id);
      if (v) v.group.visible = false;
    }
    this.select(null);
    this.makeGhost();
    // makeGhost clones the desk before it's hidden: the clone has to show.
    if (this.ghost) this.ghost.traverse((obj) => (obj.visible = true));
    this.placeGhost();
  }

  private turn(dir: number) {
    if (this.placing) {
      this.placing.rotY = cleanAngle(this.placing.rotY + dir * STEP);
      this.placeGhost();
      return;
    }
    const s = this.selected;
    if (s?.type === 'item') {
      const it = this.item(s.id);
      if (it) this.o.net.send({ t: 'furn.update', id: s.id, item: { rotY: cleanAngle(it.rotY + dir * STEP) } });
    } else if (s?.type === 'desk') {
      const def = DESK_BY_ID.get(s.id);
      if (def) this.o.net.send({ t: 'furn.desk', deskId: s.id, place: { x: def.x, z: def.z, rotY: cleanAngle(def.rotY + dir * STEP) } });
    }
  }

  private stretch(by: number) {
    if (this.placing) {
      if (!FURNITURE[this.placing.kind].stretch || this.placing.moving) return;
      this.placing.length = Math.min(MAX_LENGTH, Math.max(MIN_LENGTH, (this.placing.length ?? FURNITURE[this.placing.kind].w) + by));
      this.makeGhost();
      return;
    }
    const s = this.selected;
    if (s?.type !== 'item') return;
    const it = this.item(s.id);
    if (!it || !FURNITURE[it.kind].stretch) return;
    this.o.net.send({ t: 'furn.update', id: s.id, item: { length: Math.min(MAX_LENGTH, Math.max(MIN_LENGTH, widthOf(it) + by)) } });
  }

  private removeSelected() {
    const s = this.selected;
    if (s?.type !== 'item') return;
    this.o.net.send({ t: 'furn.remove', id: s.id });
    this.select(null);
  }
}
