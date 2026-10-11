// node --test tests/*.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { buildPath } from "../runtime/keys.js";
import { buildGaitTrack, sampleGaitTrack, strideFactors, turnBody, TRACK_DT } from "../runtime/gait-track.js";

const BAND = { walk: [0.1, 0.5], run: [2.2, 3.0] };
const opts = (end, extra = {}) => ({ end, height: 1.7, walkLen: 1.36, runLen: 2.55, band: BAND, yaw: 0, facing: "path", ...extra });
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ""} ${a} vs ${b}`);

test("stride factors: 1 at the reference walk speed, shorter steps when slow, clamped at both ends", () => {
  near(strideFactors(1.3, 1.7).walk, 1, 1e-9);
  near(strideFactors(4, 1.7).run, 1, 1e-9);
  assert.ok(strideFactors(0.6, 1.7).walk < 0.7);
  assert.equal(strideFactors(0, 1.7).walk, 0.6);
  assert.equal(strideFactors(9, 1.7).walk, 1.25);
  assert.equal(strideFactors(0, 1.7).run, 0.75);
  assert.equal(strideFactors(20, 1.7).run, 1.4);
  // a child reaches the same factor at a lower speed
  near(strideFactors(1.3 * Math.sqrt(1.1 / 1.7), 1.1).walk, 1, 1e-9);
});

test("constant walking speed advances the clock by distance over stride length", () => {
  const path = buildPath([{ t: 0, v: [0, 0, 0] }, { t: 10, v: [13, 0, 0] }], "linear");
  const tr = buildGaitTrack(path, opts(10));
  // 1.3 m/s gives stride factor 1, so mid-path cycles per second = 1.3 / 1.36
  const rate = (sampleGaitTrack(tr, 7).cycle - sampleGaitTrack(tr, 3).cycle) / 4;
  near(rate, 1.3 / 1.36, 0.01, "cycles per second");
  // monotonic, and holds still after the last key
  for (let i = 1; i < tr.n; i++) assert.ok(tr.cycle[i] >= tr.cycle[i - 1]);
  near(sampleGaitTrack(tr, 10.4).cycle, sampleGaitTrack(tr, 10.2).cycle, 1e-6);
});

test("slow walking takes quicker steps than distance alone would give", () => {
  const path = buildPath([{ t: 0, v: [0, 0, 0] }, { t: 10, v: [6, 0, 0] }], "linear");
  const rate = ((t) => (sampleGaitTrack(t, 7).cycle - sampleGaitTrack(t, 3).cycle) / 4)(buildGaitTrack(path, opts(10)));
  assert.ok(rate > 0.6 / 1.36 * 1.3, `rate ${rate}`);
});

test("the clock is continuous through the walk-run blend", () => {
  const path = buildPath([{ t: 0, v: [0, 0, 0] }, { t: 2, v: [2.6, 0, 0] }, { t: 4, v: [9, 0, 0] }, { t: 6, v: [17, 0, 0] }], "linear");
  const tr = buildGaitTrack(path, opts(6));
  let maxStep = 0;
  for (let i = 1; i < tr.n; i++) maxStep = Math.max(maxStep, tr.cycle[i] - tr.cycle[i - 1]);
  // even at 4 m/s one 1/60 s sample moves the clock by well under a tenth of a cycle
  assert.ok(maxStep < 0.05, `max step ${maxStep}`);
});

test("turning on the spot advances the clock and reports the turn rate", () => {
  const path = buildPath([{ t: 0, v: [0, 0, 0], yaw: 0 }, { t: 1, v: [0, 0, 0], yaw: 0 }, { t: 2, v: [0, 0, 0], yaw: 120 }, { t: 3, v: [0, 0, 0], yaw: 120 }]);
  const tr = buildGaitTrack(path, opts(3, { facing: "fixed" }));
  near(sampleGaitTrack(tr, 0.8).cycle, 0, 0.02, "standing still (the yaw spline barely moves before the turn)");
  near(sampleGaitTrack(tr, 2.8).cycle, 1, 0.02, "120 degrees is one step cycle");
  assert.ok(sampleGaitTrack(tr, 1.5).turn > 60, "turning left is positive");
  near(sampleGaitTrack(tr, 2.8).turn, 0, 1e-9);
});

test("lean goes into the turn and grows with speed; the head leads; both are clamped", () => {
  assert.ok(turnBody(1.4, -50).lean < 0 && turnBody(1.4, 50).lean > 0);
  assert.ok(Math.abs(turnBody(3, 50).lean) > Math.abs(turnBody(1.4, 50).lean));
  assert.equal(turnBody(0, 180).lean, 0);
  assert.equal(turnBody(8, 400).lean, 12);
  assert.equal(turnBody(0, 40).look, 10);
  assert.equal(turnBody(0, -400).look, -30);
});

test("sampling clamps outside the track", () => {
  const path = buildPath([{ t: 0, v: [0, 0, 0] }, { t: 1, v: [1, 0, 0] }], "linear");
  const tr = buildGaitTrack(path, opts(1));
  assert.equal(sampleGaitTrack(tr, -1).cycle, tr.cycle[0]);
  assert.equal(sampleGaitTrack(tr, 99).cycle, tr.cycle[tr.n - 1]);
  assert.equal(tr.n, Math.ceil(1 / TRACK_DT) + 1);
});
