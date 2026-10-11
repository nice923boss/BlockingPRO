// Scene templates (p01): rooms and outdoor sets laid out around the origin, placed with one click in the editor.
// Rooms are open-front sets: walls at the back (-Z) and both sides, the +Z side left open for the cameras.
// Plain data, no three.js. Sizes and facing of the props: skill/blockingpro/reference/catalog.md.
import { wallRun } from "./walls.js";

const r3 = (x) => Math.round(x * 1000) / 1000;

/** One prop at (x, z): o may set y (on a table top), yaw, scale, color and name */
const P = (type, x, z, { y = 0, ...o } = {}) => ({ type, v: [x, y, z], ...o });

const grid = (xs, zs, fn) => xs.flatMap((x) => zs.flatMap((z) => fn(x, z)));

export const TEMPLATES = {
  living: {
    label: "客廳", lighting: "indoor",
    desc: "6 x 5 公尺。沙發靠左牆面向右，對面是電視，中間茶几；後牆有門和書櫃，左牆有窗。",
    props: [
      ...wallRun([-3, 2.5], [-3, -2.5], [{ type: "window", at: 2.5 }]),
      ...wallRun([-3, -2.5], [3, -2.5], [{ type: "door", at: 4.8 }]),
      ...wallRun([3, -2.5], [3, 2.5]),
      P("sofa", -2.46, 0, { yaw: 90 }),
      P("table", -1.25, 0, { yaw: 90, scale: [0.8, 0.55, 0.75], name: "茶几" }),
      P("cup", -1.15, 0.25, { y: 0.41 }),
      P("tv", 2.71, 0, { yaw: -90 }),
      P("bookshelf", -1.6, -2.25),
    ],
  },
  office: {
    label: "辦公室", lighting: "indoor",
    desc: "8 x 6 公尺。兩排各 3 張辦公桌，坐著的人面向前方（+Z）；右牆兩座書櫃，後牆三扇窗，左牆有門。",
    props: [
      ...wallRun([-4, 3], [-4, -3], [{ type: "door", at: 2 }]),
      ...wallRun([-4, -3], [4, -3], [{ type: "window", at: 1.5 }, { type: "window", at: 4 }, { type: "window", at: 6.5 }]),
      ...wallRun([4, -3], [4, 3]),
      ...grid([-1.5, 0, 1.5], [-1, 1.4], (x, z) => [P("desk", x, z, { yaw: 180 }), P("chair", x, r3(z - 0.7))]),
      P("bookshelf", 3.75, -2, { yaw: -90 }),
      P("bookshelf", 3.75, -1.05, { yaw: -90 }),
      P("bush", -3.4, -2.4, { scale: [0.45, 0.8, 0.45], name: "盆栽" }),
    ],
  },
  classroom: {
    label: "教室", lighting: "indoor",
    desc: "9 x 7 公尺。後牆黑板與講桌，12 套課桌椅分 3 排面向黑板；左牆兩扇窗，右牆前後門。",
    props: [
      ...wallRun([-4.5, 3.5], [-4.5, -3.5], [{ type: "window", at: 2 }, { type: "window", at: 4.5 }]),
      ...wallRun([-4.5, -3.5], [4.5, -3.5]),
      ...wallRun([4.5, -3.5], [4.5, 3.5], [{ type: "door", at: 1 }, { type: "door", at: 6.2 }]),
      P("wall", 0.6, -3.395, { y: 0.9, scale: [0.9, 0.43, 0.35], color: "#2f4a3c", name: "黑板" }),
      P("desk", -2.8, -2.3, { yaw: 180, name: "講桌" }),
      P("chair", -2.8, -3),
      ...grid([-2.4, -0.8, 0.8, 2.4], [-1, 0.4, 1.8], (x, z) => [
        P("table", x, z, { scale: [0.5, 1, 0.6], name: "課桌" }),
        P("chair", x, r3(z + 0.52), { yaw: 180 }),
      ]),
    ],
  },
  street: {
    label: "街道", lighting: "day",
    desc: "兩棟建築物臨街，門前 z 約 -3.7 到 -0.5 是人行區（地面沒有畫出分界），有長椅、樹、路燈，路邊停兩輛車。範圍約 25 x 18 公尺。",
    props: [
      P("building", -6.5, -9),
      P("building", 6.5, -9),
      P("tree", -10, -1),
      P("tree", 2.5, -1),
      P("streetlight", -7.5, -0.8),
      P("streetlight", 6, -0.8),
      P("bench", -2.5, -3.4),
      P("bench", 9, -3.4),
      P("car", -4.5, 1, { yaw: 90 }),
      P("car", 7.5, 3.8, { yaw: -90, color: "#a33b3b" }),
    ],
  },
  park: {
    label: "公園", lighting: "day",
    desc: "16 x 12 公尺的空地（地面顏色不變）：後方圍欄與灌木，三張長椅、四棵樹、一盞路燈、兩塊石頭，中間留空地走位。",
    props: [
      ...[-6.3, -3.78, -1.26, 1.26, 3.78, 6.3].map((x) => P("fence", x, -6.2)),
      P("bush", -3.2, -4.9),
      P("bush", 0, -4.9),
      P("bush", 3, -4.9),
      P("tree", -6, -3.5),
      P("tree", 6.2, -3.8),
      P("tree", -7, 3),
      P("tree", 6.5, 2.5),
      P("bench", -2, -3),
      P("bench", 2, -3),
      P("bench", -4.5, 0, { yaw: 90 }),
      P("streetlight", 3.6, -3.2),
      P("rock", 3.5, 1.5, { scale: 0.7 }),
      P("rock", 4.2, 2.1, { scale: 0.55 }),
    ],
  },
  cafe: {
    label: "咖啡店", lighting: "indoor",
    desc: "8 x 6 公尺。後方兩段吧台（店員在吧台後，客人在前方），三張雙人桌；左牆門與窗，右牆兩扇窗。",
    props: [
      ...wallRun([-4, 3], [-4, -3], [{ type: "door", at: 2 }, { type: "window", at: 4.5 }]),
      ...wallRun([-4, -3], [4, -3]),
      ...wallRun([4, -3], [4, 3], [{ type: "window", at: 1.5 }, { type: "window", at: 4 }]),
      P("counter", 0, -1.7),
      P("counter", 2.1, -1.7),
      P("cup", 0.4, -1.55, { y: 1.05 }),
      P("cup", 1.9, -1.55, { y: 1.05 }),
      P("bookshelf", -3.2, -2.75),
      ...[[-2.4, -0.6], [0.2, 1.2], [2.8, 0.8]].flatMap(([x, z]) => [
        P("table", x, z, { scale: [0.55, 1, 0.85] }),
        P("chair", r3(x - 0.65), z, { yaw: 90 }),
        P("chair", r3(x + 0.65), z, { yaw: -90 }),
        P("cup", r3(x - 0.15), z, { y: 0.75 }),
      ]),
      P("bush", 3.4, 2.4, { scale: [0.45, 0.8, 0.45], name: "盆栽" }),
    ],
  },
};

/** Copies of the template's props with the template origin moved to center [x, z] */
export function placeTemplate(key, [cx, cz]) {
  return TEMPLATES[key].props.map((o) => ({ ...o, v: [r3(o.v[0] + cx), o.v[1], r3(o.v[2] + cz)] }));
}
