// "Walk over and sit" (a09) in the inspector: a button when a human and a seat are selected together,
// and a row on a chair, bench or sofa to pick who comes to sit.
import { h, row, select } from "./ui.js";
import { trackValueAt } from "./ops.js";
import { SEATS, sitOn, sitPair } from "./ops-sit.js";

const note = (t) => h("div", { class: "note" }, t);

/** Rows for the multi-selection panel: shown only for exactly one human plus one seat */
export function sitPairRows(store) {
  const pair = sitPair(store.sel, store.project);
  if (!pair) return [];
  return [
    h("div", { class: "btns" }, h("button", { onclick: () => sitOn(pair.actor.id, pair.seat.id) }, `「${pair.actor.name}」走過去坐「${pair.seat.name}」`)),
    note("從播放頭開始走到最近的空位，轉身坐下並坐到最後；播放頭之後的路徑點會被取代"),
  ];
}

/** Row on a seat prop: pick a human (nearest by default) and send them over */
export function sitRows(store, o) {
  if (!SEATS[o.type]) return [];
  const humans = store.project.actors.filter((a) => a.kind === "human");
  if (!humans.length) return [];
  const here = trackValueAt(o, "path", store.time);
  const dist = (a) => { const p = trackValueAt(a, "path", store.time); return Math.hypot(p[0] - here[0], p[2] - here[2]); };
  let pick = [...humans].sort((a, b) => dist(a) - dist(b))[0].id;
  return [
    h("h4", {}, "坐下"),
    row("誰來坐", select(humans.map((a) => [a.id, a.name]), pick, (v) => { pick = v; })),
    h("div", { class: "btns" }, h("button", { title: "從播放頭開始走過來、轉身坐下，播放頭之後的路徑點會被取代", onclick: () => sitOn(pick, o.id) }, "走過來坐下")),
  ];
}
