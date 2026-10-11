// Extra outputs behind the "更多輸出" menu: first/last frames (o01), prompts (o02), GIF preview (o08),
// storyboard PDF (o09) and shot list CSV (o10).
import { h, row, select, modal, toast, menu, downloadBlob, safeName, fmt, fileSize } from "./ui.js";
import { copyText } from "./asset-dialogs.js";
import { blocked } from "./exporter.js";
import { createProgramRenderer, renderProgramFrame } from "../runtime/export.js";
import { shotSizeAt, actorsInView } from "../runtime/shotcheck.js";
import { shotRanges, describeMove, csvText, buildPrompts } from "../runtime/shotlist.js";
import { HUMAN_BODIES } from "../runtime/rig-human.js";
import { ANIMAL_TYPES } from "../runtime/rig-animal.js";
import { LIGHTING } from "../runtime/lights.js";
import { zipBlob } from "../runtime/zip.js";
import { pdfParts, PDF_PAGE } from "../runtime/pdf.js";

// gifenc 1.0.3, kept in vendor/ (relative to this module)
const GIFENC_URL = "../vendor/gifenc/gifenc.esm.js";
const FONT = '"Microsoft JhengHei", "PingFang TC", "Noto Sans TC", system-ui, sans-serif';
const toBlob = (cv, type = "image/png", q = undefined) =>
  new Promise((ok, bad) => cv.toBlob((b) => (b ? ok(b) : bad(new Error("圖片轉檔失敗"))), type, q));
const plain = (st) => ({ position: st.position.toArray(), target: st.target.toArray(), lens: st.lens, shake: st.shake || 0 });
const lastFrame = (s, fps) => Math.max(s.start, s.end - 1 / fps);
const shotTag = (s, cam) => `鏡${String(s.index).padStart(2, "0")}_${safeName(cam.name)}`;

/** Shot rows with prompts, shared by the CSV, PDF and prompt dialog: { rows, overall } */
export function shotTable(rt) {
  const P = rt.project, S = P.settings, aspect = S.width / S.height, saved = rt.time, rows = [];
  const stateAt = (id, t) => { rt.evaluate(t); return rt.cameraState(id, t, aspect); };
  try {
    for (const s of shotRanges(P)) {
      const cam = P.cameras.find((c) => c.id === s.camera);
      if (!cam) continue;
      const a = plain(stateAt(cam.id, s.start)), b = plain(stateAt(cam.id, lastFrame(s, S.fps)));
      const mid = (s.start + s.end) / 2, st = stateAt(cam.id, mid);
      rows.push({ ...s, camName: cam.name, lens: st.lens, size: shotSizeAt(rt, cam.id, mid).size,
        move: describeMove(a, b, !!cam.mount?.actor), actors: actorsInView(rt, cam.id, mid).map((x) => x.name) });
    }
  } finally {
    rt.evaluate(saved);
  }
  const cast = P.actors.map((a) => ({ name: a.name, kind: (a.kind === "animal" ? ANIMAL_TYPES : HUMAN_BODIES)[a.preset]?.label || "角色", color: a.color }));
  const scene = { lighting: (LIGHTING[S.lighting] || LIGHTING.day).label, props: P.props.map((p) => p.name), duration: S.duration, width: S.width, height: S.height };
  const prompts = buildPrompts({ cast, scene, rows });
  rows.forEach((r, i) => { r.prompt = prompts.shots[i]; });
  return { rows, overall: prompts.overall };
}

// ---------- o01 first and last frame of every shot ----------
async function framesZip(rt) {
  const P = rt.project, S = P.settings, pr = createProgramRenderer(S.width, S.height), saved = rt.time, files = [];
  try {
    for (const s of shotRanges(P)) {
      const cam = P.cameras.find((c) => c.id === s.camera);
      if (!cam) continue;
      for (const [t, tag] of [[s.start, "首格"], [lastFrame(s, S.fps), "尾格"]]) {
        renderProgramFrame(rt, pr, t, cam.id);
        files.push({ name: `${shotTag(s, cam)}_${tag}_${fmt(t)}s.png`, blob: await toBlob(pr.canvas) });
      }
    }
  } finally {
    pr.dispose();
    rt.evaluate(saved);
  }
  if (!files.length) throw new Error("專案沒有攝影機");
  return { blob: await zipBlob(files), name: `${safeName(P.name)}_首尾格.zip`, note: `${files.length} 張` };
}

// ---------- o02 prompts ----------
function openPromptDialog(rt) {
  const { rows, overall } = shotTable(rt);
  const area = (text, rowsN) => Object.assign(h("textarea", { class: "code", rows: rowsN }), { value: text });
  const all = area(overall, 5);
  const shots = rows.map((r) => ({ r, box: area(r.prompt, 2) }));
  const label = (r) => `鏡 ${r.index}　${fmt(r.start)} 到 ${fmt(r.end)} 秒　${r.camName}`;
  const text = () => [`整段：${all.value}`, ...shots.map(({ r, box }) => `${label(r)}：${box.value}`)].join("\n\n");
  const colors = rt.project.actors.map((a) => (a.color || "#e8e8e8").toLowerCase());
  const body = h("div", {},
    h("div", { class: "note" }, "依角色、燈光、景別、運鏡和剪接說明產生。外觀、服裝、場景材質請自己補上，改完再複製。"),
    new Set(colors).size < colors.length ? h("div", { class: "warn" }, "有角色顏色相同，AI 分不出參考影片裡誰是誰；建議在角色屬性給每人不同顏色。") : "",
    h("div", { class: "row" }, h("label", {}, "整段"), h("button", { onclick: () => copyText(all.value, "整段提示詞") }, "複製")), all,
    shots.map(({ r, box }) => [h("div", { class: "row" }, h("label", {}, label(r)), h("button", { onclick: () => copyText(box.value, `鏡 ${r.index} 提示詞`) }, "複製")), box]));
  modal("AI 影片提示詞", body, [
    { label: "關閉" },
    { label: "全部複製", primary: true, onClick: () => copyText(text(), "全部提示詞") },
  ], { wide: true, sticky: true });
}

// ---------- o08 GIF preview ----------
async function exportGif(rt, { width, fps, camera, onProgress }) {
  const { GIFEncoder, quantize, applyPalette } = await import(GIFENC_URL);
  const S = rt.project.settings;
  const w = Math.round(width / 2) * 2, hh = Math.round((w * S.height) / S.width / 2) * 2;
  const pr = createProgramRenderer(w, hh), cv = Object.assign(document.createElement("canvas"), { width: w, height: hh });
  const g = cv.getContext("2d", { willReadFrequently: true }), gif = GIFEncoder(), saved = rt.time;
  const frames = Math.max(1, Math.round(S.duration * fps)), delay = Math.round(1000 / fps);
  try {
    for (let i = 0; i < frames; i++) {
      renderProgramFrame(rt, pr, i / fps, camera);
      g.drawImage(pr.canvas, 0, 0);
      const { data } = g.getImageData(0, 0, w, hh);
      const palette = quantize(data, 256);
      gif.writeFrame(applyPalette(data, palette), w, hh, { palette, delay });
      onProgress?.((i + 1) / frames);
      if (i % 4 === 3) await new Promise((r) => setTimeout(r));
    }
    gif.finish();
  } finally {
    pr.dispose();
    rt.evaluate(saved);
  }
  return new Blob([gif.bytes()], { type: "image/gif" });
}

function openGifDialog(store, rt, ctl) {
  const P = store.project, o = { width: 480, fps: 10, camera: store.preview || "" };
  const status = h("div", { class: "note" });
  let running = false;
  const body = h("div", {},
    row("鏡頭", select([["", "節目（依剪接）"], ...P.cameras.map((c) => [c.id, `只用 ${c.name}`])], o.camera, (v) => { o.camera = v; })),
    row("寬度", select([["320", "320 px"], ["480", "480 px"], ["640", "640 px"]], String(o.width), (v) => { o.width = +v; })),
    row("每秒格數", select([["5", "5 fps（檔案最小）"], ["10", "10 fps"], ["15", "15 fps（檔案較大）"]], String(o.fps), (v) => { o.fps = +v; })),
    h("div", { class: "note" }, `整段 ${fmt(P.settings.duration)} 秒，循環播放，適合貼在聊天或簡報裡快速預覽。每格 256 色，顏色會有色帶。`),
    status);
  modal("GIF 預覽", body, [
    { label: "取消", onClick: (c) => { if (!running) c(); } },
    { label: "輸出", primary: true, onClick: async (c) => {
      if (running) return;
      running = true;
      ctl.busy(true);
      try {
        status.textContent = "載入 GIF 編碼器…";
        const blob = await exportGif(rt, { ...o, camera: o.camera || null, onProgress: (f) => { status.textContent = `輸出中 ${Math.round(f * 100)}%`; } });
        downloadBlob(blob, `${safeName(P.name)}_預覽.gif`);
        toast(`GIF 已下載（${fileSize(blob.size)}）`);
        c();
      } catch (err) {
        console.error("BlockingPRO: GIF 輸出失敗", err);
        status.textContent = `輸出失敗：${err.message}（GIF 編碼器在 vendor/gifenc 資料夾，請確認檔案還在）`;
      } finally {
        running = false;
        ctl.busy(false);
      }
    } },
  ]);
}

// ---------- o09 storyboard PDF ----------
function wrap(g, text, maxW) {
  const lines = [];
  for (const para of String(text).split("\n")) {
    let line = "";
    for (const ch of para) {
      if (line && g.measureText(line + ch).width > maxW) { lines.push(line); line = ch; } else line += ch;
    }
    lines.push(line);
  }
  return lines;
}

async function storyboardPdf(rt) {
  const P = rt.project, S = P.settings, { rows, overall } = shotTable(rt);
  const W = PDF_PAGE[0] * 2, H = PDF_PAGE[1] * 2, M = 64;
  const tw = S.width >= S.height ? 560 : Math.round((315 * S.width) / S.height), th = Math.round((tw * S.height) / S.width);
  const pr = createProgramRenderer(tw, th), saved = rt.time, thumbs = [];
  try {
    for (const r of rows) { renderProgramFrame(rt, pr, (r.start + r.end) / 2, r.camera); thumbs.push(await createImageBitmap(pr.canvas)); }
  } finally {
    pr.dispose();
    rt.evaluate(saved);
  }
  const pages = [];
  let g, y;
  const newPage = () => {
    const cv = Object.assign(document.createElement("canvas"), { width: W, height: H });
    g = cv.getContext("2d");
    g.fillStyle = "#fff";
    g.fillRect(0, 0, W, H);
    g.fillStyle = "#888";
    g.font = `20px ${FONT}`;
    g.fillText(`${P.name}　分鏡表　第 ${pages.length + 1} 頁`, M, M - 20);
    pages.push(cv);
    y = M + 12;
  };
  // measured block: [{ text, size, bold, color }] wrapped to maxW
  const block = (items, maxW) => items.flatMap(({ text, size, bold, color = "#222" }) => {
    g.font = `${bold ? "bold " : ""}${size}px ${FONT}`;
    return wrap(g, text, maxW).map((line) => ({ line, size, bold, color, lh: Math.round(size * 1.45) }));
  });
  const draw = (lines, x, top) => {
    let yy = top;
    for (const l of lines) { g.font = `${l.bold ? "bold " : ""}${l.size}px ${FONT}`; g.fillStyle = l.color; yy += l.lh; g.fillText(l.line, x, yy - l.lh * 0.28); }
    return yy - top;
  };
  newPage();
  const label = (LIGHTING[S.lighting] || LIGHTING.day).label;
  y += draw(block([
    { text: P.name, size: 44, bold: true },
    { text: `${S.width} × ${S.height}，${S.fps} fps，${fmt(S.duration)} 秒，${rows.length} 鏡，燈光：${label}`, size: 24, color: "#555" },
    { text: `整段提示詞：${overall}`, size: 22, color: "#333" },
  ], W - 2 * M), M, y) + 24;
  const tx = M + tw + 32, textW = W - M - tx;
  rows.forEach((r, i) => {
    let lines = block([
      { text: `鏡 ${r.index}　${fmt(r.start)} 到 ${fmt(r.end)} 秒（${fmt(r.end - r.start)} 秒）`, size: 28, bold: true },
      { text: `${r.camName}　${Math.round(r.lens)}mm　${r.size}／${r.move}`, size: 22, color: "#444" },
      { text: `畫面中：${r.actors.join("、") || "沒有角色"}`, size: 22, color: "#444" },
      { text: `畫面內容：${r.note || "（未填）"}`, size: 22 },
      { text: `提示詞：${r.prompt}`, size: 20, color: "#666" },
    ], textW);
    let hgt = Math.max(th, lines.reduce((s, l) => s + l.lh, 0));
    if (y + hgt > H - M) {
      newPage();
      lines = block(lines.map((l) => ({ text: l.line, size: l.size, bold: l.bold, color: l.color })), textW);
      hgt = Math.max(th, lines.reduce((s, l) => s + l.lh, 0));
    }
    g.strokeStyle = "#ddd";
    g.beginPath(); g.moveTo(M, y - 12); g.lineTo(W - M, y - 12); g.stroke();
    g.drawImage(thumbs[i], M, y);
    g.strokeStyle = "#999";
    g.strokeRect(M + 0.5, y + 0.5, tw - 1, th - 1);
    draw(lines, tx, y - 6);
    y += hgt + 28;
  });
  const imgs = await Promise.all(pages.map(async (cv) => ({ jpeg: new Uint8Array(await (await toBlob(cv, "image/jpeg", 0.88)).arrayBuffer()), width: W, height: H })));
  return { blob: new Blob(pdfParts(imgs, `${P.name} 分鏡表`), { type: "application/pdf" }), name: `${safeName(P.name)}_分鏡表.pdf`, note: `${pages.length} 頁` };
}

// ---------- o10 shot list CSV ----------
function shotCsv(rt) {
  const { rows } = shotTable(rt);
  return { blob: new Blob([csvText(rows)], { type: "text/csv;charset=utf-8" }), name: `${safeName(rt.project.name)}_鏡頭表.csv`, note: `${rows.length} 鏡` };
}

async function download(ctl, what, make) {
  ctl.busy(true);
  try {
    const { blob, name, note } = await make();
    downloadBlob(blob, name);
    toast(`${what}已下載（${note}，${fileSize(blob.size)}）`);
  } catch (err) {
    console.error(`BlockingPRO: ${what}輸出失敗`, err);
    toast(`${what}輸出失敗：${err.message}`, "err", 6000);
  } finally {
    ctl.busy(false);
  }
}

/** "更多輸出 ▾" menu under the topbar button */
export function openMoreMenu(btn, store, rt, ctl) {
  const r = btn.getBoundingClientRect();
  const go = (fn) => () => { if (blocked(store)) return; store.setPlaying(false); fn(); };
  menu(r.left, r.bottom + 4, [
    { label: "首尾格 PNG（每鏡兩張，ZIP）", onClick: go(() => download(ctl, "首尾格", () => framesZip(rt))) },
    { label: "AI 影片提示詞（整段＋每鏡）", onClick: go(() => openPromptDialog(rt)) },
    { label: "GIF 預覽（低解析度）", onClick: go(() => openGifDialog(store, rt, ctl)) },
    { label: "分鏡表 PDF（截圖＋鏡頭表＋提示詞）", onClick: go(() => download(ctl, "分鏡表 PDF ", () => storyboardPdf(rt))) },
    { label: "鏡頭表 CSV（Excel 可開）", onClick: go(() => download(ctl, "鏡頭表 CSV ", async () => shotCsv(rt))) },
  ]);
}
