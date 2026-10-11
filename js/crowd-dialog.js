// a10 crowd dialog: how many passers-by, where they wander and how fast (the routes come from runtime/crowd.js).
import * as ops from "./ops.js";
import { h, modal, row, num, round } from "./ui.js";

export function openCrowd(vp) {
  const t = vp.orbit.target;
  const f = { count: 8, x: round(t.x, 1), z: round(t.z, 1), w: 8, d: 6, speed: 1.2 };
  const field = (key, opts) => num(f[key], (v) => { f[key] = v; }, opts);
  modal("加入路人群", h("div", {},
    row("人數", field("count", { step: 1, min: 1, max: 40, digits: 0 })),
    row("中心 X", field("x", { step: 0.5, min: -100, max: 100, digits: 2 })),
    row("中心 Z", field("z", { step: 0.5, min: -100, max: 100, digits: 2 })),
    row("寬 X（公尺）", field("w", { step: 0.5, min: 2, max: 60, digits: 2 })),
    row("深 Z（公尺）", field("d", { step: 0.5, min: 2, max: 60, digits: 2 })),
    row("速度（公尺/秒）", field("speed", { step: 0.1, min: 0.6, max: 1.8, digits: 2 })),
    h("p", { class: "note" }, "路人在區域裡隨機走動、偶爾停下，持續整段時間；彼此和現有角色保持 0.6 公尺，並繞開 0 秒時擺著的家具。區域中心預設是 3D 視窗目前的注視點。"),
    h("p", { class: "note" }, "全部放進同一個群組：點任一個會選取整群，按 Delete 一起刪除；不滿意就復原再加一次，每次路線都不同。"),
  ), [
    { label: "取消" },
    { label: "加入", primary: true, onClick: (c) => { c(); ops.addCrowd({ count: Math.round(f.count), area: { x: f.x, z: f.z, w: f.w, d: f.d }, speed: f.speed }); } },
  ]);
}
