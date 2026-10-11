// Shot analysis on an evaluated SceneRuntime: shot size of a camera (c05) and left/right swaps across cuts (c06).
// Call rt.evaluate(t) first; these read the posed actors at that time.
import * as THREE from "three";

export const SHOT_SIZES = ["大遠景", "全景", "中遠景", "中景", "中近景", "特寫", "大特寫", "空景"];
// body level at the bottom edge of the frame (0 feet, 1 head top) where each size starts
const LEVELS = [[0.4, "中遠景"], [0.6, "中景"], [0.74, "中近景"], [0.84, "特寫"]];

const cam = new THREE.PerspectiveCamera();
const box = new THREE.Box3(), v = new THREE.Vector3(), w = new THREE.Vector3();

/** Half height of the visible frame in NDC: a letterbox matte hides the top and bottom */
export function frameLimit(settings) {
  const r = Number(settings.letterbox);
  return r ? Math.min(1, settings.width / settings.height / r) : 1;
}

// joints a human body line passes through (pairs are averaged) with their standing level (0 soles, 1 head top), from rig-human.js layout
const HUMAN_LINE = [["lFoot", "rFoot", 0.04], ["lShin", "rShin", 0.285], ["lThigh", "rThigh", 0.53], ["chest", null, 0.71], ["neck", null, 0.845]];

// body line of an actor as [point, level] pairs. Humans: soles, ankles, knees, hips, chest, neck, head top, so a seated or
// crouching body is measured along its limbs. Animals: a vertical line from the bottom to the top of the body.
function bodyLine(ent) {
  box.setFromObject(ent.rig.root);
  const j = ent.rig.joints, floor = box.min.y, pos = (n) => j[n].getWorldPosition(new THREE.Vector3());
  if (ent.spec.kind !== "human" || !j.head) {
    const hips = pos(j.hips ? "hips" : ent.rig.jointNames[0]);
    return [[new THREE.Vector3(hips.x, floor, hips.z), 0], [new THREE.Vector3(hips.x, box.max.y, hips.z), 1]];
  }
  const pts = HUMAN_LINE.map(([a, b, lv]) => [b ? pos(a).add(pos(b)).multiplyScalar(0.5) : pos(a), lv]);
  box.setFromObject(j.head);
  const top = new THREE.Vector3((box.min.x + box.max.x) / 2, box.max.y, (box.min.z + box.max.z) / 2);
  return [[new THREE.Vector3(pts[0][0].x, floor, pts[0][0].z), 0], ...pts, [top, 1]];
}

/** Actors in front of the camera with their body line in NDC: [{ id, name, x, at(k) }] */
export function actorsInView(rt, camId, t) {
  const P = rt.project, S = P.settings;
  if (!rt.applyCamera(cam, camId, t, S.width / S.height)) return [];
  cam.updateMatrixWorld();
  const lim = frameLimit(S), out = [];
  for (const a of P.actors) {
    const ent = rt.entities.get(a.id);
    if (!ent?.rig) continue;
    const line = bodyLine(ent);
    const at = (k) => {
      let i = 1;
      while (i < line.length - 1 && line[i][1] < k) i++;
      const [p0, l0] = line[i - 1], [p1, l1] = line[i];
      v.lerpVectors(p0, p1, Math.min(1, Math.max(0, (k - l0) / (l1 - l0))));
      const front = w.copy(v).applyMatrix4(cam.matrixWorldInverse).z < 0;
      v.project(cam);
      return { x: v.x, y: v.y, front };
    };
    const mid = at(0.6), lo = at(0), hi = at(1);
    if (!mid.front || Math.abs(mid.x) > 1) continue;
    if ((lo.front && lo.y > lim) || (hi.front && hi.y < -lim)) continue;
    out.push({ id: a.id, name: a.name || a.id, x: mid.x, span: hi.y - lo.y, at, lim });
  }
  return out;
}

/**
 * Shot size of camera camId at time t, judged on the actor the camera aims at when it is in frame (so an over-the-shoulder
 * shot is judged on the far actor, not the shoulder), otherwise on the biggest actor in frame. Returns { size, actor }
 */
export function shotSizeAt(rt, camId, t) {
  const list = actorsInView(rt, camId, t);
  if (!list.length) return { size: "空景", actor: null };
  const aim = rt.project.cameras.find((c) => c.id === camId)?.aim;
  const a = list.find((x) => aim?.mode === "actor" && x.id === aim.actor) || list.reduce((m, x) => (x.span > m.span ? x : m));
  const lim = a.lim, inside = (k) => { const p = a.at(k); return p.front && p.y >= -lim; };
  // feet cut at the ankles still count as a full shot
  if (inside(0.04)) return { size: a.span < 0.4 * lim ? "大遠景" : "全景", actor: a.id };
  if (!inside(1)) return { size: "大特寫", actor: a.id };
  // lowest body level still inside the frame
  let lo = 0, hi = 1;
  for (let i = 0; i < 14; i++) { const m = (lo + hi) / 2; if (inside(m)) hi = m; else lo = m; }
  const b = hi;
  return { size: LEVELS.find(([lv]) => b < lv)?.[1] || "大特寫", actor: a.id, level: b };
}

/**
 * Screen-direction check across cuts: two actors seen in both shots must keep their left/right order.
 * evalAt(t) poses the scene at t. Movement direction is not checked.
 */
export function axisCheck(rt, evalAt) {
  const P = rt.project, cuts = P.cuts, out = [];
  for (let i = 1; i < cuts.length; i++) {
    const a = cuts[i - 1], b = cuts[i];
    if (a.camera === b.camera) continue;
    evalAt(b.t);
    const A = new Map(actorsInView(rt, a.camera, b.t).map((x) => [x.id, x]));
    const B = actorsInView(rt, b.camera, b.t).filter((x) => A.has(x.id));
    for (let p = 0; p < B.length; p++) for (let q = p + 1; q < B.length; q++) {
      const before = A.get(B[p].id).x - A.get(B[q].id).x, after = B[p].x - B[q].x;
      if (Math.abs(before) > 0.05 && Math.abs(after) > 0.05 && Math.sign(before) !== Math.sign(after)) {
        out.push({ cut: i, t: b.t, actors: [B[p].id, B[q].id], text: `越軸：鏡 ${i} 到鏡 ${i + 1}（${+b.t.toFixed(2)} 秒）${B[p].name}與${B[q].name}左右對調` });
      }
    }
  }
  return out;
}
