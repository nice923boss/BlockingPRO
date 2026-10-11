// Static prop merge (s08): the fixed parts of a built prop become one mesh per material, so a big scene sends far
// fewer draw calls (the 3D view, the shadow map and every monitor view draw each mesh once).
// Moving parts marked for runtime/prop-anim.js keep their own meshes. Parts that start above head height stay apart
// from the rest, so the walk-through check still lets actors walk under a tree crown or a streetlight arm.
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { OVERHEAD } from "./collide.js";

const ATTRS = ["position", "normal", "uv"];

const movingParts = (u) => [
  ...(u.spin || []).map((s) => s.obj), u.crank?.obj, ...(u.crank?.pedals || []), u.leaf, u.fan, ...(u.slide || []).map((s) => s.obj),
].filter(Boolean);

/**
 * Merge the static parts of a built prop in place (call before the prop's own transform is set).
 * scaleY: the prop's vertical scale, for the head height split. Returns how many meshes were removed.
 */
export function mergeStatic(root, scaleY = 1) {
  const skip = new Set(movingParts(root.userData));
  root.updateMatrixWorld(true);
  const inv = root.matrixWorld.clone().invert();
  const groups = new Map();
  const visit = (o) => {
    if (skip.has(o)) return;
    for (const c of o.children) visit(c);
    if (!o.isMesh || o === root || o.children.length || !o.visible || Array.isArray(o.material) || o.material.transparent) return;
    const g = o.geometry, names = Object.keys(g.attributes);
    if (names.length !== ATTRS.length || !ATTRS.every((a) => g.attributes[a]) || Object.keys(g.morphAttributes).length) return;
    const m = inv.clone().multiply(o.matrixWorld);
    if (m.determinant() <= 0) return; // mirrored parts would turn inside out
    const geo = g.clone().applyMatrix4(m);
    geo.computeBoundingBox();
    const key = o.material.uuid + (geo.boundingBox.min.y * scaleY > OVERHEAD ? "+" : "");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ mesh: o, geo });
  };
  visit(root);
  const old = new Set();
  let removed = 0;
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    const indexed = list.every((x) => x.geo.index);
    const merged = mergeGeometries(list.map((x) => (indexed ? x.geo : x.geo.index ? x.geo.toNonIndexed() : x.geo)));
    if (!merged) continue;
    const first = list[0].mesh, mesh = new THREE.Mesh(merged, first.material);
    mesh.castShadow = first.castShadow;
    mesh.receiveShadow = first.receiveShadow;
    mesh.userData.merged = list.length;
    root.add(mesh);
    for (const { mesh: o } of list) { o.removeFromParent(); old.add(o.geometry); }
    removed += list.length - 1;
  }
  // free the original geometries no remaining part still uses (the prop kit shares them between parts)
  root.traverse((o) => { if (o.isMesh) old.delete(o.geometry); });
  for (const g of old) g.dispose();
  return removed;
}
