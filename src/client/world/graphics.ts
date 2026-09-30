import * as THREE from 'three';
import type { OutlineEffect } from 'three/examples/jsm/effects/OutlineEffect.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { Pass } from 'three/examples/jsm/postprocessing/Pass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

// How good the office looks, as picked in ⚙️ Settings, against how hard it works the machine.
//  - standard: the cartoon look as it always was, straight to the screen.
//  - high: softer shadows at more detail, a glow on what's bright (lamps, screens, the neon on the
//    roof), a touch more color and contrast, and a vignette round the edges.
//  - ultra: all that, and ambient occlusion: soft shadow where things meet (under desks, in corners).
// The frame is drawn with the cartoon outlines as always, then through the passes on its way to the screen.

export type Quality = 'standard' | 'high' | 'ultra';
export const QUALITIES: { id: Quality; label: string; about: string }[] = [
  { id: 'standard', label: 'Standard', about: 'The cartoon look, lightest on the machine' },
  { id: 'high', label: 'High', about: 'Softer shadows, glow on lights and screens, richer color' },
  { id: 'ultra', label: 'Ultra', about: 'High, plus soft shadows where things meet (ambient occlusion)' },
];

/** Draws the scene (outlines and all) into the composer's buffer. */
class OutlinedScenePass extends Pass {
  constructor(
    private effect: OutlineEffect,
    public scene: THREE.Scene,
    public camera: THREE.Camera,
  ) {
    super();
    this.needsSwap = false;
  }

  render(renderer: THREE.WebGLRenderer, _write: THREE.WebGLRenderTarget, read: THREE.WebGLRenderTarget) {
    renderer.setRenderTarget(this.renderToScreen ? null : read);
    renderer.clear();
    this.effect.render(this.scene, this.camera);
  }
}

/** A little more color and contrast, and a soft vignette. */
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    saturation: { value: 1.12 },
    contrast: { value: 0.18 },
    vignette: { value: 0.32 },
  },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float saturation, contrast, vignette;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      vec3 col = c.rgb;
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(l), col, saturation);
      vec3 s = clamp(col, 0.0, 1.0);
      col = mix(col, s * s * (3.0 - 2.0 * s), contrast);
      vec2 d = vUv - 0.5;
      col *= 1.0 - vignette * dot(d, d) * 1.6;
      gl_FragColor = vec4(col, c.a);
    }`,
};

export class Graphics {
  quality: Quality = 'standard';
  private composer: EffectComposer | null = null;
  private scenePass: OutlinedScenePass | null = null;
  private gtao: GTAOPass | null = null;
  private bloom: UnrealBloomPass | null = null;
  private size = new THREE.Vector2();

  constructor(
    private renderer: THREE.WebGLRenderer,
    private effect: OutlineEffect,
    private scene: THREE.Scene,
    private camera: THREE.PerspectiveCamera,
    private sun: THREE.DirectionalLight,
  ) {}

  set(q: Quality) {
    if (q === this.quality) return;
    this.quality = q;
    const soft = q !== 'standard';
    this.renderer.shadowMap.type = soft ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    const res = q === 'ultra' ? 4096 : q === 'high' ? 3072 : 2048;
    this.sun.shadow.mapSize.set(res, res);
    this.sun.shadow.radius = soft ? 3 : 1;
    this.sun.shadow.map?.dispose();
    this.sun.shadow.map = null;
    // Materials are compiled for a shadow type: they need doing again.
    this.scene.traverse((o) => {
      const m = (o as THREE.Mesh).material;
      if (m) for (const mat of Array.isArray(m) ? m : [m]) mat.needsUpdate = true;
    });
    this.teardown();
    if (soft) this.build();
  }

  /** Draws the frame. `plain` skips the passes (the drunk vision draws its own way). */
  render(plain = false) {
    if (!this.composer || plain) {
      this.effect.render(this.scene, this.camera);
      return;
    }
    this.renderer.getSize(this.size);
    const w = this.size.x;
    const h = this.size.y;
    const ratio = this.renderer.getPixelRatio();
    if (this.composer.renderTarget1.width !== Math.round(w * ratio) || this.composer.renderTarget1.height !== Math.round(h * ratio)) {
      this.composer.setPixelRatio(ratio);
      this.composer.setSize(w, h);
    }
    this.composer.render();
  }

  private build() {
    this.renderer.getSize(this.size);
    const target = new THREE.WebGLRenderTarget(this.size.x, this.size.y, { type: THREE.HalfFloatType, samples: 4 });
    const composer = new EffectComposer(this.renderer, target);
    composer.setPixelRatio(this.renderer.getPixelRatio());
    composer.setSize(this.size.x, this.size.y);
    this.scenePass = new OutlinedScenePass(this.effect, this.scene, this.camera);
    composer.addPass(this.scenePass);
    if (this.quality === 'ultra') {
      this.gtao = new GTAOPass(this.scene, this.camera, this.size.x, this.size.y);
      this.gtao.output = GTAOPass.OUTPUT.Default;
      this.gtao.blendIntensity = 0.75;
      this.gtao.updateGtaoMaterial({ radius: 0.6, distanceExponent: 1.4, thickness: 1, scale: 1 });
      composer.addPass(this.gtao);
    }
    // Only what's properly bright glows: the cartoon walls are near white, and mustn't.
    this.bloom = new UnrealBloomPass(new THREE.Vector2(this.size.x, this.size.y), 0.32, 0.45, 1.05);
    composer.addPass(this.bloom);
    composer.addPass(new ShaderPass(GradeShader));
    composer.addPass(new OutputPass());
    this.composer = composer;
  }

  private teardown() {
    this.gtao?.dispose();
    this.bloom?.dispose();
    this.composer?.dispose();
    this.composer?.renderTarget1.dispose();
    this.composer?.renderTarget2.dispose();
    this.composer = null;
    this.scenePass = null;
    this.gtao = null;
    this.bloom = null;
  }
}
