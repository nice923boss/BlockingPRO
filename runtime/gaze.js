// Gaze (a01): an actor's neck and head turn toward another actor or a fixed point for a while.
// Pure math (no three.js) so node tests can import it; runtime/gaze-rig.js applies it to the joints.
//
// actor.gaze = [{ start, dur, actor?: id, point?: [x, y, z], blend?: seconds }]
// The head turns over `blend` seconds from `start`, holds until start + dur, then turns back over `blend`.
// A later segment takes over from an earlier one while both are on, so back-to-back segments hand over without a dip.
import { smoothstep } from "./keys.js";

export const GAZE_BLEND = 0.4;
// how far the head can turn before the body would have to (degrees): left / right, up, down
export const GAZE_LIMITS = { yaw: 75, up: 35, down: 45 };

/** 0..1 strength of one segment at time t */
export function gazeWeight(seg, t) {
  const b = seg.blend > 0 ? seg.blend : GAZE_BLEND, end = seg.start + seg.dur;
  if (t < seg.start) return 0;
  const w = smoothstep(0, b, t - seg.start);
  return t <= end ? w : w * (1 - smoothstep(0, b, t - end));
}

/** Clamped head angles (degrees) for a direction given in the frame the neck turns in (+Z ahead, +X the actor's left, +Y up) */
export function gazeAngles(x, y, z) {
  const L = GAZE_LIMITS;
  const yaw = Math.atan2(x, z) * 180 / Math.PI, pitch = Math.atan2(-y, Math.hypot(x, z)) * 180 / Math.PI; // pitch > 0 looks down
  return { yaw: Math.max(-L.yaw, Math.min(L.yaw, yaw)), pitch: Math.max(-L.up, Math.min(L.down, pitch)) };
}

/**
 * Combine segments that are on at time t. entries: [{ w, yaw, pitch }] in start order.
 * Returns { yaw, pitch, w } where w is how much the gaze replaces the action's own neck and head, or null when no segment is on.
 */
export function mixGaze(entries) {
  let out = null;
  for (const e of entries) {
    if (!(e.w > 0)) continue;
    if (!out) { out = { yaw: e.yaw, pitch: e.pitch, w: e.w }; continue; }
    out = { yaw: out.yaw + (e.yaw - out.yaw) * e.w, pitch: out.pitch + (e.pitch - out.pitch) * e.w, w: Math.min(1, out.w + e.w) };
  }
  return out;
}
