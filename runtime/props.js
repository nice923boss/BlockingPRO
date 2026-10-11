// Procedural prop library: furniture, building parts, vehicles, nature and hand-held props.
// Meters, Y up. Origin on the floor at the footprint center and the prop's front faces +Z
// (a chair seat, a car nose, a TV screen). Low poly primitives so each prop reads at a glance.
//
// Hand-held props carry hold = { pos, rot } (meters, degrees, Euler XYZ) in the hand joint frame
// of rig-human.js: the hand hangs -Y from the wrist, the fist center is near (0, -0.075, 0) on a
// 1.78 m body, the right palm faces +X (toward the body) and the thumb side is +Z.
// Umbrella: held upright (hold.upright): the shaft stays vertical and turns only with the holder, whatever the forearm does.
// hold.shape: the hand shape while held (runtime/hands.js), a fist when left out; box and baby rest on an open hand.
// applyHold() places a prop in a hand and mirrors the transform for the left hand.
// Moving parts are marked in group.userData for runtime/prop-anim.js: spin (wheels), crank (bike), leaf (door),
// fan (fan blades), slide (elevator doors).
import * as THREE from "three";
import { STAIRS, STEPS, RAMP, STAGE, ELEVATOR } from "./terrain.js";

const D2R = Math.PI / 180;
const UP = new THREE.Vector3(0, 1, 0);
const FIST = [0, -0.075, 0];

export const PROP_CATS = { furniture: "家具", building: "建築", vehicle: "交通", nature: "自然", small: "小物" };

export function mat(color, o = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.8, metalness: 0, ...o });
}
const shade = (c, dl) => new THREE.Color(c).offsetHSL(0, 0, dl);
const glow = (c, i = 1) => mat(c, { emissive: c, emissiveIntensity: i });
const metal = (c) => mat(c, { roughness: 0.4, metalness: 0.5 });
const v2 = (x, y) => new THREE.Vector2(x, y);

// Deterministic random so a prop looks the same on every build
function rng(seed) {
  return () => (seed = (seed * 16807) % 2147483647) / 2147483647;
}

// Side profile given as [z, y] points, extruded across X and centered
function profile(pts, width) {
  const g = new THREE.ExtrudeGeometry(new THREE.Shape(pts.map(([z, y]) => v2(z, y))), { depth: width, bevelEnabled: false });
  g.translate(0, 0, -width / 2);
  g.rotateY(-Math.PI / 2);
  return g;
}

// Treads climbing toward -Z with the first step at +Z (stairs, steps); returns the z of tread i
function treads(k, m, c, { n, rise, run, width }) {
  const D = n * run, nose = mat(shade(c, -0.25));
  const stepZ = (i) => D / 2 - run / 2 - i * run;
  for (let i = 0; i < n; i++) {
    const h = (i + 1) * rise;
    k.box(m, [width, h, run], [0, h / 2, stepZ(i)]);
    k.box(nose, [width + 0.004, 0.014, 0.04], [0, h + 0.006, stepZ(i) + run / 2 - 0.02]);
  }
  return stepZ;
}

// Pivot group at a wheel axle (along X), radius r; prop-anim.js rolls it by the distance travelled
function wheel(k, p, r) {
  const g = new THREE.Group();
  g.position.set(p[0], p[1], p[2]);
  k.group.add(g);
  (k.group.userData.spin ||= []).push({ obj: g, r });
  return g;
}

// Per-build helper: shared geometry cache and mesh adders (positions are centers, rotations in degrees)
export function kit(key) {
  const group = new THREE.Group();
  group.userData.prop = key;
  const cache = new Map();
  const geo = (id, make) => {
    if (!cache.has(id)) cache.set(id, make());
    return cache.get(id);
  };
  const mesh = (g, m, p, r, parent = group) => {
    const o = new THREE.Mesh(g, m);
    if (p) o.position.set(p[0], p[1], p[2]);
    if (r) o.rotation.set(r[0] * D2R, r[1] * D2R, r[2] * D2R);
    o.castShadow = o.receiveShadow = true;
    parent.add(o);
    return o;
  };
  return {
    group, geo, mesh,
    box: (m, s, p, r, parent) => mesh(geo("b" + s, () => new THREE.BoxGeometry(s[0], s[1], s[2])), m, p, r, parent),
    // cylinder along Y unless rotated
    cyl: (m, rt, rb, h, p, r, seg = 12, parent) =>
      mesh(geo(`c${rt},${rb},${h},${seg}`, () => new THREE.CylinderGeometry(rt, rb, h, seg)), m, p, r, parent),
    ball: (m, rad, p, s, parent) => {
      const o = mesh(geo("s" + rad, () => new THREE.SphereGeometry(rad, 16, 12)), m, p, null, parent);
      if (s) o.scale.set(s[0], s[1], s[2]);
      return o;
    },
    // faceted low poly blob for foliage
    ico: (m, rad, p, s) => {
      const o = mesh(geo("i" + rad, () => new THREE.IcosahedronGeometry(rad, 1)), m, p);
      if (s) o.scale.set(s[0], s[1], s[2]);
      return o;
    },
    // cylinder from point a to point b
    tube: (m, a, b, rad, seg = 8, parent) => {
      const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), len = A.distanceTo(B);
      const o = mesh(geo(`t${rad},${len.toFixed(4)},${seg}`, () => new THREE.CylinderGeometry(rad, rad, len, seg)), m, null, null, parent);
      o.position.copy(A).add(B).multiplyScalar(0.5);
      o.quaternion.setFromUnitVectors(UP, B.sub(A).normalize());
      return o;
    },
  };
}

// Hold transform that puts the prop-local grip point at `at` (default the fist center); `at` is kept so the
// grip follows the hand on other body sizes (runtime/attach.js)
export function grip(local, rot, at = FIST) {
  const p = new THREE.Vector3(...local).applyEuler(new THREE.Euler(rot[0] * D2R, rot[1] * D2R, rot[2] * D2R));
  return { pos: [at[0] - p.x, at[1] - p.y, at[2] - p.z].map((v) => Math.round(v * 10000) / 10000), rot, at };
}

/** Place a prop in a hand joint with its hold transform; side "l" mirrors it across the YZ plane. */
export function applyHold(obj, hold, side = "r") {
  const m = side === "l" ? -1 : 1;
  obj.position.set(hold.pos[0] * m, hold.pos[1], hold.pos[2]);
  obj.rotation.set(hold.rot[0] * D2R, hold.rot[1] * D2R * m, hold.rot[2] * D2R * m);
  return obj;
}

const DEFS = {
  // ---------- furniture ----------
  table: ["桌子", "furniture", "#c8b08a", (k, m) => {
    k.box(m, [1.4, 0.04, 0.8], [0, 0.73, 0]);
    for (const z of [-0.33, 0.33]) k.box(m, [1.2, 0.08, 0.025], [0, 0.67, z]);
    for (const x of [-0.63, 0.63]) {
      k.box(m, [0.025, 0.08, 0.6], [x, 0.67, 0]);
      for (const z of [-0.33, 0.33]) k.box(m, [0.06, 0.71, 0.06], [x, 0.355, z]);
    }
  }],

  chair: ["椅子", "furniture", "#9a6b45", (k, m) => {
    k.box(m, [0.44, 0.04, 0.44], [0, 0.43, 0]);
    for (const x of [-0.195, 0.195]) {
      k.box(m, [0.035, 0.41, 0.035], [x, 0.205, 0.195]);
      k.box(m, [0.035, 0.92, 0.035], [x, 0.46, -0.195]); // rear leg runs up into the back post
      k.box(m, [0.025, 0.025, 0.36], [x, 0.12, 0]);
    }
    k.box(m, [0.4, 0.13, 0.025], [0, 0.82, -0.195]);
    k.box(m, [0.4, 0.05, 0.025], [0, 0.63, -0.195]);
  }],

  sofa: ["沙發", "furniture", "#5d7a9c", (k, m, c) => {
    const cush = mat(shade(c, 0.07)), dark = mat("#2b2622");
    for (const x of [-0.92, 0.92]) for (const z of [-0.38, 0.38]) k.cyl(dark, 0.025, 0.02, 0.06, [x, 0.03, z]);
    k.box(m, [1.68, 0.22, 0.9], [0, 0.17, 0]);
    for (const x of [-0.92, 0.92]) k.box(m, [0.16, 0.56, 0.9], [x, 0.34, 0]); // arms, top at 0.62
    k.box(m, [1.68, 0.57, 0.2], [0, 0.565, -0.35]);
    for (const x of [-0.56, 0, 0.56]) {
      k.box(cush, [0.55, 0.14, 0.6], [x, 0.35, 0.14]); // seat top at 0.42
      k.box(cush, [0.53, 0.4, 0.14], [x, 0.63, -0.19], [-10, 0, 0]);
    }
  }],

  bed: ["床", "furniture", "#6c8cb5", (k, m, c) => {
    const wood = mat(shade(c, -0.25)), white = mat("#f1eee8");
    k.box(wood, [1.66, 0.27, 2.1], [0, 0.215, 0]);
    for (const x of [-0.78, 0.78]) for (const z of [-1.0, 1.0]) k.box(wood, [0.07, 0.08, 0.07], [x, 0.04, z]);
    k.box(wood, [1.72, 1.05, 0.08], [0, 0.525, -1.09]); // headboard at -Z, foot end faces +Z
    k.box(white, [1.6, 0.22, 2.0], [0, 0.46, 0.02]); // mattress top at 0.57
    k.box(m, [1.66, 0.29, 1.4], [0, 0.465, 0.38]); // blanket draped over the foot end
    k.box(white, [1.665, 0.03, 0.14], [0, 0.6, -0.3]); // folded sheet edge
    for (const x of [-0.38, 0.38]) k.ball(white, 1, [x, 0.635, -0.78], [0.32, 0.07, 0.18]);
  }],

  bookshelf: ["書櫃", "furniture", "#7d5236", (k, m) => {
    const H = 1.9, D = 0.32, step = (1.875 - 0.08) / 5;
    for (const x of [-0.4375, 0.4375]) k.box(m, [0.025, H, D], [x, H / 2, 0]);
    k.box(m, [0.9, 0.025, D], [0, H - 0.0125, 0]);
    k.box(m, [0.85, 0.08, D], [0, 0.04, 0]);
    k.box(m, [0.85, H, 0.012], [0, H / 2, -0.154]);
    const covers = ["#9b2d2d", "#2d5a8b", "#c9a227", "#2f6b3a", "#d9d2c0", "#5a3d6b"].map((c) => mat(c));
    const rand = rng(7);
    for (let s = 0; s < 5; s++) {
      const y0 = 0.08 + s * step + (s ? 0.01 : 0);
      if (s) k.box(m, [0.85, 0.02, D - 0.01], [0, 0.08 + s * step, 0]);
      const end = 0.415 - rand() * 0.16;
      for (let x = -0.415; ;) {
        const w = 0.024 + Math.round(rand() * 5) * 0.006, h = 0.2 + Math.round(rand() * 5) * 0.022;
        if (x + w > end) break;
        k.box(covers[Math.floor(rand() * covers.length)], [w, h, 0.22], [x + w / 2, y0 + h / 2, -0.02]);
        x += w + 0.002;
      }
    }
  }],

  tv: ["電視", "furniture", "#6b5444", (k, m, c) => {
    const black = mat("#151515", { roughness: 0.5 }), front = mat(shade(c, -0.08));
    k.box(m, [1.6, 0.4, 0.4], [0, 0.24, 0]);
    for (const x of [-0.75, 0.75]) for (const z of [-0.15, 0.15]) k.box(black, [0.05, 0.04, 0.05], [x, 0.02, z]);
    for (const x of [-0.39, 0.39]) k.box(front, [0.76, 0.32, 0.01], [x, 0.24, 0.2]);
    k.box(black, [0.4, 0.02, 0.22], [0, 0.45, 0]);
    k.box(black, [0.08, 0.1, 0.04], [0, 0.51, -0.03]);
    k.box(black, [1.25, 0.73, 0.05], [0, 0.925, -0.02]);
    k.box(glow("#2c5079", 0.6), [1.2, 0.68, 0.004], [0, 0.925, 0.0055]); // screen faces +Z
  }],

  counter: ["吧台", "furniture", "#7a5236", (k, m, c) => {
    const top = mat("#34302c", { roughness: 0.5 }), steel = metal("#a3a9ae"), panel = mat(shade(c, -0.08));
    k.box(m, [2.0, 1.0, 0.5], [0, 0.5, -0.05]);
    k.box(top, [2.1, 0.05, 0.72], [0, 1.025, 0.02]); // overhangs toward the customer side (+Z)
    for (const x of [-0.75, -0.25, 0.25, 0.75]) k.box(panel, [0.46, 0.76, 0.01], [x, 0.55, 0.205]);
    k.box(mat("#2a2420"), [2.0, 0.1, 0.012], [0, 0.05, 0.206]);
    k.cyl(steel, 0.02, 0.02, 1.9, [0, 0.22, 0.32], [0, 0, 90]); // foot rail
    for (const x of [-0.8, 0, 0.8]) k.box(steel, [0.03, 0.03, 0.12], [x, 0.22, 0.26]);
  }],

  desk: ["辦公桌", "furniture", "#b5946a", (k, m, c) => {
    const black = mat("#1b1b1d", { roughness: 0.5 }), side = mat(shade(c, -0.1));
    k.box(m, [1.4, 0.03, 0.7], [0, 0.725, 0]);
    k.box(side, [0.03, 0.71, 0.66], [-0.67, 0.355, 0]);
    k.box(side, [0.42, 0.71, 0.62], [0.46, 0.355, -0.02]); // drawer pedestal
    for (const y of [0.13, 0.36, 0.59]) {
      k.box(m, [0.38, 0.2, 0.01], [0.46, y, 0.295]);
      k.box(black, [0.12, 0.015, 0.02], [0.46, y + 0.06, 0.305]);
    }
    k.box(side, [0.9, 0.35, 0.02], [-0.2, 0.52, -0.32]);
    // monitor faces +Z, so the user sits on the +Z side facing -Z
    k.box(black, [0.24, 0.015, 0.17], [0, 0.748, -0.15]);
    k.box(black, [0.05, 0.28, 0.03], [0, 0.88, -0.17]);
    k.box(black, [0.62, 0.38, 0.03], [0, 1.03, -0.14]);
    k.box(glow("#3d6fa3", 0.55), [0.58, 0.34, 0.004], [0, 1.03, -0.123]);
    k.box(black, [0.44, 0.02, 0.14], [0, 0.75, 0.12]);
  }],

  bench: ["長椅", "furniture", "#9c6b3f", (k, m) => {
    const iron = mat("#2b2d30", { roughness: 0.6 }), slope = 0.16 / 0.9;
    for (const z of [-0.18, -0.06, 0.06, 0.18]) k.box(m, [1.6, 0.03, 0.095], [0, 0.435, z]);
    for (const y of [0.58, 0.7, 0.82]) k.box(m, [1.6, 0.09, 0.03], [0, y, -0.2 - slope * y + 0.035], [-10, 0, 0]);
    for (const x of [-0.68, 0.68]) {
      k.box(iron, [0.05, 0.42, 0.05], [x, 0.21, 0.17]);
      k.tube(iron, [x, 0, -0.2], [x, 0.9, -0.36], 0.025); // rear leg and back support
      k.box(iron, [0.05, 0.04, 0.48], [x, 0.4, -0.01]);
      k.box(iron, [0.05, 0.04, 0.5], [x, 0.66, -0.05]); // armrest
      k.box(iron, [0.04, 0.24, 0.04], [x, 0.54, 0.17]);
    }
  }],

  fan: ["電風扇", "furniture", "#e8eef2", (k, m, c) => {
    const dark = mat(shade(c, -0.5)), blade = mat("#8fc1d8", { roughness: 0.4 });
    k.cyl(m, 0.17, 0.19, 0.04, [0, 0.02, 0], null, 20); // base
    k.cyl(m, 0.016, 0.016, 1.0, [0, 0.55, 0], null, 8); // pole
    k.cyl(m, 0.06, 0.07, 0.16, [0, 1.11, -0.04], [90, 0, 0], 14); // motor, blowing toward +Z
    // three blades on a hub turning about Z (state = speed, prop-anim.js)
    const hub = new THREE.Group();
    hub.position.set(0, 1.11, 0.08);
    k.group.add(hub);
    k.group.userData.fan = hub;
    k.cyl(dark, 0.035, 0.035, 0.03, null, [90, 0, 0], 12, hub);
    for (let i = 0; i < 3; i++) {
      const arm = new THREE.Group();
      arm.rotation.z = i * 120 * D2R;
      hub.add(arm);
      k.ball(blade, 0.1, [0, 0.125, 0], [0.6, 1, 0.12], arm).rotation.y = 0.4; // pitched blade
    }
    // guard: two rings and a front cross, open enough to see the blades
    const ringG = k.geo("guard", () => new THREE.TorusGeometry(0.24, 0.006, 6, 40));
    for (const z of [0.03, 0.15]) k.mesh(ringG, m, [0, 1.11, z]);
    for (const a of [0, 90]) k.box(m, [0.48, 0.008, 0.008], [0, 1.11, 0.15], [0, 0, a]);
    k.cyl(m, 0.035, 0.035, 0.012, [0, 1.11, 0.155], [90, 0, 0], 12);
  }],

  // ---------- building ----------
  wall: ["牆", "building", "#d9d3c7", (k, m, c) => {
    k.box(m, [4, 2.8, 0.15], [0, 1.4, 0]);
    k.box(mat(shade(c, -0.3)), [4, 0.1, 0.17], [0, 0.05, 0]);
  }],

  door: ["門", "building", "#8a5a3a", (k, m, c) => {
    const frame = mat("#ece6da"), panel = mat(shade(c, -0.07)), brass = mat("#c9a640", { roughness: 0.35, metalness: 0.7 });
    for (const x of [-0.48, 0.48]) k.box(frame, [0.06, 2.16, 0.17], [x, 1.08, 0]);
    k.box(frame, [1.02, 0.06, 0.17], [0, 2.13, 0]);
    // leaf hinged on the -X jamb: set userData.leaf.rotation.y > 0 to swing it open toward -Z
    const leaf = new THREE.Group();
    leaf.position.set(-0.445, 0, 0);
    k.group.add(leaf);
    k.group.userData.leaf = leaf;
    k.box(m, [0.89, 2.09, 0.04], [0.445, 1.05, 0], null, leaf);
    for (const z of [-0.022, 0.022]) {
      k.box(panel, [0.62, 0.75, 0.008], [0.445, 0.55, z], null, leaf);
      k.box(panel, [0.62, 0.95, 0.008], [0.445, 1.5, z], null, leaf);
    }
    for (const z of [-1, 1]) {
      k.ball(brass, 0.03, [0.8, 1.0, z * 0.07], null, leaf);
      k.cyl(brass, 0.01, 0.01, 0.06, [0.8, 1.0, z * 0.04], [90, 0, 0], 8, leaf);
    }
  }],

  window: ["窗戶", "building", "#ebe7df", (k, m) => {
    const glass = mat("#a9cbe6", { roughness: 0.1, transparent: true, opacity: 0.45 });
    const y0 = 0.9, S = 1.2, cy = y0 + S / 2; // bottom at 0.9 m, origin stays on the floor
    for (const y of [y0 + 0.03, y0 + S - 0.03]) k.box(m, [S, 0.06, 0.12], [0, y, 0]);
    for (const x of [-S / 2 + 0.03, S / 2 - 0.03]) k.box(m, [0.06, S - 0.12, 0.12], [x, cy, 0]);
    k.box(m, [0.04, S - 0.12, 0.08], [0, cy, 0]);
    k.box(m, [S - 0.12, 0.04, 0.08], [0, cy, 0]);
    k.box(glass, [S - 0.12, S - 0.12, 0.01], [0, cy, 0]);
    k.box(m, [S + 0.12, 0.04, 0.2], [0, y0 - 0.02, 0.04]); // sill sticks out on the +Z side
  }],

  // walkable (runtime/terrain.js): actors that walk onto stairs, steps, ramps and stages ride their surface
  stairs: ["樓梯", "building", "#bdb6aa", (k, m, c) => {
    const { n: N, rise, width: W } = STAIRS, stepZ = treads(k, m, c, STAIRS);
    const rail = mat("#3a3d42", { roughness: 0.5, metalness: 0.3 });
    for (const x of [-W / 2 + 0.04, W / 2 - 0.04]) {
      const posts = [0, 4, N - 1].map((i) => [x, (i + 1) * rise, stepZ(i)]);
      for (const [px, py, pz] of posts) k.cyl(rail, 0.02, 0.02, 0.9, [px, py + 0.45, pz], null, 8);
      k.tube(rail, [x, posts[0][1] + 0.9, posts[0][2]], [x, posts[2][1] + 0.9, posts[2][2]], 0.025);
    }
  }],

  steps: ["台階", "building", "#bdb6aa", (k, m, c) => { treads(k, m, c, STEPS); }],

  ramp: ["斜坡", "building", "#bdb6aa", (k, m, c) => {
    const { width: W, height: H, depth: D } = RAMP;
    k.mesh(profile([[D / 2, 0], [-D / 2, 0], [-D / 2, H]], W), m); // low end at +Z, rising toward -Z
    const edge = mat(shade(c, -0.25));
    for (const x of [-W / 2 + 0.03, W / 2 - 0.03]) k.box(edge, [0.06, 0.012, Math.hypot(D, H)], [x, H / 2 + 0.006, 0], [Math.atan2(H, D) / D2R, 0, 0]);
  }],

  stage: ["舞台", "building", "#a89f91", (k, m, c) => {
    const { width: W, height: H, depth: D } = STAGE;
    k.box(m, [W, H, D], [0, H / 2, 0]);
    k.box(mat(shade(c, -0.2)), [W + 0.01, H - 0.06, 0.01], [0, (H - 0.06) / 2, D / 2], null); // front skirt
    k.box(mat(shade(c, -0.25)), [W + 0.01, 0.014, 0.04], [0, H + 0.006, D / 2 - 0.02]); // front edge strip
  }],

  elevator: ["電梯", "building", "#b8bec4", (k, m, c) => {
    // cab only, no shaft: actors standing on the floor ride along when its path rises (terrain.js)
    const { width: W, depth: D, height: H, floor: F, door: DW, doorHeight: DH } = ELEVATOR;
    const t = 0.06, wallH = H - F - t, wallY = (H + F - t) / 2, steel = metal(shade(c, 0.08)), dark = mat("#2a2d31");
    k.box(mat(shade(c, -0.3)), [W, F, D], [0, F / 2, 0]); // floor
    k.box(m, [W, t, D], [0, H - t / 2, 0]); // roof
    k.box(glow("#fff4dc", 1.2), [W * 0.5, 0.02, D * 0.5], [0, H - t - 0.01, 0]); // ceiling light
    k.box(m, [W, wallH, t], [0, wallY, -D / 2 + t / 2]); // back wall
    for (const s of [-1, 1]) k.box(m, [t, wallH, D], [s * (W / 2 - t / 2), wallY, 0]);
    // front (+Z): wall pieces beside the opening and a header above it
    const side = (W - DW) / 2;
    for (const s of [-1, 1]) k.box(m, [side, wallH, t], [s * (W - side) / 2, wallY, D / 2 - t / 2]);
    k.box(m, [DW, H - t - F - DH, t], [0, (H - t + F + DH) / 2, D / 2 - t / 2]);
    // center opening doors slide behind the wall pieces (state = how far open, prop-anim.js)
    k.group.userData.slide = [-1, 1].map((s) => {
      const x0 = (s * DW) / 4;
      const obj = k.box(steel, [DW / 2, DH, 0.03], [x0, F + DH / 2, D / 2 - t - 0.02]);
      return { obj, x0, dx: s * (DW / 2 - 0.03) };
    });
    k.box(dark, [0.12, 0.3, 0.02], [-(DW / 2 + 0.15), 1.1, D / 2 - t - 0.01]); // buttons, inside right of the door
    k.box(glow("#ffb347", 0.8), [0.24, 0.08, 0.01], [0, (H - t + F + DH) / 2, D / 2 + 0.005]); // floor display
  }],

  building: ["建築物", "building", "#cfc6b4", (k, m, c) => {
    const W = 12, D = 8, F = 3, FH = 3.15, top = F * FH;
    const glass = mat("#2e4560", { roughness: 0.3 }), band = mat(shade(c, -0.15));
    k.box(m, [W, top, D], [0, top / 2, 0]);
    for (const s of [-1, 1]) {
      k.box(band, [W, 0.55, 0.25], [0, top + 0.275, s * (D / 2 - 0.125)]); // parapet, total 10 m
      k.box(band, [0.25, 0.55, D], [s * (W / 2 - 0.125), top + 0.275, 0]);
    }
    for (let f = 1; f <= F; f++) k.box(band, [W + 0.1, 0.15, D + 0.1], [0, f * FH, 0]);
    for (let f = 0; f < F; f++) {
      const y = f * FH + 1.7;
      for (const x of [-4.8, -2.4, 0, 2.4, 4.8]) for (const s of [-1, 1]) {
        if (f === 0 && s === 1 && x === 0) continue; // entrance
        k.box(glass, [1.3, 1.6, 0.08], [x, y, s * (D / 2 + 0.02)]);
      }
      for (const z of [-2.4, 0, 2.4]) for (const s of [-1, 1]) k.box(glass, [0.08, 1.6, 1.3], [s * (W / 2 + 0.02), y, z]);
    }
    k.box(glass, [2.0, 2.5, 0.1], [0, 1.25, D / 2 + 0.03]);
    k.box(band, [3.0, 0.15, 1.2], [0, 2.8, D / 2 + 0.6]);
  }],

  fence: ["圍欄", "building", "#ece8df", (k, m) => {
    const tip = k.geo("tip", () => new THREE.ConeGeometry(0.05, 0.09, 4));
    for (const x of [-1.2, 0, 1.2]) {
      k.box(m, [0.09, 1.05, 0.09], [x, 0.525, -0.04]);
      k.box(m, [0.12, 0.03, 0.12], [x, 1.065, -0.04]);
    }
    for (const y of [0.25, 0.75]) k.box(m, [2.4, 0.07, 0.03], [0, y, -0.03]);
    for (let j = -9; j <= 9; j++) {
      if (!j) continue;
      const x = j * 0.12;
      k.box(m, [0.07, 0.86, 0.02], [x, 0.47, 0]);
      k.mesh(tip, m, [x, 0.945, 0]).scale.set(0.7, 1, 0.2);
    }
  }],

  streetlight: ["路燈", "building", "#50565d", (k, m) => {
    k.cyl(m, 0.14, 0.17, 0.5, [0, 0.25, 0]);
    k.cyl(m, 0.05, 0.08, 4.0, [0, 2.5, 0], null, 10); // pole top at 4.5 m
    k.ball(m, 0.06, [0, 4.5, 0]);
    k.tube(m, [0, 4.3, 0], [0, 4.5, 1.1], 0.035); // arm reaches over the street (+Z)
    k.box(m, [0.26, 0.12, 0.55], [0, 4.5, 1.25]);
    k.box(glow("#fff1c2", 1.6), [0.2, 0.02, 0.45], [0, 4.435, 1.25]);
  }],

  // ---------- vehicles ----------
  car: ["汽車", "vehicle", "#3a6ea5", (k, m) => {
    const glass = mat("#1f2a33", { roughness: 0.25 }), tire = mat("#1b1b1b", { roughness: 0.9 });
    const rim = metal("#b9bec4"), trim = mat("#222222"), head = glow("#fff6d8", 1.2), tail = glow("#d0182a", 0.9);
    k.mesh(profile([[-2.25, 0.3], [2.25, 0.3], [2.25, 0.62], [2.08, 0.79], [0.95, 0.93], [-1.55, 0.96], [-2.15, 0.9], [-2.25, 0.72]], 1.8), m);
    k.mesh(profile([[1.0, 0.9], [0.08, 1.42], [-0.92, 1.42], [-1.62, 0.92]], 1.56), glass);
    k.box(m, [1.6, 0.05, 1.04], [0, 1.43, -0.42]); // roof
    k.box(m, [1.6, 0.48, 0.09], [0, 1.17, -0.42]); // B pillar
    for (const s of [-1, 1]) {
      k.tube(m, [s * 0.79, 0.92, 1.0], [s * 0.79, 1.43, 0.08], 0.035); // A pillar
      k.tube(m, [s * 0.79, 0.95, -1.6], [s * 0.79, 1.43, -0.92], 0.05); // C pillar
      k.box(m, [0.14, 0.08, 0.12], [s * 0.93, 1.0, 0.78]); // mirror
      k.box(head, [0.36, 0.1, 0.03], [s * 0.58, 0.55, 2.255]); // nose is +Z
      k.box(tail, [0.36, 0.09, 0.03], [s * 0.6, 0.63, -2.255]);
      for (const z of [-1.38, 1.38]) {
        const w = wheel(k, [s * 0.82, 0.33, z], 0.33);
        k.cyl(tire, 0.33, 0.33, 0.22, null, [0, 0, 90], 18, w);
        k.cyl(rim, 0.19, 0.19, 0.23, null, [0, 0, 90], 12, w);
        k.box(trim, [0.24, 0.32, 0.05], null, null, w); // cross on the rim shows the wheel turning
        k.box(trim, [0.24, 0.05, 0.32], null, null, w);
      }
    }
    k.box(trim, [0.66, 0.12, 0.02], [0, 0.5, 2.255]); // grille
    for (const s of [-1, 1]) k.box(trim, [1.84, 0.12, 0.1], [0, 0.36, s * 2.23]); // bumpers
  }],

  bike: ["腳踏車", "vehicle", "#2a9d8f", (k, m) => {
    const tire = mat("#1b1b1b", { roughness: 0.9 }), steel = metal("#a7adb3"), dark = mat("#222222");
    const R = [0, 0.355, -0.52], F = [0, 0.355, 0.55], BB = [0, 0.3, -0.06], S = [0, 0.82, -0.24], HT = [0, 0.86, 0.38], HB = [0, 0.7, 0.42];
    const ring = k.geo("ring", () => new THREE.TorusGeometry(0.33, 0.025, 6, 28));
    for (const c of [R, F]) {
      const w = wheel(k, c, 0.355);
      k.mesh(ring, tire, null, [0, 90, 0], w);
      k.cyl(steel, 0.03, 0.03, 0.1, null, [0, 0, 90], 8, w);
      for (let a = 0; a < 180; a += 30) {
        const dy = 0.31 * Math.sin(a * D2R), dz = 0.31 * Math.cos(a * D2R);
        k.tube(steel, [0, dy, dz], [0, -dy, -dz], 0.005, 4, w);
      }
    }
    k.tube(m, S, HT, 0.022);
    k.tube(m, BB, HB, 0.026);
    k.tube(m, BB, S, 0.022);
    k.tube(m, HB, HT, 0.028);
    for (const x of [-0.05, 0.05]) {
      k.tube(m, [x, BB[1], BB[2]], [x, R[1], R[2]], 0.014); // chain stays
      k.tube(m, [x, S[1] - 0.04, S[2]], [x, R[1], R[2]], 0.014); // seat stays
      k.tube(m, [x * 1.2, HB[1], HB[2]], [x * 1.2, F[1], F[2]], 0.015); // fork
    }
    k.tube(steel, S, [0, 0.93, -0.27], 0.014);
    k.box(dark, [0.13, 0.05, 0.26], [0, 0.955, -0.28]); // saddle
    k.tube(steel, HT, [0, 0.98, 0.35], 0.016);
    k.tube(steel, [-0.3, 0.98, 0.34], [0.3, 0.98, 0.34], 0.013);
    for (const x of [-0.27, 0.27]) k.cyl(dark, 0.018, 0.018, 0.1, [x, 0.98, 0.34], [0, 0, 90], 8);
    // crank turns about the bottom bracket while ridden (prop-anim.js); the pedals stay level
    const crank = new THREE.Group(), pedals = [];
    crank.position.set(BB[0], BB[1], BB[2]);
    k.group.add(crank);
    k.cyl(steel, 0.1, 0.1, 0.01, [-0.06, 0, 0], [0, 0, 90], 16, crank); // chainring on the bike's right
    for (const [x, s] of [[-0.075, 1], [0.075, -1]]) {
      const end = [x, -0.12 * s, 0.1 * s];
      k.tube(steel, [x, 0, 0], end, 0.012, 8, crank);
      const pedal = new THREE.Group();
      pedal.position.set(x * 1.6, end[1], end[2]);
      crank.add(pedal);
      k.box(dark, [0.09, 0.02, 0.06], null, null, pedal);
      pedals.push(pedal);
    }
    // a0: the right pedal's angle as built, in the ride action's terms (offset -0.156 (cos a, sin a) in y, z)
    k.group.userData.crank = { obj: crank, pedals, a0: Math.atan2(-0.1, 0.12) };
  }],

  motorcycle: ["機車", "vehicle", "#c8423a", (k, m) => {
    const tire = mat("#1b1b1b", { roughness: 0.9 }), rim = metal("#b9bec4"), dark = mat("#26282b");
    for (const z of [-0.6, 0.68]) {
      const w = wheel(k, [0, 0.24, z], 0.24);
      k.cyl(tire, 0.24, 0.24, 0.12, null, [0, 0, 90], 16, w);
      k.cyl(rim, 0.13, 0.13, 0.125, null, [0, 0, 90], 12, w);
      k.box(dark, [0.135, 0.22, 0.035], null, null, w); // cross on the rim shows the wheel turning
      k.box(dark, [0.135, 0.035, 0.22], null, null, w);
    }
    k.box(m, [0.36, 0.36, 0.78], [0, 0.53, -0.49]); // rear body over the rear wheel
    k.box(dark, [0.32, 0.09, 0.66], [0, 0.755, -0.47]); // seat
    k.box(dark, [0.34, 0.07, 0.52], [0, 0.31, 0.14]); // floorboard
    k.box(dark, [0.12, 0.14, 0.4], [0.13, 0.3, -0.5]); // engine and exhaust
    k.box(m, [0.44, 0.65, 0.16], [0, 0.715, 0.32], [-18, 0, 0]); // leg shield
    k.box(m, [0.2, 0.08, 0.36], [0, 0.53, 0.68]); // front fender
    k.tube(dark, [0, 0.55, 0.6], [0, 0.24, 0.68], 0.025);
    k.tube(dark, [0, 1.0, 0.25], [0, 1.1, 0.22], 0.03);
    k.box(m, [0.3, 0.12, 0.18], [0, 1.1, 0.22]); // handlebar cowl
    k.box(glow("#fff6d8", 1.2), [0.14, 0.07, 0.02], [0, 1.1, 0.315]);
    k.tube(dark, [-0.34, 1.12, 0.2], [0.34, 1.12, 0.2], 0.015);
    for (const s of [-1, 1]) {
      k.cyl(dark, 0.02, 0.02, 0.1, [s * 0.3, 1.12, 0.2], [0, 0, 90], 8);
      k.tube(dark, [s * 0.2, 1.12, 0.2], [s * 0.26, 1.3, 0.18], 0.008); // mirror stalk
      k.box(dark, [0.09, 0.05, 0.015], [s * 0.26, 1.32, 0.18]);
    }
    k.box(glow("#d0182a", 0.9), [0.16, 0.05, 0.02], [0, 0.64, -0.885]);
  }],

  // ---------- nature ----------
  tree: ["樹", "nature", "#4f8a3c", (k, m) => {
    m.flatShading = true;
    k.cyl(mat("#6b4a2f", { roughness: 0.9 }), 0.12, 0.18, 2.6, [0, 1.3, 0], null, 8);
    for (const [x, y, z, r] of [[0, 3.5, 0, 1.4], [0.8, 3.0, 0.3, 1.0], [-0.7, 3.1, -0.3, 1.05], [0.1, 4.3, -0.1, 0.95], [-0.2, 3.0, 0.8, 0.9]]) k.ico(m, r, [x, y, z]);
  }],

  bush: ["灌木", "nature", "#3f7a35", (k, m) => {
    m.flatShading = true;
    for (const [x, y, z, r] of [[0, 0.45, 0, 0.5], [0.42, 0.33, 0.1, 0.38], [-0.4, 0.34, -0.05, 0.4], [0.05, 0.33, 0.36, 0.35], [0, 0.33, -0.36, 0.35]]) {
      k.ico(m, r, [x, y, z], [1, 0.85, 1]);
    }
  }],

  rock: ["石頭", "nature", "#8a8580", (k, m) => {
    m.flatShading = true;
    const g = new THREE.IcosahedronGeometry(0.5, 1), p = g.attributes.position, v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      // hash of the rounded position, so duplicated face vertices move together
      const n = Math.sin(Math.round(v.x * 1e3) * 12.9898 + Math.round(v.y * 1e3) * 78.233 + Math.round(v.z * 1e3) * 37.719) * 43758.5453;
      v.multiplyScalar(0.82 + 0.32 * (n - Math.floor(n)));
      p.setXYZ(i, v.x * 1.0, v.y * 0.62, v.z * 0.78);
    }
    g.computeVertexNormals();
    g.computeBoundingBox();
    g.translate(0, -g.boundingBox.min.y - 0.04, 0); // sink slightly into the ground
    k.mesh(g, m);
  }],

  // ---------- small ----------
  box: ["紙箱", "small", "#c49a6c", (k, m, c) => {
    const tape = mat(shade(c, 0.12), { roughness: 0.5 });
    k.box(m, [0.45, 0.45, 0.45], [0, 0.225, 0]);
    k.box(tape, [0.07, 0.004, 0.452], [0, 0.451, 0]);
    for (const z of [-0.226, 0.226]) k.box(tape, [0.07, 0.12, 0.004], [0, 0.39, z]);
    k.box(mat(shade(c, -0.2)), [0.452, 0.004, 0.006], [0, 0.451, 0]); // flap seam under clear tape look
  }, { ...grip([-0.225, 0.28, 0.03], [0, 0, 0], [0.02, -0.06, 0]), upright: true, shape: "open" }], // palm flat on its side

  baby: ["嬰兒", "small", "#e8e0d0", (k, m) => {
    k.box(m, [0.2, 0.14, 0.38], [0, 0.07, -0.04]); // swaddled, lying along Z with the face up (+Y)
    k.ball(mat("#e3b896"), 0.065, [0, 0.07, 0.17]);
  }, { ...grip([0, 0, -0.04], [-90, 0, -90], [0.03, -0.03, 0]), shape: "open" }], // along the forearm, head just short of the elbow so the upper arm misses it

  cup: ["杯子", "small", "#efe9dc", (k, m) => {
    const sleeve = mat("#7a4e2d"), lid = mat("#2e2e2e", { roughness: 0.6 });
    k.cyl(m, 0.045, 0.033, 0.12, [0, 0.06, 0], null, 16); // takeaway cup, origin at the bottom
    k.cyl(sleeve, 0.0435, 0.0385, 0.05, [0, 0.065, 0], null, 16);
    k.cyl(lid, 0.048, 0.048, 0.012, [0, 0.124, 0], null, 16);
    k.cyl(lid, 0.038, 0.046, 0.012, [0, 0.136, 0], null, 16);
  }, grip([0, 0.07, 0], [0, 0, 0], [0.015, -0.075, 0.055])],

  phone: ["手機", "small", "#2b2f36", (k, m) => {
    k.box(m, [0.072, 0.15, 0.008], [0, 0.075, 0]); // standing on its short edge, screen +Z
    k.box(glow("#4a7fc1", 0.7), [0.064, 0.138, 0.001], [0, 0.075, 0.0045]);
    k.box(mat("#111111"), [0.02, 0.03, 0.002], [-0.02, 0.125, -0.005]);
  }, grip([0, 0.075, 0], [180, 90, 0], [0, -0.13, 0.025])], // top toward the fingertips, screen toward the palm (eyes, ear)

  bag: ["包包", "small", "#8e3b46", (k, m, c) => {
    const strap = mat(shade(c, -0.12)), clasp = mat("#d4b25a", { roughness: 0.35, metalness: 0.7 });
    const body = new THREE.ExtrudeGeometry(new THREE.Shape([v2(-0.17, 0), v2(0.17, 0), v2(0.14, 0.24), v2(-0.14, 0.24)]), { depth: 0.12, bevelEnabled: false });
    body.translate(0, 0, -0.06);
    k.mesh(body, m);
    k.box(strap, [0.27, 0.08, 0.006], [0, 0.2, 0.063]); // flap
    k.box(clasp, [0.04, 0.025, 0.01], [0, 0.165, 0.068]);
    k.mesh(k.geo("h", () => new THREE.TorusGeometry(0.085, 0.011, 6, 16, Math.PI)), strap, [0, 0.24, 0]); // handle top at 0.325
  }, grip([0, 0.325, 0], [0, -90, 0], [-0.02, -0.09, 0])],

  book: ["書", "small", "#2f5d8a", (k, m) => {
    for (const z of [-0.014, 0.014]) k.box(m, [0.16, 0.23, 0.004], [0, 0.115, z]);
    k.box(m, [0.006, 0.23, 0.032], [-0.077, 0.115, 0]); // spine on -X, front cover faces +Z
    k.box(mat("#e8d9a8"), [0.1, 0.035, 0.002], [0.005, 0.165, 0.0165]); // title label
    k.box(mat("#f3efe2"), [0.152, 0.222, 0.024], [0, 0.115, 0]);
  }, grip([0, 0.115, 0], [0, -90, 0], [0.01, -0.16, 0])],

  umbrella: ["雨傘", "small", "#b8323a", (k, m) => {
    m.side = THREE.DoubleSide;
    m.flatShading = true;
    const dark = mat("#3a2a20");
    k.mesh(new THREE.ConeGeometry(0.52, 0.26, 8, 1, true), m, [0, 0.82, 0]); // open canopy, apex at 0.95
    k.cyl(dark, 0.007, 0.007, 0.816, [0, 0.582, 0], null, 6);
    k.cyl(dark, 0.016, 0.016, 0.12, [0, 0.114, 0], null, 10); // straight grip above the hook
    k.mesh(new THREE.TorusGeometry(0.04, 0.014, 6, 12, Math.PI), dark, [0.04, 0.054, 0], [0, 0, 180]);
  }, { ...grip([0, 0.114, 0], [15, 0, 8]), upright: true }],

  pistol: ["手槍", "small", "#33363b", (k, m) => {
    const dark = mat("#1c1d20");
    k.box(m, [0.03, 0.035, 0.19], [0, 0.125, 0.02]); // slide, muzzle toward +Z
    k.box(dark, [0.028, 0.025, 0.15], [0, 0.095, 0.01]);
    k.box(m, [0.03, 0.11, 0.045], [0, 0.055, -0.05], [15, 0, 0]); // grip, origin under it
    k.box(dark, [0.008, 0.008, 0.05], [0, 0.07, 0.015]);
    k.box(dark, [0.008, 0.03, 0.008], [0, 0.083, 0.04]);
    k.box(dark, [0.006, 0.02, 0.006], [0, 0.077, 0.008]);
    k.cyl(dark, 0.007, 0.007, 0.01, [0, 0.13, 0.116], [90, 0, 0], 8);
  }, grip([0, 0.055, -0.05], [90, 0, 0])],

  bat: ["球棒", "small", "#c9a46a", (k, m) => {
    const pts = [[0, 0], [0.03, 0], [0.032, 0.012], [0.016, 0.026], [0.0135, 0.09], [0.015, 0.3], [0.024, 0.5], [0.031, 0.65], [0.033, 0.8], [0.029, 0.835], [0, 0.84]];
    k.mesh(new THREE.LatheGeometry(pts.map(([r, y]) => v2(r, y)), 14), m); // knob at the origin, barrel up
    k.cyl(mat("#2a2a2a"), 0.0148, 0.0142, 0.2, [0, 0.13, 0], null, 12); // grip tape
  }, grip([0, 0.09, 0], [145, 0, 0])],

  marker: ["地面標記", "small", "#ffd400", (k, m, c) => {
    m.emissive = new THREE.Color(c);
    m.emissiveIntensity = 0.35;
    for (const a of [45, -45]) k.box(m, [0.5, 0.008, 0.07], [0, 0.004, 0], [0, a, 0]);
    k.mesh(new THREE.RingGeometry(0.3, 0.35, 32), m, [0, 0.006, 0], [-90, 0, 0]); // ring keeps it readable from any angle
  }],
};

export const PROPS = Object.fromEntries(Object.entries(DEFS).map(([key, [label, cat, color, make, hold = null]]) => [key, {
  label, cat, color, hold,
  build(c) {
    const col = c || this?.color || color;
    const k = kit(key);
    make(k, mat(col), col);
    return k.group;
  },
}]));
