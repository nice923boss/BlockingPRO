// Held props for the inspector: one segment per holder and time range (runtime/attach.js), so a prop can be
// picked up, handed to someone else or thrown.
import { h, round, num, select, checkbox, row, vec3Row } from "./ui.js";
import * as ops from "./ops.js";
import { attachList, packAttach } from "../runtime/schema.js";
import { HUMAN_JOINTS } from "../runtime/rig-human.js";
import { jointLabel } from "./pose-panel.js";

const note = (t) => h("div", { class: "note" }, t);
const btns = (...b) => h("div", { class: "btns" }, b);

// the grip the runtime uses when pos / rot are empty, so editing starts from what is on screen
function defaultGrip(def, joint) {
  const hd = /Hand$/.test(joint) && def?.hold;
  if (!hd) return { pos: [0, 0, 0], rot: [0, 0, 0] };
  return joint === "lHand" ? { pos: [-hd.pos[0], hd.pos[1], hd.pos[2]], rot: [hd.rot[0], -hd.rot[1], -hd.rot[2]] } : hd;
}

export function attachPanel(insp, o, def) {
  const s = insp.store, segs = attachList(o), t = round(s.time, 2);
  const save = (list, label) => ops.patchEntity(o.id, { attach: packAttach(list) }, label);
  const jointFor = (id) => (s.project.actors.find((x) => x.id === id)?.kind === "human" ? "rHand" : null);
  if (!segs.length) {
    return [
      h("h4", {}, "手持／附著"),
      row("附著到", select(insp.actorOptions("不附著（放在場景裡）"), "", (v) => v && save([{ actor: v, joint: jointFor(v) }], "附著到角色"))),
    ];
  }
  const out = [];
  segs.forEach((seg, i) => {
    const set = (patch, label = "改附著") => save(segs.map((x, j) => (j === i ? { ...x, ...patch } : x)), label);
    const host = insp.rt.entities.get(seg.actor);
    const joints = host?.rig ? host.rig.jointNames : HUMAN_JOINTS;
    const joint = seg.joint || (joints.includes("rHand") && def?.hold ? "rHand" : joints[0]);
    const dh = defaultGrip(def, joint), grip = { pos: seg.pos || dh.pos, rot: seg.rot || dh.rot };
    const timeRow = (label, key) => row(label, h("div", { class: "inline" }, num(seg[key], (v) => set({ [key]: v }), { step: 0.1, min: 0, digits: 2 }),
      h("button", { onclick: () => set({ [key]: t }) }, "目前"), h("button", { disabled: seg[key] == null, onclick: () => set({ [key]: undefined }) }, "清除")));
    out.push(
      h("h4", {}, segs.length > 1 ? `手持第 ${i + 1} 段` : "手持／附著"),
      row("附著到", select(insp.actorOptions(segs.length > 1 ? "移除這一段" : "不附著（放在場景裡）"), seg.actor, (v) => {
        if (!v) return save(segs.filter((_, j) => j !== i), segs.length > 1 ? "移除附著段" : "取消附著");
        set({ actor: v, joint: jointFor(v), pos: undefined, rot: undefined }, "附著到角色");
      })),
      row("關節", select([...joints.map((j) => [j, jointLabel(j)]), ["root", "整個人（騎車用）"]], joint, (v) => set({ joint: v }))),
      timeRow("開始（秒）", "from"),
      timeRow("結束（秒）", "to"),
      row("保持直立", checkbox(seg.upright ?? !!def?.hold?.upright, (v) => set({ upright: v === !!def?.hold?.upright ? undefined : v }), "只跟著角色轉向，不隨手腕傾斜")),
      row("滑進手裡（秒）", num(seg.blend || 0, (v) => set({ blend: v || undefined }), { step: 0.1, min: 0, max: 3, digits: 2 })),
      row("丟出飛行（秒）", num(seg.throw || 0, (v) => set({ throw: v || undefined }), { step: 0.1, min: 0, max: 5, digits: 2 })),
      seg.throw > 0 ? row("拋物線高度（公尺）", num(seg.arc ?? 0.5, (v) => set({ arc: v }), { step: 0.1, min: 0, max: 5, digits: 2 })) : null,
      vec3Row("位移（公尺）", grip.pos, (v) => set({ pos: v, rot: grip.rot }), 0.01),
      vec3Row("旋轉（度）", grip.rot, (v) => set({ pos: grip.pos, rot: v }), 5),
      seg.pos || seg.rot ? btns(h("button", { onclick: () => set({ pos: undefined, rot: undefined }) }, "恢復預設握法")) : null,
    );
  });
  // next segment: someone else when there is another person (hand-over), starting where the last one ends
  const last = segs[segs.length - 1];
  const other = s.project.actors.find((a) => a.kind === "human" && a.id !== last.actor) || s.project.actors.find((a) => a.id === last.actor);
  const from = round(Math.max(t, last.from ?? 0), 2);
  // the shortened segment cannot be thrown any more: the next one starts when it ends
  const addSeg = () => save([...segs.slice(0, -1), last.to == null || last.to > from ? { ...last, to: from, throw: undefined, arc: undefined } : last,
    { actor: other.id, joint: jointFor(other.id), from, blend: 0.3 }], "新增附著段");
  out.push(
    note("開始、結束留空代表全程。滑進手裡：從原本的位置（或上一段那隻手）移到這隻手的秒數。丟出飛行：結束後沿拋物線飛到物品路徑在「結束 + 飛行秒數」的位置，落點要在路徑上放一格。"),
    note("位移與旋轉預設是物品的標準握法，握點跟著角色身高移動、物品大小不變；改了就換成自訂值（自訂值依身高縮放）。附著時段以外，物品回到自己的路徑位置。"),
    btns(h("button", { title: "從目前時間起換另一個人拿（交接）或再拿起來", onclick: addSeg }, "新增一段（交接／再拿起）")),
  );
  return out;
}
