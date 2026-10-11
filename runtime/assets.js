// Custom props: assets made of primitive parts. They live in the tool's library (library/assets.json)
// and are embedded in every project that uses them (project.assets), so a project opens anywhere.
// Same conventions as props.js: meters, Y up, origin on the floor at the footprint center, front faces +Z.
// A part is a shape with its size fields, pos = part center, rot = degrees (Euler XYZ), optional scale,
// color (null follows the prop color, so recoloring an instance recolors those parts), glow and opacity.
// An asset can instead be an imported GLB / OBJ file (model, see models.js); then parts is empty.
import * as THREE from "three";
import { PROPS, PROP_CATS, kit, mat, grip } from "./props.js";
import { buildModel, MODEL_EXT } from "./models.js";

const D2R = Math.PI / 180;
export const ASSET_PACK_FORMAT = "blockingpro-assets";
export const LIBRARY_FORMAT = "blockingpro-library";
export const MAX_PARTS = 300;
export const ID_PATTERN = /^[a-z][a-z0-9_-]{1,39}$/;
const LIMIT = 50; // meters, largest size or offset accepted for a part

/** Shape → label and size fields with their defaults (used by the editor when adding a part). */
export const ASSET_SHAPES = {
  box: { label: "方塊", dims: { size: [0.3, 0.3, 0.3] } },
  cylinder: { label: "圓柱", dims: { radius: 0.1, height: 0.3 } },
  cone: { label: "圓錐", dims: { radius: 0.1, height: 0.3 } },
  sphere: { label: "球", dims: { radius: 0.1 } },
  capsule: { label: "膠囊", dims: { radius: 0.05, height: 0.3 } },
  torus: { label: "圓環", dims: { radius: 0.15, tube: 0.03, arc: 360 } },
};

/** Common hold rotations in the hand frame (see props.js header). */
export const HOLD_PRESETS = {
  upright: { label: "直立握（杯子、瓶子、手提物）", rot: [0, 0, 0] },
  point: { label: "朝手指方向（槍、手電筒、遙控器）", rot: [90, 0, 0] },
  hang: { label: "往下垂（刀、棍子、球拍）", rot: [180, 0, 0] },
};

const isNum = (x) => typeof x === "number" && Number.isFinite(x);
const isVec3 = (v) => Array.isArray(v) && v.length === 3 && v.every(isNum);
export const isColor = (c) => typeof c === "string" && /^#[0-9a-f]{6}$/i.test(c);
const isObj = (x) => !!x && typeof x === "object" && !Array.isArray(x);
const pos = (x, d) => (isNum(x) && x > 0 ? x : d);
const fmt = (x) => (Math.round(x * 100) / 100).toString();

/** Fill missing fields only; wrong values stay so validateAsset can name them. */
export function normalizePart(p) {
  if (!isObj(p)) return p;
  const out = { shape: p.shape ?? "box" };
  if (p.name) out.name = String(p.name);
  for (const [k, d] of Object.entries(ASSET_SHAPES[out.shape]?.dims || {})) out[k] = p[k] ?? (Array.isArray(d) ? d.slice() : d);
  if (out.shape === "cylinder" && p.radiusTop != null) out.radiusTop = p.radiusTop;
  out.pos = p.pos ?? [0, 0, 0];
  out.rot = p.rot ?? [0, 0, 0];
  if (p.scale != null) out.scale = p.scale;
  out.color = p.color ?? null;
  if (p.glow) out.glow = p.glow;
  if (p.opacity != null && p.opacity !== 1) out.opacity = p.opacity;
  return out;
}

export function normalizeAsset(a) {
  if (!isObj(a)) return a;
  const out = { id: a.id, label: a.label ?? a.name ?? a.id, cat: a.cat ?? "small", color: a.color ?? "#b0b0b0" };
  if (a.desc) out.desc = String(a.desc);
  if (a.hold) out.hold = { grip: a.hold.grip ?? [0, 0, 0], rot: a.hold.rot ?? [0, 0, 0] };
  if (isObj(a.model)) {
    const m = a.model;
    out.model = { file: m.file, unit: m.unit ?? 1, yaw: m.yaw ?? 0, size: m.size, look: m.look ?? "white" };
  }
  out.parts = Array.isArray(a.parts) ? a.parts.map(normalizePart) : out.model && a.parts == null ? [] : a.parts;
  return out;
}

function validateModel(m) {
  const e = [];
  if (typeof m.file !== "string" || !MODEL_EXT.test(m.file) || /[\\/]/.test(m.file)) e.push("model.file 要是 .glb 或 .obj 的檔名（不含資料夾）");
  if (!(isNum(m.unit) && m.unit > 0 && m.unit <= 100)) e.push("model.unit 要是大於 0 的數字（檔案裡 1 單位等於幾公尺：公尺 1、公分 0.01、毫米 0.001）");
  if (!isNum(m.yaw)) e.push("model.yaw 要是角度數字");
  if (!(isVec3(m.size) && m.size.every((x) => x > 0 && x <= 200))) e.push("model.size 要是 3 個大於 0 的數字 [寬, 高, 深]（公尺）");
  if (m.look !== "white" && m.look !== "original") e.push("model.look 要是 white（白模）或 original（原始材質）");
  return e;
}

function validatePart(p) {
  if (!isObj(p)) return ["不是物件"];
  if (!ASSET_SHAPES[p.shape]) return [`shape「${p.shape}」不支援（可用：${Object.keys(ASSET_SHAPES).join("、")}）`];
  const e = [];
  const size = (k, v) => { if (!(isNum(v) && v > 0 && v <= LIMIT)) e.push(`${k} 要是大於 0、最多 ${LIMIT} 的數字（公尺）`); };
  if (p.shape === "box") {
    if (!(isVec3(p.size) && p.size.every((x) => x > 0 && x <= LIMIT))) e.push("size 要是 3 個大於 0 的數字 [寬 x, 高 y, 深 z]（公尺）");
  } else size("radius", p.radius);
  if ("height" in ASSET_SHAPES[p.shape].dims) size("height", p.height);
  if (p.shape === "cylinder" && p.radiusTop != null && !(isNum(p.radiusTop) && p.radiusTop >= 0 && p.radiusTop <= LIMIT)) e.push("radiusTop 要是 0 以上的數字（公尺）");
  if (p.shape === "torus") {
    size("tube", p.tube);
    if (!(isNum(p.arc) && p.arc > 0 && p.arc <= 360)) e.push("arc 要是 1 到 360 的角度");
  }
  if (!(isVec3(p.pos) && p.pos.every((x) => Math.abs(x) <= LIMIT))) e.push("pos 要是 3 個數字 [x, y, z]（零件中心，公尺）");
  if (!isVec3(p.rot)) e.push("rot 要是 3 個數字 [x, y, z]（角度）");
  if (p.scale != null && !(isVec3(p.scale) && p.scale.every((x) => x > 0 && x <= 100))) e.push("scale 要是 3 個大於 0 的數字");
  if (p.color != null && !isColor(p.color)) e.push(`color「${p.color}」要用 #rrggbb 格式，或寫 null 跟著物品顏色`);
  if (p.glow != null && !(isNum(p.glow) && p.glow >= 0 && p.glow <= 2)) e.push("glow 要是 0 到 2 的數字");
  if (p.opacity != null && !(isNum(p.opacity) && p.opacity >= 0.05 && p.opacity <= 1)) e.push("opacity 要是 0.05 到 1 的數字");
  return e;
}

/** Errors that stop an asset from being saved or imported, in Traditional Chinese. */
export function validateAsset(a) {
  if (!isObj(a)) return ["不是物件（應該是 { \"id\": ..., \"label\": ..., \"parts\": [...] }）"];
  const e = [];
  if (typeof a.id !== "string" || !ID_PATTERN.test(a.id)) e.push(`id「${a.id ?? ""}」格式不對：小寫英文字母開頭，只用小寫英文、數字、- 和 _，2 到 40 字`);
  else if (PROPS[a.id]) e.push(`id「${a.id}」和內建物品重複，請換一個`);
  if (typeof a.label !== "string" || !a.label.trim()) e.push("缺少 label（顯示名稱）");
  else if (a.label.length > 30) e.push("label 太長（最多 30 字）");
  if (!PROP_CATS[a.cat]) e.push(`cat「${a.cat}」不對（可用：${Object.keys(PROP_CATS).join("、")}）`);
  if (!isColor(a.color)) e.push(`color「${a.color}」要用 #rrggbb 格式`);
  if (a.hold != null) {
    if (!isVec3(a.hold.grip)) e.push("hold.grip 要是 3 個數字 [x, y, z]（握點，公尺）");
    if (!isVec3(a.hold.rot)) e.push("hold.rot 要是 3 個數字 [x, y, z]（角度）");
  }
  if (a.model != null) {
    e.push(...(isObj(a.model) ? validateModel(a.model) : ["model 要是物件"]));
    if (!Array.isArray(a.parts) || a.parts.length) e.push("模型物品的 parts 要是空陣列 []");
  } else if (!Array.isArray(a.parts) || !a.parts.length) e.push("parts 至少要有 1 個零件");
  else if (a.parts.length > MAX_PARTS) e.push(`零件太多（${a.parts.length} 個，上限 ${MAX_PARTS}）`);
  else a.parts.forEach((p, i) => { for (const msg of validatePart(p)) e.push(`第 ${i + 1} 個零件：${msg}`); });
  return e.length > 12 ? [...e.slice(0, 12), `另有 ${e.length - 12} 個錯誤未列出`] : e;
}

function partGeometry(k, p) {
  if (!isObj(p)) return null;
  const r = pos(p.radius, 0.1), h = pos(p.height, 0.3);
  switch (p.shape) {
    case "box": {
      const s = isVec3(p.size) ? p.size.map((x) => pos(x, 0.3)) : [0.3, 0.3, 0.3];
      return k.geo(`b${s}`, () => new THREE.BoxGeometry(s[0], s[1], s[2]));
    }
    case "cylinder": {
      const rt = isNum(p.radiusTop) && p.radiusTop >= 0 ? p.radiusTop : r;
      return k.geo(`c${rt},${r},${h}`, () => new THREE.CylinderGeometry(rt, r, h, 20));
    }
    case "cone": return k.geo(`k${r},${h}`, () => new THREE.ConeGeometry(r, h, 20));
    case "sphere": return k.geo(`s${r}`, () => new THREE.SphereGeometry(r, 20, 14));
    case "capsule": return k.geo(`p${r},${h}`, () => new THREE.CapsuleGeometry(r, Math.max(0, h - 2 * r), 6, 16));
    case "torus": {
      const t = pos(p.tube, 0.03), arc = isNum(p.arc) ? Math.min(360, Math.max(1, p.arc)) : 360;
      return k.geo(`t${r},${t},${arc}`, () => new THREE.TorusGeometry(r, t, 10, 28, arc * D2R));
    }
    default: return null;
  }
}

/**
 * Build the asset's mesh group. Tolerates invalid values (they fall back to defaults) so a bad import still shows.
 * model: the parsed file for a model asset (null while it is not loaded: a placeholder box is shown).
 */
export function buildAsset(a, color, model = null) {
  const base = isColor(color) ? color : isColor(a.color) ? a.color : "#b0b0b0";
  if (isObj(a.model)) return buildModel(a.model, base, model);
  const k = kit(a.id);
  const mats = new Map();
  const material = (p) => {
    const c = isColor(p.color) ? p.color : base;
    const glow = isNum(p.glow) ? Math.min(2, Math.max(0, p.glow)) : 0;
    const op = isNum(p.opacity) ? Math.min(1, Math.max(0.05, p.opacity)) : 1;
    const key = `${c}|${glow}|${op}`;
    if (!mats.has(key)) {
      mats.set(key, mat(c, {
        ...(glow > 0 && { emissive: c, emissiveIntensity: glow }),
        ...(op < 1 && { transparent: true, opacity: op, depthWrite: false }),
      }));
    }
    return mats.get(key);
  };
  (Array.isArray(a.parts) ? a.parts : []).forEach((p, i) => {
    const g = partGeometry(k, p);
    if (!g) return;
    const o = k.mesh(g, material(p), isVec3(p.pos) ? p.pos : [0, 0, 0], isVec3(p.rot) ? p.rot : [0, 0, 0]);
    if (isVec3(p.scale)) o.scale.set(p.scale[0], p.scale[1], p.scale[2]);
    o.userData.part = i;
  });
  return k.group;
}

export function disposeObject(obj) {
  obj.traverse((o) => {
    if (!o.isMesh) return;
    o.geometry.dispose();
    for (const m of [].concat(o.material)) m.dispose();
  });
}

/** Axis-aligned bounds of the built asset, or null when it has no parts. */
export function assetBounds(a) {
  if (isObj(a.model) && isVec3(a.model.size)) {
    const [x, y, z] = a.model.size;
    return new THREE.Box3(new THREE.Vector3(-x / 2, 0, -z / 2), new THREE.Vector3(x / 2, y, z / 2));
  }
  const g = buildAsset(a);
  const box = g.children.length ? new THREE.Box3().setFromObject(g) : null;
  disposeObject(g);
  return box;
}

/** Things worth a look that do not block saving: floating, off-center, odd scale, many parts. */
export function assetWarnings(a) {
  const b = assetBounds(a);
  if (!b) return [];
  const w = [];
  const size = b.getSize(new THREE.Vector3());
  if (b.min.y > 0.03) w.push(`最低點離地 ${fmt(b.min.y)} 公尺，放進場景會浮在空中（原點要在物品底部，懸掛物也一樣，高度在場景裡調）`);
  if (b.min.y < -0.03) w.push(`最低點在地面下 ${fmt(-b.min.y)} 公尺，放進場景會陷進地面`);
  const cx = (b.min.x + b.max.x) / 2, cz = (b.min.z + b.max.z) / 2;
  if (Math.abs(cx) > Math.max(0.05, size.x * 0.25) || Math.abs(cz) > Math.max(0.05, size.z * 0.25)) {
    w.push(`底面中心偏離原點（x ${fmt(cx)}、z ${fmt(cz)}），旋轉時會繞著別的點轉`);
  }
  const big = Math.max(size.x, size.y, size.z);
  if (big > 40) w.push(`尺寸很大（${fmt(size.x)} x ${fmt(size.y)} x ${fmt(size.z)} 公尺），確認單位是公尺`);
  if (big < 0.02) w.push("尺寸不到 2 公分，確認單位是公尺");
  if (a.model) return w;
  if (a.parts.length > 80) w.push(`零件 ${a.parts.length} 個，偏多（建議 60 個以內，太多會拖慢編輯器）`);
  return w;
}

const defCache = new Map();

/** Resolve a prop type: a built-in prop, else a custom asset from the project's assets list. */
export function propDef(type, assets) {
  if (PROPS[type]) return PROPS[type];
  const a = Array.isArray(assets) ? assets.find((x) => isObj(x) && x.id === type) : null;
  if (!a) return null;
  const sig = JSON.stringify(a);
  let def = defCache.get(sig);
  if (!def) {
    def = {
      label: typeof a.label === "string" && a.label ? a.label : a.id,
      cat: PROP_CATS[a.cat] ? a.cat : "small",
      color: isColor(a.color) ? a.color : "#b0b0b0",
      hold: a.hold && isVec3(a.hold.grip) && isVec3(a.hold.rot) ? grip(a.hold.grip, a.hold.rot) : null,
      custom: true, asset: a, sig, model: isObj(a.model) ? a.model.file : null,
      build: (c, model) => buildAsset(a, c, model),
    };
    if (defCache.size > 200) defCache.clear();
    defCache.set(sig, def);
  }
  return def;
}

/** Which asset list a parsed JSON value carries: a project, a pack or library file, a bare list or one asset. */
export function readAssets(data) {
  if (Array.isArray(data)) return { kind: "list", assets: data };
  if (isObj(data) && data.format === "blockingpro") return { kind: "project", assets: Array.isArray(data.assets) ? data.assets : [] };
  if (isObj(data) && Array.isArray(data.assets)) return { kind: "pack", assets: data.assets };
  if (isObj(data) && "parts" in data) return { kind: "asset", assets: [data] };
  return { kind: null, assets: [], error: "找不到物品資料：需要含 parts 的物品、物品陣列，或 { \"format\": \"blockingpro-assets\", \"assets\": [...] }" };
}

/** Parse text pasted from a chat AI: strips ``` fences and text around the JSON, forgives trailing commas. */
export function parseAssetText(text) {
  let s = String(text ?? "").trim();
  const fence = s.match(/```[a-z]*\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  const i = s.search(/[[{]/), j = Math.max(s.lastIndexOf("}"), s.lastIndexOf("]"));
  if (i < 0 || j < i) return { kind: null, assets: [], error: "找不到 JSON（應該以 { 或 [ 開頭）" };
  s = s.slice(i, j + 1);
  let data;
  try {
    data = JSON.parse(s);
  } catch (err) {
    try {
      data = JSON.parse(s.replace(/,\s*([}\]])/g, "$1"));
    } catch {
      return { kind: null, assets: [], error: `JSON 格式錯誤：${err.message}` };
    }
  }
  return { ...readAssets(data), data };
}

export function makeAssetPack(assets, name = "") {
  return { format: ASSET_PACK_FORMAT, version: 1, ...(name && { name }), assets };
}

/** First free id built from base: base, base_2, base_3 ... */
export function uniqueAssetId(base, taken) {
  const has = (id) => PROPS[id] || taken.has(id);
  const root = (ID_PATTERN.test(base) ? base : "item").replace(/_\d+$/, "").slice(0, 34);
  if (!has(root)) return root;
  for (let n = 2; ; n++) if (!has(`${root}_${n}`)) return `${root}_${n}`;
}
