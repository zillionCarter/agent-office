import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { Collider } from './office';

// Your own models (see shared/assets.ts), loaded from the office's library as they were exported —
// their own materials and colors — and moved so the middle of the footprint is at (0, 0) and the
// underside at y = 0, which is the space every seat, desk and screen on them is set up in.

const loader = new GLTFLoader();
const models = new Map<string, Promise<THREE.Group>>();

/** The model, normalized (see above), shared: clone it (see modelInstance) to put it in a scene. */
export function loadModel(id: string): Promise<THREE.Group> {
  let p = models.get(id);
  if (!p) {
    p = loader.loadAsync(`/api/assets/file?id=${encodeURIComponent(id)}`).then((gltf) => {
      const inner = gltf.scene;
      inner.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(inner);
      const root = new THREE.Group();
      inner.position.set(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2);
      root.add(inner);
      inner.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        m.castShadow = true;
        m.receiveShadow = true;
        // A cartoon outline around big imported surfaces (a building's walls) is more noise than help.
        for (const mat of Array.isArray(m.material) ? m.material : [m.material]) mat.userData.outlineParameters = { visible: false };
      });
      root.userData.size = box.getSize(new THREE.Vector3());
      return root;
    });
    // A failed load is worth trying again next time.
    p.catch(() => models.delete(id));
    models.set(id, p);
  }
  return p;
}

/** A copy of the model to put in a scene (its geometry and materials are shared with the others). */
export async function modelInstance(id: string): Promise<THREE.Group> {
  const m = await loadModel(id);
  const copy = m.clone(true);
  copy.userData.size = m.userData.size;
  return copy;
}

/** How big the model is as exported, in meters. */
export async function modelSize(id: string): Promise<THREE.Vector3> {
  return (await loadModel(id)).userData.size as THREE.Vector3;
}

const CELL = 0.25;

/**
 * What of a placed model you'd bump into, as colliders: every surface that crosses the band where a
 * body is (from just over the floor to head height), in cells of 25 cm, each as tall as the model
 * is there. So a building's walls are solid and its rooms are open, and a table's legs and top stop
 * you while you walk round it. `obj` must be in place, its world matrix up to date. `base` is the
 * floor it stands on.
 */
export function solidColliders(obj: THREE.Object3D, base = 0, max = 4000): Collider[] {
  const lo = base + 0.15;
  const hi = base + 1.8;
  const cells = new Map<string, { x: number; z: number; top: number }>();
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const p = new THREE.Vector3();
  const ab = new THREE.Vector3();
  const ac = new THREE.Vector3();
  obj.updateMatrixWorld(true);
  obj.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || !m.visible) return;
    const pos = m.geometry.getAttribute('position');
    if (!pos) return;
    const index = m.geometry.getIndex();
    const count = index ? index.count : pos.count;
    for (let i = 0; i + 2 < count; i += 3) {
      const ia = index ? index.getX(i) : i;
      const ib = index ? index.getX(i + 1) : i + 1;
      const ic = index ? index.getX(i + 2) : i + 2;
      a.fromBufferAttribute(pos, ia).applyMatrix4(m.matrixWorld);
      b.fromBufferAttribute(pos, ib).applyMatrix4(m.matrixWorld);
      c.fromBufferAttribute(pos, ic).applyMatrix4(m.matrixWorld);
      const minY = Math.min(a.y, b.y, c.y);
      const maxY = Math.max(a.y, b.y, c.y);
      if (maxY < lo || minY > hi) continue;
      ab.subVectors(b, a);
      ac.subVectors(c, a);
      const n = Math.min(60, Math.max(1, Math.ceil(Math.max(ab.length(), ac.length(), b.distanceTo(c)) / (CELL * 0.8))));
      for (let u = 0; u <= n; u++) {
        for (let v = 0; v <= n - u; v++) {
          p.copy(a).addScaledVector(ab, u / n).addScaledVector(ac, v / n);
          if (p.y < lo && maxY < lo) continue;
          const cx = Math.floor(p.x / CELL);
          const cz = Math.floor(p.z / CELL);
          const key = `${cx},${cz}`;
          const cell = cells.get(key);
          if (cell) cell.top = Math.max(cell.top, maxY);
          else cells.set(key, { x: cx, z: cz, top: maxY });
        }
      }
    }
  });
  // Runs of cells along x, of about the same height, become one collider each.
  const rows = new Map<number, { x: number; top: number }[]>();
  for (const cell of cells.values()) {
    let row = rows.get(cell.z);
    if (!row) rows.set(cell.z, (row = []));
    row.push({ x: cell.x, top: cell.top });
  }
  const out: Collider[] = [];
  for (const [z, row] of rows) {
    row.sort((l, r) => l.x - r.x);
    let start = row[0];
    let prev = row[0];
    let top = row[0].top;
    const flush = () => {
      out.push({ minX: start.x * CELL, maxX: (prev.x + 1) * CELL, minZ: z * CELL, maxZ: (z + 1) * CELL, top, bottom: base, fence: top - base > 1.6 });
    };
    for (let i = 1; i < row.length; i++) {
      const cur = row[i];
      if (cur.x === prev.x + 1 && Math.abs(cur.top - top) < 0.3) {
        prev = cur;
        top = Math.max(top, cur.top);
        continue;
      }
      flush();
      start = prev = cur;
      top = cur.top;
    }
    flush();
    if (out.length > max) break;
  }
  return out;
}
