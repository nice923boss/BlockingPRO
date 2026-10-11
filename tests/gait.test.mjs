// node --test tests/*.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { GAIT_STYLES, gaitStyle, withPosture } from "../runtime/gait-style.js";

test("normal style at amp 1 leaves the default cycle alone", () => {
  const s = gaitStyle({});
  for (const k of ["stride", "knee", "arm", "twist", "sway"]) assert.equal(s[k], 1);
  for (const k of ["elbow", "spine", "chest", "neck", "head"]) assert.equal(s[k], 0);
  assert.deepEqual(gaitStyle({ style: "nope" }), s); // unknown names fall back (validate reports them)
});

test("amp scales stride, swing and twist together, the knee by its square root, and is clamped", () => {
  const s = gaitStyle({ amp: 1.44 });
  assert.equal(s.stride, 1.44);
  assert.equal(s.arm, 1.44);
  assert.ok(Math.abs(s.knee - 1.2) < 1e-9);
  assert.equal(gaitStyle({ amp: 9 }).stride, 1.5);
  assert.equal(gaitStyle({ amp: 0 }).stride, 0.5);
  assert.equal(gaitStyle({ style: "tired", amp: 1 }).stride, 0.8);
});

test("every listed style has its factors", () => {
  for (const k of Object.keys(GAIT_STYLES)) assert.notEqual(gaitStyle({ style: k }).stride, undefined, k);
});

test("posture adds pitch to the torso and head without touching the input", () => {
  const rot = { chest: [2, -5, 0] };
  const out = withPosture(rot, gaitStyle({ style: "tired" }));
  assert.deepEqual(rot, { chest: [2, -5, 0] });
  assert.deepEqual(out.chest, [8, -5, 0]);
  assert.deepEqual(out.head, [10, 0, 0]);
  assert.deepEqual(withPosture(rot, gaitStyle({})), rot);
});
