// Imported model files (p06) for custom props made from a GLB or OBJ. Like pictures and sounds they stay in this
// browser's IndexedDB; the asset keeps only the file name (asset.model.file). Parsed models are cached by name.
import { toast } from "./ui.js";
import { parseModel, MODEL_EXT, MAX_MODEL_BYTES } from "../runtime/models.js";

const DB_NAME = "blockingpro-models", STORE = "files";
export const isModelFile = (f) => MODEL_EXT.test(f.name);

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

const loaded = new Map(); // file name -> parsed model
const pending = new Map(); // file name -> Promise<model | null>
const warned = new Set();
const listeners = new Set();
export const onModelReady = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

/** Parse a picked file without storing it (for the import dialog). Throws a readable message when it cannot be used. */
export async function readModelFile(file) {
  if (!isModelFile(file)) throw new Error("只支援 .glb 或 .obj 檔");
  if (file.size > MAX_MODEL_BYTES) throw new Error(`檔案太大（${(file.size / 1048576).toFixed(1)} MB，上限 ${MAX_MODEL_BYTES / 1048576} MB）`);
  return parseModel(file.name, await file.arrayBuffer());
}

/** Store a model file under its name; raw is the already parsed model (parsed here when left out) */
export async function storeModel(file, raw = null) {
  raw ||= await readModelFile(file);
  await tx("readwrite", (s) => s.put(file, file.name));
  loaded.set(file.name, raw);
  pending.delete(file.name);
  warned.delete(file.name);
  for (const fn of listeners) fn(file.name);
  return raw;
}

/** Parsed model, or null while it loads or when this browser does not have it (listeners fire once it is ready) */
export function getModel(name) {
  if (!name) return null;
  if (loaded.has(name)) return loaded.get(name);
  if (!pending.has(name)) {
    pending.set(name, tx("readonly", (s) => s.get(name)).then(async (blob) => {
      if (!blob) return null;
      const raw = await parseModel(name, await blob.arrayBuffer());
      loaded.set(name, raw);
      for (const fn of listeners) fn(name);
      return raw;
    }).catch((err) => {
      console.error(`BlockingPRO: 讀取模型「${name}」失敗`, err);
      return null;
    }));
  }
  return null;
}

/** File names of the model files these assets use */
export function modelNames(assets) {
  return [...new Set((assets || []).map((a) => a?.model?.file).filter(Boolean))];
}

/** Tell the user once per model file that this browser does not have */
export async function ensureModels(project) {
  const used = new Set(project.props.map((o) => o.type));
  const missing = [];
  for (const n of modelNames(project.assets.filter((a) => used.has(a.id)))) {
    getModel(n);
    if (!(await pending.get(n)) && !loaded.has(n) && !warned.has(n)) { warned.add(n); missing.push(n); }
  }
  if (missing.length) toast(`模型檔不在這台電腦的瀏覽器裡，先用半透明方塊代替：${missing.join("、")}。請把模型檔和專案放在同一個資料夾一起開啟，或在素材庫重新匯入。`, "warn", 9000);
}

/** Store the model files in a dropped folder that these assets refer to; returns their names */
export async function linkModelFiles(assets, files) {
  const wanted = new Set(modelNames(assets)), linked = [];
  for (const f of files) {
    if (!wanted.has(f.name)) continue;
    try { await storeModel(f); linked.push(f.name); } catch (err) {
      console.error(`BlockingPRO: 資料夾裡的模型「${f.name}」無法讀取`, err);
      toast(`資料夾裡的「${f.name}」無法讀取：${err.message || err}`, "err", 7000);
    }
  }
  return linked;
}
