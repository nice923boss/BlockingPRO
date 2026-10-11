// Left panel: preset characters, animals, props, cameras (with camera moves), lights, actions and examples.
import { h, toast, confirmBox, menu } from "./ui.js";
import * as ops from "./ops.js";
import { pairUp, pairPartner } from "./ops-pair.js";
import { sitOn, sitPair } from "./ops-sit.js";
import { findEntity } from "./state.js";
import { actionsFor } from "../runtime/schema.js";
import { HUMAN_BODIES } from "../runtime/rig-human.js";
import { ANIMAL_TYPES } from "../runtime/rig-animal.js";
import { PROPS, PROP_CATS } from "../runtime/props.js";
import { CAMERA_MOVES } from "../runtime/camera.js";
import { LIGHTING } from "../runtime/lights.js";
import { uniqueAssetId } from "../runtime/assets.js";
import { copyBuiltinProp } from "../runtime/prop-copy.js";
import { assetLib } from "./asset-library.js";
import { openAssetEditor } from "./asset-editor.js";
import { openPromptGuide, openPasteImport, openModelImport, exportLibraryPack } from "./asset-dialogs.js";
import { openTemplate } from "./template-dialog.js";
import { TEMPLATES } from "../runtime/templates.js";

const TABS = { cast: "角色", props: "物品", scene: "場景", camera: "攝影機", light: "燈光", action: "動作", examples: "範例" };

export class Library {
  constructor(el, store, viewport = null) {
    Object.assign(this, { el, store, viewport });
    this.tab = "cast";
    this.exampleList = null;
    this.tabs = h("div", { class: "tabs" });
    this.body = h("div", { class: "scroll" });
    el.append(h("h3", {}, "素材庫"), this.tabs, this.body);
    store.subscribe((what) => {
      if (what === "sel" || what === "project") { if (this.tab === "action" || this.tab === "props") this.render(); }
    });
    assetLib.subscribe(() => { if (this.tab === "props") this.render(); });
    this.render();
  }

  show(tab) { this.tab = tab; this.render(); }

  render() {
    this.tabs.replaceChildren(...Object.entries(TABS).map(([k, label]) => h("button", { class: this.tab === k ? "on" : null, onclick: () => this.show(k) }, label)));
    this.body.replaceChildren(...this[this.tab]().filter(Boolean));
  }

  item(label, onclick, sw = null, title = null) {
    return h("button", { class: "lib-item", onclick, title: title || label }, sw ? h("span", { class: "sw", style: { background: sw } }) : null, h("span", {}, label));
  }

  cast() {
    return [
      h("div", { class: "lib-group" }, "人物"),
      h("div", { class: "lib-grid" }, Object.entries(HUMAN_BODIES).map(([k, b]) => this.item(b.label, () => ops.addActor("human", k), "#d9dde4", `${b.label}（${b.height} 公尺）`))),
      h("div", { class: "lib-group" }, "動物"),
      h("div", { class: "lib-grid" }, Object.entries(ANIMAL_TYPES).map(([k, a]) => this.item(a.label, () => ops.addActor("animal", k), "#c9a27a"))),
      h("div", { class: "lib-note" }, "點一下加入場景。加入後在 3D 視窗拖曳移動，Shift + 點地面加路徑點。"),
    ];
  }

  props() {
    const host = findEntity(this.store.project, this.store.sel.id);
    const holder = host?.list === "actors" && host.spec.kind === "human" ? host.spec : null;
    const out = this.customProps();
    for (const [cat, label] of Object.entries(PROP_CATS)) {
      const list = Object.entries(PROPS).filter(([, p]) => p.cat === cat);
      if (!list.length) continue;
      out.push(h("div", { class: "lib-group" }, label), h("div", { class: "lib-grid" }, list.map(([k, p]) => {
        const el = this.item(p.label, () => ops.addProp(k), p.color, `${p.label}${p.hold ? "（可手持）" : ""}，右鍵可複製成自訂物品`);
        el.oncontextmenu = (e) => { e.preventDefault(); menu(e.clientX, e.clientY, [{ label: `把「${p.label}」複製成自訂物品…`, onClick: () => this.copyBuiltin(k) }]); };
        return el;
      })));
    }
    out.push(h("div", { class: "lib-note" }, holder
      ? `目前選取「${holder.name}」：小物會直接放到他的右手。`
      : "先選取一個人物再點小物（杯子、手機、傘等），會直接放到他的右手。"),
      h("div", { class: "lib-note" }, "內建物品按右鍵可複製成自訂物品，再改零件、顏色或尺寸。"));
    return out;
  }

  /** Open the asset editor on a custom copy of a built-in prop (saved only when the user saves it). */
  copyBuiltin(type) {
    const r = copyBuiltinProp(type, new Set(assetLib.assets.map((a) => a.id)));
    openAssetEditor(this.store, r.asset, { isNew: true });
    if (r.approx) toast(`${r.approx} 個零件是近似形狀（斜面、車身輪廓、樹叢等換成方塊、圓柱或球），儲存前可在編輯器調整`, "warn");
  }

  /** Custom props from library/assets.json: add, import, prompt guide, export, and per-row edit / duplicate / delete. */
  customProps() {
    const S = this.store, lib = assetLib;
    const used = new Set(S.project.assets.map((a) => a.id));
    const rows = lib.assets.map((a) => h("div", { class: "cust-row", title: a.desc || a.label },
      h("span", { class: "sw", style: { background: a.color } }),
      h("span", { class: "name", onclick: () => ops.addProp(a.id, a), title: `加入場景：${a.label}（${a.id}）${a.hold ? "，可手持" : ""}` }, a.label),
      h("span", { class: "chip" }, PROP_CATS[a.cat] || a.cat),
      h("span", { class: "acts" },
      h("button", { title: "編輯", onclick: () => openAssetEditor(S, a, { isNew: false }) }, "編輯"),
      h("button", { title: "複製成新物品", onclick: () => {
        const id = uniqueAssetId(a.id, new Set(lib.assets.map((x) => x.id)));
        openAssetEditor(S, { ...a, id, label: `${a.label} 複本`.slice(0, 30) }, { isNew: true });
      } }, "複製"),
      h("button", { class: "danger", title: "從素材庫刪除", onclick: async () => {
        const note = used.has(a.id) ? "目前的專案有用到它，專案裡的會保留（專案各自存了一份）。" : "已經用到它的專案不受影響。";
        if (await confirmBox("刪除自訂物品", `從素材庫刪除「${a.label}」？${note}`, "刪除")) {
          if (await lib.remove(a.id)) toast(`已刪除「${a.label}」`);
        }
      } }, "刪除"))));
    return [
      h("div", { class: "lib-group" }, `自訂物品（${lib.assets.length}）`),
      h("div", { class: "cust-bar" },
        h("button", { onclick: () => openAssetEditor(S) }, "＋新增"),
        h("button", { onclick: () => openPasteImport(S) }, "匯入"),
        h("button", { onclick: () => openModelImport(S), title: "把 GLB 或 OBJ 3D 模型檔做成物品" }, "匯入模型"),
        h("button", { onclick: () => openPromptGuide(S) }, "提示詞教學"),
        h("button", { onclick: () => exportLibraryPack(), disabled: !lib.assets.length }, "匯出")),
      lib.error ? h("div", { class: "lib-note err" }, lib.error) : null,
      rows.length ? h("div", { class: "cust-list" }, rows)
        : h("div", { class: "lib-note" }, lib.ready ? "還沒有自訂物品。可以用「＋新增」自己組，或看「提示詞教學」用聊天 AI 產生後匯入；開啟含自訂物品的專案也會自動加進來。" : "讀取中…"),
    ];
  }

  /** p01: room and outdoor templates */
  scene() {
    return [
      h("div", { class: "list", style: { padding: "8px" } }, Object.entries(TEMPLATES).map(([k, T]) => h("div", { class: "li", onclick: () => openTemplate(this.store, this.viewport, k) },
        h("div", { class: "grow" }, h("div", {}, `${T.label}（${T.props.length} 件）`), h("div", { class: "note" }, T.desc))))),
      h("div", { class: "lib-note" }, "點一下選擇放的位置，一鍵擺好家具、牆面與建築。放好後每件都能單獨移動、刪除。"),
    ];
  }

  camera() {
    return [
      h("div", { class: "lib-group" }, "新增攝影機"),
      h("div", { class: "lib-grid" }, this.item("固定機位", () => ops.addCamera(), "#ff9f1c")),
      h("div", { class: "lib-group" }, "新增並套用運鏡"),
      h("div", { class: "lib-grid" }, Object.entries(CAMERA_MOVES).filter(([k]) => k !== "static").map(([k, m]) => this.item(m.label, () => ops.addCamera(k), null, m.needsActor ? `${m.label}（需要角色）` : m.label))),
      h("div", { class: "lib-note" }, "運鏡以選取中的角色（或第一個角色）為拍攝對象，涵蓋整段時間。已有攝影機時，可在右側屬性面板對它套用運鏡並指定時段。"),
    ];
  }

  light() {
    const S = this.store.project.settings;
    return [
      h("div", { class: "lib-group" }, "場景燈光預設"),
      h("div", { class: "lib-grid" }, Object.entries(LIGHTING).map(([k, l]) => h("button", {
        class: `lib-item${S.lighting === k ? " on" : ""}`, onclick: () => ops.patchSettings({ lighting: k, background: null }, `燈光：${l.label}`),
      }, h("span", { class: "sw", style: { background: l.bg } }), h("span", {}, l.label)))),
      h("div", { class: "lib-group" }, "加入燈具"),
      h("div", { class: "lib-grid" }, this.item("聚光燈", () => ops.addLight("spot"), "#fff3b0"), this.item("點光源", () => ops.addLight("point"), "#ffd27a")),
      h("div", { class: "lib-note" }, "選取角色後加聚光燈，燈會自動對準他。"),
    ];
  }

  action() {
    // with a human and a seat selected the seat is often the primary (Ctrl+click), so list the human's actions anyway
    const s = this.store, pair = sitPair(s.sel, s.project), ent = findEntity(s.project, pair ? pair.actor.id : s.sel.id);
    if (!ent || ent.list !== "actors") return [h("div", { class: "lib-note" }, "先在 3D 視窗或時間軸選取一個角色或動物，這裡會列出他能做的動作。")];
    const a = ent.spec, lib = actionsFor(a);
    const partner = pairPartner(s.sel, s.project), seat = pair?.seat;
    const add = (type, act) => {
      if (type === "sit" && seat) return sitOn(a.id, seat.id);
      if (act.pair && partner) return pairUp(type);
      if (act.pair) toast("雙人動作：按住 Ctrl 再選另一個人，按一次就會擺好距離和面向；也可以在右側片段面板選對象", "info");
      const track = act.mask === "upper" && a.kind === "human" ? "upper" : "actions";
      ops.addClip(a.id, track, type, s.time);
    };
    const groups = a.kind === "human" ? [["全身動作", "full"], ["上半身動作（可疊在走路上）", "upper"]] : [["動作", null]];
    const out = [h("div", { class: "lib-note" }, `加到「${a.name}」，從播放頭 ${s.time.toFixed(2)} 秒開始`)];
    for (const [label, mask] of groups) {
      const list = Object.entries(lib).filter(([, act]) => !mask || (act.mask || "full") === mask);
      if (!list.length) continue;
      out.push(h("div", { class: "lib-group" }, label), h("div", { class: "lib-grid" }, list.map(([k, act]) => this.item(act.label, () => add(k, act), act.loop ? "#4da3ff" : "#ffb84d", `${act.label}（${act.loop ? "循環" : "單次"}，預設 ${act.dur || 2} 秒）`))));
    }
    if (a.kind === "human") out.push(h("div", { class: "lib-note" }, partner
      ? `已選兩人：雙人動作會讓「${a.name}」站到「${partner.name}」面前，兩人同時開始`
      : "雙人動作（握手、擁抱、遞出、接過）：按住 Ctrl 再選另一個人，再按動作會自動對齊兩人。"));
    if (a.kind === "human") out.push(h("div", { class: "lib-note" }, seat
      ? `已選「${seat.name}」：按「坐下」會從播放頭走過去，轉身坐到最近的空位`
      : "一鍵坐下：按住 Ctrl 再點椅子、長椅或沙發，再按「坐下」（或右側面板的按鈕），會自動走過去轉身坐好。"));
    out.push(h("div", { class: "lib-note" }, "藍色：循環動作；橘色：單次動作。也可以在右側面板「在目前時間擺姿勢」自己擺。"));
    return out;
  }

  examples() {
    if (!this.exampleList) {
      this.exampleList = [];
      fetch("examples/index.json").then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
        .then((list) => { this.exampleList = list; if (this.tab === "examples") this.render(); })
        .catch((err) => { console.warn("BlockingPRO: 範例清單讀取失敗", err); this.exampleList = null; this.exampleError = "讀不到範例清單（examples/index.json），請用 start.bat 啟動"; if (this.tab === "examples") this.render(); });
    }
    if (this.exampleError) return [h("div", { class: "lib-note err" }, this.exampleError)];
    if (!this.exampleList.length) return [h("div", { class: "lib-note" }, "讀取中…")];
    return [
      h("div", { class: "list", style: { padding: "8px" } }, this.exampleList.map((ex) => h("div", { class: "li", onclick: () => this.loadExample(ex) },
        h("div", { class: "grow" }, h("div", {}, ex.title), h("div", { class: "note" }, ex.desc))))),
      h("div", { class: "lib-note" }, "載入範例會取代目前的場景（可用 Ctrl+Z 復原）。"),
    ];
  }

  async loadExample(ex) {
    const P = this.store.project;
    if (P.actors.length + P.props.length > 0 && !(await confirmBox("載入範例", `要用範例「${ex.title}」取代目前的場景嗎？可用 Ctrl+Z 復原。`, "載入"))) return;
    try {
      const r = await fetch(`examples/${ex.file}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const issues = this.store.load(await r.json(), `載入範例：${ex.title}`);
      toast(issues.errors.length ? `範例有 ${issues.errors.length} 個錯誤，見右側檢查` : `已載入「${ex.title}」`, issues.errors.length ? "warn" : "info");
    } catch (err) {
      console.error("BlockingPRO: 範例載入失敗", err);
      toast(`範例載入失敗：${err.message}`, "err");
    }
  }
}
