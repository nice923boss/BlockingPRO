// node --test tests/*.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { shareRows, shareHtml } from "../runtime/share.js";

const P = {
  name: "借傘 <第1場>",
  settings: { width: 1280, height: 720, fps: 30, duration: 10 },
  actors: [{ id: "mei", name: "小雯" }],
  cameras: [{ id: "camA", name: "A 機" }, { id: "camB", name: "B 機" }],
  cuts: [{ t: 0, camera: "camA", note: "全景" }, { t: 4, camera: "camB", note: "近景 </td><b>x</b>" }, { t: 7, camera: "camA", note: "" }],
  subtitles: [{ t: 1, dur: 2, text: "你好", actor: "mei" }, { t: 8, dur: 1, text: "</script><script>alert(1)</script>" }],
};

test("the whole program gives every shot and subtitle", () => {
  const { shots, subs } = shareRows(P, { start: 0, end: 10 });
  assert.deepEqual(shots.map((s) => [s.index, s.start, s.end, s.camera]), [[1, 0, 4, "A 機"], [2, 4, 7, "B 機"], [3, 7, 10, "A 機"]]);
  assert.deepEqual(subs[0], { t: 1, dur: 2, text: "你好", who: "小雯" });
});

test("a custom range keeps the shot numbers and shifts the times to the video start", () => {
  const { shots, subs } = shareRows(P, { start: 5, end: 8.5 });
  assert.deepEqual(shots.map((s) => [s.index, s.start, s.end]), [[2, 0, 2], [3, 2, 3.5]]);
  assert.deepEqual(subs.map((s) => s.t), [3]);
});

test("one camera is one row for the whole video", () => {
  const { shots } = shareRows(P, { start: 2, end: 6, camera: "camB" });
  assert.deepEqual(shots, [{ index: 1, start: 0, end: 4, camera: "B 機", note: "" }]);
});

test("names, notes and subtitles cannot break out of the page", () => {
  const html = shareHtml(P, { base64: "AAAA", mime: "video/mp4", start: 0, end: 10, exportedAt: "2026-10-11 14:00" });
  assert.match(html, /<title>借傘 &lt;第1場&gt; 預演<\/title>/);
  assert.match(html, /近景 &lt;\/td&gt;&lt;b&gt;x&lt;\/b&gt;/);
  assert.equal(html.includes("</script><script>alert"), false);
  assert.equal((html.match(/<\/script>/g) || []).length, 2); // the video data and the player script only
  assert.match(html, /type: "video\/mp4"/);
  assert.match(html, /2026-10-11 14:00 由 BlockingPRO 輸出/);
});

test("burned-in subtitles are not repeated under the video", () => {
  const html = shareHtml(P, { base64: "AAAA", mime: "video/mp4", start: 0, end: 10, showSubs: false });
  assert.match(html, /const subs = \[\];/);
});
