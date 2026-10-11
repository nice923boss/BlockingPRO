// node --test tests/*.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { wallRun, OPENINGS } from "../runtime/walls.js";
import { TEMPLATES, placeTemplate } from "../runtime/templates.js";

// built-in prop types and lighting presets (runtime/props.js and lights.js need three.js, so the lists are written out here)
const BUILT_IN = ["table", "chair", "sofa", "bed", "bookshelf", "tv", "counter", "desk", "bench", "wall", "door", "window", "stairs", "steps", "ramp", "stage", "building", "fence", "streetlight", "car", "bike", "motorcycle", "tree", "bush", "rock", "box", "baby", "cup", "phone", "bag", "book", "umbrella", "pistol", "bat", "marker"];
const LIGHTING_KEYS = ["day", "overcast", "sunset", "night", "indoor", "studio", "neutral"];

const pieces = (list) => list.filter((o) => o.type === "wall" && o.v[1] === 0 && o.scale[1] === 1);

test("a plain wall run is one scaled wall facing the right-hand side", () => {
  const [w] = wallRun([-3, -2.5], [3, -2.5]);
  assert.deepEqual(w, { type: "wall", v: [0, 0, -2.5], yaw: 0, scale: [1.5, 1, 1] });
  // clockwise round a room: the left wall drawn front to back faces +X (yaw 90), the right wall faces -X (yaw -90)
  assert.equal(wallRun([-3, 2.5], [-3, -2.5])[0].yaw, 90);
  assert.equal(wallRun([3, -2.5], [3, 2.5])[0].yaw, -90);
});

test("openings split the wall and get filled above (and below windows)", () => {
  const list = wallRun([0, 0], [6, 0], [{ type: "window", at: 4 }, { type: "door", at: 1.5 }]);
  const full = pieces(list);
  // full-height pieces plus the openings cover the whole 6 m without gaps or overlaps
  const span = full.reduce((s, o) => s + o.scale[0] * 4, 0) + OPENINGS.door.w + OPENINGS.window.w;
  assert.ok(Math.abs(span - 6) < 0.01);
  const door = list.find((o) => o.type === "door"), win = list.find((o) => o.type === "window");
  assert.deepEqual(door.v, [1.5, 0, 0]);
  assert.deepEqual(win.v, [4, 0, 0]);
  const fills = list.filter((o) => o.type === "wall" && !full.includes(o));
  assert.equal(fills.length, 3); // above the door, below and above the window
  assert.ok(fills.some((o) => o.v[1] === OPENINGS.door.top && Math.abs(o.scale[0] * 4 - OPENINGS.door.w) < 0.01));
  assert.ok(fills.some((o) => o.v[1] === 0 && Math.abs(o.scale[1] * 2.8 - OPENINGS.window.sill) < 0.01));
});

test("templates use known props and lighting, and stay grounded inside their area", () => {
  assert.deepEqual(Object.keys(TEMPLATES), ["living", "office", "classroom", "street", "park", "cafe"]);
  for (const [key, T] of Object.entries(TEMPLATES)) {
    assert.ok(T.label && T.desc && T.props.length >= 8, key);
    assert.ok(LIGHTING_KEYS.includes(T.lighting), key);
    for (const o of T.props) {
      assert.ok(BUILT_IN.includes(o.type), `${key}: ${o.type}`);
      assert.equal(o.v.length, 3);
      assert.ok(o.v[1] >= 0 && o.v[1] <= 2.2, `${key}: ${o.type} y ${o.v[1]}`);
      assert.ok(Math.abs(o.v[0]) <= 13 && Math.abs(o.v[2]) <= 13, `${key}: ${o.type} at ${o.v}`);
      if (o.color) assert.match(o.color, /^#[0-9a-f]{6}$/);
    }
  }
});

test("placeTemplate moves every prop by the center and leaves the template untouched", () => {
  const before = JSON.stringify(TEMPLATES.cafe);
  const moved = placeTemplate("cafe", [10, -4]);
  assert.equal(JSON.stringify(TEMPLATES.cafe), before);
  moved.forEach((o, i) => {
    const src = TEMPLATES.cafe.props[i];
    assert.ok(Math.abs(o.v[0] - src.v[0] - 10) < 1e-9 && o.v[1] === src.v[1] && Math.abs(o.v[2] - src.v[2] + 4) < 1e-9);
    assert.equal(o.type, src.type);
  });
});
