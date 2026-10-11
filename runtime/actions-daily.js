// Everyday actions (a03): open a door, type, look at a phone, lift and put down a box, hold a baby, ride a scooter
// or a bicycle. The props that go with them: box and baby attach to rHand with their built-in holds, and a ridden
// vehicle attaches to the rider's root ({ joint: "root" }, runtime/attach.js). Stairs need no action: actors that
// walk onto stairs or steps climb them (runtime/terrain.js), and talking on the phone while walking is the phone
// upper clip on a moving actor.
import {
  TAU, Z3, UA, FA, clamp, osc, add, sub, scl, dot, len, nrm, lerpV, mat, mul, tr, app,
  bodyOf, solve, toChest, track, upHang, stand, raise, carryTarget,
} from "./actions-human.js";

// Root-frame direction expressed in the chest frame of a spec
function dirToChest(sp, v) {
  const r = sp.rot, Mc = mul(mul(mat(r.hips || Z3), mat(r.spine || Z3)), mat(r.chest || Z3));
  return nrm(app(tr(Mc), v));
}

// Elbow (chest frame) of the arm armIK builds for wrist T and pole, so a hand can line up with its forearm
function elbow(b, side, T, pole) {
  const S = [side === "l" ? b.s : -b.s, 0.115, 0], v = sub(T, S), u = nrm(v), D = Math.min(len(v), (UA + FA) * 0.9999);
  const ca = clamp((UA * UA + D * D - FA * FA) / (2 * UA * D), -1, 1);
  const pp = nrm(sub(pole, scl(u, dot(pole, u))));
  return add(S, add(scl(u, UA * ca), scl(pp, UA * Math.sqrt(1 - ca * ca))));
}

// Squatting over the built-in box (0.45 m) on the floor with its centre 0.49 m ahead, palms on its sides
function boxLow(b, H) {
  const sp = {
    ...stand(b), rot: { hips: [35, 0, 0], spine: [18, 0, 0], chest: [8, 0, 0], neck: [-8, 0, 0], head: [-14, 0, 0] },
    hips: [0, -0.28, -0.12], kOut: 14, lA: [b.hw + 0.05, 0.04, 0], rA: [-b.hw - 0.05, 0.04, 0], lP: [0.8, -0.3, -1], rP: [-0.8, -0.3, -1],
  };
  sp.lW = toChest(sp, scl([0.245, 0.31, 0.47], 1 / H));
  sp.rW = toChest(sp, scl([-0.245, 0.31, 0.47], 1 / H));
  const f = dirToChest(sp, [0, -0.5, 0.85]);
  sp.lH = [...f, ...dirToChest(sp, [-1, 0, 0])];
  sp.rH = [...f, ...dirToChest(sp, [1, 0, 0])];
  return sp;
}
const carried = (b) => ({ ...stand(b), ...carryTarget() });

export const DAILY_ACTIONS = {
  openDoor: {
    label: "開門", mask: "upper", dur: 2.5, loop: false, params: { push: 1 }, ui: { push: ["推門（1）或拉門（0）", 0, 1, 1] },
    pose(lt, p, ctx) {
      const b = bodyOf(ctx), H = ctx.height, u = clamp(lt / ctx.duration), dir = p.push >= 0.5 ? 1 : -1;
      const at = (rot, P) => toChest({ rot }, scl(P, 1 / H));
      // right wrist on a knob 1 m high, the door leaf 0.45 m ahead (meters). The built-in door opens away from its
      // front, so pushing has the hinge on the person's left (knob to the right) and pulling has it on the right
      const knob = [dir > 0 ? -0.2 : 0.1, 0.98, 0.3], yw = dir > 0 ? -1 : 0.5;
      const look = { spine: [3, 0, 0], chest: [2, 4 * yw, 0], neck: [4, 6 * yw, 0], head: [8, 8 * yw, 0] };
      const reach = { rot: look, rW: at(look, knob), rP: [-0.6, -1, -0.2], rH: [0.25, -0.1, 1, 1, 0, -0.25] };
      const turned = { ...reach, rH: [0.25, -0.1, 1, 0.77, 0.64, -0.2] };
      // the knob swings about the hinge: away when pushing, closer when pulling
      const lean = { ...look, spine: [3 + 3 * dir, 0, 0], chest: [2 + 2 * dir, 4 * yw, 0] };
      const moved = { ...turned, rot: lean, rW: at(lean, add(knob, [0.02 * dir, 0, 0.15 * dir])) };
      return solve(track([[0, upHang(b)], [0.28, reach], [0.4, turned], [0.78, moved], [0.88, moved], [1, upHang(b)]], u), b);
    },
  },
  typing: {
    label: "打字", mask: "upper", dur: 4, loop: true, params: { rate: 4 }, ui: { rate: ["每秒敲鍵次數", 1, 8, 0.5] },
    pose(lt, p, ctx) {
      const b = bodyOf(ctx), w = osc(lt, p.rate / 2), tap = (sg) => [0, -0.006 * Math.max(0, sg * w), 0];
      return solve({
        rot: { spine: [3, 0, 0], chest: [2, 0, 0], neck: [3, 0, 0], head: [6 + osc(lt, 0.2), 3 * osc(lt, 0.13), 0] },
        lW: add([0.085, -0.05, 0.2], tap(1)), rW: add([-0.085, -0.05, 0.2], tap(-1)), lP: [1, -1, -0.3], rP: [-1, -1, -0.3],
        lH: [-0.1, -0.3, 1, 0, -1, 0], rH: [0.1, -0.3, 1, 0, -1, 0],
      }, b);
    },
  },
  lookPhone: {
    label: "看手機", mask: "upper", dur: 4, loop: false, params: {}, ui: {},
    pose(lt, p, ctx) {
      const b = bodyOf(ctx);
      const tgt = {
        rot: { chest: [1, 0, 0], neck: [10, 0, 0], head: [18 + osc(lt, 0.25), -2, 0] },
        rW: [-0.05, -0.02, 0.16], rP: [-0.5, -1, 0], rH: [0.25, 0.5, 0.83, 0.2, 0.88, -0.44],
      };
      return solve(raise(lt, ctx, b, tgt, 0.5, { rW: [-0.03, 0, 0.06] }), b);
    },
  },
  liftBox: {
    label: "搬起箱子", mask: "full", dur: 2.4, loop: false, params: {}, ui: {},
    pose(lt, p, ctx) {
      const b = bodyOf(ctx), u = clamp(lt / ctx.duration), low = boxLow(b, ctx.height);
      return solve(track([[0, stand(b)], [0.35, low], [0.5, low], [0.9, carried(b)], [1, carried(b)]], u), b);
    },
  },
  putDown: {
    label: "放下箱子", mask: "full", dur: 2.4, loop: false, params: {}, ui: {},
    pose(lt, p, ctx) {
      const b = bodyOf(ctx), u = clamp(lt / ctx.duration), low = boxLow(b, ctx.height);
      return solve(track([[0, carried(b)], [0.4, low], [0.55, low], [1, stand(b)]], u), b);
    },
  },
  holdChild: {
    label: "抱小孩", mask: "upper", dur: 4, loop: false, params: { rock: 1 }, ui: { rock: ["搖晃幅度", 0, 2, 0.1] },
    pose(lt, p, ctx) {
      const b = bodyOf(ctx), sway = p.rock * osc(lt, 0.5);
      // right forearm across the waist, palm up, the baby along it; the left hand rests on the baby
      const rW = [0.02, -0.05, 0.14], rP = [-1, -0.6, 0], E = elbow(b, "r", rW, rP);
      const f = nrm(sub(rW, E)), up = nrm(sub([0, 1, 0], scl(f, f[1])));
      const lf = nrm([-1, 0, 0.3]), palm = add(lerpV(rW, E, 0.3), scl(up, 0.104));
      const tgt = {
        rot: { chest: [-2, 3 * sway, 0], neck: [6, 0, 0], head: [14, 2 * sway, 0] },
        rW, rP, rH: [...f, ...up], lW: sub(palm, scl(lf, 0.045)), lP: [1, -0.4, -0.3], lH: [...lf, 0, -1, 0],
      };
      return solve(raise(lt, ctx, b, tgt, 0.6, { rW: [0, 0, 0.06], lW: [0, 0, 0.08] }), b);
    },
  },
  ride: {
    label: "騎車", mask: "full", dur: 4, loop: true, params: { vehicle: "motorcycle" },
    ui: { vehicle: ["車種", "choice", { motorcycle: "機車", bike: "腳踏車" }] },
    pose(lt, p, ctx) {
      const b = bodyOf(ctx), H = ctx.height, m = (v) => scl(v, 1 / H), bike = p.vehicle === "bike";
      // seat heights, pedals and grips of the built-in motorcycle (scooter) and bike, in meters
      const sp = bike ? {
        rot: { hips: [15, 0, 0], spine: [12, 0, 0], chest: [8, 0, 0], neck: [-12, 0, 0], head: [-18, 0, 0] },
        hips: [0, 0.98 / H + 0.02 - 0.55, -0.28 / H], kOut: 4,
      } : {
        rot: { hips: [5, 0, 0], spine: [6, 0, 0], chest: [4, 0, 0], neck: [-5, 0, 0], head: [-8, 0, 0] },
        hips: [0, 0.8 / H + 0.02 + 0.045 * b.bulk - 0.55, -0.35 / H], kOut: 6,
        lA: [b.hw + 0.03, 0.345 / H + 0.04, 0.1 / H], rA: [-b.hw - 0.03, 0.345 / H + 0.04, 0.1 / H], lF: [0, 6, 0], rF: [0, -6, 0],
      };
      if (bike) {
        // pedals turn once per 5 m ridden; the ankle sits above and behind the ball of the foot on the pedal
        const ph = (ctx.dist / 5) * TAU;
        for (const [s, sg, a] of [["l", 1, ph + Math.PI], ["r", -1, ph]]) {
          sp[s + "A"] = m([sg * 0.12, 0.3 - 0.156 * Math.cos(a) + 0.08, -0.06 - 0.156 * Math.sin(a) - 0.1]);
          sp[s + "F"] = [15, sg * 6, 0];
        }
      }
      const g = bike ? [0.27, 1.0, 0.28] : [0.3, 1.14, 0.13];
      sp.lW = toChest(sp, m(g));
      sp.rW = toChest(sp, m([-g[0], g[1], g[2]]));
      sp.lP = [0.6, -1, -0.4];
      sp.rP = [-0.6, -1, -0.4];
      const f = dirToChest(sp, [0, -0.3, 0.95]), n = dirToChest(sp, [0, -0.95, -0.3]);
      sp.lH = [...f, ...n];
      sp.rH = [...f, ...n];
      return solve(sp, b);
    },
  },
};
