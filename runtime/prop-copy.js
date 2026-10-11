// Copy a built-in prop into a custom asset: build it, then turn every mesh back into a part
// (box, cylinder, cone, sphere, capsule, torus) at its place relative to the prop root.
// Shapes the custom format has no part for are approximated: lathe → cylinder, ring → flat torus,
// faceted blob → scaled sphere, extruded profile → its bounding box. Animated pieces (door leaf)
// become ordinary static parts; material finish (metal, double sided) and hold.shape / upright are dropped.
import * as THREE from "three";
import { PROPS, grip } from "./props.js";
import { uniqueAssetId, disposeObject } from "./assets.js";

const R2D = 180 / Math.PI;
const r4 = (x) => Math.round(x * 10000) / 10000 || 0;
const r2 = (x) => Math.round(x * 100) / 100 || 0;
const near1 = (s) => s.every((x) => Math.abs(x - 1) < 1e-4);
const FLIP = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI);

/** Part shape fields for a geometry; scale multiplies the mesh scale; approx marks a stand-in shape. */
function shapeOf(g) {
  const p = g.parameters || {};
  switch (g.type) {
    case "BoxGeometry": return { shape: "box", size: [p.width, p.height, p.depth] };
    case "ConeGeometry": return { shape: "cone", radius: p.radius, height: p.height };
    case "CylinderGeometry": {
      if (p.radiusBottom <= 0) return { shape: "cone", radius: p.radiusTop, height: p.height, flip: true };
      return { shape: "cylinder", radius: p.radiusBottom, height: p.height, ...(p.radiusTop !== p.radiusBottom && { radiusTop: p.radiusTop }) };
    }
    case "SphereGeometry": return { shape: "sphere", radius: p.radius };
    case "CapsuleGeometry": return { shape: "capsule", radius: p.radius, height: p.height + 2 * p.radius };
    case "TorusGeometry": return { shape: "torus", radius: p.radius, tube: p.tube, arc: r2(p.arc * R2D) };
    case "RingGeometry":
      return { shape: "torus", radius: (p.innerRadius + p.outerRadius) / 2, tube: (p.outerRadius - p.innerRadius) / 2, arc: r2(p.thetaLength * R2D), scale: [1, 1, 0.2], approx: true };
  }
  g.computeBoundingBox();
  const b = g.boundingBox, s = b.getSize(new THREE.Vector3()), c = b.getCenter(new THREE.Vector3());
  if (g.type === "IcosahedronGeometry") {
    const r = Math.max(s.x, s.y, s.z) / 2;
    return { shape: "sphere", radius: r, scale: [s.x / 2 / r, s.y / 2 / r, s.z / 2 / r], center: c, approx: true };
  }
  if (g.type === "LatheGeometry") return { shape: "cylinder", radius: Math.max(s.x, s.z) / 2, height: s.y, center: c, approx: true };
  return { shape: "box", size: [s.x, s.y, s.z].map((x) => Math.max(x, 0.004)), center: c, approx: true };
}

/** Color fields for a mesh material: null when it is the prop color, so recoloring still works. */
function look(m, base) {
  const hex = "#" + m.color.getHexString();
  const out = { color: hex === base ? null : hex };
  if (m.emissiveIntensity > 0 && m.emissive && m.emissive.getHex() !== 0) out.glow = r2(Math.min(2, m.emissiveIntensity));
  if (m.transparent && m.opacity < 1) out.opacity = r2(Math.max(0.05, m.opacity));
  return out;
}

/**
 * Custom asset copied from the built-in prop `type`. taken: ids already in the library.
 * Returns { asset, approx (how many parts stand in for an unsupported shape) } or null.
 */
export function copyBuiltinProp(type, taken = new Set()) {
  const def = PROPS[type];
  if (!def) return null;
  const base = def.color.toLowerCase();
  const root = def.build(base);
  root.updateMatrixWorld(true);
  const parts = [];
  let approx = 0;
  const P = new THREE.Vector3(), Q = new THREE.Quaternion(), S = new THREE.Vector3();
  root.traverse((o) => {
    if (!o.isMesh) return;
    const f = shapeOf(o.geometry);
    o.matrixWorld.decompose(P, Q, S);
    if (f.center) P.copy(f.center).applyMatrix4(o.matrixWorld);
    if (f.flip) Q.multiply(FLIP);
    let scale = [S.x, S.y, S.z].map(Math.abs);
    if (f.scale) scale = scale.map((x, i) => x * f.scale[i]);
    const e = new THREE.Euler().setFromQuaternion(Q, "XYZ");
    const part = { shape: f.shape };
    if (f.shape === "box") part.size = f.size.map((x, i) => r4(x * scale[i]));
    else {
      for (const k of ["radius", "radiusTop", "height", "tube", "arc"]) if (f[k] != null) part[k] = k === "arc" ? f[k] : r4(f[k]);
    }
    part.pos = [P.x, P.y, P.z].map(r4);
    part.rot = [e.x, e.y, e.z].map((x) => r2(x * R2D));
    if (f.shape !== "box" && !near1(scale)) part.scale = scale.map(r4);
    parts.push({ ...part, ...look([].concat(o.material)[0], base) });
    if (f.approx) approx++;
  });
  disposeObject(root);
  const id = uniqueAssetId(type.replace(/[A-Z]/g, (c) => "_" + c.toLowerCase()), taken);
  const asset = { id, label: `${def.label} 複本`.slice(0, 30), cat: def.cat, color: base, desc: `由內建物品「${def.label}」複製${approx ? `，${approx} 個零件是近似形狀` : ""}`, parts };
  if (def.hold) {
    // custom holds grip at the fist center; solve the grip point that gives the built-in hold position
    const fist = new THREE.Vector3(...grip([0, 0, 0], [0, 0, 0]).pos);
    const rot = def.hold.rot.map(r2);
    const inv = new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot.map((x) => x / R2D), "XYZ")).invert();
    const g = fist.sub(new THREE.Vector3(...def.hold.pos)).applyQuaternion(inv);
    asset.hold = { grip: [g.x, g.y, g.z].map(r4), rot };
  }
  return { asset, approx };
}
