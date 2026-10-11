// Four-view layout (v04): top, front and side orthographic views around the main perspective view (top right, like Maya).
// The side views get their own canvas, so the main canvas keeps its own pointer handling (orbit, gizmo, picking).
import * as THREE from "three";
import { h } from "./ui.js";

// row 1 = upper half; x 1 = right half
const VIEWS = [
  { name: "俯視", col: 0, row: 1, dir: [0, 1, 0], up: [0, 0, -1], axes: ["x", "z"] },
  { name: "前視", col: 0, row: 0, dir: [0, 0, 1], up: [0, 1, 0], axes: ["x", "y"] },
  { name: "右視", col: 1, row: 0, dir: [1, 0, 0], up: [0, 1, 0], axes: ["z", "y"] },
];
const BG = new THREE.Color("#2a2e36");

export class Quad {
  constructor(vp) {
    this.vp = vp;
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setScissorTest(true);
    this.renderer.shadowMap.autoUpdate = false; // drawn once per changed frame, not once per view
    this.fresh = true;
    const cv = this.renderer.domElement;
    cv.className = "quad3d";
    cv.addEventListener("contextmenu", (e) => e.preventDefault());
    vp.el.prepend(cv);
    this.cams = VIEWS.map(() => new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 400));
    this.tags = VIEWS.map((v, i) => h("div", { class: `quadtag q${i}` }, v.name));
    vp.el.append(...this.tags);
    vp.el.classList.add("quad");
    this.size = [1, 1];
    this.dir = new THREE.Vector3();
  }

  dispose() {
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
    for (const t of this.tags) t.remove();
    this.vp.el.classList.remove("quad");
  }

  resize(w, hgt) {
    this.size = [w, hgt];
    this.renderer.setSize(w, hgt, false);
  }

  /** Area to frame: everything with a path (not lights), at least 6 x 6 m */
  _bounds() {
    const P = this.vp.store.project;
    if (this.bp === P) return this.box;
    const box = new THREE.Box3(new THREE.Vector3(-3, 0, -3), new THREE.Vector3(3, 2, 3)), v = new THREE.Vector3();
    for (const list of ["actors", "props", "cameras"]) for (const spec of P[list]) {
      if (spec.hidden) continue;
      for (const k of spec.path.keys) box.expandByPoint(v.fromArray(k.v));
    }
    box.expandByScalar(1.5);
    this.bp = P;
    this.box = box;
    return box;
  }

  /** Called while hidden entities are switched off, after the main view rendered */
  render(changed = true) {
    const vp = this.vp, r = this.renderer, scene = vp.rt.scene;
    r.shadowMap.needsUpdate = changed || this.fresh;
    this.fresh = false;
    const [w, hgt] = this.size, qw = Math.floor(w / 2), qh = Math.floor(hgt / 2);
    const bar = vp.el.querySelector(".viewbar"), barH = bar ? Math.min(bar.offsetTop + bar.offsetHeight + 4, qh / 2) : 0;
    const box = this._bounds(), c = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
    const bg = scene.background, helper = vp.tc.getHelper(), helperOn = helper.visible;
    if (bg && !bg.isColor) scene.background = BG; // a panorama would only show a smear in a flat view
    helper.visible = false;
    VIEWS.forEach((v, i) => {
      const cam = this.cams[i];
      // the toolbar covers the top of the upper view: frame the content in the part below it
      const pad = v.row ? barH : 0, va = qw / Math.max(1, qh - pad);
      const hh = Math.max(size[v.axes[1]] / 2, size[v.axes[0]] / 2 / va, 2), hw = hh * va;
      Object.assign(cam, { left: -hw, right: hw, top: hh + 2 * hh * pad / Math.max(1, qh - pad), bottom: -hh });
      cam.updateProjectionMatrix();
      cam.up.fromArray(v.up);
      cam.position.copy(c).addScaledVector(this.dir.fromArray(v.dir), 100);
      cam.lookAt(c);
      const x = v.col ? w - qw : 0, y = v.row ? hgt - qh : 0;
      r.setViewport(x, y, qw, qh);
      r.setScissor(x, y, qw, qh);
      r.autoClear = true;
      r.render(scene, cam);
      r.autoClear = false;
      r.render(vp.overlay, cam);
    });
    scene.background = bg;
    helper.visible = helperOn;
  }
}
