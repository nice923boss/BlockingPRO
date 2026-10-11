// Audio track: sound files are kept in this browser's IndexedDB (too large for the project JSON and the
// localStorage autosave); the project keeps only where each clip sits. Plays in sync with the timeline
// and mixes [start, end) down to one AudioBuffer for the MP4 export.
import { toast } from "./ui.js";
import * as tops from "./ops-time.js";

const DB_NAME = "blockingpro-audio", STORE = "files", RATE = 48000;
export const isAudioFile = (f) => /^audio\//.test(f.type) || /\.(wav|mp3|m4a|aac|ogg|oga|opus|flac|webm)$/i.test(f.name);

let dbPromise = null;
function db() {
  dbPromise ||= new Promise((ok, bad) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => ok(req.result);
    req.onerror = () => bad(req.error);
  });
  return dbPromise;
}
async function tx(mode, fn) {
  const d = await db();
  return new Promise((ok, bad) => {
    const t = d.transaction(STORE, mode), req = fn(t.objectStore(STORE));
    t.oncomplete = () => ok(req.result);
    t.onerror = () => bad(t.error);
    t.onabort = () => bad(t.error || new Error("IndexedDB 交易中止"));
  });
}

// file name -> Promise<AudioBuffer | null> (null: not stored in this browser)
const buffers = new Map();
const decoded = new Map(); // file name -> AudioBuffer, filled as decodes finish
const peakCache = new Map();
const warned = new Set();
const listeners = new Set();
export const onAudioReady = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

/** Store a sound file under its name (the project refers to it by name) and decode it. Returns the AudioBuffer. */
export async function storeFile(file) {
  const buf = await decode(await file.arrayBuffer());
  await tx("readwrite", (s) => s.put(file, file.name));
  buffers.set(file.name, Promise.resolve(buf));
  decoded.set(file.name, buf);
  peakCache.delete(file.name);
  warned.delete(file.name);
  for (const fn of listeners) fn(file.name);
  return buf;
}

function decode(bytes) {
  // an offline context decodes without needing a user gesture; everything is resampled to 48 kHz
  return new OfflineAudioContext(2, 1, RATE).decodeAudioData(bytes);
}

/** Decoded sound for a file name, or null when this browser does not have it */
export function getBuffer(name) {
  if (!buffers.has(name)) {
    buffers.set(name, (async () => {
      const blob = await tx("readonly", (s) => s.get(name));
      if (!blob) return null;
      const buf = await decode(await blob.arrayBuffer());
      decoded.set(name, buf);
      for (const fn of listeners) fn(name);
      return buf;
    })().catch((err) => {
      console.error(`BlockingPRO: 讀取音訊「${name}」失敗`, err);
      buffers.delete(name);
      return null;
    }));
  }
  return buffers.get(name);
}
export const readyBuffer = (name) => decoded.get(name) || null;

/** Load every clip's sound; tells the user once per file that is not in this browser */
export async function ensureLoaded(project) {
  const names = [...new Set(project.audio.map((c) => c.file))];
  const missing = [];
  await Promise.all(names.map(async (n) => { if (!(await getBuffer(n)) && !warned.has(n)) { warned.add(n); missing.push(n); } }));
  if (missing.length) toast(`音訊檔不在這台電腦的瀏覽器裡：${missing.join("、")}。請在時間軸「音訊」列重新匯入，或把音訊檔和專案放在同一個資料夾一起開啟。`, "warn", 9000);
}

/** Peak envelope (0..1) of a file, one value per 10 ms */
export function peaks(name) {
  const buf = decoded.get(name);
  if (!buf) return null;
  if (!peakCache.has(name)) {
    const step = Math.max(1, Math.round(buf.sampleRate / 100)), n = Math.ceil(buf.length / step), out = new Float32Array(n);
    for (let ch = 0; ch < buf.numberOfChannels; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < n; i++) {
        let m = out[i];
        for (let j = i * step, e = Math.min(d.length, j + step); j < e; j++) { const v = Math.abs(d[j]); if (v > m) m = v; }
        out[i] = m;
      }
    }
    peakCache.set(name, out);
  }
  return peakCache.get(name);
}

/** Pick sound files and add them as clips starting at t */
export function importAudio(store, t) {
  const input = Object.assign(document.createElement("input"), { type: "file", accept: "audio/*,.wav,.mp3,.m4a,.aac,.ogg,.opus,.flac", multiple: true });
  input.style.display = "none";
  input.addEventListener("change", () => { const files = [...input.files]; input.remove(); if (files.length) importAudioFiles(store, files, t); });
  document.body.append(input);
  input.click();
}

export async function importAudioFiles(store, files, t) {
  let at = t;
  for (const f of files) {
    try {
      const buf = await storeFile(f);
      tops.addAudio({ name: f.name.replace(/\.[^.]+$/, ""), file: f.name, start: at, dur: Math.round(buf.duration * 1000) / 1000 });
      toast(`已加入音訊「${f.name}」（${buf.duration.toFixed(1)} 秒）`);
      at += buf.duration;
    } catch (err) {
      console.error(`BlockingPRO: 匯入音訊「${f.name}」失敗`, err);
      toast(`無法匯入「${f.name}」：瀏覽器無法解碼這個格式（${err.message || err}）。可改用 WAV 或 MP3。`, "err", 8000);
    }
  }
}

/** Sound files that came with an opened folder: store the ones the project refers to. Returns the names linked. */
export async function linkAudioFiles(project, files) {
  const wanted = new Set(project.audio.map((c) => c.file)), linked = [];
  for (const f of files) {
    if (!wanted.has(f.name)) continue;
    try { await storeFile(f); linked.push(f.name); } catch (err) {
      console.error(`BlockingPRO: 資料夾裡的音訊「${f.name}」無法解碼`, err);
      toast(`資料夾裡的「${f.name}」無法解碼：${err.message || err}`, "err", 7000);
    }
  }
  return linked;
}

/** Timeline span a clip covers (its file length minus the trimmed head) */
export const clipLength = (c, buf = decoded.get(c.file)) => Math.max(0, (buf ? buf.duration : c.dur) - c.offset);

/** Mix the unmuted clips over [start, end) into a stereo 48 kHz buffer; null when nothing is audible there */
export async function mixdown(project, start, end) {
  const clips = [];
  for (const c of project.audio) {
    if (c.muted || !(c.gain > 0)) continue;
    const buf = await getBuffer(c.file);
    if (!buf) continue;
    const a = Math.max(start, c.start), b = Math.min(end, c.start + clipLength(c, buf));
    if (b > a) clips.push({ c, buf, a, b });
  }
  if (!clips.length) return null;
  const ctx = new OfflineAudioContext(2, Math.max(1, Math.ceil((end - start) * RATE)), RATE);
  for (const { c, buf, a, b } of clips) {
    const src = ctx.createBufferSource(), g = ctx.createGain();
    src.buffer = buf;
    g.gain.value = c.gain;
    src.connect(g).connect(ctx.destination);
    src.start(a - start, c.offset + (a - c.start), b - a);
  }
  return ctx.startRendering();
}

/** Live playback that follows the store: restarts on play / speed / edits, and when the playhead jumps (seek, loop) */
export class AudioPlayer {
  constructor(store) {
    Object.assign(this, { store, ctx: null, nodes: [], running: false, t0: 0, c0: 0, speed: 1 });
    store.subscribe((what) => {
      if (what === "project") { ensureLoaded(store.project); this.sync(true); }
      else if (what === "play") this.sync(true);
      else if (what === "time" && store.playing) this.sync(false);
    });
    onAudioReady(() => this.sync(true));
    ensureLoaded(store.project);
  }

  stop() {
    for (const n of this.nodes) try { n.stop(); } catch { /* already ended */ }
    this.nodes = [];
    this.running = false;
  }

  sync(force) {
    const s = this.store;
    if (!s.playing || !s.project.audio.length) return this.stop();
    if (!force && this.running) {
      const expected = this.t0 + (this.ctx.currentTime - this.c0) * this.speed;
      if (Math.abs(expected - s.time) < 0.15) return;
    }
    this.start(s.time);
  }

  start(t) {
    const s = this.store;
    this.stop();
    this.ctx ||= new AudioContext({ sampleRate: RATE });
    if (this.ctx.state === "suspended") this.ctx.resume();
    const now = this.ctx.currentTime + 0.02, speed = s.speed;
    for (const c of s.project.audio) {
      const buf = decoded.get(c.file);
      if (!buf || c.muted) continue;
      const end = c.start + clipLength(c, buf);
      if (end <= t) continue;
      const src = this.ctx.createBufferSource(), g = this.ctx.createGain();
      src.buffer = buf;
      src.playbackRate.value = speed;
      g.gain.value = c.gain;
      src.connect(g).connect(this.ctx.destination);
      src.start(now + Math.max(0, c.start - t) / speed, c.offset + Math.max(0, t - c.start));
      this.nodes.push(src);
    }
    Object.assign(this, { running: true, t0: t, c0: now, speed });
  }
}
