// Procedural animal mannequins. Dog, cat, horse, rabbit, cow and sheep share one quadruped builder,
// pigeon, chicken and duck one bird builder; per-type proportions are in animal-specs.js. Same two looks as rig-human.js: the white model
// (ellipsoids, tapered limbs) and the joint view (spheres + sticks, left blue / right red / centre yellow).
// Units are meters, Y is up, the animal faces +Z, so its left side is +X. Every joint has identity
// rotation at rest; the root group sits on the ground and joint 0 ("body") carries the trunk.
// Quadruped: body (at the hip joints) > spine (mid back) > chest (shoulders) > neck > head;
//   body > tail1 > tail2 > tail3; legs l|r + Front|Back + Upper (shoulder / hip) > Lower (elbow / stifle)
//   > Foot (wrist / hock, ends at the toe). Bird: body > neck > head; body > tail;
//   l|rWing > l|rWingTip; l|rLeg > l|rShank > l|rFoot (toes).
// Rotation sign guide (Euler degrees local to the parent):
//   X  legs: +X = swing backward. Front Lower -X = flex (elbow, forearm swings forward), Front Foot +X = flex
//      (paw folds back); Back Lower +X = flex (stifle), Back Foot -X = flex (hock closes);
//      bird Shank -X = flex, bird Foot +X = curl toes.
//      body, spine, chest, neck, head: +X = pitch nose down. tail: +X = lift.
//   Y  +Y = turn toward the animal's left (head looks left); tail +Y swings the tip to the right.
//   Z  left limbs +Z = swing outward (right limbs -Z); body +Z = roll onto the right side.
//   Bird wings rest spread (left along +X, right along -X, chord along Z): lWing +Z = wing up, rWing -Z.
//   Folded wing: lWing [64, 0, -82] + lWingTip [0, 15, -6]; right side rWing [64, 0, 82] + rWingTip [0, -15, 6].
import * as THREE from "three";
import { QUADS, HEADS, BIRDS } from "./animal-specs.js";

const SIDE_COLORS = { c: "#ffd23f", l: "#3fa7ff", r: "#ff5a3f" };
const BALL = new THREE.SphereGeometry(1, 20, 14);
const UP = new THREE.Vector3(0, 1, 0);

const tiltX = ([x, y, z], a) => [x, y * Math.cos(a) - z * Math.sin(a), y * Math.sin(a) + z * Math.cos(a)];

function quadLayout(t) {
  const L = {}, tips = {};
  L.body = [null, [0, t.hipY, -t.half]];
  L.spine = ["body", [0, t.spineDy, t.half]];
  L.chest = ["spine", [0, t.chestDy, t.half]];
  L.neck = ["chest", [0, ...t.neckBase]];
  L.head = ["neck", [0, ...t.neck]];
  tips.head = tiltX(HEADS[t.head].nose, HEADS[t.head].tilt);
  let parent = "body", off = [0, ...t.tailBase];
  t.tail.forEach((b, i) => { const n = "tail" + (i + 1); L[n] = [parent, off]; parent = n; off = [0, ...b]; });
  tips[parent] = off;
  const sY = t.hipY + t.spineDy + t.chestDy + t.shoulder[0], hY = t.hipY + t.hip[0];
  for (const [s, x] of [["l", t.w], ["r", -t.w]]) {
    for (const [end, par, at, bones, y0] of [["Front", "chest", t.shoulder, t.front, sY], ["Back", "body", t.hip, t.back, hY]]) {
      const n = s + end;
      L[n + "Upper"] = [par, [x, ...at]];
      L[n + "Lower"] = [n + "Upper", [0, ...bones[0]]];
      L[n + "Foot"] = [n + "Lower", [0, ...bones[1]]];
      tips[n + "Foot"] = [0, -(y0 + bones[0][0] + bones[1][0]), bones[2][1]];
    }
  }
  return { joints: L, tips };
}

function birdLayout(b) {
  const L = { body: [null, [0, b.bodyY, 0]], neck: ["body", [0, ...b.neck]], head: ["neck", [0, ...b.head]], tail: ["body", [0, ...b.tail]] };
  const tips = { head: [0, ...b.headTip], tail: [0, ...b.tailTip] };
  for (const [s, x] of [["l", 1], ["r", -1]]) {
    L[s + "Wing"] = ["body", [b.wing[0] * x, b.wing[1], b.wing[2]]];
    L[s + "WingTip"] = [s + "Wing", [b.wingTip[0] * x, 0, b.wingTip[1]]];
    tips[s + "WingTip"] = [b.wingEnd[0] * x, 0, b.wingEnd[1]];
    L[s + "Leg"] = ["body", [b.leg[0] * x, b.leg[1], b.leg[2]]];
    L[s + "Shank"] = [s + "Leg", [0, ...b.thigh]];
    L[s + "Foot"] = [s + "Shank", [0, -(b.bodyY + b.leg[1] + b.thigh[0] - b.toeR), b.ankleDz]]; // foot joint sits one toe radius above the ground
    tips[s + "Foot"] = [0, -b.toeR, b.toe];
  }
  return { joints: L, tips };
}

const specOf = (type) => QUADS[type] || BIRDS[type];
const rawLayout = (type) => (QUADS[type] ? quadLayout(QUADS[type]) : birdLayout(BIRDS[type]));
function topOf(type, lay) {
  let y = 0;
  for (let n = "head"; n; n = lay.joints[n][0]) y += lay.joints[n][1][1];
  return y + specOf(type).headTop;
}

export const ANIMAL_TYPES = Object.fromEntries(["dog", "cat", "horse", "bird", "rabbit", "cow", "sheep", "chicken", "duck"].map((k) => {
  const s = specOf(k), lay = rawLayout(k);
  const shoulder = QUADS[k] ? s.size : Math.round((lay.joints.body[1][1] + s.back) * s.size * 100) / 100;
  return [k, { label: s.label, legs: QUADS[k] ? 4 : 2, shoulder, height: Math.round(topOf(k, lay) * s.size * 100) / 100 }];
}));

const layoutCache = {};
/** Rest layout in fractions of rig height: { joints: { name: [parent, [x, y, z]] }, tips: { joint: [x, y, z] } } */
export function animalLayout(type) {
  if (layoutCache[type]) return layoutCache[type];
  const lay = rawLayout(type), k = 1 / topOf(type, lay), sc = (v) => v.map((x) => x * k);
  const joints = Object.fromEntries(Object.entries(lay.joints).map(([n, [p, o]]) => [n, [p, sc(o)]]));
  const tips = Object.fromEntries(Object.entries(lay.tips).map(([n, o]) => [n, sc(o)]));
  return (layoutCache[type] = { joints, tips });
}

function sideOf(name) {
  return name[0] === "l" ? "l" : name[0] === "r" ? "r" : "c";
}

function ellipsoid(parent, c, r, U, mat, rot) {
  const m = new THREE.Mesh(BALL, mat);
  m.position.set(c[0] * U, c[1] * U, c[2] * U);
  m.scale.set(r[0] * U, r[1] * U, r[2] * U);
  if (rot) m.rotation.set(rot[0], rot[1], rot[2]);
  parent.add(m);
  return m;
}

// Ellipsoid laid along a -> b: centre at fraction f, half length hl, side radius rx, depth radius rz
function along(parent, a, b, f, hl, rx, rz, U, mat, shift = [0, 0, 0]) {
  const A = new THREE.Vector3(...a), d = new THREE.Vector3(...b).sub(A);
  const c = A.addScaledVector(d, f).add(new THREE.Vector3(...shift));
  const m = ellipsoid(parent, c.toArray(), [rx, hl, rz], U, mat);
  m.quaternion.setFromUnitVectors(UP, d.normalize());
  return m;
}

// Tapered limb from a (radius r0) to b (radius r1) with round ends
function taper(parent, a, b, r0, r1, U, mat) {
  const A = new THREE.Vector3(...a).multiplyScalar(U), B = new THREE.Vector3(...b).multiplyScalar(U);
  const d = B.clone().sub(A), len = d.length();
  const cyl = new THREE.Mesh(new THREE.CylinderGeometry(r1 * U, r0 * U, Math.max(len, 1e-4), 12), mat);
  cyl.position.copy(A).add(B).multiplyScalar(0.5);
  if (len > 1e-6) cyl.quaternion.setFromUnitVectors(UP, d.normalize());
  const ends = [[A, r0], [B, r1]].map(([p, r]) => { const m = new THREE.Mesh(BALL, mat); m.position.copy(p); m.scale.setScalar(r * U); return m; });
  parent.add(cyl, ...ends);
  return [cyl, ...ends];
}

function cone(parent, r, h, pos, rot, U, mat, sz = 1) {
  const m = new THREE.Mesh(new THREE.ConeGeometry(r * U, h * U, 12), mat);
  m.geometry.translate(0, (h * U) / 2, 0); // base at the origin, tip along +Y
  m.position.set(pos[0] * U, pos[1] * U, pos[2] * U);
  m.rotation.set(rot[0], rot[1], rot[2]);
  m.scale.z = sz;
  parent.add(m);
  return m;
}

function quadWhite(J, t, lay, U, mat) {
  const out = [], bone = (n) => lay.joints[n][1], tip = (n) => lay.tips[n];
  const E = (j, [c, r], rot) => out.push(ellipsoid(J[j], c, r, U, mat, rot));
  const T = (j, a, b, r0, r1) => out.push(...taper(J[j], a, b, r0, r1, U, mat));
  E("chest", t.rib); E("chest", t.fore); E("spine", t.loin); E("body", t.rump);
  if (t.withers) E("chest", t.withers);
  const nv = bone("head"), n = new THREE.Vector3(...nv).normalize();
  if (t.head === "horse") {
    out.push(along(J.neck, [0, -0.04, -0.04], nv, 0.3, 0.24, 0.085, 0.13, U, mat));
    out.push(along(J.neck, [0, 0, 0], nv, 0.75, 0.17, 0.06, 0.075, U, mat));
    out.push(along(J.neck, [0, 0, 0], nv, 0.5, 0.27, 0.022, 0.05, U, mat, [0, n.z * 0.1, -n.y * 0.1])); // mane
  } else T("neck", [0, -0.03, -0.03], nv, t.neckR[0], t.neckR[1]);
  // head: tilted sub-group so the face can point down while the joint stays at identity
  const H = HEADS[t.head], hg = new THREE.Group();
  hg.rotation.x = H.tilt;
  J.head.add(hg);
  for (const [c, r] of H.parts) out.push(ellipsoid(hg, c, r, U, mat));
  for (const s of [1, -1]) {
    if (t.head === "dog") E("head", [[0.11 * s, -0.01, 0.02], [0.025, 0.085, 0.055]], [0, 0, 0.25 * s]);
    if (t.head === "cat") out.push(cone(J.head, 0.07, 0.15, [0.095 * s, 0.13, 0.05], [-0.1, 0, -0.35 * s], U, mat, 0.5));
    if (t.head === "horse") out.push(cone(J.head, 0.024, 0.09, [0.035 * s, 0.06, 0.0], [0.25, 0, -0.15 * s], U, mat, 0.6));
    if (t.head === "rabbit") E("head", [[0.06 * s, 0.36, -0.06], [0.04, 0.26, 0.065]], [-0.3, 0, -0.15 * s]);
    if (t.head === "cow") { out.push(cone(J.head, 0.022, 0.11, [0.07 * s, 0.09, 0], [0, 0, -1.1 * s], U, mat)); E("head", [[0.12 * s, 0.04, -0.02], [0.065, 0.02, 0.035]], [0, 0, -0.3 * s]); }
    if (t.head === "sheep") E("head", [[0.12 * s, 0, -0.01], [0.07, 0.02, 0.035]], [0, 0, -0.25 * s]);
  }
  // tail
  const tn = ["tail1", "tail2", "tail3"];
  tn.forEach((j, i) => {
    const b = i < 2 ? bone(tn[i + 1]) : tip(j);
    if (t.head === "horse" && i > 0) out.push(along(J[j], [0, 0, 0], b, 0.5, 0.15, 0.055 + 0.02 * i, 0.045, U, mat));
    else T(j, [0, 0, 0], b, t.tailR[0] + (t.tailR[1] - t.tailR[0]) * (i / 3), t.tailR[0] + (t.tailR[1] - t.tailR[0]) * ((i + 1) / 3));
  });
  if (t.tuft) E("tail3", [tip("tail3").map((v) => v * 0.85), t.tuft]);
  // legs
  for (const s of ["l", "r"]) {
    for (const end of ["Front", "Back"]) {
      const j = s + end, R = end === "Front" ? t.frontR : t.backR, up = bone(j + "Lower"), len = Math.hypot(...up);
      out.push(along(J[j + "Upper"], [0, 0, 0], up, end === "Front" ? 0.45 : 0.4, len * 0.62, R[0], R[0] * 1.25, U, mat));
      T(j + "Lower", [0, 0, 0], bone(j + "Foot"), R[1], R[2]);
      const toe = tip(j + "Foot");
      if (t.hoof) {
        const [rt, rb, hh] = t.hoof, fl = [0, toe[1] * 0.7, -0.005], top = [0, toe[1] + hh, toe[2] - 0.004];
        T(j + "Foot", [0, 0, 0], fl, R[2], R[2] * 1.1);
        T(j + "Foot", fl, top, R[2] * 1.15, R[2] * 0.9);
        const hoof = new THREE.Mesh(new THREE.CylinderGeometry(rt * U, rb * U, hh * U, 14), mat);
        hoof.position.set(0, (toe[1] + hh / 2) * U, toe[2] * U);
        J[j + "Foot"].add(hoof);
        out.push(hoof);
      } else {
        const [px, py, pz] = t.paw;
        T(j + "Foot", [0, 0, 0], [0, toe[1] + py, toe[2] - 0.015], R[2], R[2] * 0.9);
        E(j + "Foot", [[0, toe[1] + py, toe[2]], [px, py, pz]]);
      }
    }
  }
  return out;
}

function birdWhite(J, lay, U, mat, b) {
  const out = [], bone = (n) => lay.joints[n][1], tip = (n) => lay.tips[n];
  const E = (parent, [c, r], rot) => out.push(ellipsoid(typeof parent === "string" ? J[parent] : parent, c, r, U, mat, rot));
  const T = (j, a, b, r0, r1) => out.push(...taper(J[j], a, b, r0, r1, U, mat));
  const tilt = new THREE.Group();
  tilt.rotation.x = b.tilt; // body pitched nose up: a standing pigeon most, a duck almost level
  J.body.add(tilt);
  for (const part of b.body) E(tilt, part); // body, breast
  T("neck", [0, -0.012, -0.006], bone("head"), ...b.neckR);
  for (const part of b.headParts) E("head", part);
  if (b.beak) out.push(cone(J.head, b.beak[0], b.beak[1], b.beak[2], [Math.PI / 2, 0, 0], U, mat));
  if (b.bill) E("head", b.bill);
  E("tail", b.tailPart.slice(0, 2), [b.tailPart[2], 0, 0]);
  for (const [s, x] of [["l", 1], ["r", -1]]) {
    const mx = ([c, r]) => [[c[0] * x, c[1], c[2]], r];
    E(s + "Wing", mx(b.wingPart));
    E(s + "WingTip", mx(b.wingTipPart), [0, 0.15 * x, 0]);
    T(s + "Leg", [0, 0, 0], bone(s + "Shank"), ...b.thighR);
    T(s + "Shank", [0, 0, 0], bone(s + "Foot"), ...b.shankR);
    const toe = tip(s + "Foot"), z = toe[2], r = b.toeR;
    for (const [tx, tz] of [[0, z], [z * 0.41, z * 0.8], [-z * 0.41, z * 0.8], [0, -z * 0.53]]) T(s + "Foot", [0, 0, 0], [tx, 0, tz], r, r * 0.86);
    if (b.webbed) E(s + "Foot", [[0, 0, z * 0.55], [z * 0.4, r * 0.5, z * 0.4]]);
  }
  return out;
}

function addSkeleton(joints, lay, H, mats) {
  const add = [];
  const ball = new THREE.SphereGeometry(0.02 * H, 12, 8);
  const stick = (parent, v, side) => {
    const len = v.length();
    if (len < 1e-4) return;
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.008 * H, 0.008 * H, len, 6), mats[side]);
    m.position.copy(v).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(UP, v.clone().normalize());
    joints[parent].add(m);
    add.push(m);
  };
  for (const [name, [parent, off]] of Object.entries(lay.joints)) {
    const dot = new THREE.Mesh(ball, mats[sideOf(name)]);
    dot.userData.pickJoint = name;
    joints[name].add(dot);
    add.push(dot);
    if (parent) stick(parent, new THREE.Vector3(...off).multiplyScalar(H), sideOf(name));
  }
  // head, tail, wing and toe ends so extremities read clearly
  for (const [name, off] of Object.entries(lay.tips)) stick(name, new THREE.Vector3(...off).multiplyScalar(H), sideOf(name));
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.018 * H, 0.05 * H, 8), mats.c);
  const n = new THREE.Vector3(...lay.tips.head).multiplyScalar(H);
  nose.position.copy(n);
  nose.quaternion.setFromUnitVectors(UP, n.clone().normalize());
  joints.head.add(nose);
  add.push(nose);
  return add;
}

/**
 * Build an animal mannequin.
 * @param {{type?: string, color?: string, display?: string, height?: number}} opts height = overall standing height in meters
 * @returns rig with root, joints, rest positions, setDisplay(mode), setColor(c)
 */
export function buildAnimal(opts = {}) {
  const type = ANIMAL_TYPES[opts.type] ? opts.type : "dog";
  const spec = specOf(type), raw = rawLayout(type), top = topOf(type, raw);
  const U = spec.size * (opts.height ? opts.height / (top * spec.size) : 1);
  const H = top * U, unit = animalLayout(type);
  const root = new THREE.Group();
  const joints = {}, rest = {};
  for (const [name, [parent, off]] of Object.entries(raw.joints)) {
    const g = new THREE.Group();
    g.name = name;
    g.position.set(off[0] * U, off[1] * U, off[2] * U);
    g.userData.joint = name;
    rest[name] = g.position.clone();
    joints[name] = g;
    (parent ? joints[parent] : root).add(g);
  }
  const whiteMat = new THREE.MeshStandardMaterial({ color: opts.color || "#e8e8e8", roughness: 0.75, metalness: 0 });
  const skelMats = Object.fromEntries(Object.entries(SIDE_COLORS).map(([k, c]) => [k, new THREE.MeshBasicMaterial({ color: c })]));
  const white = QUADS[type] ? quadWhite(joints, spec, raw, U, whiteMat) : birdWhite(joints, raw, U, whiteMat, spec);
  for (const m of white) { m.castShadow = true; m.receiveShadow = true; }
  const skeleton = addSkeleton(joints, unit, H, skelMats);
  const rig = {
    kind: "animal", type,
    root, joints, rest, height: H,
    jointNames: Object.keys(raw.joints),
    upperBody: [],
    materials: { white: whiteMat, skeleton: skelMats },
    setDisplay(mode) {
      const showWhite = mode !== "joints";
      const showSkel = mode !== "white";
      for (const m of white) m.visible = showWhite;
      for (const m of skeleton) m.visible = showSkel;
      whiteMat.transparent = mode === "both";
      whiteMat.opacity = mode === "both" ? 0.45 : 1;
      whiteMat.depthWrite = mode !== "both";
    },
    setColor(c) { whiteMat.color.set(c); },
  };
  rig.setDisplay(opts.display || "white");
  return rig;
}
