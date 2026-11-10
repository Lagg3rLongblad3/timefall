// Renders the real 3D tower / enemy models to small transparent PNGs (hotbar, arsenal, sabotage panel).
// Uses a throwaway WebGL context so it never touches the main renderer's state.
import * as THREE from 'three';
import { towerModel, enemyModel } from './models.js';
import { disposeTree } from './fx.js';
import { makeEnvironment } from './gfx.js';
import { TOWERS, ENEMIES } from './data.js';

const cache = {};

export function makeIcons(era, size = 128) {
  if (cache[era]) return cache[era];
  const out = (cache[era] = { towers: {}, enemies: {} });
  let renderer;
  try {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = size;
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
  } catch { return out; } // no WebGL: the UI falls back to colour swatches
  renderer.setSize(size, size, false); renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  const scene = new THREE.Scene();
  const env = makeEnvironment({ kind: 'day', zenith: 0x7a9ac8, horizon: 0xe4eaf2, sunDir: new THREE.Vector3(-0.5, 0.7, 0.45).normalize(), sunCol: 0xffffff, cover: 0.3, cloud: 0xffffff, shade: 0xa0b0c0 }, renderer);
  if (env) { scene.environment = env.texture; scene.environmentIntensity = 1.1; } else scene.add(new THREE.HemisphereLight(0xffffff, 0x55607a, 2.9));
  const sun = new THREE.DirectionalLight(0xffffff, env ? 2.6 : 3.6); sun.position.set(-4, 7, 5); scene.add(sun);
  const cam = new THREE.PerspectiveCamera(30, 1, 0.1, 200);
  const shoot = obj => {
    scene.add(obj);
    const s = new THREE.Box3().setFromObject(obj).getBoundingSphere(new THREE.Sphere());
    const d = (s.radius / Math.sin((cam.fov * Math.PI) / 360)) * 1.04;
    cam.position.set(s.center.x + d * 0.62, s.center.y + d * 0.42, s.center.z + d * 0.66); cam.lookAt(s.center);
    renderer.render(scene, cam);
    const url = renderer.domElement.toDataURL('image/png');
    scene.remove(obj); disposeTree(obj);
    return url;
  };
  try {
    for (const t of TOWERS[era]) out.towers[t.id] = shoot(towerModel(t.id));
    for (const k of Object.keys(ENEMIES)) out.enemies[k] = shoot(enemyModel(era, k));
  } catch (e) { console.warn('icon rendering failed', e); }
  env?.dispose(); renderer.dispose(); renderer.forceContextLoss?.();
  return out;
}
