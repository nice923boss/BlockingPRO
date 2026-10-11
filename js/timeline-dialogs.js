// Timeline dialogs: marker name, subtitle line, time stretch, shot table.
import * as ops from "./ops.js";
import * as tops from "./ops-time.js";
import { labelShots, checkAxis } from "./ops-camera.js";
import { h, modal, row, num, select, checkbox, toast, fmt } from "./ui.js";

const MAX_DURATION = 120;

export function renameMarker(store, i) {
  const m = store.project.settings.markers[i];
  if (!m) return;
  const inp = h("input", { type: "text", maxlength: 40, value: m.label });
  const ok = (c) => {
    const v = inp.value.trim();
    if (v && v !== m.label) tops.patchMarker(i, { label: v });
    c();
  };
  inp.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); ok(close); } });
  const close = modal("標記名稱", h("div", {},
    row("名稱", inp),
    h("p", { class: "note" }, `位置 ${fmt(m.t)} 秒。可以寫段落名稱，例如開場、衝突、和解。`),
  ), [
    { label: "取消" },
    { label: "刪除", danger: true, onClick: (c) => { tops.deleteMarker(i); c(); } },
    { label: "確定", primary: true, onClick: ok },
  ]);
  setTimeout(() => { inp.focus(); inp.select(); });
}

/** Edit subtitle x, or add a new one at time t when x is null */
export function editSubtitle(store, x, t = 0) {
  const P = store.project, D = P.settings.duration;
  let actor = x?.actor || "", start = x?.t ?? t, dur = x?.dur ?? Math.max(0.2, Math.min(2, D - start));
  const ta = h("textarea", { rows: 3, maxlength: 200, placeholder: "台詞（最多 200 字，可換行）", value: x?.text || "" });
  const commit = (c) => {
    const text = ta.value.trim();
    if (!text) return toast("台詞是空的", "warn");
    if (x) tops.patchSubtitle(x.id, { text, actor: actor || null, t: start, dur });
    else tops.addSubtitle(start, text, actor || null, dur);
    c();
  };
  ta.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.ctrlKey) { e.preventDefault(); commit(close); } });
  const humans = P.actors.filter((a) => a.kind === "human");
  const close = modal(x ? "編輯字幕" : "加一句字幕", h("div", {},
    row("台詞", ta),
    row("角色", select([["", "（旁白／不指定）"], ...humans.map((a) => [a.id, a.name])], actor, (v) => { actor = v; })),
    row("開始（秒）", num(start, (v) => { start = v; }, { step: 0.1, min: 0, max: D })),
    row("長度（秒）", num(dur, (v) => { dur = v; }, { step: 0.1, min: 0.2, max: MAX_DURATION })),
    h("p", { class: "note" }, "字幕顯示在導演台下方。Ctrl＋Enter 確定。"),
  ), [
    { label: "取消" },
    x ? { label: "刪除", danger: true, onClick: (c) => { tops.deleteSubtitle(x.id); c(); } } : null,
    { label: "確定", primary: true, onClick: commit },
  ].filter(Boolean), { sticky: true });
  setTimeout(() => ta.focus());
}

/** Slow down or speed up a span of time (defaults to the in / out points) */
export function openStretch(store) {
  const D = store.project.settings.duration, r = store.range;
  let a = r ? r.a : 0, b = r ? r.b : D, f = 1.2, extend = true;
  const desc = h("p", { class: "note" });
  const update = () => {
    const m = tops.stretchMap(a, b, f), nd = extend ? m(D) : D;
    const how = f > 1 ? "變慢" : f < 1 ? "變快" : "不變";
    desc.textContent = `${fmt(a)} 到 ${fmt(b)} 秒（${fmt(b - a)} 秒）變成 ${fmt(m(a))} 到 ${fmt(m(b))} 秒（${fmt((b - a) * f)} 秒），${how}。總長 ${fmt(D)} 秒變成 ${fmt(nd)} 秒。`
      + (!extend && f > 1 ? "總長不變時，被推到結尾之後的內容看不到。" : "");
  };
  const fNum = num(f, (v) => { f = v; update(); }, { step: 0.05, min: 0.25, max: 4, digits: 2 });
  const presets = [0.5, 0.8, 0.9, 1.1, 1.2, 1.5, 2].map((x) => h("button", { onclick: () => { f = x; fNum.value = x; update(); } }, `${x} 倍`));
  update();
  modal("時間縮放", h("div", {},
    h("p", { class: "note" }, "倍數大於 1 變慢（拉長），小於 1 變快。範圍內的關鍵影格、動作片段、剪接點、手持時間、標記、字幕一起縮放，後面的內容跟著前移或順延。音訊片段不會變速，只移動開始位置。"),
    row("開始（秒）", num(a, (v) => { a = v; update(); }, { step: 0.1, min: 0, max: D })),
    row("結束（秒）", num(b, (v) => { b = v; update(); }, { step: 0.1, min: 0, max: D })),
    row("倍數", fNum),
    h("div", { class: "presets" }, presets),
    row("", h("label", { class: "note" }, checkbox(extend, (v) => { extend = v; update(); }), " 總長跟著變")),
    desc,
  ), [
    { label: "取消" },
    {
      label: "套用", primary: true, onClick: (c) => {
        const m = tops.stretchMap(a, b, f);
        if (!(b - a >= 0.05)) return toast("結束要比開始晚", "warn");
        if (f === 1) return toast("倍數是 1，內容不會改變", "warn");
        if (extend && m(D) > MAX_DURATION) return toast(`縮放後總長超過 ${MAX_DURATION} 秒`, "warn");
        tops.stretchTime(a, b, f, { extend });
        if (r) store.setRange({ a: m(r.a), b: m(r.b) });
        toast("已縮放，可用 Ctrl＋Z 復原");
        c();
      },
    },
  ]);
}

/** Index of the cut playing at time t */
const cutAt = (cuts, t) => { let k = 0; cuts.forEach((c, i) => { if (c.t <= t + 1e-6) k = i; }); return k; };

function addShot(store) {
  const P = store.project, t = store.time;
  const cur = P.cuts[cutAt(P.cuts, t)];
  const i = P.cameras.findIndex((c) => c.id === cur?.camera);
  const cam = P.cameras.length > 1 ? P.cameras[(i + 1) % P.cameras.length] : P.cameras[0];
  if (!cam || (cur && cam.id === cur.camera)) return toast("需要第二台攝影機才能加一鏡", "warn");
  ops.cutTo(cam.id, t);
}

/** Every shot as a table row; start, length, camera and note are edited in place */
export function openShotTable(store) {
  const box = h("div", { class: "shot-wrap" });
  const build = () => {
    const P = store.project, D = P.settings.duration, fps = P.settings.fps, n = P.cuts.length;
    const cur = cutAt(P.cuts, store.time);
    const step = { step: +(1 / fps).toFixed(4), min: 0, max: D, digits: 2, width: "64px" };
    const rows = P.cuts.map((c, i) => {
      const end = i < n - 1 ? P.cuts[i + 1].t : D;
      const cam = P.cameras.find((x) => x.id === c.camera);
      const cams = [...P.cameras.map((x) => [x.id, x.name]), ...(cam ? [] : [[c.camera, "（攝影機已刪除）"]])];
      return h("tr", { class: i === cur ? "cur" : null },
        h("td", {}, String(i + 1)),
        h("td", {}, i === 0 ? "0" : num(c.t, (v) => ops.setCutTime(i, v), step)),
        h("td", {}, fmt(end)),
        h("td", {}, i < n - 1 ? num(end - c.t, (v) => ops.setCutTime(i + 1, c.t + v), { ...step, min: 0.05 }) : fmt(end - c.t)),
        h("td", {}, select(cams, c.camera, (v) => tops.patchCut(i, { camera: v }))),
        h("td", {}, cam ? `${Math.round(ops.trackValueAt(cam, "lens", c.t))} mm` : ""),
        h("td", { class: "wide" }, h("input", { type: "text", maxlength: 300, value: c.note || "", placeholder: "畫面內容", onchange: (e) => tops.patchCut(i, { note: e.target.value.trim() }) })),
        h("td", {},
          h("button", { onclick: () => { store.setTime(c.t); store.select({ cut: i }); } }, "跳到"),
          i > 0 ? h("button", { class: "danger", onclick: () => { store.select({ cut: i }); ops.deleteSelection(); } }, "刪除") : null),
      );
    });
    box.replaceChildren(
      h("table", { class: "shot-table" },
        h("thead", {}, h("tr", {}, ["鏡號", "開始", "結束", "長度", "攝影機", "焦距", "說明", ""].map((x) => h("th", {}, x)))),
        h("tbody", {}, rows)),
      h("p", { class: "note" }, `共 ${n} 鏡，總長 ${fmt(D)} 秒。秒數可拖曳或輸入；說明按 Enter 或離開欄位後儲存。同一台攝影機連續兩鏡會合併。「標示景別」依每鏡中間那一格判斷，寫在說明開頭（例如【中景】），再按一次會更新。`),
    );
  };
  build();
  const unsub = store.subscribe((what) => {
    if (what !== "project" && what !== "sel") return;
    const el = document.activeElement;
    if (box.contains(el) && el.matches("input[type=text]")) return; // keep the note being typed
    build();
  });
  modal("鏡頭表", box, [
    { label: "關閉" },
    { label: "標示景別", onClick: () => labelShots() },
    { label: "越軸檢查", onClick: () => showAxis() },
    { label: "在播放頭加一鏡", onClick: () => addShot(store) },
  ], { wide: true, onClose: unsub });
}

function showAxis() {
  const list = checkAxis();
  if (!list.length) { toast("沒有發現越軸：相鄰兩鏡都看得到的角色，左右順序一致"); return; }
  modal(`越軸檢查：${list.length} 處`, h("div", {},
    h("ul", {}, list.map((x) => h("li", {}, x.text))),
    h("p", { class: "note" }, "比較剪接點前後兩台攝影機在同一瞬間看到的角色左右順序。對調不一定是錯，刻意越軸或中間有過場鏡頭時可以忽略；移動方向是否一致沒有檢查。")));
}
