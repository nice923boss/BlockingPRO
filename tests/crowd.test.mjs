// node --test tests/*.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { planCrowd, rng } from "../runtime/crowd.js";
import { buildPath, samplePath } from "../runtime/keys.js";

const area = { x: 2, z: -1, w: 8, d: 6 };
const D = 12;
const positions = (keys) => { const p = buildPath(keys, "linear"); const out = []; for (let t = 0; t <= D + 1e-6; t += 0.1) out.push(samplePath(p, t).pos); return out; };

test("the same seed plans the same crowd", () => {
  const a = planCrowd({ count: 6, area, duration: D, seed: 7 });
  const b = planCrowd({ count: 6, area, duration: D, seed: 7 });
  assert.deepEqual(a, b);
  assert.notDeepEqual(a.walkers[0].keys, planCrowd({ count: 6, area, duration: D, seed: 8 }).walkers[0].keys);
  assert.ok(rng(1)() >= 0 && rng(1)() < 1);
});

test("walkers stay inside the area, keep walking speed and last the whole scene", () => {
  const { walkers, skipped } = planCrowd({ count: 8, area, duration: D, speed: 1.2, seed: 3 });
  assert.equal(walkers.length + skipped, 8);
  assert.ok(walkers.length >= 6);
  for (const w of walkers) {
    for (const k of w.keys) {
      assert.ok(Math.abs(k.v[0] - area.x) <= area.w / 2 + 0.01 && Math.abs(k.v[2] - area.z) <= area.d / 2 + 0.01);
      assert.equal(k.v[1], 0);
    }
    for (let i = 1; i < w.keys.length; i++) {
      const a = w.keys[i - 1], b = w.keys[i], dt = b.t - a.t;
      assert.ok(dt > 0);
      assert.ok(Math.hypot(b.v[0] - a.v[0], b.v[2] - a.v[2]) / dt < 1.2 * 1.15 + 0.05); // 0.85 to 1.15 times the average
    }
    assert.ok(w.keys.length >= 3);
    assert.ok(["man", "woman", "elder", "child", "bulky"].includes(w.preset));
    assert.ok(w.size >= 0.95 && w.size <= 1.05);
  }
});

test("walkers keep 0.6 m from each other and from people already there", () => {
  const still = [[2, -1]]; // someone standing in the middle of the area
  const { walkers } = planCrowd({ count: 10, area, duration: D, seed: 11, others: () => still });
  const tracks = walkers.map((w) => positions(w.keys));
  for (let j = 0; j < tracks[0].length; j++) {
    for (let a = 0; a < tracks.length; a++) {
      assert.ok(Math.hypot(tracks[a][j][0] - 2, tracks[a][j][2] + 1) >= 0.6);
      for (let b = a + 1; b < tracks.length; b++) assert.ok(Math.hypot(tracks[a][j][0] - tracks[b][j][0], tracks[a][j][2] - tracks[b][j][2]) >= 0.6);
    }
  }
});

test("walkers never step into blocked spots, and a full area gives skipped walkers", () => {
  const table = (x, z) => Math.abs(x - 2) < 1.2 && Math.abs(z + 1) < 0.8;
  const { walkers } = planCrowd({ count: 6, area, duration: D, seed: 5, blocked: table });
  for (const w of walkers) for (const p of positions(w.keys)) assert.equal(table(p[0], p[2]), false);
  const tiny = planCrowd({ count: 10, area: { x: 0, z: 0, w: 2, d: 2 }, duration: D, seed: 2, tries: 10 });
  assert.ok(tiny.skipped > 0);
  assert.equal(tiny.walkers.length + tiny.skipped, 10);
});
