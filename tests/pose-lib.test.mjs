// node --test tests/*.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { poseLib, fits, rigKey } from "../js/pose-lib.js";

const human = { kind: "human", type: "child", jointNames: ["hips", "head", "rUpperArm"] };
const dog = { kind: "animal", type: "dog", jointNames: ["body", "head", "tail1"] };
const entry = (rig, rot) => ({ id: "p", name: "n", rig, pose: { rot, hips: [0, 0, 0] } });

// the server answers every PUT with ok; the last body sent is kept for inspection
let sent = null;
globalThis.fetch = async (url, opts) => {
  sent = JSON.parse(opts.body);
  return { ok: true, json: async () => ({ ok: true }) };
};

test("every human body type shares one rig key, animals use their type", () => {
  assert.equal(rigKey(human), "human");
  assert.equal(rigKey({ ...human, type: "man" }), "human");
  assert.equal(rigKey(dog), "dog");
});

test("a pose fits only the same rig key with every rotated joint present", () => {
  assert.equal(fits(entry("human", { head: [0, 30, 0] }), human), true);
  assert.equal(fits(entry("human", { head: [0, 30, 0] }), dog), false);
  assert.equal(fits(entry("dog", { tail1: [10, 0, 0] }), dog), true);
  assert.equal(fits(entry("human", { lThigh: [10, 0, 0] }), human), false);
});

test("saving under a name already used on the same rig replaces it and keeps its id", async () => {
  poseLib.poses = [];
  await poseLib.add("指向", human, { rot: { rUpperArm: [-80, 0, 0] }, hips: [0, 0, 0] });
  const id = poseLib.poses[0].id;
  await poseLib.add("指向", dog, { rot: { head: [10, 0, 0] }, hips: [0, 0, 0] });
  await poseLib.add("指向", human, { rot: { rUpperArm: [-120, 0, 0] }, hips: [0, 0, 0] });
  assert.equal(poseLib.poses.length, 2);
  const h = poseLib.poses.find((p) => p.rig === "human");
  assert.equal(h.id, id);
  assert.deepEqual(h.pose.rot.rUpperArm, [-120, 0, 0]);
  assert.equal(sent.format, "blockingpro-poses");
  assert.equal(sent.poses.length, 2);
});

test("removing writes the list without that entry", async () => {
  const id = poseLib.poses[0].id;
  await poseLib.remove(id);
  assert.equal(poseLib.poses.length, 1);
  assert.equal(sent.poses.some((p) => p.id === id), false);
});

test("without a server (static hosting) the library is read from and saved to localStorage", async () => {
  const store = new Map();
  globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) };
  const urls = [];
  globalThis.fetch = async (url, opts) => {
    urls.push(url);
    if (opts?.method === "PUT") throw new Error("no PUT on a static host");
    if (url === "api/poses") return new Response("not found", { status: 404 });
    return new Response(JSON.stringify({ format: "blockingpro-poses", version: 1, poses: [entry("dog", { tail1: [5, 0, 0] })] }));
  };
  await poseLib.load();
  assert.equal(poseLib.local, true);
  assert.equal(poseLib.error, null);
  assert.deepEqual(urls, ["api/poses", "library/poses.json"]);
  assert.equal(poseLib.poses.length, 1);
  assert.equal(await poseLib.add("揮手", human, { rot: { head: [0, 10, 0] }, hips: [0, 0, 0] }), true);
  assert.equal(JSON.parse(store.get("blockingpro.poseLibrary")).poses.length, 2);
  urls.length = 0;
  await poseLib.load();
  assert.deepEqual(urls, ["api/poses"]);
  assert.equal(poseLib.poses.length, 2);
});
