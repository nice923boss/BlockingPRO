// 3D view tools: right-click menu, Alt+drag box select, ruler, drop-on-surface.
import * as THREE from "three";
import { CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";
import { findEntity, selIds } from "./state.js";
import * as ops from "./ops.js";
import { selectIds, toggleSelect, withGroups, copyEntities, pasteEntities, toggleFlag } from "./ops-entity.js";
import { cameraFromView } from "./ops-view.js";
import { fovToLens } from "../runtime/camera.js";
import { h, menu, toast, fmt } from "./ui.js";

/** Label that floats above a point in the 3D view */
export function tag(text, cls = "") {
  const o = new CSS2DObject(h("div", { class: `tag3d ${cls}` }, text));
  o.center.set(0.5, 1);
  return o;
}

export const visibleChain = (o) => { for (; o; o = o.parent) if (!o.visible) return false; return true; };
// what the gizmo may drag: not locked or hidden, and not following an actor
export const movable = (ent) => !!ent && !ent.spec.locked && !ent.spec.hidden && !(ent.list === "cameras" && ent.spec.mount) && !(ent.list === "props" && ent.spec.attach);

const GROUND = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const DOWN = new THREE.Vector3(0, -1, 0);

export class ViewTools {
  constructor(vp) {
    this.vp = vp;
    this.ruler = null; // { pts: [Vector3], group } while the ruler is on
    this.rulerGroup = new THREE.Group();
    vp.overlay.add(this.rulerGroup);
    this.dropOnSurface = true;
    this.surfRay = new THREE.Raycaster();
    const cv = vp.renderer.domElement;
    cv.addEventListener("pointerdown", (e) => { if (e.button === 2) this.rdown = { x: e.clientX, y: e.clientY }; });
    cv.addEventListener("contextmenu", (e) => this._onContext(e));
    // capture phase: Alt+drag must reach us before the orbit controls and the gizmo
    vp.el.addEventListener("pointerdown", (e) => this._boxStart(e), true);
    // releasing Alt after a box selection must not move focus to the browser menu
    addEventListener("keyup", (e) => { if (e.key === "Alt" && this.boxed) { e.preventDefault(); this.boxed = false; } });
  }

  // ---------- shared ----------

  _ndc(e) {
    const r = this.vp.renderer.domElement.getBoundingClientRect();
    this.vp.ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.vp.ray.setFromCamera(this.vp.ndc, this.vp.camera);
    return this.vp.ray;
  }

  /** Entity under the pointer (hidden ones skipped; locked ones returned) and the ground point */
  _pick(e) {
    const vp = this.vp, P = vp.store.project, ray = this._ndc(e);
    let ent = null, point = null;
    const hits = ray.intersectObjects([vp.dyn, vp.rt.world], true).filter((x) => x.object.isMesh && visibleChain(x.object));
    for (const hit of hits) {
      for (let o = hit.object; o && !ent; o = o.parent) {
        const id = o.userData.entityId, found = id && findEntity(P, id);
        if (found && !found.spec.hidden) { ent = found; point = hit.point.clone(); }
      }
      if (ent) break;
    }
    const ground = new THREE.Vector3();
    return { ent, point, ground: ray.ray.intersectPlane(GROUND, ground) ? ground : null };
  }

  /** Base point of an entity for measuring and box selection */
  anchor(ent, mid = false) {
    const vp = this.vp, rt = vp.rt, s = vp.store;
    if (ent.list === "cameras") {
      const m = vp.camModels.find((c) => c.id === ent.spec.id)?.m;
      return m ? m.position.clone() : rt.cameraState(ent.spec.id, s.time, 1)?.position.clone() || null;
    }
    const e = rt.entities.get(ent.spec.id);
    if (!e) return null;
    if (ent.list === "lights") return e.light.position.clone();
    const p = e.object.position.clone();
    if (mid && ent.list === "actors") p.y += e.height * 0.5;
    return p;
  }

  // ---------- e06 right-click menu ----------

  _onContext(e) {
    e.preventDefault();
    const vp = this.vp, s = vp.store;
    const moved = this.rdown && Math.hypot(e.clientX - this.rdown.x, e.clientY - this.rdown.y) > 4;
    this.rdown = null;
    if (moved || s.posing || vp.pilot) return; // right-drag pans the view
    const { ent, ground } = this._pick(e);
    const P = s.project;
    if (ent && ent.spec.locked) {
      menu(e.clientX, e.clientY, [
        { label: `解除鎖定「${ent.spec.name}」`, onClick: () => toggleFlag([ent.spec.id], "locked") },
        { label: "對準這個物件", onClick: () => { s.select({ id: ent.spec.id }); vp.focusSelected(); } },
      ]);
      return;
    }
    if (ent) {
      const id = ent.spec.id, spec = ent.spec;
      if (!selIds(s.sel).includes(id)) selectIds(withGroups(P, [id]), id);
      const ids = selIds(s.sel), many = ids.length > 1;
      const keyable = !(ent.list === "cameras" && spec.mount) && !(ent.list === "props" && spec.attach);
      const items = [
        { label: "對準", onClick: () => vp.focusSelected() },
        keyable && { label: "在播放頭加路徑點", onClick: () => ops.addKeyAtPlayhead(id, "path", ops.trackValueAt(spec, "path", s.time)) },
        ent.list === "props" && !spec.attach && { label: "放到下方表面", onClick: () => this.dropToSurface(id) },
        ent.list === "cameras" && { label: "從這台攝影機看（駕駛）", onClick: () => vp.pilotStart(id) },
        ent.list === "cameras" && { label: "預覽到導演台", onClick: () => s.setPreview(id) },
        ent.list === "cameras" && { label: "在播放頭切到這台", onClick: () => ops.cutTo(id, s.time) },
        { label: many ? `複製 ${ids.length} 個物件` : "複製", onClick: () => ops.duplicateSelected() },
        { label: "複製到剪貼簿", onClick: () => copyEntities(ids) },
        { label: "隱藏", onClick: () => toggleFlag(ids, "hidden") },
        { label: "鎖定", onClick: () => toggleFlag(ids, "locked") },
        { label: many ? `刪除 ${ids.length} 個物件` : `刪除「${spec.name}」`, onClick: () => ops.deleteSelection() },
      ];
      menu(e.clientX, e.clientY, items);
      return;
    }
    const items = [];
    const targets = selIds(s.sel).map((id) => findEntity(P, id)).filter(movable);
    if (ground && targets.length) {
      items.push({ label: targets.length > 1 ? `把選取的 ${targets.length} 個物件移到這裡（播放頭）` : `把「${targets[0].spec.name}」移到這裡（播放頭）`, onClick: () => this._moveHere(targets, ground) });
    }
    items.push({ label: "從目前視角建立攝影機", onClick: () => this.cameraFromView() });
    items.push({ label: "貼上", onClick: () => pasteEntities() });
    menu(e.clientX, e.clientY, items);
  }

  /** Move the selection so the primary lands on the ground point; the others keep their offsets */
  _moveHere(targets, ground) {
    const s = this.vp.store;
    const primary = targets.find((t) => t.spec.id === s.sel.id) || targets[0];
    const base = ops.trackValueAt(primary.spec, "path", s.time);
    const d = [ground.x - base[0], 0, ground.z - base[2]];
    ops.moveEntities(targets.map((t) => [t.spec.id, ops.trackValueAt(t.spec, "path", s.time).map((x, i) => x + d[i])]), { autoKey: this.vp.autoKey });
  }

  cameraFromView() {
    const vp = this.vp, S = vp.store.project.settings;
    const lens = fovToLens(vp.camera.fov, S.width / S.height);
    cameraFromView(vp.camera.position.toArray(), vp.orbit.target.toArray(), lens);
    toast(`已建立「${findEntity(vp.store.project, vp.store.sel.id)?.spec.name}」，焦距 ${Math.round(lens)} mm（照目前 3D 視窗的視角）`);
  }

  // ---------- e01 Alt+drag box select ----------

  _boxStart(e) {
    const vp = this.vp;
    if (!e.altKey || e.button !== 0 || vp.store.posing || vp.pilot || this.ruler || vp.wall?.mode) return;
    const cv = vp.renderer.domElement;
    if (e.target !== cv) return;
    e.preventDefault();
    e.stopPropagation();
    const host = vp.el.getBoundingClientRect();
    const x0 = e.clientX, y0 = e.clientY, add = e.shiftKey || e.ctrlKey || e.metaKey;
    const box = h("div", { class: "boxsel" });
    vp.el.append(box);
    const draw = (x, y) => Object.assign(box.style, {
      left: Math.min(x, x0) - host.left + "px", top: Math.min(y, y0) - host.top + "px",
      width: Math.abs(x - x0) + "px", height: Math.abs(y - y0) + "px",
    });
    draw(x0, y0);
    const move = (ev) => draw(ev.clientX, ev.clientY);
    const up = (ev) => {
      removeEventListener("pointermove", move, true);
      removeEventListener("pointerup", up, true);
      box.remove();
      vp.justDragged = true; // the canvas pointerup must not count as a click
      this.boxed = true;
      this._boxFinish(x0, y0, ev.clientX, ev.clientY, add);
    };
    addEventListener("pointermove", move, true);
    addEventListener("pointerup", up, true);
  }

  _boxFinish(x0, y0, x1, y1, add) {
    const vp = this.vp, s = vp.store, P = s.project;
    const r = vp.renderer.domElement.getBoundingClientRect();
    const [ax, bx, ay, by] = [Math.min(x0, x1), Math.max(x0, x1), Math.min(y0, y1), Math.max(y0, y1)];
    if (bx - ax < 4 && by - ay < 4) return;
    const ids = [], v = new THREE.Vector3();
    for (const list of ["actors", "props", "lights", "cameras"]) for (const spec of P[list]) {
      if (spec.hidden || spec.locked) continue;
      const p = this.anchor({ list, spec }, true);
      if (!p) continue;
      v.copy(p).project(vp.camera);
      if (v.z > 1) continue; // behind the view
      const sx = r.left + ((v.x + 1) / 2) * r.width, sy = r.top + ((1 - v.y) / 2) * r.height;
      if (sx >= ax && sx <= bx && sy >= ay && sy <= by) ids.push(spec.id);
    }
    const picked = withGroups(P, ids);
    if (add) {
      const extra = picked.filter((id) => !selIds(s.sel).includes(id));
      if (extra.length) toggleSelect(extra);
      return;
    }
    if (picked.length) selectIds(picked, picked[0]); else s.select({});
  }

  // ---------- v03 ruler ----------

  setRuler(on) {
    this.ruler = on ? { pts: [] } : null;
    this._drawRuler();
  }

  /** Called on a plain left click; true when the ruler used it */
  onClick(e) {
    if (!this.ruler) return false;
    const { ent, ground } = this._pick(e);
    const p = ent ? this.anchor(ent) : ground;
    if (!p) return true;
    if (this.ruler.pts.length >= 2) this.ruler.pts = [];
    this.ruler.pts.push(p);
    this._drawRuler();
    return true;
  }

  _drawRuler() {
    const g = this.rulerGroup;
    for (const c of [...g.children]) {
      g.remove(c);
      c.geometry?.dispose();
      c.material?.dispose();
    }
    const pts = this.ruler?.pts || [];
    for (const p of pts) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 8), new THREE.MeshBasicMaterial({ color: "#ff5ea8", depthTest: false }));
      m.position.copy(p);
      m.renderOrder = 30;
      g.add(m);
    }
    if (pts.length < 2) return;
    const [a, b] = pts;
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([a, b]), new THREE.LineBasicMaterial({ color: "#ff5ea8", depthTest: false }));
    line.renderOrder = 30;
    const d = a.distanceTo(b), flat = Math.hypot(a.x - b.x, a.z - b.z);
    const lab = tag(`${fmt(d)} m${Math.abs(a.y - b.y) > 0.05 ? `（水平 ${fmt(flat)} m）` : ""}`, "ruler");
    lab.position.copy(a).add(b).multiplyScalar(0.5).y += 0.1;
    g.add(line, lab);
  }

  // ---------- v02 drop on surface ----------

  /** Small enough to set on a table: local box height ≤ 0.6 m and footprint ≤ 0.8 m */
  isSmallProp(ent) {
    if (ent?.list !== "props") return false;
    const mesh = this.vp.rt.entities.get(ent.spec.id)?.mesh;
    if (!mesh) return false;
    const box = new THREE.Box3().setFromObject(mesh, true), size = box.getSize(new THREE.Vector3());
    return size.y <= 0.6 && Math.max(size.x, size.z) <= 0.8;
  }

  /** Height of the highest flat top under the prop's footprint at (x, z) below fromY, ignoring the prop itself and actors; 0 = ground */
  surfaceY(selfId, x, z, fromY = 20) {
    const rt = this.vp.rt, P = this.vp.store.project;
    const blockers = [];
    for (const o of P.props) {
      if (o.id === selfId || o.hidden || o.attach) continue;
      const e = rt.entities.get(o.id);
      if (e) blockers.push(e.object);
    }
    // five rays across the footprint: a single ray in the middle drops through the gap between bench slats
    const mesh = rt.entities.get(selfId)?.mesh;
    const size = mesh ? new THREE.Box3().setFromObject(mesh, true).getSize(new THREE.Vector3()) : new THREE.Vector3();
    const rx = Math.min(0.15, Math.max(0.03, size.x / 2)), rz = Math.min(0.15, Math.max(0.03, size.z / 2));
    const n = new THREE.Vector3();
    let top = 0;
    for (const [dx, dz] of [[0, 0], [rx, 0], [-rx, 0], [0, rz], [0, -rz]]) {
      this.surfRay.set(new THREE.Vector3(x + dx, fromY, z + dz), DOWN);
      for (const hit of this.surfRay.intersectObjects(blockers, true)) {
        if (!hit.face || !visibleChain(hit.object)) continue;
        n.copy(hit.face.normal).transformDirection(hit.object.matrixWorld);
        if (n.y > 0.7 && hit.point.y <= 1.6) { top = Math.max(top, hit.point.y); break; }
      }
    }
    return Math.round(top * 1000) / 1000;
  }

  /** Menu action: drop a prop straight down onto what is under it */
  dropToSurface(id) {
    const vp = this.vp, s = vp.store, ent = findEntity(s.project, id);
    if (!ent) return;
    const v = ops.trackValueAt(ent.spec, "path", s.time);
    const y = this.surfaceY(id, v[0], v[2], v[1] + 0.05);
    ops.moveEntityTo(id, [v[0], y, v[2]], { autoKey: vp.autoKey });
    toast(y > 0 ? `已放到 ${fmt(y)} 公尺高的表面` : "下方沒有表面，已放到地面");
  }
}
