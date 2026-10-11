// The pose library on this machine: library/poses.json, read and written through tools/serve.py (/api/poses).
// Every project sees the same list. An entry keeps the authored pose of a pose clip ({ rot, hips }, see runtime/pose.js)
// and which rig it was made on: "human" for every human body type, the animal type otherwise.
import { toast } from "./ui.js";

const API = "api/poses";
// static hosting (GitHub Pages) has no /api: the library then lives in this browser, first filled from the published file
const LOCAL_KEY = "blockingpro.poseLibrary";
const SEED = "library/poses.json";
export const POSE_FORMAT = "blockingpro-poses";
const listeners = new Set();
const clone = (o) => JSON.parse(JSON.stringify(o));

/** "human" for people (all body types share one skeleton), the animal type ("dog", "bird") for animals */
export const rigKey = (rig) => (rig.kind === "animal" ? rig.type : "human");

/** A pose fits a rig made the same way: same rig key and every rotated joint exists on it */
export const fits = (entry, rig) => entry.rig === rigKey(rig) && Object.keys(entry.pose?.rot || {}).every((j) => rig.jointNames.includes(j));

export const poseLib = {
  poses: [],
  error: null,
  local: false, // true when there is no server: saved to localStorage instead of library/poses.json

  subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  emit() { for (const fn of listeners) fn(); },

  async load() {
    try {
      let r = await fetch(API, { cache: "no-store" });
      if (r.status === 404) {
        this.local = true;
        const saved = localStorage.getItem(LOCAL_KEY);
        r = saved ? new Response(saved) : await fetch(SEED, { cache: "no-store" });
      }
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
      this.poses = (Array.isArray(data.poses) ? data.poses : []).filter((p) => p?.id && p.pose?.rot && typeof p.rig === "string");
      this.error = null;
    } catch (err) {
      console.error("BlockingPRO: 姿勢庫讀取失敗", err);
      this.error = `讀不到姿勢庫（${err.message}）。請用 start.bat 啟動 BlockingPRO，姿勢庫才能存檔。`;
    }
    this.emit();
  },

  /** Write the whole list; the in-memory list only changes when the file was written. */
  async save(next) {
    const body = JSON.stringify({ format: POSE_FORMAT, version: 1, poses: next });
    try {
      if (this.local) localStorage.setItem(LOCAL_KEY, body);
      else {
        const r = await fetch(API, { method: "PUT", headers: { "Content-Type": "application/json" }, body });
        const data = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
      }
    } catch (err) {
      console.error("BlockingPRO: 姿勢庫寫入失敗", err);
      toast(`姿勢庫存檔失敗：${err.message}。請確認是用 start.bat 啟動。`, "err", 6000);
      return false;
    }
    this.poses = next;
    this.error = null;
    this.emit();
    return true;
  },

  /** Save a pose under a name; the same name on the same rig is replaced */
  add(name, rig, pose) {
    const entry = { id: `pose${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, name, rig: rigKey(rig), pose: clone(pose) };
    const old = this.poses.find((p) => p.name === name && p.rig === entry.rig);
    return this.save(old ? this.poses.map((p) => (p === old ? { ...entry, id: old.id } : p)) : [...this.poses, entry]);
  },

  remove(id) { return this.save(this.poses.filter((p) => p.id !== id)); },
};
