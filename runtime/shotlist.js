// Shot list data shared by the CSV, PDF, prompt and per-shot exports (o02, o03, o09, o10).
// Pure functions on plain data: no three.js, so node tests can import this file.

/** Shots of the cut list clipped to the duration: [{ index (1-based), start, end, camera, note }] */
export function shotRanges(project) {
  const d = project.settings.duration;
  const cuts = [...project.cuts].sort((a, b) => a.t - b.t).filter((c) => c.t < d - 1e-6);
  if (!cuts.length) return project.cameras.length ? [{ index: 1, start: 0, end: d, camera: project.cameras[0].id, note: "" }] : [];
  if (cuts[0].t > 1e-6) cuts.unshift({ t: 0, camera: cuts[0].camera, note: "" });
  return cuts.map((c, i) => ({ index: i + 1, start: c.t, end: cuts[i + 1]?.t ?? d, camera: c.camera, note: c.note || "" }));
}

/**
 * Split [0, duration] into parts no longer than max seconds (o03). Each part ends on the last cut that fits,
 * so a shot is not split in two; a shot longer than max is split hard at the limit.
 */
export function splitRanges(duration, cutTimes, max) {
  const out = [], eps = 1e-6;
  const cuts = [...new Set(cutTimes)].filter((t) => t > eps && t < duration - eps).sort((a, b) => a - b);
  let s = 0;
  while (duration - s > max + eps) {
    const fit = cuts.filter((t) => t > s + 0.5 && t <= s + max + eps);
    const e = fit.length ? fit[fit.length - 1] : s + max;
    out.push({ start: s, end: e });
    s = e;
  }
  out.push({ start: s, end: duration });
  return out;
}

const sub = (a, b) => a.map((x, i) => x - b[i]);
const len = (a) => Math.hypot(...a);
const angle = (a, b) => {
  const c = (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (len(a) * len(b) || 1);
  return (Math.acos(Math.min(1, Math.max(-1, c))) * 180) / Math.PI;
};

/**
 * Camera move between two plain camera states { position, target, lens, shake } (arrays for vectors).
 * Rough labels for the shot list: what the move looks like, not how the keys were written.
 */
export function describeMove(a, b, mounted = false) {
  const parts = [];
  const moved = len(sub(b.position, a.position));
  const dA = len(sub(a.target, a.position)), dB = len(sub(b.target, b.position));
  if (mounted) parts.push("跟拍");
  else if (moved > 0.25) {
    const rise = b.position[1] - a.position[1];
    if (Math.abs(rise) > moved * 0.7) parts.push(rise > 0 ? "升起" : "下降");
    else if (dB < dA * 0.85) parts.push("推近");
    else if (dB > dA * 1.15) parts.push("拉遠");
    else {
      const flatA = [a.position[0] - a.target[0], 0, a.position[2] - a.target[2]];
      const flatB = [b.position[0] - b.target[0], 0, b.position[2] - b.target[2]];
      parts.push(angle(flatA, flatB) > 30 ? "環繞" : "橫移");
    }
  } else if (angle(sub(a.target, a.position), sub(b.target, b.position)) > 6) parts.push("搖鏡");
  if (Math.abs(b.lens - a.lens) > 3) parts.push(b.lens > a.lens ? "變焦推近" : "變焦拉遠");
  if (!parts.length) parts.push("固定");
  if (a.shake > 0) parts.push("手持");
  return parts.join("＋");
}

// ---------- CSV (o10) ----------

const CSV_HEAD = ["鏡號", "開始（秒）", "結束（秒）", "長度（秒）", "攝影機", "景別", "運鏡", "焦距（mm）", "畫面中角色", "畫面內容", "提示詞"];
const r2 = (x) => Math.round(x * 100) / 100;
const cell = (v) => {
  const s = String(v ?? "");
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** rows: from shotRows (index, start, end, camName, size, move, lens, actors[], note, prompt). BOM and CRLF so Excel opens it as UTF-8. */
export function csvText(rows) {
  const lines = [CSV_HEAD, ...rows.map((r) => [r.index, r2(r.start), r2(r.end), r2(r.end - r.start), r.camName, r.size, r.move,
    Math.round(r.lens), r.actors.join("、"), r.note, r.prompt])];
  return "﻿" + lines.map((l) => l.map(cell).join(",")).join("\r\n") + "\r\n";
}

// ---------- prompts (o02) ----------

const HUES = [[15, "紅"], [40, "橙"], [65, "黃"], [170, "綠"], [195, "青"], [255, "藍"], [290, "紫"], [335, "粉紅"], [360, "紅"]];

/** Rough Chinese colour name of #rrggbb, to tell actors apart in the reference video */
export function colorName(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
  if (!m) return "白";
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  if (d < 0.1) return l > 0.8 ? "白" : l < 0.2 ? "黑" : "灰";
  let hue = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  hue = (hue * 60 + 360) % 360;
  const s = d / (1 - Math.abs(2 * l - 1));
  if (hue >= 15 && hue < 45 && l < 0.45) return "棕";
  const name = HUES.find(([h]) => hue < h)[1];
  return s < 0.25 ? `灰${name}` : l < 0.3 ? `深${name}` : l > 0.75 ? `淺${name}` : name;
}

/**
 * Overall and per-shot prompts. cast: [{ name, kind (體型或物種), color }], scene: { lighting, props[], duration, width, height }
 * rows: shot rows without prompt. Appearance is left for the user: the white model only fixes position, motion and framing.
 */
export function buildPrompts({ cast, scene, rows }) {
  const who = cast.map((c) => `${c.name}（${c.kind}，參考影片中的${colorName(c.color)}色人形）`).join("、");
  const things = scene.props.length ? `場景物品有${[...new Set(scene.props)].slice(0, 12).join("、")}。` : "";
  const overall = [
    `依照參考影片的人物走位、動作節奏與運鏡，生成 ${scene.duration} 秒、${scene.width}x${scene.height} 的寫實短片。`,
    cast.length ? `角色：${who}。` : "",
    `${scene.lighting}光線。${things}`,
    "請補上：每個角色的外觀與服裝、場景地點與材質、畫面風格。參考影片的白模只代表位置與動作，不要出現白色人偶。",
  ].join("");
  const shots = rows.map((r) => {
    const people = r.actors.length ? `畫面中有${r.actors.join("、")}` : "畫面中沒有角色";
    return `${r.size}，${r.move}，${people}。${r.note || ""}`.replace(/。$/, "") + "。";
  });
  return { overall, shots };
}
