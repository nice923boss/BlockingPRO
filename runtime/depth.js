// Grey depth frames for ControlNet-style tools (o06): near is white, far and sky are black, linear in between.
// The range follows each shot's camera-to-aim distance at the start of the shot, so the subject sits in the bright half.
import * as THREE from "three";

let mat = null;
const BLACK = new THREE.Color(0, 0, 0);

function material() {
  return (mat ||= new THREE.ShaderMaterial({
    uniforms: { near: { value: 1 }, far: { value: 10 } },
    side: THREE.DoubleSide,
    vertexShader: `varying float vDepth;
      void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); vDepth = -mv.z; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform float near; uniform float far; varying float vDepth;
      void main() { gl_FragColor = vec4(vec3(1.0 - clamp((vDepth - near) / (far - near), 0.0, 1.0)), 1.0); }`,
  }));
}

/** [near, far] in metres for a camera state: half to four times the distance to the aim point */
export function depthRange(st) {
  const d = Math.max(1, st.position.distanceTo(st.target));
  return [0.5 * d, 4 * d];
}

/** Render scene through camera as depth; grid lines, outlines and the backdrop are left out */
export function renderDepth(renderer, scene, camera, [near, far]) {
  const m = material(), hidden = [];
  m.uniforms.near.value = near;
  m.uniforms.far.value = far;
  scene.traverse((o) => { if (o.visible && (o.isLine || o.isPoints || o.userData.outline)) { o.visible = false; hidden.push(o); } });
  const { background, fog, overrideMaterial } = scene;
  Object.assign(scene, { background: BLACK, fog: null, overrideMaterial: m });
  try {
    renderer.render(scene, camera);
  } finally {
    Object.assign(scene, { background, fog, overrideMaterial });
    hidden.forEach((o) => { o.visible = true; });
  }
}
