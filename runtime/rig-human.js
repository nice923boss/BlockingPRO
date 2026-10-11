// Procedural humanoid mannequin. A hierarchy of THREE.Group joints carries two looks:
// the white model (capsules) and the joint view (spheres + sticks, OpenPose-like colours).
// Units are meters, Y is up, the figure faces +Z, so its left side is +X.
// Limb bones point -Y at rest (arms hang down); spine, neck and head point +Y.
// Rotation sign guide: limbs  +X = swing backward, -X = swing forward;
//                      spine  +X = lean forward;  left arm +Z = raise sideways (right arm -Z).
import * as THREE from "three";

export const HUMAN_JOINTS = [
  "hips", "spine", "chest", "neck", "head",
  "lUpperArm", "lForeArm", "lHand", "rUpperArm", "rForeArm", "rHand",
  "lThigh", "lShin", "lFoot", "rThigh", "rShin", "rFoot",
];

export const UPPER_BODY = ["spine", "chest", "neck", "head", "lUpperArm", "lForeArm", "lHand", "rUpperArm", "rForeArm", "rHand"];

// Body presets: height in meters, other values are fractions of height
export const HUMAN_BODIES = {
  man: { label: "成年男性", height: 1.78, shoulder: 0.105, hipW: 0.055, headR: 0.064, bulk: 1.05 },
  woman: { label: "成年女性", height: 1.65, shoulder: 0.095, hipW: 0.06, headR: 0.066, bulk: 0.92 },
  child: { label: "兒童", height: 1.2, shoulder: 0.1, hipW: 0.055, headR: 0.085, bulk: 0.95 },
  elder: { label: "長者", height: 1.66, shoulder: 0.1, hipW: 0.058, headR: 0.066, bulk: 1.0 },
  bulky: { label: "壯漢", height: 1.86, shoulder: 0.125, hipW: 0.065, headR: 0.06, bulk: 1.35 },
};

// Per-actor body sliders (a05): height in meters, build and head as multipliers of the preset
export const BODY_LIMITS = { height: [0.8, 2.3], build: [0.6, 1.6], head: [0.7, 1.5] };

/** The preset's proportions with an actor's `body` sliders applied; build widens shoulders and hips half as much as it thickens */
export function resolveBody(preset, shape) {
  const B = HUMAN_BODIES[preset] || HUMAN_BODIES.man;
  if (!shape) return B;
  const build = shape.build ?? 1, wide = 1 + (build - 1) * 0.5;
  return { ...B, height: shape.height ?? B.height, bulk: B.bulk * build, shoulder: B.shoulder * wide, hipW: B.hipW * wide, headR: B.headR * (shape.head ?? 1) };
}

const SIDE_COLORS = { c: "#ffd23f", l: "#3fa7ff", r: "#ff5a3f" };

function layout(body) {
  const s = body.shoulder, h = body.hipW;
  return {
    hips: [null, [0, 0.55, 0]],
    spine: ["hips", [0, 0.02, 0]],
    chest: ["spine", [0, 0.14, 0]],
    neck: ["chest", [0, 0.135, 0]],
    head: ["neck", [0, 0.035, 0]],
    lUpperArm: ["chest", [s, 0.115, 0]],
    lForeArm: ["lUpperArm", [0, -0.17, 0]],
    lHand: ["lForeArm", [0, -0.155, 0]],
    rUpperArm: ["chest", [-s, 0.115, 0]],
    rForeArm: ["rUpperArm", [0, -0.17, 0]],
    rHand: ["rForeArm", [0, -0.155, 0]],
    lThigh: ["hips", [h, -0.02, 0]],
    lShin: ["lThigh", [0, -0.245, 0]],
    lFoot: ["lShin", [0, -0.245, 0]],
    rThigh: ["hips", [-h, -0.02, 0]],
    rShin: ["rThigh", [0, -0.245, 0]],
    rFoot: ["rShin", [0, -0.245, 0]],
  };
}

function sideOf(name) {
  return name[0] === "l" ? "l" : name[0] === "r" ? "r" : "c";
}

function capsule(radius, length, material) {
  const geo = new THREE.CapsuleGeometry(radius, Math.max(0.001, length - radius * 2), 4, 10);
  const mesh = new THREE.Mesh(geo, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

// Adds a capsule from the joint origin along +Y or -Y with the given length
function limb(parent, radius, length, dir, material) {
  const mesh = capsule(radius, length, material);
  mesh.position.y = (dir * length) / 2;
  parent.add(mesh);
  return mesh;
}

// Hand shapes (a08, names in hands.js), in the hand joint's frame: fingers toward -Y, thumb toward +Z
// (forward while the arm hangs). Only the shape picked by setHands is visible.
function addHand(H, mat, ball) {
  const blob = (sx, sy, sz, y) => {
    const m = new THREE.Mesh(ball, mat);
    m.scale.set(sx * H, sy * H, sz * H);
    m.position.y = y * H;
    return m;
  };
  // a finger from base toward dir (fractions of H)
  const digit = (r, len, base, dir) => {
    const m = capsule(r * H, len * H, mat), d = new THREE.Vector3(...dir).normalize();
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d);
    m.position.set(...base).multiplyScalar(H).addScaledVector(d, (len * H) / 2);
    return m;
  };
  const fist = () => blob(0.022, 0.032, 0.03, -0.035);
  const parts = {
    relaxed: [blob(0.018, 0.045, 0.03, -0.042)],
    open: [blob(0.015, 0.03, 0.031, -0.03), ...[0.021, 0.007, -0.007, -0.021].map((z) => digit(0.0055, 0.05, [0, -0.05, z], [0, -1, z * 6])),
      digit(0.0065, 0.045, [0, -0.02, 0.025], [0, -0.6, 0.8])],
    fist: [fist()],
    point: [fist(), digit(0.0055, 0.055, [0, -0.055, 0.02], [0, -1, 0])],
    thumbsUp: [fist(), digit(0.0075, 0.045, [0, -0.025, 0.022], [0, 0.15, 1])],
  };
  const group = new THREE.Group(), shapes = {};
  for (const [name, meshes] of Object.entries(parts)) {
    const g = new THREE.Group();
    for (const m of meshes) { m.castShadow = true; m.receiveShadow = true; g.add(m); }
    g.visible = name === "relaxed";
    group.add(g);
    shapes[name] = g;
  }
  return { group, shapes };
}

function addWhite(joints, body, H, mat, hands) {
  const b = body.bulk, add = [];
  const push = (m) => { add.push(m); return m; };
  const ball = new THREE.SphereGeometry(1, 20, 14);
  // pelvis and ribcage are ellipsoids, like an artist's mannequin
  const pelvis = push(new THREE.Mesh(ball, mat));
  pelvis.scale.set(body.hipW * 1.75 * H, 0.06 * H, 0.065 * H * b);
  pelvis.position.y = 0.005 * H;
  joints.hips.add(pelvis);
  push(limb(joints.spine, 0.055 * H * b, 0.14 * H, 1, mat));
  const torso = push(new THREE.Mesh(ball, mat));
  torso.scale.set(body.shoulder * 1.08 * H, 0.105 * H, 0.068 * H * b);
  torso.position.y = 0.06 * H;
  joints.chest.add(torso);
  push(limb(joints.neck, 0.025 * H * b, 0.06 * H, 1, mat));
  const head = push(new THREE.Mesh(new THREE.SphereGeometry(body.headR * H, 20, 14), mat));
  head.scale.set(0.9, 1.12, 1);
  head.position.y = body.headR * H * 0.95;
  joints.head.add(head);
  // nose marks the facing direction
  const nose = push(new THREE.Mesh(new THREE.BoxGeometry(0.02 * H, 0.025 * H, 0.03 * H), mat));
  nose.position.set(0, body.headR * H * 0.85, body.headR * H * 0.95);
  joints.head.add(nose);
  for (const s of ["l", "r"]) {
    push(limb(joints[s + "UpperArm"], 0.032 * H * b, 0.17 * H, -1, mat));
    push(limb(joints[s + "ForeArm"], 0.027 * H * b, 0.155 * H, -1, mat));
    const hand = addHand(H, mat, ball);
    push(hand.group);
    hands[s] = hand.shapes;
    joints[s + "Hand"].add(hand.group);
    push(limb(joints[s + "Thigh"], 0.045 * H * b, 0.245 * H, -1, mat));
    push(limb(joints[s + "Shin"], 0.036 * H * b, 0.245 * H, -1, mat));
    const foot = push(new THREE.Mesh(new THREE.BoxGeometry(0.055 * H, 0.04 * H, 0.15 * H), mat));
    foot.position.set(0, -0.02 * H, 0.04 * H);
    joints[s + "Foot"].add(foot);
  }
  for (const m of add) { m.castShadow = true; m.receiveShadow = true; }
  return add;
}

function addSkeleton(joints, lay, H, mats) {
  const add = [];
  const ball = new THREE.SphereGeometry(0.022 * H, 12, 8);
  for (const [name, [parent, off]] of Object.entries(lay)) {
    const side = sideOf(name);
    const dot = new THREE.Mesh(ball, mats[side]);
    dot.userData.pickJoint = name;
    joints[name].add(dot);
    add.push(dot);
    if (!parent) continue;
    // stick from parent joint to this joint, drawn in the parent's frame
    const v = new THREE.Vector3(...off).multiplyScalar(H);
    const len = v.length();
    if (len < 1e-4) continue;
    const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.008 * H, 0.008 * H, len, 6), mats[side]);
    stick.position.copy(v).multiplyScalar(0.5);
    stick.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), v.clone().normalize());
    joints[parent].add(stick);
    add.push(stick);
  }
  // head end, hand tips and toes so extremities read clearly
  const tips = [["head", [0, 0.11, 0], "c"], ["lHand", [0, -0.08, 0], "l"], ["rHand", [0, -0.08, 0], "r"], ["lFoot", [0, -0.03, 0.12], "l"], ["rFoot", [0, -0.03, 0.12], "r"]];
  for (const [name, off, side] of tips) {
    const v = new THREE.Vector3(...off).multiplyScalar(H);
    const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.008 * H, 0.008 * H, v.length(), 6), mats[side]);
    stick.position.copy(v).multiplyScalar(0.5);
    stick.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), v.clone().normalize());
    joints[name].add(stick);
    add.push(stick);
  }
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.018 * H, 0.05 * H, 8), mats.c);
  nose.rotation.x = Math.PI / 2;
  nose.position.set(0, 0.06 * H, 0.06 * H);
  joints.head.add(nose);
  add.push(nose);
  return add;
}

/**
 * Build a mannequin.
 * @param {{body?: string, shape?: {height?: number, build?: number, head?: number}, color?: string, height?: number}} opts
 * @returns rig with root, joints, rest positions, setDisplay(mode)
 */
export function buildHuman(opts = {}) {
  const body = resolveBody(opts.body, opts.shape);
  const H = opts.height || body.height;
  const lay = layout(body);
  const root = new THREE.Group();
  const joints = {};
  const rest = {};
  for (const [name, [parent, off]] of Object.entries(lay)) {
    const g = new THREE.Group();
    g.name = name;
    g.position.set(off[0] * H, off[1] * H, off[2] * H);
    g.userData.joint = name;
    rest[name] = g.position.clone();
    joints[name] = g;
    (parent ? joints[parent] : root).add(g);
  }
  const whiteMat = new THREE.MeshStandardMaterial({ color: opts.color || "#e8e8e8", roughness: 0.75, metalness: 0 });
  const skelMats = Object.fromEntries(Object.entries(SIDE_COLORS).map(([k, c]) => [k, new THREE.MeshBasicMaterial({ color: c })]));
  const hands = {};
  const white = addWhite(joints, body, H, whiteMat, hands);
  const skeleton = addSkeleton(joints, lay, H, skelMats);
  const rig = {
    kind: "human",
    root, joints, rest, height: H,
    jointNames: HUMAN_JOINTS,
    upperBody: UPPER_BODY,
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
    // shape names from hands.js; unknown names show the relaxed hand
    setHands(l, r) {
      for (const [side, want] of [["l", l], ["r", r]]) {
        const pick = hands[side][want] ? want : "relaxed";
        for (const [name, g] of Object.entries(hands[side])) g.visible = name === pick;
      }
    },
  };
  rig.setDisplay(opts.display || "white");
  return rig;
}
