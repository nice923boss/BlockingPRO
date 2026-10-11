// node --test tests/*.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { wallRun, OPENINGS, isFullPiece, pieceRun, cutOpening, roomWalls } from "../runtime/walls.js";

const near = (a, b, eps = 0.002) => Math.abs(a - b) < eps;
const full = (list) => list.filter((o) => o.type === "wall" && isFullPiece(o.v, o.scale));
const front = (o) => [Math.sin((o.yaw * Math.PI) / 180), Math.cos((o.yaw * Math.PI) / 180)];

test("pieceRun gives back the run a wall piece was built from, in any direction", () => {
  for (const [a, b] of [[[0, 0], [6, 0]], [[-3, 2.5], [-3, -2.5]], [[1, 1], [-2.5, 4]], [[2, -1], [2, 3]]]) {
    const [w] = wallRun(a, b);
    const [ra, rb] = pieceRun(w.v, w.yaw, w.scale);
    assert.ok(near(ra[0], a[0]) && near(ra[1], a[1]) && near(rb[0], b[0]) && near(rb[1], b[1]), `${a} → ${b}: ${ra} → ${rb}`);
  }
});

test("isFullPiece keeps floor pieces and skips the fillers round openings", () => {
  const list = wallRun([0, 0], [6, 0], [{ type: "window", at: 2 }, { type: "door", at: 4.5 }]);
  assert.equal(full(list).length, 3);
  assert.ok(isFullPiece([0, 0, 0], 1));
  assert.ok(!isFullPiece([0, 0, 0], 1.2)); // a uniformly scaled wall is not 2.8 m high
});

test("cutOpening splits a piece round the opening and keeps its yaw and thickness", () => {
  const [w] = wallRun([-3, 2.5], [-3, -2.5]); // 5 m, yaw 90
  const thick = [w.scale[0], 1, 1.4];
  const list = cutOpening(w.v, w.yaw, thick, "door", 1);
  const door = list.find((o) => o.type === "door");
  assert.deepEqual(door.v, [-3, 0, 1.5]);
  assert.ok(list.every((o) => o.yaw === 90));
  assert.ok(list.filter((o) => o.type === "wall").every((o) => o.scale[2] === 1.4));
  // the full pieces plus the door still cover the 5 m
  const span = full(list).reduce((s, o) => s + o.scale[0] * 4, 0) + OPENINGS.door.w;
  assert.ok(near(span, 5, 0.01));
});

test("cutOpening moves an opening near the end inward and refuses a piece that is too short", () => {
  const [w] = wallRun([0, 0], [3, 0]);
  const win = cutOpening(w.v, w.yaw, w.scale, "window", 2.95).find((o) => o.type === "window");
  assert.ok(near(win.v[0], 3 - OPENINGS.window.w / 2 - 0.17)); // clear of a wall meeting at the corner
  // a piece just wider than the door centers it
  const [tight] = wallRun([0, 0], [1.1, 0]);
  assert.ok(near(cutOpening(tight.v, tight.yaw, tight.scale, "door", 0).find((o) => o.type === "door").v[0], 0.55));
  const [short] = wallRun([0, 0], [1, 0]);
  assert.equal(cutOpening(short.v, short.yaw, short.scale, "door", 0.5), null);
});

test("roomWalls: a closed room gets one wall per side, fronts facing inside, whichever way it was clicked", () => {
  const square = [[0, 0], [4, 0], [4, 3], [0, 3]];
  for (const pts of [square, [...square].reverse()]) {
    const walls = roomWalls(pts, true);
    assert.equal(walls.length, 4);
    for (const o of walls) {
      const [fx, fz] = front(o), cx = 2 - o.v[0], cz = 1.5 - o.v[2];
      assert.ok(fx * cx + fz * cz > 0, `wall at ${o.v} faces outside`);
    }
    // every side reaches half a thickness past both corners
    const lens = walls.map((o) => o.scale[0] * 4).sort((a, b) => a - b);
    assert.ok(near(lens[0], 3.17, 0.005) && near(lens[3], 4.17, 0.005), lens.join()); // scale keeps 3 decimals
  }
});

test("roomWalls: an open run only extends where walls meet, and repeated points are ignored", () => {
  const walls = roomWalls([[0, 0], [4, 0], [4, 0], [4, 3]]);
  assert.equal(walls.length, 2);
  const [a] = pieceRun(walls[0].v, walls[0].yaw, walls[0].scale);
  assert.ok(near(a[0], 0) && near(a[1], 0)); // the free end stays where it was clicked
  assert.ok(near(walls[0].scale[0] * 4, 4.085, 0.005));
  assert.deepEqual(roomWalls([[0, 0]]), []);
  assert.deepEqual(roomWalls([[0, 0], [2, 0]], true), []); // two points cannot close a room
  // clicking the first point again as the last one closes the ring without a zero-length wall
  assert.equal(roomWalls([[0, 0], [4, 0], [4, 3], [0, 0]], true).length, 3);
});
