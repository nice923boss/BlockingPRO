// Timed state of animated built-in props for the inspector (p10, runtime/prop-anim.js): how far a door or the
// elevator doors are open, how fast a fan turns. A key list, plus buttons that open or close over one second.
import { h, round, num, row } from "./ui.js";
import * as ops from "./ops.js";
import { STATE_TYPES, stateAt, FAN_RPS } from "../runtime/prop-anim.js";

const note = (t) => h("div", { class: "note" }, t);
const btns = (...b) => h("div", { class: "btns" }, b);
const clamp01 = (v) => Math.min(1, Math.max(0, v));

export function stateRows(insp, o) {
  const info = STATE_TYPES[o.type];
  if (!info) return [];
  const t = round(insp.store.time, 2), fan = o.type === "fan";
  const keys = Array.isArray(o.state) ? o.state : o.state != null ? [{ t: 0, v: o.state }] : [];
  const save = (list, label) => ops.patchEntity(o.id, { state: list.length ? [...list].sort((a, b) => a.t - b.t) : undefined }, label);
  const setKey = (i, patch, label) => save(keys.map((k, j) => (j === i ? { ...k, ...patch } : k)), label);
  // from the value on screen now to `to` over one second, easing in and out; keys inside that second are replaced
  const ramp = (to, label) => {
    const kept = keys.filter((k) => k.t < t - 1e-3 || k.t > t + 1 + 1e-3);
    save([...kept, { t, v: round(stateAt(o, t), 3), e: "inOut" }, { t: round(t + 1, 2), v: to }], label);
  };
  const [on, off] = fan ? ["啟動", "停止"] : ["開啟", "關閉"];
  return [
    h("h4", {}, `動畫：${info.label}`),
    note(`數值 0 為${info.zero}，1 為${info.one}，兩格之間漸變（緩動寫在前一格）。${fan ? `轉速 1 是每秒 ${FAN_RPS} 圈。` : ""}現在 ${round(stateAt(o, t), 2)}。`),
    ...keys.map((k, i) => row(`第 ${i + 1} 格（秒／數值）`, h("div", { class: "inline" },
      num(k.t, (v) => setKey(i, { t: v }, "改動畫時間"), { step: 0.1, min: 0, digits: 2 }),
      num(k.v, (v) => setKey(i, { v: clamp01(v) }, "改動畫數值"), { step: 0.1, min: 0, max: 1, digits: 2 }),
      h("button", { title: "刪除這一格", onclick: () => save(keys.filter((_, j) => j !== i), "刪除動畫格") }, "刪除")))),
    btns(
      h("button", { onclick: () => ramp(1, `${info.label}${on}`) }, `從目前時間${on}（1 秒）`),
      h("button", { onclick: () => ramp(0, `${info.label}${off}`) }, `從目前時間${off}（1 秒）`)),
    keys.length ? null : note(`還沒有動畫，${fan ? "電風扇不轉" : "維持關著"}。`),
  ];
}
