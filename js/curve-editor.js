// Speed-curve editor (c02): two draggable bezier handles on a 0..1 box. One undo step per drag.
// Named easings are drawn with their equivalent curve; dragging turns them into a custom curve.
import { h, num } from "./ui.js";
import { CURVE_OF, isCurve, normEase } from "../runtime/keys.js";

const NS = "http://www.w3.org/2000/svg";
// unit box 160 x 160 with room for overshoot from -0.25 to 1.25
const X = (x) => 20 + x * 160, Y = (y) => 200 - y * 160;
const svg = (tag, attrs) => {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
};

/** e: the key's easing (name or [x1, y1, x2, y2]). onCommit(curve) gets a normalised curve. */
export function curveEditor(e, onCommit) {
  const c = isCurve(e) ? [...e] : [...(CURVE_OF[e] || CURVE_OF.linear)];
  const box = svg("svg", { viewBox: "0 0 200 240", class: "curve-ed" });
  box.append(
    svg("rect", { x: X(0), y: Y(1), width: 160, height: 160, class: "ce-box" }),
    svg("line", { x1: X(0), y1: Y(0), x2: X(1), y2: Y(1), class: "ce-diag" }),
  );
  const arms = [svg("line", { class: "ce-arm" }), svg("line", { class: "ce-arm" })];
  const path = svg("path", { class: "ce-curve" });
  const knobs = [svg("circle", { r: 7, class: "ce-knob" }), svg("circle", { r: 7, class: "ce-knob" })];
  box.append(path, ...arms, ...knobs);

  const draw = () => {
    const [x1, y1, x2, y2] = c;
    path.setAttribute("d", `M${X(0)} ${Y(0)} C${X(x1)} ${Y(y1)} ${X(x2)} ${Y(y2)} ${X(1)} ${Y(1)}`);
    [[0, 0, x1, y1], [1, 1, x2, y2]].forEach(([ax, ay, bx, by], i) => {
      Object.entries({ x1: X(ax), y1: Y(ay), x2: X(bx), y2: Y(by) }).forEach(([k, v]) => arms[i].setAttribute(k, v));
      knobs[i].setAttribute("cx", X(bx));
      knobs[i].setAttribute("cy", Y(by));
    });
  };
  knobs.forEach((knob, i) => knob.addEventListener("pointerdown", (ev) => {
    if (ev.button !== 0) return;
    ev.preventDefault();
    knob.setPointerCapture(ev.pointerId);
    const inv = box.getScreenCTM().inverse(), pt = box.createSVGPoint();
    const move = (m) => {
      pt.x = m.clientX; pt.y = m.clientY;
      const p = pt.matrixTransform(inv);
      c[i * 2] = Math.min(1, Math.max(0, (p.x - 20) / 160));
      c[i * 2 + 1] = Math.min(1.25, Math.max(-0.25, (200 - p.y) / 160));
      draw();
    };
    const up = () => {
      knob.removeEventListener("pointermove", move);
      knob.removeEventListener("pointerup", up);
      knob.removeEventListener("pointercancel", up);
      onCommit(normEase(c));
    };
    knob.addEventListener("pointermove", move);
    knob.addEventListener("pointerup", up);
    knob.addEventListener("pointercancel", up);
  }));
  draw();

  const field = (j, lo, hi) => num(c[j], (v) => onCommit(normEase(c.map((x, k) => (k === j ? v : x)))), { step: 0.05, min: lo, max: hi, digits: 3 });
  return h("div", { class: "curve-wrap" },
    box,
    h("div", { class: "vec4" }, field(0, 0, 1), field(1, -1, 2), field(2, 0, 1), field(3, -1, 2)),
    h("div", { class: "note" }, `曲線越陡移動越快、越平越慢。拖兩個圓點調整，放開後寫入（Ctrl+Z 可復原）。數字是兩個控制點 x1 y1 x2 y2，與 CSS cubic-bezier 相同；y 超出 0 到 1 會先超過再拉回。${isCurve(e) ? "" : "目前是預設緩動，拖動後變成自訂曲線"}`),
  );
}
