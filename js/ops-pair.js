// Two-person actions (a02): put two people face to face at the right distance and give both the same clip.
// The actor shown in the panels (the primary) does the clicked action and moves; the other one stays and turns.
import { uid, actionsFor, attachList, packAttach } from "../runtime/schema.js";
import { buildPath, samplePath, sampleYaw } from "../runtime/keys.js";
import { resolveBody } from "../runtime/rig-human.js";
import { pairDistance } from "../runtime/actions-pair.js";
import { findEntity, selIds } from "./state.js";
import { putKey } from "./ops.js";
import { round, toast } from "./ui.js";

let S;
export function initPairOps(store) { S = store; }

// what the partner does when the primary does `type`
const PARTNER = { handshake: "handshake", hug: "hug", give: "receive", receive: "give" };

const where = (a, t) => {
  const path = buildPath(a.path.keys, a.path.curve);
  return { pos: samplePath(path, t).pos, yaw: sampleYaw(path, t, a.yaw, a.facing) };
};
const bodyInfo = (a) => ({ height: resolveBody(a.preset, a.body).height * (a.scale || 1), type: a.preset, body: a.body });

/** The other selected human when exactly two humans are selected and one of them is the primary, else null */
export function pairPartner(sel, project) {
  const ids = selIds(sel);
  if (ids.length !== 2 || !ids.includes(sel.id)) return null;
  const other = findEntity(project, ids.find((id) => id !== sel.id))?.spec;
  const me = findEntity(project, sel.id)?.spec;
  return me?.kind === "human" && other?.kind === "human" && other.id !== me.id ? other : null;
}

// Stand still at pos facing yaw from t to t + dur: a one-key path just moves; otherwise key t (and t + dur when
// the path goes on afterwards) and drop the keys in between so the two do not drift apart mid-action
function holdAt(spec, t, dur, pos, yaw, eps) {
  const keys = spec.path.keys;
  if (keys.length === 1) { keys[0] = { ...keys[0], v: pos, yaw }; return 0; }
  const end = t + dur, later = keys.some((k) => k.t > end + eps);
  const inside = keys.filter((k) => k.t > t + eps && k.t < end - eps).length;
  spec.path.keys = keys.filter((k) => !(k.t > t + eps && k.t < end - eps));
  spec.path.keys[putKey(spec.path.keys, t, pos, eps)].yaw = yaw;
  if (later) {
    const i = putKey(spec.path.keys, end, pos, eps);
    spec.path.keys[i].yaw = yaw;
  }
  return inside;
}

// Props the giver holds at time `at` go to the receiver's right hand from then on (with the giver's throw, if any).
// From the clip start the object is held upright, so a cup or bottle does not lie along the outstretched forearm.
function handOver(p, giver, taker, start, at) {
  const moved = [];
  for (const o of p.props) {
    const segs = attachList(o);
    const i = segs.findIndex((s) => s.actor === giver.id && at >= (s.from ?? -Infinity) && at < (s.to ?? Infinity));
    if (i < 0) continue;
    const seg = segs[i], { to, throw: fly, arc } = seg, before = (seg.from ?? -Infinity) < start - 1e-3;
    const next = segs.filter((_, j) => j !== i);
    if (before) next.push({ ...seg, to: start, throw: undefined, arc: undefined });
    next.push({ ...seg, ...(before && { from: start, blend: 0.4 }), to: at, upright: true, throw: undefined, arc: undefined });
    next.push({ actor: taker.id, joint: "rHand", from: at, upright: true, blend: 0.25, ...(to != null && { to }), ...(fly > 0 && { throw: fly, arc }) });
    o.attach = packAttach(next);
    moved.push(o.name);
  }
  return moved;
}

/** Primary does `type` with the other selected human: placed at pairDistance, both facing each other, same clip */
export function pairUp(type) {
  const P = S.project, other = pairPartner(S.sel, P);
  if (!other) { toast("先選兩個人類角色（按住 Ctrl 點第二個），再按雙人動作", "warn"); return; }
  const me = findEntity(P, S.sel.id).spec, t = round(S.time, 2);
  const lib = actionsFor(me), act = lib[type], back = actionsFor(other)[PARTNER[type]];
  const dur = Math.max(act.dur, back.dur);
  const A = where(other, t), B = where(me, t);
  // keep the direction the two already have between them; if they stand on the same spot use the partner's facing
  let dx = B.pos[0] - A.pos[0], dz = B.pos[2] - A.pos[2], d = Math.hypot(dx, dz);
  if (d < 0.05) { dx = Math.sin(A.yaw * Math.PI / 180); dz = Math.cos(A.yaw * Math.PI / 180); d = 1; }
  const D = pairDistance(type === "hug" ? "hug" : "handshake", bodyInfo(me), bodyInfo(other));
  const pos = [round(A.pos[0] + dx / d * D, 3), B.pos[1], round(A.pos[2] + dz / d * D, 3)];
  const yawMe = round(Math.atan2(-dx, -dz) * 180 / Math.PI, 1), yawOther = round(Math.atan2(dx, dz) * 180 / Math.PI, 1);
  let dropped = 0, moved = [];
  const c1 = uid("c"), c2 = uid("c");
  S.edit(`雙人動作：${act.label}`, (p) => {
    const eps = 0.5 / p.settings.fps;
    const m = findEntity(p, me.id).spec, o = findEntity(p, other.id).spec;
    dropped = holdAt(m, t, dur, pos, yawMe, eps) + holdAt(o, t, dur, A.pos.map((x) => round(x, 3)), yawOther, eps);
    m.actions.push({ id: c1, type, start: t, dur, params: { with: o.id } });
    o.actions.push({ id: c2, type: PARTNER[type], start: t, dur, params: { with: m.id } });
    // the object changes hands halfway, when the giver's palm is out and the taker's hand is on it
    if (type === "give") moved = handOver(p, m, o, t, round(t + dur / 2, 3));
    if (type === "receive") moved = handOver(p, o, m, t, round(t + dur / 2, 3));
  });
  S.select({ id: me.id, clip: { track: "actions", id: c1 } });
  toast(`「${me.name}」與「${other.name}」相距 ${D.toFixed(2)} 公尺${dropped ? `，移除了片段期間的 ${dropped} 個路徑點` : ""}${moved.length ? `，${moved.join("、")}在 ${round(t + dur / 2, 2)} 秒交到對方手上` : ""}`);
}
