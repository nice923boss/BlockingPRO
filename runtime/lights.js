// Lighting presets (scene-wide) and light objects (spot / point placed by the user).
import * as THREE from "three";

// sun: direction the light comes from; bg: default background when the project leaves it empty
export const LIGHTING = {
  day: { label: "白天", bg: "#9fb3c8", hemi: ["#dfefff", "#5a5040", 1.3], sun: ["#fff6e8", 2.6, [6, 10, 4]] },
  overcast: { label: "陰天", bg: "#a7adb4", hemi: ["#e6eaee", "#4a4d52", 2.1], sun: ["#ffffff", 0.6, [2, 10, 3]] },
  sunset: { label: "黃昏", bg: "#e4a074", hemi: ["#ffd2a8", "#3a2b40", 0.9], sun: ["#ff9a4d", 2.4, [-9, 3, 2]] },
  night: { label: "夜景", bg: "#141a2a", hemi: ["#5d6f9e", "#101018", 0.45], sun: ["#9db4ff", 0.7, [-4, 8, -3]] },
  indoor: { label: "室內", bg: "#3a3631", hemi: ["#fff1dc", "#3b342c", 1.0], sun: ["#ffe2b8", 1.4, [2, 6, 3]], fill: ["#ffd9a8", 18, [-3, 2.6, 2]] },
  studio: { label: "三點打光", bg: "#2a2f38", hemi: ["#ffffff", "#30343c", 0.5], sun: ["#ffffff", 2.4, [4, 6, 5]], fill: ["#bcd4ff", 14, [-5, 3, 3]], rim: ["#ffffff", 22, [0, 4, -6]] },
  neutral: { label: "灰階中性", bg: "#2a2f38", hemi: ["#ffffff", "#445", 1.2], sun: ["#ffffff", 2, [4, 8, 5]] },
};

/** Builds the preset rig into a group; returns { group, sun } */
export function buildLighting(name, extent = 20) {
  const L = LIGHTING[name] || LIGHTING.day;
  const group = new THREE.Group();
  group.name = "lighting";
  group.add(new THREE.HemisphereLight(...L.hemi));
  const sun = new THREE.DirectionalLight(L.sun[0], L.sun[1]);
  sun.position.set(...L.sun[2]).normalize().multiplyScalar(30);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -extent, right: extent, top: extent, bottom: -extent, near: 1, far: 80 });
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.02;
  group.add(sun, sun.target);
  for (const key of ["fill", "rim"]) {
    if (!L[key]) continue;
    const [c, i, p] = L[key];
    const pl = new THREE.PointLight(c, i, 0, 2);
    pl.position.set(...p);
    group.add(pl);
  }
  return { group, sun, background: L.bg };
}

/** A user-placed light. Its transform is set every frame by the scene runtime. */
export function buildLight(spec) {
  const group = new THREE.Group();
  let light;
  if (spec.type === "point") {
    light = new THREE.PointLight(spec.color, spec.intensity, spec.distance, 2);
  } else {
    light = new THREE.SpotLight(spec.color, spec.intensity, spec.distance, (spec.angle * Math.PI) / 180, 0.35, 2);
    group.add(light.target);
  }
  light.castShadow = !!spec.shadow;
  light.shadow.mapSize.set(1024, 1024);
  light.shadow.bias = -0.0008;
  group.add(light);
  return { group, light };
}
