// Your own things for the office: 3D models (a .glb exported from Blender or anywhere, colors and
// all) and pictures (for floors). The office keeps one library for the whole building, so an asset
// set up once (its size, where people sit on it, where a worker sits at it, where its screen is) can
// be put down again and again, on any floor or out on the lot next door.
//
// Everything about a model's setup is in its own space: meters as it was exported, with the model
// moved so the middle of its footprint is at (0, 0) and its underside at y = 0 (see client
// world/assets.ts). Scale applies on top.

export type AssetType = 'model' | 'image';

/** A spot to sit: where the sitter's hips go, and the way they face (around y; 0 faces +z). */
export interface AssetSeat {
  x: number;
  y: number;
  z: number;
  rotY: number;
}

/** A screen on a model (a TV, a monitor): its middle, its size, and the way it faces (around y; 0 faces +z). */
export interface AssetScreen {
  x: number;
  y: number;
  z: number;
  w: number;
  h: number;
  rotY: number;
}

export interface AssetInfo {
  id: string;
  type: AssetType;
  name: string;
  bytes: number;
  by: string;
  at: number;
  /** How big it goes down, unless you change it as you place it. */
  scale: number;
  /** People bump into it (its walls, legs, sides), rather than walking through. */
  solid: boolean;
  /** Where people can sit on it (a couch's cushions, a chair). */
  seats: AssetSeat[];
  /** It's a desk: where a worker sits at it, facing its laptop. */
  desk?: AssetSeat;
  /** It has a screen that shows a web page (a TV, a computer). */
  screen?: AssetScreen;
}

export const MAX_ASSET_BYTES = 60 * 1024 * 1024;
export const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
export const MAX_SEATS = 16;
export const MIN_SCALE = 0.02;
export const MAX_SCALE = 100;

const num = (v: unknown, lo: number, hi: number, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);

function seat(v: unknown): AssetSeat | undefined {
  const o = v as Partial<AssetSeat> | undefined;
  if (!o || typeof o !== 'object') return undefined;
  return { x: num(o.x, -1e4, 1e4), y: num(o.y, -1e4, 1e4), z: num(o.z, -1e4, 1e4), rotY: num(o.rotY, -100, 100) };
}

/** What a browser may change about an asset, kept in range. */
export function cleanAssetPatch(p: Partial<AssetInfo>): Partial<AssetInfo> {
  const out: Partial<AssetInfo> = {};
  if (typeof p.name === 'string' && p.name.trim()) out.name = p.name.trim().slice(0, 60);
  if (p.scale !== undefined) out.scale = num(p.scale, MIN_SCALE, MAX_SCALE, 1);
  if (p.solid !== undefined) out.solid = p.solid === true;
  if (Array.isArray(p.seats)) out.seats = p.seats.map(seat).filter((s): s is AssetSeat => !!s).slice(0, MAX_SEATS);
  if ('desk' in p) out.desk = p.desk ? seat(p.desk) : undefined;
  if ('screen' in p) {
    const s = p.screen as Partial<AssetScreen> | undefined;
    out.screen = s && typeof s === 'object' ? { ...seat(s)!, w: num(s.w, 0.05, 1e3, 1), h: num(s.h, 0.05, 1e3, 0.6) } : undefined;
  }
  return out;
}
