// Terrain material: a MeshStandardMaterial (so it gets the sun, shadows, image-based light and fog like everything else)
// whose surface is drawn procedurally in the fragment shader: grass / sand / stone / lava / snow for the ancient maps,
// neon grid / hex / panels / veins / ice / circuits for the futuristic ones, plus a textured, direction-showing road.
// World position drives every pattern, so there are no textures to load and no stretching on slopes.
import * as THREE from 'three';

// style per theme index. rockLo = slope where bare rock starts to show. line/lineI = glow colour and strength of the futuristic patterns.
export const TERRAIN_STYLES = {
  ancient: [
    { style: 0, pstyle: 0, rock: 0x7d7a6e, rockLo: 0.26, pathB: 0xd8bb88 },
    { style: 1, pstyle: 0, rock: 0xa87c4e, rockLo: 0.34, pathB: 0xc29a6a },
    { style: 2, pstyle: 1, rock: 0x6b6a66, rockLo: 0.30, pathB: 0xa09484 },
    { style: 3, pstyle: 0, rock: 0x4b4a3c, rockLo: 0.28, pathB: 0xa8845a },
    { style: 4, pstyle: 3, rock: 0x1c1412, rockLo: 0.22, pathB: 0x3a302a, glow: 0xff5a1e },
    { style: 5, pstyle: 1, rock: 0x8497a8, rockLo: 0.30, pathB: 0xa9acb0 },
  ],
  futuristic: [
    { style: 10, pstyle: 2, rock: 0x141c2e, rockLo: 0.20, pathB: 0x4a5a78, line: 0x4de3ff, lineI: 1.0, glow: 0x4de3ff },
    { style: 11, pstyle: 2, rock: 0x22102e, rockLo: 0.20, pathB: 0x5a3a78, line: 0xff4de1, lineI: 0.8, glow: 0xff4de1 },
    { style: 12, pstyle: 2, rock: 0x2e1c12, rockLo: 0.20, pathB: 0x5a4034, line: 0xffa04d, lineI: 0.9, glow: 0xffb060 },
    { style: 13, pstyle: 2, rock: 0x10200e, rockLo: 0.20, pathB: 0x3a5a3a, line: 0x7dff4d, lineI: 0.75, glow: 0x7dff4d },
    { style: 14, pstyle: 2, rock: 0x5f7a98, rockLo: 0.24, pathB: 0x7c9ab8, line: 0xbfeaff, lineI: 0.9, glow: 0x6fd8ff },
    { style: 15, pstyle: 2, rock: 0x0b0914, rockLo: 0.20, pathB: 0x40406a, line: 0xa05cff, lineI: 1.1, glow: 0xa05cff },
  ],
};

const GLSL_COMMON = /* glsl */`
uniform float uTime, uRockLo, uLineI, uBump, uCloudSh, uWater, uCaustic;
uniform vec3 uRock, uPathA, uPathB, uLine, uGlow, uWaterCol;
varying vec3 vRoad, vWp, vNw;
float h21(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec2 h22(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * vec3(.1031, .1030, .0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
  return mix(mix(h21(i), h21(i + vec2(1., 0.)), f.x), mix(h21(i + vec2(0., 1.)), h21(i + vec2(1., 1.)), f.x), f.y); }
// cellular noise: x = F2 - F1 (0 on cell borders), y = cell id hash, z = F1
vec3 voro(vec2 p) {
  vec2 n = floor(p), f = fract(p); float f1 = 8., f2 = 8., id = 0.;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 g = vec2(float(i), float(j)); vec2 o = h22(n + g); vec2 r = g + o - f; float d = dot(r, r);
    if (d < f1) { f2 = f1; f1 = d; id = h21(n + g); } else if (d < f2) f2 = d;
  }
  return vec3(sqrt(f2) - sqrt(f1), id, sqrt(f1));
}
float gridLine(vec2 gp, float thick) { // anti-aliased lines at integer coordinates
  vec2 dd = abs(fract(gp - .5) - .5), w = fwidth(gp) * 1.15 + thick;
  return max(1. - smoothstep(0., w.x, dd.x), 1. - smoothstep(0., w.y, dd.y));
}
`;

const GLSL_COLOR = /* glsl */`
vec2 P = vWp.xz;
float vdist = length(vViewPosition);
float fadeFar = 1. - smoothstep(30., 120., vdist);
float d1 = vn(P * .7), d2 = vn(P * 2.3 + 11.), d3 = vn(P * 8.1 + 5.);
float det = (d1 - .5) * .22 + (d2 - .5) * .16 + (d3 - .5) * .12 * fadeFar;
float slope = 1. - clamp(normalize(vNw).y, 0., 1.);
float tBump = 0.; vec3 tEmis = vec3(0.); float tRough = 1.;
vec3 ground = diffuseColor.rgb * (1. + det);
float rockMask = smoothstep(uRockLo, uRockLo + .2, slope + (d2 - .5) * .16);
vec3 rockCol = uRock * (.7 + .6 * vn(P * 1.6) + det);

#if STYLE == 0 // ---------------------------------------------------- meadow
  ground *= .92 + .16 * d3;
  ground = mix(ground, ground * vec3(.9, 1.03, .8), smoothstep(.35, .75, vn(P * .22 + 3.)) * .5);
  { vec2 fc = floor(P * 2.6); float fh = h21(fc); vec2 fo = fract(P * 2.6) - .5 - (h22(fc) - .5) * .5;
    float fl = step(.93, fh) * smoothstep(.13, .07, length(fo)) * (1. - rockMask) * fadeFar;
    vec3 fcol = fh > .975 ? vec3(1., .95, .45) : fh > .955 ? vec3(1., .55, .78) : vec3(1.);
    ground = mix(ground, fcol, fl * .9); }
  tBump = d3 * .5 + d2 * .3;
#elif STYLE == 1 // -------------------------------------------------- dunes
  { float rip = sin(dot(P, vec2(.92, .39)) * 3.6 + d1 * 7.) * .5 + .5;
    ground *= .93 + .1 * rip + (d3 - .5) * .08; tBump = rip * .6 + d3 * .25;
    float gr = step(.965, h21(floor(P * 6.))); ground = mix(ground, ground * .7, gr * fadeFar * .6);
    rockCol *= .85 + .3 * (.5 + .5 * sin(vWp.y * 5. + d1 * 3.)); }
#elif STYLE == 2 // -------------------------------------------------- stone plateau
  { vec3 v = voro(P * .55); float crack = 1. - smoothstep(0., .07, v.x);
    ground = mix(ground, ground * .5, crack * .8 * fadeFar); ground *= .85 + .3 * v.y;
    ground = mix(ground, vec3(.27, .38, .15), smoothstep(.55, .8, d1) * .35);
    tBump = v.z * .8 - crack * .6 + d3 * .2; }
#elif STYLE == 3 // -------------------------------------------------- forest floor
  { float litter = smoothstep(.5, .72, vn(P * 1.3 + 31.));
    ground = mix(ground, vec3(.33, .21, .10), litter * .55); ground *= .9 + .2 * d3;
    float fern = step(.9, h21(floor(P * 3.7))); ground = mix(ground, ground * vec3(.7, 1.25, .6), fern * .6 * fadeFar);
    tBump = d2 * .5 + d3 * .4; }
#elif STYLE == 4 // -------------------------------------------------- volcanic
  { vec3 v = voro(P * .42 + vec2(d1 * .35)); float crack = 1. - smoothstep(0., .07, v.x);
    float heat = .55 + .45 * sin(uTime * 1.3 + v.y * 20.);
    float low = 1. - smoothstep(-1., 3., vWp.y);
    ground *= .75 + .5 * d2;
    tEmis += uGlow * crack * heat * (.22 + .55 * low) * (1. - rockMask * .6) * (.4 + .6 * fadeFar);
    tBump = -crack * .8 + d2 * .5 + d3 * .2; tRough = 1. - crack * .4; }
#elif STYLE == 5 // -------------------------------------------------- snowfield
  { ground = mix(ground, ground * vec3(.9, .95, 1.), d2);
    vec2 sc = floor(P * 9.); float sp = step(.9965, h21(sc)); float tw = .5 + .5 * sin(uTime * 3. + h21(sc) * 90.);
    tEmis += vec3(.9, .95, 1.) * sp * tw * .9 * fadeFar; tBump = d1 * .8 + d2 * .35; tRough = .75; }
#elif STYLE == 10 // ------------------------------------------------- neon grid
  { vec2 gp = P / 10.; float cover = 1. - smoothstep(.12, .45, max(fwidth(gp.x), fwidth(gp.y)));
    float major = gridLine(gp, .007), minor = gridLine(gp * 4., .012) * .16;
    float pulse = .75 + .25 * sin(length(P) * .09 - uTime * 1.1);
    tEmis += uLine * (major + minor) * cover * pulse * uLineI + uLine * .05 * uLineI * (1. - cover);
    ground *= .9 + .2 * d3; tRough = .5; tBump = d3 * .15; }
#elif STYLE == 11 // ------------------------------------------------- hex plates
  { vec2 hp = P / 3.4; vec2 r = vec2(1., 1.732), hh = r * .5;
    vec2 a = mod(hp, r) - hh, b = mod(hp - hh, r) - hh; vec2 gv = dot(a, a) < dot(b, b) ? a : b; vec2 id = hp - gv;
    vec2 q = abs(gv); float hd = .5 - max(dot(q, normalize(vec2(1., 1.732))), q.x);
    float w = fwidth(hd) * 1.3 + .012; float edge = 1. - smoothstep(0., w, hd);
    float rnd = h21(id); float lit = step(.88, rnd) * (.55 + .45 * sin(uTime * 1.4 + rnd * 60.));
    float cover = 1. - smoothstep(.1, .35, fwidth(hp.x));
    tEmis += uLine * (edge * .8 + lit * .5 * smoothstep(.0, .12, hd)) * cover * uLineI;
    ground *= .85 + .3 * rnd; tRough = .4; tBump = smoothstep(0., .08, hd) * .5; }
#elif STYLE == 12 // ------------------------------------------------- rusted deck plates
  { vec2 pp = P / vec2(6., 4.); vec2 id = floor(pp); float rnd = h21(id);
    vec2 dd = abs(fract(pp) - .5); float seam = smoothstep(.46, .5, max(dd.x, dd.y));
    float rust = smoothstep(.45, .8, vn(P * .5 + rnd * 9.));
    ground = mix(ground * (.8 + .3 * rnd), ground * vec3(1.2, .8, .5), rust * .6); ground *= 1. - seam * .55;
    float strip = step(.8, rnd) * smoothstep(.04, .0, abs(fract(pp.y) - .5 + .32));
    tEmis += uLine * strip * .8 * uLineI * fadeFar; tBump = (1. - seam) * .6 + d3 * .3; tRough = .65 - rust * .2; }
#elif STYLE == 13 // ------------------------------------------------- bio-circuit veins
  { vec3 v = voro(P * .27 + vec2(d1 * .4)); float edge = 1. - smoothstep(0., .07, v.x);
    float flow = .5 + .5 * sin(v.y * 40. - uTime * 2.2 + v.z * 8.);
    tEmis += uLine * edge * (.35 + .65 * flow) * uLineI * (.3 + .7 * fadeFar);
    ground *= .75 + .5 * v.y; tBump = v.z * .6 - edge * .5; tRough = .55; }
#elif STYLE == 14 // ------------------------------------------------- cryo ice
  { vec3 v = voro(P * .3); float crack = 1. - smoothstep(0., .06, v.x);
    ground = mix(ground, vec3(.85, .94, 1.), crack * .55); ground *= .92 + .14 * d3;
    tEmis += uLine * crack * .12 * uLineI; tRough = .34; tBump = d2 * .3 - crack * .5; }
#elif STYLE == 15 // ------------------------------------------------- circuit board
  { vec2 cp = P / 2.2; vec2 id = floor(cp), f = fract(cp); float rnd = h21(id);
    float tr = rnd < .33 ? smoothstep(.07, .02, abs(f.y - .5)) : rnd < .66 ? smoothstep(.07, .02, abs(f.x - .5)) : smoothstep(.09, .03, abs(fract(f.x + f.y) - .5) * .7);
    float pad = step(.86, rnd) * smoothstep(.2, .14, length(f - .5));
    float pulse = .6 + .4 * sin(uTime * 2. + rnd * 60. + P.x * .2);
    float cover = 1. - smoothstep(.12, .4, fwidth(cp.x));
    tEmis += uLine * (tr * .6 + pad * 1.3) * pulse * cover * uLineI; ground *= .9 + .2 * d3; tRough = .32; tBump = tr * .3 + pad * .4; }
#endif

vec3 col = mix(ground, rockCol, rockMask);
col *= 1. - uCloudSh * smoothstep(.5, .78, vn(P * .02 + vec2(uTime * .45, uTime * .17) + 7.)); // clouds drifting over the land
#if STYLE >= 10
  { // steep faces: plated walls (projected along the face, not top-down) with a glowing seam at every terrace edge
    vec2 nh = normalize(vNw.xz + vec2(1e-4)); vec2 wp = vec2(dot(P, vec2(-nh.y, nh.x)) / 5., vWp.y / 1.44);
    float seam = max(gridLine(wp * vec2(1., 1.), .03), 0.) * (1. - smoothstep(.15, .45, max(fwidth(wp.x), fwidth(wp.y))));
    float rid = h21(floor(wp)); col *= .8 + .35 * rid;
    tEmis *= 1. - rockMask;
    tEmis += uLine * (seam * .5 + step(.9, rid) * .12) * rockMask * uLineI * fadeFar; }
#endif
tBump = mix(tBump, vn(P * 3.) * .9 + vn(P * 9.) * .4, rockMask);
{ // the liquid (water.js): a wet, glossy band along the shore, a darker bed and light rippling over it
  float wd = uWater - vWp.y;
  if (wd > -.6) {
    float wet = 1. - smoothstep(0., .55, -wd), under = smoothstep(0., .25, wd);
    col *= 1. - .28 * wet;
    col = mix(col, col * vec3(.7, .76, .8), under);
    vec3 cv = voro(P * .85 + vec2(uTime * .33, uTime * .19)), cv2 = voro(P * 1.25 - vec2(uTime * .21, uTime * .29) + 9.);
    float caus = max(pow(1. - smoothstep(0., .22, cv.x), 2.), pow(1. - smoothstep(0., .22, cv2.x), 2.) * .7);
    col += uWaterCol * caus * uCaustic * under * exp(-wd * .5) * .45 * fadeFar;
    tRough = mix(tRough, .35, wet);
  }
}

// ---- the road
float lat = vRoad.z, sAlong = vRoad.y;
float rw = 2.55 + (d2 - .5) * .8;
float road = 1. - smoothstep(rw - .5, rw + .3, vRoad.x);
float verge = (1. - smoothstep(rw + .2, rw + 1.6, vRoad.x)) * (1. - road);
col *= 1. - .22 * verge;
vec3 pathCol = uPathA; float pBump = 0.; vec3 pEmis = vec3(0.); float pRough = 1.;
#if PSTYLE == 0 // dirt track with wheel ruts and pebbles
  pathCol = mix(uPathA, uPathB, smoothstep(.3, .7, vn(P * 1.1)));
  { float rut = smoothstep(.32, .0, abs(abs(lat) - .95)) * .22; pathCol *= 1. - rut; pathCol *= .88 + .24 * d3;
    vec2 pc = P * 5.5, pid = floor(pc); vec2 po = fract(pc) - .5 - (h22(pid) - .5) * .55;
    float peb = step(.88, h21(pid)) * smoothstep(.17, .1, length(po)) * fadeFar; pathCol = mix(pathCol, pathCol * 1.3, peb * .75); pBump = d3 * .5 + peb * .8 - rut * 2.; }
#elif PSTYLE == 1 // flagstones
  { vec3 v = voro(vec2(sAlong * .42, lat * .42 + .5)); float mortar = 1. - smoothstep(0., .07, v.x);
    pathCol = uPathA * (.78 + .4 * v.y) * (.9 + .2 * d3); pathCol = mix(pathCol, pathCol * .35, mortar); pBump = (1. - mortar) * .7 + d3 * .15; pRough = .85; }
#elif PSTYLE == 2 // glowing data road, chevrons flow from the gate towards the base
  { pathCol = uPathB * .28 * (.9 + .2 * d3);
    float ph = fract((sAlong - uTime * 2.6) / 3.4 + abs(lat) * .26);
    float chev = smoothstep(0., .05, ph) * (1. - smoothstep(.1, .16, ph));
    float edge = smoothstep(.09, 0., abs(abs(lat) - 2.3)), inside = 1. - smoothstep(1.9, 2.2, abs(lat));
    pEmis = uGlow * (chev * inside * .6 + edge * .9) * (.4 + .6 * fadeFar); pRough = .58; pBump = d3 * .1; }
#else // smooth basalt road edged with glowing seams
  { pathCol = uPathA * (.85 + .3 * d3);
    float edge = smoothstep(.12, 0., abs(abs(lat) - 2.3)), flow = .6 + .4 * sin(sAlong * .5 - uTime * 1.5);
    float dash = step(.5, fract(sAlong / 4.)) * smoothstep(.22, 0., abs(lat));
    pEmis = uGlow * (edge * flow * .7 + dash * .22) * (.4 + .6 * fadeFar); pBump = d3 * .2; pRough = .85; }
#endif
col = mix(col, pathCol, road); tBump = mix(tBump, pBump, road); tEmis = mix(tEmis, pEmis, road); tRough = mix(tRough, pRough, road);
diffuseColor.rgb = col;
`;

const GLSL_NORMAL = /* glsl */`
{ // micro relief from the pattern's height field (screen-space derivatives; faded with distance so it never shimmers)
  vec2 dH = vec2(dFdx(tBump), dFdy(tBump)) * uBump * fadeFar;
  vec3 sX = dFdx(-vViewPosition), sY = dFdy(-vViewPosition);
  vec3 R1 = cross(sY, normal), R2 = cross(normal, sX);
  float fDet = dot(sX, R1);
  vec3 grad = sign(fDet) * (dH.x * R1 + dH.y * R2);
  normal = normalize(abs(fDet) * normal - grad);
}
`;

// water = { level, color, caustic } from world.js (null: a dry map)
export function makeTerrainMaterial(th, style, flat, cloudShadow = 0, water = null) {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: flat, roughness: 0.95, metalness: 0 });
  mat.defines.STYLE = style.style; mat.defines.PSTYLE = style.pstyle;
  const c = h => new THREE.Color(h);
  const u = { uTime: { value: 0 }, uCloudSh: { value: cloudShadow }, uRockLo: { value: style.rockLo }, uLineI: { value: style.lineI ?? 1 }, uBump: { value: style.style >= 10 ? 0.018 : 0.06 },
    uRock: { value: c(style.rock) }, uPathA: { value: c(th.path) }, uPathB: { value: c(style.pathB) }, uLine: { value: c(style.line ?? 0xffffff) }, uGlow: { value: c(style.glow ?? 0xffffff) },
    uWater: { value: water ? water.level : -1e4 }, uWaterCol: { value: c(water?.color ?? 0xffffff) }, uCaustic: { value: water?.caustic ?? 0 } };
  mat.userData.uniforms = u;
  mat.customProgramCacheKey = () => `terrain${style.style}/${style.pstyle}`;
  mat.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, u);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aRoad;\nvarying vec3 vRoad, vWp, vNw;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWp = (modelMatrix * vec4(transformed, 1.0)).xyz; vRoad = aRoad; vNw = normalize(mat3(modelMatrix) * objectNormal);');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + GLSL_COMMON)
      .replace('#include <color_fragment>', '#include <color_fragment>\n' + GLSL_COLOR)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = clamp(roughnessFactor * tRough, 0.04, 1.);')
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n' + GLSL_NORMAL)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += tEmis;');
  };
  return mat;
}
