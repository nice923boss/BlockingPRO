// node --test tests/
import test from "node:test";
import assert from "node:assert/strict";
import { gazeWeight, gazeAngles, mixGaze, GAZE_LIMITS } from "../runtime/gaze.js";

const seg = { start: 1, dur: 2, blend: 0.4 };

test("a segment turns in over blend, holds, then turns back after its end", () => {
  assert.equal(gazeWeight(seg, 0.9), 0);
  assert.equal(gazeWeight(seg, 1), 0);
  assert.ok(gazeWeight(seg, 1.2) > 0.4 && gazeWeight(seg, 1.2) < 0.6);
  assert.equal(gazeWeight(seg, 1.4), 1);
  assert.equal(gazeWeight(seg, 3), 1);
  assert.ok(gazeWeight(seg, 3.2) > 0.4 && gazeWeight(seg, 3.2) < 0.6);
  assert.equal(gazeWeight(seg, 3.4), 0);
});

test("angles: ahead, left, below, and clamped at the limits", () => {
  const ahead = gazeAngles(0, 0, 1);
  assert.ok(ahead.yaw === 0 && ahead.pitch === 0);
  assert.equal(Math.round(gazeAngles(1, 0, 1).yaw), 45);
  assert.equal(Math.round(gazeAngles(0, -1, 1).pitch), 45); // below = positive pitch (nose down)
  assert.equal(gazeAngles(-1, 0, -1).yaw, -GAZE_LIMITS.yaw); // behind on the right
  assert.equal(gazeAngles(0, 5, 1).pitch, -GAZE_LIMITS.up);
  assert.equal(gazeAngles(0, -5, 1).pitch, GAZE_LIMITS.down);
});

test("mix: nothing on gives null; a later segment takes over without lowering the strength", () => {
  assert.equal(mixGaze([]), null);
  assert.equal(mixGaze([{ w: 0, yaw: 10, pitch: 0 }]), null);
  assert.deepEqual(mixGaze([{ w: 0.5, yaw: 10, pitch: 4 }]), { yaw: 10, pitch: 4, w: 0.5 });
  // back to back: the first turning back while the second turns in keeps full strength
  const m = mixGaze([{ w: 0.5, yaw: -40, pitch: 0 }, { w: 0.5, yaw: 40, pitch: 0 }]);
  assert.deepEqual(m, { yaw: 0, pitch: 0, w: 1 });
  assert.equal(mixGaze([{ w: 1, yaw: -40, pitch: 0 }, { w: 1, yaw: 40, pitch: 10 }]).yaw, 40);
});
