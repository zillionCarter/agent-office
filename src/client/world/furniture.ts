import * as THREE from 'three';
import { FURNITURE, MOVABLE_DESKS, footprint, widthOf, type FurniturePlacement, type FurnitureState } from '../../shared/furniture';
import { mesh, roundedBox, textPlane, toon } from './toon';
import { plant, type Collider, type Office } from './office';

// What people add to a floor in build mode (see shared/furniture.ts), built in the office: walls and
// glass to make offices, dividers, couches, plants… Each piece is its own group, its footprint turned
// into colliders so nobody walks through a wall, and rebuilt when it changes.

const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);

/** A piece of furniture as it looks, centered on (0, 0, 0) with its width along x (as placed, before turning). */
export function buildPiece(p: Pick<FurniturePlacement, 'kind' | 'length' | 'color' | 'text'>): THREE.Group {
  const def = FURNITURE[p.kind];
  const g = new THREE.Group();
  const w = widthOf(p);
  const { d, h } = def;
  const color = p.color ?? def.color;
  const main = toon(color);
  const dark = toon(new THREE.Color(color).multiplyScalar(0.72));
  switch (p.kind) {
    case 'wall':
      g.add(mesh(box(w, h, d), main, 0, h / 2, 0));
      g.add(mesh(box(w + 0.01, 0.12, d + 0.02), dark, 0, 0.06, 0));
      break;
    case 'glass': {
      const pane = new THREE.MeshToonMaterial({ color: '#bde0fe', transparent: true, opacity: 0.28, depthWrite: false });
      pane.userData.outlineParameters = { visible: false };
      g.add(mesh(box(w, h - 0.12, 0.03), pane, 0, h / 2, 0, false));
      g.add(mesh(box(w, 0.07, d), main, 0, 0.035, 0));
      g.add(mesh(box(w, 0.07, d), main, 0, h - 0.035, 0));
      const posts = Math.max(1, Math.round(w / 1.5));
      for (let i = 0; i <= posts; i++) g.add(mesh(box(0.06, h, d), main, -w / 2 + (i * w) / posts, h / 2, 0));
      break;
    }
    case 'divider':
      g.add(mesh(roundedBox(w, h, d, 0.05), main, 0, h / 2 + 0.05, 0));
      for (const sx of [-1, 1]) g.add(mesh(box(0.08, 0.05, 0.5), toon('#8d99ae'), sx * (w / 2 - 0.15), 0.025, 0));
      break;
    case 'door':
      // A frame with the doorway open under its header.
      for (const sx of [-1, 1]) g.add(mesh(box(0.12, h, d), main, sx * (w / 2 - 0.06), h / 2, 0));
      g.add(mesh(box(w, 0.35, d), main, 0, h - 0.175, 0));
      g.add(mesh(box(w - 0.24, 0.04, d + 0.02), dark, 0, h - 0.37, 0));
      break;
    case 'couch':
      g.add(mesh(roundedBox(w, 0.42, d, 0.08), main, 0, 0.21, 0));
      g.add(mesh(roundedBox(w, 0.5, 0.22, 0.08), main, 0, 0.62, -d / 2 + 0.11));
      for (const sx of [-1, 1]) g.add(mesh(roundedBox(0.2, 0.62, d, 0.06), dark, sx * (w / 2 - 0.1), 0.31, 0));
      for (const sx of [-0.25, 0.25]) g.add(mesh(roundedBox(w / 2 - 0.24, 0.12, d - 0.3, 0.05), toon(new THREE.Color(color).lerp(new THREE.Color('#ffffff'), 0.15)), sx * w, 0.47, 0.08));
      break;
    case 'armchair':
      g.add(mesh(roundedBox(w, 0.42, d, 0.08), main, 0, 0.21, 0));
      g.add(mesh(roundedBox(w, 0.5, 0.2, 0.08), main, 0, 0.62, -d / 2 + 0.1));
      for (const sx of [-1, 1]) g.add(mesh(roundedBox(0.16, 0.6, d, 0.06), dark, sx * (w / 2 - 0.08), 0.3, 0));
      break;
    case 'table':
      g.add(mesh(new THREE.CylinderGeometry(w / 2, w / 2, 0.06, 28), main, 0, h - 0.03, 0));
      g.add(mesh(new THREE.CylinderGeometry(0.06, 0.08, h - 0.06, 10), toon('#8d99ae'), 0, (h - 0.06) / 2, 0));
      g.add(mesh(new THREE.CylinderGeometry(0.35, 0.38, 0.04, 20), toon('#8d99ae'), 0, 0.02, 0));
      break;
    case 'bookcase': {
      g.add(mesh(box(w, h, 0.04), dark, 0, h / 2, -d / 2 + 0.02));
      for (const sx of [-1, 1]) g.add(mesh(box(0.05, h, d), main, sx * (w / 2 - 0.025), h / 2, 0));
      const shelves = 4;
      const books = ['#e63946', '#457b9d', '#f4a261', '#2a9d8f', '#9d4edd', '#ffd166'];
      for (let i = 0; i <= shelves; i++) {
        const y = 0.03 + (i * (h - 0.06)) / shelves;
        g.add(mesh(box(w - 0.1, 0.04, d), main, 0, y, 0));
        if (i === shelves) continue;
        let x = -w / 2 + 0.1;
        let n = 0;
        while (x < w / 2 - 0.2) {
          const bw = 0.06 + ((i * 7 + n * 3) % 5) * 0.012;
          const bh = 0.28 + ((i + n) % 3) * 0.04;
          g.add(mesh(box(bw, bh, d - 0.12), toon(books[(i * 3 + n) % books.length]), x + bw / 2, y + 0.02 + bh / 2, 0.02, false));
          x += bw + 0.01;
          n++;
        }
      }
      break;
    }
    case 'filing':
      g.add(mesh(roundedBox(w, h, d, 0.03), main, 0, h / 2, 0));
      for (let i = 0; i < 3; i++) {
        const y = 0.25 + i * 0.4;
        g.add(mesh(box(w - 0.1, 0.02, 0.02), dark, 0, y + 0.15, d / 2 + 0.005, false));
        g.add(mesh(box(0.16, 0.04, 0.04), toon('#2b2d42'), 0, y, d / 2 + 0.02, false));
      }
      break;
    case 'cooler': {
      g.add(mesh(roundedBox(w, 0.95, d, 0.04), main, 0, 0.475, 0));
      const water = new THREE.MeshToonMaterial({ color: '#8ecae6', transparent: true, opacity: 0.6 });
      g.add(mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.4, 16), water, 0, 1.15, 0));
      g.add(mesh(box(0.08, 0.06, 0.06), toon('#2b2d42'), 0, 0.72, d / 2 + 0.02));
      break;
    }
    case 'plant': {
      const pl = plant(1.2);
      g.add(pl);
      if (p.color) g.add(mesh(new THREE.CylinderGeometry(0.27, 0.22, 0.12, 16), main, 0, 0.06, 0));
      break;
    }
    case 'lamp': {
      g.add(mesh(new THREE.CylinderGeometry(0.18, 0.2, 0.04, 16), toon('#2b2d42'), 0, 0.02, 0));
      g.add(mesh(new THREE.CylinderGeometry(0.025, 0.025, h - 0.3, 8), toon('#2b2d42'), 0, (h - 0.3) / 2, 0));
      g.add(mesh(new THREE.CylinderGeometry(0.14, 0.24, 0.32, 20, 1, true), toon(color, { emissive: `#${new THREE.Color(color).multiplyScalar(0.5).getHexString()}` }), 0, h - 0.16, 0));
      break;
    }
    case 'rug':
      g.add(mesh(roundedBox(w, 0.02, d, 0.3), main, 0, 0.012, 0, false));
      g.add(mesh(roundedBox(w - 0.3, 0.021, d - 0.3, 0.2), toon(new THREE.Color(color).lerp(new THREE.Color('#ffffff'), 0.3)), 0, 0.013, 0, false));
      break;
    case 'sign': {
      g.add(mesh(new THREE.CylinderGeometry(0.03, 0.03, h - 0.4, 8), toon('#8d99ae'), 0, (h - 0.4) / 2, 0));
      g.add(mesh(new THREE.CylinderGeometry(0.2, 0.22, 0.04, 16), toon('#8d99ae'), 0, 0.02, 0));
      g.add(mesh(roundedBox(w, 0.42, 0.06, 0.04), main, 0, h - 0.25, 0));
      for (const side of [1, -1]) {
        const label = textPlane(p.text ?? 'Office', { bg: color, color: new THREE.Color(color).getHSL({ h: 0, s: 0, l: 0 }).l > 0.55 ? '#2b2d42' : '#fffaf3', size: 48 });
        const k = Math.min((w - 0.1) / label.geometry.parameters.width, 0.36 / label.geometry.parameters.height);
        label.scale.setScalar(k);
        label.position.set(0, h - 0.25, side * 0.035);
        if (side < 0) label.rotation.y = Math.PI;
        g.add(label);
      }
      break;
    }
  }
  return g;
}

/** Turns a piece's footprint into colliders, as tall as it is. Rugs and doorways have none. */
export function pieceColliders(p: FurniturePlacement): Collider[] {
  const def = FURNITURE[p.kind];
  if (def.walkThrough) return [];
  const tall = def.h > 1.6;
  return footprint(p).map((b) => ({ ...b, top: def.h, ...(tall ? { fence: true } : {}) }));
}

/** Every piece on the floor you're on, kept in step with the server's list, and its moved desks. */
export class FurnitureView {
  readonly group = new THREE.Group();
  private pieces = new Map<string, { key: string; obj: THREE.Group; colliders: Collider[] }>();

  constructor(
    private colliders: Collider[],
    private office: Office,
  ) {}

  apply(state: FurnitureState) {
    const seen = new Set<string>();
    for (const it of state.items) {
      seen.add(it.id);
      const key = JSON.stringify([it.kind, it.x, it.z, it.rotY, it.length, it.color, it.text]);
      const had = this.pieces.get(it.id);
      if (had?.key === key) continue;
      if (had) this.drop(it.id);
      const obj = buildPiece(it);
      obj.position.set(it.x, 0, it.z);
      obj.rotation.y = it.rotY;
      obj.userData.furnitureId = it.id;
      obj.traverse((o) => (o.userData.furnitureId = it.id));
      this.group.add(obj);
      const cs = pieceColliders(it);
      this.colliders.push(...cs);
      this.pieces.set(it.id, { key, obj, colliders: cs });
    }
    for (const id of [...this.pieces.keys()]) if (!seen.has(id)) this.drop(id);
    for (const id of MOVABLE_DESKS) this.office.moveDesk(id, state.desks[id]);
  }

  /** The piece's scene object, for build mode to highlight. */
  object(id: string): THREE.Group | undefined {
    return this.pieces.get(id)?.obj;
  }

  /** Hides a piece while build mode carries a ghost of it around (or shows it again). */
  hide(id: string, hidden: boolean) {
    const p = this.pieces.get(id);
    if (p) p.obj.visible = !hidden;
  }

  private drop(id: string) {
    const p = this.pieces.get(id);
    if (!p) return;
    this.group.remove(p.obj);
    p.obj.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
    for (const c of p.colliders) {
      const i = this.colliders.indexOf(c);
      if (i >= 0) this.colliders.splice(i, 1);
    }
    this.pieces.delete(id);
  }
}
