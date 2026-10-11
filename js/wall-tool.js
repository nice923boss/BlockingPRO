// p02 wall tool: click corners on the ground to draw walls, click a wall to cut a door or window into it.
// The walls are built-in wall props (runtime/walls.js), each operation one undo step.
import * as THREE from "three";
import { uid } from "../runtime/schema.js";
import { OPENINGS, isFullPiece, pieceRun, cutOpening, roomWalls } from "../runtime/walls.js";
import { uniqueName } from "./ops.js";
import { tag } from "./viewport-tools.js";
import { toast, fmt, round, isTyping } from "./ui.js";

const GROUND = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const LABEL = { door: "門", window: "窗戶" };
const CLOSE = 0.3; // a click this near the first corner closes the room
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

export class WallTool {
  constructor(vp) {
    this.vp = vp;
    this.mode = null; // "draw" | "door" | "window"
    this.pts = []; // corners clicked so far, [x, z]
    this.group = new THREE.Group();
    vp.overlay.add(this.group);
    this._onMove = (e) => this._draw(e);
    this._onKey = (e) => this._key(e);
  }

  set(mode) {
    const vp = this.vp, cv = vp.renderer.domElement, was = this.mode;
    this.mode = mode || null;
    this.pts = [];
    if (this.mode && !was) { cv.addEventListener("pointermove", this._onMove); addEventListener("keydown", this._onKey, true); }
    if (!this.mode && was) { cv.removeEventListener("pointermove", this._onMove); removeEventListener("keydown", this._onKey, true); }
    if (this.mode) vp.tools.setRuler(false);
    if (this.mode === "draw" && was !== "draw") vp.viewTop();
    this._draw();
    vp.onToolChange?.();
  }

  /** Called on a plain left click; true when the wall tool used it */
  onClick(e) {
    if (!this.mode) return false;
    if (this.mode !== "draw") { this._cut(e); return true; }
    const g = this._ground(e);
    if (!g) return true;
    const last = this.pts.at(-1);
    if (g.close) this.finish(true);
    else if (last && dist(g.pt, last) < 0.05) this.finish(false); // clicked the last corner again
    else this.pts.push(g.pt);
    this._draw(e);
    return true;
  }

  /** Build the walls along the corners clicked so far */
  finish(closed) {
    const list = roomWalls(this.pts, closed);
    this.pts = [];
    if (!list.length) return;
    this.vp.store.edit(closed ? "畫房間" : "畫牆", (p) => {
      for (const { v, ...o } of list) p.props.push({ ...o, id: uid("o"), name: uniqueName(p, "牆"), path: { keys: [{ t: 0, v }] } });
    });
    toast(`已建立 ${list.length} 段牆${closed ? "，房間已封閉" : ""}（Ctrl+Z 可復原）`);
  }

  _key(e) {
    if (isTyping(e) || document.querySelector(".modal-back, .menu")) return;
    const k = e.key;
    if (k === "Escape") { if (this.mode === "draw" && this.pts.length) { this.pts = []; this._draw(); } else this.set(null); }
    else if (this.mode === "draw" && k === "Enter") { this.finish(false); this._draw(); }
    else if (this.mode === "draw" && k === "Backspace") { this.pts.pop(); this._draw(); }
    else return;
    e.preventDefault();
    e.stopPropagation();
  }

  /** Ground point under the pointer on the grid, lined up with the previous corner when nearly level or plumb */
  _ground(e) {
    const p = new THREE.Vector3();
    if (!this.vp.tools._ndc(e).ray.intersectPlane(GROUND, p)) return null;
    const step = this.vp.snap ? 0.5 : 0.1, grid = (x) => round(Math.round(x / step) * step, 2);
    const q = [grid(p.x), grid(p.z)];
    if (this.pts.length >= 3 && dist(q, this.pts[0]) < CLOSE) return { pt: this.pts[0], close: true };
    const last = this.pts.at(-1);
    if (last) {
      const dx = Math.abs(q[0] - last[0]), dz = Math.abs(q[1] - last[1]);
      if (dz < dx * 0.18) q[1] = last[1]; // within 10 degrees of level
      else if (dx < dz * 0.18) q[0] = last[0];
    }
    return { pt: q };
  }

  /** Wall piece under the pointer and its pieces with the opening cut in, or why it cannot take one */
  _target(e) {
    const { ent, point } = this.vp.tools._pick(e);
    const o = ent?.list === "props" ? ent.spec : null;
    if (!o || o.type !== "wall") return null;
    if (o.locked) return { why: `「${o.name}」已鎖定，先解除鎖定` };
    if (o.path.keys.length > 1) return { why: `「${o.name}」有多個路徑點（會移動），不能開口` };
    const v = o.path.keys[0].v;
    if (!isFullPiece(v, o.scale)) return { why: "這片是門窗上下的補牆或改過高度的牆，點旁邊整面的牆" };
    const [a, b] = pieceRun(v, o.yaw, o.scale), len = dist(a, b);
    const at = ((point.x - a[0]) * (b[0] - a[0]) + (point.z - a[1]) * (b[1] - a[1])) / len;
    const list = cutOpening(v, o.yaw, o.scale, this.mode, round(at / 0.05, 0) * 0.05);
    return list ? { o, list } : { why: `「${o.name}」只有 ${fmt(len)} 公尺，放不下${LABEL[this.mode]}（寬 ${OPENINGS[this.mode].w} 公尺）` };
  }

  _cut(e) {
    const t = this._target(e), type = this.mode;
    if (!t) return toast(`點一面牆，${LABEL[type]}會開在點的位置`, "warn");
    if (t.why) return toast(t.why, "warn");
    const s = this.vp.store, oid = t.o.id;
    s.edit(`在「${t.o.name}」開${LABEL[type]}`, (p) => {
      const i = p.props.findIndex((x) => x.id === oid);
      const [{ id, name, path, scale, yaw, ...keep }] = p.props.splice(i, 1); // keep color, display and the rest
      let walls = 0; // the first wall piece keeps the name, the others are name-2, name-3
      const ids = t.list.map(({ v, ...q }, k) => {
        const base = q.type !== "wall" ? LABEL[type] : walls++ ? `${name}-${walls}` : name;
        const o = { ...(q.type === "wall" ? keep : {}), ...q, id: uid("o"), name: uniqueName(p, base), path: { keys: [{ t: 0, v }] } };
        p.props.splice(i + k, 0, o);
        return o.id;
      });
      p.groups = p.groups.map((g) => (g.members.includes(oid) ? { ...g, members: g.members.flatMap((m) => (m === oid ? ids : [m])) } : g));
    });
    if (s.sel.id === oid || s.sel.ids?.includes(oid)) s.select({});
    this._draw(e);
  }

  // ---------- preview ----------

  _clear() {
    for (const c of [...this.group.children]) {
      this.group.remove(c);
      c.geometry?.dispose();
      c.material?.dispose();
    }
  }

  _add(o, color) {
    o.material = o.isLine ? new THREE.LineBasicMaterial({ color, depthTest: false }) : new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.55 });
    o.renderOrder = 30;
    this.group.add(o);
    return o;
  }

  _line(a, b) {
    this._add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(a[0], 0.02, a[1]), new THREE.Vector3(b[0], 0.02, b[1])])), "#ff9f1c");
    const t = tag(`${fmt(dist(a, b))} m`, "ruler");
    t.position.set((a[0] + b[0]) / 2, 0.1, (a[1] + b[1]) / 2);
    this.group.add(t);
  }

  _dot(p, color, r = 0.07) {
    this._add(new THREE.Mesh(new THREE.SphereGeometry(r, 12, 8)), color).position.set(p[0], 0.02, p[1]);
  }

  /** Corners, walls so far and the next wall to the pointer; in door / window mode the opening under the pointer */
  _draw(e) {
    this._clear();
    if (!this.mode) return;
    if (this.mode !== "draw") {
      const t = e && this._target(e), op = t?.list?.find((o) => o.type === this.mode);
      if (!op) return;
      const { w, top, sill } = OPENINGS[this.mode];
      const m = this._add(new THREE.Mesh(new THREE.BoxGeometry(w, top - sill, 0.3)), "#4caf50");
      m.position.set(op.v[0], sill + (top - sill) / 2, op.v[2]);
      m.rotation.y = (op.yaw * Math.PI) / 180;
      return;
    }
    const pts = this.pts;
    pts.forEach((p, i) => { this._dot(p, i ? "#ff9f1c" : "#ff5ea8"); if (i) this._line(pts[i - 1], p); });
    const g = e && this._ground(e);
    if (!g) return;
    if (pts.length) this._line(pts.at(-1), g.pt);
    this._dot(g.pt, g.close ? "#4caf50" : "#ffffff", g.close ? 0.14 : 0.05);
  }
}
