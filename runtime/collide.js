// Walk-through check: samples the timeline and reports when an actor passes through another actor or a prop.
// Actors are circles on the floor, props are their footprint rectangles (local bounding box turned by their yaw).
import * as THREE from "three";
import { samplePath } from "./keys.js";
import { isTerrain } from "./terrain.js";

// while seated or lying the body is meant to overlap the chair, sofa or bed
const SEATED = ["sit", "sitting", "lie", "standUp"];

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

export function actorRadius(ent) {
  return ent.spec.kind === "human" ? clamp(ent.height * 0.12, 0.08, 0.3) : clamp(ent.height * 0.3, 0.1, 0.5);
}

// parts that start above head height (a streetlight's arm, a tree's crown) are walked under, not into
export const OVERHEAD = 1.8;

/** Bounding box of a prop in its own space (position and yaw removed; scale kept), without its overhead parts */
function localBox(obj) {
  const p = obj.position.clone(), q = obj.quaternion.clone();
  obj.position.set(0, 0, 0);
  obj.quaternion.identity();
  obj.updateMatrixWorld(true);
  const box = new THREE.Box3(), part = new THREE.Box3();
  obj.traverse((o) => {
    if (!o.isMesh) return;
    part.setFromObject(o, true);
    if (part.min.y <= OVERHEAD) box.union(part);
  });
  obj.position.copy(p);
  obj.quaternion.copy(q);
  obj.updateMatrixWorld(true);
  return box;
}

/** How deep a circle (local x, z, radius r) reaches into the rectangle box (negative = apart) */
function depthInBox(x, z, r, b) {
  const dx = Math.max(b.min.x - x, 0, x - b.max.x), dz = Math.max(b.min.z - z, 0, z - b.max.z);
  if (dx > 0 || dz > 0) return r - Math.hypot(dx, dz);
  return r + Math.min(x - b.min.x, b.max.x - x, z - b.min.z, b.max.z - z);
}

function seatedAt(rt, ent, t) {
  const acts = ent.spec.actions;
  let last = null, next = null;
  for (const c of acts) {
    if (c.start <= t && (!last || c.start >= last.start)) last = c;
    if (c.start > t && (!next || c.start < next.start)) next = c;
  }
  // standing on the spot where a sit or lie begins, up to 1.2 s before it (turning round, shins against the seat)
  if (next && (next.type === "sit" || next.type === "lie") && next.start - t <= 1.2) {
    const a = samplePath(ent.path, t).pos, b = samplePath(ent.path, next.start).pos;
    if (Math.hypot(a[0] - b[0], a[2] - b[2]) < 0.05) return true;
  }
  if (!last || !SEATED.includes(last.type)) return false;
  return t < last.start + last.dur || rt._modeOf(ent)(last).hold;
}

/** Props a person cannot walk through, with their own-space boxes */
function solidProps(rt, project) {
  const props = [];
  for (const o of project.props) {
    const ent = rt.entities.get(o.id);
    if (!ent || o.attach || isTerrain(o.type)) continue; // things carried by hand are meant to be touched; stairs, ramps and stages are walked on
    const box = localBox(ent.object);
    if (box.isEmpty() || box.max.y - box.min.y < 0.15 || box.max.y <= 0.05) continue; // overhead, rugs, flat marks
    props.push({ ent, box, still: o.path.keys.length <= 1 });
  }
  return props;
}

/** (x, z) => true when a person of radius r standing there at time t would reach into a prop (rt: a synced SceneRuntime) */
export function blockedAt(rt, project, t, r) {
  const UP = new THREE.Vector3(0, 1, 0), ONE = new THREE.Vector3(1, 1, 1), v = new THREE.Vector3();
  const props = solidProps(rt, project).map(({ ent, box }) => {
    const pl = rt.placement(ent, t);
    const q = new THREE.Quaternion().setFromAxisAngle(UP, (pl.yaw * Math.PI) / 180);
    return { box, inv: new THREE.Matrix4().compose(pl.pos, q, ONE).invert() };
  });
  return (x, z) => props.some((p) => { v.set(x, 0, z).applyMatrix4(p.inv); return depthInBox(v.x, v.z, r, p.box) > 0; });
}

/**
 * rt: a synced SceneRuntime. Returns [{ t0, t1, a, b, kind: "actor" | "prop" }] sorted by time,
 * a = actor id, b = the other actor or prop id. Overlaps under tol (meters) are ignored.
 */
export function findCollisions(rt, project, { step = 0.1, tol = 0.1 } = {}) {
  const D = project.settings.duration;
  const actors = project.actors.map((a) => rt.entities.get(a.id)).filter(Boolean);
  const props = solidProps(rt, project);
  const radius = new Map(actors.map((e) => [e.spec.id, actorRadius(e)]));
  const open = new Map(), out = [];
  const m = new THREE.Matrix4(), inv = new THREE.Matrix4(), v = new THREE.Vector3(), q = new THREE.Quaternion(), UP = new THREE.Vector3(0, 1, 0);
  const propInv = new Map();
  const n = Math.max(1, Math.round(D / step));
  for (let i = 0; i <= n; i++) {
    const t = Math.min(D, i * step), hits = new Set();
    const pos = actors.map((e) => samplePath(e.path, t).pos);
    for (let a = 0; a < actors.length; a++) {
      for (let b = a + 1; b < actors.length; b++) {
        const d = Math.hypot(pos[a][0] - pos[b][0], pos[a][2] - pos[b][2]);
        if (d < radius.get(actors[a].spec.id) + radius.get(actors[b].spec.id) - tol) hits.add(`actor|${actors[a].spec.id}|${actors[b].spec.id}`);
      }
      if (seatedAt(rt, actors[a], t)) continue;
      for (const p of props) {
        if (!p.still || !propInv.has(p.ent.spec.id)) {
          const pl = rt.placement(p.ent, t);
          inv.copy(m.compose(pl.pos, q.setFromAxisAngle(UP, (pl.yaw * Math.PI) / 180), v.set(1, 1, 1))).invert();
          propInv.set(p.ent.spec.id, inv.clone());
        }
        v.fromArray(pos[a]).applyMatrix4(propInv.get(p.ent.spec.id));
        if (depthInBox(v.x, v.z, radius.get(actors[a].spec.id), p.box) > tol) hits.add(`prop|${actors[a].spec.id}|${p.ent.spec.id}`);
      }
    }
    for (const k of hits) { if (open.has(k)) open.get(k).t1 = t; else open.set(k, { t0: t, t1: t }); }
    for (const [k, iv] of open) {
      if (hits.has(k)) continue;
      const [kind, a, b] = k.split("|");
      out.push({ ...iv, a, b, kind });
      open.delete(k);
    }
  }
  for (const [k, iv] of open) { const [kind, a, b] = k.split("|"); out.push({ ...iv, a, b, kind }); }
  return out.sort((x, y) => x.t0 - y.t0);
}
