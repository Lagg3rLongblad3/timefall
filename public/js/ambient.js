// Ambient life: a field of soft particles that wraps around the camera (pollen, blowing sand, fireflies, embers, snow,
// neon motes...). Positions are computed entirely in the vertex shader from a clock, so this costs the CPU nothing per frame.
import * as THREE from 'three';
import { GFX } from './gfx.js';
import { mulberry } from './data.js';

// n = count, a/b = colour range, size = world size, box = wrap volume, vel = drift (units/s), sway = wander, tw = twinkle 0..1, gain = brightness
const CFG = {
  ancient: [
    { n: 650, a: 0xfff2c0, b: 0xffffff, size: 0.07, box: [64, 22, 64], vel: [0.35, 0.12, 0.15], sway: 0.9, tw: 0.2, gain: 0.9 },                  // meadow: pollen
    { n: 1100, a: 0xe2c088, b: 0xf6dcae, size: 0.06, box: [80, 12, 80], vel: [5.5, 0.1, 1.6], sway: 0.25, tw: 0.0, gain: 0.8 },                  // desert: blowing sand
    { n: 520, a: 0xd0d6dc, b: 0xffffff, size: 0.08, box: [64, 18, 64], vel: [1.0, -0.05, 0.4], sway: 0.5, tw: 0.0, gain: 0.55 },                // highlands: drifting dust
    { n: 380, a: 0xc8ff6a, b: 0xfff08a, size: 0.17, box: [56, 10, 56], vel: [0.12, 0.05, 0.1], sway: 2.2, tw: 1.0, gain: 1.6, glow: true },      // forest: fireflies
    { n: 950, a: 0xff7a24, b: 0xffd060, size: 0.1, box: [60, 26, 60], vel: [0.5, 2.6, 0.3], sway: 1.2, tw: 0.5, gain: 1.7, glow: true },          // volcano: embers
    { n: 1500, a: 0xe8f2ff, b: 0xffffff, size: 0.1, box: [60, 28, 60], vel: [0.9, -1.7, 0.4], sway: 0.8, tw: 0.0, gain: 1.0 },                  // snow
  ],
  futuristic: [
    { n: 560, a: 0x4de3ff, b: 0xaaf4ff, size: 0.11, box: [64, 24, 64], vel: [0.2, 0.7, 0.1], sway: 1.4, tw: 0.8, gain: 1.7, glow: true },
    { n: 560, a: 0xff4de1, b: 0xffb0f0, size: 0.11, box: [64, 24, 64], vel: [0.1, 0.5, 0.2], sway: 1.8, tw: 0.8, gain: 1.7, glow: true },
    { n: 800, a: 0xffa04d, b: 0xffd890, size: 0.08, box: [72, 14, 72], vel: [4.0, 0.3, 1.0], sway: 0.4, tw: 0.3, gain: 1.4, glow: true },
    { n: 560, a: 0x7dff4d, b: 0xd8ffa0, size: 0.13, box: [60, 20, 60], vel: [0.1, 0.6, 0.1], sway: 2.0, tw: 1.0, gain: 1.8, glow: true },
    { n: 1100, a: 0xcfeaff, b: 0xffffff, size: 0.09, box: [60, 26, 60], vel: [0.7, -1.2, 0.3], sway: 0.7, tw: 0.6, gain: 1.3, glow: true },
    { n: 560, a: 0xa05cff, b: 0xe0c0ff, size: 0.11, box: [64, 24, 64], vel: [0.15, 0.45, 0.1], sway: 1.6, tw: 0.9, gain: 1.8, glow: true },
  ],
};

const VERT = /* glsl */`
uniform float uTime, uSize, uViewH, uSway, uTw, uGain; uniform vec3 uCam, uBox, uVel;
attribute vec4 aSeed; attribute vec3 aCol;
varying vec3 vCol; varying float vA;
void main() {
  float ph = aSeed.w;
  vec3 p = aSeed.xyz * uBox + uVel * uTime * (.6 + ph * .8);
  p += vec3(sin(uTime * .7 + ph * 40.), sin(uTime * .9 + ph * 23.) * .5, cos(uTime * .6 + ph * 31.)) * uSway;
  vec3 rel = mod(p - uCam + uBox * .5, uBox) - uBox * .5;
  vec4 mv = viewMatrix * vec4(uCam + rel, 1.);
  vec3 q = abs(rel) / uBox;
  float edge = 1. - smoothstep(.34, .5, max(q.x, max(q.y, q.z)));
  float tw = mix(1., .5 + .5 * sin(uTime * (2. + ph * 5.) + ph * 60.), uTw);
  tw *= mix(1., smoothstep(.0, .6, sin(uTime * (.5 + ph) + ph * 90.) * .5 + .5), uTw);
  vA = edge * tw * uGain * smoothstep(.4, 2., -mv.z);
  vCol = aCol;
  gl_PointSize = max(uSize * .5 * uViewH * projectionMatrix[1][1] / max(.3, -mv.z), 1.5);
  gl_Position = projectionMatrix * mv;
}`;
const FRAG = /* glsl */`
varying vec3 vCol; varying float vA;
void main() {
  vec2 c = gl_PointCoord - .5; float d = dot(c, c) * 4.;
  float a = (1. - smoothstep(.0, 1., d)); a *= a * vA;
  if (a < .01) discard;
  gl_FragColor = vec4(vCol, a);
  #include <colorspace_fragment>
}`;

export function buildAmbient(map, scene) {
  const cfg = CFG[map.era][map.idx % 6], R = mulberry(map.seed * 31 + 5), n = Math.round(cfg.n * Math.min(1, GFX.grass + 0.35));
  const seed = new Float32Array(n * 4), col = new Float32Array(n * 3), pos = new Float32Array(n * 3), ca = new THREE.Color(cfg.a), cb = new THREE.Color(cfg.b), c = new THREE.Color();
  for (let i = 0; i < n; i++) {
    seed[i * 4] = R(); seed[i * 4 + 1] = R(); seed[i * 4 + 2] = R(); seed[i * 4 + 3] = R();
    c.copy(ca).lerp(cb, R()); col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4)); geo.setAttribute('aCol', new THREE.BufferAttribute(col, 3));
  const u = { uTime: { value: 0 }, uSize: { value: cfg.size }, uViewH: { value: 720 }, uSway: { value: cfg.sway }, uTw: { value: cfg.tw }, uGain: { value: cfg.gain }, uCam: { value: new THREE.Vector3() }, uBox: { value: new THREE.Vector3(...cfg.box) }, uVel: { value: new THREE.Vector3(...cfg.vel) } };
  const mat = new THREE.ShaderMaterial({ uniforms: u, vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, blending: cfg.glow ? THREE.AdditiveBlending : THREE.NormalBlending, fog: false });
  const pts = new THREE.Points(geo, mat); pts.frustumCulled = false; pts.renderOrder = 6; pts.name = 'ambient'; pts.userData.noShadow = true;
  scene.add(pts);
  return { points: pts, update(t, cam, viewH) { u.uTime.value = t; u.uCam.value.copy(cam); u.uViewH.value = viewH; } };
}
