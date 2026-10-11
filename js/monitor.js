// Director monitor: the program picture (cut list, a previewed camera or a live-cut take) plus a live thumbnail per camera.
// One renderer draws all of them with scissor rectangles; clicking a thumbnail cuts to that camera at the playhead.
import * as THREE from "three";
import * as ops from "./ops.js";
import { h, timecode, select, menu, modal, num, row, toast } from "./ui.js";
import { cutAt } from "../runtime/camera.js";
import { DofPass } from "../runtime/dof.js";
import { letterboxRect, infoText } from "../runtime/overlay.js";

const PREFS_KEY = "blockingpro.monitor";
const DEFAULTS = { thirds: true, golden: false, center: false, diag: false, safe: 90, info: false, perf: false };
const GUIDES = [["thirds", "三分線"], ["golden", "黃金比例"], ["center", "中心十字"], ["diag", "對角線"]];

function loadPrefs() {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(PREFS_KEY) || "{}") }; } catch { return { ...DEFAULTS }; }
}

/** Composition guides as SVG markup in a 0..100 box stretched over the picture */
function guideSvg(g) {
  const ln = (x1, y1, x2, y2, cls = "") => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"${cls && ` class="${cls}"`}/>`;
  const out = [];
  const grid = (a, cls) => { for (const f of a) out.push(ln(f, 0, f, 100, cls), ln(0, f, 100, f, cls)); };
  if (g.thirds) grid([100 / 3, 200 / 3]);
  if (g.golden) grid([38.2, 61.8], "gold");
  if (g.diag) out.push(ln(0, 0, 100, 100), ln(100, 0, 0, 100));
  if (g.center) out.push(ln(47, 50, 53, 50, "strong"), ln(50, 46, 50, 54, "strong"));
  if (g.safe) { const m = (100 - g.safe) / 2; out.push(`<rect x="${m}" y="${m}" width="${g.safe}" height="${g.safe}"/>`); }
  return out.length ? `<svg viewBox="0 0 100 100" preserveAspectRatio="none">${out.join("")}</svg>` : "";
}

export class Monitor {
  constructor(el, store, rt) {
    Object.assign(this, { el, store, rt });
    this.prefs = loadPrefs();
    this.livecut = null; // set by main.js
    this.frameNo = 0;
    this.head = h("div", { class: "monhead" });
    this.view = h("div", { class: "monview" });
    this.overlay = h("div", { style: { position: "absolute", inset: "0", pointerEvents: "none" } });
    el.append(this.head, this.view);
    // keep the last picture so the performance mode can redraw only the program view
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(this.pixelRatio());
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.shadowMap.autoUpdate = false;
    this.dof = new DofPass();
    this.subEl = h("div", { class: "mon-sub" });
    this.subKey = "";
    this.infoEl = h("div", { class: "mon-info" });
    this.view.append(this.renderer.domElement, this.overlay, this.infoEl, this.subEl);
    this.cam = new THREE.PerspectiveCamera(35, 16 / 9, 0.05, 500);
    this.layoutKey = "";
    this.size = [0, 0];
    new ResizeObserver(() => this.resize()).observe(this.view);
    store.subscribe((what) => { if (what === "project" || what === "preview") this.renderHead(); });
    document.addEventListener("fullscreenchange", () => this.renderHead());
    this.renderHead();
    this.resize();
  }

  pixelRatio() { return this.prefs.perf ? 1 : Math.min(devicePixelRatio, 1.5); }

  resize() {
    const w = Math.max(1, this.view.clientWidth), hh = Math.max(1, this.view.clientHeight);
    this.size = [w, hh];
    this.renderer.setSize(w, hh, false);
    this.layoutKey = "";
    this.dirty = true;
  }

  setPref(patch) {
    const perf = this.prefs.perf;
    this.prefs = { ...this.prefs, ...patch };
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(this.prefs)); } catch { /* private window: keep for this session only */ }
    if (perf !== this.prefs.perf) { this.renderer.setPixelRatio(this.pixelRatio()); this.resize(); }
    this.layoutKey = "";
    this.dirty = true;
    this.renderHead();
  }

  renderHead() {
    const s = this.store, P = s.project, g = this.prefs, rec = !!this.livecut?.recording;
    this.pgm = h("span", { class: "pgm" }, "PGM");
    this.camName = h("span", {});
    this.cutNote = h("span", { class: "cutnote" });
    this.tc = h("span", { class: "tc" });
    const full = document.fullscreenElement === this.el;
    this.head.replaceChildren(
      h("b", {}, "導演台"), this.pgm, this.camName, this.cutNote, h("span", { class: "grow" }), this.tc,
      select([["", "節目（依剪接）"], ...P.cameras.map((c) => [c.id, `預覽：${c.name}`])], s.preview || "", (v) => s.setPreview(v)),
      h("button", { title: "構圖線與安全框", onclick: (e) => this.guideMenu(e) }, "構圖線▾"),
      h("button", { class: g.info ? "on" : null, title: "在畫面左上角顯示鏡號、攝影機、焦距、這一鏡的秒數", onclick: () => this.setPref({ info: !g.info }) }, "資訊"),
      h("button", { class: g.perf ? "on" : null, title: "小畫面或電腦較慢時使用：解析度 1 倍、播放時縮圖每 5 格才更新一次、不算景深", onclick: () => this.setPref({ perf: !g.perf }) }, "省效能"),
      h("button", { class: rec ? "rec on" : "rec", title: "從目前時間開始播放，播放中按 1 到 9 或點縮圖切換攝影機；停止播放時，用這段錄製取代這段時間原本的剪接（Ctrl+Z 可復原）", onclick: () => this.livecut?.toggle() }, rec ? "■ 停止錄製" : "● 導播錄製"),
      h("button", { title: full ? "離開全螢幕（Esc）" : "導演台全螢幕（Esc 離開）", onclick: () => (full ? document.exitFullscreen() : this.el.requestFullscreen()).catch((e) => toast(`瀏覽器不允許全螢幕（${e.message}），可改用瀏覽器本身的全螢幕（F11）`, "warn")) }, full ? "離開全螢幕" : "全螢幕"),
    );
    this.dirty = true;
  }

  guideMenu(e) {
    const r = e.currentTarget.getBoundingClientRect(), g = this.prefs, mark = (on, label) => `${on ? "✓" : "　"} ${label}`;
    const custom = g.safe && g.safe !== 90 && g.safe !== 80;
    menu(r.left, r.bottom + 2, [
      ...GUIDES.map(([k, label]) => ({ label: mark(g[k], label), onClick: () => this.setPref({ [k]: !g[k] }) })),
      ...[90, 80].map((v) => ({ label: mark(g.safe === v, `安全框 ${v}%`), onClick: () => this.setPref({ safe: v }) })),
      { label: mark(custom, custom ? `自訂安全框 ${g.safe}%…` : "自訂安全框…"), onClick: () => this.customSafe() },
      { label: mark(!g.safe, "不顯示安全框"), onClick: () => this.setPref({ safe: 0 }) },
    ]);
  }

  customSafe() {
    let v = this.prefs.safe || 85;
    modal("自訂安全框", [row("佔畫面寬高（%）", num(v, (x) => { v = x; }, { step: 1, min: 50, max: 99, digits: 0 })), h("div", { class: "note" }, "常用：動作安全框 90%、字幕安全框 80%")],
      [{ label: "取消" }, { label: "套用", primary: true, onClick: (close) => { this.setPref({ safe: Math.round(v) }); close(); } }]);
  }

  /** Rectangles (CSS px, top-left origin) of the program picture and the thumbnails */
  layout() {
    const [W, H] = this.size, P = this.store.project, aspect = P.settings.width / P.settings.height, n = P.cameras.length;
    let tw = 0, th = 0;
    if (n) {
      th = Math.max(46, Math.min(110, H * 0.2));
      tw = th * aspect;
      const maxW = (W - (n + 1) * 4) / n;
      if (tw > maxW) { tw = maxW; th = tw / aspect; }
    }
    const progH = Math.max(10, H - (n ? th + 8 : 0));
    let pw = W, ph = pw / aspect;
    if (ph > progH) { ph = progH; pw = ph * aspect; }
    const prog = { x: (W - pw) / 2, y: (progH - ph) / 2, w: pw, h: ph };
    const total = n * tw + (n - 1) * 4;
    const thumbs = P.cameras.map((c, i) => ({ id: c.id, x: (W - total) / 2 + i * (tw + 4), y: H - th - 4, w: tw, h: th }));
    // the part of the program picture inside the letterbox matte
    const a = letterboxRect(pw, ph, P.settings.letterbox);
    return { prog, thumbs, aspect, active: { x: prog.x + a.x, y: prog.y + a.y, w: a.w, h: a.h } };
  }

  /** Draw camera camId into rectangle r. Returns the camera state (null for the default view). */
  _draw(r, camId, t, aspect, useDof = false) {
    const R = this.renderer, H = this.size[1];
    const st = camId ? this.rt.applyCamera(this.cam, camId, t, aspect) : null;
    if (!st) {
      this.cam.aspect = aspect;
      this.cam.fov = 40;
      this.cam.position.set(6, 4, 8);
      this.cam.lookAt(0, 1, 0);
      this.cam.updateProjectionMatrix();
    }
    R.setViewport(r.x, H - r.y - r.h, r.w, r.h);
    R.setScissor(r.x, H - r.y - r.h, r.w, r.h);
    if (useDof && st?.dof) { const pr = R.getPixelRatio(); this.dof.render(R, this.rt.scene, this.cam, st, r.w * pr, r.h * pr); }
    else R.render(this.rt.scene, this.cam);
    return st;
  }

  render() {
    this.dirty = false;
    this.frameNo++;
    const s = this.store, t = s.time, P = s.project, g = this.prefs, lc = this.livecut, rec = !!lc?.recording;
    const L = this.layout();
    const live = rec ? lc.current : this.rt.liveCamera(t);
    const progId = s.preview || live;
    const key = JSON.stringify([this.size, L.thumbs.map((x) => x.id), live, s.preview, rec, g, P.settings.letterbox, P.cameras.map((c) => c.name + c.color)]);
    const relayout = key !== this.layoutKey;
    // performance mode: while playing, thumbnails are redrawn on every 5th frame only
    const all = relayout || !(g.perf && s.playing) || this.frameNo % 5 === 0;
    const R = this.renderer;
    R.setClearColor(0x08090c, 1);
    if (all) { R.setScissorTest(false); R.clear(); }
    R.setScissorTest(true);
    R.shadowMap.needsUpdate = true;
    const st = this._draw(L.prog, progId, t, L.aspect, !g.perf);
    if (all) for (const th of L.thumbs) this._draw(th, th.id, t, L.aspect);
    R.setScissorTest(false);

    const cam = P.cameras.find((c) => c.id === progId);
    this.pgm.textContent = rec ? "錄製中" : s.preview ? "預覽" : "PGM";
    this.pgm.style.background = s.preview && !rec ? "#2f7d32" : "#d72638";
    this.camName.textContent = cam ? `${cam.name}｜${Math.round(st?.lens || 35)}mm` : "預設視角（沒有攝影機）";
    this.tc.textContent = timecode(t, P.settings.fps);
    const note = rec ? "按 1 到 9 或點縮圖切換攝影機，停止播放就寫入剪接" : s.preview ? "" : cutAt(P, t)?.note || "";
    if (this.cutNote.textContent !== note) { this.cutNote.textContent = note; this.cutNote.title = note; }

    if (relayout) { this.layoutKey = key; this.buildOverlay(L, live); }
    this.renderInfo(L.active, cam ? infoText(P, t, progId, st?.lens, !!s.preview || rec) : "");
    this.renderSubtitle(L.active, t);
  }

  /** Shot number, camera, focal length and seconds at the top-left of the picture */
  renderInfo(a, text) {
    const show = this.prefs.info && text;
    this.infoEl.style.display = show ? "block" : "none";
    if (!show) return;
    if (this.infoEl.textContent !== text) this.infoEl.textContent = text;
    Object.assign(this.infoEl.style, { left: a.x + a.h * 0.02 + "px", top: a.y + a.h * 0.02 + "px", fontSize: Math.max(10, a.h * 0.032) + "px" });
  }

  /** The dialogue line at time t, at the bottom of the picture (inside the letterbox matte) */
  renderSubtitle(p, t) {
    const P = this.store.project, x = P.subtitles.find((y) => t >= y.t && t < y.t + y.dur);
    const who = x?.actor && P.actors.find((a) => a.id === x.actor);
    const text = x ? (who ? `${who.name}：${x.text}` : x.text) : "";
    const [, H] = this.size, key = JSON.stringify([text, p]);
    if (key === this.subKey) return;
    this.subKey = key;
    this.subEl.textContent = text;
    this.subEl.style.display = text ? "block" : "none";
    Object.assign(this.subEl.style, {
      left: p.x + p.w / 2 + "px", bottom: H - (p.y + p.h) + p.h * 0.06 + "px",
      maxWidth: p.w * 0.9 + "px", fontSize: Math.max(11, p.h * 0.045) + "px",
    });
  }

  buildOverlay(L, live) {
    const s = this.store, P = s.project, px = (v) => v + "px", p = L.prog, a = L.active;
    const box = (cls, x, y, w, hh) => h("div", { class: cls, style: { left: px(x), top: px(y), width: px(w), height: px(hh) } });
    const els = [];
    if (a.h < p.h - 0.5) els.push(box("mon-matte", p.x, p.y, p.w, a.y - p.y), box("mon-matte", p.x, a.y + a.h, p.w, p.y + p.h - a.y - a.h));
    else if (a.w < p.w - 0.5) els.push(box("mon-matte", p.x, p.y, a.x - p.x, p.h), box("mon-matte", a.x + a.w, p.y, p.x + p.w - a.x - a.w, p.h));
    const svg = guideSvg(this.prefs);
    if (svg) { const el = box("mon-guides", a.x, a.y, a.w, a.h); el.innerHTML = svg; els.push(el); }
    const rec = !!this.livecut?.recording;
    L.thumbs.forEach((th, i) => {
      const cam = P.cameras[i];
      els.push(h("div", {
        class: `thumb-hit${th.id === live ? " live" : ""}`,
        style: { left: px(th.x), top: px(th.y), width: px(th.w), height: px(th.h), pointerEvents: "auto", borderColor: s.preview === th.id ? "#2f7d32" : null },
        title: rec ? `切到 ${cam.name}${i < 9 ? `（快捷鍵 ${i + 1}）` : ""}` : `點一下：在目前時間切到 ${cam.name}${i < 9 ? `（快捷鍵 ${i + 1}）` : ""}；右鍵：只預覽不剪接`,
        onclick: () => (rec ? this.livecut.press(th.id) : ops.cutTo(th.id, s.time)),
        oncontextmenu: (e) => { e.preventDefault(); if (!rec) s.setPreview(s.preview === th.id ? null : th.id); },
      }, h("div", { class: "thumb-label", style: { left: "0", top: "0", borderColor: cam.color } }, `${i < 9 ? i + 1 + " " : ""}${cam.name}`)));
    });
    this.overlay.replaceChildren(...els);
  }
}
