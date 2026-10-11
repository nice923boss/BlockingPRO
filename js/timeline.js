// Timeline: transport bar, ruler with markers and in / out points, cut and subtitle tracks,
// key rows (paths, aim, lens, roll) with segment speeds, action clip rows. Snapping, multi-selection, rubber band.
// The DOM is rebuilt on project / selection changes; only the playhead moves while time changes.
import { buildPath, segmentSpeeds, EASINGS, easeLabel, isCurve } from "../runtime/keys.js";
import { actionsFor } from "../runtime/schema.js";
import { trackKeys, selKeys, selClips, SPEEDS } from "./state.js";
import * as ops from "./ops.js";
import * as tops from "./ops-time.js";
import { openStretch, openShotTable, editSubtitle, renameMarker } from "./timeline-dialogs.js";
import { audioRow, audioNameCell } from "./timeline-audio.js";
import { onAudioReady, clipLength } from "./audio.js";
import { h, menu, timecode, num, select, checkbox, fmt } from "./ui.js";

const ROW = { cut: "剪接", path: "路徑", aim: "目標點", lens: "焦距", roll: "滾轉", actions: "動作", upper: "上半身" };
const LIST_COLOR = { actors: "#ffd23f", props: "#9ad1ff", lights: "#ffffff" };
const SNAP_KEY = "blockingpro.tl.snap";
const SNAP_PX = 6; // snap when within this many pixels of a target

let seq = 0;
const keyTag = (id, track, i) => `key|${id}|${track}|${i}`;
const clipTag = (id, track, clipId) => `clip|${id}|${track}|${clipId}`;
const isMod = (e) => e.shiftKey || e.ctrlKey || e.metaKey;

/**
 * Pointer drag with a 3 px dead zone (horizontal only unless both). onMove(dx, ev, dy) during the drag,
 * onEnd(moved, ev) at the end.
 */
function drag(e, onMove, onEnd, { both = false } = {}) {
  e.preventDefault();
  e.stopPropagation();
  const x0 = e.clientX, y0 = e.clientY;
  let moved = false;
  const move = (ev) => {
    const dx = ev.clientX - x0, dy = ev.clientY - y0;
    if (!moved && Math.abs(dx) < 3 && !(both && Math.abs(dy) >= 3)) return;
    moved = true;
    onMove(dx, ev, dy);
  };
  const up = (ev) => {
    removeEventListener("pointermove", move);
    removeEventListener("pointerup", up);
    onEnd?.(moved, ev);
  };
  addEventListener("pointermove", move);
  addEventListener("pointerup", up);
}

export class Timeline {
  constructor(el, store, { onEditPose }) {
    Object.assign(this, { el, store, onEditPose });
    this.pps = null; // pixels per second, null = fit to width
    this.rescale = false; // changing the total length scales the content too
    try { this.snapOn = localStorage.getItem(SNAP_KEY) !== "0"; } catch { this.snapOn = true; }
    this.picked = new Set();
    this.bar = h("div", { class: "tl-bar" });
    this.body = h("div", { class: "tl-body" });
    this.names = h("div", { class: "tl-names" });
    this.tracks = h("div", { class: "tl-tracks" });
    this.playhead = h("div", { class: "tl-playhead" });
    this.rangeEl = h("div", { class: "tl-range" });
    this.band = h("div", { class: "tl-band" });
    this.snapLine = h("div", { class: "tl-snapline" });
    this.body.append(this.names, this.tracks);
    el.append(this.bar, this.body);
    this.body.addEventListener("wheel", (e) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      this.zoom(e.deltaY < 0 ? 1.25 : 0.8);
    }, { passive: false });
    new ResizeObserver(() => { if (this.pps == null) this.render(); }).observe(this.body);
    onAudioReady(() => this.render()); // waveform and length once a sound file is decoded
    store.subscribe((what) => {
      if (what === "project" || what === "sel") this.render();
      else if (what === "time") this.updateTime();
      else if (what === "play") { this.renderBar(); this.updateRange(); }
    });
    this.render();
  }

  get fps() { return this.store.project.settings.fps; }
  snap(t) { return Math.round(t * this.fps) / this.fps; }
  scale() {
    const d = this.store.project.settings.duration;
    return this.pps ?? Math.max(20, (this.body.clientWidth - 170 - 40) / d);
  }
  zoom(f) {
    this.pps = Math.max(10, Math.min(800, this.scale() * f));
    this.render();
  }
  tAt(clientX) {
    return Math.max(0, (clientX - this.tracks.getBoundingClientRect().left) / this.scale());
  }
  drag(e, onMove, onEnd, opts) {
    drag(e, onMove, (moved, ev) => { this.showSnap(null); onEnd?.(moved, ev); }, opts);
  }

  // ---------- snapping ----------

  /** Times a dragged item can snap to; tags in skip (the dragged items themselves) are left out */
  snapTargets(skip = new Set()) {
    const s = this.store, P = s.project, out = [];
    const add = (t, tag) => { if (!skip.has(tag)) out.push(t); };
    add(0, "zero");
    add(P.settings.duration, "end");
    add(s.time, "playhead");
    if (s.range) { add(s.range.a, "in"); add(s.range.b, "out"); }
    P.settings.markers.forEach((m, i) => add(m.t, `marker|${i}`));
    P.cuts.forEach((c, i) => add(c.t, `cut|${i}`));
    for (const x of P.subtitles) { add(x.t, `sub|${x.id}`); add(x.t + x.dur, `sub|${x.id}`); }
    for (const x of P.audio) { add(x.start, `au|${x.id}`); add(x.start + clipLength(x), `au|${x.id}`); }
    for (const list of ["cameras", "actors", "props", "lights"]) for (const e of P[list]) {
      for (const tr of ["path", "aim", "lens", "roll"]) (trackKeys(e, tr) || []).forEach((k, i) => add(k.t, keyTag(e.id, tr, i)));
      for (const tr of ["actions", "upper"]) for (const c of e[tr] || []) { add(c.start, clipTag(e.id, tr, c.id)); add(c.start + c.dur, clipTag(e.id, tr, c.id)); }
    }
    return out;
  }
  nearest(t, targets) {
    if (!this.snapOn) return null;
    let best = null, bd = SNAP_PX / this.scale();
    for (const x of targets) { const d = Math.abs(x - t); if (d <= bd) { bd = d; best = x; } }
    return best;
  }
  /** t snapped to the nearest target, otherwise to a frame */
  snapTo(t, targets) {
    const n = this.nearest(t, targets);
    this.showSnap(n);
    return n ?? this.snap(t);
  }
  /** Start of a span [start, start + dur] after snapping whichever edge is nearer to a target */
  snapSpan(start, dur, targets) {
    const a = this.nearest(start, targets), b = this.nearest(start + dur, targets);
    if (a != null && (b == null || Math.abs(a - start) <= Math.abs(b - start - dur))) { this.showSnap(a); return a; }
    if (b != null) { this.showSnap(b); return b - dur; }
    this.showSnap(null);
    return this.snap(start);
  }
  showSnap(t) {
    this.snapLine.style.display = t == null ? "none" : "block";
    if (t != null) this.snapLine.style.left = t * this.scale() + "px";
  }
  setSnap(on) {
    this.snapOn = on;
    try { localStorage.setItem(SNAP_KEY, on ? "1" : "0"); } catch { /* storage off: keep for this session */ }
  }

  // ---------- multi-selection ----------

  selectMany(keys, clips) {
    const k = keys[keys.length - 1], c = clips[clips.length - 1];
    if (k) this.store.select({ id: k.id, key: { track: k.track, i: k.i }, keys, clips });
    else if (c) this.store.select({ id: c.id, clip: { track: c.track, id: c.clipId }, keys, clips });
    else this.store.select({});
  }
  /** Shift / Ctrl click: add or remove one key ({ key }) or clip ({ clip }) */
  toggle(item) {
    const sel = this.store.sel;
    let keys = selKeys(sel), clips = selClips(sel);
    if (item.key) {
      const t = keyTag(item.key.id, item.key.track, item.key.i);
      keys = keys.some((k) => keyTag(k.id, k.track, k.i) === t) ? keys.filter((k) => keyTag(k.id, k.track, k.i) !== t) : [...keys, item.key];
    } else {
      const t = clipTag(item.clip.id, item.clip.track, item.clip.clipId);
      clips = clips.some((c) => clipTag(c.id, c.track, c.clipId) === t) ? clips.filter((c) => clipTag(c.id, c.track, c.clipId) !== t) : [...clips, item.clip];
    }
    this.selectMany(keys, clips);
  }
  /** Drag every selected key and clip together; t0 is the grabbed item's time. A click without moving runs onClick. */
  dragGroup(e, t0, onClick) {
    const s = this.store, keys = selKeys(s.sel), clips = selClips(s.sel), base = s.project;
    const targets = this.snapTargets(new Set(this.picked)), co = `tl${++seq}`;
    this.drag(e, (dx) => tops.shiftSelection(base, keys, clips, this.snapTo(t0 + dx / this.scale(), targets) - t0, co), (moved) => { if (!moved) onClick(); });
  }
  /** Rubber band over empty track space selects the keys and clips it touches (Shift / Ctrl adds to the selection) */
  bandSelect(e) {
    const add = isMod(e), x0 = e.clientX, y0 = e.clientY, band = this.band;
    this.drag(e, (dx, ev) => {
      const R = this.tracks.getBoundingClientRect();
      Object.assign(band.style, {
        display: "block",
        left: Math.min(x0, ev.clientX) - R.left + "px", top: Math.min(y0, ev.clientY) - R.top + "px",
        width: Math.abs(ev.clientX - x0) + "px", height: Math.abs(ev.clientY - y0) + "px",
      });
    }, (moved, ev) => {
      band.style.display = "none";
      if (!moved) return;
      const x1 = Math.min(x0, ev.clientX), x2 = Math.max(x0, ev.clientX), y1 = Math.min(y0, ev.clientY), y2 = Math.max(y0, ev.clientY);
      const hit = (el) => { const b = el.getBoundingClientRect(); return b.right >= x1 && b.left <= x2 && b.bottom >= y1 && b.top <= y2; };
      const sel = this.store.sel, keys = add ? [...selKeys(sel)] : [], clips = add ? [...selClips(sel)] : [];
      const have = new Set([...keys.map((k) => keyTag(k.id, k.track, k.i)), ...clips.map((c) => clipTag(c.id, c.track, c.clipId))]);
      for (const el of this.tracks.querySelectorAll(".tl-key[data-id]")) {
        const k = { id: el.dataset.id, track: el.dataset.track, i: +el.dataset.i };
        if (hit(el) && !have.has(keyTag(k.id, k.track, k.i))) keys.push(k);
      }
      for (const el of this.tracks.querySelectorAll(".tl-clip[data-id]")) {
        const c = { id: el.dataset.id, track: el.dataset.track, clipId: el.dataset.clip };
        if (hit(el) && !have.has(clipTag(c.id, c.track, c.clipId))) clips.push(c);
      }
      this.selectMany(keys, clips);
    }, { both: true });
  }

  // ---------- transport ----------

  renderBar() {
    const s = this.store, S = s.project.settings, r = s.range;
    const speed = select(SPEEDS.map((x) => [String(x), `${x}x`]), String(s.speed), (v) => s.setSpeed(+v));
    speed.title = "播放速度";
    this.bar.replaceChildren(
      h("button", { title: "回到開頭（Home）", onclick: () => s.setTime(r ? r.a : 0) }, "⏮"),
      h("button", { title: "上一格（←）", onclick: () => s.setTime(s.time - 1 / S.fps) }, "◀"),
      h("button", { class: s.playing ? "on" : null, title: "播放／暫停（空白鍵）", onclick: () => s.setPlaying(!s.playing), disabled: !!s.posing }, s.playing ? "⏸ 暫停" : "▶ 播放"),
      h("button", { title: "下一格（→）", onclick: () => s.setTime(s.time + 1 / S.fps) }, "▶"),
      h("button", { title: "跳到結尾（End）", onclick: () => s.setTime(r ? r.b : S.duration) }, "⏭"),
      (this.tc = h("span", { class: "tc" })),
      speed,
      h("label", { class: "note" }, checkbox(s.loop, (v) => s.setLoop(v)), " 循環"),
      h("button", { title: "入點設在播放頭（I）", onclick: () => tops.setInPoint() }, "入"),
      h("button", { title: "出點設在播放頭（O）", onclick: () => tops.setOutPoint() }, "出"),
      r ? h("button", { class: "on", title: "只播放、循環這一段；按一下清除入出點", onclick: () => s.setRange(null) }, `${fmt(r.a)} 到 ${fmt(r.b)} 秒 ✕`) : "",
      h("span", { class: "sep" }),
      h("label", { class: "note" }, "總長"),
      num(S.duration, (v) => tops.setDuration(v, this.rescale), { step: 0.5, min: 0.5, max: 120, width: "64px" }),
      h("label", { class: "note" }, "秒"),
      h("label", { class: "note", title: "改總長時，關鍵影格、動作、剪接、標記、字幕跟著等比縮放" }, checkbox(this.rescale, (v) => { this.rescale = v; }), " 內容跟著縮放"),
      select([["24", "24 fps"], ["25", "25 fps"], ["30", "30 fps"]], String(S.fps), (v) => ops.patchSettings({ fps: +v }, "修改影格率")),
      h("span", { class: "sep" }),
      h("label", { class: "note", title: "拖曳時吸附到剪接點、標記、播放頭、入出點、其他關鍵影格與片段邊界" }, checkbox(this.snapOn, (v) => this.setSnap(v)), " 吸附"),
      h("button", { title: "把一段時間整體放慢或加快", onclick: () => openStretch(s) }, "時間縮放"),
      h("button", { title: "表格列出每一鏡，可直接編輯", onclick: () => openShotTable(s) }, "鏡頭表"),
      h("span", { class: "grow" }),
      h("button", { title: "縮小（Ctrl＋滾輪）", onclick: () => this.zoom(0.8) }, "－"),
      h("button", { title: "放大（Ctrl＋滾輪）", onclick: () => this.zoom(1.25) }, "＋"),
      h("button", { onclick: () => { this.pps = null; this.render(); } }, "符合寬度"),
    );
    this.updateTime();
  }

  updateTime() {
    const s = this.store, S = s.project.settings;
    if (this.tc) this.tc.textContent = `${timecode(s.time, S.fps)} / ${timecode(S.duration, S.fps)}`;
    const x = s.time * this.scale();
    this.playhead.style.left = x + "px";
    if (s.playing) {
      const b = this.body, view = b.clientWidth - 170;
      if (x < b.scrollLeft || x > b.scrollLeft + view - 20) b.scrollLeft = Math.max(0, x - 40);
    }
  }

  updateRange() {
    const r = this.store.range, pps = this.scale();
    this.rangeEl.style.display = r ? "block" : "none";
    if (r) Object.assign(this.rangeEl.style, { left: r.a * pps + "px", width: (r.b - r.a) * pps + "px" });
  }

  // ---------- rows ----------

  rowsOf() {
    const P = this.store.project, sel = this.store.sel, rows = [{ kind: "cut" }, { kind: "sub" }, { kind: "audio" }];
    for (const cam of P.cameras) {
      rows.push({ kind: "path", spec: cam, list: "cameras", color: cam.color, main: true });
      if (cam.id !== sel.id) continue;
      if (cam.aim.mode === "point") rows.push({ kind: "aim", spec: cam, list: "cameras", color: cam.color });
      rows.push({ kind: "lens", spec: cam, list: "cameras", color: cam.color }, { kind: "roll", spec: cam, list: "cameras", color: cam.color });
    }
    for (const a of P.actors) {
      rows.push({ kind: "path", spec: a, list: "actors", color: LIST_COLOR.actors, main: true }, { kind: "actions", spec: a, list: "actors" });
      if (a.kind === "human") rows.push({ kind: "upper", spec: a, list: "actors" });
    }
    for (const o of P.props) rows.push({ kind: "path", spec: o, list: "props", color: LIST_COLOR.props, main: true });
    for (const l of P.lights) rows.push({ kind: "path", spec: l, list: "lights", color: LIST_COLOR.lights, main: true });
    return rows;
  }

  render() {
    this.renderBar();
    const s = this.store, P = s.project, pps = this.scale(), D = P.settings.duration;
    const width = Math.max(D * pps + 60, this.body.clientWidth - 170);
    this.picked = new Set([...selKeys(s.sel).map((k) => keyTag(k.id, k.track, k.i)), ...selClips(s.sel).map((c) => clipTag(c.id, c.track, c.clipId))]);
    this.tracks.style.width = width + "px";
    this.names.replaceChildren(h("div", { class: "tl-ruler-pad", title: "雙擊軌道：加關鍵影格、動作、字幕\n右鍵：更多選項（尺規上：加標記、入出點）\nShift／Ctrl 點選或在空白處框選：多選後一起拖曳、刪除" }, "雙擊加入　右鍵更多"));
    this.tracks.replaceChildren(this.ruler(width, pps));
    for (const r of this.rowsOf()) {
      const selRow = r.spec && r.spec.id === s.sel.id;
      this.names.append(this.nameCell(r, selRow));
      const row = h("div", { class: `tl-row${selRow && r.main ? " sel" : ""}` });
      row.append(h("div", { class: "beyond", style: { left: D * pps + "px", right: "0" } }));
      if (r.kind === "cut") this.cutRow(row, pps, D);
      else if (r.kind === "sub") this.subRow(row, pps);
      else if (r.kind === "audio") audioRow(this, row, pps);
      else {
        if (r.kind === "actions" || r.kind === "upper") this.clipRow(row, r, pps);
        else this.keyRow(row, r, pps);
        row.addEventListener("pointerdown", (e) => { if (e.button === 0 && !e.target.closest(".tl-key, .tl-clip")) this.bandSelect(e); });
      }
      this.tracks.append(row);
    }
    for (const m of P.settings.markers) this.tracks.append(h("div", { class: "tl-mline", style: { left: m.t * pps + "px" } }));
    this.tracks.append(this.rangeEl, this.band, this.snapLine, this.playhead);
    this.updateRange();
    this.updateTime();
  }

  nameCell(r, selRow) {
    const s = this.store;
    if (r.kind === "cut") return h("div", { class: "tl-name", title: "剪接軌：決定導演台與 MP4 每段用哪台攝影機" }, h("span", { class: "sw", style: { background: "#d72638" } }), "剪接");
    if (r.kind === "sub") return h("div", { class: "tl-name", title: "對白字幕軌：字幕顯示在導演台；雙擊空白處加一句" }, h("span", { class: "sw", style: { background: "#e9e4b8" } }), "對白");
    if (r.kind === "audio") return audioNameCell(s);
    const main = r.main;
    const label = main ? r.spec.name : ROW[r.kind];
    const chip = main && r.list === "cameras" && r.spec.mount ? h("span", { class: "chip" }, "跟隨") : main && r.list === "props" && r.spec.attach ? h("span", { class: "chip" }, "手持") : null;
    return h("div", {
      class: `tl-name${main ? "" : " sub"}${selRow && main ? " sel" : ""}`,
      title: main ? "點一下選取" : null,
      onclick: () => s.select({ id: r.spec.id }),
    }, main ? h("span", { class: "sw", style: { background: r.color } }) : null, label, chip);
  }

  ruler(width, pps) {
    const s = this.store, P = s.project, el = h("div", { class: "tl-ruler" });
    const step = [0.1, 0.25, 0.5, 1, 2, 5, 10, 30].find((x) => x * pps >= 60) || 60;
    const minor = step / (step >= 1 ? 4 : 5);
    for (let t = 0; t * pps < width; t += minor) {
      const major = Math.abs(t / step - Math.round(t / step)) < 1e-6;
      el.append(h("div", { class: `tl-tick${major ? "" : " minor"}`, style: { left: t * pps + "px" } }, major ? `${+t.toFixed(2)}s` : ""));
    }
    el.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || e.target.closest(".tl-marker")) return;
      s.setPlaying(false);
      const targets = this.snapTargets(new Set(["playhead"]));
      s.setTime(this.snapTo(this.tAt(e.clientX), targets));
      this.drag(e, (dx, ev) => s.setTime(this.snapTo(this.tAt(ev.clientX), targets)));
    });
    el.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      const t = this.snap(this.tAt(e.clientX));
      const at = (fn) => () => { s.setTime(t); fn(); };
      menu(e.clientX, e.clientY, [
        { label: `在 ${fmt(t)} 秒加標記（M 加在播放頭）`, onClick: () => tops.addMarker(t) },
        null,
        { label: "入點設在這裡", onClick: at(tops.setInPoint) },
        { label: "出點設在這裡", onClick: at(tops.setOutPoint) },
        s.range ? { label: "清除入出點", onClick: () => s.setRange(null) } : null,
      ]);
    });
    P.settings.markers.forEach((m, i) => el.append(this.markerFlag(m, i, pps)));
    return el;
  }

  markerFlag(m, i, pps) {
    const s = this.store;
    const el = h("div", { class: "tl-marker", style: { left: m.t * pps + "px" }, title: `${m.label}｜${fmt(m.t)} 秒\n拖曳移動，點一下跳過去，雙擊改名，右鍵更多` }, m.label);
    el.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      const targets = this.snapTargets(new Set([`marker|${i}`])), co = `tl${++seq}`;
      this.drag(e, (dx) => tops.patchMarker(i, { t: this.snapTo(m.t + dx / pps, targets) }, co), (moved) => { if (!moved) s.setTime(m.t); });
    });
    el.addEventListener("dblclick", (e) => { e.stopPropagation(); renameMarker(s, i); });
    el.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      e.stopPropagation();
      menu(e.clientX, e.clientY, [
        { label: "改名", onClick: () => renameMarker(s, i) },
        { label: "刪除標記", onClick: () => tops.deleteMarker(i) },
      ]);
    });
    return el;
  }

  cutRow(row, pps, D) {
    const s = this.store, P = s.project;
    P.cuts.forEach((cut, i) => {
      const cam = P.cameras.find((c) => c.id === cut.camera);
      const end = i < P.cuts.length - 1 ? P.cuts[i + 1].t : D;
      const el = h("div", {
        class: `tl-cut${s.sel.cut === i ? " sel" : ""}`,
        style: { left: cut.t * pps + "px", width: Math.max(2, (end - cut.t) * pps) + "px", background: cam?.color || "#888" },
        title: `${cam?.name || "（攝影機已刪除）"}：${cut.t.toFixed(2)} 到 ${end.toFixed(2)} 秒${cut.note ? `
${cut.note}` : ""}`,
        onpointerdown: (e) => { e.stopPropagation(); s.select({ cut: i }); },
        oncontextmenu: (e) => {
          e.preventDefault();
          menu(e.clientX, e.clientY, [
            ...P.cameras.map((c) => ({ label: `改用 ${c.name}`, onClick: () => ops.cutTo(c.id, cut.t) })),
            null,
            i > 0 ? { label: "刪除這個剪接點", onClick: () => { s.select({ cut: i }); ops.deleteSelection(); } } : null,
          ]);
        },
      }, cam?.name || "?", cut.note ? h("span", { class: "cut-note" }, `｜${cut.note}`) : null);
      if (i > 0) {
        const grip = h("div", { class: "grip", title: "拖曳調整剪接時間" });
        grip.addEventListener("pointerdown", (e) => {
          s.select({ cut: i });
          const t0 = cut.t, co = `tl${++seq}`, targets = this.snapTargets(new Set([`cut|${i}`]));
          this.drag(e, (dx) => ops.setCutTime(i, this.snapTo(t0 + dx / pps, targets), co));
        });
        el.append(grip);
      }
      row.append(el);
    });
    row.addEventListener("dblclick", (e) => {
      const t = this.snap(this.tAt(e.clientX));
      if (!P.cameras.length) return;
      menu(e.clientX, e.clientY, P.cameras.map((c) => ({ label: `在 ${t.toFixed(2)} 秒切到 ${c.name}`, onClick: () => ops.cutTo(c.id, t) })));
    });
  }

  subRow(row, pps) {
    const s = this.store, P = s.project;
    for (const x of P.subtitles) {
      const who = x.actor && P.actors.find((a) => a.id === x.actor);
      const text = who ? `${who.name}：${x.text}` : x.text;
      const grip = h("div", { class: "grip", title: "拖曳調整長度" });
      const el = h("div", {
        class: "tl-clip subt",
        style: { left: x.t * pps + "px", width: Math.max(6, x.dur * pps) + "px" },
        title: `${text}\n${fmt(x.t)} 秒起，${fmt(x.dur)} 秒（雙擊編輯）`,
      }, text, grip);
      el.addEventListener("pointerdown", (e) => {
        if (e.button !== 0) return;
        const targets = this.snapTargets(new Set([`sub|${x.id}`])), co = `tl${++seq}`;
        if (e.target === grip) this.drag(e, (dx) => tops.patchSubtitle(x.id, { dur: this.snapTo(x.t + x.dur + dx / pps, targets) - x.t }, co));
        else this.drag(e, (dx) => tops.patchSubtitle(x.id, { t: this.snapSpan(x.t + dx / pps, x.dur, targets) }, co), (moved) => { if (!moved) s.setTime(x.t); });
      });
      el.addEventListener("dblclick", (e) => { e.stopPropagation(); editSubtitle(s, x); });
      el.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        e.stopPropagation();
        menu(e.clientX, e.clientY, [
          { label: "編輯這句", onClick: () => editSubtitle(s, x) },
          { label: "刪除這句", onClick: () => tops.deleteSubtitle(x.id) },
        ]);
      });
      row.append(el);
    }
    row.addEventListener("dblclick", (e) => editSubtitle(s, null, this.snap(this.tAt(e.clientX))));
  }

  keyRow(row, r, pps) {
    const s = this.store, spec = r.spec, track = r.kind;
    const holder = track === "path" ? spec.path : track === "aim" ? spec.aim : null;
    const keys = holder ? holder.keys : Array.isArray(spec[track]) ? spec[track] : null;
    if (holder && keys.length > 1 && !(r.list === "cameras" && spec.mount)) {
      const speeds = segmentSpeeds(buildPath(keys, holder.curve));
      for (let i = 0; i < keys.length - 1; i++) {
        const x0 = keys[i].t * pps, x1 = keys[i + 1].t * pps, v = speeds[i];
        const still = !(v > 0.005);
        row.append(h("div", { class: "tl-seg", style: { left: x0 + "px", width: Math.max(0, x1 - x0) + "px", background: still ? "#3a3f4b" : null } },
          x1 - x0 > 46 ? h("span", {}, still ? "停留" : `${v.toFixed(2)} m/s`) : null));
      }
    }
    if (!keys) {
      row.append(h("div", { class: "note", style: { position: "absolute", left: "6px", top: "3px", margin: 0 } }, `固定 ${spec[track]}${track === "lens" ? " mm" : "°"}，雙擊加關鍵影格`));
    } else {
      keys.forEach((k, i) => {
        const tag = keyTag(spec.id, track, i);
        const el = h("div", {
          class: `tl-key${this.picked.has(tag) ? " sel" : ""}${r.list === "cameras" ? " cam" : ""}`,
          style: { left: k.t * pps + "px" },
          title: `${k.t.toFixed(2)} 秒｜${easeLabel(k.e)}`,
          "data-id": spec.id, "data-track": track, "data-i": i,
        });
        el.addEventListener("pointerdown", (e) => {
          if (e.button !== 0) return;
          const one = () => s.select({ id: spec.id, key: { track, i } });
          if (isMod(e)) { e.preventDefault(); e.stopPropagation(); return this.toggle({ key: { id: spec.id, track, i } }); }
          if (this.picked.size > 1 && this.picked.has(tag)) return this.dragGroup(e, k.t, () => { one(); s.setTime(k.t); });
          if (!(this.picked.size === 1 && this.picked.has(tag))) one();
          const t0 = k.t, co = `tl${++seq}`, targets = this.snapTargets(new Set([tag]));
          this.drag(e, (dx) => ops.setKeyTime(spec.id, track, i, this.snapTo(t0 + dx / pps, targets), co), (moved) => { if (!moved) s.setTime(k.t); });
        });
        el.addEventListener("contextmenu", (e) => {
          e.preventDefault();
          e.stopPropagation();
          const many = this.picked.size > 1 && this.picked.has(tag);
          if (!many) s.select({ id: spec.id, key: { track, i } });
          menu(e.clientX, e.clientY, [
            ...Object.entries(EASINGS).map(([ek, x]) => ({ label: `${ek === k.e ? "● " : ""}到下一點：${x.label}`, onClick: () => ops.patchKey(spec.id, track, i, { e: ek }) })),
            { label: `${isCurve(k.e) ? "● " : ""}到下一點：自訂曲線（在右側屬性面板拖曳編輯）`, onClick: () => s.select({ id: spec.id, key: { track, i } }) },
            null,
            { label: many ? `刪除選取的 ${this.picked.size} 個項目` : "刪除關鍵影格", onClick: () => ops.deleteSelection() },
          ]);
        });
        row.append(el);
      });
    }
    row.addEventListener("dblclick", (e) => {
      if (r.list === "props" && spec.attach && track === "path") return;
      s.setTime(this.snap(this.tAt(e.clientX)));
      ops.addKeyAtPlayhead(spec.id, track);
    });
  }

  clipRow(row, r, pps) {
    const s = this.store, spec = r.spec, track = r.kind;
    const lib = actionsFor(spec);
    for (const c of spec[track]) {
      const act = lib[c.type];
      const tag = clipTag(spec.id, track, c.id);
      const label = c.type === "pose" ? "姿勢" : act?.label || `？${c.type}`;
      const el = h("div", {
        class: `tl-clip${track === "upper" ? " upper" : ""}${c.type === "pose" ? " pose" : ""}${this.picked.has(tag) ? " sel" : ""}`,
        style: { left: c.start * pps + "px", width: Math.max(6, c.dur * pps) + "px" },
        title: `${label}｜${c.start.toFixed(2)} 秒起，${c.dur.toFixed(2)} 秒${c.hold ? "，結束後維持" : ""}`,
        "data-id": spec.id, "data-track": track, "data-clip": c.id,
      }, h("div", { class: "fade", style: { width: Math.min(c.dur, c.blend ?? 0.3) * pps + "px" } }), label);
      const grip = h("div", { class: "grip", title: "拖曳調整長度" });
      el.append(grip);
      el.addEventListener("pointerdown", (e) => {
        if (e.button !== 0) return;
        const one = () => s.select({ id: spec.id, clip: { track, id: c.id } });
        if (isMod(e)) { e.preventDefault(); e.stopPropagation(); return this.toggle({ clip: { id: spec.id, track, clipId: c.id } }); }
        if (e.target !== grip && this.picked.size > 1 && this.picked.has(tag)) return this.dragGroup(e, c.start, one);
        if (!(this.picked.size === 1 && this.picked.has(tag))) one();
        const co = `tl${++seq}`, targets = this.snapTargets(new Set([tag]));
        if (e.target === grip) this.drag(e, (dx) => ops.patchClip(spec.id, track, c.id, { dur: Math.max(0.1, this.snapTo(c.start + c.dur + dx / pps, targets) - c.start) }, co));
        else this.drag(e, (dx) => ops.patchClip(spec.id, track, c.id, { start: Math.max(0, this.snapSpan(c.start + dx / pps, c.dur, targets)) }, co));
      });
      el.addEventListener("dblclick", (e) => {
        e.stopPropagation();
        if (c.type === "pose") this.onEditPose(spec.id, c.id);
      });
      el.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const many = this.picked.size > 1 && this.picked.has(tag);
        if (!many) s.select({ id: spec.id, clip: { track, id: c.id } });
        menu(e.clientX, e.clientY, [
          c.type === "pose" ? { label: "編輯這個姿勢", onClick: () => this.onEditPose(spec.id, c.id) } : null,
          { label: c.hold ? "結束後回到原本動作" : "結束後維持最後姿勢", onClick: () => ops.patchClip(spec.id, track, c.id, { hold: !c.hold }) },
          null,
          { label: many ? `刪除選取的 ${this.picked.size} 個項目` : "刪除動作片段", onClick: () => ops.deleteSelection() },
        ]);
      });
      row.append(el);
    }
    row.addEventListener("dblclick", (e) => {
      const t = this.snap(this.tAt(e.clientX));
      const items = Object.entries(lib)
        .filter(([, a]) => track === "actions" || a.mask === "upper")
        .map(([key, a]) => ({ label: a.label, onClick: () => ops.addClip(spec.id, track, key, t) }));
      if (!items.length) return;
      menu(e.clientX, e.clientY, items);
    });
  }
}
