// Project format: defaults, normalisation and validation.
// Shared by the editor, the headless renderer (render.html) and the SKILL checker, so all three agree.
import { HUMAN_BODIES, HUMAN_JOINTS, BODY_LIMITS, resolveBody } from "./rig-human.js";
import { HUMAN_ACTIONS } from "./actions.js";
import { ANIMAL_TYPES } from "./rig-animal.js";
import { ANIMAL_ACTIONS } from "./actions-animal.js";
import { normalizeAsset, validateAsset, propDef } from "./assets.js";
import { LIGHTING } from "./lights.js";
import { normEase, sortKeys } from "./keys.js";
import { terrainWarnings } from "./terrain.js";
import { STATE_TYPES } from "./prop-anim.js";
import { HAND_SHAPES } from "./hands.js";
import { GAIT_STYLES, AMP_RANGE } from "./gait-style.js";

import { FORMAT, VERSION } from "./migrate.js";
// format version and upgrades live in migrate.js (no imports, so Node tests can load it)
export { FORMAT, VERSION, MIGRATIONS, migrate } from "./migrate.js";
export const DISPLAY_MODES = { white: "白模", joints: "關節", both: "白模＋關節" };
// white-model looks for the monitor and export (m05); null keeps the plain white material
export const LOOKS = { clay: "陶土色", wire: "線框", toon: "卡通描邊", deep: "依角色顏色加深" };
// camera shake patterns used with cameras[].shake (c08)
export const SHAKE_STYLES = { handheld: "手持", walk: "手持走路", breathe: "呼吸微晃", vehicle: "車上震動", impact: "衝擊震動" };
// AI video models that take the export as a reference (o12). Limits checked 2026-10-10, sources in docs/dev-log.md.
// maxShort is a recommendation (warning), minShort is a hard limit of the model; video: false = no video reference.
export const TARGETS = {
  "seedance-2.0": { label: "Seedance 2.0", minDuration: 2, maxDuration: 15, minShort: 300, maxShort: 720, fps: [24, 60],
    note: "參考影片單段 2 到 15 秒、720p 以內（API 可到 6000 px，網頁版限制未確認）；不接受寫實人臉" },
  "seedance-2.5": { label: "Seedance 2.5", minDuration: 2, maxDuration: 30, minShort: 300, maxShort: 1080, fps: [24, 60],
    note: "參考影片單段 2 到 30 秒，輸出最高 1080p、24 fps" },
  "kling-3.0-omni": { label: "Kling 3.0 Omni", minDuration: 3, maxDuration: 10, minShort: 700, maxShort: 1080, fps: [24, 60],
    note: "網頁版參考影片 3 到 10 秒（API 寫 15.5 秒）；短邊至少 700，480p 會被拒絕" },
  "kling-motion": { label: "Kling 動作控制", minDuration: 3, maxDuration: 30, minShort: 340, maxShort: 1080, fps: [24, 60], oneTake: true,
    note: "只學單一角色的動作，運鏡和剪接不會帶過去；請只輸出一台攝影機、不剪接" },
  "veo-3.1": { label: "Veo 3.1", minDuration: 0, maxDuration: 8, minShort: 0, maxShort: 4096, fps: [1, 120], video: false,
    note: "不接受上傳影片當參考，請改用首尾格 PNG（首幀圖）；輸出 4、6、8 秒" },
  "runway-aleph": { label: "Runway Aleph", minDuration: 2, maxDuration: 30, minShort: 480, maxShort: 1080, fps: [24, 30], webm: true,
    note: "參考影片 2 到 30 秒、480p 到 1080p、24 到 30 fps，輸出長度和參考影片相同" },
};
export const DEFAULT_TARGET = "seedance-2.0";
export const targetOf = (S) => TARGETS[S?.target] || TARGETS[DEFAULT_TARGET];
// kept for older imports: the default target in the old shape
export const SEEDANCE = { maxDuration: 15, maxHeight: 720, label: "Seedance 參考影片：單段 15 秒內、720p 以內" };

/** Warnings for a reference video of `duration` seconds at the project size, against target T */
export function targetWarnings(T, { duration, width, height, fps }) {
  const out = [], short = Math.min(width, height);
  if (T.video === false) out.push(`${T.label} 不接受上傳影片當參考，請改用首尾格 PNG（首幀圖）`);
  if (duration > T.maxDuration + 1e-6) out.push(`長度 ${duration} 秒超過 ${T.label} 上限 ${T.maxDuration} 秒`);
  if (duration < T.minDuration - 1e-6) out.push(`長度 ${duration} 秒短於 ${T.label} 下限 ${T.minDuration} 秒`);
  if (short < T.minShort) out.push(`短邊 ${short} 低於 ${T.label} 下限 ${T.minShort}，會被拒絕`);
  if (short > T.maxShort) out.push(`解析度 ${width}x${height} 超過 ${T.label} 建議的 ${T.maxShort}p`);
  if (fps < T.fps[0] || fps > T.fps[1]) out.push(`${fps} fps 不在 ${T.label} 的 ${T.fps[0] === T.fps[1] ? T.fps[0] : T.fps.join(" 到 ")} fps 範圍`);
  return out;
}

export const DEFAULT_SETTINGS = {
  width: 1280, height: 720, fps: 30, duration: 8,
  lighting: "day", background: null,
  ground: { show: true, grid: true, color: "#5a606b" },
  display: null,
  markers: [], // [{ t, label }] beats shown on the timeline
  letterbox: null, // null | "2.39" | "1.85": matte drawn on the monitor and (optionally) the export
  backdrop: null, // null | { file, mode: "flat" | "pano", rotate }: picture behind the scene (stored in the browser, by file name)
  look: null, // null | key of LOOKS
  target: DEFAULT_TARGET, // key of TARGETS: AI video model the export is for (limits and warnings)
};

const CAM_COLORS = ["#ff9f1c", "#2ec4b6", "#e71d36", "#a06cd5", "#43aa8b", "#f15bb5"];

let _seq = 0;
export function uid(prefix) {
  _seq = (_seq + 1) % 1e6;
  return prefix + Date.now().toString(36).slice(-4) + _seq.toString(36);
}

const clone = (o) => JSON.parse(JSON.stringify(o));
const num = (x, d) => (typeof x === "number" && isFinite(x) ? x : d);
const vec3 = (v, d = [0, 0, 0]) => (Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === "number" && isFinite(x)) ? v.slice() : d.slice());

function normPath(p, fallbackPos = [0, 0, 0]) {
  const keys = Array.isArray(p?.keys) && p.keys.length ? p.keys : [{ t: 0, v: fallbackPos }];
  return {
    curve: p?.curve === "linear" ? "linear" : "smooth",
    keys: sortKeys(keys.map((k) => {
      const out = { t: num(k.t, 0), v: vec3(k.v), e: normEase(k.e) };
      if (typeof k.yaw === "number") out.yaw = k.yaw;
      return out;
    })),
  };
}

function normTrack(track, def) {
  if (Array.isArray(track)) return track.length ? sortKeys(track.map((k) => ({ t: num(k.t, 0), v: k.v, e: normEase(k.e) }))) : def;
  return num(track, def);
}

function normClips(list) {
  return (Array.isArray(list) ? list : [])
    .map((c) => {
      // clips get an id so the editor can keep a clip selected while clips are re-sorted
      const out = { ...c, id: c.id || uid("c"), start: num(c.start, 0), dur: Math.max(0.05, num(c.dur, 2)) };
      if (c.blend != null) out.blend = Math.max(0, num(c.blend, 0.3));
      return out;
    })
    .sort((a, b) => a.start - b.start);
}

// gaze segments (runtime/gaze.js): target stays as written so validate() can point out a bad one
function normGaze(list) {
  return (Array.isArray(list) ? list : []).filter((g) => g && typeof g === "object")
    .map((g) => ({ ...g, start: num(g.start, 0), dur: Math.max(0.1, num(g.dur, 2)), ...(g.blend != null && { blend: Math.max(0.05, num(g.blend, 0.4)) }) }))
    .sort((a, b) => a.start - b.start);
}

/** A prop's attach as a list of segments (runtime/attach.js); empty when the prop is not held */
export const attachList = (o) => (Array.isArray(o.attach) ? o.attach : o.attach ? [o.attach] : []);
/** The stored shape of a segment list: nothing, one object, or a list sorted by start (only props that change hands need several) */
export function packAttach(list) {
  const l = list.filter((s) => s && typeof s === "object").sort((a, b) => (a.from ?? -Infinity) - (b.from ?? -Infinity));
  return l.length > 1 ? l : l[0];
}

/** Fill defaults and sort keys / clips / cuts. Returns a new object. */
export function normalize(input) {
  const p = clone(input || {});
  const settings = { ...DEFAULT_SETTINGS, ...(p.settings || {}) };
  settings.ground = { ...DEFAULT_SETTINGS.ground, ...(p.settings?.ground || {}) };
  settings.markers = (Array.isArray(settings.markers) ? settings.markers : [])
    .map((m) => ({ t: num(m?.t, 0), label: typeof m?.label === "string" ? m.label.slice(0, 40) : "" })).sort((a, b) => a.t - b.t);
  if (!["2.39", "1.85"].includes(settings.letterbox)) settings.letterbox = null;
  if (!LOOKS[settings.look]) settings.look = null;
  if (!TARGETS[settings.target]) settings.target = DEFAULT_TARGET;
  const gi = settings.ground.image;
  // floor plan laid on the ground in the editor only: width in metres, centre (x, z), turn in degrees
  settings.ground.image = gi && typeof gi.file === "string" && gi.file
    ? { file: gi.file, width: Math.max(0.1, num(gi.width, 10)), x: num(gi.x, 0), z: num(gi.z, 0), rotate: num(gi.rotate, 0), opacity: Math.min(1, Math.max(0.05, num(gi.opacity, 0.7))) }
    : null;
  const bd = settings.backdrop;
  settings.backdrop = bd && typeof bd.file === "string" && bd.file
    ? { file: bd.file, mode: bd.mode === "pano" ? "pano" : "flat", rotate: num(bd.rotate, 0) }
    : null;
  const assets = (Array.isArray(p.assets) ? p.assets : []).map(normalizeAsset);
  const out = {
    format: FORMAT, version: VERSION, name: p.name || "未命名場景",
    settings,
    actors: (p.actors || []).map((a) => ({
      ...a,
      name: a.name || (a.kind === "animal" ? ANIMAL_TYPES[a.preset]?.label : HUMAN_BODIES[a.preset]?.label) || "角色",
      kind: a.kind === "animal" ? "animal" : "human",
      preset: a.preset || (a.kind === "animal" ? "dog" : "man"),
      color: a.color || null, display: DISPLAY_MODES[a.display] ? a.display : "white",
      scale: num(a.scale, 1), facing: a.facing === "fixed" ? "fixed" : "path", yaw: num(a.yaw, 0),
      autoGait: a.autoGait !== false,
      path: normPath(a.path, vec3(a.pos)),
      actions: normClips(a.actions), upper: normClips(a.upper),
      gaze: normGaze(a.gaze),
    })),
    props: (p.props || []).map((o) => ({
      ...o,
      name: o.name || propDef(o.type, assets)?.label || "物品",
      color: o.color || null, scale: Array.isArray(o.scale) ? vec3(o.scale, [1, 1, 1]) : num(o.scale, 1),
      facing: o.facing || (propDef(o.type, assets)?.cat === "vehicle" ? "path" : "fixed"), yaw: num(o.yaw, 0),
      path: normPath(o.path, vec3(o.pos)),
      attach: packAttach(attachList(o)),
      ...(o.state != null && { state: normTrack(o.state, 0) }),
    })),
    lights: (p.lights || []).map((l) => ({
      ...l,
      name: l.name || (l.type === "point" ? "點光源" : "聚光燈"), type: l.type === "point" ? "point" : "spot",
      color: l.color || "#ffffff", intensity: num(l.intensity, 40), angle: num(l.angle, 35), distance: num(l.distance, 0), shadow: l.shadow !== false,
      path: normPath(l.path, vec3(l.pos, [0, 3, 0])),
      aim: l.aim?.actor ? { actor: l.aim.actor } : vec3(Array.isArray(l.aim) ? l.aim : null, [0, 0, 0]),
    })),
    cameras: (p.cameras || []).map((c, i) => ({
      ...c,
      name: c.name || `${String.fromCharCode(65 + (i % 26))} 機`, color: c.color || CAM_COLORS[i % CAM_COLORS.length], shake: num(c.shake, 0),
      shakeStyle: SHAKE_STYLES[c.shakeStyle] ? c.shakeStyle : "handheld",
      // depth of field on the program view and export: f-stop, focus distance in metres (null = distance to the aim point)
      dof: c.dof && typeof c.dof === "object" ? { fstop: Math.min(22, Math.max(1, num(c.dof.fstop, 2.8))), focus: typeof c.dof.focus === "number" && c.dof.focus > 0 ? c.dof.focus : null } : null,
      path: normPath(c.path, [0, 1.6, 6]),
      aim: c.aim?.mode === "actor" ? { mode: "actor", actor: c.aim.actor, offset: c.aim.offset ? vec3(c.aim.offset) : null }
        : { mode: "point", keys: normPath({ keys: c.aim?.keys }, [0, 1.2, 0]).keys, curve: c.aim?.curve === "linear" ? "linear" : "smooth" },
      mount: c.mount?.actor ? { actor: c.mount.actor, offset: vec3(c.mount.offset, [0, 1.6, -3]), rotate: !!c.mount.rotate } : null,
      lens: normTrack(c.lens, 35), roll: normTrack(c.roll, 0),
    })),
    // note: shot description shown on the timeline, monitor and storyboard sheet
    cuts: (Array.isArray(p.cuts) ? p.cuts : []).map((c) => ({ t: num(c.t, 0), camera: c.camera, ...(typeof c.note === "string" && c.note.trim() && { note: c.note.trim().slice(0, 300) }) })).sort((a, b) => a.t - b.t),
    // custom props used by this project (runtime/assets.js), embedded so the file opens on any machine
    assets,
    // dialogue / subtitle lines: shown on the monitor, optionally burned into the export
    subtitles: (Array.isArray(p.subtitles) ? p.subtitles : [])
      .filter((x) => typeof x?.text === "string" && x.text.trim())
      .map((x) => ({ id: x.id || uid("s"), t: num(x.t, 0), dur: Math.max(0.2, num(x.dur, 2)), text: x.text.trim().slice(0, 200), ...(x.actor && { actor: x.actor }) }))
      .sort((a, b) => a.t - b.t),
    // audio clips: the sound itself lives in the browser (IndexedDB, js/audio.js), the project keeps placement only.
    // start: timeline second the clip begins; offset: seconds skipped at the head of the file; dur: file length
    audio: (Array.isArray(p.audio) ? p.audio : [])
      .filter((x) => x && typeof x.file === "string" && x.file)
      .map((x) => ({ id: x.id || uid("au"), name: String(x.name || x.file).slice(0, 80), file: String(x.file).slice(0, 200),
        start: num(x.start, 0), offset: Math.max(0, num(x.offset, 0)), dur: Math.max(0, num(x.dur, 0)),
        gain: Math.min(4, Math.max(0, num(x.gain, 1))), ...(x.muted && { muted: true }) })),
    groups: [],
  };
  for (const list of [out.actors, out.props, out.lights, out.cameras]) for (const e of list) if (!e.id) e.id = uid("e");
  // groups: entities selected and moved together; members that no longer exist are dropped
  const allIds = new Set([out.actors, out.props, out.lights, out.cameras].flatMap((l) => l.map((e) => e.id)));
  out.groups = (Array.isArray(p.groups) ? p.groups : [])
    .map((g) => ({ id: g.id || uid("g"), name: g.name || "群組", members: [...new Set((g.members || []).filter((id) => allIds.has(id)))] }))
    .filter((g) => g.members.length > 1);
  return out;
}

export function actionsFor(actor) {
  if (actor.kind === "human") return HUMAN_ACTIONS;
  return Object.fromEntries(Object.entries(ANIMAL_ACTIONS).filter(([, a]) => !a.types || a.types.includes(actor.preset)));
}

/**
 * Check a normalised project. errors break playback or references; warnings are worth a look.
 * Messages are Traditional Chinese for the UI and the SKILL checker.
 */
const standHeight = (a) => resolveBody(a.preset, a.body).height * (a.scale || 1);

export function validate(project) {
  const errors = [], warnings = [];
  const p = project;
  if (p.format !== FORMAT) errors.push(`format 必須是 "${FORMAT}"`);
  const ids = new Map();
  for (const list of [p.actors, p.props, p.lights, p.cameras]) for (const e of list) {
    if (ids.has(e.id)) errors.push(`id 重複：${e.id}`);
    ids.set(e.id, e);
  }
  const S = p.settings;
  if (!(S.width >= 16 && S.height >= 16)) errors.push("settings.width / height 不正確");
  if (!(S.fps >= 1 && S.fps <= 120)) errors.push("settings.fps 必須在 1 到 120 之間");
  if (!(S.duration > 0)) errors.push("settings.duration 必須大於 0");
  if (!LIGHTING[S.lighting]) errors.push(`未知的燈光預設：${S.lighting}（可用：${Object.keys(LIGHTING).join("、")}）`);
  warnings.push(...targetWarnings(targetOf(S), S));

  const lastKey = (path) => path.keys[path.keys.length - 1].t;
  const checkPath = (e, label) => {
    if (lastKey(e.path) > S.duration + 1e-6) warnings.push(`${label} 的路徑關鍵影格超出總長 ${S.duration} 秒`);
  };
  for (const a of p.actors) {
    const label = `角色「${a.name}」`;
    if (a.kind === "human" && !HUMAN_BODIES[a.preset]) errors.push(`${label} 未知的體型：${a.preset}（可用：${Object.keys(HUMAN_BODIES).join("、")}）`);
    if (a.kind === "animal" && !ANIMAL_TYPES[a.preset]) errors.push(`${label} 未知的動物：${a.preset}（可用：${Object.keys(ANIMAL_TYPES).join("、")}）`);
    checkPath(a, label);
    if (a.body != null) {
      if (typeof a.body !== "object" || Array.isArray(a.body)) errors.push(`${label} 的 body 要寫成 { "height": 1.7, "build": 1, "head": 1 }`);
      else if (a.kind !== "human") warnings.push(`${label} 動物沒有身形調整（body），改大小請用 scale`);
      else for (const [k, [lo, hi]] of Object.entries(BODY_LIMITS)) {
        const v = a.body[k];
        if (v != null && !(typeof v === "number" && v >= lo && v <= hi)) errors.push(`${label} 的身形 ${k} 要在 ${lo} 到 ${hi} 之間（目前 ${v}）`);
      }
    }
    if (a.gait != null) {
      const g = a.gait, [lo, hi] = AMP_RANGE;
      if (typeof g !== "object" || Array.isArray(g)) errors.push(`${label} 的 gait 要寫成 { "style": "tired", "amp": 1 }`);
      else if (a.kind !== "human") warnings.push(`${label} 動物沒有步態風格（gait），會被忽略`);
      else {
        if (g.style != null && !GAIT_STYLES[g.style]) errors.push(`${label} 未知的步態風格：${g.style}（可用：${Object.keys(GAIT_STYLES).join("、")}）`);
        if (g.amp != null && !(typeof g.amp === "number" && g.amp >= lo && g.amp <= hi)) errors.push(`${label} 的步態幅度 amp 要在 ${lo} 到 ${hi} 之間（目前 ${g.amp}）`);
      }
    }
    const badHands = (o, where) => {
      for (const v of [o?.l, o?.r]) if (v != null && !HAND_SHAPES[v]) errors.push(`${label}${where} 未知的手勢：${v}（可用：${Object.keys(HAND_SHAPES).join("、")}）`);
    };
    badHands(a.hands, "");
    const lib = actionsFor(a);
    for (const [track, clips] of [["actions", a.actions], ["upper", a.upper]]) {
      if (track === "upper" && clips.length && a.kind !== "human") errors.push(`${label} 只有人類角色有上半身動作軌`);
      for (const c of clips) {
        badHands(c.hands, ` 的片段 ${c.type}`);
        if (c.type === "pose") {
          if (!c.pose || typeof c.pose !== "object") errors.push(`${label} 的姿勢片段缺少 pose`);
          continue;
        }
        if (!lib[c.type]) errors.push(`${label} 未知的動作：${c.type}（可用：${Object.keys(lib).join("、")}）`);
        for (const [k, [, kind, options]] of Object.entries(lib[c.type]?.ui || {})) {
          const v = c.params?.[k];
          if (kind === "choice" && v != null && !options[v]) errors.push(`${label} 的動作 ${c.type} 的 ${k} 不認得：${v}（可用：${Object.keys(options).join("、")}）`);
        }
        if (c.start + c.dur > S.duration + 1e-6) warnings.push(`${label} 的動作 ${c.type} 超出總長`);
        if (lib[c.type]?.pair) {
          const w = p.actors.find((x) => x.id === c.params?.with);
          if (!w || w === a || w.kind !== "human") warnings.push(`${label} 的動作 ${c.type} 沒有對象（params.with 要填另一個人類角色的 id），會對著假想的同體型角色做`);
          else {
            // past about 1.8x the taller one would have to crouch, which these actions do not do (a05 spike)
            const Ha = standHeight(a), Hb = standHeight(w);
            if (Ha >= Hb && Ha / Hb > 1.8) warnings.push(`${label} 和「${w.name}」身高差 ${(Ha / Hb).toFixed(1)} 倍，${c.type} 的手可能對不上或穿過身體（1.8 倍內才準）`);
          }
        }
      }
    }
    for (const g of a.gaze) {
      const at = `${label} 在 ${g.start} 秒的視線`;
      if (g.actor != null) {
        const w = p.actors.find((x) => x.id === g.actor);
        if (!w) errors.push(`${at} 看的角色不存在：${g.actor}`);
        else if (w === a) errors.push(`${at} 不能看自己`);
      } else if (g.point != null) {
        if (!(Array.isArray(g.point) && g.point.length === 3 && g.point.every((x) => typeof x === "number" && isFinite(x)))) errors.push(`${at} 的 point 要寫成 [x, y, z]`);
      } else errors.push(`${at} 沒有對象（填 actor 角色 id，或 point [x, y, z]）`);
      if (g.start + g.dur > S.duration + 1e-6) warnings.push(`${at} 超出總長`);
    }
  }
  const assetIds = new Set();
  for (const a of p.assets) {
    const label = `自訂物品「${a?.label || a?.id || "?"}」`;
    for (const e of validateAsset(a)) errors.push(`${label} ${e}`);
    if (assetIds.has(a?.id)) errors.push(`自訂物品 id 重複：${a.id}`);
    assetIds.add(a?.id);
  }
  for (const o of p.props) {
    const label = `物品「${o.name}」`;
    if (!propDef(o.type, p.assets)) errors.push(`${label} 未知的物品類型：${o.type}（內建物品之外的類型要放在 assets 裡）`);
    checkPath(o, label);
    for (const s of attachList(o)) {
      const host = ids.get(s.actor);
      if (!host || !p.actors.includes(host)) errors.push(`${label} 附著的角色不存在：${s.actor}`);
      else if (host.kind === "human" && s.joint && s.joint !== "root" && !HUMAN_JOINTS.includes(s.joint)) errors.push(`${label} 附著的關節不存在：${s.joint}`);
    }
    if (o.state != null) {
      const vals = Array.isArray(o.state) ? o.state.map((k) => k.v) : [o.state];
      if (!STATE_TYPES[o.type]) warnings.push(`${label} 的 state 只對門、電風扇、電梯有作用，這個類型會忽略`);
      else if (vals.some((v) => typeof v !== "number" || v < 0 || v > 1)) warnings.push(`${label} 的 state 數值要在 0 到 1 之間，超出的部分以 0 或 1 計`);
    }
    const segs = attachList(o);
    for (let i = 1; i < segs.length; i++) {
      if ((segs[i - 1].to ?? Infinity) > (segs[i].from ?? -Infinity) + 1e-3) warnings.push(`${label} 的附著時段重疊（第 ${i} 段結束要早於第 ${i + 1} 段開始），重疊時用前一段`);
    }
  }
  // aim and mount follow actors only (props have no evaluated pose to aim at)
  const actorIds = new Set(p.actors.map((a) => a.id));
  for (const l of p.lights) if (l.aim?.actor && !actorIds.has(l.aim.actor)) errors.push(`燈光「${l.name}」對準的角色不存在：${l.aim.actor}`);
  for (const c of p.cameras) {
    const label = `攝影機「${c.name}」`;
    checkPath(c, label);
    if (c.aim.mode === "actor" && !actorIds.has(c.aim.actor)) errors.push(`${label} 對準的角色不存在：${c.aim.actor}（對準物品請用 mode "point"）`);
    if (c.mount && !actorIds.has(c.mount.actor)) errors.push(`${label} 跟隨的角色不存在：${c.mount.actor}`);
  }
  if (!p.cameras.length) warnings.push("場景沒有攝影機，導演台與輸出會用預設視角");
  for (const cut of p.cuts) if (!p.cameras.some((c) => c.id === cut.camera)) errors.push(`剪接點 ${cut.t} 秒指向不存在的攝影機：${cut.camera}`);
  for (const x of p.subtitles) {
    if (x.actor && !actorIds.has(x.actor)) warnings.push(`字幕「${x.text.slice(0, 12)}」的說話角色不存在：${x.actor}`);
    if (x.t + x.dur > S.duration + 1e-6) warnings.push(`字幕「${x.text.slice(0, 12)}」超出總長`);
  }
  if (!errors.length) warnings.push(...terrainWarnings(p));
  return { errors, warnings };
}

export function emptyProject() {
  return normalize({
    name: "未命名場景",
    cameras: [{ id: "cam1", name: "A 機", path: { keys: [{ t: 0, v: [3.5, 1.6, 6] }] }, aim: { mode: "point", keys: [{ t: 0, v: [0, 1, 0] }] }, lens: 35 }],
    cuts: [{ t: 0, camera: "cam1" }],
  });
}
