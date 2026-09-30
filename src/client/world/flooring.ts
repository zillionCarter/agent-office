import * as THREE from 'three';
import { FLOOR_PALETTES, type FloorPalette } from '../../shared/floors';
import { FLOOR_STYLES, type FloorStyle } from '../../shared/furniture';

// Painting floors onto a canvas: the office's planks in a floor's colors, and the floors laid in
// build mode (see shared/furniture.ts FLOOR_STYLES), in a room or out on the lot.

/** Chunky planks in a floor's colors. */
export function paintPlanks(c: HTMLCanvasElement, p: FloorPalette) {
  const g = c.getContext('2d')!;
  g.fillStyle = p.floor;
  g.fillRect(0, 0, 512, 512);
  for (let row = 0; row < 8; row++) {
    const offset = (row % 2) * 128;
    for (let col = -1; col < 3; col++) {
      const x = col * 256 + offset;
      g.fillStyle = (row + col) % 3 === 0 ? p.floorAlt : p.floor;
      g.fillRect(x + 2, row * 64 + 2, 252, 60);
    }
    g.fillStyle = p.seam;
    g.fillRect(0, row * 64, 512, 3);
  }
}

/**
 * A floor laid in build mode (see shared/furniture.ts FLOOR_STYLES), painted on the same 512 px canvas
 * as the planks, which covers 6 m of the room each way. `image` is your own picture, for 'image'.
 */
export function paintFlooring(c: HTMLCanvasElement, f: FloorStyle, image?: HTMLImageElement) {
  const g = c.getContext('2d')!;
  const base = new THREE.Color(f.color ?? FLOOR_STYLES.find((s) => s.style === f.style)!.color);
  const tone = (k: number) => `#${base.clone().multiplyScalar(k).getHexString()}`;
  const mix = (to: string, k: number) => `#${base.clone().lerp(new THREE.Color(to), k).getHexString()}`;
  // The same speckles every time, so every browser paints the same floor.
  let seed = 1;
  const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  g.fillStyle = tone(1);
  g.fillRect(0, 0, 512, 512);
  switch (f.style) {
    case 'planks':
      paintPlanks(c, { ...FLOOR_PALETTES[0], floor: tone(1), floorAlt: tone(0.92), seam: tone(0.72) });
      break;
    case 'herringbone': {
      const w = 32;
      const l = 128;
      for (let row = -2; row < 12; row++) {
        for (let col = -2; col < 12; col++) {
          const x = col * w * 2 + row * w;
          const y = row * w * 2 - col * 0;
          g.fillStyle = (row + col) % 2 ? tone(1) : tone(0.9);
          g.save();
          g.translate(x, y);
          g.rotate(Math.PI / 4);
          g.fillRect(0, 0, l, w - 3);
          g.restore();
          g.save();
          g.translate(x + w * 0.7, y + w * 0.7);
          g.rotate(-Math.PI / 4);
          g.fillStyle = (row + col) % 2 ? tone(0.94) : tone(0.86);
          g.fillRect(0, 0, l, w - 3);
          g.restore();
        }
      }
      break;
    }
    case 'tiles':
      g.fillStyle = tone(0.8);
      for (let i = 0; i <= 4; i++) {
        g.fillRect(i * 128 - 2, 0, 4, 512);
        g.fillRect(0, i * 128 - 2, 512, 4);
      }
      break;
    case 'checker':
      for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) {
        g.fillStyle = (i + j) % 2 ? tone(1) : mix('#ffffff', 0.9);
        g.fillRect(i * 64, j * 64, 64, 64);
      }
      break;
    case 'marble': {
      g.strokeStyle = tone(0.8);
      g.globalAlpha = 0.5;
      for (let v = 0; v < 14; v++) {
        g.lineWidth = 1 + rand() * 2.5;
        g.beginPath();
        let x = rand() * 512;
        let y = 0;
        g.moveTo(x, y);
        while (y < 512) {
          x += (rand() - 0.5) * 40;
          y += 20 + rand() * 20;
          g.lineTo(x, y);
        }
        g.stroke();
      }
      g.globalAlpha = 1;
      g.fillStyle = tone(0.88);
      for (let i = 0; i <= 2; i++) {
        g.fillRect(i * 256 - 1, 0, 2, 512);
        g.fillRect(0, i * 256 - 1, 512, 2);
      }
      break;
    }
    case 'carpet':
      for (let i = 0; i < 9000; i++) {
        g.fillStyle = rand() < 0.5 ? tone(0.9) : tone(1.08);
        g.fillRect(rand() * 512, rand() * 512, 2, 2);
      }
      break;
    case 'concrete':
      for (let i = 0; i < 260; i++) {
        g.globalAlpha = 0.06 + rand() * 0.06;
        g.fillStyle = rand() < 0.5 ? tone(0.85) : tone(1.1);
        g.beginPath();
        g.arc(rand() * 512, rand() * 512, 10 + rand() * 40, 0, Math.PI * 2);
        g.fill();
      }
      g.globalAlpha = 1;
      g.fillStyle = tone(0.8);
      g.fillRect(0, 255, 512, 2);
      g.fillRect(255, 0, 2, 512);
      break;
    case 'image':
      if (image && image.width) {
        // The canvas covers 6 m; one copy of the picture covers `tile` meters.
        const n = Math.max(1, Math.round(6 / (f.tile ?? 2)));
        const s = 512 / n;
        for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) g.drawImage(image, i * s, j * s, s, s);
      }
      break;
  }
}
