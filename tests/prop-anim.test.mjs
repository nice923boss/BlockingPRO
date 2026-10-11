// node --test tests/
import test from "node:test";
import assert from "node:assert/strict";
import { animateProp, stateAt, fanTurns, FAN_RPS, PEDAL_RUN, STATE_TYPES } from "../runtime/prop-anim.js";
import { terrainOf, terrainAt, groundAt, isTerrain, ELEVATOR } from "../runtime/terrain.js";

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);
const node = () => ({ rotation: { x: 0, y: 0, z: 0 }, position: { x: 0, y: 0, z: 0 } });
const keys = (...pairs) => pairs.map(([t, v, e]) => ({ t, v, e: e || "linear" }));

test("state: sampled from keys, clamped to 0..1, 0 when missing", () => {
  const spec = { state: keys([1, 0], [2, 1]) };
  near(stateAt(spec, 0), 0);
  near(stateAt(spec, 1.5), 0.5);
  near(stateAt(spec, 9), 1);
  near(stateAt({}, 3), 0);
  near(stateAt({ state: 0.4 }, 3), 0.4);
  near(stateAt({ state: keys([0, -1], [1, 3]) }, 0), 0);
  near(stateAt({ state: keys([0, -1], [1, 3]) }, 1), 1);
  assert.deepEqual(Object.keys(STATE_TYPES).sort(), ["door", "elevator", "fan"]);
});

test("door leaf swings 90 degrees at state 1; elevator doors slide by dx", () => {
  const leaf = node(), a = node(), b = node();
  const mesh = { userData: { leaf, slide: [{ obj: a, x0: -0.25, dx: -0.47 }, { obj: b, x0: 0.25, dx: 0.47 }] }, scale: { y: 1 } };
  const spec = { state: keys([0, 0], [1, 1]) };
  animateProp(mesh, spec, 0.5, () => assert.fail("no wheels, ride() is not needed"));
  near(leaf.rotation.y, Math.PI / 4);
  near(a.position.x, -0.25 - 0.235);
  near(b.position.x, 0.25 + 0.235);
  animateProp(mesh, spec, 2, () => null);
  near(leaf.rotation.y, Math.PI / 2);
});

test("fan: turns are the state integrated over time", () => {
  near(fanTurns({ state: 1 }, 2), 2 * FAN_RPS);
  near(fanTurns({}, 5), 0);
  // ramp 0 -> 1 over 2 s, then full: 1 s worth of full speed during the ramp, plus 1 s
  near(fanTurns({ state: keys([0, 0], [2, 1]) }, 3), 2 * FAN_RPS, 1e-3);
  // switched off at 1 s over 1 s: area 1 + 0.5
  near(fanTurns({ state: keys([0, 1], [1, 1], [2, 0]) }, 4), 1.5 * FAN_RPS, 1e-3);
  const hub = node();
  animateProp({ userData: { fan: hub } }, { state: 1 }, 1, () => null);
  near(hub.rotation.z, -FAN_RPS * Math.PI * 2);
});

test("wheels roll by distance over radius (scaled); crank turns only while ridden", () => {
  const w = node(), crank = node(), pedal = node();
  const mesh = { userData: { spin: [{ obj: w, r: 0.355 }], crank: { obj: crank, pedals: [pedal], a0: Math.atan2(-0.1, 0.12) } }, scale: { y: 2 } };
  animateProp(mesh, {}, 0, () => ({ dist: 1.42, ridden: false }));
  near(w.rotation.x, 1.42 / 0.71);
  near(crank.rotation.x, 0);
  animateProp(mesh, {}, 0, () => ({ dist: 2.5, ridden: true }));
  const a = Math.PI - Math.atan2(-0.1, 0.12); // half a pedal turn after 2.5 m
  near(crank.rotation.x, a);
  near(pedal.rotation.x, -a);
  assert.equal(PEDAL_RUN, 5);
});

test("crank matches the ride action's right pedal: offset -0.156 (cos a, sin a) with a = dist / 5 turns", () => {
  const a0 = Math.atan2(-0.1, 0.12);
  for (const dist of [0, 0.7, 1.9, 3.3]) {
    const crank = node();
    animateProp({ userData: { crank: { obj: crank, pedals: [], a0 } } }, {}, 0, () => ({ dist, ridden: true }));
    // built right crank end (y, z) = (-0.12, 0.1), rotated about +X by the crank angle
    const th = crank.rotation.x, y = -0.12 * Math.cos(th) - 0.1 * Math.sin(th), z = -0.12 * Math.sin(th) + 0.1 * Math.cos(th);
    const a = (dist / 5) * Math.PI * 2;
    near(y, -0.156 * Math.cos(a), 2e-3);
    near(z, -0.156 * Math.sin(a), 2e-3);
  }
});

test("elevator floor is walkable and lifts whoever stands inside as its path rises", () => {
  assert.ok(isTerrain("elevator"));
  const lift = { id: "e", type: "elevator", yaw: 0, facing: "fixed", scale: 1, path: { curve: "linear", keys: [{ t: 0, v: [0, 0, 0] }, { t: 4, v: [0, 3, 0] }] } };
  const terrain = terrainOf({ props: [lift] });
  near(groundAt(terrainAt(terrain, 0), 0.3, 0.2), ELEVATOR.floor);
  near(groundAt(terrainAt(terrain, 2), 0.3, 0.2), 1.5 + ELEVATOR.floor);
  near(groundAt(terrainAt(terrain, 4), 0, 0), 3 + ELEVATOR.floor);
  near(groundAt(terrainAt(terrain, 4), 0, ELEVATOR.depth / 2 + 0.1), 0); // just outside the door
});
