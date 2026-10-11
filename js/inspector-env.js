// Scene panel, environment pictures: ground image (v09, editor only) and backdrop (v10, flat or 360 panorama).
import { h, num, select, row } from "./ui.js";
import * as ops from "./ops.js";
import { pickImage } from "./images.js";

const note = (t) => h("div", { class: "note" }, t);

export function envImageRows(S) {
  const gi = S.ground.image, bd = S.backdrop;
  const setGround = (patch, label) => ops.patchSettings({ ground: { ...S.ground, image: patch && { ...S.ground.image, ...patch } } }, label);
  const setBackdrop = (patch, label) => ops.patchSettings({ backdrop: patch && { ...S.backdrop, ...patch } }, label);
  const choose = async (apply) => { const file = await pickImage(); if (file) apply(file); };

  const out = [];
  if (!gi) {
    out.push(row("地面底圖", h("button", { onclick: () => choose((file) => ops.patchSettings({ ground: { ...S.ground, image: { file, width: 10, x: 0, z: 0, rotate: 0, opacity: 0.7 } } }, "加入地面底圖")) }, "選擇圖片…")));
    out.push(note("平面圖或地圖鋪在地面上，照著擺位置。只在編輯視窗顯示，導演台和輸出影片不會出現。"));
  } else {
    out.push(row("地面底圖", h("span", { class: "chip", title: gi.file }, gi.file),
      h("button", { onclick: () => choose((file) => setGround({ file }, "換地面底圖")) }, "換圖"),
      h("button", { onclick: () => setGround(null, "移除地面底圖") }, "移除")));
    out.push(row("底圖寬度（公尺）", num(gi.width, (v) => setGround({ width: v }, "改底圖寬度"), { step: 0.5, min: 0.1, max: 500, digits: 2 })));
    out.push(row("底圖中心 X", num(gi.x, (v) => setGround({ x: v }, "移動地面底圖"), { step: 0.1, digits: 2 })));
    out.push(row("底圖中心 Z", num(gi.z, (v) => setGround({ z: v }, "移動地面底圖"), { step: 0.1, digits: 2 })));
    out.push(row("底圖旋轉（度）", num(gi.rotate, (v) => setGround({ rotate: v }, "旋轉地面底圖"), { step: 5, digits: 1 })));
    out.push(row("底圖不透明", num(gi.opacity, (v) => setGround({ opacity: v }, "改底圖不透明度"), { step: 0.05, min: 0.05, max: 1, digits: 2 })));
  }

  if (!bd) {
    out.push(row("背景圖", h("button", { onclick: () => choose((file) => ops.patchSettings({ backdrop: { file, mode: "flat", rotate: 0 } }, "加入背景圖")) }, "選擇圖片…")));
    out.push(note("一般圖片依輸出比例裁切鋪滿；360 全景請用寬高 2:1 的全景圖。會出現在導演台和輸出影片。"));
  } else {
    out.push(row("背景圖", h("span", { class: "chip", title: bd.file }, bd.file),
      h("button", { onclick: () => choose((file) => setBackdrop({ file }, "換背景圖")) }, "換圖"),
      h("button", { onclick: () => setBackdrop(null, "移除背景圖") }, "移除")));
    out.push(row("背景類型", select([["flat", "平面圖片"], ["pano", "360 全景"]], bd.mode, (v) => setBackdrop({ mode: v }, "改背景類型"))));
    if (bd.mode === "pano") out.push(row("全景旋轉（度）", num(bd.rotate, (v) => setBackdrop({ rotate: v }, "旋轉全景"), { step: 5, digits: 1 })));
    out.push(note(bd.mode === "pano"
      ? "有背景圖時不用背景色。0 度時全景圖片的正中央在 -Z 方向（從 +Z 往原點看到的那一面），用「全景旋轉」調整，90 度時正中央轉到 -X。"
      : "有背景圖時不用背景色。編輯視窗比例和輸出不同時，平面圖片在這裡看起來會變形，以導演台為準。"));
  }
  return out;
}
