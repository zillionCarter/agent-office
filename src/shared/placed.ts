// Where the desks and seats set up on your own models (shared/assets.ts) are, once a model is put
// down on a floor: the worker's desk as a DeskDef (so workers are hired and sit there like at any
// desk), and each seat as a SeatDef (so anyone can sit there like on the couch). Both sides work
// them out the same way from the floor's furniture and the library.

import type { AssetInfo, AssetSeat } from './assets.js';
import type { FurnitureItem } from './furniture.js';
import type { DeskDef, SeatDef } from './layout.js';

/** The id of the desk on a placed model. */
export const deskIdOf = (itemId: string) => `a-${itemId}`;
/** The id of seat `i` on a placed model. */
export const seatIdOf = (itemId: string, i: number) => `m-${itemId}-${i}`;

/** How far in front of where a worker sits its laptop is, as at the office's own desks (see deskSeat). */
const REACH = 0.93;

/** Where a spot on a placed model is on the floor, and the way it faces there. */
export function placedSpot(item: Pick<FurnitureItem, 'x' | 'z' | 'rotY' | 'scale'>, s: AssetSeat): { x: number; y: number; z: number; rotY: number } {
  const k = item.scale ?? 1;
  const c = Math.cos(item.rotY);
  const n = Math.sin(item.rotY);
  return { x: item.x + (s.x * c + s.z * n) * k, y: s.y * k, z: item.z + (-s.x * n + s.z * c) * k, rotY: item.rotY + s.rotY };
}

/** A desk on a placed model, with how high its worker sits (`seatY`). */
export interface PlacedDesk extends DeskDef {
  seatY: number;
  /** The model it's on. */
  item: string;
}

export function placedDesk(item: FurnitureItem, asset: AssetInfo | undefined): PlacedDesk | undefined {
  if (item.kind !== 'asset' || !asset?.desk) return undefined;
  const at = placedSpot(item, asset.desk);
  // A DeskDef's worker sits on its +z side facing -z (rotY 0): turned so they face the way the spot does.
  const rotY = at.rotY + Math.PI;
  return {
    id: deskIdOf(item.id),
    label: asset.name,
    x: at.x - Math.sin(rotY) * REACH,
    z: at.z - Math.cos(rotY) * REACH,
    rotY,
    seatY: at.y,
    item: item.id,
  };
}

export function placedSeats(item: FurnitureItem, asset: AssetInfo | undefined): SeatDef[] {
  if (item.kind !== 'asset' || !asset?.seats.length) return [];
  return asset.seats.map((s, i) => {
    const at = placedSpot(item, s);
    return { id: seatIdOf(item.id, i), label: `🪑 ${asset.name}`, x: at.x, y: 0, z: at.z, rotY: at.rotY, places: [0], hips: at.y, depth: 0, out: 0.7 };
  });
}

/** Every desk and seat on the models put down on a floor. */
export function placedAll(items: FurnitureItem[], assets: AssetInfo[]): { desks: PlacedDesk[]; seats: SeatDef[] } {
  const byId = new Map(assets.map((a) => [a.id, a]));
  const desks: PlacedDesk[] = [];
  const seats: SeatDef[] = [];
  for (const it of items) {
    if (it.kind !== 'asset' || !it.asset) continue;
    const a = byId.get(it.asset);
    const d = placedDesk(it, a);
    if (d) desks.push(d);
    seats.push(...placedSeats(it, a));
  }
  return { desks, seats };
}
