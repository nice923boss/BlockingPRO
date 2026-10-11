// node --test tests/
import test from "node:test";
import assert from "node:assert/strict";
import { terrainOf, terrainAt, groundAt, terrainWarnings, isTerrain, STAIRS, STAGE, RAMP } from "../runtime/terrain.js";

const near = (a, b, eps = 1e-3) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);
const prop = (id, type, v, extra = {}) => ({ id, name: id, type, yaw: 0, facing: "path", scale: 1, path: { curve: "smooth", keys: [{ t: 0, v }] }, ...extra });
const actor = (id, keys) => ({ id, name: id, kind: "human", preset: "man", path: { curve: "linear", keys } });
const project = (props, actors = []) => ({ settings: { fps: 30, duration: 4 }, props, actors });
const placedOf = (props) => terrainAt(terrainOf(project(props)), 0);

test("only walkable built-in types count", () => {
  assert.ok(isTerrain("stairs") && isTerrain("steps") && isTerrain("ramp") && isTerrain("stage"));
  assert.ok(!isTerrain("table") && !isTerrain("constructor"));
  assert.equal(terrainOf(project([prop("t", "table", [0, 0, 0])])).length, 0);
});

test("stairs: feet stand on treads, the body rides a smooth line, floor outside", () => {
  const P = placedOf([prop("s", "stairs", [0, 0, 0])]), D = STAIRS.n * STAIRS.run;
  near(groundAt(P, 0, D / 2 - 0.01, "foot"), STAIRS.rise); // first tread
  near(groundAt(P, 0, -D / 2 + 0.01, "foot"), STAIRS.n * STAIRS.rise); // top tread
  near(groundAt(P, 0, D / 2 + 0.1, "foot"), 0); // in front of the first step
  near(groundAt(P, 0, -D / 2 + 0.01, "root"), 1.4);
  near(groundAt(P, 2, 0), 0); // beside the stairs
  // the body line rises evenly: the same height change for the same distance
  near(groundAt(P, 0, 0) - groundAt(P, 0, 0.2), groundAt(P, 0, 0.4) - groundAt(P, 0, 0.6));
});

test("placement: position, yaw and per-axis scale", () => {
  near(groundAt(placedOf([prop("g", "stage", [5, 0, 0])]), 5, 0), STAGE.height);
  near(groundAt(placedOf([prop("g", "stage", [5, 0, 0])]), 0, 0), 0);
  near(groundAt(placedOf([prop("g", "stage", [0, 0.5, 0])]), 0, 0), 0.5 + STAGE.height); // raised by its path
  near(groundAt(placedOf([prop("g", "stage", [0, 0, 0], { scale: [1, 2, 1] })]), 0, 0), STAGE.height * 2);
  // ramp turned 180 degrees: the high end now faces +Z
  const R = placedOf([prop("r", "ramp", [0, 0, 0], { yaw: 180, facing: "fixed" })]);
  near(groundAt(R, 0, RAMP.depth / 2 - 0.01), RAMP.height, 0.01);
  near(groundAt(R, 0, -RAMP.depth / 2 + 0.01), 0, 0.01);
  // the highest surface wins where two props overlap
  near(groundAt(placedOf([prop("a", "ramp", [0, 0, 0]), prop("b", "stage", [0, 0, 0])]), 0, 1), STAGE.height);
});

test("carried props are not walkable", () => {
  assert.equal(terrainOf(project([prop("s", "stage", [0, 0, 0], { attach: { actor: "x" } })])).length, 0);
});

test("warnings: straight onto a stage edge, not up the steps", () => {
  const stage = prop("stage", "stage", [0, 0, 0]);
  const edge = terrainWarnings(project([stage], [actor("a", [{ t: 0, v: [0, 0, 3] }, { t: 3, v: [0, 0, 0] }])]));
  assert.equal(edge.length, 1);
  assert.match(edge[0], /直接跨上 0\.6 公尺高的物品「stage」/);
  // steps against the front edge (top tread meets the stage at z = 1.5)
  const steps = prop("steps", "steps", [0, 0, 1.5 + 0.6]);
  assert.deepEqual(terrainWarnings(project([stage, steps], [actor("a", [{ t: 0, v: [0, 0, 3.5] }, { t: 3, v: [0, 0, 0] }])])), []);
  // walking off the back of the stage drops
  assert.match(terrainWarnings(project([stage], [actor("a", [{ t: 0, v: [0, 0, 0] }, { t: 3, v: [0, 0, -3] }])]))[0], /直接掉下/);
  // no walkable props: nothing to check
  assert.deepEqual(terrainWarnings(project([], [actor("a", [{ t: 0, v: [0, 0, 0] }])])), []);
});
