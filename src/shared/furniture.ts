// What people add to a floor in build mode (walls to make offices, furniture, plants…), and where
// they've moved its desks to. The server keeps each floor's in its furniture.json; every browser on
// the floor builds it (see client/world/furniture.ts). Shared so both sides agree on sizes and limits.

import { DESKS, FLOOR, LOT, RECEPTION } from './layout.js';

export type FurnitureKind = 'wall' | 'glass' | 'divider' | 'door' | 'plant' | 'couch' | 'armchair' | 'table' | 'lamp' | 'rug' | 'cooler' | 'bookcase' | 'filing' | 'sign' | 'asset';

export interface FurnitureDef {
  kind: FurnitureKind;
  label: string;
  emoji: string;
  /** Its footprint, width along its own x and depth along z, and height, in meters. */
  w: number;
  d: number;
  h: number;
  /** Its width can be stretched (walls and dividers run as long as you like). */
  stretch?: boolean;
  /** It comes in colors. */
  colored?: boolean;
  color: string;
  /** People walk through it (a rug, a doorway). */
  walkThrough?: boolean;
  /** Shown in this group of the build palette (your own models are listed from the library instead). */
  group: 'Walls' | 'Furniture' | 'Decor' | 'Mine';
}

export const FURNITURE: Record<FurnitureKind, FurnitureDef> = {
  wall: { kind: 'wall', label: 'Wall', emoji: '🧱', w: 3, d: 0.14, h: 2.8, stretch: true, colored: true, color: '#fffaf3', group: 'Walls' },
  glass: { kind: 'glass', label: 'Glass wall', emoji: '🪟', w: 3, d: 0.1, h: 2.6, stretch: true, colored: true, color: '#2b2d42', group: 'Walls' },
  divider: { kind: 'divider', label: 'Low divider', emoji: '▭', w: 2.4, d: 0.12, h: 1.4, stretch: true, colored: true, color: '#8ecae6', group: 'Walls' },
  door: { kind: 'door', label: 'Doorway', emoji: '🚪', w: 1.2, d: 0.14, h: 2.8, colored: true, color: '#fffaf3', walkThrough: true, group: 'Walls' },
  couch: { kind: 'couch', label: 'Couch', emoji: '🛋️', w: 2.1, d: 0.9, h: 0.85, colored: true, color: '#577590', group: 'Furniture' },
  armchair: { kind: 'armchair', label: 'Armchair', emoji: '💺', w: 0.95, d: 0.9, h: 0.85, colored: true, color: '#e76f51', group: 'Furniture' },
  table: { kind: 'table', label: 'Round table', emoji: '🪑', w: 1.3, d: 1.3, h: 0.75, colored: true, color: '#c98b5a', group: 'Furniture' },
  bookcase: { kind: 'bookcase', label: 'Bookcase', emoji: '📚', w: 1.6, d: 0.42, h: 2.1, colored: true, color: '#c98b5a', group: 'Furniture' },
  filing: { kind: 'filing', label: 'Filing cabinet', emoji: '🗄️', w: 0.55, d: 0.65, h: 1.3, colored: true, color: '#8d99ae', group: 'Furniture' },
  cooler: { kind: 'cooler', label: 'Water cooler', emoji: '🚰', w: 0.45, d: 0.45, h: 1.35, group: 'Furniture', color: '#fffaf3' },
  plant: { kind: 'plant', label: 'Plant', emoji: '🪴', w: 0.7, d: 0.7, h: 1.3, group: 'Decor', color: '#e76f51', colored: true },
  lamp: { kind: 'lamp', label: 'Floor lamp', emoji: '💡', w: 0.45, d: 0.45, h: 1.8, colored: true, color: '#ffd166', group: 'Decor' },
  rug: { kind: 'rug', label: 'Rug', emoji: '🟫', w: 3, d: 2, h: 0.02, stretch: true, colored: true, color: '#e9c46a', walkThrough: true, group: 'Decor' },
  sign: { kind: 'sign', label: 'Sign', emoji: '🪧', w: 1.2, d: 0.3, h: 2, colored: true, color: '#2b2d42', group: 'Decor' },
  // One of your own models from the library (shared/assets.ts): its size is its model's.
  asset: { kind: 'asset', label: 'Your model', emoji: '📦', w: 1, d: 1, h: 1, color: '#fffaf3', group: 'Mine' },
};

export const FURNITURE_KINDS = Object.keys(FURNITURE) as FurnitureKind[];

export const FURNITURE_COLORS = ['#fffaf3', '#2b2d42', '#8d99ae', '#c98b5a', '#577590', '#8ecae6', '#2a9d8f', '#06d6a0', '#ffd166', '#f4a261', '#e76f51', '#ef476f', '#9d4edd'];

/** What a browser sends to add or change something. */
export interface FurniturePlacement {
  kind: FurnitureKind;
  x: number;
  z: number;
  /** Turned this far around y (radians). */
  rotY: number;
  /** How wide a stretchable piece is (a wall's length), when it isn't its default. */
  length?: number;
  color?: string;
  /** A sign's words. */
  text?: string;
  /** Your own model: which one from the library, and how big (times its size as exported). */
  asset?: string;
  scale?: number;
  /** A model with a screen: the web page on it. */
  url?: string;
}

export interface FurnitureItem extends FurniturePlacement {
  id: string;
  by: string;
  at: number;
}

/** Where a desk (or the reception desk) was moved to on a floor. */
export interface DeskPlacement {
  x: number;
  z: number;
  rotY: number;
}

/** How a floor's floor looks (see FLOOR_STYLES); none is the office's wooden planks. */
export interface FloorStyle {
  style: FloorStyleKind;
  color?: string;
  /** A picture from the library, for `style: 'image'`, and how many meters one copy of it covers. */
  image?: string;
  tile?: number;
}

export type FloorStyleKind = 'planks' | 'tiles' | 'carpet' | 'concrete' | 'checker' | 'marble' | 'herringbone' | 'image';

export const FLOOR_STYLES: { style: FloorStyleKind; label: string; color: string }[] = [
  { style: 'planks', label: 'Wood planks', color: '#e7b98a' },
  { style: 'herringbone', label: 'Herringbone', color: '#c98b5a' },
  { style: 'tiles', label: 'Tiles', color: '#e9ecef' },
  { style: 'checker', label: 'Checkerboard', color: '#2b2d42' },
  { style: 'marble', label: 'Marble', color: '#f1f3f5' },
  { style: 'carpet', label: 'Carpet', color: '#577590' },
  { style: 'concrete', label: 'Polished concrete', color: '#adb5bd' },
  { style: 'image', label: 'Your picture', color: '#ffffff' },
];

export interface FurnitureState {
  items: FurnitureItem[];
  /** Desks moved from where the office puts them, by desk id. */
  desks: Record<string, DeskPlacement>;
  /** The floor's own flooring; none is the office's. */
  floor?: FloorStyle;
}

export function cleanFloorStyle(f: Partial<FloorStyle> | null | undefined): FloorStyle | undefined {
  if (!f || !FLOOR_STYLES.some((s) => s.style === f.style)) return undefined;
  const out: FloorStyle = { style: f.style as FloorStyleKind };
  if (typeof f.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(f.color)) out.color = f.color.toLowerCase();
  if (out.style === 'image') {
    if (typeof f.image !== 'string' || !/^[a-f0-9]{12}$/.test(f.image)) return undefined;
    out.image = f.image;
    out.tile = Number.isFinite(f.tile) ? Math.min(20, Math.max(0.25, f.tile as number)) : 2;
  }
  return out;
}

export const MAX_FURNITURE = 250;
export const MIN_LENGTH = 0.5;
export const MAX_LENGTH = 16;
/** The desks you can move: every desk and the reception desk (not the bean bags, kiosks or meeting chairs). */
export const MOVABLE_DESKS = new Set([...DESKS.map((d) => d.id), RECEPTION.id]);

const round = (n: number, step: number) => Math.round(n / step) * step;
export type Area = { minX: number; maxX: number; minZ: number; maxZ: number };

/** Keeps a spot inside the room (or `area`: the lot), a little in from its edges. */
export function clampToFloor(x: number, z: number, area: Area = FLOOR): { x: number; z: number } {
  return { x: Math.min(area.maxX - 0.2, Math.max(area.minX + 0.2, round(x, 0.05))), z: Math.min(area.maxZ - 0.2, Math.max(area.minZ + 0.2, round(z, 0.05))) };
}

/** The lot beside the building (see LOT). */
export const LOT_AREA: Area = LOT;

/** An angle in [0, 2π), to a hundredth of a radian. */
export function cleanAngle(a: number): number {
  const t = ((a % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  return Math.round(t * 100) / 100;
}

/** A placement with everything in range, or why it can't be one. */
export function cleanPlacement(p: Partial<FurniturePlacement>, area: Area = FLOOR): FurniturePlacement | string {
  const kind = p.kind as FurnitureKind;
  const def = FURNITURE[kind];
  if (!def) return 'Unknown piece of furniture';
  if (!Number.isFinite(p.x) || !Number.isFinite(p.z)) return 'Put it somewhere on the floor';
  const { x, z } = clampToFloor(p.x as number, p.z as number, area);
  const out: FurniturePlacement = { kind, x, z, rotY: cleanAngle(Number.isFinite(p.rotY) ? (p.rotY as number) : 0) };
  if (def.stretch && Number.isFinite(p.length)) out.length = Math.round(Math.min(MAX_LENGTH, Math.max(MIN_LENGTH, p.length as number)) * 20) / 20;
  if (def.colored && typeof p.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(p.color)) out.color = p.color.toLowerCase();
  if (kind === 'sign') out.text = typeof p.text === 'string' && p.text.trim() ? p.text.trim().slice(0, 40) : 'Office';
  if (kind === 'asset') {
    if (typeof p.asset !== 'string' || !/^[a-f0-9]{12}$/.test(p.asset)) return 'Pick one of your models';
    out.asset = p.asset;
    out.scale = Number.isFinite(p.scale) ? Math.round(Math.min(100, Math.max(0.02, p.scale as number)) * 1000) / 1000 : 1;
    if (typeof p.url === 'string' && /^https?:\/\/\S+$/i.test(p.url.trim())) out.url = p.url.trim().slice(0, 2000);
  }
  return out;
}

/** How wide the piece is: its length if it's been stretched, else its kind's width. */
export function widthOf(p: Pick<FurniturePlacement, 'kind' | 'length'>): number {
  return p.length ?? FURNITURE[p.kind].w;
}

export interface Box2 {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/**
 * The floor it covers, as axis-aligned boxes (what collisions work with): one box when it's square
 * to the room, else a run of small boxes along its length, so a wall at an angle doesn't block the
 * whole square around it.
 */
export function footprint(p: Pick<FurniturePlacement, 'kind' | 'x' | 'z' | 'rotY' | 'length'>, pad = 0): Box2[] {
  const w = widthOf(p) + pad * 2;
  const d = FURNITURE[p.kind].d + pad * 2;
  const c = Math.cos(p.rotY);
  const s = Math.sin(p.rotY);
  const square = Math.abs(c) < 1e-3 || Math.abs(s) < 1e-3;
  // Along its width in steps no longer than its depth (or 0.3 m), unless it's square to the room.
  const long = w >= d;
  const along = long ? w : d;
  const across = long ? d : w;
  const n = square ? 1 : Math.max(1, Math.ceil(along / Math.max(0.3, across)));
  const boxes: Box2[] = [];
  for (let i = 0; i < n; i++) {
    const t0 = -along / 2 + (i * along) / n;
    const t1 = t0 + along / n;
    const corners = [t0, t1].flatMap((t) =>
      [-across / 2, across / 2].map((u) => {
        const lx = long ? t : u;
        const lz = long ? u : t;
        return [p.x + lx * c + lz * s, p.z - lx * s + lz * c];
      }),
    );
    const xs = corners.map(([x]) => x);
    const zs = corners.map(([, z]) => z);
    boxes.push({ minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) });
  }
  return boxes;
}
