// Timeline edits that touch many items at once: markers, subtitles, multi-selection moves and deletes, time stretch.
import { uid, attachList } from "../runtime/schema.js";
import { findEntity, trackKeys, selKeys, selClips } from "./state.js";
import { round, toast } from "./ui.js";

let S;
export function initTimeOps(store) { S = store; }

const r3 = (t) => round(t, 3);

// ---------- markers ----------

export function addMarker(t, label = null) {
  S.edit("加標記", (p) => {
    const n = p.settings.markers.length + 1;
    p.settings.markers.push({ t: r3(Math.max(0, Math.min(p.settings.duration, t))), label: label ?? `標記 ${n}` });
  });
}
/** Markers stay sorted, so a moved marker is kept between its neighbours (its index stays valid during a drag) */
export function patchMarker(i, patch, coalesce = null) {
  S.edit("修改標記", (p) => {
    const ms = p.settings.markers, m = ms[i];
    if (!m) return;
    const lo = i > 0 ? ms[i - 1].t : 0, hi = i < ms.length - 1 ? ms[i + 1].t : p.settings.duration;
    ms[i] = { ...m, ...patch, ...(patch.t != null && { t: r3(Math.max(lo, Math.min(hi, patch.t))) }) };
  }, { coalesce });
}
export function deleteMarker(i) {
  S.edit("刪除標記", (p) => { p.settings.markers.splice(i, 1); });
}

// ---------- cuts, in / out points, jumps ----------

/** Change a cut's camera or note (from the shot table); repeats of the same camera merge like cutTo */
export function patchCut(i, patch) {
  S.edit(patch.camera ? "修改剪接攝影機" : "修改鏡頭說明", (p) => {
    if (!p.cuts[i]) return;
    const c = { ...p.cuts[i], ...patch };
    if (!c.note) delete c.note;
    p.cuts[i] = c;
    if (patch.camera) p.cuts = p.cuts.filter((x, k) => k === 0 || p.cuts[k - 1].camera !== x.camera);
  });
}

export function setInPoint() {
  const r = S.range, t = S.time;
  S.setRange({ a: t, b: r && r.b > t ? r.b : S.project.settings.duration });
}
export function setOutPoint() {
  const r = S.range, t = S.time;
  S.setRange({ a: r && r.a < t ? r.a : 0, b: t });
}

/** Move the playhead to the previous (dir -1) or next (dir 1) marker or cut */
export function jumpMark(dir) {
  const P = S.project, t = S.time;
  const marks = [0, P.settings.duration, ...P.settings.markers.map((m) => m.t), ...P.cuts.map((c) => c.t)].sort((a, b) => a - b);
  const next = dir > 0 ? marks.find((x) => x > t + 1e-3) : marks.filter((x) => x < t - 1e-3).pop();
  if (next != null) S.setTime(next);
}

// ---------- subtitles ----------

export function addSubtitle(t, text, actor = null, dur = 2) {
  const id = uid("s");
  S.edit("加字幕", (p) => {
    p.subtitles.push({ id, t: r3(Math.max(0, t)), dur: Math.max(0.2, Math.min(dur, p.settings.duration - t)), text, ...(actor && { actor }) });
  });
  return id;
}
export function patchSubtitle(id, patch, coalesce = null) {
  S.edit("修改字幕", (p) => {
    p.subtitles = p.subtitles.map((x) => {
      if (x.id !== id) return x;
      const out = { ...x, ...patch };
      if (!out.actor) delete out.actor;
      if (out.t != null) out.t = r3(Math.max(0, out.t));
      if (out.dur != null) out.dur = r3(Math.max(0.2, out.dur));
      return out;
    });
  }, { coalesce });
}
export function deleteSubtitle(id) {
  S.edit("刪除字幕", (p) => { p.subtitles = p.subtitles.filter((x) => x.id !== id); });
}

// ---------- audio clips (the sound itself is stored by js/audio.js) ----------

export function addAudio(clip) {
  const id = uid("au");
  S.edit("加入音訊", (p) => { p.audio.push({ gain: 1, offset: 0, ...clip, id, start: r3(Math.max(0, clip.start || 0)) }); });
  return id;
}
export function patchAudio(id, patch, coalesce = null) {
  S.edit("修改音訊", (p) => {
    p.audio = p.audio.map((x) => {
      if (x.id !== id) return x;
      const out = { ...x, ...patch };
      if (!out.muted) delete out.muted;
      out.start = r3(Math.max(0, out.start));
      out.offset = r3(Math.max(0, Math.min(out.offset, Math.max(0, out.dur - 0.1))));
      return out;
    });
  }, { coalesce });
}
export function deleteAudio(id) {
  S.edit("刪除音訊", (p) => { p.audio = p.audio.filter((x) => x.id !== id); });
}

// ---------- multi-selection ----------

/**
 * Allowed time shift for the selected keys and clips: each key stays between its unselected neighbours,
 * nothing goes below 0. Returns [lo, hi].
 */
export function shiftLimits(project, keys, clips) {
  let lo = -Infinity, hi = Infinity;
  const picked = new Set(keys.map((k) => `${k.id}|${k.track}|${k.i}`));
  for (const k of keys) {
    const ks = trackKeys(findEntity(project, k.id).spec, k.track);
    const t = ks[k.i].t;
    let j = k.i - 1;
    while (j >= 0 && picked.has(`${k.id}|${k.track}|${j}`)) j--;
    lo = Math.max(lo, (j >= 0 ? ks[j].t + 0.01 : 0) - t);
    j = k.i + 1;
    while (j < ks.length && picked.has(`${k.id}|${k.track}|${j}`)) j++;
    if (j < ks.length) hi = Math.min(hi, ks[j].t - 0.01 - t);
  }
  for (const c of clips) {
    const clip = findEntity(project, c.id).spec[c.track].find((x) => x.id === c.clipId);
    lo = Math.max(lo, -clip.start);
  }
  return [lo, hi];
}

/** Shift the selected keys and clips by dt seconds (from base, the project when the drag started) */
export function shiftSelection(base, keys, clips, dt, coalesce) {
  const [lo, hi] = shiftLimits(base, keys, clips);
  const d = Math.max(lo, Math.min(hi, dt));
  S.edit("移動多個項目", (p) => {
    for (const k of keys) {
      const src = trackKeys(findEntity(base, k.id).spec, k.track)[k.i];
      const ks = trackKeys(findEntity(p, k.id).spec, k.track);
      ks[k.i] = { ...ks[k.i], t: r3(src.t + d) };
    }
    for (const c of clips) {
      const src = findEntity(base, c.id).spec[c.track].find((x) => x.id === c.clipId);
      const spec = findEntity(p, c.id).spec;
      spec[c.track] = spec[c.track].map((x) => (x.id === c.clipId ? { ...x, start: r3(src.start + d) } : x));
    }
  }, { coalesce });
  return d;
}

/** Delete every selected key and clip in one step. Path and aim tracks keep at least one key. */
export function deleteMulti() {
  const sel = S.sel, keys = selKeys(sel), clips = selClips(sel);
  let kept = 0;
  S.edit(`刪除 ${keys.length + clips.length} 個項目`, (p) => {
    const byTrack = new Map();
    for (const k of keys) {
      const id = `${k.id}|${k.track}`;
      if (!byTrack.has(id)) byTrack.set(id, { ...k, list: [] });
      byTrack.get(id).list.push(k.i);
    }
    for (const g of byTrack.values()) {
      const spec = findEntity(p, g.id).spec, ks = trackKeys(spec, g.track);
      const idx = [...new Set(g.list)].sort((a, b) => b - a);
      for (const i of idx) {
        if ((g.track === "path" || g.track === "aim") && ks.length <= 1) { kept++; break; }
        ks.splice(i, 1);
      }
      if ((g.track === "lens" || g.track === "roll") && ks.length <= 1) spec[g.track] = ks.length ? ks[0].v : g.track === "lens" ? 35 : 0;
    }
    for (const c of clips) {
      const spec = findEntity(p, c.id).spec;
      spec[c.track] = spec[c.track].filter((x) => x.id !== c.clipId);
    }
  });
  S.select({ id: sel.id });
  if (kept) toast("路徑至少要保留一個關鍵影格，有些沒有刪除", "warn");
}

// ---------- time stretch ----------

/** Map of a stretch of [a, b] by factor f: earlier times stay, later times shift by the extra length */
export function stretchMap(a, b, f) {
  return (t) => (t <= a ? t : t <= b ? a + (t - a) * f : t + (b - a) * (f - 1));
}

/**
 * Stretch (f > 1, slower) or squeeze (f < 1, faster) everything inside [a, b]: keys, clips, gaze, cuts,
 * hand-held ranges, markers and subtitles. Content after b shifts. extend: total length follows.
 */
export function stretchTime(a, b, f, { extend = true, label = null } = {}) {
  if (!(b > a) || !(f > 0) || f === 1) return;
  const m = stretchMap(a, b, f);
  const span = (t0, d) => m(t0 + d) - m(t0);
  S.edit(label || `時間縮放 ${round(f, 2)} 倍（${round(a, 2)} 到 ${round(b, 2)} 秒）`, (p) => {
    const keysOf = (spec) => [spec.path?.keys, spec.aim?.keys, Array.isArray(spec.lens) ? spec.lens : null, Array.isArray(spec.roll) ? spec.roll : null].filter(Boolean);
    for (const list of [p.actors, p.props, p.lights, p.cameras]) for (const e of list) {
      for (const ks of keysOf(e)) for (const k of ks) k.t = r3(m(k.t));
      for (const tr of ["actions", "upper", "gaze"]) if (Array.isArray(e[tr])) for (const c of e[tr]) { c.dur = r3(Math.max(0.05, span(c.start, c.dur))); c.start = r3(m(c.start)); }
      for (const s of attachList(e)) {
        if (s.throw > 0 && s.to != null) s.throw = r3(Math.max(0.05, span(s.to, s.throw)));
        if (s.from != null) s.from = r3(m(s.from));
        if (s.to != null) s.to = r3(m(s.to));
      }
    }
    for (const c of p.cuts) c.t = r3(m(c.t));
    for (const x of p.settings.markers) x.t = r3(m(x.t));
    for (const x of p.subtitles) { x.dur = r3(Math.max(0.2, span(x.t, x.dur))); x.t = r3(m(x.t)); }
    for (const x of p.audio) x.start = r3(m(x.start)); // sound cannot be time-stretched; it only moves
    if (extend) p.settings.duration = r3(Math.max(0.5, m(p.settings.duration)));
  });
}

/** Change the total length; with rescale, all content scales with it */
export function setDuration(d, rescale) {
  const D = S.project.settings.duration;
  if (rescale && d !== D) stretchTime(0, D, d / D, { label: `總長改為 ${d} 秒（內容等比縮放）` });
  else S.edit("修改總長", (p) => { p.settings.duration = d; });
}
