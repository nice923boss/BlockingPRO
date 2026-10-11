// Two-bone IK for manual posing: move a hand or foot to a world point by turning its two parent joints
// (shoulder + elbow, hip + knee, animal leg upper + lower). Works on any rig whose joints are nested groups.
import * as THREE from "three";

const wpos = (o) => o.getWorldPosition(new THREE.Vector3());
const wquat = (o) => o.getWorldQuaternion(new THREE.Quaternion());

/** [upper, mid, end] joint names IK can drive when `end` is dragged, or null */
export function ikChain(rig, end) {
  const e = rig?.joints[end], m = e?.parent, u = m?.parent;
  const name = (o) => o?.userData?.joint;
  if (!/(Hand|Foot)$/.test(end) || !name(m) || !name(u) || !rig.joints[name(u)]) return null;
  return [name(u), name(m), end];
}

// Turn `joint` so the world direction `from` points along `to` (children follow)
function aim(joint, from, to) {
  const q = new THREE.Quaternion().setFromUnitVectors(from.normalize(), to.normalize());
  const parentQ = wquat(joint.parent).invert();
  joint.quaternion.copy(parentQ.multiply(q).multiply(wquat(joint)));
  joint.updateMatrixWorld(true);
}

/**
 * Move the chain end to world point `target`. The elbow / knee keeps bending the way it bends now; a straight limb
 * bends the natural way (elbows and animal front elbows back, knees forward). The end joint keeps its world rotation
 * so a planted foot stays flat. Returns how far the end is from the target (0 when reachable).
 */
export function solveIK(rig, chain, target) {
  const [U, M, E] = chain.map((n) => rig.joints[n]);
  rig.root.updateMatrixWorld(true);
  const endQ = wquat(E);
  const a = wpos(U), b = wpos(M), c = wpos(E);
  const la = a.distanceTo(b), lb = b.distanceTo(c);
  const toT = target.clone().sub(a);
  const d = THREE.MathUtils.clamp(toT.length(), Math.abs(la - lb) + 1e-4, la + lb - 1e-4);
  const u = toT.lengthSq() > 1e-10 ? toT.normalize() : c.clone().sub(a).normalize();
  // bend direction: how the limb bends now (elbow off the shoulder-to-hand line), kept across the drag
  const cur = c.clone().sub(a).normalize(), n = b.clone().sub(a);
  n.addScaledVector(cur, -n.dot(cur));
  const bend = /Hand$|FrontFoot$/.test(chain[2]) ? -1 : 1;
  if (n.length() < la * 0.02) n.set(0, 0, bend).applyQuaternion(wquat(rig.root));
  n.addScaledVector(u, -n.dot(u));
  // reaching straight along the bend axis: elbows drop, knees rise
  if (n.length() < 1e-4) n.set(0, bend, 0).addScaledVector(u, -u.y * bend);
  n.normalize();
  const x = (la * la - lb * lb + d * d) / (2 * d), h = Math.sqrt(Math.max(0, la * la - x * x));
  const elbow = a.clone().addScaledVector(u, x).addScaledVector(n, h);
  aim(U, b.clone().sub(a), elbow.sub(a));
  const b2 = wpos(M);
  aim(M, wpos(E).sub(b2), a.clone().addScaledVector(u, d).sub(b2));
  E.quaternion.copy(wquat(E.parent).invert().multiply(endQ));
  E.updateMatrixWorld(true);
  return wpos(E).distanceTo(target);
}
