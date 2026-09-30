import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { MAX_FURNITURE, MOVABLE_DESKS, cleanAngle, cleanFloorStyle, cleanPlacement, clampToFloor, type Area, type DeskPlacement, type FloorStyle, type FurnitureItem, type FurniturePlacement, type FurnitureState } from '../shared/furniture.js';
import { FLOOR } from '../shared/layout.js';

/** A floor's furniture and moved desks (see shared/furniture.ts), in its .agent-office/furniture.json. */
export class Furniture {
  private state: FurnitureState = { items: [], desks: {} };
  private file: string;

  constructor(
    dataDir: string,
    /** Where things can go: a floor's room, or the lot beside the building. */
    private area: Area = FLOOR,
  ) {
    this.file = path.join(dataDir, 'furniture.json');
    try {
      if (!existsSync(this.file)) return;
      const saved = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<FurnitureState>;
      for (const it of Array.isArray(saved.items) ? saved.items : []) {
        const p = cleanPlacement(it, area);
        if (typeof p === 'string' || typeof it.id !== 'string') continue;
        this.state.items.push({ ...p, id: it.id, by: typeof it.by === 'string' ? it.by : '?', at: typeof it.at === 'number' ? it.at : 0 });
      }
      for (const [id, d] of Object.entries(saved.desks ?? {})) {
        const place = cleanDesk(d);
        if (MOVABLE_DESKS.has(id) && place) this.state.desks[id] = place;
      }
      const floor = cleanFloorStyle(saved.floor);
      if (floor) this.state.floor = floor;
    } catch (err) {
      console.error(`agent-office: ${this.file} couldn't be read, so the floor starts without its furniture: ${(err as Error).message}`);
    }
  }

  get(): FurnitureState {
    return this.state;
  }

  add(input: Partial<FurniturePlacement>, by: string): FurnitureItem | string {
    if (this.state.items.length >= MAX_FURNITURE) return `This floor has as much as it can take (${MAX_FURNITURE} pieces)`;
    const p = cleanPlacement(input, this.area);
    if (typeof p === 'string') return p;
    const item: FurnitureItem = { ...p, id: randomBytes(5).toString('hex'), by, at: Date.now() };
    this.state.items.push(item);
    this.save();
    return item;
  }

  update(id: string, patch: Partial<FurniturePlacement>): FurnitureItem | string {
    const i = this.state.items.findIndex((it) => it.id === id);
    if (i < 0) return "That's not there any more";
    const was = this.state.items[i];
    const p = cleanPlacement({ ...was, ...patch, kind: was.kind }, this.area);
    if (typeof p === 'string') return p;
    this.state.items[i] = { ...was, ...p };
    this.save();
    return this.state.items[i];
  }

  remove(id: string): FurnitureItem | undefined {
    const i = this.state.items.findIndex((it) => it.id === id);
    if (i < 0) return undefined;
    const [gone] = this.state.items.splice(i, 1);
    this.save();
    return gone;
  }

  /** Lays a new floor, or puts the office's back (null). */
  setFloor(f: Partial<FloorStyle> | null): string | undefined {
    if (f === null) delete this.state.floor;
    else {
      const clean = cleanFloorStyle(f);
      if (!clean) return 'Pick a floor, or a picture for it';
      this.state.floor = clean;
    }
    this.save();
    return undefined;
  }

  /** Takes away every piece of one of your models, when it leaves the library. Returns whether any went. */
  removeAsset(asset: string): boolean {
    const before = this.state.items.length;
    this.state.items = this.state.items.filter((it) => it.asset !== asset);
    if (this.state.items.length === before) return false;
    this.save();
    return true;
  }

  /** Moves a desk, or puts it back where the office puts it (null). */
  placeDesk(id: string, place: Partial<DeskPlacement> | null): string | undefined {
    if (!MOVABLE_DESKS.has(id)) return "That desk can't be moved";
    if (place === null) delete this.state.desks[id];
    else {
      const d = cleanDesk(place);
      if (!d) return 'Put it somewhere on the floor';
      this.state.desks[id] = d;
    }
    this.save();
    return undefined;
  }

  private save() {
    try {
      writeFileSync(this.file, JSON.stringify(this.state, null, 2), { mode: 0o600 });
    } catch (err) {
      console.error(`agent-office: couldn't save the furniture: ${(err as Error).message}`);
    }
  }
}

function cleanDesk(d: unknown): DeskPlacement | undefined {
  const o = d as Partial<DeskPlacement> | undefined;
  if (!o || !Number.isFinite(o.x) || !Number.isFinite(o.z)) return undefined;
  const { x, z } = clampToFloor(o.x as number, o.z as number);
  return { x, z, rotY: cleanAngle(Number.isFinite(o.rotY) ? (o.rotY as number) : 0) };
}
