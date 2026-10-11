// Timeline "音訊" row: one block per audio clip with its waveform; drag to move, double-click to edit,
// double-click empty space to import a sound file there.
import * as tops from "./ops-time.js";
import { importAudio, peaks, readyBuffer, clipLength, storeFile } from "./audio.js";
import { h, menu, modal, row, num, checkbox, toast, fmt } from "./ui.js";

let seq = 0;

export function audioNameCell(store) {
  return h("div", { class: "tl-name", title: "音訊軌：音樂、對白錄音或音效，播放時同步；雙擊空白處或按 ＋ 匯入" },
    h("span", { class: "sw", style: { background: "#7bd389" } }), "音訊",
    h("button", { class: "tl-add", title: "在播放頭位置匯入音訊檔", onclick: (e) => { e.stopPropagation(); importAudio(store, store.time); } }, "＋"));
}

function drawWave(cv, c, pps) {
  const pk = peaks(c.file);
  const w = cv.width, hgt = cv.height, g = cv.getContext("2d");
  g.clearRect(0, 0, w, hgt);
  if (!pk) return;
  g.fillStyle = "rgba(20, 40, 24, 0.55)";
  const mid = hgt / 2;
  for (let x = 0; x < w; x++) {
    const a = Math.floor((c.offset + x / pps) * 100), b = Math.max(a + 1, Math.floor((c.offset + (x + 1) / pps) * 100));
    let m = 0;
    for (let i = a; i < b && i < pk.length; i++) if (pk[i] > m) m = pk[i];
    const y = Math.max(0.5, m * mid * c.gain);
    g.fillRect(x, mid - y, 1, y * 2);
  }
}

/** Re-pick the sound file for a clip whose file is missing (or to swap it) */
function relink(store, c) {
  const input = Object.assign(document.createElement("input"), { type: "file", accept: "audio/*" });
  input.addEventListener("change", async () => {
    const f = input.files[0];
    if (!f) return;
    try {
      const buf = await storeFile(f);
      tops.patchAudio(c.id, { file: f.name, dur: Math.round(buf.duration * 1000) / 1000 });
      toast(`已連結「${f.name}」`);
    } catch (err) {
      console.error(`BlockingPRO: 音訊「${f.name}」無法解碼`, err);
      toast(`無法解碼「${f.name}」：${err.message || err}`, "err", 7000);
    }
  });
  input.click();
}

export function editAudio(store, c) {
  const D = store.project.settings.duration;
  const v = { name: c.name, start: c.start, offset: c.offset, gain: c.gain, muted: !!c.muted };
  const missing = !readyBuffer(c.file);
  const nameInp = h("input", { type: "text", maxlength: 80, value: v.name, oninput: (e) => { v.name = e.target.value; } });
  modal("編輯音訊", h("div", {},
    row("名稱", nameInp),
    row("開始（秒）", num(v.start, (x) => { v.start = x; }, { step: 0.1, min: 0, max: D })),
    row("裁掉開頭（秒）", num(v.offset, (x) => { v.offset = x; }, { step: 0.1, min: 0, max: Math.max(0, c.dur - 0.1) })),
    row("音量（倍）", num(v.gain, (x) => { v.gain = x; }, { step: 0.1, min: 0, max: 4, digits: 2 })),
    row("", h("label", { class: "note" }, checkbox(v.muted, (x) => { v.muted = x; }), " 靜音（播放與輸出都不出聲）")),
    h("p", { class: missing ? "warn" : "note" }, missing
      ? `檔案「${c.file}」不在這台電腦的瀏覽器裡，按「重新連結檔案」選取同一個音訊檔。`
      : `檔案「${c.file}」，長 ${fmt(c.dur)} 秒。音訊存在這個瀏覽器裡，專案檔只記位置；換電腦要連同音訊檔一起帶走。`),
  ), [
    { label: "取消" },
    { label: "刪除", danger: true, onClick: (close) => { tops.deleteAudio(c.id); close(); } },
    { label: "重新連結檔案", onClick: (close) => { close(); relink(store, c); } },
    { label: "確定", primary: true, onClick: (close) => { tops.patchAudio(c.id, { ...v, name: v.name.trim() || c.name }); close(); } },
  ]);
  setTimeout(() => nameInp.focus());
}

/** Fill the audio row. tl: the Timeline (snapping and drag helpers). */
export function audioRow(tl, rowEl, pps) {
  const s = tl.store, P = s.project;
  for (const c of P.audio) {
    const buf = readyBuffer(c.file), len = clipLength(c, buf);
    const width = Math.max(6, len * pps);
    const cv = h("canvas", { class: "wave", width: Math.min(4000, Math.ceil(width)), height: 17 });
    const el = h("div", {
      class: `tl-clip aud${c.muted ? " muted" : ""}${buf ? "" : " missing"}`,
      style: { left: c.start * pps + "px", width: width + "px" },
      title: `${c.name}｜${fmt(c.start)} 秒起，${fmt(len)} 秒${c.muted ? "，靜音" : ""}${buf ? "" : "\n檔案不在這台電腦，雙擊重新連結"}\n拖曳移動，雙擊編輯`,
    }, cv, h("span", { class: "aud-name" }, `${buf ? "" : "⚠ "}${c.muted ? "🔇 " : ""}${c.name}`));
    if (buf) drawWave(cv, c, pps);
    el.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      const targets = tl.snapTargets(new Set([`au|${c.id}`])), co = `au${++seq}`;
      tl.drag(e, (dx) => tops.patchAudio(c.id, { start: Math.max(0, tl.snapSpan(c.start + dx / pps, len, targets)) }, co), (moved) => { if (!moved) s.setTime(c.start); });
    });
    el.addEventListener("dblclick", (e) => { e.stopPropagation(); editAudio(s, c); });
    el.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      e.stopPropagation();
      menu(e.clientX, e.clientY, [
        { label: "編輯", onClick: () => editAudio(s, c) },
        { label: c.muted ? "取消靜音" : "靜音", onClick: () => tops.patchAudio(c.id, { muted: !c.muted }) },
        { label: "開頭對齊播放頭", onClick: () => tops.patchAudio(c.id, { start: s.time }) },
        { label: "重新連結檔案", onClick: () => relink(s, c) },
        null,
        { label: "刪除", onClick: () => tops.deleteAudio(c.id) },
      ]);
    });
    rowEl.append(el);
  }
  rowEl.addEventListener("dblclick", (e) => importAudio(s, tl.snap(tl.tAt(e.clientX))));
}
