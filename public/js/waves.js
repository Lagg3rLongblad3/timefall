// Wave generation. Deterministic for a given (wave number, seed), so both players of a duel face identical waves.
import { mulberry } from './data.js';

// Difficulty knobs (hp growth per wave, enemy-count multiplier, speed growth per wave).
// Tuned with a bot sweep (sim of full matches at three income levels): Easy stays forgiving, Medium punishes a slow
// economy, Hard needs a solid economy plus good placement.
export const TUNE = { a: 0.3, b: 0.04, count: 1, speed: 0.01 };

// Enemy hit-point multiplier for wave n (cfg is a DIFFS entry).
export const hpMul = (n, cfg) => cfg.hp * (1 + TUNE.a * (n - 1) + TUNE.b * (n - 1) * (n - 1));
export const speedMul = n => 1 + TUNE.speed * (n - 1);
export const isBossWave = n => n >= 10 && n % 5 === 0;

// Enemy groups that make up wave n. Groups spawn in parallel, each starting `delay` seconds into the wave.
export function groupsFor(n) {
  const c = TUNE.count, k = x => Math.floor(x * c);
  const g = [{ type: 'grunt', count: k(5 + 1.4 * n), gap: Math.max(0.5, 1.4 - 0.03 * n) / Math.sqrt(c), delay: 0 }];
  if (n >= 3) g.push({ type: 'runner', count: k(2 + 0.75 * n), gap: 0.7, delay: 2 });
  if (n >= 4 && n % 2 === 0) g.push({ type: 'swarm', count: k(8 + 1.2 * n), gap: 0.28, delay: 4 });
  if (n >= 5) g.push({ type: 'brute', count: Math.floor(n / 4 * c) + (n % 5 === 0 ? 1 : 0), gap: 2.4, delay: 6 });
  if (isBossWave(n)) g.push({ type: 'boss', count: Math.floor(n / 10), gap: 8, delay: 12 });
  return g.filter(x => x.count > 0);
}

// Spawn schedule [{ t, type }] sorted by time (seconds after the wave starts).
export function planWave(n, seed) {
  const rng = mulberry(((seed | 0) ^ Math.imul(n, 0x9e3779b1)) >>> 0);
  const out = [];
  for (const grp of groupsFor(n)) {
    for (let i = 0; i < grp.count; i++) out.push({ t: grp.delay + i * grp.gap + (rng() - 0.5) * grp.gap * 0.3, type: grp.type });
  }
  return out.sort((a, b) => a.t - b.t);
}

// e.g. [{ type: 'grunt', count: 12 }, ...] for the "next wave" preview
export const waveSummary = n => groupsFor(n).map(({ type, count }) => ({ type, count }));
