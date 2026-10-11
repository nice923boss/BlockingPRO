// The custom prop library on this machine: library/assets.json, read and written through tools/serve.py (/api/assets).
// Projects keep their own copy of the assets they use (project.assets); the library is where new ones are picked from.
import { LIBRARY_FORMAT, normalizeAsset, validateAsset } from "../runtime/assets.js";
import { h, toast, modal } from "./ui.js";

const API = "api/assets";
// static hosting (GitHub Pages) has no /api: the library then lives in this browser, first filled from the published file
const LOCAL_KEY = "blockingpro.assetLibrary";
const SEED = "library/assets.json";
const listeners = new Set();
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export const assetLib = {
  assets: [],
  ready: false,
  error: null,
  local: false, // true when there is no server: saved to localStorage instead of library/assets.json

  subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  emit() { for (const fn of listeners) fn(); },
  get(id) { return this.assets.find((a) => a.id === id) || null; },

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
      this.assets = (Array.isArray(data.assets) ? data.assets : []).map(normalizeAsset);
      this.error = null;
    } catch (err) {
      console.error("BlockingPRO: 素材庫讀取失敗", err);
      this.error = `讀不到自訂物品庫（${err.message}）。請用 start.bat 啟動 BlockingPRO，自訂物品才能存檔。`;
    }
    this.ready = true;
    this.emit();
  },

  /** Write the whole list; the in-memory list only changes when the file was written. */
  async save(next) {
    const body = JSON.stringify({ format: LIBRARY_FORMAT, version: 1, assets: next });
    try {
      if (this.local) localStorage.setItem(LOCAL_KEY, body);
      else {
        const r = await fetch(API, { method: "PUT", headers: { "Content-Type": "application/json" }, body });
        const data = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
      }
    } catch (err) {
      console.error("BlockingPRO: 素材庫寫入失敗", err);
      toast(`自訂物品庫存檔失敗：${err.message}。請確認是用 start.bat 啟動。`, "err", 6000);
      return false;
    }
    this.assets = next;
    this.error = null;
    this.emit();
    return true;
  },

  upsert(asset) {
    const i = this.assets.findIndex((a) => a.id === asset.id);
    return this.save(i < 0 ? [...this.assets, asset] : this.assets.map((a, j) => (j === i ? asset : a)));
  },

  remove(id) { return this.save(this.assets.filter((a) => a.id !== id)); },

  /**
   * Add imported assets: new ids go in, identical ones are skipped, a changed one with a known id asks first.
   * Returns { added, updated, skipped, invalid: [{ label, errors }] } or null when the library could not be written.
   */
  async mergeImported(list, source = "匯入") {
    const res = { added: [], updated: [], skipped: [], invalid: [] };
    const incoming = new Map();
    for (const raw of list) {
      const a = normalizeAsset(raw);
      const errors = validateAsset(a);
      if (errors.length) res.invalid.push({ label: a?.label || a?.id || "（未命名）", errors });
      else incoming.set(a.id, a);
    }
    const changed = [];
    for (const a of incoming.values()) {
      const old = this.get(a.id);
      if (!old) res.added.push(a);
      else if (same(old, a)) res.skipped.push(a);
      else changed.push(a);
    }
    if (changed.length) {
      const overwrite = await askOverwrite(changed, source);
      (overwrite ? res.updated : res.skipped).push(...changed);
    }
    if (res.added.length || res.updated.length) {
      const replace = new Map(res.updated.map((a) => [a.id, a]));
      const ok = await this.save([...this.assets.map((a) => replace.get(a.id) || a), ...res.added]);
      if (!ok) return null;
    }
    return res;
  },
};

function askOverwrite(list, source) {
  return new Promise((done) => {
    modal("自訂物品名稱重複", h("div", {},
      h("p", {}, `${source}裡有 ${list.length} 個自訂物品和素材庫裡同 id 但內容不同：`),
      h("div", { class: "list" }, list.map((a) => h("div", { class: "li" }, h("span", { class: "grow" }, `${a.label}（${a.id}）`)))),
      h("p", { class: "note" }, "覆蓋：素材庫改成這次匯入的版本。保留：素材庫維持原本的版本。已經用到這些物品的專案不受影響（專案裡各自存了一份）。")), [
      { label: "保留素材庫原本的", onClick: (c) => { c(); done(false); } },
      { label: "覆蓋", primary: true, onClick: (c) => { c(); done(true); } },
    ], { sticky: true });
  });
}

/** One-line toast for a merge result, plus a dialog listing invalid entries. */
export function reportMerge(res, source = "匯入") {
  if (!res) return;
  const parts = [];
  if (res.added.length) parts.push(`新增 ${res.added.length} 個`);
  if (res.updated.length) parts.push(`更新 ${res.updated.length} 個`);
  if (res.skipped.length) parts.push(`${res.skipped.length} 個已在素材庫`);
  if (res.added.length || res.updated.length) toast(`${source}：自訂物品${parts.join("、")}`);
  if (!res.invalid.length) return;
  modal(`${res.invalid.length} 個自訂物品沒有匯入`, h("div", {},
    h("p", { class: "note" }, "下面的錯誤可以整段複製，貼回給產生這些物品的 AI，請它修正後重新輸出。"),
    h("textarea", { class: "code", rows: 12, readonly: true, value: res.invalid.map((x) => `自訂物品「${x.label}」：\n${x.errors.map((e) => `- ${e}`).join("\n")}`).join("\n\n") })));
}
