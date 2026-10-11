// Hand shapes of the human mannequin (a08). No three.js here so node tests can load it.
// Each side is decided on its own; later layers win:
//   the actor's `hands` < the full-body clip's usual shape < the upper clip's usual shape
//   < a prop held in that hand (a fist) < the full-body clip's `hands` < the upper clip's `hands`

export const HAND_SHAPES = { relaxed: "自然", open: "張開", fist: "握拳", point: "食指指向", thumbsUp: "比讚" };

// the usual shape for actions where the hands clearly do something
export const ACTION_HANDS = {
  point: { r: "point" }, wave: { r: "open" }, clap: { l: "open", r: "open" }, talk: { l: "open", r: "open" },
  handsUp: { l: "open", r: "open" }, shrug: { l: "open", r: "open" }, push: { l: "open", r: "open" }, carry: { l: "open", r: "open" },
  punch: { l: "fist", r: "fist" }, cheer: { l: "fist", r: "fist" }, phone: { r: "fist" }, drink: { r: "fist" }, think: { r: "fist" },
  openDoor: { r: "fist" }, lookPhone: { r: "fist" }, ride: { l: "fist", r: "fist" },
  liftBox: { l: "open", r: "open" }, putDown: { l: "open", r: "open" }, holdChild: { l: "open", r: "open" },
};

/**
 * The clip that shows most at time t on a track sorted by start (follows evalTrack in scene.js): a clip takes over
 * halfway through its blend-in and, unless it holds, lets go halfway through its fade-out.
 */
export function dominantClip(clips, t, holds) {
  for (let i = clips.length - 1; i >= 0; i--) {
    const c = clips[i], lt = t - c.start, half = (c.blend ?? 0.3) / 2;
    if (lt < 0) continue;
    if (lt < c.dur) { if (lt >= half) return c; continue; }
    return holds(c) || lt < c.dur + Math.max(half, 1e-3) ? c : null;
  }
  return null;
}

/**
 * Hand shapes for props held at time t: { l?, r? }. holdable(prop) = its built-in grip or null; the shape is the
 * grip's `shape` (a palm flat on a box, a baby on the forearm), else a fist.
 */
export function heldHands(props, actorId, t, holdable) {
  const out = {};
  for (const o of props) {
    for (const s of Array.isArray(o.attach) ? o.attach : o.attach ? [o.attach] : []) {
      if (s.actor !== actorId || t < (s.from ?? -Infinity) || t >= (s.to ?? Infinity)) continue;
      const grip = holdable(o), joint = s.joint || (grip ? "rHand" : null), shape = (grip && grip.shape) || "fist";
      if (joint === "rHand") out.r = shape;
      else if (joint === "lHand") out.l = shape;
    }
  }
  return out;
}

/** { l, r } shape names for a human actor at time t */
export function handsAt(actor, t, holds, held = {}) {
  const full = dominantClip(actor.actions || [], t, holds), upper = dominantClip(actor.upper || [], t, holds);
  const layers = [actor.hands, ACTION_HANDS[full?.type], ACTION_HANDS[upper?.type], held, full?.hands, upper?.hands];
  const out = { l: "relaxed", r: "relaxed" };
  for (const layer of layers) for (const side of ["l", "r"]) if (HAND_SHAPES[layer?.[side]]) out[side] = layer[side];
  return out;
}
