// Editor 3D view: orbit camera, selection, path / key handles, camera and light gizmos, transform dragging.
// Helpers live in a separate overlay scene, so the program output (runtime scene) never contains them.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { TransformControls } from "three/addons/controls/TransformControls.js";
import { CSS2DRenderer } from "three/addons/renderers/CSS2DRenderer.js";
import { buildPath, pathPolyline, segmentSpeeds, samplePath } from "../runtime/keys.js";
import { applyCameraState } from "../runtime/camera.js";
import { ikChain } from "../runtime/ik.js";
import { findEntity, selIds } from "./state.js";
import * as ops from "./ops.js";
import { selectIds, toggleSelect, withGroups } from "./ops-entity.js";
import { setYaw } from "./ops-view.js";
import { tag, visibleChain, movable, ViewTools } from "./viewport-tools.js";
import { pathTicks, Onion, collisionMarks, GroundImage } from "./viewport-extras.js";
import { startPilot, stopPilot, pilotFrame, toggleRecord } from "./viewport-pilot.js";
import { Quad } from "./viewport-quad.js";
import { WallTool } from "./wall-tool.js";
import { fmt, toast } from "./ui.js";

const D2R = Math.PI / 180;
const COLORS = { actors: "#ffd23f", props: "#9ad1ff", lights: "#ffffff" };
const GROUND = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

function disposeTree(group, keep) {
  for (const c of [...group.children]) {
    group.remove(c);
    c.traverse((m) => {
      if (m.geometry && m.geometry !== keep) m.geometry.dispose();
      if (m.material) m.material.dispose();
    });
  }
}

function cameraModel(color) {
  const g = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.16, 0.3), mat);
  body.position.z = 0.17;
  const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.065, 0.08, 12), mat);
  lens.rotation.x = Math.PI / 2;
  lens.position.z = -0.02;
  const fr = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color }));
  fr.geometry.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(18 * 3), 3));
  g.add(body, lens, fr);
  g.userData.frustum = fr;
  return g;
}

function updateFrustum(fr, fov, aspect, len = 0.9) {
  const hy = Math.tan((fov * D2R) / 2) * len, hx = hy * aspect;
  const c = [[-hx, -hy, -len], [hx, -hy, -len], [hx, hy, -len], [-hx, hy, -len]];
  const pts = [];
  for (const p of c) pts.push(0, 0, 0, ...p);
  for (let i = 0; i < 4; i++) pts.push(...c[i], ...c[(i + 1) % 4]);
  pts.push(-hx * 0.4, hy * 1.08, -len, 0, hy * 1.35, -len); // little roof marks which side is up
  const a = fr.geometry.attributes.position;
  a.array.set(pts);
  a.needsUpdate = true;
  fr.geometry.computeBoundingSphere();
}

export class Viewport {
  constructor(el, store, rt, posing) {
    Object.assign(this, { el, store, rt, posing });
    this.autoKey = true;
    this.snap = false;
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.shadowMap.autoUpdate = false; // redrawn only when the scene changed (render(changed)), not while orbiting
    this.renderer.domElement.classList.add("main3d");
    el.prepend(this.renderer.domElement);
    this.labels = new CSS2DRenderer();
    this.labels.domElement.className = "css2d";
    Object.assign(this.labels.domElement.style, { position: "absolute", left: "0", top: "0" });
    el.append(this.labels.domElement);

    this.camera = new THREE.PerspectiveCamera(45, 1, 0.05, 500);
    this.camera.position.set(7, 5.5, 9);
    this.orbit = new OrbitControls(this.camera, this.renderer.domElement);
    this.orbit.target.set(0, 0.9, 0);
    this.orbit.enableDamping = true;
    this.orbit.dampingFactor = 0.15;

    this.overlay = new THREE.Scene();
    this.paths = new THREE.Group();
    this.handles = new THREE.Group();
    this.dyn = new THREE.Group();
    this.collideGroup = new THREE.Group(); // walk-through marks; rebuilt by setCollisions, not by rebuild
    this.overlay.add(this.paths, this.handles, this.dyn, this.collideGroup);
    this.collisions = [];
    this.keyGeo = new THREE.SphereGeometry(0.075, 14, 10);
    this.proxy = new THREE.Object3D();
    this.overlay.add(this.proxy);
    this.dummy = new THREE.PerspectiveCamera();
    this.camModels = [];
    this.lightIcons = [];
    this.follow = [];

    this.tc = new TransformControls(this.camera, this.renderer.domElement);
    this.tc.setSize(0.85);
    this.overlay.add(this.tc.getHelper());
    this.gizmo = null;
    this.dragSeq = 0;
    this.tc.addEventListener("dragging-changed", (e) => {
      this.orbit.enabled = !e.value;
      this.justDragged = true;
      if (e.value) {
        this.dragId = `vp${++this.dragSeq}`;
        // multi-selection: every entity moves by the gizmo offset from where it was when the drag started
        const g = this.gizmo, s = this.store;
        this.dragBase = g?.mode === "multi" ? { start: this.proxy.position.clone(), pos: g.ids.map((id) => [id, ops.trackValueAt(findEntity(s.project, id).spec, "path", s.time)]) } : null;
      } else {
        if (this.gizmo?.mode === "yaw") this._yawHint(this.gizmo.id);
        this.dragId = null;
        this.dragBase = null;
        this.updateGizmo();
      }
    });
    this.tc.addEventListener("objectChange", () => this._onTransform());

    this.ray = new THREE.Raycaster();
    this.ndc = new THREE.Vector2();
    const cv = this.renderer.domElement;
    cv.addEventListener("pointerdown", (e) => { this.down = { x: e.clientX, y: e.clientY }; this.justDragged = false; });
    cv.addEventListener("pointerup", (e) => this._onPointerUp(e));
    this.tools = new ViewTools(this);
    this.wall = new WallTool(this);
    this.onion = new Onion(this);
    this.groundImage = new GroundImage(this);
    this.quad = null;
    this.rotateMode = false;
    this.pilot = null;
    new ResizeObserver(() => this.resize()).observe(el);
    this.resize();
  }

  resize() {
    const w = Math.max(1, this.el.clientWidth), hgt = Math.max(1, this.el.clientHeight);
    // four views: the main view takes the top right quarter
    const mw = this.quad ? Math.floor(w / 2) : w, mh = this.quad ? Math.floor(hgt / 2) : hgt;
    this.renderer.setSize(mw, mh, false);
    this.labels.setSize(mw, mh);
    this.labels.domElement.style.left = `${w - mw}px`;
    this.camera.aspect = mw / mh;
    this.camera.updateProjectionMatrix();
    this.quad?.resize(w, hgt);
  }

  setQuad(on) {
    if (!!this.quad === on) return;
    if (on) this.quad = new Quad(this);
    else { this.quad.dispose(); this.quad = null; }
    this.resize();
  }

  pilotStart(id) { return startPilot(this, id); }
  pilotStop() { stopPilot(this); }
  pilotRecord() { toggleRecord(this); }

  /** Walk-through intervals from findCollisions, drawn on the actor paths */
  setCollisions(list) {
    this.collisions = list;
    disposeTree(this.collideGroup);
    for (const o of collisionMarks(this.rt, list)) this.collideGroup.add(o);
  }

  setSnap(on) {
    this.snap = on;
    this.tc.setTranslationSnap(on ? 0.1 : null);
    this.tc.setRotationSnap(on ? 15 * D2R : null);
  }

  viewTop() {
    const t = this.orbit.target;
    this.camera.position.set(t.x, t.y + 16, t.z + 0.01);
    this.orbit.update();
  }
  viewPersp() {
    const t = this.orbit.target;
    this.camera.position.set(t.x + 7, t.y + 4.6, t.z + 9);
    this.orbit.update();
  }
  focusSelected() {
    const p = this._selPosition();
    if (!p) return;
    const off = this.camera.position.clone().sub(this.orbit.target).setLength(5.5);
    this.orbit.target.copy(p);
    this.camera.position.copy(p).add(off);
    this.orbit.update();
  }

  _selPosition() {
    const s = this.store, ent = findEntity(s.project, s.sel.id);
    if (!ent) return null;
    if (ent.list === "cameras") return this.rt.cameraState(ent.spec.id, s.time, 1)?.position.clone() || null;
    const e = this.rt.entities.get(ent.spec.id);
    if (ent.list === "lights") return e.light.position.clone();
    const p = e.object.position.clone();
    if (ent.list === "actors") p.y += e.height * 0.5;
    return p;
  }

  // ---------- overlay ----------

  /** Rebuild paths, key handles, gizmo models and labels (after project or selection changes) */
  rebuild() {
    disposeTree(this.paths);
    disposeTree(this.handles, this.keyGeo);
    disposeTree(this.dyn);
    this.camModels = [];
    this.lightIcons = [];
    this.follow = [];
    this.selBoxes = [];
    const P = this.store.project, sel = this.store.sel, picked = new Set(selIds(sel));
    // hidden entities get no helpers at all; locked ones show but offer no handles
    for (const list of ["actors", "props", "lights"]) for (const spec of P[list]) {
      if (spec.hidden) continue;
      const isSel = picked.has(spec.id);
      if (!(list === "props" && spec.attach)) this._pathViz(spec, "path", spec.path, COLORS[list], isSel, false, spec.id === sel.id && !spec.locked);
      const lab = tag(spec.locked ? `${spec.name} 🔒` : spec.name, isSel ? "sel" : "");
      this.dyn.add(lab);
      this.follow.push({ lab, id: spec.id, list });
      if (list === "lights") {
        const icon = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 8), new THREE.MeshBasicMaterial({ color: spec.color }));
        icon.userData.entityId = spec.id;
        const beam = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineDashedMaterial({ color: spec.color, dashSize: 0.12, gapSize: 0.08 }));
        this.dyn.add(icon, beam);
        this.lightIcons.push({ icon, beam, id: spec.id });
      }
      if (isSel && list !== "lights") {
        const box = new THREE.BoxHelper(this.rt.entities.get(spec.id).object, spec.id === sel.id ? "#4da3ff" : "#2f6fb3");
        this.dyn.add(box);
        this.selBoxes.push(box);
      }
    }
    for (const cam of P.cameras) {
      if (cam.hidden) continue;
      const isSel = picked.has(cam.id), primary = cam.id === sel.id && !cam.locked;
      if (!cam.mount) this._pathViz(cam, "path", cam.path, cam.color, isSel, false, primary);
      if (primary && cam.aim.mode === "point") this._pathViz(cam, "aim", cam.aim, cam.color, true, true);
      const m = cameraModel(cam.color);
      m.userData.entityId = cam.id;
      const aimLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineDashedMaterial({ color: cam.color, dashSize: 0.15, gapSize: 0.1, transparent: true, opacity: isSel ? 0.9 : 0.35 }));
      this.dyn.add(m, aimLine);
      this.camModels.push({ m, aimLine, id: cam.id });
      const lab = tag(cam.locked ? `${cam.name} 🔒` : cam.name, isSel ? "sel" : "");
      this.dyn.add(lab);
      this.follow.push({ lab, id: cam.id, list: "cameras", model: m });
    }
    this.updateGizmo();
  }

  _pathViz(spec, track, path, color, isSel, dashed = false, handles = isSel) {
    const built = buildPath(path.keys, path.curve);
    const sel = this.store.sel;
    if (path.keys.length > 1) {
      const pts = pathPolyline(built, 20).map((p) => new THREE.Vector3(p[0], p[1] + 0.02, p[2]));
      const opts = { color, depthTest: false, transparent: true, opacity: isSel ? 1 : 0.4 };
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), dashed ? new THREE.LineDashedMaterial({ ...opts, dashSize: 0.15, gapSize: 0.1 }) : new THREE.LineBasicMaterial(opts));
      if (dashed) line.computeLineDistances();
      line.renderOrder = 10;
      this.paths.add(line);
      for (const o of pathTicks(built, path.keys, color, isSel ? 0.9 : 0.35, handles && track === "path")) this.paths.add(o);
    }
    if (!handles) return;
    path.keys.forEach((k, i) => {
      const on = sel.key && sel.key.track === track && sel.key.i === i;
      const m = new THREE.Mesh(this.keyGeo, new THREE.MeshBasicMaterial({ color: on ? "#ffb84d" : color, depthTest: false, transparent: true }));
      m.position.fromArray(k.v);
      if (dashed) m.scale.setScalar(0.75);
      m.renderOrder = 20;
      m.userData.keyRef = { id: spec.id, track, i };
      const lab = tag(`${track === "aim" ? "目標 " : ""}${i + 1}｜${fmt(k.t)} 秒`);
      lab.position.copy(m.position).y += 0.12;
      this.handles.add(m, lab);
    });
    segmentSpeeds(built).forEach((v, i) => {
      const seg = built.segs[i];
      if (seg.still || seg.len < 0.05) return;
      const mid = samplePath(built, (seg.t0 + seg.t1) / 2).pos;
      const lab = tag(`${v.toFixed(2)} m/s`, "speed");
      lab.position.set(mid[0], mid[1] + 0.3, mid[2]);
      this.handles.add(lab);
    });
  }

  /** Per-frame: move camera models, light icons and labels to their evaluated state */
  update() {
    const s = this.store, t = s.time, P = s.project, aspect = P.settings.width / P.settings.height;
    const live = s.preview || this.rt.liveCamera(t);
    for (const { m, aimLine, id } of this.camModels) {
      const st = this.rt.cameraState(id, t, aspect);
      // the piloted camera is the view itself
      m.visible = aimLine.visible = id !== this.pilot?.id;
      if (!st) continue;
      applyCameraState(this.dummy, st, t);
      m.position.copy(this.dummy.position);
      m.quaternion.copy(this.dummy.quaternion);
      m.scale.setScalar(id === live ? 1.35 : 1);
      updateFrustum(m.userData.frustum, st.fov, aspect);
      aimLine.geometry.setFromPoints([st.position, st.target]);
      aimLine.computeLineDistances();
    }
    for (const { icon, beam, id } of this.lightIcons) {
      const L = this.rt.entities.get(id)?.light;
      if (!L) continue;
      icon.position.copy(L.position);
      beam.visible = !!L.isSpotLight;
      if (L.isSpotLight) { beam.geometry.setFromPoints([L.position, L.target.position]); beam.computeLineDistances(); }
    }
    for (const f of this.follow) {
      const ent = this.rt.entities.get(f.id);
      if (f.list === "cameras") { f.lab.visible = f.id !== this.pilot?.id; f.lab.position.copy(f.model.position).y += 0.3; }
      else if (f.list === "lights") { if (ent) f.lab.position.copy(ent.light.position).y += 0.3; }
      else if (ent) {
        f.lab.position.copy(ent.object.position);
        f.lab.position.y += f.list === "actors" ? ent.height + 0.2 : 0.6;
      }
    }
    for (const b of this.selBoxes) b.update();
  }

  /** changed: the scene may have moved since the last call (time, project, pose), so the shadows are drawn again */
  render(changed = true) {
    if (this.pilot) pilotFrame(this);
    this.orbit.update();
    this.update();
    const r = this.renderer;
    r.autoClear = true;
    // hidden only here: the monitor and the exports still show them
    const off = [];
    for (const list of ["actors", "props"]) for (const e of this.store.project[list]) {
      const o = e.hidden && this.rt.entities.get(e.id)?.object;
      if (o?.visible) { o.visible = false; off.push(o); }
    }
    this.groundImage.update();
    r.shadowMap.needsUpdate = changed;
    r.render(this.rt.scene, this.camera);
    r.autoClear = false;
    this.onion.render();
    this.handles.visible = !this.pilot;
    r.render(this.overlay, this.camera);
    this.quad?.render(changed);
    for (const o of off) o.visible = true;
    this.labels.render(this.overlay, this.camera);
  }

  // ---------- gizmo ----------

  /** Attach the transform gizmo to what is selected (not while a drag is running) */
  updateGizmo() {
    if (this.tc.dragging) return;
    const s = this.store, sel = s.sel, P = s.project;
    this.gizmo = null;
    this.tc.showX = this.tc.showZ = true;
    this.proxy.rotation.set(0, 0, 0);
    if (this.pilot) { this.tc.detach(); return; }
    if (s.posing) {
      const rig = this.rt.entities.get(s.posing.id)?.rig;
      const joint = s.posing.joint && rig?.joints[s.posing.joint];
      if (joint && s.posing.ik && ikChain(rig, s.posing.joint)) {
        // hand / foot: move the end, elbow and knee follow (runtime/ik.js)
        joint.getWorldPosition(this.proxy.position);
        this.tc.setMode("translate");
        this.tc.setSpace("world");
        this.tc.attach(this.proxy);
        this.gizmo = { mode: "ik" };
      } else if (joint) {
        this.tc.setMode(s.posing.joint === rig.jointNames[0] && s.posing.moveHips ? "translate" : "rotate");
        this.tc.setSpace("local");
        this.tc.attach(joint);
        this.gizmo = { mode: "joint" };
      } else this.tc.detach();
      return;
    }
    const ent = findEntity(P, sel.id);
    this.tc.setMode("translate");
    this.tc.setSpace("world");
    const one = selIds(sel).length === 1 && !sel.key && movable(ent) && ent.list !== "cameras" && ent.list !== "lights";
    if (this.rotateMode && one) {
      // R: turn the facing with a single ring around the vertical axis
      const pl = this.rt.placement(this.rt.entities.get(ent.spec.id), s.time);
      this.proxy.position.copy(pl.pos);
      this.proxy.rotation.y = pl.yaw * D2R;
      this.tc.setMode("rotate");
      this.tc.showX = this.tc.showZ = false;
      this.gizmo = { mode: "yaw", id: ent.spec.id };
    } else if (ent && !ent.spec.locked && sel.key && (sel.key.track === "path" || sel.key.track === "aim")) {
      const keys = sel.key.track === "path" ? ent.spec.path.keys : ent.spec.aim.keys;
      this.proxy.position.fromArray(keys[sel.key.i].v);
      this.gizmo = { mode: "key", id: ent.spec.id, track: sel.key.track, i: sel.key.i };
    } else if (!sel.key && movable(ent)) {
      this.proxy.position.fromArray(ops.trackValueAt(ent.spec, "path", s.time));
      const ids = selIds(sel).filter((id) => movable(findEntity(P, id)));
      this.gizmo = ids.length > 1 ? { mode: "multi", id: ent.spec.id, ids } : { mode: "entity", id: ent.spec.id };
    }
    if (this.gizmo) this.tc.attach(this.proxy); else this.tc.detach();
  }

  _onTransform() {
    const g = this.gizmo;
    if (!g || !this.tc.dragging) return;
    if (g.mode === "joint") { this.posing.onJointChanged(); return; }
    if (g.mode === "ik") { this.posing.dragEnd(this.proxy.position.clone()); return; }
    if (g.mode === "yaw") {
      setYaw(g.id, new THREE.Euler().setFromQuaternion(this.proxy.quaternion, "YXZ").y / D2R, this.dragId);
      return;
    }
    const v = this.proxy.position.toArray();
    // small props dragged sideways land on the table, shelf or floor under them
    if (g.mode === "entity" && this.tools.dropOnSurface && ["X", "Z", "XZ"].includes(this.tc.axis) && this.tools.isSmallProp(findEntity(this.store.project, g.id))) {
      v[1] = this.tools.surfaceY(g.id, v[0], v[2]);
      this.proxy.position.y = v[1];
    }
    if (g.mode === "key") ops.setKeyValue(g.id, g.track, g.i, v, this.dragId);
    else if (g.mode === "multi" && this.dragBase) {
      const d = this.proxy.position.clone().sub(this.dragBase.start).toArray();
      ops.moveEntities(this.dragBase.pos.map(([id, p]) => [id, p.map((x, i) => x + d[i])]), { autoKey: this.autoKey, coalesce: this.dragId });
    } else ops.moveEntityTo(g.id, v, { autoKey: this.autoKey, coalesce: this.dragId });
  }

  /** After turning: a walking actor faces along its path, so the new facing only shows where it stands */
  _yawHint(id) {
    const ent = findEntity(this.store.project, id), e = this.rt.entities.get(id);
    if (!ent || !e || ent.spec.facing === "fixed" || ent.spec.path.keys.length < 2) return;
    const d = samplePath(e.path, this.store.time).dir;
    if (d && Math.hypot(d[0], d[2]) > 0.2) toast("這個時間點正在移動，方向跟著路徑；要固定方向請在屬性把「面向」改成「固定方向」", "warn", 6000);
  }

  // ---------- picking ----------

  _onPointerUp(e) {
    if (!this.down || e.button !== 0) return;
    const moved = Math.hypot(e.clientX - this.down.x, e.clientY - this.down.y) > 4;
    this.down = null;
    if (moved || this.justDragged || this.tc.dragging) return;
    const r = this.renderer.domElement.getBoundingClientRect();
    this.ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(this.ndc, this.camera);
    const s = this.store;

    if (s.posing) {
      const rig = this.rt.entities.get(s.posing.id)?.rig;
      const hit = rig && this.ray.intersectObject(rig.root, true).find((x) => visibleChain(x.object) && x.object.userData.pickJoint);
      if (hit) this.posing.selectJoint(hit.object.userData.pickJoint);
      return;
    }
    if (this.pilot || this.tools.onClick(e) || this.wall.onClick(e)) return;

    if (e.shiftKey) {
      const ent = findEntity(s.project, s.sel.id);
      const pt = new THREE.Vector3();
      if (ent && !ent.spec.locked && !(ent.list === "cameras" && ent.spec.mount) && this.ray.ray.intersectPlane(GROUND, pt)) {
        const y = ops.trackValueAt(ent.spec, "path", s.time)[1];
        ops.addKeyAtPlayhead(ent.spec.id, "path", [pt.x, y, pt.z]);
      }
      return;
    }

    // Ctrl+click adds / removes; a group member brings the whole group; locked and hidden entities let the click through
    const ctrl = e.ctrlKey || e.metaKey, P = s.project;
    const hits = this.ray.intersectObjects([this.handles, this.dyn, this.rt.world], true).filter((x) => x.object.isMesh && visibleChain(x.object));
    for (const hit of hits) {
      for (let o = hit.object; o; o = o.parent) {
        if (o.userData.keyRef && !ctrl) {
          const k = o.userData.keyRef;
          s.select({ id: k.id, key: { track: k.track, i: k.i } });
          return;
        }
        if (o.userData.entityId) {
          const id = o.userData.entityId, spec = findEntity(P, id)?.spec;
          if (!spec || spec.locked || spec.hidden) break;
          const ids = withGroups(P, [id]);
          if (ctrl) toggleSelect(ids); else selectIds(ids, id);
          return;
        }
      }
    }
    if (!ctrl) s.select({});
  }
}
