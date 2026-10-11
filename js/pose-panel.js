// Inspector content while posing: joint list, rotation in degrees, hips offset, mirror / reset / bake.
import { h, num, row, checkbox, toast, confirmBox } from "./ui.js";
import { ikChain } from "../runtime/ik.js";
import { poseLib, fits } from "./pose-lib.js";

const BASE = {
  hips: "骨盆", spine: "腰", chest: "胸", neck: "頸", head: "頭",
  UpperArm: "上臂", ForeArm: "前臂", Hand: "手", Thigh: "大腿", Shin: "小腿", Foot: "腳",
  body: "身體", tail: "尾巴", tail1: "尾巴 1", tail2: "尾巴 2", tail3: "尾巴 3",
  FrontUpper: "前腿上段", FrontLower: "前腿下段", FrontFoot: "前腳掌", BackUpper: "後腿上段", BackLower: "後腿下段", BackFoot: "後腳掌",
  Wing: "翅膀", WingTip: "翅尖", Leg: "大腿", Shank: "小腿",
};

/** Chinese name of a joint: lUpperArm → 左上臂 (left is the character's own left) */
export function jointLabel(j) {
  const m = /^([lr])([A-Z]\w*)$/.exec(j);
  if (m) return (m[1] === "l" ? "左" : "右") + (BASE[m[2]] || m[2]);
  return BASE[j] || j;
}

export function posePanel(store, rt, posing) {
  const p = store.posing, ent = rt.entities.get(p.id), spec = store.project.actors.find((a) => a.id === p.id);
  if (!ent || !spec || !posing.draft) return [h("div", { class: "note" }, "找不到要擺姿勢的角色")];
  const rig = ent.rig, root = rig.jointNames[0], d = posing.draft;
  const out = [
    h("h4", {}, `擺姿勢：${spec.name}`),
    h("div", { class: "note" }, "在 3D 視窗點關節球，用旋轉環調整；也可以直接輸入角度。完成後按「套用」寫進時間軸。"),
    p.clipId ? h("div", { class: "chip" }, "編輯既有的姿勢片段") : h("div", { class: "chip" }, `會在 ${store.time.toFixed(2)} 秒建立姿勢片段`),
    h("div", { class: "list", style: { margin: "8px 0" } },
      rig.jointNames.map((j) => h("div", {
        class: `li${p.joint === j ? " sel" : ""}`, onclick: () => posing.selectJoint(j),
      }, h("span", { class: "grow" }, jointLabel(j)), d.rot[j] ? h("span", { class: "chip" }, d.rot[j].map((x) => Math.round(x)).join(" / ")) : null))),
  ];
  if (p.joint) {
    const deg = d.rot[p.joint] || [0, 0, 0];
    out.push(
      h("h4", {}, jointLabel(p.joint)),
      h("div", { class: "row" }, h("label", {}, "旋轉 X / Y / Z"), h("div", { class: "vec" },
        [0, 1, 2].map((i) => num(deg[i], (v) => posing.setJointRot(p.joint, deg.map((x, k) => (k === i ? v : x))), { step: 5, digits: 1 })))),
      h("div", { class: "btns" }, h("button", { onclick: () => posing.resetJoint(p.joint) }, "這個關節歸零")),
    );
    if (ikChain(rig, p.joint)) {
      out.push(
        row("拖曳位置（IK）", checkbox(p.ik, (on) => posing.setIK(on), "勾選時 3D 視窗的控制器移動手腳末端，手肘、膝蓋自動彎曲；取消勾選改回旋轉這個關節")),
        h("div", { class: "note" }, "拖曳時手掌、腳掌維持原本朝向，腳踩在地上不會歪；手肘、膝蓋沿目前彎曲的方向彎。"),
      );
    }
    if (p.joint === root) {
      const H = rig.height;
      out.push(
        row("移動骨盆", checkbox(p.moveHips, (on) => posing.setMoveHips(on), "勾選後 3D 視窗的控制器改成移動骨盆位置")),
        h("div", { class: "row" }, h("label", {}, "骨盆位移（公尺）"), h("div", { class: "vec" },
          [0, 1, 2].map((i) => num(d.hips[i] * H, (v) => posing.setHips(d.hips.map((x, k) => (k === i ? v / H : x))), { step: 0.02, digits: 3 })))),
        h("div", { class: "note" }, "坐下、蹲下時把骨盆往下移（Y 為負）"),
      );
    }
  }
  out.push(
    h("div", { class: "btns", style: { marginTop: "12px" } },
      h("button", { onclick: () => posing.mirror() }, "左右鏡像"),
      h("button", { onclick: () => posing.resetAll() }, "全部歸零"),
    ),
    ...libraryPart(rig, posing),
    h("div", { class: "btns" },
      h("button", { class: "primary", onclick: () => posing.bake() }, "套用（寫入時間軸）"),
      h("button", { onclick: () => posing.cancel() }, "取消"),
    ),
    h("div", { class: "note" }, "快捷鍵：Enter 套用，Esc 取消。播放在擺姿勢時停用。"),
  );
  return out;
}

/** Pose library: save the draft under a name, or load a saved pose (same kind of rig only) into the draft */
function libraryPart(rig, posing) {
  const list = poseLib.poses.filter((e) => fits(e, rig));
  const name = h("input", {
    type: "text", maxlength: 40, placeholder: "姿勢名稱，例如：指向遠方", style: { flex: "1", minWidth: "0" },
    onkeydown: (e) => { if (e.key === "Enter" && !e.isComposing) save(); },
  });
  const save = async () => {
    const n = name.value.trim();
    if (!n) { toast("先輸入姿勢名稱", "err"); name.focus(); return; }
    // leaving the field lets the inspector redraw the list
    if (await poseLib.add(n, rig, posing.draft)) { name.blur(); toast(`已存進姿勢庫：${n}`); }
  };
  const remove = async (e, entry) => {
    e.stopPropagation();
    if (await confirmBox("刪除姿勢", `從姿勢庫刪除「${entry.name}」？已經套用到時間軸的姿勢片段不受影響。`, "刪除")) poseLib.remove(entry.id);
  };
  return [
    h("h4", { style: { marginTop: "12px" } }, "姿勢庫（所有專案共用）"),
    poseLib.error ? h("div", { class: "note" }, poseLib.error) : null,
    h("div", { class: "btns" }, name, h("button", { onclick: save }, "存進姿勢庫")),
    list.length
      ? h("div", { class: "list", style: { margin: "6px 0" } }, list.map((e) => h("div", { class: "li", title: "點一下套用到目前角色（還沒寫入時間軸）", onclick: () => posing.loadPose(e.pose) },
        h("span", { class: "grow" }, e.name),
        h("button", { class: "danger", style: { padding: "0 6px", fontSize: "11px" }, onclick: (ev) => remove(ev, e) }, "刪除"))))
      : h("div", { class: "note" }, "還沒有存過這種角色的姿勢。擺好後輸入名稱按「存進姿勢庫」，其他角色、其他專案擺姿勢時就能點選套用。"),
    list.length ? h("div", { class: "note" }, "點姿勢名稱套用到目前角色，再按「套用（寫入時間軸）」。同名的姿勢會被覆蓋。") : null,
  ];
}
