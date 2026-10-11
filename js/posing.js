// Manual posing: click a joint, rotate it with the gizmo or the inspector, then bake the pose into a pose clip.
// The draft pose (degrees) lives here; after every runtime evaluate it is put back on the rig.
import * as THREE from "three";
import { toPose, applyPose, poseToDegrees } from "../runtime/pose.js";
import { ikChain, solveIK } from "../runtime/ik.js";
import { attachList } from "../runtime/schema.js";
import { findEntity } from "./state.js";
import { toast } from "./ui.js";

const D2R = Math.PI / 180;
const clone = (o) => JSON.parse(JSON.stringify(o));
const r1 = (x) => Math.round(x * 10) / 10;

// left / right joint pairs share a name after the l / r prefix (lUpperArm, lFrontUpper, lWing)
const mirrorName = (j) => (/^l[A-Z]/.test(j) ? "r" + j.slice(1) : /^r[A-Z]/.test(j) ? "l" + j.slice(1) : j);

export class Posing {
  constructor(store, rt) {
    this.store = store;
    this.rt = rt;
    this.draft = null;
  }

  get rig() { return this.store.posing && this.rt.entities.get(this.store.posing.id)?.rig; }

  /** Start posing an actor at the playhead, or edit an existing pose clip */
  start(actorId, clipId = null) {
    const s = this.store, ent = findEntity(s.project, actorId);
    if (!ent || ent.list !== "actors") return;
    s.setPlaying(false);
    const clip = clipId && ent.spec.actions.find((c) => c.id === clipId);
    if (clip) {
      s.setTime(clip.start + (clip.blend ?? 0.3));
      this.draft = { rot: clone(clip.pose?.rot || {}), hips: (clip.pose?.hips || [0, 0, 0]).slice() };
    } else {
      // start from what is on screen
      this.rt.evaluate(s.time);
      const rig = this.rt.entities.get(actorId).rig, root = rig.jointNames[0];
      const rot = {};
      for (const j of rig.jointNames) rot[j] = rig.joints[j].quaternion.clone();
      const hips = rig.joints[root].position.clone().sub(rig.rest[root]).divideScalar(rig.height);
      this.draft = poseToDegrees({ rot, hips });
    }
    s.setPosing({ id: actorId, joint: null, clipId: clip ? clip.id : null, moveHips: false });
    this.afterSync();
  }

  cancel() {
    this.draft = null;
    this.store.setPosing(null);
    this.rt.sync(this.store.project);
  }

  selectJoint(name) {
    const p = this.store.posing;
    // hands and feet start in drag-the-end (IK) mode
    if (p) this.store.setPosing({ ...p, joint: name, moveHips: p.joint === name ? p.moveHips : false, ik: p.joint === name ? p.ik : !!ikChain(this.rig, name) });
  }

  setIK(on) {
    const p = this.store.posing;
    if (p) this.store.setPosing({ ...p, ik: on });
  }

  /** Called by the gizmo while dragging a hand or foot: bend the limb so its end reaches world point `target` */
  dragEnd(target) {
    const p = this.store.posing, rig = this.rig, chain = p && rig && ikChain(rig, p.joint);
    if (!chain) return;
    solveIK(rig, chain, target);
    for (const j of chain) {
      const e = new THREE.Euler().setFromQuaternion(rig.joints[j].quaternion, "XYZ");
      this.draft.rot[j] = [e.x, e.y, e.z].map((r) => r1(r / D2R));
    }
    this.store.setPosing({ ...p });
  }

  setMoveHips(on) {
    const p = this.store.posing;
    if (p) this.store.setPosing({ ...p, moveHips: on });
  }

  /** Called by the gizmo while dragging: read the joint back into the draft */
  onJointChanged() {
    const p = this.store.posing, rig = this.rig;
    if (!p || !rig || !p.joint) return;
    const root = rig.jointNames[0];
    if (p.joint === root && p.moveHips) {
      this.draft.hips = rig.joints[root].position.clone().sub(rig.rest[root]).divideScalar(rig.height).toArray().map((x) => Math.round(x * 10000) / 10000);
    } else {
      const e = new THREE.Euler().setFromQuaternion(rig.joints[p.joint].quaternion, "XYZ");
      this.draft.rot[p.joint] = [e.x, e.y, e.z].map((r) => r1(r / D2R));
    }
    this.store.setPosing({ ...p });
  }

  setJointRot(joint, deg) {
    this.draft.rot[joint] = deg.map(r1);
    this.store.setPosing({ ...this.store.posing });
  }

  setHips(v) {
    this.draft.hips = v.slice();
    this.store.setPosing({ ...this.store.posing });
  }

  resetJoint(joint) {
    delete this.draft.rot[joint];
    this.store.setPosing({ ...this.store.posing });
  }

  resetAll() {
    this.draft = { rot: {}, hips: [0, 0, 0] };
    this.store.setPosing({ ...this.store.posing });
  }

  /** Replace the draft with a pose from the pose library */
  loadPose(pose) {
    this.draft = { rot: clone(pose.rot || {}), hips: (pose.hips || [0, 0, 0]).slice() };
    this.store.setPosing({ ...this.store.posing });
  }

  /** Swap left and right (mirror across the body's YZ plane) */
  mirror() {
    const rot = {};
    for (const [j, v] of Object.entries(this.draft.rot)) rot[mirrorName(j)] = [v[0], -v[1], -v[2]];
    this.draft = { rot, hips: [-this.draft.hips[0], this.draft.hips[1], this.draft.hips[2]] };
    this.store.setPosing({ ...this.store.posing });
  }

  /** Put the draft back on the rig (after every evaluate) and move held props with it */
  apply() {
    const p = this.store.posing, rig = this.rig;
    if (!p || !rig || !this.draft) return;
    applyPose(rig, toPose(this.draft, rig.jointNames));
    rig.root.updateMatrixWorld(true);
    for (const o of this.store.project.props) {
      if (attachList(o).some((s) => s.actor === p.id)) this.rt._evalProp(this.rt.entities.get(o.id), this.store.time);
    }
  }

  /** After a runtime sync: show joints on the posed actor so they can be clicked */
  afterSync() {
    const rig = this.rig;
    if (rig) rig.setDisplay("both");
  }

  /** Write the draft into a pose clip (new one at the playhead, or the clip being edited) */
  bake() {
    const s = this.store, p = s.posing;
    if (!p || !this.draft) return;
    const pose = clone(this.draft);
    const t = s.time;
    s.edit("套用姿勢", (d) => {
      const a = d.actors.find((x) => x.id === p.id);
      const clip = p.clipId && a.actions.find((c) => c.id === p.clipId);
      if (clip) clip.pose = pose;
      else {
        const blend = Math.min(0.4, t);
        a.actions.push({ type: "pose", start: Math.max(0, t - blend), dur: blend + 1.0, blend, hold: true, pose });
      }
    });
    const a = s.project.actors.find((x) => x.id === p.id);
    const clip = p.clipId ? a.actions.find((c) => c.id === p.clipId) : a.actions.filter((c) => c.type === "pose").sort((x, y) => Math.abs(x.start + (x.blend ?? 0) - t) - Math.abs(y.start + (y.blend ?? 0) - t))[0];
    this.draft = null;
    s.setPosing(null);
    this.rt.sync(s.project);
    if (clip) s.select({ id: p.id, clip: { track: "actions", id: clip.id } });
    toast(p.clipId ? "姿勢片段已更新" : "已建立姿勢片段，可在時間軸調整長度與淡入");
  }
}
