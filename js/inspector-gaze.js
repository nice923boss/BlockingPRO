// Gaze rows for the actor inspector (a01): whom or where the actor looks at, and when.
import { h, round, num, select, row, vec3Row } from "./ui.js";
import * as ops from "./ops.js";
import { GAZE_LIMITS } from "../runtime/gaze.js";

const note = (t, cls = "note") => h("div", { class: cls }, t);
const btns = (...b) => h("div", { class: "btns" }, b);

/** Inspector rows for actor a's gaze segments. insp is the Inspector (store and current time). */
export function gazeRows(insp, a) {
  const s = insp.store, others = s.project.actors.filter((x) => x.id !== a.id);
  const list = a.gaze.map((g) => ({ ...g })); // latest values: the panel does not re-render while a number field has focus
  const save = (label) => ops.patchEntity(a.id, { gaze: list.map((g) => ({ ...g })) }, label);
  // a fixed point starts 2 m in front of the actor at eye height
  const ahead = () => {
    const k = a.path.keys[0].v, y = a.yaw * Math.PI / 180;
    return [round(k[0] + Math.sin(y) * 2, 2), 1.5, round(k[2] + Math.cos(y) * 2, 2)];
  };
  const setTarget = (g, v) => {
    delete g.actor; delete g.point;
    if (v) g.actor = v; else g.point = ahead();
    save("改視線對象");
  };
  const L = GAZE_LIMITS;
  return [
    h("h4", {}, "視線"),
    ...list.flatMap((g, i) => [
      row(`第 ${i + 1} 段看`, h("div", { class: "inline" },
        select([...others.map((x) => [x.id, x.name]), ["", "固定點"]], g.actor || "", (v) => setTarget(g, v)),
        h("button", { title: "跳到這段開始", onclick: () => s.setTime(g.start) }, "跳到"),
        h("button", { title: "刪除這段視線", onclick: () => { list.splice(i, 1); save("刪除視線"); } }, "刪除"))),
      row("開始／長度（秒）", h("div", { class: "inline" },
        num(g.start, (v) => { g.start = v; save("改視線時間"); }, { step: 0.1, min: 0, digits: 2 }),
        num(g.dur, (v) => { g.dur = v; save("改視線時間"); }, { step: 0.1, min: 0.1, digits: 2 }))),
      g.actor ? null : vec3Row("看的位置", g.point || [0, 1.5, 0], (v) => { g.point = v; save("改視線位置"); }),
    ]),
    list.length ? null : note("還沒有視線，角色照動作本身看前方"),
    btns(h("button", {
      onclick: () => {
        const dur = round(Math.max(0.5, Math.min(2, s.project.settings.duration - s.time)), 2); // 2 s, or what is left
        list.push({ start: round(s.time, 2), dur, ...(others[0] ? { actor: others[0].id } : { point: ahead() }) });
        save("加入視線");
      },
    }, "加入視線（目前時間）")),
    note(`頭和脖子轉向對象，身體不轉（左右 ${L.yaw} 度、往上 ${L.up} 度、往下 ${L.down} 度內）。開始後 0.4 秒轉過去，結束後 0.4 秒轉回；兩段接連時後一段接手`),
  ];
}
