// Static game data: eras, resources, towers, enemies, difficulties, maps
export const RES = {
  ancient: [
    { id: 'wood', name: 'Wood', color: '#b8854f', icon: '🪵' },
    { id: 'stone', name: 'Stone', color: '#a8a8a8', icon: '🪨' },
    { id: 'bronze', name: 'Bronze', color: '#e0903c', icon: '🔶' },
    { id: 'gold', name: 'Gold', color: '#ffd84d', icon: '🏺' },
  ],
  futuristic: [
    { id: 'scrap', name: 'Scrap', color: '#aab8c8', icon: '⚙️' },
    { id: 'crystal', name: 'Crystal', color: '#4de3ff', icon: '💎' },
    { id: 'circuit', name: 'Circuit', color: '#6dff8f', icon: '🔌' },
    { id: 'core', name: 'Plasma Core', color: '#ff4de1', icon: '🔮' },
  ],
};

export const TOWERS = {
  ancient: [
    { id: 'ballista', name: 'Ballista', color: 0xb8854f, cost: { wood: 25, stone: 10 }, range: 24, dmg: 30, cd: 1.7,
      desc: 'Giant bolt pierces EVERY enemy in a line.' },
    { id: 'catapult', name: 'Catapult', color: 0x9b7a55, cost: { wood: 30, stone: 30 }, range: 30, minRange: 8, dmg: 58, cd: 3.2, splash: 5,
      desc: 'Lobs boulders for big splash damage. Can\'t hit up close.' },
    { id: 'brazier', name: 'Brazier of Ra', color: 0xff7a1a, cost: { wood: 20, bronze: 12 }, range: 15, dmg: 6, cd: 1.1, burn: 14,
      desc: 'Ignites enemies. Flames spread to neighbours.' },
    { id: 'totem', name: 'Frost Totem', color: 0x7fd8ff, cost: { stone: 25, bronze: 10 }, range: 14, dmg: 4, cd: 1, slow: 0.5,
      desc: 'Aura that slows every enemy in range by half.' },
    { id: 'obelisk', name: 'Storm Obelisk', color: 0xb8a6ff, cost: { stone: 40, gold: 8 }, range: 18, dmg: 30, cd: 1.5, chain: 4,
      desc: 'Lightning chains between 4 enemies.' },
    { id: 'sphinx', name: 'Sphinx Guardian', color: 0xe6c36a, cost: { stone: 50, bronze: 20, gold: 12 }, range: 13, dmg: 38, cd: 7, stun: 1.8,
      desc: 'Thunderous roar stuns & damages all in range.' },
  ],
  futuristic: [
    { id: 'laser', name: 'Pulse Laser', color: 0xff4d4d, cost: { scrap: 25, circuit: 10 }, range: 19, dmg: 10, cd: 0, ramp: 6,
      desc: 'Continuous beam. Damage ramps the longer it holds a target.' },
    { id: 'railgun', name: 'Railgun', color: 0x6fb7ff, cost: { scrap: 40, crystal: 20 }, range: 36, dmg: 170, cd: 4.2,
      desc: 'Snipes the strongest enemy on the map side. Huge damage.' },
    { id: 'tesla', name: 'Tesla Coil', color: 0xa9f1ff, cost: { scrap: 20, crystal: 15, circuit: 5 }, range: 12, dmg: 10, cd: 0.5, multi: 3,
      desc: 'Rapidly zaps up to 3 enemies at once.' },
    { id: 'gravity', name: 'Gravity Well', color: 0xa05cff, cost: { crystal: 25, circuit: 20 }, range: 15, dmg: 5, cd: 1, pull: 3.2, slow: 0.35,
      desc: 'Drags enemies BACKWARD along the path & slows them.' },
    { id: 'hive', name: 'Drone Hive', color: 0x6dff8f, cost: { scrap: 30, circuit: 25 }, range: 21, dmg: 10, cd: 0.7, drones: 3,
      desc: 'Deploys 3 hovering combat drones.' },
    { id: 'nova', name: 'Nova Core', color: 0xff4de1, cost: { crystal: 35, circuit: 30, core: 10 }, range: 14, dmg: 130, cd: 9,
      desc: 'Charges up, then detonates a massive blast around itself.' },
  ],
};

export const ENEMIES = {
  grunt:  { hp: 60,   speed: 3.3, dmg: 1,  size: 0.9, name: 'Grunt' },
  runner: { hp: 36,   speed: 5.8, dmg: 1,  size: 0.7, name: 'Runner' },
  brute:  { hp: 260,  speed: 2.0, dmg: 3,  size: 1.4, name: 'Brute' },
  swarm:  { hp: 20,   speed: 4.2, dmg: 1,  size: 0.5, name: 'Swarmling' },
  boss:   { hp: 1800, speed: 1.6, dmg: 10, size: 2.3, name: 'Colossus' },
};

export const DIFFS = {
  easy:   { label: 'Easy',   waves: 10, hp: 0.8, base: 30, start: 60, rare: 20, nodes: 1.3 },
  medium: { label: 'Medium', waves: 15, hp: 1.0, base: 20, start: 40, rare: 10, nodes: 1.0 },
  hard:   { label: 'Hard',   waves: 20, hp: 1.35, base: 12, start: 25, rare: 0,  nodes: 0.8 },
};
export const DIFF_KEYS = ['easy', 'medium', 'hard'];

const NAMES = {
  ancient: {
    easy:   ['Sunlit Meadows', 'Olive Terraces', 'Nile Delta', 'Shepherd\'s Vale', 'Marble Quarry', 'Harvest Plains'],
    medium: ['Dune Caravan', 'Cedar Highlands', 'Oracle\'s Gorge', 'Jade River', 'Salt Flats of Ur', 'Frozen Steppe'],
    hard:   ['Ashen Volcano', 'Titan\'s Stair', 'Labyrinth of Minos', 'Blood Canyon', 'Underworld Gate', 'Fall of Atlantis'],
  },
  futuristic: {
    easy:   ['Neon Outskirts', 'Orbital Garden', 'Solar Array', 'Chrome Plains', 'Docking Bay 9', 'Skyline Drift'],
    medium: ['Mars Colony', 'Toxic Foundry', 'Cryo Station', 'Data Canyon', 'Reactor Ridge', 'Ruined Megacity'],
    hard:   ['Singularity Edge', 'Machine Hive', 'Void Platform', 'Plasma Storm', 'Dead Moon Core', 'The Final Grid'],
  },
};

// 6 themes per era (selected by map index)
const THEMES = {
  ancient: [
    { g1: 0x4f8f3a, g2: 0x7fb04a, sky: 0x9fd4ff, fog: 0xbfe0ff, path: 0xb89a6a, deco: 'tree' },
    { g1: 0xd9b36a, g2: 0xe8cf8e, sky: 0xf2d9a0, fog: 0xf0dcae, path: 0xa7794a, deco: 'palm' },
    { g1: 0x8a8f7a, g2: 0xaab090, sky: 0xb9c6d6, fog: 0xc7d0da, path: 0x7a6a58, deco: 'pillar' },
    { g1: 0x2f7a3a, g2: 0x4aa05a, sky: 0x8fcf9f, fog: 0xa9d6b5, path: 0x8a6a45, deco: 'tree' },
    { g1: 0x4a3a35, g2: 0x7a3a28, sky: 0x5a2a2a, fog: 0x6a3a30, path: 0x2b2420, deco: 'spike' },
    { g1: 0xe6eef4, g2: 0xc3d3de, sky: 0xcfe0ee, fog: 0xdfeaf2, path: 0x8c8f93, deco: 'pillar' },
  ],
  futuristic: [
    { g1: 0x16243a, g2: 0x1f6f8f, sky: 0x0a1228, fog: 0x0d1a33, path: 0x3a4a66, deco: 'pylon' },
    { g1: 0x2a1238, g2: 0x7a1f8f, sky: 0x1a0a2e, fog: 0x2a1040, path: 0x4a2a66, deco: 'crystal' },
    { g1: 0x7a3a22, g2: 0xb5532e, sky: 0x4a2418, fog: 0x7a4430, path: 0x3a2a24, deco: 'pylon' },
    { g1: 0x1f3a1a, g2: 0x4f8f2a, sky: 0x10240f, fog: 0x1a3a18, path: 0x2a3a2a, deco: 'crystal' },
    { g1: 0x9fc4de, g2: 0xe4f3ff, sky: 0x7aa0c4, fog: 0xa8c6e0, path: 0x5c7a96, deco: 'pylon' },
    { g1: 0x0d0d14, g2: 0x2a2a44, sky: 0x050508, fog: 0x0a0a12, path: 0x303048, deco: 'crystal' },
  ],
};

export function getMap(era, diff, idx) {
  const di = DIFF_KEYS.indexOf(diff);
  const seed = (era === 'ancient' ? 1000 : 5000) + di * 100 + idx * 7 + 13;
  return {
    era, diff, idx, seed,
    name: NAMES[era][diff][idx],
    theme: THEMES[era][idx],
    amp: 5 + ((idx * 5 + di * 3) % 6) * 1.6 + (era === 'futuristic' ? 1 : 0),
    freq: 0.018 + (idx % 3) * 0.006,
    turns: 3 + di + Math.floor(idx / 2),
    wind: 28 + idx * 6,
    nodeCount: Math.round((era === 'ancient' ? 85 : 80) * DIFFS[diff].nodes),
  };
}

export const ERAS = {
  ancient:    { label: 'Ancient',    icon: '🏛️', tag: 'Bronze, stone and thunder' },
  futuristic: { label: 'Futuristic', icon: '🚀', tag: 'Plasma, steel and gravity' },
};

// Seconds before wave 1 (prep) and between wave starts (gap). Waves arrive on the clock; calling one early is allowed in solo.
export const WAVE_TIMING = { easy: { prep: 55, gap: 42 }, medium: { prep: 45, gap: 36 }, hard: { prep: 38, gap: 30 } };

// Duel (PvP): both players get the same map and seed, waves are endless and escalate, first base to fall loses.
export const PVP = { diff: 'medium', prep: 42, gap: 32, base: 20, start: 40, rare: 10 };

export const NODE_RESPAWN = [55, 65, 85, 110]; // seconds a harvested node stays gone, by resource tier
export const MAX_LEVEL = 3;

// Sabotage (duel only): spend resources to send extra enemies down your rival's road. cost = amounts of resource tier 0..3.
export const SENDS = [
  { key: 'Z', type: 'swarm',  n: 12, cost: [10, 12, 0, 0],  label: 'Swarm Rush' },
  { key: 'X', type: 'runner', n: 6,  cost: [16, 10, 4, 0],  label: 'Runner Pack' },
  { key: 'C', type: 'brute',  n: 2,  cost: [20, 26, 8, 0],  label: 'Brute Squad' },
  { key: 'V', type: 'boss',   n: 1,  cost: [30, 30, 14, 6], label: 'Colossus' },
];
export const SEND_COOLDOWN = 6;

// Starting stockpile: tiers 0 and 1 are common, 2 and 3 are the rarer materials.
export function startRes(era, cfg) {
  const r = RES[era];
  return { [r[0].id]: cfg.start, [r[1].id]: cfg.start, [r[2].id]: cfg.rare, [r[3].id]: Math.floor(cfg.rare / 3) };
}

export function mulberry(a) {
  return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
