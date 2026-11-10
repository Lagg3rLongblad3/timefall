// Liquid: every map has a "sea level", and every hollow in the ground below it fills with water, lava, coolant or ice
// (one kind per theme). The sheet is one flat mesh built only over the cells that dip under the level; each vertex carries
// the ground height there, so the shader knows how deep the liquid is at every pixel: shorelines, foam, colour, clarity
// and the glow of lava meeting rock all follow the depth. The level itself is pure arithmetic on the height field, so the
// headless bot simulations agree with the browser about where the water is (nothing can be built in it).
import * as THREE from 'three';

// kind: water | lava | coolant | ice. shallow/deep = body colours (sRGB hex), foam = shoreline foam strength, murk = cloudy water
export const WATER_STYLES = {
  ancient: [
    { kind: 'water', shallow: 0x46b0c0, deep: 0x0d3a52, foam: 1 },                 // meadow ponds
    { kind: 'water', shallow: 0x62dcd2, deep: 0x0f7488, foam: 1 },                 // oasis
    { kind: 'water', shallow: 0x7a98a8, deep: 0x1a2e3c, foam: 0.7 },               // highland tarns
    { kind: 'water', shallow: 0x5a8a50, deep: 0x11281a, foam: 0.35, murk: 1 },     // swamp
    { kind: 'lava', shallow: 0xffc24a, deep: 0xff4a0c, crust: 0x1a0e0b },           // lava lakes
    { kind: 'ice', shallow: 0xd6eaf6, deep: 0x86b4d4 },                            // frozen lakes
  ],
  futuristic: [
    { kind: 'coolant', shallow: 0x4de3ff, deep: 0x083e5c },
    { kind: 'coolant', shallow: 0xff4de1, deep: 0x40083a },
    { kind: 'lava', shallow: 0xffd070, deep: 0xff6a1e, crust: 0x2a1610 },           // molten slag
    { kind: 'coolant', shallow: 0x7dff4d, deep: 0x0c3a12 },                         // toxic
    { kind: 'ice', shallow: 0xdcf2ff, deep: 0x8cc4ec },
    { kind: 'coolant', shallow: 0xa05cff, deep: 0x160a34 },
  ],
};
const KIND = { water: 0, lava: 1, coolant: 2, ice: 3 };

// The level: the lowest ~6% of the open ground (away from the road and the map's rim) goes under, but never higher than
// -0.9 (the road is flat at 0) and never so low that the deepest pool is under 0.8 deep. null = this map has no water.
export function waterLevel(grid, N, HALF, roadAttr) {
  const hs = [];
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = i - HALF, z = j - HALF, k = j * N + i;
    if (Math.abs(x) > HALF - 14 || Math.abs(z) > HALF - 14 || roadAttr[k * 3] < 6) continue;
    hs.push(grid[k]);
  }
  if (!hs.length) return null;
  hs.sort((a, b) => a - b);
  const minH = hs[0];
  if (minH > -2.0) return null;
  return Math.min(-0.9, Math.max(minH + 0.8, hs[Math.floor(hs.length * 0.06)]));
}

const VERT = /* glsl */`
attribute float aH; varying vec3 vW; varying float vD;
#include <fog_pars_vertex>
void main() {
  vW = position; vD = position.y - aH;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const FRAG = /* glsl */`
uniform float uTime, uFoam, uMurk; uniform vec3 uShallow, uDeep, uCrust, uZenith, uHorizon, uSunDir, uSunCol;
varying vec3 vW; varying float vD;
#include <fog_pars_fragment>
float h21(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec2 h22(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * vec3(.1031, .1030, .0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
  return mix(mix(h21(i), h21(i + vec2(1., 0.)), f.x), mix(h21(i + vec2(0., 1.)), h21(i + vec2(1., 1.)), f.x), f.y); }
float fbm(vec2 p) { return vn(p) * .55 + vn(p * 2.1 + 7.) * .3 + vn(p * 4.3 + 3.) * .15; }
vec3 voro(vec2 p) { // x = distance to the cell border, y = cell id
  vec2 n = floor(p), f = fract(p); float f1 = 8., f2 = 8., id = 0.;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 g = vec2(float(i), float(j)); vec2 o = h22(n + g); vec2 r = g + o - f; float d = dot(r, r);
    if (d < f1) { f2 = f1; f1 = d; id = h21(n + g); } else if (d < f2) f2 = d;
  }
  return vec3(sqrt(f2) - sqrt(f1), id, sqrt(f1));
}
float waveH(vec2 q, float t) {
  return sin(dot(q, vec2(.9, .4)) * 1.7 + t * 1.3) * .5 + sin(dot(q, vec2(-.5, .86)) * 2.3 - t * 1.7) * .35 + sin(dot(q, vec2(.2, -.97)) * 3.9 + t * 2.6) * .2 + (vn(q * 1.6 + t * .25) - .5) * .9;
}
vec3 waveN(vec2 q, float t, float amp) {
  float e = .06, h0 = waveH(q, t), hx = waveH(q + vec2(e, 0.), t), hz = waveH(q + vec2(0., e), t);
  return normalize(vec3(-(hx - h0) / e * amp, 1., -(hz - h0) / e * amp));
}
vec3 skyAt(vec3 R) { return mix(uHorizon, uZenith, smoothstep(-.05, .5, R.y)); }
void main() {
  float d = vD; if (d < 0.) discard;   // ground above the surface here
  vec3 V = normalize(cameraPosition - vW); vec2 P = vW.xz; vec3 col; float a;
  float below = gl_FrontFacing ? 0. : 1.;   // seen from under the surface: darker, more opaque
  #if KIND == 0 // ------------------------------------------------ water: sky reflection, sun glint, clear shallows, foam at the shore
    vec3 n = waveN(P * .55, uTime, .065); if (!gl_FrontFacing) n = -n;
    float F = (.02 + .98 * pow(1. - max(dot(n, V), 0.), 5.)) * (1. - .4 * uMurk);
    vec3 R = reflect(-V, n);
    float sd = max(dot(R, uSunDir), 0.), glint = pow(sd, 600.) * 4. + pow(sd, 48.) * .15;
    float k = 1. - exp(-d * mix(.55, 1.5, uMurk));
    vec3 body = mix(uShallow, uDeep, k);
    float foam = (1. - smoothstep(0., .3, d)) * smoothstep(.5, .75, vn(P * 2.6 + vec2(uTime * .35, -uTime * .3)) * .6 + vn(P * 6.5 - uTime * .6) * .4) * uFoam;
    col = mix(body, skyAt(R), F) + uSunCol * glint + foam * .8;
    a = clamp(smoothstep(0., .1, d) * (.5 + .5 * k) + F * .7 + foam, 0., 1.);
    col = mix(col, uDeep, below * .6); a = max(a, below * .85);
  #elif KIND == 1 // ----------------------------------------------- lava: drifting crust plates with glowing seams, brighter where it meets the rock
    vec2 q = P * .22 + vec2(uTime * .025, uTime * .015);
    q += (vec2(vn(q * 1.4 + 3.), vn(q * 1.4 + 8.)) - .5) * .9;
    vec3 v = voro(q); float crack = 1. - smoothstep(0., .1, v.x);
    float pulse = .72 + .28 * sin(uTime * 1.1 + v.y * 31.), shore = 1. - smoothstep(0., .8, d);
    vec3 crust = uCrust * (.6 + .6 * vn(P * 1.7)) * (.8 + .4 * v.y);
    vec3 hot = mix(uDeep, uShallow, pow(crack, 1.5) * pulse);
    col = mix(crust, hot, max(crack, shore * .5)) * (1. + 1.9 * crack * pulse + 1.3 * shore) + uShallow * shore * .6;
    a = smoothstep(0., .05, d);
  #elif KIND == 2 // ----------------------------------------------- coolant: glowing liquid, rings spreading from random points, bright rim
    vec3 n = waveN(P * .8, uTime * 1.2, .05); if (!gl_FrontFacing) n = -n;
    float F = .04 + .96 * pow(1. - max(dot(n, V), 0.), 4.);
    vec2 cid = floor(P / 9.), cf = fract(P / 9.) - .5 + (h22(cid) - .5) * .5; float cr = length(cf) * 9.;
    float ring = pow(.5 + .5 * sin(cr * 2.4 - uTime * 2.2 + h21(cid) * 6.28), 14.) * (1. - smoothstep(1.5, 4.5, cr));
    float k = 1. - exp(-d * .8), rim = 1. - smoothstep(0., .25, d);
    vec3 body = mix(uShallow, uDeep, k * .85);
    col = body * (.7 + .4 * k) + uShallow * (ring * 1.1 + rim * 1.4 + F * .8) * 1.3 + skyAt(reflect(-V, n)) * F * .25;
    a = clamp(smoothstep(0., .08, d) * .85 + F * .5 + rim * .5, 0., 1.);
    col = mix(col, uDeep * 1.5, below * .5); a = max(a, below * .85);
  #else // ---------------------------------------------------------- ice: a glassy sheet with cracks and frost, snow at the edge
    vec3 n = vec3(0., 1., 0.); if (!gl_FrontFacing) n = -n;
    vec3 v = voro(P * .2); float crack = 1. - smoothstep(0., .045, v.x);
    float frost = fbm(P * .55);
    float F = .04 + .96 * pow(1. - max(dot(n, V), 0.), 5.);
    vec3 R = reflect(-V, n); float glint = pow(max(dot(R, uSunDir), 0.), 320.) * 3.;
    float k = 1. - exp(-d * 1.2), rim = 1. - smoothstep(0., .5, d);
    vec3 body = mix(uShallow, uDeep, k * .6);
    body = mix(body, vec3(.95, .97, 1.), smoothstep(.5, .8, frost) * .45 + crack * .75);
    col = mix(body, skyAt(R), F * .7) + uSunCol * glint + rim * .35;
    a = clamp(smoothstep(0., .05, d) * .9 + F * .3 + rim * .4, 0., 1.);
    col = mix(col, uDeep, below * .5); a = max(a, below * .9);
  #endif
  gl_FragColor = vec4(col, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

// grid: the N x N height field (world.js), level: from waterLevel(), style: a WATER_STYLES entry, look: the map's atmosphere (gfx.js)
export function buildWater({ scene, grid, N, HALF, level, style, look }) {
  const map = new Int32Array(N * N).fill(-1), pos = [], hh = [], idx = [];
  const vert = k => { let v = map[k]; if (v < 0) { v = map[k] = pos.length / 3; pos.push((k % N) - HALF, level, Math.floor(k / N) - HALF); hh.push(grid[k]); } return v; };
  for (let j = 0; j < N - 1; j++) for (let i = 0; i < N - 1; i++) { // the same two triangles per cell as the terrain, so the depth is exact along the shore
    const a = j * N + i, b = a + N, c = b + 1, d = a + 1;
    if (Math.min(grid[a], grid[b], grid[c], grid[d]) >= level) continue;
    idx.push(vert(a), vert(b), vert(d), vert(b), vert(c), vert(d));
  }
  if (!idx.length) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('aH', new THREE.Float32BufferAttribute(hh, 1)); geo.setIndex(idx);
  const C = h => new THREE.Color(h);
  const mat = new THREE.ShaderMaterial({
    defines: { KIND: KIND[style.kind] },
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      uTime: { value: 0 }, uFoam: { value: style.foam ?? 1 }, uMurk: { value: style.murk ?? 0 },
      uShallow: { value: C(style.shallow) }, uDeep: { value: C(style.deep) }, uCrust: { value: C(style.crust ?? 0x000000) },
      uZenith: { value: C(look.zenith) }, uHorizon: { value: C(look.horizon) }, uSunDir: { value: look.sunDir.clone() }, uSunCol: { value: C(look.sunCol) },
    }]),
    vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: true, side: THREE.DoubleSide, fog: true,
  });
  const mesh = new THREE.Mesh(geo, mat); mesh.name = 'water'; mesh.userData.noShadow = true; mesh.renderOrder = 0;
  scene.add(mesh);
  return { mesh, update(t) { mat.uniforms.uTime.value = t; } };
}
