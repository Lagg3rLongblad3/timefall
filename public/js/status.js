// Enemy status effects, drawn on the enemies themselves.
// Every enemy gets its own copies of the (few) materials of its model; their shader reads a handful of per-enemy uniforms:
//   hit flash · frost (icy tint, glints, rim) · burn (flames licking up the body) · gravity pull (violet shimmer) · death dissolve.
// Stun adds a ring of orbiting sparks above the head and frost grows ice crystals around the feet (shared geometry, see StatusKit).
// All of it is cosmetic; the game logic only tells us which effects are active (see Game.updateEnemies).
import * as THREE from 'three';
import { piece, merge, cone } from './props.js';

const HEAD = /* glsl */`
uniform vec4 uStA;   // x hit flash, y frost, z burn, w gravity pull
uniform vec4 uStB;   // x dissolve 0..1, y clock, z seed, w model height
uniform vec4 uStC;   // rgb dissolve edge colour, a = 1 for the futuristic era
varying vec3 vStP;   // object-space position
float stH(vec3 p) { p = fract(p * .3183099 + .1); p *= 17.; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float stN(vec3 p) {
  vec3 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
  return mix(mix(mix(stH(i), stH(i + vec3(1, 0, 0)), f.x), mix(stH(i + vec3(0, 1, 0)), stH(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(stH(i + vec3(0, 0, 1)), stH(i + vec3(1, 0, 1)), f.x), mix(stH(i + vec3(0, 1, 1)), stH(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}`;

// death: the surface erodes away along a noise front (top first); the futuristic era quantises it into digital blocks
const DISSOLVE = /* glsl */`
float stEdge = 0.;
if (uStB.x > .001) {
  float stg = stN(vStP * 4.5 + uStB.z) * .55 + stN(vStP * 10.5 + uStB.z * 2.) * .3 + (1. - clamp(vStP.y / uStB.w, 0., 1.)) * .35;
  if (uStC.a > .5) stg = floor(stg * 7.) / 7. + stN(floor(vStP * 9.) + uStB.z) * .12;
  float stT = uStB.x * 1.4 - .1;
  if (stg < stT) discard;
  stEdge = 1. - smoothstep(0., .14, stg - stT);
}`;

// albedo: frost bleaches and cools it, fire chars it, gravity turns it violet, a hit flashes it white
const TINT = /* glsl */`
{
  float stL = dot(diffuseColor.rgb, vec3(.299, .587, .114));
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(stL) * vec3(.62, .86, 1.1) + vec3(.03, .12, .22), uStA.y * .62);
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(.34, .27, .25), uStA.z * .55);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(stL) * vec3(.85, .4, 1.25) + vec3(.06, .0, .12), uStA.w * .55);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.), uStA.x * .4);
  diffuseColor.rgb *= 1. - stEdge * .7;
}`;

const GLOW = /* glsl */`
{
  vec3 stV = normalize(vViewPosition);
  float stR = pow(1. - clamp(dot(normal, stV), 0., 1.), 2.4);
  float stHn = clamp(vStP.y / uStB.w, 0., 1.);
  if (uStA.x > .001) totalEmissiveRadiance += vec3(1., .94, .82) * uStA.x * (.35 + .9 * stR);
  if (uStA.y > .001) {
    float stS = smoothstep(.8, .96, stN(vStP * 15. + vec3(0., uStB.y * .5, 0.)));
    totalEmissiveRadiance += (vec3(.25, .65, 1.) * (stR * 1.3 + .1) + vec3(.8, .95, 1.) * stS * 2.) * uStA.y;
  }
  if (uStA.z > .001) {
    float stF = stN(vec3(vStP.x * 3.4, vStP.y * 2.4 - uStB.y * 3.6, vStP.z * 3.4) + uStB.z) * .62 + stN(vec3(vStP.x * 8., vStP.y * 5. - uStB.y * 7., vStP.z * 8.)) * .38;
    float stFire = smoothstep(.46, .86, stF + stR * .4 - stHn * .35);
    totalEmissiveRadiance += mix(vec3(1.25, .2, .03), vec3(2., 1.15, .3), stFire) * (stFire * 1.35 + stR * .45 + .03) * uStA.z;
  }
  if (uStA.w > .001) {
    float stP = smoothstep(.55, .9, stN(vec3(vStP.x * 4., vStP.y * 10. - uStB.y * 6., vStP.z * 4.)));
    totalEmissiveRadiance += vec3(.6, .2, 1.4) * (stR * 1.5 + stP * .9 + .1) * uStA.w;
  }
  totalEmissiveRadiance += uStC.rgb * stEdge * mix(1.5, 3.4, uStC.a);
}`;

function inject(sh, S) {
  sh.uniforms.uStA = S.A; sh.uniforms.uStB = S.B; sh.uniforms.uStC = S.C;
  sh.vertexShader = sh.vertexShader
    .replace('#include <common>', () => '#include <common>\nvarying vec3 vStP;')
    .replace('#include <begin_vertex>', () => '#include <begin_vertex>\nvStP = position;');
  sh.fragmentShader = sh.fragmentShader
    .replace('#include <common>', () => '#include <common>\n' + HEAD)
    .replace('#include <clipping_planes_fragment>', () => '#include <clipping_planes_fragment>\n' + DISSOLVE)
    .replace('#include <color_fragment>', () => '#include <color_fragment>\n' + TINT)
    .replace('#include <roughnessmap_fragment>', () => '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, .18, uStA.y * .85);')
    .replace('#include <lights_physical_fragment>', () => GLOW + '\n#include <lights_physical_fragment>');
}

// A per-enemy copy of a model material (keeps whatever the original shader already does: vertex-colour glow...).
function statusMaterial(src, S) {
  const m = src.clone(), hook = src.onBeforeCompile, key = src.customProgramCacheKey();
  m.onBeforeCompile = (sh, r) => { hook.call(m, sh, r); inject(sh, S); };
  m.customProgramCacheKey = () => 'st|' + key;
  return m;
}
const sig = m => `${m.customProgramCacheKey()}|${m.metalness}|${m.roughness}|${m.emissiveIntensity}|${m.emissive.getHex()}|${m.color.getHex()}|${m.vertexColors}`;

// ---------------------------------------------------------------------------------------------- shared geometry / materials
const STAR_VERT = /* glsl */`
uniform float uScale, uTime, uR; attribute float aPh; varying float vTw;
void main() {
  float a = uTime * 4.2 + aPh * 6.2832, s = length(modelMatrix[0].xyz);
  vec3 p = vec3(cos(a) * uR, sin(a * 1.7 + aPh * 9.) * .07, sin(a) * uR);
  vec4 mv = modelViewMatrix * vec4(p, 1.);
  vTw = .65 + .35 * sin(uTime * 11. + aPh * 21.);
  gl_PointSize = max(.46 * s * uScale / max(.1, -mv.z), 4.);
  gl_Position = projectionMatrix * mv;
}`;
const STAR_FRAG = /* glsl */`
uniform vec3 uCol; varying float vTw;
void main() {
  vec2 c = gl_PointCoord - .5;
  float cross = exp(-abs(c.x) * 26.) * (1. - smoothstep(.1, .5, abs(c.y))) + exp(-abs(c.y) * 26.) * (1. - smoothstep(.1, .5, abs(c.x)));
  float a = clamp(cross * .8 + exp(-dot(c, c) * 60.), 0., 1.);
  if (a < .02) discard;
  gl_FragColor = vec4(uCol * (1.1 + a) * vTw, a);
  #include <colorspace_fragment>
}`;

export class StatusKit {
  constructor(era, uScale) {
    const fut = this.fut = era === 'futuristic';
    // ice crystals: a ring of spikes around the feet and a few higher up, scaled to the enemy
    const parts = [], N = 9;
    for (let i = 0; i < N; i++) {
      const a = i / N * 6.2832 + (i % 2) * 0.3, r = 0.5 + (i % 3) * 0.12, h = 0.5 + ((i * 7) % 5) * 0.12, tilt = 0.35 + (i % 3) * 0.12;
      parts.push(cone(0.1 + (i % 2) * 0.04, h, 4, { at: [Math.cos(a) * r, 0, Math.sin(a) * r], rot: [Math.sin(a) * tilt, a, -Math.cos(a) * tilt], color: i % 2 ? 0xd8f4ff : 0x9bd8ff, tint: 0.12, ao: [0, h, 0.55] }));
    }
    for (let i = 0; i < 4; i++) {
      const a = i * 1.7 + 0.4, h = 0.45 + i * 0.05;
      parts.push(cone(0.09, h, 4, { at: [Math.cos(a) * 0.36, 0.6 + i * 0.22, Math.sin(a) * 0.36], rot: [Math.sin(a) * 1.1, a, -Math.cos(a) * 1.1], color: 0xc8ecff, tint: 0.1 }));
    }
    this.iceGeo = merge(parts);
    this.iceMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.08, metalness: 0, transparent: true, opacity: 0.82, emissive: 0x2a8cff, emissiveIntensity: 0.45, depthWrite: false });
    // orbiting sparks (stun)
    this.starGeo = new THREE.BufferGeometry();
    this.starGeo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(15), 3));
    this.starGeo.setAttribute('aPh', new THREE.Float32BufferAttribute([0, 0.2, 0.4, 0.6, 0.8], 1));
    this.starMat = new THREE.ShaderMaterial({
      uniforms: { uScale, uTime: { value: 0 }, uR: { value: 0.62 }, uCol: { value: new THREE.Color(fut ? 0x6fe9ff : 0xffd860).multiplyScalar(1.6) } },
      vertexShader: STAR_VERT, fragmentShader: STAR_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    });
  }
  tick(t) { this.starMat.uniforms.uTime.value = t; }
  dispose() { this.iceGeo.dispose(); this.iceMat.dispose(); this.starGeo.dispose(); this.starMat.dispose(); }
}

const ease = (v, to, k) => v + (to - v) * Math.min(1, k);

export class EnemyStatus {
  // mesh: the enemy's own clone of the model; its materials are swapped for per-enemy copies
  constructor(mesh, h, size, kit) {
    this.kit = kit; this.mesh = mesh; this.h = h; this.size = size;
    this.A = { value: new THREE.Vector4() };
    this.B = { value: new THREE.Vector4(0, 0, Math.random() * 20, h) };
    this.C = { value: kit.fut ? new THREE.Vector4(0.15, 0.85, 1, 1) : new THREE.Vector4(0.8, 0.34, 0.1, 0) };
    this.hit = this.frost = this.burn = this.pull = 0;
    this.dyingT = -1; this.dur = 1;
    const cache = new Map();
    mesh.traverse(o => {
      if (!o.isMesh) return;
      const k = sig(o.material);
      let m = cache.get(k);
      if (!m) { m = statusMaterial(o.material, this); cache.set(k, m); }
      o.material = m;
    });
    this.ice = new THREE.Mesh(kit.iceGeo, kit.iceMat); this.ice.visible = false; this.ice.frustumCulled = false; this.ice.userData.noShadow = true; mesh.add(this.ice);
    this.stars = null;
  }
  flash(k) { this.hit = Math.max(this.hit, k); }
  // on: { frost, burn, pull, stun } booleans from the game logic
  update(dt, t, on) {
    this.hit = Math.max(0, this.hit - dt * 8);
    this.frost = ease(this.frost, on.frost ? 1 : 0, dt * 6);
    this.burn = ease(this.burn, on.burn ? 1 : 0, dt * 9);
    this.pull = ease(this.pull, on.pull ? 1 : 0, dt * 10);
    this.A.value.set(this.hit, this.frost, this.burn, this.pull); this.B.value.y = t;
    const f = this.frost, ice = this.ice;
    ice.visible = f > 0.04; if (ice.visible) { const s = this.size * (0.55 + 0.45 * f) * f; ice.scale.set(s, s * (0.8 + 0.3 * f), s); }
    // stun sparks circle the head (not the tip of a spear)
    if (on.stun && !this.stars) { this.stars = new THREE.Points(this.kit.starGeo, this.kit.starMat); this.stars.frustumCulled = false; this.stars.userData.noShadow = true; this.stars.position.y = Math.min(this.h, this.size * 2.3 + 0.4) + 0.35; this.stars.scale.setScalar(Math.max(0.7, this.size * 0.95)); this.mesh.add(this.stars); }
    if (this.stars) this.stars.visible = on.stun;
  }
  // death: returns the dissolve progress 0..1 (the caller removes the mesh at 1)
  startDie(dur) { this.dyingT = 0; this.dur = dur; this.hit = 1; if (this.stars) this.stars.visible = false; }
  die(dt) {
    this.dyingT += dt; const k = Math.min(1, this.dyingT / this.dur);
    this.hit = Math.max(0, this.hit - dt * 5); this.frost *= 0.9; this.burn *= 0.9;
    this.A.value.set(this.hit, this.frost, this.burn, this.pull); this.B.value.x = k * k * (3 - 2 * k) * 0.55 + k * 0.45;
    this.ice.visible = this.frost > 0.04;
    return k;
  }
}
