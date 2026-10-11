// Foot planting on walkable ground (p03). After the walk pose is applied, two-bone IK lifts each planted foot onto
// the tread under it, and the body sinks when a planted foot steps down. A lifted foot follows the smooth surface so it
// does not snap at stair edges. Humans only; animals just ride the root height (runtime/terrain.js).
import * as THREE from "three";
import { solveIK } from "./ik.js";
import { applyPose, restPose } from "./pose.js";
import { groundAt } from "./terrain.js";

const smooth = THREE.MathUtils.smoothstep;
// foot lift (m) over which a foot stops counting as planted; spike p03 compared four settings and this one was best
const W0 = 0.015, W1 = 0.07;
const MAX_STEP = 0.35; // a foot over a deeper drop (stage edge) hangs instead of pulling the body down
const wpos = (o) => o.getWorldPosition(new THREE.Vector3());

/** Ankle (foot joint) height above the soles in the rest pose; call when the rig is built */
export function ankleHeight(ent) {
  applyPose(ent.rig, restPose(ent.rig.jointNames));
  ent.object.updateMatrixWorld(true);
  return Math.min(wpos(ent.rig.joints.lFoot).y, wpos(ent.rig.joints.rFoot).y) - ent.object.position.y;
}

/** ent: a posed human standing at root height g0; placed: terrainAt() for the same time */
export function plantFeet(ent, placed, g0) {
  const rig = ent.rig, obj = ent.object;
  obj.updateMatrixWorld(true);
  const feet = ["lFoot", "rFoot"].map((n) => {
    const p = wpos(rig.joints[n]);
    const w = 1 - smooth(p.y - g0 - ent.ankle, W0, W1);
    let d = w * groundAt(placed, p.x, p.z, "foot") + (1 - w) * groundAt(placed, p.x, p.z, "root") - g0;
    if (d < -MAX_STEP) d = 0;
    return { n, p, w, d };
  });
  const drop = Math.min(0, ...feet.map((f) => f.w * f.d));
  if (drop < 0) { obj.position.y += drop; obj.updateMatrixWorld(true); }
  for (const f of feet) {
    const up = f.d - drop;
    if (up < 0.002) continue;
    solveIK(rig, [f.n.replace("Foot", "Thigh"), f.n.replace("Foot", "Shin"), f.n], f.p.setY(f.p.y + up));
  }
}
