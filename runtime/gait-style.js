// Walking styles (a04): the same idle / walk / run read as tired, hurried or relaxed, plus an overall motion size (amp).
// stride / knee / arm / twist / sway scale the cycle; elbow and the pitch offsets (degrees, + bends forward) set the posture.
// The actor's gait { style, amp } is the default for these three actions; a clip's own params override it.
export const GAIT_STYLES = { normal: "一般", tired: "疲累", hurried: "急促", relaxed: "悠閒" };
export const AMP_RANGE = [0.5, 1.5];

const STYLES = {
  normal: { stride: 1, knee: 1, arm: 1, twist: 1, sway: 1, elbow: 0, spine: 0, chest: 0, neck: 0, head: 0 },
  // short dragging steps, arms hanging, torso and head sunk
  tired: { stride: 0.8, knee: 0.6, arm: 0.35, twist: 0.7, sway: 2, elbow: 8, spine: 8, chest: 6, neck: 8, head: 10 },
  // quick short steps, leaning in, elbows bent and pumping
  hurried: { stride: 0.9, knee: 1.15, arm: 1.5, twist: 1.2, sway: 0.6, elbow: -26, spine: 7, chest: 2, neck: -3, head: -4 },
  // long loose steps, upright with the chest open, more hip sway
  relaxed: { stride: 1.1, knee: 0.9, arm: 1.35, twist: 1.6, sway: 2.4, elbow: 8, spine: -3, chest: -4, neck: 0, head: -5 },
};

// Factors for a param set; amp scales stride and swing together so the steps keep pace with the path
export function gaitStyle(p) {
  const s = STYLES[p.style] || STYLES.normal;
  const a = Math.min(AMP_RANGE[1], Math.max(AMP_RANGE[0], typeof p.amp === "number" ? p.amp : 1));
  return { ...s, stride: s.stride * a, knee: s.knee * Math.sqrt(a), arm: s.arm * a, twist: s.twist * a }; // knee: a big stride does not need a much higher back kick
}

// rot with the style's torso and head pitch added
export function withPosture(rot, s) {
  const out = { ...rot };
  for (const j of ["spine", "chest", "neck", "head"]) {
    if (!s[j]) continue;
    const r = out[j] || [0, 0, 0];
    out[j] = [r[0] + s[j], r[1], r[2]];
  }
  return out;
}
