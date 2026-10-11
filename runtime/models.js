// Imported 3D models (p06): GLB and OBJ files used as custom props. The asset keeps only
//   model: { file, unit, yaw, size, look }
// file: the file name (the bytes live in the editor's IndexedDB, or are handed to render.html by check_scene.py);
// unit: meters per file unit; yaw: degrees turning the model so its front faces +Z; size: [x, y, z] meters after
// unit and yaw, used for the placeholder box while the file is missing; look: "white" (one matte material in the
// prop colour, like the built-in props) or "original" (the file's own materials).
// Skinned models show their bind pose; their animations are not played.
import * as THREE from "three";
import { mat } from "./props.js";

const D2R = Math.PI / 180;
export const MODEL_EXT = /\.(glb|obj)$/i;
export const MAX_MODEL_BYTES = 60 * 1024 * 1024;

let loaders = null, cloneDeep = null;
function getLoaders() {
  loaders ||= Promise.all([
    import("three/addons/loaders/GLTFLoader.js"), import("three/addons/loaders/OBJLoader.js"),
    import("three/addons/loaders/DRACOLoader.js"), import("three/addons/libs/meshopt_decoder.module.js"),
    import("three/addons/utils/SkeletonUtils.js"),
  ]).then(([{ GLTFLoader }, { OBJLoader }, { DRACOLoader }, { MeshoptDecoder }, SU]) => {
    cloneDeep = SU.clone; // keeps skinned meshes bound to their own copy of the skeleton
    const draco = new DRACOLoader().setDecoderPath(import.meta.resolve("three/addons/libs/draco/gltf/"));
    return { gltf: new GLTFLoader().setDRACOLoader(draco).setMeshoptDecoder(MeshoptDecoder), obj: new OBJLoader() };
  });
  return loaders;
}

/** Parse a model file into a three.js object, in the file's own units and origin */
export async function parseModel(name, buf) {
  const L = await getLoaders();
  if (/\.obj$/i.test(name)) return L.obj.parse(new TextDecoder().decode(buf));
  const g = await L.gltf.parseAsync(buf, "");
  return g.scene;
}

/** Triangles and meshes of a parsed model */
export function modelStats(raw) {
  let tris = 0, meshes = 0, skinned = 0;
  raw.traverse((o) => {
    if (!o.isMesh) return;
    meshes++;
    if (o.isSkinnedMesh) skinned++;
    const g = o.geometry;
    tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
  });
  return { tris: Math.round(tris), meshes, skinned };
}

/** Meters per file unit guessed from the height: over 200 units is taken as millimeters, over 20 as centimeters */
export function guessUnit(raw) {
  raw.updateMatrixWorld(true);
  const tall = new THREE.Box3().setFromObject(raw).getSize(new THREE.Vector3()).y;
  return tall > 200 ? 0.001 : tall > 20 ? 0.01 : 1;
}

// The model scaled to meters and turned by yaw, origin moved to the centre of its bottom
function place(raw, unit, yaw) {
  const inner = cloneDeep ? cloneDeep(raw) : raw.clone(true);
  inner.scale.multiplyScalar(unit);
  const turn = new THREE.Group();
  turn.rotation.y = yaw * D2R;
  turn.add(inner);
  const out = new THREE.Group();
  out.add(turn);
  out.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(out);
  const c = box.getCenter(new THREE.Vector3());
  turn.position.set(-c.x, -box.min.y, -c.z);
  return { out, size: box.getSize(new THREE.Vector3()) };
}

/** Size in meters [x, y, z] the model takes with this unit and yaw (rounded to millimeters) */
export function modelSize(raw, unit, yaw) {
  const { size } = place(raw, unit, yaw);
  return size.toArray().map((x) => Math.round(x * 1000) / 1000);
}

/** The prop object: the placed model, or a see-through box of model.size while the file is not loaded */
export function buildModel(m, color, raw) {
  const group = new THREE.Group();
  if (!raw) {
    const s = Array.isArray(m.size) ? m.size.map((x) => Math.max(0.01, x)) : [0.5, 0.5, 0.5];
    const box = new THREE.Mesh(new THREE.BoxGeometry(s[0], s[1], s[2]), mat(color, { transparent: true, opacity: 0.35, depthWrite: false }));
    box.position.y = s[1] / 2;
    box.userData.placeholder = true;
    group.add(box);
    return group;
  }
  const { out } = place(raw, m.unit || 1, m.yaw || 0);
  if (m.look !== "original") {
    const white = mat(color, { roughness: 0.85 });
    out.traverse((o) => { if (o.isMesh) o.material = white; });
  }
  group.add(out);
  return group;
}
