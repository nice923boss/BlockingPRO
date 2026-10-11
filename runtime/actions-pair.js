// Two-person actions: handshake, hug, give / receive. Both actors get the same clip (same start and length) with
// params.with = the other actor's id; the runtime passes ctx.partner = { pos (meters, this actor's root frame),
// height, type, body } so the hands meet wherever the two stand. Without a partner the pose assumes a twin at handshake distance.
import {
  UA, FA, Z3, clamp, smooth, bump, osc, add, sub, scl, len, mat, mul, app, bodyOf, solve, toChest, mix, nudge, stand,
} from "./actions-human.js";

const REACH = (UA + FA) * 0.97;
const PALM = 0.045; // wrist to palm centre along the fingers (height fraction)

// who = { type, body } of one person (body = the actor's sliders, optional)
const halfDepth = (H, who) => 0.075 * H * bodyOf(who).bulk; // chest to back surface, meters

// Height (m) where two people's hands meet: the shorter one's comfortable height, raised halfway toward the taller one's
export function meetHeight(Ha, Hb) {
  const a = 0.56 * Math.min(Ha, Hb), b = 0.56 * Math.max(Ha, Hb);
  return a + 0.5 * (b - a);
}

// Forward bow of a degrees at the hips, spine and chest, head kept up; the knees give a little as the bow deepens
const lean = (a) => ({
  rot: { hips: [0.55 * a, 0, 0], spine: [0.25 * a, 0, 0], chest: [0.2 * a, 0, 0], neck: [-0.3 * a, 0, 0], head: [-0.35 * a, 0, 0] },
  hips: [0, -0.0012 * a, -0.00133 * a],
});

// How far ahead (meters) someone can comfortably put the right palm at height y (m) on the line straight ahead:
// bowing up to 20 degrees, or 10 more than the bow that first gets the hand that low (45 at most).
// Both partners compute the same numbers, so they agree on where the hands meet.
function palmReach(H, who, y) {
  const s = bodyOf(who).s, r = 0.92 * (UA + FA);
  let best = 0, cap = 20;
  for (let a = 0; a <= Math.min(cap, 45); a += 5) {
    const { rot, hips } = lean(a), Mh = mat(rot.hips), Ms = mul(Mh, mat(rot.spine)), Mc = mul(Ms, mat(rot.chest));
    const sh = add(add(add(add([0, 0.55, 0], hips), app(Mh, [0, 0.02, 0])), app(Ms, [0, 0.14, 0])), app(Mc, [0, 0.115, 0]));
    const q = r * r - (sh[1] - y / H) ** 2 - (s - 0.016) ** 2;
    if (q <= 0) { cap = Math.max(cap, a + 15); continue; }
    best = Math.max(best, sh[2] + Math.sqrt(q) + PALM);
  }
  return best * H;
}

/** Where two people stand apart (meters, root to root) for a two-person action; a and b are { height, type, body? } */
export function pairDistance(type, a, b) {
  if (type === "hug") return halfDepth(a.height, a) + halfDepth(b.height, b) + 0.02;
  const y = meetHeight(a.height, b.height);
  return 0.88 * (palmReach(a.height, a, y) + palmReach(b.height, b, y));
}

// Partner in this actor's root frame as height fractions: position P, distance D, unit direction f, left of f, and
// mid = the floor point under where the hands meet, shared out by how far each one can reach
function partnerOf(ctx) {
  const H = ctx.height, pt = ctx.partner || { pos: [0, 0, pairDistance("handshake", ctx, ctx)], height: H, type: ctx.type, body: ctx.body };
  const P = [pt.pos[0] / H, 0, pt.pos[2] / H], D = Math.hypot(P[0], P[2]) || 1e-6;
  const y = meetHeight(H, pt.height), ra = palmReach(H, ctx, y), rb = palmReach(pt.height, pt, y);
  const f = [P[0] / D, 0, P[2] / D], split = ra + rb > 0 ? ra / (ra + rb) : 0.5;
  return { P, D, f, left: [f[2], 0, -f[0]], Hp: pt.height, back: halfDepth(pt.height, pt) / H, mid: [P[0] * split, 0, P[2] * split] };
}

// Root-frame direction in the chest frame of a spec
const dirToChest = (sp, d) => sub(toChest(sp, d), toChest(sp, Z3));

// Lean forward (bow at the hips, head kept up) until every wrist goal is within reach, then set the goals.
// goals: { r: rootPoint, l: rootPoint }; hands: { r: [fingerDir, palmNormal] in the root frame }
function reachWithLean(sp, b, goals, hands = {}, maxLean = 45) {
  let out = sp;
  for (let a = 0; a <= maxLean; a += 2.5) {
    out = nudge(sp, lean(a));
    const ok = Object.entries(goals).every(([s, P]) => len(sub(toChest(out, P), [s === "l" ? b.s : -b.s, 0.115, 0])) <= REACH);
    if (ok) break;
  }
  for (const [s, P] of Object.entries(goals)) {
    out[s + "W"] = toChest(out, P);
    if (hands[s]) out[s + "H"] = [...dirToChest(out, hands[s][0]), ...dirToChest(out, hands[s][1])];
  }
  return out;
}

// Where the two fists meet when something changes hands: on the line between the actors, a little below the
// handshake height, each fist centre a fist half-width to its owner's right so the two sit side by side
const handOverAt = (pr, H) => add(add(pr.mid, [0, (meetHeight(H, pr.Hp) - 0.04) / H, 0]), scl(pr.left, -0.02));

// In for the first quarter, out for the last fifth
const inOut = (u, a = 0.25, z = 0.2) => smooth(u / a) - smooth((u - 1 + z) / z);

export const PAIR_ACTIONS = {
  handshake: {
    label: "握手（雙人）", mask: "full", dur: 3, loop: false, pair: true, params: { with: "", rate: 2 },
    ui: { with: ["對象", "actor"], rate: ["每秒上下次數", 0, 4, 0.1] },
    pose(lt, p, ctx) {
      const b = bodyOf(ctx), u = clamp(lt / ctx.duration), pr = partnerOf(ctx), H = ctx.height;
      const y = meetHeight(H, pr.Hp) / H + (0.022 / H) * osc(lt, p.rate) * bump((u - 0.25) / 0.55);
      // the two right palms meet on the line between the actors; each palm centre sits half a hand thickness to its owner's right
      const M = add(add(pr.mid, [0, y, 0]), scl(pr.left, -0.016));
      const st = stand(b);
      const shake = reachWithLean({ ...st, rP: [-0.6, -1, -0.3] }, b, { r: sub(M, scl(pr.f, PALM)) }, { r: [pr.f, pr.left] });
      return solve(mix(st, shake, inOut(u)), b);
    },
  },
  hug: {
    label: "擁抱（雙人）", mask: "full", dur: 3.5, loop: false, pair: true, params: { with: "" }, ui: { with: ["對象", "actor"] },
    pose(lt, p, ctx) {
      const b = bodyOf(ctx), u = clamp(lt / ctx.duration), pr = partnerOf(ctx), k = pr.Hp / ctx.height;
      // hands on the partner's back; the taller one's arms go over the shoulders, the shorter one's around the waist
      const back = pr.D + pr.back;
      const top = 0.825 + 0.1, hi = Math.min(0.76 * k, top), lo = Math.min(0.64 * k, top - 0.1);
      const at = (y, side) => add(add(scl(pr.f, back), [0, y, 0]), scl(pr.left, side * 0.035 * k));
      const st = stand(b);
      const wrap = reachWithLean({
        ...st, rot: { chest: [2, 0, 0], neck: [0, -12, 0], head: [-4, -18, 0] },
        rP: [-1, 0.1, 0.3], lP: [1, -0.2, 0.3],
      }, b, { r: at(hi, 1), l: at(lo, -1) }, { r: [pr.left, scl(pr.f, -1)], l: [scl(pr.left, -1), scl(pr.f, -1)] }, 30);
      // arms open wide on the way in so they pass around the partner
      const open = { lW: [0.14, 0, 0.06], rW: [-0.14, 0, 0.06] };
      const w = inOut(u, 0.3, 0.22);
      return solve(nudge(mix(st, wrap, w), open, bump(u / 0.3)), b);
    },
  },
  give: {
    label: "遞出（雙人）", mask: "full", dur: 2.4, loop: false, pair: true, params: { with: "" }, ui: { with: ["對象", "actor"] },
    pose(lt, p, ctx) {
      const b = bodyOf(ctx), u = clamp(lt / ctx.duration), pr = partnerOf(ctx), M = handOverAt(pr, ctx.height);
      const st = stand(b), hold = { ...st, rW: [-0.1, -0.1, 0.17], rP: [-0.6, -1, -0.4], rH: [0, -0.2, 1, 1, 0, 0] };
      // fist thumb up, fingers toward the partner, as it was held: a cup or bottle stays upright
      const out = reachWithLean({ ...st, rP: [-0.6, -1, -0.3] }, b, { r: sub(M, scl(pr.f, PALM)) }, { r: [pr.f, pr.left] });
      const w = smooth(u / 0.45) - smooth((u - 0.6) / 0.35);
      return solve(u < 0.5 ? mix(hold, out, w) : mix(st, out, w), b);
    },
  },
  receive: {
    label: "接過（雙人）", mask: "full", dur: 2.4, loop: false, pair: true, params: { with: "" }, ui: { with: ["對象", "actor"] },
    pose(lt, p, ctx) {
      const b = bodyOf(ctx), u = clamp(lt / ctx.duration), pr = partnerOf(ctx), M = handOverAt(pr, ctx.height);
      const st = stand(b), hold = { ...st, rW: [-0.1, -0.1, 0.17], rP: [-0.6, -1, -0.4], rH: [0, -0.2, 1, 1, 0, 0] };
      // fist thumb up beside the giver's, closing on the object, then back to the holding pose
      const take = reachWithLean({ ...st, rP: [-0.6, -1, -0.3] }, b, { r: sub(M, scl(pr.f, PALM)) }, { r: [pr.f, pr.left] });
      const w = smooth(u / 0.45);
      return solve(u < 0.5 ? mix(st, take, w) : mix(take, hold, smooth((u - 0.55) / 0.4)), b);
    },
  },
};
