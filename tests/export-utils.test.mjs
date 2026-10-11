// node --test tests/
import test from "node:test";
import assert from "node:assert/strict";
import { crc32, zipParts } from "../runtime/zip.js";
import { pdfParts } from "../runtime/pdf.js";
import { shotRanges, splitRanges, describeMove, csvText, colorName, buildPrompts } from "../runtime/shotlist.js";

const join = (parts) => {
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
};

test("crc32 matches the standard check value", () => {
  assert.equal(crc32(new TextEncoder().encode("123456789")), 0xcbf43926);
});

test("zip has local headers, a central directory and the end record", () => {
  const data = new TextEncoder().encode("hello");
  const zip = join(zipParts([{ name: "鏡01.txt", data }, { name: "b.txt", data }], new Date(2026, 9, 10, 12, 0, 0)));
  const dv = new DataView(zip.buffer);
  assert.equal(dv.getUint32(0, true), 0x04034b50);
  const end = zip.length - 22;
  assert.equal(dv.getUint32(end, true), 0x06054b50);
  assert.equal(dv.getUint16(end + 10, true), 2);
  const cdAt = dv.getUint32(end + 16, true);
  assert.equal(dv.getUint32(cdAt, true), 0x02014b50);
  assert.equal(dv.getUint32(cdAt + 16, true), crc32(data));
  assert.equal(dv.getUint16(cdAt + 8, true) & 0x0800, 0x0800, "UTF-8 name flag");
});

test("shotRanges follows the cut list and clips to the duration", () => {
  const P = { settings: { duration: 10 }, cameras: [{ id: "a" }, { id: "b" }],
    cuts: [{ t: 4, camera: "b", note: "近" }, { t: 0, camera: "a" }, { t: 12, camera: "a" }] };
  assert.deepEqual(shotRanges(P).map((s) => [s.index, s.start, s.end, s.camera]), [[1, 0, 4, "a"], [2, 4, 10, "b"]]);
  assert.deepEqual(shotRanges({ ...P, cuts: [] }).map((s) => [s.start, s.end, s.camera]), [[0, 10, "a"]]);
});

test("splitRanges ends parts on cuts and splits long shots hard", () => {
  assert.deepEqual(splitRanges(12, [0, 4, 8], 15), [{ start: 0, end: 12 }]);
  assert.deepEqual(splitRanges(30, [0, 5, 11, 14.5, 20, 27], 15), [{ start: 0, end: 14.5 }, { start: 14.5, end: 27 }, { start: 27, end: 30 }]);
  assert.deepEqual(splitRanges(40, [0], 15), [{ start: 0, end: 15 }, { start: 15, end: 30 }, { start: 30, end: 40 }]);
});

test("describeMove names the common moves", () => {
  const st = (position, target, lens = 35, shake = 0) => ({ position, target, lens, shake });
  assert.equal(describeMove(st([0, 1.6, 6], [0, 1, 0]), st([0, 1.6, 6], [0, 1, 0])), "固定");
  assert.equal(describeMove(st([0, 1.6, 6], [0, 1, 0]), st([0, 1.6, 3], [0, 1, 0])), "推近");
  assert.equal(describeMove(st([0, 1.6, 3], [0, 1, 0]), st([0, 1.6, 6], [0, 1, 0])), "拉遠");
  assert.equal(describeMove(st([-3, 1.5, 4], [-3, 1, 0]), st([3, 1.5, 4], [3, 1, 0])), "橫移");
  assert.equal(describeMove(st([0, 1.6, 5], [0, 1, 0]), st([5, 1.6, 0], [0, 1, 0])), "環繞");
  assert.equal(describeMove(st([0, 0.6, 5], [0, 1, 0]), st([0, 4.5, 5], [0, 1, 0])), "升起");
  assert.equal(describeMove(st([0, 1.6, 5], [-3, 1, 0]), st([0, 1.6, 5], [3, 1, 0])), "搖鏡");
  assert.equal(describeMove(st([0, 1.6, 5], [0, 1, 0], 28, 0.6), st([0, 1.6, 5], [0, 1, 0], 85, 0.6)), "變焦推近＋手持");
  assert.equal(describeMove(st([0, 1.6, 5], [0, 1, 0]), st([1, 1.6, 6], [0, 1, 0]), true), "跟拍");
});

test("csvText starts with a BOM, uses CRLF and quotes commas and quotes", () => {
  const csv = csvText([{ index: 1, start: 0, end: 3.25, camName: "A 機", size: "全景", move: "固定", lens: 28, actors: ["小美", "阿傑"], note: "他說：\"嗨\"，然後走開", prompt: "a,b" }]);
  assert.ok(csv.startsWith("﻿鏡號,"));
  const lines = csv.slice(1).split("\r\n");
  assert.equal(lines.length, 3);
  assert.equal(lines[1], '1,0,3.25,3.25,A 機,全景,固定,28,小美、阿傑,"他說：""嗨""，然後走開","a,b"');
});

test("colorName gives rough names", () => {
  assert.equal(colorName("#e71d36"), "紅");
  assert.equal(colorName("#3d5a80"), "藍");
  assert.equal(colorName("#ffffff"), "白");
  assert.equal(colorName("#43aa8b"), "綠");
  assert.equal(colorName("#8b5a2b"), "棕");
  assert.equal(colorName(null), "白");
});

test("buildPrompts lists the cast and one line per shot", () => {
  const p = buildPrompts({
    cast: [{ name: "小美", kind: "成年女性", color: "#e71d36" }],
    scene: { lighting: "白天", props: ["長椅", "樹", "樹"], duration: 9, width: 1280, height: 720 },
    rows: [{ size: "全景", move: "固定", actors: ["小美"], note: "小美走進公園" }, { size: "特寫", move: "推近", actors: [], note: "" }],
  });
  assert.match(p.overall, /小美（成年女性，參考影片中的紅色人形）/);
  assert.match(p.overall, /長椅、樹。/);
  assert.deepEqual(p.shots, ["全景，固定，畫面中有小美。小美走進公園。", "特寫，推近，畫面中沒有角色。"]);
});

test("pdf has one page object per image and a valid xref", () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
  const pdf = new TextDecoder("latin1").decode(join(pdfParts([{ jpeg, width: 2, height: 2 }, { jpeg, width: 2, height: 2 }], "分鏡表")));
  assert.ok(pdf.startsWith("%PDF-1.4"));
  assert.match(pdf, /\/Count 2/);
  assert.match(pdf, /\/Title <FEFF520693E18868>/);
  const xref = +/startxref\n(\d+)/.exec(pdf)[1];
  assert.equal(pdf.slice(xref, xref + 4), "xref");
  const first = +/xref\n0 \d+\n0000000000 65535 f \n(\d{10})/.exec(pdf)[1];
  assert.equal(pdf.slice(first, first + 7), "1 0 obj");
});
