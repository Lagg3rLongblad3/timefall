// First-person tool animation: one keyframed chop (wind-up -> strike -> impact -> rebound -> recover) per era.
// Pure functions of time, so the motion can be unit-tested and previewed without a renderer.
//
// A swing is not a symmetric wobble: the tool first draws BACK (anticipation), then ACCELERATES into the target and
// lands at SWING.impact (that is when the hit, sound and particles fire), bounces off a little, and eases home.

export const SWING = { windUp: 0.11, strike: 0.055, rebound: 0.085, recover: 0.17 };
SWING.impact = SWING.windUp + SWING.strike;               // the instant the blade lands
SWING.total = SWING.impact + SWING.rebound + SWING.recover; // one chop (= the gathering rhythm)

// Poses are offsets from the idle pose: [x, y, z, rotX, rotY, rotZ]. The tool pivots around the hand (its grip).
const ZERO = [0, 0, 0, 0, 0, 0];
const KEYS = { // fitted so the blade passes through chosen screen positions while the whole tool stays in view
  ancient: { // a chop from the upper right, across and down through the middle of the view; the cutting edge leads
    raised:  [0.02, 0.17, -0.01, 0.55, 0.25, -0.27],
    impact:  [-0.10, 0.06, 0.10, -0.75, 0.35, 0.32],
    rebound: [-0.03, 0.06, 0.10, -0.65, 0.48, 0.25],   // the head bounces off the node
    follow:  [-0.20, 0.03, 0.05, -0.85, 0.14, 0.44],   // nothing to hit: the swing carries through
  },
  futuristic: { // plasma cutter: cocked back and up, then a long diagonal slash
    raised:  [0.09, 0.20, 0.15, 0.58, -0.11, 0.00],
    impact:  [-0.27, 0.06, -0.10, 0.36, 0.62, 0.02],
    rebound: [-0.19, 0.07, -0.08, 0.44, 0.50, 0.02],
    follow:  [-0.38, 0.04, -0.15, 0.19, 0.78, 0.03],
  },
};

const inOut = u => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);   // eases both ends (no jerk at phase joins)
const strikeEase = u => Math.pow(u, 2.4);                                          // starts slow, hits at full speed
const outCubic = u => 1 - Math.pow(1 - u, 3);                                      // fast bounce, slow settle

// Pose offsets at time t (seconds since the swing began). `connected` = the blade actually hit something, which
// decides between bouncing off (hit) and following through (miss). Writes into `out` to avoid allocating per frame.
export function swingPose(era, t, connected = true, out = [0, 0, 0, 0, 0, 0]) {
  const K = KEYS[era] || KEYS.ancient, { windUp, strike, impact, rebound, total } = SWING;
  const mix = (a, b, k) => { for (let i = 0; i < 6; i++) out[i] = a[i] + (b[i] - a[i]) * k; return out; };
  if (!(t > 0) || t >= total) return mix(ZERO, ZERO, 0);
  if (t < windUp) return mix(ZERO, K.raised, inOut(t / windUp));
  if (t < impact) return mix(K.raised, K.impact, strikeEase((t - windUp) / strike));
  const after = connected ? K.rebound : K.follow;
  if (t < impact + rebound) return mix(K.impact, after, outCubic((t - impact) / rebound));
  return mix(after, ZERO, inOut((t - impact - rebound) / SWING.recover));
}
