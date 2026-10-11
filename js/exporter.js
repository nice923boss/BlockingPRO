// Output dialogs: MP4 of the program (or one camera), contact sheet PNG and top-down overview PNG.
import { h, row, num, select, checkbox, modal, toast, downloadBlob, safeName, fmt, fileSize } from "./ui.js";
import { targetOf, targetWarnings } from "../runtime/schema.js";
import { exportMp4, contactSheet, overviewMap, QUALITIES } from "../runtime/export.js";
import { drawSubtitle, drawLetterbox, drawInfo, infoText } from "../runtime/overlay.js";
import { shotRanges, splitRanges } from "../runtime/shotlist.js";
import { zipBlob } from "../runtime/zip.js";
import { shareHtml } from "../runtime/share.js";
import { mixdown } from "./audio.js";

const canvasBlob = (cv) => new Promise((ok, bad) => cv.toBlob((b) => (b ? ok(b) : bad(new Error("圖片轉檔失敗"))), "image/png"));
const blobBase64 = (blob) => new Promise((ok, bad) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(",")[1]); r.onerror = () => bad(r.error); r.readAsDataURL(blob); });
const localStamp = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

function cameraOptions(P) {
  return [["", "節目（依剪接）"], ...P.cameras.map((c) => [c.id, `只用 ${c.name}`])];
}

export function blocked(store) {
  if (!store.posing) return false;
  toast("擺姿勢中，請先按「套用」或「取消」再輸出", "warn");
  return true;
}

// 2D layers over each frame, bottom to top: letterbox bars, subtitles, shot info. None picked: no overlay pass.
function overlayOf(P, rt, o) {
  const S = P.settings, layers = [];
  if (o.matte && S.letterbox) layers.push((g, t, cam, w, hh) => drawLetterbox(g, S.letterbox, w, hh));
  if (o.subs && P.subtitles.length) layers.push((g, t, cam, w, hh) => drawSubtitle(g, P, t, w, hh));
  if (o.info) layers.push((g, t, cam, w, hh) => drawInfo(g, infoText(P, t, cam, rt.cameraState(cam, t, w / hh)?.lens, !!o.camera), w, hh, o.matte ? S.letterbox : null));
  return layers.length ? (...a) => layers.forEach((f) => f(...a)) : null;
}

// picture variants (o05 joints, o06 depth); file suffixes only when more than one is picked
const VARIANTS = [
  { key: "white", label: "一般畫面", suffix: "_白模" },
  { key: "joints", label: "關節版（骨架線，給姿勢控制）", suffix: "_關節" },
  { key: "depth", label: "深度圖（灰階，近白遠黑，給 ControlNet）", suffix: "_深度" },
];
const DISPLAY_OF = { joints: "joints", depth: "white" };
const pad2 = (n) => String(n).padStart(2, "0");

/** Files of one export: time parts (single / each shot o04 / split at the target limit o03) × picked variants */
function jobsOf(P, o) {
  const S = P.settings, name = safeName(P.name);
  const camName = (id) => safeName(P.cameras.find((c) => c.id === id)?.name || id);
  let parts;
  if (o.mode === "shots") parts = shotRanges(P).map((s) => ({ start: s.start, end: s.end, camera: s.camera, tag: `_鏡${pad2(s.index)}_${camName(s.camera)}` }));
  else if (o.mode === "split") parts = splitRanges(S.duration, P.cuts.map((c) => c.t), targetOf(S).maxDuration)
    .map((r, i) => ({ ...r, camera: o.camera || null, tag: `_第${i + 1}段_${fmt(r.start)}-${fmt(r.end)}秒` }));
  else {
    const start = o.range === "all" ? 0 : o.start, end = o.range === "all" ? S.duration : o.end;
    parts = [{ start, end, camera: o.camera || null, tag: o.camera ? `_${camName(o.camera)}` : "" }];
  }
  const vs = VARIANTS.filter((v) => o[v.key]);
  return parts.flatMap((p) => vs.map((v) => ({ ...p, variant: v.key, name: `${name}${p.tag}${vs.length > 1 ? v.suffix : ""}` })));
}

/** MP4 dialog; ctl.busy(on) pauses the editor's own rendering while encoding */
export function openMp4Dialog(store, rt, ctl) {
  if (blocked(store)) return;
  store.setPlaying(false);
  const P = store.project, S = P.settings, T = targetOf(S);
  const long = T.video !== false && S.duration > T.maxDuration;
  const o = { mode: long ? "split" : "single", range: "all", start: 0, end: S.duration, camera: store.preview || "",
    white: true, joints: false, depth: false, format: "auto", quality: "high",
    audio: P.audio.some((c) => !c.muted), subs: false, matte: !!S.letterbox, info: false, share: false };
  const info = h("div", { class: "note" });
  const dyn = h("div");
  const bar = h("div");
  const status = h("div", { class: "note" });
  let ctrl = null, close = null;

  const refresh = () => {
    const jobs = jobsOf(P, o), parts = jobs.filter((j, i) => i === jobs.findIndex((k) => k.start === j.start && k.end === j.end));
    const total = parts.reduce((s, j) => s + Math.max(0, j.end - j.start), 0);
    const warn = new Set();
    for (const j of parts) targetWarnings(T, { ...S, duration: Math.round((j.end - j.start) * 100) / 100 }).forEach((w) => warn.add(w));
    if (T.oneTake && o.mode !== "single") warn.add(`${T.label} 只吃一鏡到底，請選「一個檔案」和單一攝影機`);
    if (T.oneTake && !o.camera && P.cuts.length > 1) warn.add(`${T.label} 不會帶過剪接，請在「鏡頭」選單一攝影機`);
    if (o.format === "webm" && !T.webm) warn.add(`${T.label} 只收 MP4 或 MOV，WebM 要先轉檔`);
    if (!jobs.length) warn.add("至少勾一種畫面");
    if (o.share && jobs.length > 1) warn.add("分享用 HTML 只放一支影片：請選「一個檔案」並只勾一種畫面");
    const notes = [`${S.width} × ${S.height}，${S.fps} fps，${jobs.length} 個檔案，總長 ${fmt(total)} 秒，約 ${Math.round(total * S.fps) * VARIANTS.filter((v) => o[v.key]).length} 格`, ...warn];
    info.replaceChildren(...notes.map((t, i) => h("div", { class: i ? "warn" : "note" }, t)));
    const nParts = splitRanges(S.duration, P.cuts.map((c) => c.t), T.maxDuration).length;
    dyn.replaceChildren(
      row("輸出方式", select([["single", "一個檔案"], ["shots", `每鏡各一個（${shotRanges(P).length} 個）`],
        ["split", `依 ${T.label} 上限 ${T.maxDuration} 秒分段（${nParts} 段，盡量切在剪接點）`]], o.mode, (v) => { o.mode = v; refresh(); })),
      o.mode === "shots" ? "" : row("鏡頭", select(cameraOptions(P), o.camera, (v) => { o.camera = v; refresh(); })),
      o.mode !== "single" ? "" : row("範圍", select([["all", "整段"], ["custom", "自訂起訖"]], o.range, (v) => { o.range = v; refresh(); })),
      o.mode !== "single" || o.range === "all" ? "" : h("div", { class: "row" }, h("label", {}, "起訖（秒）"), h("div", { class: "inline" },
        num(o.start, (v) => { o.start = Math.min(v, S.duration); refresh(); }, { step: 0.1, min: 0, max: S.duration }),
        num(o.end, (v) => { o.end = Math.min(v, S.duration); refresh(); }, { step: 0.1, min: 0, max: S.duration }))));
  };

  async function run(closeFn) {
    if (ctrl) return;
    const jobs = jobsOf(P, o);
    if (!jobs.length) { toast("至少勾一種畫面", "warn"); return; }
    if (o.share && jobs.length > 1) { toast("分享用 HTML 只放一支影片：請選「一個檔案」並只勾一種畫面", "warn"); return; }
    if (jobs.some((j) => j.end - j.start < 1 / S.fps)) { toast("輸出範圍太短", "warn"); return; }
    ctrl = new AbortController();
    const fill = h("div");
    bar.replaceChildren(h("div", { class: "progress" }, fill));
    status.textContent = "準備編碼器…";
    ctl.busy(true);
    const t0 = performance.now(), files = [], savedDisplay = rt.displayOverride;
    let last = null, noAudio = false;
    try {
      for (const [k, job] of jobs.entries()) {
        const head = jobs.length > 1 ? `第 ${k + 1}／${jobs.length} 個檔案，` : "";
        rt.displayOverride = DISPLAY_OF[job.variant] || savedDisplay;
        rt.sync(store.project);
        let audio = null;
        if (o.audio && job.variant !== "depth") {
          status.textContent = `${head}混音中…`;
          audio = await mixdown(P, job.start, job.end);
          if (!audio) noAudio = true;
        }
        last = await exportMp4(rt, {
          width: S.width, height: S.height, fps: S.fps, start: job.start, end: job.end, camera: job.camera, signal: ctrl.signal, audio,
          overlay: job.variant === "depth" ? null : overlayOf(P, rt, { ...o, camera: job.camera }),
          format: o.format, quality: o.quality, depth: job.variant === "depth",
          onProgress: (f) => {
            const all = (k + f) / jobs.length;
            fill.style.width = `${(all * 100).toFixed(1)}%`;
            status.textContent = `${head}輸出中 ${Math.round(f * 100)}%`;
          },
        });
        files.push({ name: `${job.name}.${last.container}`, blob: last.blob });
      }
      let out;
      if (o.share) {
        status.textContent = "打包分享用 HTML…";
        const html = shareHtml(P, { base64: await blobBase64(last.blob), mime: `video/${last.container}`, start: jobs[0].start, end: jobs[0].end,
          camera: jobs[0].camera, showSubs: !o.subs, exportedAt: localStamp(new Date()) });
        out = { blob: new Blob([html], { type: "text/html" }), name: `${jobs[0].name}_分享.html` };
      } else out = files.length > 1 ? { blob: await zipBlob(files), name: `${safeName(P.name)}_影片.zip` } : files[0];
      downloadBlob(out.blob, out.name);
      const secs = ((performance.now() - t0) / 1000).toFixed(1);
      const what = o.share ? "分享用 HTML 已下載" : files.length > 1 ? `${files.length} 個影片已打包下載` : `${last.container.toUpperCase()} 已下載`;
      toast(`${what}（${fileSize(out.blob.size)}${last.audioCodec ? `，含 ${last.audioCodec.toUpperCase()} 音訊` : ""}，${secs} 秒完成）`);
      if (noAudio) toast("輸出範圍內沒有可用的音訊（全部靜音或檔案不在這台電腦），影片沒有聲音", "warn", 7000);
      if (o.format === "auto" && last.container === "webm") toast(`這台電腦不能編 H.264，改輸出 WebM（${last.codec.toUpperCase()}）；多數 AI 影片平台只收 MP4，要先轉檔`, "warn", 9000);
      else if (last.container === "mp4" && last.codec !== "avc") toast(`這台電腦不能編 H.264，改用 ${last.codec.toUpperCase()}；部分播放器或平台可能不支援`, "warn", 8000);
      closeFn();
    } catch (err) {
      if (err.name === "AbortError") { toast("已取消輸出"); closeFn(); }
      else {
        console.error("BlockingPRO: 影片輸出失敗", err);
        status.textContent = "";
        bar.replaceChildren(h("div", { class: "err" }, `輸出失敗：${err.message}`));
      }
    } finally {
      rt.displayOverride = savedDisplay;
      rt.sync(store.project);
      ctrl = null;
      ctl.busy(false);
    }
  }

  const body = h("div", {},
    dyn, info,
    row("畫面", h("div", {}, VARIANTS.map((v) => h("label", { class: "note", style: "display:block" }, checkbox(o[v.key], (x) => { o[v.key] = x; refresh(); }), ` ${v.label}`)))),
    row("格式", select([["auto", "自動（能編 H.264 就用 MP4）"], ["mp4", "MP4"], ["webm", "WebM（VP9，備援）"]], o.format, (v) => { o.format = v; refresh(); })),
    row("畫質", select(Object.entries(QUALITIES), o.quality, (v) => { o.quality = v; })),
    P.audio.length ? row("", h("label", { class: "note" }, checkbox(o.audio, (v) => { o.audio = v; }), " 包含音訊軌（未靜音的片段混成一軌，深度圖不含）")) : "",
    P.subtitles.length ? row("", h("label", { class: "note" }, checkbox(o.subs, (v) => { o.subs = v; }), " 燒入對白字幕（給 AI 影片模型當參考時建議不勾）")) : "",
    S.letterbox ? row("", h("label", { class: "note" }, checkbox(o.matte, (v) => { o.matte = v; }), ` 保留 ${S.letterbox}：1 遮幅黑邊（不勾就輸出完整畫面）`)) : "",
    row("", h("label", { class: "note" }, checkbox(o.info, (v) => { o.info = v; }), " 燒入資訊疊字（鏡號、機位、焦距、秒數，左上角）")),
    row("", h("label", { class: "note" }, checkbox(o.share, (v) => { o.share = v; refresh(); }), " 輸出成分享用 HTML（影片放進網頁，附鏡頭表和字幕；對方用瀏覽器打開就能播，不用安裝）")),
    h("div", { class: "note" }, "逐格離線渲染，不會掉格；畫面和導演台一致，不含路徑線與標籤。多個檔案會打包成一個 ZIP。"),
    bar, status);
  refresh();
  close = modal("下載影片", body, [
    { label: "取消", onClick: (c) => { if (ctrl) ctrl.abort(); else c(); } },
    { label: "開始輸出", primary: true, onClick: (c) => run(c) },
  ]);
  return close;
}

export function openSheetDialog(store, rt) {
  if (blocked(store)) return;
  store.setPlaying(false);
  const P = store.project;
  const o = { count: 8, camera: "", mode: P.cuts.length > 1 ? "shots" : "even" };
  const body = h("div", {},
    row("鏡頭", select(cameraOptions(P), o.camera, (v) => { o.camera = v; })),
    row("取格方式", select([["shots", `每個鏡頭一格（${P.cuts.length} 格，含鏡頭說明）`], ["even", "平均取格"]], o.mode, (v) => { o.mode = v; })),
    row("張數（平均取格）", select([["6", "6 張"], ["8", "8 張"], ["12", "12 張"], ["16", "16 張"]], String(o.count), (v) => { o.count = +v; })),
    h("div", { class: "note" }, "每格標出秒數和機位；依剪接取格時會附上鏡頭說明。適合貼給 Seedance 或分鏡討論。"));
  modal("分鏡表 PNG", body, [
    { label: "取消" },
    { label: "下載", primary: true, onClick: async (c) => {
      const d = P.settings.duration;
      const mid = (cut, i) => Math.round(((cut.t + (P.cuts[i + 1]?.t ?? d)) / 2) * 100) / 100;
      const times = o.mode === "shots"
        ? P.cuts.slice(0, 24).map(mid)
        : Array.from({ length: o.count }, (_, i) => Math.round(((d * (i + 0.5)) / o.count) * 100) / 100);
      try {
        const cv = contactSheet(rt, { times, width: 480, cols: Math.min(4, times.length), camera: o.camera || null });
        downloadBlob(await canvasBlob(cv), `${safeName(P.name)}_分鏡表.png`);
        c();
      } catch (err) {
        console.error("BlockingPRO: 分鏡表輸出失敗", err);
        toast(`分鏡表輸出失敗：${err.message}`, "err");
      }
    } },
  ]);
}

export async function downloadOverview(store, rt) {
  if (blocked(store)) return;
  try {
    const cv = overviewMap(rt, store.time, 1000);
    downloadBlob(await canvasBlob(cv), `${safeName(store.project.name)}_平面圖_${fmt(store.time)}s.png`);
  } catch (err) {
    console.error("BlockingPRO: 平面圖輸出失敗", err);
    toast(`平面圖輸出失敗：${err.message}`, "err");
  } finally {
    rt.evaluate(store.time);
  }
}
