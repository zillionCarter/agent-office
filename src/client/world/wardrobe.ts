import * as THREE from 'three';
import { BEARDS, EYE_STYLES, GLASSES, HATS, HAT_COLORS, type Look } from '../../shared/avatar';
import { mesh, toon } from './toon';

// The parts of a person picked on the character screen beyond skin and hair: the eyes, a hat,
// glasses and a beard. Each is built on the head, whose center is 0,0,0 (radius 0.34), with the face
// looking down +z. The character's own left is +x.

const INK = '#1d1d1d';
/** Hair styles that stick up far enough to poke through a hat's crown. */
export const TALL_HAIR = new Set(['Spiky', 'Bun', 'Curly', 'Mohawk', 'Afro', 'Pigtails']);
/** Hats that cover the crown, so tall hair hides under them. */
export const CROWN_HATS = new Set(['Cap', 'Beanie', 'Top hat']);

/** The eyes, where the office always drew two dots. */
export function buildEyes(look: Look): THREE.Group {
  const g = new THREE.Group();
  const ink = toon(INK);
  const dot = (sx: number) => g.add(mesh(new THREE.SphereGeometry(0.055, 10, 8), ink, sx * 0.12, 0.02, 0.3, false));
  const arc = (sx: number) => {
    // ∩: a closed, smiling eye.
    const a = mesh(new THREE.TorusGeometry(0.05, 0.014, 6, 12, Math.PI), ink, sx * 0.12, 0.0, 0.31, false);
    g.add(a);
  };
  switch (EYE_STYLES[look.eyes]) {
    case 'Big':
      for (const sx of [-1, 1]) {
        const white = mesh(new THREE.SphereGeometry(0.085, 14, 10), toon('#ffffff'), sx * 0.12, 0.03, 0.285, false);
        white.scale.z = 0.55;
        g.add(white);
        g.add(mesh(new THREE.SphereGeometry(0.052, 12, 10), ink, sx * 0.12, 0.02, 0.325, false));
        g.add(mesh(new THREE.SphereGeometry(0.016, 8, 6), toon('#ffffff'), sx * 0.12 + 0.02, 0.045, 0.37, false));
      }
      break;
    case 'Happy':
      arc(-1);
      arc(1);
      break;
    case 'Sleepy':
      for (const sx of [-1, 1]) {
        const line = mesh(new THREE.CapsuleGeometry(0.016, 0.07, 4, 8), ink, sx * 0.12, 0.0, 0.312, false);
        line.rotation.z = Math.PI / 2;
        g.add(line);
      }
      break;
    case 'Wink':
      dot(-1);
      arc(1);
      break;
    default:
      dot(-1);
      dot(1);
  }
  return g;
}

/** A thin bar from `a` to `b`. */
function bar(a: THREE.Vector3, b: THREE.Vector3, thick: number, mat: THREE.Material): THREE.Mesh {
  const len = a.distanceTo(b);
  const m = mesh(new THREE.BoxGeometry(thick, thick, len), mat, (a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2, false);
  m.lookAt(m.position.clone().add(b.clone().sub(a)));
  return m;
}

export function buildGlasses(look: Look): THREE.Group | null {
  const kind = GLASSES[look.glasses];
  if (kind === 'None' || !kind) return null;
  const g = new THREE.Group();
  const frame = toon(kind === 'Sunglasses' ? '#111111' : '#3a3a3a');
  const y = 0.02;
  const z = 0.335;
  const v = (x: number, yy: number, zz: number) => new THREE.Vector3(x, yy, zz);
  if (kind === 'Monocle') {
    // On the character's right eye (-x), with a chain hanging off it.
    g.add(mesh(new THREE.TorusGeometry(0.075, 0.012, 8, 24), toon('#d4a017'), -0.12, y, z, false));
    g.add(bar(v(-0.19, y - 0.03, z - 0.01), v(-0.24, y - 0.3, z - 0.1), 0.01, toon('#d4a017')));
    return g;
  }
  for (const sx of [-1, 1]) {
    const cx = sx * 0.12;
    if (kind === 'Round') g.add(mesh(new THREE.TorusGeometry(0.075, 0.012, 8, 24), frame, cx, y, z, false));
    else {
      const w = 0.085;
      const hh = kind === 'Sunglasses' ? 0.06 : 0.06;
      const t = kind === 'Sunglasses' ? 0.02 : 0.014;
      g.add(bar(v(cx - w, y + hh, z), v(cx + w, y + hh, z), t, frame));
      g.add(bar(v(cx - w, y - hh, z), v(cx + w, y - hh, z), t, frame));
      g.add(bar(v(cx - w, y - hh, z), v(cx - w, y + hh, z), t, frame));
      g.add(bar(v(cx + w, y - hh, z), v(cx + w, y + hh, z), t, frame));
      if (kind === 'Sunglasses') {
        const lens = mesh(new THREE.BoxGeometry(w * 2, hh * 2, 0.008), toon('#1b1f3b', { emissive: '#0b0d1a' }), cx, y, z, false);
        g.add(lens);
      }
    }
    // The arm, from the lens's outer edge back over the ear.
    g.add(bar(v(sx * 0.2, y, z - 0.02), v(sx * 0.335, y, 0.0), 0.014, frame));
  }
  // The bridge over the nose.
  g.add(bar(v(-0.045, y + 0.01, z + 0.005), v(0.045, y + 0.01, z + 0.005), 0.014, frame));
  return g;
}

export function buildBeard(look: Look, hair: THREE.Material): THREE.Group | null {
  const kind = BEARDS[look.beard];
  if (kind === 'None' || !kind) return null;
  const g = new THREE.Group();
  const front = (phi: number) => [Math.PI / 2 - phi / 2, phi] as const;
  const mustache = () => {
    for (const sx of [-1, 1]) {
      const m = mesh(new THREE.CapsuleGeometry(0.028, 0.08, 4, 8), hair, sx * 0.055, -0.045, 0.325, false);
      m.rotation.z = Math.PI / 2 + sx * 0.35;
      g.add(m);
    }
  };
  switch (kind) {
    case 'Stubble': {
      const [ps, pl] = front(2.0);
      const s = mesh(new THREE.SphereGeometry(0.343, 20, 12, ps, pl, Math.PI * 0.6, Math.PI * 0.22), toon('#000000', { transparent: true, opacity: 0.18 }), 0, 0, 0, false);
      g.add(s);
      break;
    }
    case 'Mustache':
      mustache();
      break;
    case 'Goatee':
      mustache();
      g.add(mesh(new THREE.ConeGeometry(0.06, 0.13, 10).rotateX(Math.PI), hair, 0, -0.25, 0.25, false));
      break;
    case 'Full beard': {
      // Round the jaw from cheek to cheek, from under the mouth down to the chin.
      const [ps, pl] = front(2.0);
      g.add(mesh(new THREE.SphereGeometry(0.352, 20, 12, ps, pl, Math.PI * 0.6, Math.PI * 0.22), hair, 0, 0, 0.012));
      mustache();
      break;
    }
  }
  return g;
}

export function buildHat(look: Look): THREE.Group | null {
  const kind = HATS[look.hat];
  if (kind === 'None' || !kind) return null;
  const g = new THREE.Group();
  const main = toon(HAT_COLORS[look.hatColor]);
  switch (kind) {
    case 'Cap': {
      g.add(mesh(new THREE.SphereGeometry(0.37, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.5), main, 0, 0.04, -0.01));
      const brim = mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.025, 20), main, 0, 0.1, 0.33);
      brim.scale.z = 1.3;
      brim.rotation.x = 0.12;
      g.add(brim);
      g.add(mesh(new THREE.SphereGeometry(0.035, 8, 6), main, 0, 0.41, -0.01));
      break;
    }
    case 'Beanie': {
      g.add(mesh(new THREE.SphereGeometry(0.375, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.52), main, 0, 0.03, -0.01));
      const cuff = mesh(new THREE.TorusGeometry(0.355, 0.05, 8, 28), main, 0, 0.1, -0.01);
      cuff.rotation.x = Math.PI / 2;
      g.add(cuff);
      g.add(mesh(new THREE.SphereGeometry(0.08, 12, 10), toon('#fffaf3'), 0, 0.44, -0.01));
      break;
    }
    case 'Headphones': {
      const band = mesh(new THREE.TorusGeometry(0.37, 0.03, 8, 24, Math.PI), toon('#2b2d42'), 0, 0.0, 0);
      g.add(band);
      for (const sx of [-1, 1]) {
        const cup = mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.09, 18), main, sx * 0.36, 0.0, 0);
        cup.rotation.z = Math.PI / 2;
        g.add(cup);
      }
      break;
    }
    case 'Top hat': {
      const black = toon('#1d1d1d');
      g.add(mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.03, 28), black, 0, 0.27, 0));
      g.add(mesh(new THREE.CylinderGeometry(0.24, 0.25, 0.4, 24), black, 0, 0.48, 0));
      g.add(mesh(new THREE.CylinderGeometry(0.255, 0.255, 0.07, 24), main, 0, 0.33, 0));
      g.rotation.z = 0.08;
      break;
    }
    case 'Crown': {
      const gold = toon('#ffd166', { emissive: '#6b4f00' });
      g.add(mesh(new THREE.CylinderGeometry(0.24, 0.22, 0.12, 20, 1, true), gold, 0, 0.36, 0));
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        g.add(mesh(new THREE.ConeGeometry(0.05, 0.12, 8), gold, Math.sin(a) * 0.23, 0.47, Math.cos(a) * 0.23));
      }
      g.add(mesh(new THREE.SphereGeometry(0.035, 8, 6), main, 0, 0.36, 0.24, false));
      break;
    }
    case 'Bandana': {
      const band = mesh(new THREE.TorusGeometry(0.345, 0.045, 8, 28), main, 0, 0.14, -0.02);
      band.rotation.x = Math.PI / 2 - 0.25;
      g.add(band);
      for (const sx of [-1, 1]) {
        const tail = mesh(new THREE.ConeGeometry(0.05, 0.18, 8), main, sx * 0.05, 0.02, -0.4);
        tail.rotation.set(-1.1, 0, sx * 0.5);
        g.add(tail);
      }
      break;
    }
  }
  g.traverse((o) => ((o as THREE.Mesh).castShadow = true));
  return g;
}
