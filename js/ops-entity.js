// Operations on several entities at once: multi-selection, delete / duplicate, groups, hide / lock,
// and copy / paste through localStorage so entities can move between projects.
import { uid, attachList, packAttach } from "../runtime/schema.js";
import { findEntity, selIds } from "./state.js";
import { dropEntity, uniqueName } from "./ops.js";
import { round, toast } from "./ui.js";

let S;
export function initEntityOps(store) { S = store; }

const CLIP_KEY = "blockingpro.clipboard";
const LISTS = ["actors", "props", "lights", "cameras"];
const PREFIX = { actors: "a", props: "o", lights: "l", cameras: "cam" };
let memClip = null; // used when localStorage is off (private window)

// ---------- selection ----------

/** Select ids; the primary (the one the panels show) defaults to the last one */
export function selectIds(ids, primary = ids[ids.length - 1]) {
  const list = [...new Set(ids)];
  if (list.length < 2) return S.select({ id: list[0] || null });
  S.select({ id: list.includes(primary) ? primary : list[list.length - 1], ids: list });
}

/** Ctrl+click: add ids to the selection, or take them out when all are already in */
export function toggleSelect(ids) {
  const cur = selIds(S.sel);
  const off = ids.every((id) => cur.includes(id));
  const next = off ? cur.filter((id) => !ids.includes(id)) : [...cur, ...ids.filter((id) => !cur.includes(id))];
  selectIds(next, off ? (next.includes(S.sel.id) ? S.sel.id : undefined) : ids[0]);
}

/** ids plus every member of the groups they belong to (ids keep their order in front) */
export function withGroups(p, ids) {
  const out = new Set(ids);
  for (const g of p.groups) if (g.members.some((m) => out.has(m))) g.members.forEach((m) => out.add(m));
  return [...out];
}

export const groupOf = (p, id) => p.groups.find((g) => g.members.includes(id)) || null;

// ---------- delete, duplicate ----------

export function deleteEntities(ids) {
  const list = ids.filter((id) => findEntity(S.project, id));
  if (!list.length) return;
  S.edit(`刪除 ${list.length} 個物件`, (p) => { for (const id of list) dropEntity(p, id); });
  S.select({});
}

/**
 * Deep copies with new ids. References between the copies follow them; a reference to an actor outside the copy
 * stays when that actor exists in p, otherwise it is cleared. Returns the new ids and the old to new id map.
 */
function insertCopies(p, items, { suffix = "", offset = 0 } = {}) {
  const map = new Map(items.map(({ list, spec }) => [spec.id, uid(PREFIX[list])]));
  const actorOk = (id) => map.has(id) || findEntity(p, id)?.list === "actors";
  const ref = (id) => map.get(id) || id;
  const ids = [];
  for (const { list, spec } of items) {
    const c = JSON.parse(JSON.stringify(spec));
    c.id = map.get(spec.id);
    c.name = uniqueName(p, spec.name + suffix);
    delete c.hidden;
    delete c.locked;
    if (offset && c.path) c.path.keys = c.path.keys.map((k) => ({ ...k, v: [round(k.v[0] + offset, 3), k.v[1], k.v[2]] }));
    for (const tr of ["actions", "upper"]) if (c[tr]) c[tr] = c[tr].map((x) => ({ ...x, id: uid("c") }));
    if (c.gaze) c.gaze = c.gaze.filter((g) => !g.actor || actorOk(g.actor)).map((g) => (g.actor ? { ...g, actor: ref(g.actor) } : g));
    if (c.attach) c.attach = packAttach(attachList(c).filter((s) => actorOk(s.actor)).map((s) => ({ ...s, actor: ref(s.actor) })));
    if (list === "lights" && c.aim?.actor) c.aim = actorOk(c.aim.actor) ? { ...c.aim, actor: ref(c.aim.actor) } : [0, 1, 0];
    if (list === "cameras") {
      if (c.aim?.mode === "actor") c.aim = actorOk(c.aim.actor) ? { ...c.aim, actor: ref(c.aim.actor) } : { mode: "point", keys: [{ t: 0, v: [0, 1, 0] }] };
      if (c.mount?.actor) c.mount = actorOk(c.mount.actor) ? { ...c.mount, actor: ref(c.mount.actor) } : null;
    }
    p[list].push(c);
    ids.push(c.id);
  }
  return { ids, map };
}

/** Groups whose members were all copied become groups of the copies */
function copyGroups(p, groups, map) {
  for (const g of groups) if (g.members.every((m) => map.has(m))) p.groups.push({ id: uid("g"), name: g.name, members: g.members.map((m) => map.get(m)) });
}

const itemsOf = (p, ids) => ids.map((id) => findEntity(p, id)).filter(Boolean).map(({ list, spec }) => ({ list, spec }));

export function duplicateEntities(ids) {
  const P = S.project, items = itemsOf(P, ids);
  if (!items.length) return;
  let made = [];
  S.edit(`複製 ${items.length} 個物件`, (p) => {
    const r = insertCopies(p, items, { suffix: " 複製", offset: 1 });
    copyGroups(p, P.groups, r.map);
    made = r.ids;
  });
  selectIds(made);
}

// ---------- copy / paste between projects ----------

export function copyEntities(ids) {
  const P = S.project, items = itemsOf(P, ids);
  if (!items.length) return;
  const types = new Set(items.filter((x) => x.list === "props").map((x) => x.spec.type));
  const set = new Set(ids);
  memClip = {
    format: "blockingpro-clip", version: 1, from: P.name, entities: items,
    assets: P.assets.filter((a) => types.has(a.id)),
    groups: P.groups.filter((g) => g.members.every((m) => set.has(m))),
  };
  try { localStorage.setItem(CLIP_KEY, JSON.stringify(memClip)); } catch (err) {
    console.warn("BlockingPRO: 剪貼簿無法寫入 localStorage，只能在這個分頁貼上", err);
  }
  toast(`已複製 ${items.length} 個物件（含路徑與動作），開啟其他專案後按 Ctrl+V 貼上`);
}

function readClip() {
  try { const t = localStorage.getItem(CLIP_KEY); if (t) return JSON.parse(t); } catch { /* storage off: memory copy */ }
  return memClip;
}

export function pasteEntities() {
  const data = readClip();
  const items = (data?.format === "blockingpro-clip" && Array.isArray(data.entities) ? data.entities : []).filter((x) => LISTS.includes(x?.list) && x.spec?.id);
  if (!items.length) { toast("剪貼簿是空的：先選取物件按 Ctrl+C", "warn"); return; }
  const P = S.project, assets = Array.isArray(data.assets) ? data.assets : [];
  // pasting into the project it came from: shift the copies so they do not sit on the originals
  const offset = items.some((x) => findEntity(P, x.spec.id)) ? 1 : 0;
  const clash = assets.filter((a) => P.assets.some((b) => b.id === a.id && JSON.stringify(b) !== JSON.stringify(a))).length;
  let made = [];
  S.edit(`貼上 ${items.length} 個物件`, (p) => {
    for (const a of assets) if (!p.assets.some((b) => b.id === a.id)) p.assets.push(a);
    const r = insertCopies(p, items, { offset });
    copyGroups(p, Array.isArray(data.groups) ? data.groups : [], r.map);
    made = r.ids;
  });
  selectIds(made);
  toast(`已貼上 ${made.length} 個物件${data.from && data.from !== P.name ? `（來自「${data.from}」）` : ""}`);
  if (clash) toast(`${clash} 個自訂物品和這個專案的物品同代號但內容不同，沿用這個專案的版本`, "warn", 6000);
}

// ---------- groups ----------

export function groupEntities(ids) {
  const list = ids.filter((id) => findEntity(S.project, id));
  if (list.length < 2) { toast("至少選兩個物件才能組成群組", "warn"); return; }
  S.edit("建立群組", (p) => {
    // one entity belongs to one group
    p.groups = p.groups.map((g) => ({ ...g, members: g.members.filter((m) => !list.includes(m)) })).filter((g) => g.members.length > 1);
    const names = new Set(p.groups.map((g) => g.name));
    let n = 1;
    while (names.has(`群組 ${n}`)) n++;
    p.groups.push({ id: uid("g"), name: `群組 ${n}`, members: list });
  });
  toast("已建立群組：在 3D 視窗點任一成員會選取整組");
}

export function ungroup(gid) {
  S.edit("解散群組", (p) => { p.groups = p.groups.filter((g) => g.id !== gid); });
}

export function renameGroup(gid, name) {
  if (!name) return;
  S.edit("群組改名", (p) => { p.groups = p.groups.map((g) => (g.id === gid ? { ...g, name } : g)); });
}

// ---------- hide / lock ----------

const FLAG = { hidden: ["隱藏", "取消隱藏"], locked: ["鎖定", "解除鎖定"] };

/** Set flag ("hidden" | "locked") on all ids, or clear it when every one already has it */
export function toggleFlag(ids, flag) {
  const list = ids.filter((id) => findEntity(S.project, id));
  if (!list.length) return;
  const on = !list.every((id) => findEntity(S.project, id).spec[flag]);
  S.edit(`${FLAG[flag][on ? 0 : 1]} ${list.length} 個物件`, (p) => {
    for (const id of list) {
      const spec = findEntity(p, id).spec;
      if (on) spec[flag] = true; else delete spec[flag];
    }
  });
}
