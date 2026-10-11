// White-model looks (m05): swap mesh materials for a clay, wireframe, toon-outline or deeper-colour version.
// The original material stays in userData.baseMat, so switching back (look null) restores it.
// MeshBasicMaterial (joint markers, bulbs) is left alone.
import * as THREE from "three";

const CLAY = new THREE.Color("#c08a68");
const derived = new WeakMap(); // base material -> { look, mat }
const tmp = new THREE.Color(), hsl = {};
let toonRamp = null, outlineMat = null;

function ramp() {
  if (toonRamp) return toonRamp;
  toonRamp = new THREE.DataTexture(new Uint8Array([90, 170, 255]), 3, 1, THREE.RedFormat);
  toonRamp.minFilter = toonRamp.magFilter = THREE.NearestFilter;
  toonRamp.needsUpdate = true;
  return toonRamp;
}

// back faces pushed out along the view-space normal; the push grows with distance so the line keeps a similar width on screen
function outline() {
  if (outlineMat) return outlineMat;
  outlineMat = new THREE.MeshBasicMaterial({ color: "#16181d", side: THREE.BackSide });
  outlineMat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace("#include <project_vertex>", `
      vec4 mvPosition = modelViewMatrix * vec4( transformed, 1.0 );
      mvPosition.xyz += normalize( normalMatrix * normal ) * 0.004 * max( 2.0, -mvPosition.z );
      gl_Position = projectionMatrix * mvPosition;`);
  };
  return outlineMat;
}

function make(base, look) {
  if (look === "wire") return new THREE.MeshBasicMaterial({ wireframe: true });
  if (look === "toon") {
    const p = { gradientMap: ramp() };
    if (base.emissive) Object.assign(p, { emissive: base.emissive.clone(), emissiveIntensity: base.emissiveIntensity });
    return new THREE.MeshToonMaterial(p);
  }
  const m = base.clone();
  if (look === "clay") m.roughness = 1;
  return m;
}

function tint(c, look) {
  tmp.copy(c);
  if (look === "clay") tmp.lerp(CLAY, 0.6);
  else if (look === "deep") {
    tmp.getHSL(hsl);
    // grey stays grey (only darker); colours get more saturated
    tmp.setHSL(hsl.h, hsl.s < 0.05 ? hsl.s : Math.min(1, hsl.s * 1.4 + 0.15), hsl.l * 0.6);
  }
  return tmp;
}

function derive(base, look) {
  let rec = derived.get(base);
  if (!rec || rec.look !== look) {
    rec?.mat.dispose();
    rec = { look, mat: make(base, look) };
    derived.set(base, rec);
  }
  const d = rec.mat;
  // follow the base every sync: colour edits and the "white + joints" transparency
  d.color.copy(tint(base.color, look));
  d.transparent = base.transparent;
  d.opacity = base.opacity;
  d.depthWrite = base.depthWrite;
  return d;
}

/** Apply look (key of LOOKS, or null for the plain material) to every mesh under root. "deep" only changes actors. */
export function applyLook(root, look, isActor) {
  if (look === "deep" && !isActor) look = null;
  if (!look && !root.userData.looked) return;
  root.userData.looked = true;
  root.traverse((m) => {
    if (!m.isMesh || m.userData.outline) return;
    const base = m.userData.baseMat || m.material;
    if (!base || Array.isArray(base) || base.isMeshBasicMaterial) return;
    m.userData.baseMat = base;
    m.material = look ? derive(base, look) : base;
    let ol = m.userData.outlineMesh;
    if (look === "toon" && !ol) {
      ol = new THREE.Mesh(m.geometry, outline());
      ol.userData.outline = true;
      ol.raycast = () => {};
      m.add(ol);
      m.userData.outlineMesh = ol;
    }
    if (ol) ol.visible = look === "toon" && !base.transparent;
  });
}
