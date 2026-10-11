// Picture files for the ground image (floor plan under the scene) and the backdrop (flat picture or 360 panorama).
// Like sound files they stay in this browser's IndexedDB; the project keeps only the file name.
import { toast } from "./ui.js";

const DB_NAME = "blockingpro-images", STORE = "files";
export const isImageFile = (f) => /^image\/(png|jpeg|webp|gif)$/.test(f.type) || /\.(png|jpe?g|webp|gif)$/i.test(f.name);

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

const loaded = new Map(); // file name -> HTMLImageElement
const pending = new Map(); // file name -> Promise<HTMLImageElement | null>
const warned = new Set();
const listeners = new Set();
export const onImageReady = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

function decode(blob) {
  const url = URL.createObjectURL(blob), img = new Image();
  img.src = url;
  return img.decode().then(() => img).finally(() => URL.revokeObjectURL(url));
}

/** Store a picture under its name (the project refers to it by name) and decode it */
export async function storeImage(file) {
  const img = await decode(file);
  await tx("readwrite", (s) => s.put(file, file.name));
  loaded.set(file.name, img);
  pending.delete(file.name);
  warned.delete(file.name);
  for (const fn of listeners) fn(file.name);
  return img;
}

/** Decoded picture, or null while it loads or when this browser does not have it (listeners fire once it is ready) */
export function getImage(name) {
  if (!name) return null;
  if (loaded.has(name)) return loaded.get(name);
  if (!pending.has(name)) {
    pending.set(name, tx("readonly", (s) => s.get(name)).then(async (blob) => {
      if (!blob) return null;
      const img = await decode(blob);
      loaded.set(name, img);
      for (const fn of listeners) fn(name);
      return img;
    }).catch((err) => {
      console.error(`BlockingPRO: 讀取圖片「${name}」失敗`, err);
      return null;
    }));
  }
  return null;
}

/** File names of the pictures a project uses */
export function imageNames(project) {
  const S = project.settings || {};
  return [S.ground?.image?.file, S.backdrop?.file].filter(Boolean);
}

/** Tell the user once per picture that this browser does not have */
export async function ensureImages(project) {
  const missing = [];
  for (const n of imageNames(project)) {
    getImage(n);
    if (!(await pending.get(n)) && !loaded.has(n) && !warned.has(n)) { warned.add(n); missing.push(n); }
  }
  if (missing.length) toast(`圖片不在這台電腦的瀏覽器裡：${missing.join("、")}。請在右側「環境」重新選擇，或把圖片和專案放在同一個資料夾一起開啟。`, "warn", 9000);
}

/** Store the pictures in a dropped folder that the project refers to; returns their names */
export async function linkImageFiles(project, files) {
  const wanted = new Set(imageNames(project)), linked = [];
  for (const f of files) {
    if (!wanted.has(f.name)) continue;
    try { await storeImage(f); linked.push(f.name); } catch (err) {
      console.error(`BlockingPRO: 資料夾裡的圖片「${f.name}」無法讀取`, err);
      toast(`資料夾裡的「${f.name}」無法讀取：${err.message || err}`, "err", 7000);
    }
  }
  return linked;
}

/** Ask for one picture file and store it; resolves to its name, or null when cancelled or unreadable */
export function pickImage() {
  return new Promise((done) => {
    const input = Object.assign(document.createElement("input"), { type: "file", accept: "image/png,image/jpeg,image/webp,image/gif" });
    input.style.display = "none";
    input.addEventListener("cancel", () => { input.remove(); done(null); });
    input.addEventListener("change", async () => {
      const f = input.files[0];
      input.remove();
      if (!f) return done(null);
      try { await storeImage(f); done(f.name); } catch (err) {
        console.error(`BlockingPRO: 圖片「${f.name}」無法讀取`, err);
        toast(`「${f.name}」無法讀取，請改用 PNG 或 JPG：${err.message || err}`, "err", 7000);
        done(null);
      }
    });
    document.body.append(input);
    input.click();
  });
}
