// 2D overlays drawn over exported frames (the WebGL picture is copied to a 2D canvas first).
// Sizes follow the monitor's DOM overlays so the export matches what the editor shows.

export const subtitleAt = (project, t) => {
  const x = project.subtitles.find((y) => t >= y.t && t < y.t + y.dur);
  if (!x) return "";
  const who = x.actor && project.actors.find((a) => a.id === x.actor);
  return who ? `${who.name}：${x.text}` : x.text;
};

/** Split text into lines no wider than maxW (character by character, so Chinese wraps too) */
function wrap(g, text, maxW) {
  const out = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (const ch of para) {
      if (line && g.measureText(line + ch).width > maxW) { out.push(line); line = ""; }
      line += ch;
    }
    out.push(line);
  }
  return out;
}

/** The dialogue line at time t, bottom centre on a translucent box */
export function drawSubtitle(g, project, t, w, h) {
  const text = subtitleAt(project, t);
  if (!text) return;
  const size = Math.max(12, Math.round(h * 0.045)), lh = size * 1.35, pad = size * 0.45;
  g.save();
  g.font = `${size}px "Microsoft JhengHei", "PingFang TC", "Noto Sans TC", sans-serif`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  const lines = wrap(g, text, w * 0.9 - pad * 2);
  const boxW = Math.min(w * 0.9, Math.max(...lines.map((l) => g.measureText(l).width)) + pad * 2), boxH = lines.length * lh + pad;
  const bottom = h - h * 0.06, top = bottom - boxH;
  g.fillStyle = "rgba(0, 0, 0, 0.66)";
  g.beginPath();
  g.roundRect(w / 2 - boxW / 2, top, boxW, boxH, size * 0.25);
  g.fill();
  g.fillStyle = "#fff";
  lines.forEach((l, i) => g.fillText(l, w / 2, top + pad / 2 + lh * (i + 0.5)));
  g.restore();
}

/** Active picture inside a w x h frame matted to ratio ("2.39", "1.85"): { x, y, w, h }. No ratio: the whole frame. */
export function letterboxRect(w, h, ratio) {
  const r = Number(ratio);
  if (!r) return { x: 0, y: 0, w, h };
  if (w / h < r) { const ih = w / r; return { x: 0, y: (h - ih) / 2, w, h: ih }; }
  const iw = h * r;
  return { x: (w - iw) / 2, y: 0, w: iw, h };
}

/** Black bars outside the matte (top and bottom, or left and right for a frame wider than the ratio) */
export function drawLetterbox(g, ratio, w, h) {
  const a = letterboxRect(w, h, ratio);
  if (a.w >= w && a.h >= h) return;
  g.save();
  g.fillStyle = "#000";
  if (a.h < h) { g.fillRect(0, 0, w, Math.ceil(a.y)); g.fillRect(0, Math.floor(a.y + a.h), w, h - Math.floor(a.y + a.h)); }
  else { g.fillRect(0, 0, Math.ceil(a.x), h); g.fillRect(Math.floor(a.x + a.w), 0, w - Math.floor(a.x + a.w), h); }
  g.restore();
}

/** The shot (cut) in effect at t: { n: 1-based number, start, end }, or null when the project has no cuts */
export function shotInfo(project, t) {
  const cuts = project.cuts;
  let i = -1;
  for (let k = 0; k < cuts.length; k++) if (cuts[k].t <= t + 1e-9) i = k;
  if (i < 0) return null;
  return { n: i + 1, start: cuts[i].t, end: i + 1 < cuts.length ? cuts[i + 1].t : project.settings.duration };
}

/** One line of shot information: shot number, camera, focal length, seconds into the shot / shot length */
export function infoText(project, t, camId, lens, fixedCamera = false) {
  const cam = project.cameras.find((c) => c.id === camId);
  const parts = [];
  const shot = fixedCamera ? null : shotInfo(project, t);
  if (shot) parts.push(`鏡 ${shot.n}`);
  parts.push(cam ? cam.name : "預設視角");
  if (lens) parts.push(`${Math.round(lens)}mm`);
  if (shot) parts.push(`${(t - shot.start).toFixed(1)}／${(shot.end - shot.start).toFixed(1)} 秒`);
  else parts.push(`${t.toFixed(1)} 秒`);
  return parts.join("｜");
}

/** Shot information in the top-left corner of the active picture (inside the letterbox when there is one) */
export function drawInfo(g, text, w, h, ratio = null) {
  const a = letterboxRect(w, h, ratio), size = Math.max(11, Math.round(h * 0.03)), pad = size * 0.4;
  g.save();
  g.font = `${size}px "Microsoft JhengHei", "PingFang TC", "Noto Sans TC", sans-serif`;
  g.textBaseline = "middle";
  const tw = g.measureText(text).width, x = a.x + size * 0.6, y = a.y + size * 0.6;
  g.fillStyle = "rgba(0, 0, 0, 0.6)";
  g.fillRect(x, y, tw + pad * 2, size * 1.5);
  g.fillStyle = "#fff";
  g.fillText(text, x + pad, y + size * 0.75);
  g.restore();
}
