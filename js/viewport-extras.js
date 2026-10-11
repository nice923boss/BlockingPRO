// 3D view extras: one-second ticks on paths, onion skin (ghost poses), walk-through marks, ground image.
import * as THREE from "three";
import { samplePath } from "../runtime/keys.js";
import { actorRadius } from "../runtime/collide.js";
import { selIds } from "./state.js";
import { tag } from "./viewport-tools.js";

// ---------- v07 ticks ----------

/** Dots at every whole second between the first and last key; labels for the selected path */
export function pathTicks(built, keys, color, opacity, labels) {
  const out = [], pts = [];
  const t0 = keys[0].t, t1 = keys[keys.length - 1].t;
  let prev = null;
  for (let s = Math.floor(t0) + 1; s < t1; s++) {
    if (keys.some((k) => Math.abs(k.t - s) < 0.05)) continue;
    const p = samplePath(built, s).pos;
    if (prev && Math.hypot(p[0] - prev[0], p[1] - prev[1], p[2] - prev[2]) < 0.05) continue; // standing still: one dot is enough
    prev = p;
    pts.push(new THREE.Vector3(p[0], p[1] + 0.02, p[2]));
    if (labels) {
      const lab = tag(`${s} 秒`, "tick");
      lab.position.set(p[0], p[1] + 0.1, p[2]);
      out.push(lab);
    }
  }
  if (pts.length) {
    const dots = new THREE.Points(new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.PointsMaterial({ color, size: 6, sizeAttenuation: false, depthTest: false, transparent: true, opacity }));
    dots.renderOrder = 15;
    out.push(dots);
  }
  return out;
}

// ---------- v08 onion skin ----------

const GHOST_STEPS = [-1, -0.5, 0.5, 1];

export class Onion {
  constructor(vp) {
    this.vp = vp;
    this.on = false;
    this.scene = new THREE.Scene();
    this.past = new THREE.MeshBasicMaterial({ color: "#6fa8ff", transparent: true, depthWrite: false });
    this.future = new THREE.MeshBasicMaterial({ color: "#ffa25e", transparent: true, depthWrite: false });
  }

  /** Draw the selected actors 1 and 0.5 seconds before (blue) and after (orange) the playhead */
  render() {
    const { store: s, rt, renderer: r, camera } = this.vp;
    if (!this.on || s.posing) return;
    const P = s.project, t = s.time, D = P.settings.duration;
    for (const id of selIds(s.sel)) {
      const spec = P.actors.find((a) => a.id === id), ent = rt.entities.get(id);
      if (!spec || spec.hidden || !ent) continue;
      const saved = rt.actorState.get(id);
      for (const dt of GHOST_STEPS) {
        const tt = t + dt;
        if (tt < 0 || tt > D) continue;
        const mat = dt < 0 ? this.past : this.future;
        mat.opacity = Math.abs(dt) < 0.75 ? 0.28 : 0.15;
        rt._evalActor(ent, tt);
        this.scene.overrideMaterial = mat;
        this.scene.add(ent.object); // borrowed from the runtime world for this pass
        ent.object.updateMatrixWorld(true);
        r.render(this.scene, camera);
        rt.world.add(ent.object);
      }
      rt._evalActor(ent, t);
      ent.object.updateMatrixWorld(true);
      rt.actorState.set(id, saved);
    }
  }
}

// ---------- v11 walk-through marks ----------

/** Red stretch over the actor path for each interval plus a ring where it happens */
export function collisionMarks(rt, list) {
  const out = [];
  const mat = new THREE.LineBasicMaterial({ color: "#ff4d4d", depthTest: false });
  for (const c of list) {
    const ent = rt.entities.get(c.a);
    if (!ent) continue;
    const pts = [];
    for (let t = c.t0; t <= c.t1 + 1e-6; t += 0.05) {
      const p = samplePath(ent.path, t).pos;
      pts.push(new THREE.Vector3(p[0], p[1] + 0.04, p[2]));
    }
    if (pts.length > 1) {
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat);
      line.renderOrder = 12;
      out.push(line);
    }
    const mid = samplePath(ent.path, (c.t0 + c.t1) / 2).pos;
    const ring = new THREE.Mesh(new THREE.RingGeometry(actorRadius(ent) * 0.9, actorRadius(ent) * 1.15, 32),
      new THREE.MeshBasicMaterial({ color: "#ff4d4d", depthTest: false, transparent: true, opacity: 0.85, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(mid[0], mid[1] + 0.04, mid[2]);
    ring.renderOrder = 12;
    out.push(ring);
  }
  return out;
}

// ---------- v09 ground image ----------

/** Floor plan laid on the ground, drawn in the editor only (the monitor and the exports never show it) */
export class GroundImage {
  constructor(vp) {
    this.vp = vp;
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    this.mesh.visible = false;
    this.mesh.renderOrder = -1;
    vp.overlay.add(this.mesh);
  }

  update() {
    const gi = this.vp.store.project.settings.ground.image, img = gi && this.vp.rt.imageSource?.(gi.file);
    const m = this.mesh, mat = m.material;
    m.visible = !!img;
    if (!img) return;
    if (mat.map?.image !== img) {
      mat.map?.dispose();
      mat.map = new THREE.Texture(img);
      mat.map.colorSpace = THREE.SRGBColorSpace;
      mat.map.needsUpdate = true;
      mat.needsUpdate = true;
    }
    // top of the picture points to -Z (up in the top view); rotate turns it like an actor's yaw
    m.scale.set(gi.width, gi.width * img.naturalHeight / Math.max(1, img.naturalWidth), 1);
    m.position.set(gi.x, 0.004, gi.z);
    m.rotation.set(-Math.PI / 2, 0, gi.rotate * Math.PI / 180);
    mat.opacity = gi.opacity;
  }
}
