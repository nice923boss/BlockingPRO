// Offline rendering of the program (cameras switched by the cut list): single frames, contact sheets and MP4.
// Frames are rendered one by one at exact times, so the output never drops frames however slow the machine is.
import * as THREE from "three";
import { pathPolyline } from "./keys.js";
import { cutAt } from "./camera.js";
import { DofPass } from "./dof.js";
import { depthRange, renderDepth } from "./depth.js";

// mediabunny 1.61.0, kept in vendor/ so export works offline (relative to this module)
const MB_URL = "../vendor/mediabunny/mediabunny.min.mjs";

export function createProgramRenderer(width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(width, height, false);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  const camera = new THREE.PerspectiveCamera(35, width / height, 0.05, 500);
  const pr = { canvas, renderer, camera, width, height, dof: null, depthRanges: new Map() };
  pr.dispose = () => { pr.dof?.dispose(); renderer.dispose(); renderer.forceContextLoss(); };
  return pr;
}

/**
 * Render time t through camId (default: the live camera of the cut list). Returns the camera id used.
 * depth: grey depth instead of the picture, ranged on the camera at the start of the shot (or of the whole clip for a fixed camera).
 */
export function renderProgramFrame(rt, pr, t, camId = null, { depth = false } = {}) {
  const id = camId || rt.liveCamera(t);
  let range = null;
  if (depth && id) {
    const t0 = camId ? 0 : (cutAt(rt.project, t)?.t ?? 0), key = `${id}@${t0}`;
    if (!pr.depthRanges.has(key)) {
      rt.evaluate(t0);
      pr.depthRanges.set(key, depthRange(rt.cameraState(id, t0, pr.width / pr.height)));
    }
    range = pr.depthRanges.get(key);
  }
  rt.evaluate(t);
  const st = id && rt.applyCamera(pr.camera, id, t, pr.width / pr.height);
  if (!st) {
    pr.camera.aspect = pr.width / pr.height;
    pr.camera.fov = 40;
    pr.camera.position.set(6, 4, 8);
    pr.camera.lookAt(0, 1, 0);
    pr.camera.updateProjectionMatrix();
  }
  if (range) renderDepth(pr.renderer, rt.scene, pr.camera, range);
  else if (st?.dof) (pr.dof ||= new DofPass()).render(pr.renderer, rt.scene, pr.camera, st, pr.width, pr.height);
  else pr.renderer.render(rt.scene, pr.camera);
  return id;
}

export const QUALITIES = { low: "低（檔案最小）", medium: "中", high: "高（預設）", very_high: "最高（檔案最大）" };
const QUALITY_KEYS = { low: "QUALITY_LOW", medium: "QUALITY_MEDIUM", high: "QUALITY_HIGH", very_high: "QUALITY_VERY_HIGH" };

/** Container and codec this browser can write: auto = MP4 with H.264 when possible, otherwise WebM (o07) */
async function pickCodec(MB, format, size) {
  const mp4 = () => MB.getFirstEncodableVideoCodec(["avc", "vp9", "av1"], size);
  const webm = () => MB.getFirstEncodableVideoCodec(["vp9", "vp8", "av1"], size);
  if (format === "mp4") return { container: "mp4", codec: await mp4() };
  if (format === "webm") return { container: "webm", codec: await webm() };
  if (await MB.canEncodeVideo("avc", size)) return { container: "mp4", codec: "avc" };
  return { container: "webm", codec: await webm() };
}

/**
 * Encode [start, end) of the program to MP4 or WebM. Returns { blob, container, codec, audioCodec, frames, width, height }.
 * opts: { width, height, fps, start, end, camera (fixed camera id or null for the cut list), onProgress(0..1), signal,
 *   overlay(g, t, camId, w, h): draws 2D layers (subtitles, ...) over each frame,
 *   audio: AudioBuffer covering [start, end) to mux as the sound track,
 *   format: "auto" | "mp4" | "webm", quality: key of QUALITIES, depth: grey depth frames instead of the picture }
 */
export async function exportMp4(rt, opts) {
  const { fps, start = 0, end, camera = null, onProgress, signal } = opts;
  // H.264 needs even dimensions
  const width = Math.round(opts.width / 2) * 2, height = Math.round(opts.height / 2) * 2;
  const MB = await import(MB_URL);
  const { container, codec } = await pickCodec(MB, opts.format || "auto", { width, height });
  if (!codec) throw new Error(container === "webm" ? "這個瀏覽器不能編 WebM（VP9、VP8、AV1），請改選 MP4 或自動" : "這個瀏覽器沒有可用的影片編碼器，請改用 Chrome 或 Edge");
  const bitrate = MB[QUALITY_KEYS[opts.quality] || "QUALITY_HIGH"];
  const pr = createProgramRenderer(width, height);
  // with an overlay, each WebGL frame is copied to a 2D canvas and the layers are drawn on top
  let frameCanvas = pr.canvas, g = null;
  if (opts.overlay) {
    frameCanvas = Object.assign(document.createElement("canvas"), { width, height });
    g = frameCanvas.getContext("2d");
  }
  const format = container === "webm" ? new MB.WebMOutputFormat() : new MB.Mp4OutputFormat({ fastStart: "in-memory" });
  const output = new MB.Output({ format, target: new MB.BufferTarget() });
  const src = new MB.CanvasSource(frameCanvas, { codec, bitrate, keyFrameInterval: 2 });
  output.addVideoTrack(src, { frameRate: fps });
  let audioSrc = null, audioCodec = null;
  if (opts.audio) {
    const { numberOfChannels, sampleRate } = opts.audio;
    audioCodec = await MB.getFirstEncodableAudioCodec(container === "webm" ? ["opus", "vorbis"] : ["aac", "opus"], { numberOfChannels, sampleRate });
    if (!audioCodec) throw new Error("這個瀏覽器沒有可用的音訊編碼器，請取消「包含音訊」後再輸出");
    audioSrc = new MB.AudioBufferSource({ codec: audioCodec, bitrate });
    output.addAudioTrack(audioSrc);
  }
  await output.start();
  const frames = Math.max(1, Math.round((end - start) * fps));
  const saved = rt.time;
  try {
    for (let i = 0; i < frames; i++) {
      if (signal?.aborted) {
        await output.cancel();
        throw new DOMException("已取消輸出", "AbortError");
      }
      const t = start + i / fps, camId = renderProgramFrame(rt, pr, t, camera, { depth: opts.depth });
      if (g) {
        g.drawImage(pr.canvas, 0, 0);
        opts.overlay(g, t, camId, width, height);
      }
      await src.add(i / fps, 1 / fps);
      onProgress?.((i + 1) / frames);
    }
    if (audioSrc) await audioSrc.add(opts.audio);
    await output.finalize();
  } finally {
    pr.dispose();
    rt.evaluate(saved);
  }
  return { blob: new Blob([output.target.buffer], { type: `video/${container}` }), container, codec, audioCodec, frames, width, height };
}

const fmtT = (t) => (Math.round(t * 100) / 100).toFixed(2).replace(/\.?0+$/, "") + " 秒";

/** Grid of program frames with time and camera labels, as a canvas */
export function contactSheet(rt, { times, width = 480, cols = 4, camera = null }) {
  const S = rt.project.settings;
  const height = Math.round((width * S.height) / S.width / 2) * 2;
  const pr = createProgramRenderer(width, height);
  const rows = Math.ceil(times.length / cols);
  const sheet = document.createElement("canvas");
  sheet.width = Math.min(cols, times.length) * width;
  sheet.height = rows * height;
  const g = sheet.getContext("2d");
  const saved = rt.time;
  times.forEach((t, i) => {
    const id = renderProgramFrame(rt, pr, t, camera);
    const x = (i % cols) * width, y = Math.floor(i / cols) * height;
    g.drawImage(pr.canvas, x, y);
    const cam = rt.project.cameras.find((c) => c.id === id);
    label(g, x + 4, y + 4, `${fmtT(t)}  ${cam ? cam.name : "預設視角"}`, cam?.color);
    const note = camera ? null : cutAt(rt.project, t)?.note;
    if (note) caption(g, x + 4, y + height - 4, width - 8, note);
    g.strokeStyle = "#000";
    g.strokeRect(x + 0.5, y + 0.5, width - 1, height - 1);
  });
  pr.dispose();
  rt.evaluate(saved);
  return sheet;
}

/** Shot note along the bottom of a frame, cut with an ellipsis to fit one or two lines. */
function caption(g, x, bottom, maxW, text) {
  g.font = "14px system-ui, sans-serif";
  const fits = (str) => g.measureText(str).width <= maxW - 12;
  const lines = [""];
  for (const ch of text) {
    const last = lines.length - 1;
    if (fits(lines[last] + ch)) lines[last] += ch;
    else if (lines.length < 2) lines.push(ch);
    else { lines[last] = lines[last].slice(0, -1) + "…"; break; }
  }
  const lh = 19, top = bottom - lines.length * lh - 6;
  g.fillStyle = "rgba(0,0,0,0.65)";
  g.fillRect(x, top, maxW, lines.length * lh + 6);
  g.fillStyle = "#fff";
  lines.forEach((l, i) => g.fillText(l, x + 6, top + 17 + i * lh));
}

function label(g, x, y, text, color = "#fff") {
  g.font = "bold 15px system-ui, sans-serif";
  const w = g.measureText(text).width;
  g.fillStyle = "rgba(0,0,0,0.65)";
  g.fillRect(x, y, w + 12, 22);
  g.fillStyle = color || "#fff";
  g.fillText(text, x + 6, y + 16);
}

/**
 * Top-down map at time t: paths, names, camera positions with their aim, so a layout can be checked at a glance.
 */
export function overviewMap(rt, t, size = 900) {
  const P = rt.project;
  rt.evaluate(t);
  // fit everything that has a path
  const pts = [];
  const lines = [];
  for (const list of [P.actors, P.props, P.lights]) for (const e of list) {
    const ent = rt.entities.get(e.id);
    if (!ent) continue;
    const poly = pathPolyline(ent.path);
    pts.push(...poly);
    lines.push({ e, poly, color: list === P.actors ? "#ffd23f" : list === P.props ? "#9ad1ff" : "#ffffff" });
  }
  const camStates = P.cameras.map((c) => ({ c, st: rt.cameraState(c.id, t, P.settings.width / P.settings.height) }));
  for (const { st } of camStates) pts.push(st.position.toArray());
  let minX = -3, maxX = 3, minZ = -3, maxZ = 3;
  for (const p of pts) { minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]); minZ = Math.min(minZ, p[2]); maxZ = Math.max(maxZ, p[2]); }
  const span = Math.max(maxX - minX, maxZ - minZ) * 1.15 + 1, cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
  const pr = createProgramRenderer(size, size);
  const cam = new THREE.OrthographicCamera(-span / 2, span / 2, span / 2, -span / 2, 0.1, 200);
  // looking down with +Z towards the bottom of the image and +X to the right
  cam.position.set(cx, 80, cz);
  cam.up.set(0, 0, -1);
  cam.lookAt(cx, 0, cz);
  pr.renderer.render(rt.scene, cam);
  const out = document.createElement("canvas");
  out.width = out.height = size;
  const g = out.getContext("2d");
  g.drawImage(pr.canvas, 0, 0);
  pr.dispose();
  const toPx = (p) => [((p[0] - cx) / span + 0.5) * size, ((p[2] - cz) / span + 0.5) * size];
  g.lineWidth = 2;
  for (const { e, poly, color } of lines) {
    if (poly.length > 1) {
      g.strokeStyle = color;
      g.setLineDash([6, 4]);
      g.beginPath();
      poly.forEach((p, i) => { const [x, y] = toPx(p); if (i) g.lineTo(x, y); else g.moveTo(x, y); });
      g.stroke();
      g.setLineDash([]);
      for (const k of e.path.keys) { const [x, y] = toPx(k.v); g.fillStyle = color; g.fillRect(x - 3, y - 3, 6, 6); }
    }
    const ent = rt.entities.get(e.id);
    const [x, y] = toPx(ent.object.position.toArray());
    label(g, x + 6, y - 11, e.name, color);
  }
  for (const { c, st } of camStates) {
    const [x, y] = toPx(st.position.toArray()), [tx, ty] = toPx(st.target.toArray());
    const a = Math.atan2(ty - y, tx - x), half = Math.atan(18 / st.lens);
    g.fillStyle = c.color + "55";
    g.strokeStyle = c.color;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + Math.cos(a - half) * 70, y + Math.sin(a - half) * 70);
    g.lineTo(x + Math.cos(a + half) * 70, y + Math.sin(a + half) * 70);
    g.closePath();
    g.fill();
    g.stroke();
    label(g, x + 6, y + 4, `${c.name} ${Math.round(st.lens)}mm`, c.color);
  }
  label(g, 8, 8, `俯視圖 ${fmtT(t)}  每格 1 公尺  右 +X、下 +Z`);
  return out;
}
