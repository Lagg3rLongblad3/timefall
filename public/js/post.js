// Post-processing: the scene is drawn into a multisampled HDR target, a soft multi-level bloom is built from its bright parts,
// and one final pass adds the bloom, tone-maps (ACES), grades, vignettes and encodes to sRGB. No dependencies.
// Also owns the "render scale": the HDR target can be smaller than the canvas (a frame-time governor lowers it on slow GPUs).
import * as THREE from 'three';

const VERT = /* glsl */`varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }`;

// 13-tap downsample (Call of Duty: Advanced Warfare). The first pass also thresholds with a soft knee and clamps fireflies.
const DOWN = /* glsl */`
uniform sampler2D tSrc; uniform vec2 uTexel; uniform float uThr, uKnee, uFirst; varying vec2 vUv;
vec3 pre(vec3 c) {
  if (uFirst < .5) return c;
  c = min(c, vec3(12.));
  float l = max(c.r, max(c.g, c.b)), soft = clamp(l - uThr + uKnee, 0., 2. * uKnee); soft = soft * soft / (4. * uKnee + 1e-4);
  return c * max(soft, l - uThr) / max(l, 1e-4);
}
vec3 s(vec2 o) { return pre(texture2D(tSrc, vUv + o * uTexel).rgb); }
void main() {
  vec3 a = s(vec2(-2., 2.)), b = s(vec2(0., 2.)), c = s(vec2(2., 2.)), d = s(vec2(-2., 0.)), e = s(vec2(0., 0.)), f = s(vec2(2., 0.)), g = s(vec2(-2., -2.)), h = s(vec2(0., -2.)), i = s(vec2(2., -2.));
  vec3 j = s(vec2(-1., 1.)), k = s(vec2(1., 1.)), l = s(vec2(-1., -1.)), m = s(vec2(1., -1.));
  vec3 r = e * .125 + (a + c + g + i) * .03125 + (b + d + f + h) * .0625 + (j + k + l + m) * .125;
  gl_FragColor = vec4(r, 1.);
}`;

// 3x3 tent upsample, added onto the level above
const UP = /* glsl */`
uniform sampler2D tSrc; uniform vec2 uTexel; uniform float uRadius; varying vec2 vUv;
void main() {
  vec2 t = uTexel * uRadius;
  vec3 r = texture2D(tSrc, vUv + vec2(-t.x, t.y)).rgb + texture2D(tSrc, vUv + vec2(0., t.y)).rgb * 2. + texture2D(tSrc, vUv + t).rgb
         + texture2D(tSrc, vUv + vec2(-t.x, 0.)).rgb * 2. + texture2D(tSrc, vUv).rgb * 4. + texture2D(tSrc, vUv + vec2(t.x, 0.)).rgb * 2.
         + texture2D(tSrc, vUv - t).rgb + texture2D(tSrc, vUv + vec2(0., -t.y)).rgb * 2. + texture2D(tSrc, vUv + vec2(t.x, -t.y)).rgb;
  gl_FragColor = vec4(r / 16., 1.);
}`;

const COMPOSITE = /* glsl */`
uniform sampler2D tScene, tBloom; uniform float uExposure, uBloom, uVig, uSat, uContrast, uTime, uCA, uFlash; uniform vec3 uTint; varying vec2 vUv;
vec3 aces(vec3 c) { // the same fit three.js uses for ACESFilmicToneMapping
  const mat3 I = mat3(vec3(.59719, .07600, .02840), vec3(.35458, .90834, .13383), vec3(.04823, .01566, .83777));
  const mat3 O = mat3(vec3(1.60475, -.10208, -.00327), vec3(-.53108, 1.10813, -.07276), vec3(-.07367, -.00605, 1.07602));
  c = I * (c / .6);
  vec3 a = c * (c + .0245786) - .000090537, b = c * (.983729 * c + .4329510) + .238081;
  return clamp(O * (a / b), 0., 1.);
}
vec3 srgb(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1. / 2.4)) - .055, step(.0031308, c)); }
float hash(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(.06711056, .00583715)))); }
void main() {
  vec2 d = vUv - .5; float r2 = dot(d, d);
  vec3 col = vec3(texture2D(tScene, vUv + d * r2 * uCA).r, texture2D(tScene, vUv).g, texture2D(tScene, vUv - d * r2 * uCA).b);
  col += texture2D(tBloom, vUv).rgb * uBloom;
  col = srgb(aces(col * uExposure));
  float l = dot(col, vec3(.2126, .7152, .0722));
  col = mix(vec3(l), col, uSat); col = (col - .5) * uContrast + .5; col *= uTint;
  float v = smoothstep(.28, .92, length(d) * 1.45);
  col *= 1. - uVig * v; col = mix(col, vec3(.85, .05, .05), uFlash * v);
  col += (hash(gl_FragCoord.xy + uTime * 61.) - .5) / 200.;
  gl_FragColor = vec4(col, 1.);
}`;

export const GRADES = { // per sky kind: [bloom threshold, bloom strength, saturation, contrast, tint, vignette]
  day: [1.5, 0.14, 1.1, 1.04, [1.0, 1.0, 1.0], 0.22], dust: [1.6, 0.16, 1.08, 1.04, [1.03, 1.0, 0.94], 0.26], gloom: [1.5, 0.12, 0.92, 1.03, [0.98, 1.0, 1.02], 0.28],
  ash: [0.9, 0.42, 1.12, 1.1, [1.04, 0.98, 0.94], 0.34], space: [0.8, 0.5, 1.14, 1.08, [0.97, 1.0, 1.04], 0.32],
};

export class Post {
  constructor(renderer) {
    this.r = renderer; this.enabled = true; this.scale = 1; this.maxPixels = 3.4e6; this.samples = Math.min(4, renderer.capabilities.maxSamples || 0); this.levels = 5;
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    this.geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
    const mk = (frag, uniforms, extra = {}) => new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: frag, uniforms, depthTest: false, depthWrite: false, toneMapped: false, ...extra });
    this.down = mk(DOWN, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uThr: { value: 1.2 }, uKnee: { value: 0.6 }, uFirst: { value: 0 } });
    this.up = mk(UP, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uRadius: { value: 1 } }, { blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor });
    this.comp = mk(COMPOSITE, { tScene: { value: null }, tBloom: { value: null }, uExposure: { value: 1 }, uBloom: { value: 0.2 }, uVig: { value: 0.25 }, uSat: { value: 1.08 }, uContrast: { value: 1.04 }, uTime: { value: 0 }, uCA: { value: 0.012 }, uFlash: { value: 0 }, uTint: { value: new THREE.Vector3(1, 1, 1) } });
    this.quad = new THREE.Mesh(this.geo, this.down); this.quad.frustumCulled = false;
    this.scene = new THREE.Scene(); this.scene.add(this.quad);
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.rt = null; this.mips = [];
    this.w = this.h = 0;
  }
  // `w`,`h` = the canvas drawing-buffer size in device pixels
  setSize(w, h) {
    this.w = w; this.h = h; this.build();
  }
  rebuild() { this.dispose(false); this.build(); }
  setScale(s) { s = Math.max(0.5, Math.min(1, s)); if (Math.abs(s - this.scale) > 0.001) { this.scale = s; this.build(); } }
  get renderScale() { // effective fraction of the canvas resolution actually rendered
    const cap = Math.min(1, Math.sqrt(this.maxPixels / Math.max(1, this.w * this.h)));
    return Math.min(this.scale, cap);
  }
  build() {
    const k = this.renderScale, W = Math.max(2, Math.round(this.w * k)), H = Math.max(2, Math.round(this.h * k));
    if (this.rt && this.rt.width === W && this.rt.height === H) return;
    this.dispose(false);
    this.rt = new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType, format: THREE.RGBAFormat, samples: this.samples, depthBuffer: true, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
    const n = Math.max(3, Math.min(this.levels, Math.floor(Math.log2(Math.min(W, H))) - 4));
    let bw = W, bh = H;
    for (let i = 0; i < n; i++) { bw = Math.max(2, bw >> 1); bh = Math.max(2, bh >> 1); this.mips.push(new THREE.WebGLRenderTarget(bw, bh, { type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter })); }
  }
  dispose(all = true) {
    this.rt?.dispose(); for (const m of this.mips) m.dispose(); this.rt = null; this.mips = [];
    if (all) { this.geo.dispose(); this.down.dispose(); this.up.dispose(); this.comp.dispose(); }
  }
  pass(mat, target) { this.quad.material = mat; this.r.setRenderTarget(target); this.r.render(this.scene, this.cam); }

  // look = the world's atmosphere (gfx.js); flash = 0..1 damage tint
  render(scene, camera, look, time = 0, flash = 0) {
    const r = this.r, info = r.info, ac = r.autoClear;
    if (!this.rt) this.build();
    info.reset();
    const prev = info.autoReset; info.autoReset = false;
    r.setRenderTarget(this.rt); r.render(scene, camera);
    const g = GRADES[look?.grade || look?.kind] || GRADES.day, [thr, strength, sat, contrast, tint, vig] = g, bl = look?.bloom ?? 1;
    r.autoClear = false;
    // bloom: threshold + downsample chain, then tent-upsample back up, adding each level into the one above
    const D = this.down.uniforms, mips = this.mips;
    D.uThr.value = thr; D.uKnee.value = thr * 0.5;
    let src = this.rt.texture, sw = this.rt.width, sh = this.rt.height;
    for (let i = 0; i < mips.length; i++) {
      D.tSrc.value = src; D.uTexel.value.set(1 / sw, 1 / sh); D.uFirst.value = i === 0 ? 1 : 0;
      this.pass(this.down, mips[i]); src = mips[i].texture; sw = mips[i].width; sh = mips[i].height;
    }
    const U = this.up.uniforms; U.uRadius.value = 1;
    for (let i = mips.length - 1; i > 0; i--) { U.tSrc.value = mips[i].texture; U.uTexel.value.set(1 / mips[i].width, 1 / mips[i].height); this.pass(this.up, mips[i - 1]); }
    // composite to the canvas
    const C = this.comp.uniforms;
    C.tScene.value = this.rt.texture; C.tBloom.value = mips[0].texture; C.uExposure.value = look?.expo ?? 1; C.uBloom.value = strength * bl;
    C.uVig.value = vig; C.uSat.value = sat; C.uContrast.value = contrast; C.uTint.value.set(...tint); C.uTime.value = time % 10; C.uFlash.value = flash;
    r.autoClear = true; this.pass(this.comp, null);
    r.autoClear = ac; info.autoReset = prev;
  }
}
