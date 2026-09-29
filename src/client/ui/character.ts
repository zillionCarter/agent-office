import * as THREE from 'three';
import { OutlineEffect } from 'three/examples/jsm/effects/OutlineEffect.js';
import { BEARDS, EYE_STYLES, GLASSES, HAIR_COLOR_NAMES, HAIR_COLORS, HAIR_STYLES, HATS, HAT_COLORS, PANTS_COLOR_NAMES, PANTS_COLORS, SKIN_TONES, randomLook, type Look } from '../../shared/avatar';
import { AVATAR_COLORS, saveProfile, store, type Profile } from '../state';
import { Person } from '../world/character';
import { toonUnique } from '../world/toon';
import { h, openModal } from './dom';

/** A turntable with your character on it, drawn with its own small renderer. */
class Preview {
  readonly person: Person;
  private renderer: THREE.WebGLRenderer;
  private effect: OutlineEffect;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(28, 1, 0.1, 20);
  private raf = 0;
  private resize: ResizeObserver;
  private yaw = 0.5;
  private dragging = false;
  private lastDrag = -Infinity;
  private hopT = -1;

  constructor(
    private canvas: HTMLCanvasElement,
    p: Profile,
  ) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.effect = new OutlineEffect(this.renderer, { defaultThickness: 0.0045, defaultColor: [0.17, 0.18, 0.26] });

    this.scene.add(new THREE.HemisphereLight('#fff5e6', '#c9a27a', 1.5));
    this.scene.add(new THREE.AmbientLight('#ffffff', 0.5));
    const sun = new THREE.DirectionalLight('#fff1d6', 2.2);
    sun.position.set(-3, 6, 5);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.bias = -0.0008;
    sun.shadow.normalBias = 0.02;
    Object.assign(sun.shadow.camera, { left: -2, right: 2, top: 2, bottom: -2, near: 0.5, far: 20 });
    this.scene.add(sun);
    const rug = new THREE.Mesh(new THREE.CircleGeometry(0.9, 40), toonUnique('#ffd6a5'));
    rug.rotation.x = -Math.PI / 2;
    rug.receiveShadow = true;
    rug.material.userData.outlineParameters = { visible: false };
    this.scene.add(rug);

    this.person = new Person(p.name, p.color, p.look);
    this.person.showLabel(false);
    this.scene.add(this.person.root);
    this.camera.position.set(0, 1.35, 4.6);
    this.camera.lookAt(0, 0.95, 0);

    this.resize = new ResizeObserver(() => this.fit());
    this.resize.observe(canvas);
    this.fit();

    canvas.addEventListener('pointerdown', (e) => {
      this.dragging = true;
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      this.yaw += e.movementX * 0.012;
      this.lastDrag = performance.now();
    });
    const release = () => {
      this.dragging = false;
      this.lastDrag = performance.now();
    };
    canvas.addEventListener('pointerup', release);
    canvas.addEventListener('pointercancel', release);

    let last = performance.now();
    const frame = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      this.tick(dt, now / 1000);
      this.raf = requestAnimationFrame(frame);
    };
    this.raf = requestAnimationFrame(frame);
  }

  /** A little hop and wave, to show a change landed. */
  cheer() {
    this.hopT = 0;
    this.person.reach();
  }

  private fit() {
    const w = this.canvas.clientWidth;
    const hgt = this.canvas.clientHeight;
    if (!w || !hgt) return;
    this.renderer.setSize(w, hgt, false);
    this.camera.aspect = w / hgt;
    this.camera.updateProjectionMatrix();
  }

  private tick(dt: number, t: number) {
    // Left alone, the character sways from side to side so you see the hair from every angle.
    if (!this.dragging && performance.now() - this.lastDrag > 1500) {
      const want = Math.sin(t * 0.6) * 1.1;
      this.yaw += (want - this.yaw) * Math.min(1, dt * 1.5);
    }
    this.person.root.rotation.y = this.yaw;
    let y = 0;
    if (this.hopT >= 0) {
      this.hopT += dt * 3.2;
      y = Math.sin(Math.min(1, this.hopT) * Math.PI) * 0.18;
      if (this.hopT >= 1) this.hopT = -1;
    }
    this.person.root.position.y = y;
    this.person.update(dt, t, false, y > 0.01);
    this.effect.render(this.scene, this.camera);
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.resize.disconnect();
    this.scene.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).geometry.dispose();
    });
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}

/**
 * The character select screen: your name, skin tone, hair and shirt, with a live preview.
 * `first` is the one you see when you join, which can't be skipped.
 */
export function openCharacter(first: boolean, onSave: (p: Profile) => void) {
  const pick: Profile = { ...store.profile, look: { ...store.profile.look } };
  const canvas = h('canvas', { 'aria-label': 'Your character, drag to spin' }) as HTMLCanvasElement;
  const preview = new Preview(canvas, pick);

  const input = h('input', { type: 'text', maxlength: 24, value: first ? '' : pick.name, placeholder: 'e.g. Ada', 'aria-label': 'Your name' }) as HTMLInputElement;
  if (first && pick.name !== 'Guest') input.value = pick.name;
  // Your account's name is the one everyone sees; only the look is yours to change here.
  const account = store.me.account;
  if (account) {
    input.value = account.name;
    input.readOnly = true;
    input.title = 'Your account name';
  }

  const skinRow = h('div.swatches', { role: 'radiogroup', 'aria-label': 'Skin tone' });
  const styleRow = h('div.seg', { role: 'radiogroup', 'aria-label': 'Hair style' });
  const hairRow = h('div.swatches', { role: 'radiogroup', 'aria-label': 'Hair color' });
  const shirtRow = h('div.swatches', { role: 'radiogroup', 'aria-label': 'Shirt color' });
  const pantsRow = h('div.swatches', { role: 'radiogroup', 'aria-label': 'Pants color' });
  const eyesRow = h('div.seg', { role: 'radiogroup', 'aria-label': 'Eyes' });
  const hatRow = h('div.seg', { role: 'radiogroup', 'aria-label': 'Hat' });
  const hatColorRow = h('div.swatches.hat-colors', { role: 'radiogroup', 'aria-label': 'Hat color' });
  const glassesRow = h('div.seg', { role: 'radiogroup', 'aria-label': 'Glasses' });
  const beardRow = h('div.seg', { role: 'radiogroup', 'aria-label': 'Facial hair' });
  // Any shirt color at all, besides the swatches.
  const shirtPicker = h('input.swatch.custom', { type: 'color', 'aria-label': 'Any shirt color', title: 'Pick any color' }) as HTMLInputElement;
  shirtPicker.addEventListener('input', () => change({}, shirtPicker.value));

  const swatch = (color: string, label: string, on: boolean, choose: () => void) =>
    h('button.swatch', { type: 'button', role: 'radio', 'aria-checked': String(on), style: `background:${color}`, class: on ? 'sel' : '', 'aria-label': label, title: label, onclick: choose });

  const change = (look: Partial<Look>, color?: string) => {
    Object.assign(pick.look, look);
    if (color) pick.color = color;
    preview.person.setLook(pick.look);
    preview.person.setColor(pick.color);
    preview.cheer();
    paint();
  };

  /** A row of named buttons, one of which is picked. */
  const seg = (row: HTMLElement, names: string[], on: number, choose: (i: number) => void) =>
    row.replaceChildren(...names.map((name, i) => h('button.btn', { type: 'button', role: 'radio', 'aria-checked': String(i === on), class: i === on ? 'on' : '', onclick: () => choose(i) }, name)));

  const paint = () => {
    const { skin, hair, style, pants, eyes, hat, hatColor, glasses, beard } = pick.look;
    seg(eyesRow, EYE_STYLES, eyes, (i) => change({ eyes: i }));
    seg(hatRow, HATS, hat, (i) => change({ hat: i }));
    hatColorRow.replaceChildren(...HAT_COLORS.map((c, i) => swatch(c, `Hat color ${i + 1}`, i === hatColor, () => change({ hatColor: i }))));
    hatColorRow.classList.toggle('hidden', HATS[hat] === 'None');
    seg(glassesRow, GLASSES, glasses, (i) => change({ glasses: i }));
    seg(beardRow, BEARDS, beard, (i) => change({ beard: i }));
    pantsRow.replaceChildren(...PANTS_COLORS.map((c, i) => swatch(c, PANTS_COLOR_NAMES[i], i === pants, () => change({ pants: i }))));
    skinRow.replaceChildren(...SKIN_TONES.map((c, i) => swatch(c, `Skin tone ${i + 1} of ${SKIN_TONES.length}`, i === skin, () => change({ skin: i }))));
    styleRow.replaceChildren(
      ...HAIR_STYLES.map((name, i) =>
        h('button.btn', { type: 'button', role: 'radio', 'aria-checked': String(i === style), class: i === style ? 'on' : '', onclick: () => change({ style: i }) }, name),
      ),
    );
    hairRow.replaceChildren(...HAIR_COLORS.map((c, i) => swatch(c, HAIR_COLOR_NAMES[i], i === hair, () => change({ hair: i }))));
    shirtRow.replaceChildren(...AVATAR_COLORS.map((c) => swatch(c, `Shirt ${c}`, c === pick.color, () => change({}, c))), shirtPicker);
    shirtPicker.value = pick.color;
    shirtPicker.classList.toggle('sel', !AVATAR_COLORS.includes(pick.color));
  };
  paint();

  const surprise = h('button.btn', { type: 'button', title: 'Random look' }, '🎲 Surprise me');
  surprise.addEventListener('click', () => change(randomLook(), AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)]));
  const save = h('button.btn.primary', { type: 'submit' }, first ? 'Enter the office 🚪' : 'Save');
  const close = first ? null : h('button.btn.close', { type: 'button', 'aria-label': 'Close' }, '✕');

  const form = h(
    'form.modal.charsel',
    { role: 'dialog', 'aria-label': 'Pick your character' },
    h('header', {}, h('h2', {}, first ? '👋 Pick your character' : '🧍 Your character'), close),
    h(
      'div.body',
      {},
      h('div.charsel-stage', {}, canvas, h('span.tip', {}, 'Drag to spin')),
      h(
        'div.charsel-opts',
        {},
        h('label', {}, 'Your name'),
        input,
        account ? h('p.setting-note', {}, `🔑 Signed in as ${account.name}, so that's your name here.`) : null,
        h('label', {}, 'Skin tone'),
        skinRow,
        h('label', {}, 'Hair'),
        styleRow,
        h('label', {}, 'Hair color'),
        hairRow,
        h('label', {}, 'Eyes'),
        eyesRow,
        h('label', {}, 'Facial hair'),
        beardRow,
        h('label', {}, 'Glasses'),
        glassesRow,
        h('label', {}, 'Hat'),
        hatRow,
        hatColorRow,
        h('label', {}, 'Shirt'),
        shirtRow,
        h('label', {}, 'Pants'),
        pantsRow,
      ),
    ),
    h('footer', {}, surprise, h('span.grow'), save),
  ) as HTMLFormElement;

  const modal = openModal(form, { escCloses: !first, backdropCloses: !first, doing: '🪞 picking a new look', onClose: () => preview.dispose() });
  close?.addEventListener('click', () => modal.close());
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = input.value.trim().slice(0, 24);
    if (!name) {
      input.focus();
      return;
    }
    store.profile = { name, color: pick.color, look: { ...pick.look } };
    saveProfile(store.profile);
    modal.close();
    onSave(store.profile);
  });
  if (!account) setTimeout(() => input.focus(), 30);
}
