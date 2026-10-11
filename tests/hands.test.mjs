// node --test tests/*.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { handsAt, heldHands, dominantClip } from "../runtime/hands.js";

const never = () => false, always = () => true;
const clip = (type, start, dur, extra = {}) => ({ type, start, dur, ...extra });
const human = (extra = {}) => ({ id: "a", kind: "human", actions: [], upper: [], ...extra });

test("relaxed by default, the actor's own hands next", () => {
  assert.deepEqual(handsAt(human(), 1, never), { l: "relaxed", r: "relaxed" });
  assert.deepEqual(handsAt(human({ hands: { r: "fist" } }), 1, never), { l: "relaxed", r: "fist" });
});

test("an action brings its usual shape only while it shows", () => {
  const a = human({ upper: [clip("point", 1, 2)] });
  assert.equal(handsAt(a, 0.5, never).r, "relaxed"); // before
  assert.equal(handsAt(a, 1.1, never).r, "relaxed"); // first half of the blend-in
  assert.equal(handsAt(a, 1.2, never).r, "point");
  assert.equal(handsAt(a, 3.1, never).r, "point"); // first half of the fade-out
  assert.equal(handsAt(a, 3.2, never).r, "relaxed");
  assert.equal(handsAt(a, 9, always).r, "point"); // held clips keep it
});

test("layers: upper over full body, held props over usual shapes, a clip's own hands over everything", () => {
  const a = human({ actions: [clip("punch", 0, 4)], upper: [clip("wave", 1, 2)] });
  assert.deepEqual(handsAt(a, 0.5, never), { l: "fist", r: "fist" });
  assert.deepEqual(handsAt(a, 2, never), { l: "fist", r: "open" });
  assert.deepEqual(handsAt(a, 2, never, { r: "fist" }), { l: "fist", r: "fist" });
  const b = human({ upper: [clip("wave", 1, 2, { hands: { r: "thumbsUp" } })] });
  assert.equal(handsAt(b, 2, never, { r: "fist" }).r, "thumbsUp");
  // a pose clip has no usual shape, only what it says
  assert.deepEqual(handsAt(human({ upper: [clip("pose", 0, 2, { hands: { l: "open" } })] }), 1, never), { l: "open", r: "relaxed" });
  // unknown names are ignored (validate reports them)
  assert.equal(handsAt(human({ hands: { r: "claw" } }), 1, never).r, "relaxed");
});

test("a later clip takes over halfway into its blend", () => {
  const clips = [clip("wave", 0, 4), clip("clap", 2, 2, { blend: 0.4 })];
  assert.equal(dominantClip(clips, 2.1, never).type, "wave");
  assert.equal(dominantClip(clips, 2.25, never).type, "clap");
  // a finished clip that does not hold fades to the base, not to the clip before it
  assert.equal(dominantClip(clips, 4.5, never), null);
});

test("held props close the hand that holds them", () => {
  const props = [
    { id: "cup", type: "cup", attach: { actor: "a", from: 1, to: 3 } },
    { id: "bag", type: "bag", attach: [{ actor: "b", from: 0, to: 2 }, { actor: "a", joint: "lHand", from: 2 }] },
    { id: "box", type: "box", attach: { actor: "a", joint: "chest" } },
  ];
  const holdable = (o) => o.type !== "box";
  assert.deepEqual(heldHands(props, "a", 0.5, holdable), {});
  assert.deepEqual(heldHands(props, "a", 2.5, holdable), { l: "fist", r: "fist" });
  assert.deepEqual(heldHands(props, "a", 3, holdable), { l: "fist" }); // `to` is exclusive
  assert.deepEqual(heldHands(props, "b", 1, holdable), { r: "fist" });
});

test("a grip with its own shape sets that shape instead of a fist", () => {
  const props = [{ id: "kid", type: "baby", attach: { actor: "a" } }, { id: "p", type: "phone", attach: { actor: "a", joint: "lHand" } }];
  const holdable = (o) => (o.type === "baby" ? { shape: "open" } : {});
  assert.deepEqual(heldHands(props, "a", 0, holdable), { r: "open", l: "fist" });
});
