// Single-file HTML for sharing a preview (s10): the exported video inside the page, the shot list and the subtitles.
// Pure string building: no three.js or DOM, so node tests can import this file.
import { shotRanges } from "./shotlist.js";

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ESC[c]);
const sec = (x) => (Math.round(x * 10) / 10).toFixed(1);

/** Shots and subtitles inside [start, end], shifted so the video starts at 0. A single-camera export has one row. */
export function shareRows(P, { start, end, camera = null }) {
  const name = (id) => P.cameras.find((c) => c.id === id)?.name || id;
  const shots = camera
    ? [{ index: 1, start: 0, end: end - start, camera: name(camera), note: "" }]
    : shotRanges(P).filter((s) => s.end > start + 1e-6 && s.start < end - 1e-6).map((s) => ({
      index: s.index, start: Math.max(s.start, start) - start, end: Math.min(s.end, end) - start, camera: name(s.camera), note: s.note,
    }));
  const subs = (P.subtitles || []).filter((s) => s.t < end && s.t + s.dur > start).map((s) => ({
    t: s.t - start, dur: s.dur, text: s.text, who: P.actors.find((a) => a.id === s.actor)?.name || "",
  }));
  return { shots, subs };
}

/**
 * The whole page as a string. base64 / mime: the encoded video. showSubs: false when the subtitles are burned in.
 * The video is turned into a blob URL on open, so seeking works in any browser without a server.
 */
export function shareHtml(P, { base64, mime, start, end, camera = null, showSubs = true, exportedAt = "" }) {
  const S = P.settings, { shots, subs } = shareRows(P, { start, end, camera });
  const rows = shots.map((s) => `<tr data-t="${s.start}" data-e="${s.end}"><td>${s.index}</td><td>${sec(s.start)} 到 ${sec(s.end)} 秒</td>`
    + `<td>${esc(s.camera)}</td><td>${esc(s.note)}</td></tr>`).join("\n");
  // JSON inside <script>: "<" escaped so a subtitle cannot close the tag
  const subJson = JSON.stringify(showSubs ? subs : []).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(P.name)} 預演</title>
<style>
:root { color-scheme: light dark; --bg: #f6f5f2; --fg: #222; --mute: #666; --line: #ddd; --hi: #fde8c8; }
@media (prefers-color-scheme: dark) { :root { --bg: #1b1b1d; --fg: #eee; --mute: #9a9a9a; --line: #353535; --hi: #4a3a1c; } }
body { margin: 0; background: var(--bg); color: var(--fg); font: 15px/1.6 system-ui, "Microsoft JhengHei", "PingFang TC", sans-serif; }
main { max-width: 960px; margin: 0 auto; padding: 16px; }
h1 { font-size: 22px; margin: 4px 0; }
.meta { color: var(--mute); font-size: 13px; margin: 4px 0 12px; }
video { width: 100%; display: block; background: #000; border-radius: 6px; }
#sub { min-height: 1.6em; margin: 8px 0 12px; text-align: center; font-size: 17px; }
table { width: 100%; border-collapse: collapse; }
th, td { padding: 6px 8px; border-bottom: 1px solid var(--line); text-align: left; vertical-align: top; }
th { color: var(--mute); font-weight: normal; font-size: 13px; }
tbody tr { cursor: pointer; }
tbody tr.on { background: var(--hi); }
td:nth-child(1), td:nth-child(2) { white-space: nowrap; }
</style>
</head>
<body>
<main>
<h1>${esc(P.name)}</h1>
<p class="meta">${S.width} × ${S.height}，${S.fps} fps，${sec(end - start)} 秒${exportedAt ? `，${esc(exportedAt)} 由 BlockingPRO 輸出` : ""}。白模預演只代表走位與鏡頭，人物外觀、服裝、場景材質以最終影片為準。</p>
<video id="v" controls playsinline></video>
<div id="sub"></div>
<table>
<thead><tr><th>鏡號</th><th>時間</th><th>攝影機</th><th>畫面內容</th></tr></thead>
<tbody>
${rows}
</tbody>
</table>
<p class="meta">點表格的一列跳到那一鏡。</p>
</main>
<script id="video-data" type="application/octet-stream">${base64}</script>
<script>
const v = document.getElementById("v"), sub = document.getElementById("sub");
const subs = ${subJson};
const raw = atob(document.getElementById("video-data").textContent.trim());
const bytes = new Uint8Array(raw.length);
for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
v.src = URL.createObjectURL(new Blob([bytes], { type: ${JSON.stringify(mime)} }));
const rows = [...document.querySelectorAll("tbody tr")];
rows.forEach((r) => r.addEventListener("click", () => { v.currentTime = +r.dataset.t + 0.01; v.play(); }));
const update = () => {
  const t = v.currentTime;
  rows.forEach((r) => r.classList.toggle("on", t >= +r.dataset.t && t < +r.dataset.e));
  const s = subs.find((x) => t >= x.t && t < x.t + x.dur);
  sub.textContent = s ? (s.who ? s.who + "：" : "") + s.text : "";
};
v.addEventListener("timeupdate", update);
v.addEventListener("seeked", update);
update();
</script>
</body>
</html>
`;
}
