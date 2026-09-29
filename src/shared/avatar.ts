// What a person looks like in the office, picked on the character select screen.
// Server and client share these lists so a look is just a few small indexes on the wire.
// New entries only ever go on the end of a list, so looks saved before still mean the same thing.

export const SKIN_TONES = ['#ffe3cc', '#ffd7b5', '#f1c27d', '#e0ac69', '#c68642', '#a0663a', '#8d5524', '#5c3a21', '#9bd4ff', '#a7e3a0', '#c9b6ff'];
export const HAIR_COLORS = ['#2b2d42', '#4a3222', '#6f4e37', '#e9c46a', '#c1440e', '#d9d9d9', '#d62828', '#ff8fab', '#9d4edd', '#264653', '#3a86ff', '#2a9d8f', '#fffdf5'];
export const HAIR_COLOR_NAMES = ['Black', 'Dark brown', 'Brown', 'Blonde', 'Ginger', 'Silver', 'Red', 'Pink', 'Purple', 'Teal', 'Blue', 'Green', 'White'];
export const HAIR_STYLES = ['Short', 'Long', 'Bun', 'Spiky', 'Curly', 'Ponytail', 'Bald', 'Mohawk', 'Afro', 'Bob', 'Pigtails', 'Buzz'];
export const PANTS_COLORS = ['#3d405b', '#1d3557', '#2b2d42', '#6c584c', '#8d99ae', '#588157', '#b5838d', '#e9edc9', '#9a031e', '#f4a261'];
export const PANTS_COLOR_NAMES = ['Navy', 'Denim', 'Charcoal', 'Brown', 'Grey', 'Olive', 'Mauve', 'Cream', 'Burgundy', 'Orange'];
export const EYE_STYLES = ['Dots', 'Big', 'Happy', 'Sleepy', 'Wink'];
export const HATS = ['None', 'Cap', 'Beanie', 'Headphones', 'Top hat', 'Crown', 'Bandana'];
export const GLASSES = ['None', 'Round', 'Square', 'Sunglasses', 'Monocle'];
export const BEARDS = ['None', 'Stubble', 'Mustache', 'Goatee', 'Full beard'];
/** The accessory colors a hat (or bandana) comes in. */
export const HAT_COLORS = ['#ef476f', '#4f86f7', '#06d6a0', '#ffd166', '#2b2d42', '#f77f00', '#9d4edd', '#fffaf3'];

export interface Look {
  skin: number;
  hair: number;
  style: number;
  pants: number;
  eyes: number;
  hat: number;
  hatColor: number;
  glasses: number;
  beard: number;
}

/** The parts of a look beyond the first three, as their list lengths (for sanitizing and picking at random). */
const EXTRA: [keyof Look, number][] = [
  ['pants', PANTS_COLORS.length],
  ['eyes', EYE_STYLES.length],
  ['hat', HATS.length],
  ['hatColor', HAT_COLORS.length],
  ['glasses', GLASSES.length],
  ['beard', BEARDS.length],
];

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** A look picked from a seed, for people who haven't chosen one. */
export function lookFromSeed(seed: string): Look {
  const h = hash(seed);
  // Only the original tones, colors and styles, and plain accessories: nobody picked this look.
  return { skin: h % 8, hair: (h >>> 3) % 10, style: (h >>> 7) % 7, pants: (h >>> 11) % PANTS_COLORS.length, eyes: 0, hat: 0, hatColor: (h >>> 15) % HAT_COLORS.length, glasses: 0, beard: 0 };
}

export function randomLook(): Look {
  const pick = (n: number) => Math.floor(Math.random() * n);
  // Accessories turn up now and then rather than on everyone.
  const sometimes = (n: number) => (Math.random() < 0.35 ? pick(n) : 0);
  return {
    skin: pick(SKIN_TONES.length),
    hair: pick(HAIR_COLORS.length),
    style: pick(HAIR_STYLES.length),
    pants: pick(PANTS_COLORS.length),
    eyes: pick(EYE_STYLES.length),
    hat: sometimes(HATS.length),
    hatColor: pick(HAT_COLORS.length),
    glasses: sometimes(GLASSES.length),
    beard: sometimes(BEARDS.length),
  };
}

/** Coerces anything into a valid look, keeping each part of `fallback` that `x` gets wrong. */
export function sanitizeLook(x: unknown, fallback: Look): Look {
  const o = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>;
  const idx = (v: unknown, n: number, d: number) => (Number.isInteger(v) && (v as number) >= 0 && (v as number) < n ? (v as number) : d);
  return {
    skin: idx(o.skin, SKIN_TONES.length, fallback.skin),
    hair: idx(o.hair, HAIR_COLORS.length, fallback.hair),
    style: idx(o.style, HAIR_STYLES.length, fallback.style),
    // A look saved before these existed doesn't have them: it stays plain rather than taking the fallback's.
    pants: idx(o.pants, PANTS_COLORS.length, 'pants' in o ? fallback.pants : 0),
    eyes: idx(o.eyes, EYE_STYLES.length, 'eyes' in o ? fallback.eyes : 0),
    hat: idx(o.hat, HATS.length, 'hat' in o ? fallback.hat : 0),
    hatColor: idx(o.hatColor, HAT_COLORS.length, fallback.hatColor),
    glasses: idx(o.glasses, GLASSES.length, 'glasses' in o ? fallback.glasses : 0),
    beard: idx(o.beard, BEARDS.length, 'beard' in o ? fallback.beard : 0),
  };
}

export function sameLook(a: Look, b: Look): boolean {
  return a.skin === b.skin && a.hair === b.hair && a.style === b.style && EXTRA.every(([k]) => a[k] === b[k]);
}

/** Every part of a look as `key=index` pairs, for the connect URL. */
export function lookParams(look: Look): Record<string, string> {
  return Object.fromEntries((['skin', 'hair', 'style', ...EXTRA.map(([k]) => k)] as (keyof Look)[]).map((k) => [k, String(look[k])]));
}

/** The keys of a look, for reading one back out of the connect URL. */
export const LOOK_KEYS: (keyof Look)[] = ['skin', 'hair', 'style', ...EXTRA.map(([k]) => k)];
