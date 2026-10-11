// Camera properties for the inspector: lens, shake, depth of field, aim, mount, path, move presets and auto framing.
import { h, fmt, round, num, select, checkbox, row, vec3Row } from "./ui.js";
import * as ops from "./ops.js";
import { frameShot, FRAME_SIZES } from "./ops-camera.js";
import { SHAKE_STYLES } from "../runtime/schema.js";
import { CAMERA_MOVES, LENS_PRESETS, liveCameraId } from "../runtime/camera.js";
import { focusDistance } from "../runtime/dof.js";

const note = (t, cls = "note") => h("div", { class: cls }, t);
const btns = (...b) => h("div", { class: "btns" }, b);
const color = (value, onCommit) => h("input", { type: "color", value, onchange: (e) => onCommit(e.target.value) });

function dofRows(c, st) {
  const set = (dof) => ops.patchEntity(c.id, { dof }, "改景深");
  if (!c.dof) return [row("景深", checkbox(false, (v) => v && set({ fstop: 2.8, focus: null }), "背景與前景依光圈模糊"))];
  const auto = c.dof.focus == null, dist = st ? focusDistance(st) : null;
  return [
    row("景深", checkbox(true, (v) => !v && set(null), "背景與前景依光圈模糊")),
    row("光圈 f/", num(c.dof.fstop, (v) => set({ ...c.dof, fstop: v }), { step: 0.1, min: 1, max: 22, digits: 1 })),
    row("對焦", select([["auto", "自動（對準點的距離）"], ["manual", "固定距離"]], auto ? "auto" : "manual",
      (v) => set({ ...c.dof, focus: v === "auto" ? null : round(dist || 3, 2) }))),
    auto ? note(`目前對焦距離 ${dist ? fmt(dist) : "?"} 公尺`)
      : row("對焦距離（公尺）", num(c.dof.focus, (v) => set({ ...c.dof, focus: v }), { step: 0.1, min: 0.1, max: 500, digits: 2 })),
    note("景深只在導演台主畫面與 MP4 輸出出現；縮圖、3D 視窗與省效能模式不算景深。光圈數字越小越模糊"),
  ];
}

function framingRows(insp, c) {
  const P = insp.store.project;
  if (!P.actors.length) return [note("場景裡還沒有角色")];
  const aimed = c.aim.mode === "actor" && c.aim.actor;
  insp.frameIds = (insp.frameIds || []).filter((id) => P.actors.some((a) => a.id === id));
  if (!insp.frameIds.length || insp.frameCam !== c.id) insp.frameIds = [aimed || P.actors[0].id];
  insp.frameCam = c.id;
  insp.frameSize = FRAME_SIZES[insp.frameSize] ? insp.frameSize : "中景";
  return [
    h("div", { class: "inline wrap" }, P.actors.map((a) => h("label", {},
      checkbox(insp.frameIds.includes(a.id), (v) => {
        insp.frameIds = v ? [...insp.frameIds, a.id] : insp.frameIds.filter((x) => x !== a.id);
      }), ` ${a.name}`))),
    row("景別", select(Object.keys(FRAME_SIZES).map((k) => [k, k]), insp.frameSize, (v) => { insp.frameSize = v; })),
    btns(h("button", { class: "primary", onclick: () => frameShot(c.id, insp.frameIds, insp.frameSize, insp.store.time) }, "在目前時間套用")),
    note("保持攝影機現在的方向和焦距，前後移動並調整高度（平視），在目前時間加路徑關鍵影格。勾一個角色時對準跟著他；勾多個時對準他們的中間，並拉遠到全部入鏡"),
  ];
}

/** Inspector section for camera c. insp is the Inspector (for its shared rows and the move-preset fields). */
export function cameraPanel(insp, c) {
  const s = insp.store, P = s.project, t = s.time, aspect = P.settings.width / P.settings.height;
  const st = insp.rt.cameraState(c.id, t, aspect);
  const live = liveCameraId(P, t) === c.id;
  const moves = Object.entries(CAMERA_MOVES).map(([k, m]) => [k, m.label]);
  insp.moveKey = insp.moveKey && CAMERA_MOVES[insp.moveKey] ? insp.moveKey : "dollyIn";
  insp.moveStart = Math.min(insp.moveStart ?? 0, P.settings.duration);
  insp.moveDur = insp.moveDur ?? P.settings.duration;
  const keyed = (track, label, def, opts) => Array.isArray(c[track])
    ? [row(label, h("span", {}, `${fmt(st ? st[track] ?? def : def, 1)}（有關鍵影格）`)), note(`${label}有關鍵影格：在時間軸點菱形編輯，或選取後按 Delete 刪除`)]
    : [row(label, num(c[track], (v) => ops.patchEntity(c.id, { [track]: v }, `改${label}`), opts))];
  return [
    ...insp.head(c, `攝影機${live ? "（播出中）" : ""}`),
    row("顏色", color(c.color, (v) => ops.patchEntity(c.id, { color: v }, "改顏色"))),
    btns(
      h("button", { class: "primary", onclick: () => ops.cutTo(c.id, t) }, "從目前時間切到這台"),
      h("button", { class: s.preview === c.id ? "on" : null, onclick: () => s.setPreview(s.preview === c.id ? null : c.id) }, "在導演台預覽"),
    ),
    h("h4", {}, "鏡頭"),
    ...keyed("lens", "焦距（mm）", 35, { step: 1, min: 8, max: 300, digits: 1 }),
    Array.isArray(c.lens) ? null : btns(...LENS_PRESETS.map((mm) => h("button", { class: c.lens === mm ? "on" : null, onclick: () => ops.patchEntity(c.id, { lens: mm }, "改焦距") }, `${mm}`))),
    ...keyed("roll", "滾轉（度）", 0, { step: 1, min: -90, max: 90, digits: 1 }),
    row("晃動強度", num(c.shake, (v) => ops.patchEntity(c.id, { shake: v }, "改晃動"), { step: 0.1, min: 0, max: 3, digits: 2 })),
    row("晃動樣式", select(Object.entries(SHAKE_STYLES), c.shakeStyle, (v) => ops.patchEntity(c.id, { shakeStyle: v }, "改晃動樣式"))),
    c.shake > 0 && c.shakeStyle === "impact" ? note("衝擊震動是整段持續的短促抖動，不是單次撞擊；要只震一下，可把這台攝影機只剪進那一瞬間") : null,
    btns(
      h("button", { onclick: () => ops.addKeyAtPlayhead(c.id, "lens") }, "加焦距關鍵影格"),
      h("button", { onclick: () => ops.addKeyAtPlayhead(c.id, "roll") }, "加滾轉關鍵影格"),
    ),
    ...dofRows(c, st),
    h("h4", {}, "對準"),
    row("方式", select([["point", "對準點（可做關鍵影格）"], ["actor", "對準角色"]], c.aim.mode, (v) => {
      const target = st ? st.target.toArray().map((x) => round(x, 3)) : [0, 1, 0];
      ops.patchEntity(c.id, { aim: v === "actor" ? { mode: "actor", actor: P.actors[0]?.id || null, offset: null } : { mode: "point", curve: "smooth", keys: [{ t: 0, v: target, e: "linear" }] } }, "改對準方式");
    })),
    ...(c.aim.mode === "actor" ? [
      row("對象", select(insp.actorOptions(), c.aim.actor || "", (v) => ops.patchEntity(c.id, { aim: { ...c.aim, actor: v } }, "改對準對象"))),
      vec3Row("偏移（公尺）", c.aim.offset || [0, 0, 0], (v) => ops.patchEntity(c.id, { aim: { ...c.aim, offset: v.every((x) => x === 0) ? null : v } }, "改對準偏移"), 0.05),
      note("偏移 0 時對準角色胸口到頭部之間"),
    ] : [insp.keyList(c, "aim"), btns(h("button", { onclick: () => ops.addKeyAtPlayhead(c.id, "aim") }, "在目前時間加對準點"))]),
    h("h4", {}, "自動構圖"),
    ...framingRows(insp, c),
    h("h4", {}, "跟隨"),
    row("跟隨對象", select(insp.actorOptions("不跟隨（用路徑）"), c.mount?.actor || "", (v) => ops.patchEntity(c.id, { mount: v ? { actor: v, offset: c.mount?.offset || [0, 1.6, -3], rotate: c.mount?.rotate ?? true } : null }, "改跟隨"))),
    ...(c.mount ? [
      vec3Row("相對位置", c.mount.offset, (v) => ops.patchEntity(c.id, { mount: { ...c.mount, offset: v } }, "改跟隨位置")),
      row("跟著轉向", checkbox(c.mount.rotate, (v) => ops.patchEntity(c.id, { mount: { ...c.mount, rotate: v } }, "跟著轉向"))),
      note("相對位置以角色為原點：Z 負值在背後，X 正值在角色左側"),
    ] : [h("h4", {}, "機位與路徑"), ...insp.position(c), ...insp.path(c)]),
    h("h4", {}, "套用運鏡預設"),
    row("運鏡", select(moves, insp.moveKey, (v) => { insp.moveKey = v; insp.render(); })),
    row("開始／長度", h("div", { class: "inline" },
      num(insp.moveStart, (v) => { insp.moveStart = v; }, { step: 0.5, min: 0, digits: 2 }),
      num(insp.moveDur, (v) => { insp.moveDur = v; }, { step: 0.5, min: 0.2, digits: 2 }))),
    btns(
      h("button", { onclick: () => { insp.moveStart = round(t, 2); insp.moveDur = round(Math.max(0.2, P.settings.duration - t), 2); insp.render(); } }, "從目前時間到結尾"),
      h("button", { class: "primary", onclick: () => ops.applyMove(c.id, insp.moveKey, { start: insp.moveStart, dur: insp.moveDur }) }, "套用"),
    ),
    note(CAMERA_MOVES[insp.moveKey].needsActor ? "這個運鏡會跟隨角色（優先用目前對準的角色）" : "會取代這台攝影機現有的路徑與對準設定，可用 Ctrl+Z 復原"),
    ...insp.tail(c),
  ];
}
