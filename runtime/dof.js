// Depth of field for the program picture. The scene is rendered into an offscreen target with a depth texture,
// then a full-screen pass blurs each pixel by its circle of confusion (thin lens on a 36 mm wide sensor).
// Gather blur after Dennis Gustafsson's single-pass "bokeh depth of field" (golden-angle spiral).
import * as THREE from "three";

const VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const FRAG = /* glsl */ `
#include <packing>
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform vec2 texel;
uniform float near, far, focus, coc, maxR, radScale;
varying vec2 vUv;
float dist(vec2 uv) { return -perspectiveDepthToViewZ(texture2D(tDepth, uv).x, near, far); }
float cocAt(float d) { return min(maxR, coc * abs(d - focus) / max(d, 1e-3)); }
void main() {
  vec3 col = texture2D(tColor, vUv).rgb;
  float d0 = dist(vUv), r0 = cocAt(d0);
  vec3 acc = col;
  float tot = 1.0, radius = radScale, ang = 0.0;
  for (int i = 0; i < 160; i++) {
    if (radius >= maxR) break;
    ang += 2.39996323;
    vec2 uv = vUv + vec2(cos(ang), sin(ang)) * texel * radius;
    vec3 sc = texture2D(tColor, uv).rgb;
    float sd = dist(uv), sr = cocAt(sd);
    // a sharp background must not bleed over a blurred foreground edge
    if (sd > d0) sr = clamp(sr, 0.0, r0 * 2.0);
    float m = smoothstep(radius - 0.5, radius + 0.5, sr);
    acc += mix(acc / tot, sc, m);
    tot += 1.0;
    radius += radScale / radius;
  }
  gl_FragColor = vec4(acc / tot, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

/** Focus distance in metres: the camera's own setting, or the distance to what it aims at */
export const focusDistance = (st) => st.dof?.focus || st.position.distanceTo(st.target);

/** Blur radius in pixels for a point at distance d (metres), for a frame whose long side is longPx */
export function cocRadius(st, d, longPx) {
  const f = st.lens, s = Math.max(focusDistance(st) * 1000, f * 1.01), N = st.dof.fstop;
  return ((f * f) / (N * (s - f))) * (Math.abs(d * 1000 - s) / (d * 1000)) / 36 * longPx / 2;
}

export class DofPass {
  constructor() {
    this.target = null;
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, depthTest: false, depthWrite: false,
      uniforms: Object.fromEntries(["tColor", "tDepth", "texel", "near", "far", "focus", "coc", "maxR", "radScale"].map((k) => [k, { value: null }])),
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat);
    this.quad.frustumCulled = false;
    this.quadScene = new THREE.Scene();
    this.quadScene.add(this.quad);
    this.ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  }

  _ensure(w, h) {
    if (this.target && this.target.width === w && this.target.height === h) return;
    this.target?.dispose();
    this.target = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples: 4, depthTexture: new THREE.DepthTexture(w, h) });
  }

  /**
   * Draw scene through camera (already placed from camera state st, which has st.dof) into the renderer's
   * current viewport. w, h: that viewport in device pixels.
   */
  render(renderer, scene, camera, st, w, h) {
    w = Math.max(1, Math.round(w));
    h = Math.max(1, Math.round(h));
    this._ensure(w, h);
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(this.target);
    renderer.render(scene, camera);
    renderer.setRenderTarget(prev);
    const U = this.mat.uniforms, long = Math.max(w, h), maxR = Math.max(1, h * 0.025);
    U.tColor.value = this.target.texture;
    U.tDepth.value = this.target.depthTexture;
    U.texel.value = new THREE.Vector2(1 / w, 1 / h);
    U.near.value = camera.near;
    U.far.value = camera.far;
    U.focus.value = focusDistance(st);
    // coc * |d - focus| / d is the blur radius in pixels
    U.coc.value = cocRadius(st, 1e9, long);
    U.maxR.value = maxR;
    // keep the spiral under about 120 samples at any size
    U.radScale.value = Math.max(0.5, (maxR * maxR) / 240);
    renderer.render(this.quadScene, this.ortho);
  }

  dispose() {
    this.target?.dispose();
    this.mat.dispose();
    this.quad.geometry.dispose();
  }
}
