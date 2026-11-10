// Ground marks: soot, craters, lightning scars, molten pits and blast rings where the towers hit.
// A fixed pool of small patches (one merged, dynamic mesh = one draw call). Each patch is a grid draped over the terrain
// height field; the look of the mark is procedural in the fragment shader and fades out after ~40 seconds.
import * as THREE from 'three';

export const MARK = { fire: 0, crater: 1, bolt: 2, pit: 3, blast: 4, burn: 5 };

const M = 56, G = 8, VPS = (G + 1) * (G + 1);

const VERT = /* glsl */`
attribute vec2 aUV; attribute vec4 aA; varying vec2 vUV; varying vec4 vA;
#include <fog_pars_vertex>
void main() {
  vUV = aUV; vA = aA;
  vec4 mvPosition = viewMatrix * vec4(position, 1.);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const FRAG = /* glsl */`
uniform float uTime; uniform vec3 uDirt, uDark, uHot; uniform vec2 uSun;
varying vec2 vUV; varying vec4 vA;
#include <fog_pars_fragment>
float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f); return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }
float fbm(vec2 p) { return vn(p) * .55 + vn(p * 2.1 + 7.) * .3 + vn(p * 4.3 + 3.) * .15; }
void main() {
  float age = uTime - vA.y, st = vA.z;
  if (st <= .001) discard;
  vec2 p = vUV; float r = length(p);
  if (r > 1.) discard;
  float n = fbm(p * 2.4 + vA.w * 11.), n2 = fbm(p * 5.7 + vA.w * 3.);
  float rr = r + (n - .5) * .5 + (n2 - .5) * .14;
  float fade = (1. - smoothstep(16., 38., age)) * smoothstep(0., .05, age);
  float a = 0.; vec3 col = vec3(0.); float ty = vA.x;
  if (ty < .5) {                         // 0: soot (fire, burnt bodies): black core, a ring of pale ash, embers that cool
    float core = 1. - smoothstep(.1, .7, rr), ash = smoothstep(.4, .6, rr) * (1. - smoothstep(.62, 1., rr)) * (.5 + .5 * n2);
    a = max(core * .92, ash * .55);
    col = mix(vec3(.3, .29, .27), vec3(.012, .01, .009), core);
    float hot = (1. - smoothstep(.8, 3.6, age)) * smoothstep(.5, .85, n2) * core;
    col += vec3(2.2, .6, .12) * hot;
  } else if (ty < 1.5) {                 // 1: crater: black pit, a raised rim lit from the sun side, thrown debris
    float pit = 1. - smoothstep(0., .55, rr), rim = smoothstep(.42, .62, rr) * (1. - smoothstep(.62, .95, rr));
    float side = dot(normalize(p + 1e-4), uSun);
    col = mix(uDirt * (1.1 + .55 * side), vec3(.02, .017, .015), pit);
    col += uHot * smoothstep(.45, .55, rr) * (1. - smoothstep(.55, .66, rr)) * (1. - smoothstep(0., 4., age)) * .8;   // the lip glows for a moment
    float ang = atan(p.y, p.x), rays = pow(vn(vec2(ang * 4.5 + vA.w * 30., 1.7)), 3.);
    a = max(pit * .96, rim * .9);
    a = max(a, rays * smoothstep(.5, .7, rr) * (1. - smoothstep(.7, 1., rr)) * .7);
    a *= 1. - smoothstep(.85, 1., rr);
  } else if (ty < 2.5) {                 // 2: lightning scar: glassy black centre, forked streaks, blue afterglow
    float ang = atan(p.y, p.x), rays = pow(max(0., sin(ang * 5. + vn(vec2(r * 4., vA.w * 9.)) * 3.) * .5 + .5), 5.);
    float core = 1. - smoothstep(0., .4, rr), ray = rays * (1. - smoothstep(.15, .95, rr));
    a = max(core * .95, ray * .85);
    float glow = 1. - smoothstep(0., 3., age);
    col = vec3(.014, .012, .02) + vec3(.1, .12, .25) * core * .3 + vec3(.35, .5, 1.7) * glow * (core + ray * .8);
  } else if (ty < 3.5) {                 // 3: molten pit: a glassy crater, its rim glowing and slowly cooling
    float pit = 1. - smoothstep(0., .5, rr), rim = smoothstep(.28, .5, rr) * (1. - smoothstep(.5, .95, rr));
    float heat = 1. - smoothstep(0., 8., age);
    a = max(pit, rim * .9) * .96;
    col = vec3(.018, .02, .03) + vec3(.08, .07, .06) * rim + uHot * (rim * heat * 2.4 + pit * heat * .7);
  } else if (ty < 4.5) {                 // 4: blast: scorched disc and a bright ring that fades
    float ring = exp(-pow((r - .8) * 10., 2.)) * (.6 + .4 * n);
    a = (1. - smoothstep(0., 1., rr)) * .5 + ring * .55;
    col = vec3(.02, .016, .02) + vec3(1.3, .25, 1.2) * ring * (1. - smoothstep(0., 3.5, age)) * 1.8;
  } else {                               // 5: small hot burn (lasers, drones): dark pock with an ash edge, glows for a while
    float core = 1. - smoothstep(0., .6, rr), ash = smoothstep(.35, .55, rr) * (1. - smoothstep(.55, 1., rr));
    a = max(core * .9, ash * .5);
    col = mix(vec3(.3, .28, .26), vec3(.012), core) + vec3(1.5, .25, .1) * (1. - smoothstep(0., 4., age)) * core;
  }
  a *= st * fade;
  if (a < .012) discard;
  gl_FragColor = vec4(col, min(1., a));
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

export class Decals {
  // heightAt(x,z): terrain height; theme: the map's colours; sunDir: unit THREE.Vector3 towards the sun; fut: futuristic era
  constructor(scene, { heightAt, theme, sunDir, fut }) {
    this.scene = scene; this.heightAt = heightAt; this.time = 0; this.slots = new Array(M).fill(null);
    const pos = new Float32Array(M * VPS * 3), uv = new Float32Array(M * VPS * 2), aA = new Float32Array(M * VPS * 4), idx = [];
    for (let s = 0; s < M; s++) for (let gy = 0; gy <= G; gy++) for (let gx = 0; gx <= G; gx++) {
      const v = s * VPS + gy * (G + 1) + gx; uv[v * 2] = -1 + 2 * gx / G; uv[v * 2 + 1] = -1 + 2 * gy / G;
      if (gx < G && gy < G) { const a = v, b = v + 1, c = v + G + 1, d = c + 1; idx.push(a, c, b, b, c, d); }
    }
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aUV', new THREE.BufferAttribute(uv, 2));
    this.geo.setAttribute('aA', new THREE.BufferAttribute(aA, 4).setUsage(THREE.DynamicDrawUsage));
    this.geo.setIndex(idx);
    const path = new THREE.Color(theme.path), sun = new THREE.Vector2(sunDir.x, sunDir.z).normalize();
    this.mat = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 }, uDirt: { value: fut ? new THREE.Color(0.1, 0.105, 0.12) : path.clone().multiplyScalar(1.2).addScalar(0.03) }, uDark: { value: path.clone().multiplyScalar(0.2) },
        uHot: { value: new THREE.Color(0xff9a40).multiplyScalar(1.3) }, uSun: { value: sun } }]),
      vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, fog: true, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    this.mesh = new THREE.Mesh(this.geo, this.mat); this.mesh.frustumCulled = false; this.mesh.renderOrder = 1; this.mesh.matrixAutoUpdate = false; this.mesh.userData.noShadow = true; this.mesh.name = 'decals';
    scene.add(this.mesh);
  }
  update(time) { this.time = time; this.mat.uniforms.uTime.value = time; }

  // a mark of `type` at (x,z), radius r. Marks of the same kind landing on top of each other deepen the old one instead of piling up.
  add(type, x, z, r, strength = 1) {
    let i = -1;
    for (let k = 0; k < M; k++) { const s = this.slots[k]; if (s && s.type === type && this.time - s.birth < 30 && (s.x - x) ** 2 + (s.z - z) ** 2 < (Math.max(s.r, r) * 0.55) ** 2) { i = k; break; } }
    let s;
    if (i >= 0) { s = this.slots[i]; s.strength = Math.min(1.5, s.strength + strength * 0.5); s.r = Math.min(r * 1.4, Math.max(s.r, r) * 1.04); s.birth = this.time - 0.3; }
    else { i = this.free(); s = this.slots[i] = { type, x, z, r, strength, seed: Math.random() * 10, birth: this.time }; }
    this.write(i, s);
  }
  free() {
    let oldest = 0, ob = 1e9;
    for (let k = 0; k < M; k++) { const s = this.slots[k]; if (!s || this.time - s.birth > 40) return k; if (s.birth < ob) { ob = s.birth; oldest = k; } }
    return oldest;
  }
  write(i, s) {
    const P = this.geo.attributes.position.array, A = this.geo.attributes.aA.array, lift = s.type === 3 ? 0.06 : 0.045;
    for (let gy = 0; gy <= G; gy++) for (let gx = 0; gx <= G; gx++) {
      const v = i * VPS + gy * (G + 1) + gx, wx = s.x + (-1 + 2 * gx / G) * s.r, wz = s.z + (-1 + 2 * gy / G) * s.r;
      P[v * 3] = wx; P[v * 3 + 1] = this.heightAt(wx, wz) + lift; P[v * 3 + 2] = wz;
      A[v * 4] = s.type; A[v * 4 + 1] = s.birth; A[v * 4 + 2] = s.strength; A[v * 4 + 3] = s.seed;
    }
    this.geo.attributes.position.needsUpdate = true; this.geo.attributes.aA.needsUpdate = true;
  }
  dispose() { this.scene.remove(this.mesh); this.geo.dispose(); this.mat.dispose(); }
}
