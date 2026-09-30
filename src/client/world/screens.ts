import * as THREE from 'three';
import { CSS3DObject, CSS3DRenderer } from 'three/examples/jsm/renderers/CSS3DRenderer.js';
import type { AssetInfo } from '../../shared/assets';
import type { FurnitureItem } from '../../shared/furniture';
import { placedSpot } from '../../shared/placed';
import type { Interactable } from './office';
import { textTexture } from './toon';

// The screens on your own models (a TV, a computer): each shows a web page. From across the room a
// screen shows which site is on it; walk up close with nothing in the way and the page itself is
// there, live (an iframe laid over the 3D view exactly where the screen is, so it's only shown when
// it can't be seen through a wall). E at it opens the page to use (see ui/browser.ts).

/** How wide the page is laid out, in CSS pixels, before it's shrunk onto the screen. */
const PAGE_PX = 1280;
/** How close you have to be for the live page to show. */
const LIVE_WITHIN = 7;

interface Screen {
  key: string;
  itemId: string;
  url?: string;
  plane: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  css: CSS3DObject;
  frame: HTMLIFrameElement;
  it: Interactable;
  center: THREE.Vector3;
  normal: THREE.Vector3;
  /** Showing the live page, and since when it's wanted the other way (see render). */
  live: boolean;
  since?: number;
}

export class ScreenLayer {
  readonly group = new THREE.Group();
  private css = new THREE.Scene();
  private renderer = new CSS3DRenderer();
  private screens = new Map<string, Screen>();
  private ray = new THREE.Raycaster();
  private toScreen = new THREE.Vector3();
  /** How high the ground the screens' models stand on is (the lot's is the street). */
  private base = 0;

  constructor(
    host: HTMLElement,
    private interactables: Interactable[],
    base = 0,
  ) {
    this.base = base;
    const el = this.renderer.domElement;
    el.classList.add('screen-layer');
    host.append(el);
  }

  private last: [FurnitureItem[], AssetInfo[]] = [[], []];

  /** The ground moved (the lot, seen from another floor): the screens go with it. */
  setBase(y: number) {
    if (y === this.base) return;
    this.base = y;
    this.apply(...this.last);
  }

  /** The screens on the floor's models, kept in step with its furniture and the library. */
  apply(items: FurnitureItem[], assets: AssetInfo[]) {
    this.last = [items, assets];
    const byId = new Map(assets.map((a) => [a.id, a]));
    const seen = new Set<string>();
    for (const it of items) {
      const a = it.asset ? byId.get(it.asset) : undefined;
      if (it.kind !== 'asset' || !a?.screen) continue;
      seen.add(it.id);
      const sc = a.screen;
      const k = it.scale ?? 1;
      const key = JSON.stringify([it.x, it.z, it.rotY, k, sc, it.url, this.base]);
      const had = this.screens.get(it.id);
      if (had?.key === key) continue;
      if (had) this.drop(it.id);
      const at = placedSpot(it, sc);
      const w = sc.w * k;
      const h = sc.h * k;
      const tilt = sc.tilt ?? 0;
      const turn = new THREE.Euler(tilt, at.rotY, 0, 'YXZ');
      const center = new THREE.Vector3(at.x, at.y + this.base, at.z);
      const normal = new THREE.Vector3(0, 0, 1).applyEuler(turn);
      // A little off the model's surface, so it's never inside it.
      center.addScaledVector(normal, 0.004);
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: this.cover(it.url), toneMapped: false }));
      plane.position.copy(center);
      plane.rotation.copy(turn);
      plane.userData.screenId = it.id;
      this.group.add(plane);
      const frame = document.createElement('iframe');
      frame.className = 'screen-frame';
      const pxH = Math.round((PAGE_PX * h) / w);
      frame.style.width = `${PAGE_PX}px`;
      frame.style.height = `${pxH}px`;
      frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms');
      frame.setAttribute('referrerpolicy', 'no-referrer');
      frame.tabIndex = -1;
      const css = new CSS3DObject(frame);
      css.position.copy(center);
      css.rotation.copy(turn);
      css.scale.setScalar(w / PAGE_PX);
      css.visible = false;
      this.css.add(css);
      const it2: Interactable = { kind: 'screen', screenId: it.id, x: at.x + normal.x * 0.8, z: at.z + normal.z * 0.8, radius: Math.max(1.6, w), ...(this.base ? { y: this.base } : {}) };
      plane.userData.interact = it2;
      this.interactables.push(it2);
      this.screens.set(it.id, { key, itemId: it.id, url: it.url, plane, css, frame, it: it2, center, normal, live: false });
    }
    for (const id of [...this.screens.keys()]) if (!seen.has(id)) this.drop(id);
  }

  /** Every frame: which live pages show (close by, facing you, nothing in the way), then lays them over the view. */
  render(camera: THREE.PerspectiveCamera, canvas: HTMLCanvasElement, occluders: THREE.Object3D[]) {
    try {
      this.draw(camera, canvas, occluders);
    } catch (err) {
      // A screen that can't be drawn this frame mustn't stop the office being drawn.
      console.warn('agent-office: a screen could not be drawn', err);
    }
  }

  private draw(camera: THREE.PerspectiveCamera, canvas: HTMLCanvasElement, occluders: THREE.Object3D[]) {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (this.renderer.domElement.style.width !== `${w}px` || this.renderer.domElement.style.height !== `${h}px`) this.renderer.setSize(w, h);
    let any = false;
    for (const s of this.screens.values()) {
      const dist = camera.position.distanceTo(s.center);
      this.toScreen.subVectors(camera.position, s.center);
      let live = !!s.url && dist < LIVE_WITHIN && this.toScreen.dot(s.normal) > 0;
      if (live) {
        // Anything between you and the screen (a wall, another model) hides the page.
        this.ray.set(camera.position, this.toScreen.clone().negate().normalize());
        this.ray.far = dist - 0.05;
        // Sprites (name tags) need the camera to be hit-tested, and don't hide anything anyway.
        this.ray.camera = camera;
        // Not the model the screen is on (its bezel, its stand), nor a name tag.
        const hit = this.ray.intersectObjects(occluders, true).find((x) => x.object !== s.plane && x.object.visible && !(x.object as THREE.Sprite).isSprite && x.object.userData.furnitureId !== s.itemId);
        if (hit) live = false;
      }
      // A moment either way before it changes, so a glancing look doesn't make it flicker.
      const now = performance.now();
      if (live !== s.live) {
        s.since ??= now;
        if (now - s.since < (live ? 120 : 400)) live = s.live;
        else {
          s.live = live;
          s.since = undefined;
        }
      } else s.since = undefined;
      if (live && !s.frame.src && s.url) s.frame.src = s.url;
      s.css.visible = live;
      s.frame.style.display = live ? 'block' : 'none';
      any ||= live;
    }
    this.renderer.domElement.style.visibility = any ? 'visible' : 'hidden';
    if (any) this.renderer.render(this.css, camera);
  }

  /** The screen's page, by the model's id. */
  url(itemId: string): string | undefined {
    return this.screens.get(itemId)?.url;
  }

  /** What a screen shows when its page isn't live: the site's name, and how to use it. */
  private cover(url?: string): THREE.Texture {
    let host = '';
    try {
      host = url ? new URL(url).host : '';
    } catch {
      // not a link
    }
    const { tex } = textTexture(host ? `🌐 ${host}` : '🖥️ Look here and press E to pick a page', { bg: '#11151f', color: '#e9ecef', size: 44 });
    return tex;
  }

  private drop(id: string) {
    const s = this.screens.get(id);
    if (!s) return;
    this.group.remove(s.plane);
    s.plane.geometry.dispose();
    s.plane.material.map?.dispose();
    s.plane.material.dispose();
    this.css.remove(s.css);
    s.frame.remove();
    const i = this.interactables.indexOf(s.it);
    if (i >= 0) this.interactables.splice(i, 1);
    this.screens.delete(id);
  }
}
