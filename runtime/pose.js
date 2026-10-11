// Pose data and blending.
// Authored pose (JSON, degrees): { rot: { joint: [x, y, z] }, hips: [x, y, z] }
// hips = offset of the hips joint as a fraction of body height, so one pose fits every body size
// Runtime pose:                  { rot: { joint: THREE.Quaternion }, hips: THREE.Vector3 }
import * as THREE from "three";

const D2R = Math.PI / 180;
const _euler = new THREE.Euler();

export function toPose(deg, jointNames) {
  const rot = {};
  for (const j of jointNames) {
    const r = deg?.rot?.[j];
    rot[j] = r ? new THREE.Quaternion().setFromEuler(_euler.set(r[0] * D2R, r[1] * D2R, r[2] * D2R)) : new THREE.Quaternion();
  }
  const h = deg?.hips || [0, 0, 0];
  return { rot, hips: new THREE.Vector3(h[0], h[1], h[2]) };
}

export function restPose(jointNames) {
  return toPose(null, jointNames);
}

export function clonePose(p) {
  const rot = {};
  for (const j in p.rot) rot[j] = p.rot[j].clone();
  return { rot, hips: p.hips.clone() };
}

/** Blend b over a with weight w. With a mask only the listed joints move and the hips offset stays a's. */
export function blendPose(a, b, w, mask = null) {
  const rot = {};
  for (const j in a.rot) {
    rot[j] = !mask || mask.includes(j) ? a.rot[j].clone().slerp(b.rot[j], w) : a.rot[j].clone();
  }
  return { rot, hips: mask ? a.hips.clone() : a.hips.clone().lerp(b.hips, w) };
}

export function poseToDegrees(p) {
  const rot = {};
  for (const j in p.rot) {
    _euler.setFromQuaternion(p.rot[j]);
    const v = [_euler.x, _euler.y, _euler.z].map((r) => Math.round((r / D2R) * 10) / 10);
    if (v.some((x) => x !== 0)) rot[j] = v;
  }
  const hips = p.hips.toArray().map((x) => Math.round(x * 10000) / 10000);
  return { rot, hips };
}

export function applyPose(rig, pose) {
  for (const j of rig.jointNames) rig.joints[j].quaternion.copy(pose.rot[j]);
  rig.joints[rig.jointNames[0]].position.copy(rig.rest[rig.jointNames[0]]).addScaledVector(pose.hips, rig.height);
}
