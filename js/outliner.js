// Scene list at the top of the right panel: search, collapsible sections per kind, groups,
// eye / lock toggles and Ctrl / Shift multi-selection.
import { h, toast, modal, row } from "./ui.js";
import { selIds } from "./state.js";
import { selectIds, toggleSelect, groupOf, ungroup, renameGroup, toggleFlag } from "./ops-entity.js";
import { HUMAN_BODIES } from "../runtime/rig-human.js";
import { ANIMAL_TYPES } from "../runtime/rig-animal.js";
import { propDef } from "../runtime/assets.js";

const KINDS = [["actors", "角色"], ["props", "物品"], ["lights", "燈光"], ["cameras", "攝影機"]];
const FOLD_KEY = "blockingpro.outliner.fold";

function typeLabel(list, e, P) {
  if (list === "actors") return (e.kind === "animal" ? ANIMAL_TYPES[e.preset] : HUMAN_BODIES[e.preset])?.label || "";
  if (list === "props") return propDef(e.type, P.assets)?.label || e.type;
  return "";
}

export class Outliner {
  constructor(el, store) {
    Object.assign(this, { el, store });
    this.query = "";
    this.anchor = null; // last plain / Ctrl click, for Shift ranges
    this.open = true;
    try { this.fold = new Set(JSON.parse(localStorage.getItem(FOLD_KEY) || "[]")); } catch { this.fold = new Set(); }
    this.title = h("b", {}, "場景清單");
    this.toggle = h("button", { class: "ol-fold", title: "收合／展開場景清單", onclick: () => { this.open = !this.open; this.el.classList.toggle("closed", !this.open); this.toggle.textContent = this.open ? "▾" : "▸"; } }, "▾");
    this.search = h("input", { type: "search", placeholder: "搜尋名稱或類型", oninput: (e) => { this.query = e.target.value.trim().toLowerCase(); this.renderBody(); } });
    this.body = h("div", { class: "ol-body" });
    el.append(h("div", { class: "ol-head" }, this.toggle, this.title, this.search), this.body);
    store.subscribe((what) => { if (what === "project" || what === "sel") this.renderBody(); });
    this.renderBody();
  }

  saveFold() {
    try { localStorage.setItem(FOLD_KEY, JSON.stringify([...this.fold])); } catch { /* storage off: fold state just is not remembered */ }
  }

  /** Rows in display order after the search filter: [[list, entity], ...] */
  rows() {
    const P = this.store.project, q = this.query;
    return KINDS.flatMap(([list]) => P[list].filter((e) => !q || `${e.name} ${e.id} ${typeLabel(list, e, P)}`.toLowerCase().includes(q)).map((e) => [list, e]));
  }

  click(e, id, order) {
    if (e.shiftKey && this.anchor && order.includes(this.anchor)) {
      const [a, b] = [order.indexOf(this.anchor), order.indexOf(id)].sort((x, y) => x - y);
      selectIds(order.slice(a, b + 1), id);
      return;
    }
    this.anchor = id;
    if (e.ctrlKey || e.metaKey) toggleSelect([id]);
    else selectIds([id]);
  }

  renderBody() {
    const s = this.store, P = s.project, picked = new Set(selIds(s.sel)), rows = this.rows();
    const order = rows.map(([, e]) => e.id);
    const total = KINDS.reduce((n, [list]) => n + P[list].length, 0);
    this.title.textContent = `場景清單（${total}）`;
    const parts = [];
    if (P.groups.length && !this.query) {
      parts.push(h("div", { class: "ol-kind" }, h("span", {}, `群組（${P.groups.length}）`)));
      for (const g of P.groups) {
        const allSel = g.members.every((m) => picked.has(m));
        parts.push(h("div", { class: `li ol-group${allSel ? " sel" : ""}`, title: "點一下選取整組；雙擊改名", onclick: () => selectIds(g.members),
          ondblclick: () => {
            const inp = h("input", { type: "text", maxlength: 40, value: g.name });
            const ok = (close) => { renameGroup(g.id, inp.value.trim()); close(); };
            inp.addEventListener("keydown", (ev) => { if (ev.key === "Enter" && !ev.isComposing) { ev.preventDefault(); ok(closeDlg); } });
            const closeDlg = modal("群組改名", row("名稱", inp), [{ label: "取消" }, { label: "確定", primary: true, onClick: ok }]);
            inp.select();
          } },
        h("span", { class: "grow" }, `▣ ${g.name}`), h("span", { class: "chip" }, `${g.members.length} 個`),
        h("button", { class: "ol-btn", title: "解散群組（物件保留）", onclick: (e) => { e.stopPropagation(); ungroup(g.id); toast(`已解散「${g.name}」`); } }, "解散")));
      }
    }
    for (const [list, label] of KINDS) {
      const items = rows.filter(([l]) => l === list);
      if (!P[list].length || (this.query && !items.length)) continue;
      const folded = this.fold.has(list) && !this.query;
      parts.push(h("div", { class: "ol-kind", onclick: () => { if (this.fold.has(list)) this.fold.delete(list); else this.fold.add(list); this.saveFold(); this.renderBody(); } },
        h("span", {}, `${folded ? "▸" : "▾"} ${label}（${this.query ? `${items.length}／` : ""}${P[list].length}）`)));
      if (folded) continue;
      for (const [, e] of items) {
        const g = groupOf(P, e.id);
        parts.push(h("div", {
          class: `li${picked.has(e.id) ? " sel" : ""}${e.id === s.sel.id ? " primary" : ""}${e.hidden ? " hid" : ""}${e.locked ? " lock" : ""}`,
          title: "點一下選取；Ctrl＋點加選或取消；Shift＋點選取一段",
          onclick: (ev) => this.click(ev, e.id, order),
        },
        e.color ? h("span", { class: "chip ol-dot", style: { background: e.color } }) : h("span", { class: "ol-dot" }),
        h("span", { class: "grow" }, e.name),
        g ? h("span", { class: "chip", title: `屬於「${g.name}」` }, g.name) : null,
        h("button", { class: `ol-btn${e.hidden ? " on" : ""}`, title: e.hidden ? "目前隱藏：點一下顯示" : "在 3D 編輯視窗隱藏（導演台與輸出仍會出現）", onclick: (ev) => { ev.stopPropagation(); toggleFlag([e.id], "hidden"); } }, e.hidden ? "◌" : "👁"),
        h("button", { class: `ol-btn${e.locked ? " on" : ""}`, title: e.locked ? "目前鎖定：點一下解鎖" : "鎖定：3D 視窗點不到、拖不動", onclick: (ev) => { ev.stopPropagation(); toggleFlag([e.id], "locked"); } }, e.locked ? "🔒" : "🔓")));
      }
    }
    if (!total) parts.push(h("div", { class: "note" }, "從左側素材庫加入角色、物品、攝影機"));
    else if (this.query && !rows.length) parts.push(h("div", { class: "note" }, "找不到符合的物件"));
    this.body.replaceChildren(h("div", { class: "list" }, parts));
  }
}
