// node --test tests/
import test from "node:test";
import assert from "node:assert/strict";
import { buildPath, samplePath, sampleKeys, sampleYaw, setSegmentSpeed, segmentSpeeds, sampleSpeed, lerpAngle, simplifyTrack } from "../runtime/keys.js";

const near = (a, b, eps = 1e-3) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);

test("linear path keeps constant speed per segment", () => {
  const p = buildPath([{ t: 0, v: [0, 0, 0] }, { t: 2, v: [4, 0, 0] }, { t: 3, v: [4, 0, 4] }], "linear");
  near(samplePath(p, 1).pos[0], 2);
  near(samplePath(p, 2.5).pos[2], 2);
  assert.deepEqual(segmentSpeeds(p).map((x) => Math.round(x)), [2, 4]);
});

test("smooth path passes through keys and distance grows monotonically", () => {
  const p = buildPath([{ t: 0, v: [0, 0, 0] }, { t: 2, v: [3, 0, 1] }, { t: 4, v: [3, 0, 5] }, { t: 6, v: [0, 0, 6] }]);
  for (const k of p.keys) samplePath(p, k.t).pos.forEach((x, i) => near(x, k.v[i]));
  let last = -1;
  for (let t = 0; t <= 6; t += 0.05) { const d = samplePath(p, t).dist; assert.ok(d >= last - 1e-9); last = d; }
  near(samplePath(p, 6).dist, p.total);
});

test("arc-length parameterisation gives even spacing on linear easing", () => {
  const p = buildPath([{ t: 0, v: [0, 0, 0] }, { t: 1, v: [1, 0, 0] }, { t: 2, v: [1, 0, 3] }, { t: 3, v: [4, 0, 3] }]);
  const seg = p.segs[1];
  const d = [0.25, 0.5, 0.75].map((f) => samplePath(p, 1 + f).dist - seg.d0);
  d.forEach((x, k) => near(x, seg.len * (k + 1) * 0.25, 1e-6));
});

test("stationary segment holds position and facing", () => {
  const p = buildPath([{ t: 0, v: [0, 0, 0] }, { t: 2, v: [2, 0, 0] }, { t: 4, v: [2, 0, 0] }]);
  near(samplePath(p, 3).pos[0], 2);
  near(sampleYaw(p, 3.5), 90, 0.5);
  near(sampleYaw(p, 1), 90, 0.5);
  near(sampleSpeed(p, 3), 0);
});

test("yaw on keys turns the actor while standing", () => {
  const p = buildPath([{ t: 0, v: [0, 0, 0] }, { t: 1, v: [0, 0, 0], yaw: 0 }, { t: 2, v: [0, 0, 0], yaw: 180 }]);
  near(sampleYaw(p, 0.5, 0, "path", 0), 0, 0.5);
  near(Math.abs(sampleYaw(p, 2.5, 0, "path", 0)), 180, 0.5);
});

test("setSegmentSpeed retimes later keys", () => {
  const keys = [{ t: 0, v: [0, 0, 0] }, { t: 2, v: [4, 0, 0] }, { t: 3, v: [8, 0, 0] }];
  const out = setSegmentSpeed(keys, 0, 1, "linear");
  assert.deepEqual(out.map((k) => k.t), [0, 4, 5]);
  assert.equal(keys[1].t, 2);
});

test("scalar and vector tracks, easing, constants", () => {
  near(sampleKeys([{ t: 0, v: 10 }, { t: 2, v: 20 }], 1), 15);
  near(sampleKeys([{ t: 0, v: 10, e: "inOut" }, { t: 2, v: 20 }], 0.5), 11.5625);
  assert.deepEqual(sampleKeys([{ t: 0, v: [0, 0, 0] }, { t: 1, v: [2, 4, 6] }], 0.5), [1, 2, 3]);
  assert.equal(sampleKeys(35, 3), 35);
  assert.equal(sampleKeys(undefined, 3, 50), 50);
  near(sampleKeys([{ t: 0, v: 1, e: "hold" }, { t: 1, v: 2 }], 0.99), 1);
  near(lerpAngle(170, -170, 0.5), 180);
});

test("custom bezier curves match the named easings and clamp on normalise", async () => {
  const { ease, CURVE_OF, normEase, easeLabel, isCurve } = await import("../runtime/keys.js");
  for (const [name, c] of Object.entries(CURVE_OF)) {
    for (let s = 0; s <= 1; s += 0.1) near(ease(c, s), ease(name, s), 1e-4);
  }
  near(ease([0.2, 0.8, 0.3, 1], 0), 0);
  near(ease([0.2, 0.8, 0.3, 1], 1), 1);
  assert.ok(ease([0.2, 0.8, 0.3, 1], 0.3) > 0.5);
  assert.deepEqual(normEase([1.5, 3, -0.2, 0.12345]), [1, 2, 0, 0.123]);
  assert.equal(normEase("bogus"), "linear");
  assert.equal(normEase([0, 1, 2]), "linear");
  assert.equal(easeLabel([0, 0, 1, 1]), "自訂曲線");
  assert.equal(easeLabel("out"), "漸慢");
  assert.ok(!isCurve("inOut"));
  near(sampleKeys([{ t: 0, v: 0, e: [1 / 3, 0, 2 / 3, 1] }, { t: 2, v: 10 }], 0.5), sampleKeys([{ t: 0, v: 0, e: "inOut" }, { t: 2, v: 10 }], 0.5), 1e-3);
  const p = buildPath([{ t: 0, v: [0, 0, 0], e: [0.9, 0, 1, 0.1] }, { t: 1, v: [10, 0, 0] }], "linear");
  assert.ok(samplePath(p, 0.5).pos[0] < 1);
});

test("simplifyTrack turns a recorded orbit into sparse keys that replay within 5 cm", () => {
  const samples = [];
  for (let i = 0; i <= 150; i++) { const t = i / 30; samples.push({ t, v: [3 * Math.sin(t * 0.8), 1.5, 3 * Math.cos(t * 0.8)] }); }
  const keys = simplifyTrack(samples, 0.03);
  assert.ok((keys.length - 1) / (5 / 0.25) <= 1, `${keys.length} keys`);
  const path = buildPath(keys, "smooth");
  for (const s of samples) assert.ok(Math.hypot(...samplePath(path, s.t).pos.map((x, k) => x - s.v[k])) <= 0.05);
  // a straight constant-speed move needs only its two ends
  const line = samples.map((s) => ({ t: s.t, v: [s.t, 1.6, 0] }));
  assert.equal(simplifyTrack(line, 0.03).length, 2);
});
