// One-click sit (a09): a human walks to a free spot on a chair, bench or sofa, turns around and sits down.
import { uid } from "../runtime/schema.js";
import { buildPath, samplePath, sampleYaw, sampleSpeed } from "../runtime/keys.js";
import { resolveBody } from "../runtime/rig-human.js";
import { findEntity, selIds } from "./state.js";
import { round, toast } from "./ui.js";

let S;
export function initSitOps(store) { S = store; }

// Where the hips go, in the prop's own space before scale ([x, z] per spot), seat top height and half width (sizes from props.js)
export const SEATS = {
  chair: { spots: [[0, 0]], h: 0.45, half: 0.24 },
  bench: { spots: [[-0.42, 0], [0, 0], [0.42, 0]], h: 0.45, half: 0.82 },
  sofa: { spots: [[-0.56, 0.06], [0, 0.06], [0.56, 0.06]], h: 0.42, half: 1 },
};
const WALK = 1.2; // m/s
const BACK = 0.24; // seated hips end 0.24 x height behind the feet (seated() in runtime/actions-human.js)
const SIT_DUR = 1.5, STAND_DUR = 1.6;
const D2R = Math.PI / 180;

const heading = (a, b) => round(Math.atan2(b[0] - a[0], b[2] - a[2]) / D2R, 1);
const turnOf = (a, b) => Math.abs((((b - a) % 360) + 540) % 360 - 180);
const flat = (a, b) => Math.hypot(b[0] - a[0], b[2] - a[2]);
const where = (spec, t) => {
  const path = buildPath(spec.path.keys, spec.path.curve);
  return { pos: samplePath(path, t).pos, yaw: sampleYaw(path, t, spec.yaw, spec.facing), speed: sampleSpeed(path, t) };
};

/** The human and the seat when the selection is exactly one of each (either one primary), else null */
export function sitPair(sel, project) {
  const specs = selIds(sel).map((id) => findEntity(project, id)?.spec);
  if (specs.length !== 2) return null;
  const actor = specs.find((x) => x?.kind === "human"), seat = specs.find((x) => x && !x.kind && SEATS[x.type]);
  return actor && seat ? { actor, seat } : null;
}

// the sit or sitting clip a is in at time t, if any
function seatedClip(a, t) {
  let last = null;
  for (const c of a.actions) if (c.start <= t && (!last || c.start >= last.start)) last = c;
  return last && (last.type === "sit" || last.type === "sitting") && (t < last.start + last.dur || last.hold !== false) ? last : null;
}

/**
 * Plan the walk: free spot nearest to the actor, the path around the seat (never through it from behind),
 * and the times. Returns null with a reason when there is no free spot.
 */
export function planSit(project, a, o, t0) {
  const def = SEATS[o.type], H = resolveBody(a.preset, a.body).height * (a.scale || 1);
  const seated = seatedClip(a, t0), tw = seated ? round(t0 + STAND_DUR, 2) : t0;
  const me = where(a, t0), seat = where(o, tw);
  const sc = Array.isArray(o.scale) ? o.scale : [o.scale, o.scale, o.scale];
  const y = seat.yaw * D2R, f = [Math.sin(y), Math.cos(y)], r = [Math.cos(y), -Math.sin(y)];
  // prop-local (x across, z forward, already scaled) to world, at the actor's floor height
  const at = (x, z, h) => [round(seat.pos[0] + r[0] * x + f[0] * z, 3), h, round(seat.pos[2] + r[1] * x + f[1] * z, 3)];
  const back = BACK * H, end = project.settings.duration;
  const others = project.actors.filter((x) => x.id !== a.id);
  const taken = (p) => others.some((x) => [tw, end].some((t) => flat(where(x, t).pos, p) < 0.3));
  const spots = def.spots.map(([x, z]) => ({ x: x * sc[0], z: z * sc[2] + back }))
    .map((s) => ({ ...s, root: at(s.x, s.z, seat.pos[1]) }))
    .filter((s) => !taken(s.root))
    .sort((p, q) => flat(me.pos, p.root) - flat(me.pos, q.root));
  if (!spots.length) return { error: `「${o.name}」的座位都有人了` };
  const spot = spots[0];
  // come round the side when starting behind or beside the seat
  const rel = [me.pos[0] - seat.pos[0], me.pos[2] - seat.pos[2]];
  const front = rel[0] * f[0] + rel[1] * f[1], side = rel[0] * r[0] + rel[1] * r[1] < spot.x ? -1 : 1;
  const out = side * (def.half * sc[0] + 0.45), pts = [me.pos.map((v) => round(v, 3))];
  if (front < 0) pts.push(at(out, 0, me.pos[1]));
  if (front < spot.z) pts.push(at(out, spot.z + 0.35, me.pos[1]));
  pts.push(spot.root);
  return { H, seated, tw, me, pts, seatYaw: round(seat.yaw, 1), seatH: round(def.h * sc[1], 3), spot };
}

/** Actor a walks from the playhead to the seat, turns and sits; everything on a's path after the playhead is replaced */
export function sitOn(actorId, seatId) {
  const P = S.project, a = findEntity(P, actorId)?.spec, o = findEntity(P, seatId)?.spec;
  if (a?.kind !== "human" || !o || !SEATS[o.type]) return;
  const t0 = round(S.time, 2), plan = planSit(P, a, o, t0);
  if (plan.error) { toast(plan.error, "warn"); return; }
  const { seated, tw, me, pts, seatYaw, seatH } = plan;
  // keys from the walk start: turn on the spot first when standing, walk at WALK, turn to the seat's facing at the end
  const keys = [];
  const add = (t, v, yaw) => keys.push({ t: round(t, 2), v, yaw: round(yaw, 1), e: "linear" });
  let t = tw, yaw = me.yaw;
  if (seated) add(t0, pts[0], yaw);
  add(t, pts[0], yaw);
  let dist = 0;
  for (let i = 1; i < pts.length; i++) {
    const h = heading(pts[i - 1], pts[i]), d = flat(pts[i - 1], pts[i]);
    if (d < 0.05) continue;
    if (i === 1 && Math.abs(me.speed) < 0.3 && turnOf(yaw, h) > 30) { t += 0.2 + 0.4 * turnOf(yaw, h) / 180; add(t, pts[0], h); }
    t += d / WALK; dist += d; yaw = h;
    add(t, pts[i], h);
  }
  const arrive = t;
  t += 0.3 + 0.6 * turnOf(yaw, seatYaw) / 180;
  add(t, pts[pts.length - 1], seatYaw);
  const sitAt = round(t, 2), end = P.settings.duration, rest = round(end - sitAt - SIT_DUR, 2);
  const eps = 0.5 / P.settings.fps;
  const dropped = a.path.keys.filter((k) => k.t > keys[0].t + eps).length;
  const later = a.actions.filter((c) => c.start > t0 + eps).length; // full-body clips that may cover the sit
  const sitId = uid("c");
  S.edit(`走過去坐下：${o.name}`, (p) => {
    const m = findEntity(p, a.id).spec;
    m.path.keys = [...m.path.keys.filter((k) => k.t <= keys[0].t - eps), ...keys];
    if (seated) {
      const c = m.actions.find((x) => x.id === seated.id); // the old seated clip ends where standing up begins
      if (c.start + c.dur > t0) c.dur = round(Math.max(0.1, t0 - c.start), 2);
      m.actions.push({ id: uid("c"), type: "standUp", start: t0, dur: STAND_DUR, params: { seat: seated.params?.seat ?? 0.45 } });
    }
    m.actions.push({ id: sitId, type: "sit", start: sitAt, dur: SIT_DUR, params: { seat: seatH } });
    if (rest >= 0.5) m.actions.push({ id: uid("c"), type: "sitting", start: round(sitAt + SIT_DUR, 2), dur: rest, params: { seat: seatH } });
  });
  S.select({ id: a.id, clip: { track: "actions", id: sitId } });
  const msg = [`「${a.name}」${seated ? "起身後" : ""}走 ${dist.toFixed(1)} 公尺到「${o.name}」，${round(arrive, 2)} 秒到，${sitAt} 秒坐下`];
  if (dropped) msg.push(`取代了之後的 ${dropped} 個路徑點`);
  if (later) msg.push(`播放頭之後原本還有 ${later} 個全身動作片段，可能蓋過坐下，請到時間軸確認`);
  if (sitAt + SIT_DUR > end) msg.push(`坐下要到 ${round(sitAt + SIT_DUR, 2)} 秒，超出總長 ${end} 秒`);
  if (seatH < 0.25 || seatH > 0.75) msg.push(`座高 ${seatH} 公尺超出坐下動作的範圍（0.25 到 0.75）`);
  toast(msg.join("；"), later || sitAt + SIT_DUR > end || seatH < 0.25 || seatH > 0.75 ? "warn" : "info");
}
