// Scene runtime: turns a (normalised) project into a three.js scene and poses it at any time t.
// Shared by the editor, the director monitor, the MP4 exporter and the headless render page.
import * as THREE from "three";
import { buildHuman } from "./rig-human.js";
import { buildAnimal } from "./rig-animal.js";
import { HUMAN_ACTIONS } from "./actions.js";
import { ANIMAL_ACTIONS } from "./actions-animal.js";
import { propDef } from "./assets.js";
import { buildLighting, buildLight, LIGHTING } from "./lights.js";
import { toPose, blendPose, applyPose } from "./pose.js";
import { buildPath, samplePath, sampleYaw, sampleSpeed, smoothstep } from "./keys.js";
import { evalCamera, applyCameraState, liveCameraId } from "./camera.js";
import { applyLook } from "./look.js";
import { propPose } from "./attach.js";
import { terrainOf, terrainAt, groundAt } from "./terrain.js";
import { animateProp } from "./prop-anim.js";
import { mergeStatic } from "./merge.js";
import { attachList } from "./schema.js";
import { ankleHeight, plantFeet } from "./feet.js";
import { handsAt, heldHands } from "./hands.js";
import { applyGaze } from "./gaze-rig.js";
import { buildGaitTrack, sampleGaitTrack, strideFactors, turnBody } from "./gait-track.js";
import { gaitStyle } from "./gait-style.js";

const D2R = Math.PI / 180;
const UP = new THREE.Vector3(0, 1, 0), FWD = new THREE.Vector3(0, 0, 1);
const _q = new THREE.Quaternion();

// speed bands (m/s) where idle fades into walk and walk into run
const GAIT = {
  human: { walk: [0.1, 0.5], run: [2.2, 3.0] },
  dog: { walk: [0.1, 0.4], run: [1.6, 2.4] },
  cat: { walk: [0.05, 0.3], run: [1.0, 1.6] },
  horse: { walk: [0.2, 0.8], run: [2.5, 4.0] },
  bird: { walk: [0.05, 0.25], run: [0.8, 1.4] },
  rabbit: { walk: [0.05, 0.25], run: [0.8, 1.4] },
  cow: { walk: [0.15, 0.6], run: [2.0, 3.0] },
  sheep: { walk: [0.1, 0.45], run: [1.5, 2.3] },
  chicken: { walk: [0.05, 0.3], run: [0.9, 1.5] },
  duck: { walk: [0.05, 0.25], run: [0.7, 1.2] },
};
// one-shot actions that keep their end pose after the clip unless the clip says otherwise
const HOLD_BY_DEFAULT = ["sit", "sitting", "crouch", "kneel", "lie", "fall"];
const BIRD_FLY_HEIGHT = 0.15;
// walk stride factor while turning on the spot (short shuffling steps, a12)
const STEP_IN_PLACE = 0.35;

const json = (o) => JSON.stringify(o);
const shadows = (obj) => obj.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });

export class SceneRuntime {
  constructor() {
    this.scene = new THREE.Scene();
    this.world = new THREE.Group();
    this.world.name = "entities";
    this.scene.add(this.world);
    this.entities = new Map();
    this.camCache = new Map();
    this.actorState = new Map();
    this.terrain = []; // walkable props (runtime/terrain.js)
    this.project = null;
    this.time = 0;
    this.displayOverride = null;
    this._env = {};
    // file name -> decoded picture (or null while missing); the editor plugs in its IndexedDB store
    this.imageSource = null;
    this.modelSource = null; // file name -> parsed model (null while loading or missing) for imported model props
  }

  /** Rebuild what changed since the last sync. Cheap enough to call after every edit. */
  sync(project) {
    this.project = project;
    this._syncEnvironment(project.settings);
    const seen = new Set();
    for (const a of project.actors) { seen.add(a.id); this._syncActor(a); }
    for (const o of project.props) { seen.add(o.id); this._syncProp(o); }
    for (const l of project.lights) { seen.add(l.id); this._syncLight(l); }
    for (const [id, ent] of this.entities) if (!seen.has(id)) this._remove(id, ent);
    this.terrain = terrainOf(project, (o) => this.entities.get(o.id).path);
    for (const id of this.camCache.keys()) if (!project.cameras.some((c) => c.id === id)) this.camCache.delete(id);
    this.evaluate(this.time);
  }

  _remove(id, ent) {
    this.world.remove(ent.object);
    ent.object.traverse((m) => { if (m.isMesh) m.geometry.dispose(); });
    this.entities.delete(id);
  }

  _syncEnvironment(S) {
    const env = this._env;
    if (env.lighting !== S.lighting) {
      if (env.lights) this.scene.remove(env.lights.group);
      env.lights = buildLighting(S.lighting);
      env.lighting = S.lighting;
      this.scene.add(env.lights.group);
    }
    this._syncBackdrop(S);
    const gk = json(S.ground);
    if (env.groundKey !== gk) {
      if (env.ground) this.scene.remove(env.ground);
      const g = new THREE.Group();
      g.name = "ground";
      if (S.ground.show) {
        const plane = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshStandardMaterial({ color: S.ground.color, roughness: 0.95 }));
        plane.rotation.x = -Math.PI / 2;
        plane.receiveShadow = true;
        plane.userData.ground = true;
        g.add(plane);
        if (S.ground.grid) {
          const c = new THREE.Color(S.ground.color);
          const hsl = c.getHSL({});
          const grid = new THREE.GridHelper(100, 100, new THREE.Color().setHSL(hsl.h, hsl.s, Math.min(1, hsl.l + 0.22)), new THREE.Color().setHSL(hsl.h, hsl.s, Math.min(1, hsl.l + 0.1)));
          grid.position.y = 0.002;
          g.add(grid);
        }
      }
      env.ground = g;
      env.groundKey = gk;
      this.scene.add(g);
    }
  }

  /** Backdrop picture (flat: cropped to the output aspect; pano: 360 equirectangular) or the plain colour */
  _syncBackdrop(S) {
    const env = this._env, bd = S.backdrop, img = bd && this.imageSource?.(bd.file);
    if (!img) {
      this.scene.background = new THREE.Color(S.background || (LIGHTING[S.lighting] || LIGHTING.day).bg);
      this.scene.backgroundRotation.set(0, 0, 0);
      return;
    }
    const key = json([bd.file, bd.mode, S.width, S.height]);
    if (env.bgKey !== key || env.bgImg !== img) {
      env.bgTex?.dispose();
      const tex = new THREE.Texture(img);
      tex.colorSpace = THREE.SRGBColorSpace;
      if (bd.mode === "pano") tex.mapping = THREE.EquirectangularReflectionMapping;
      else {
        // cover: crop the picture so it fills the output frame without stretching
        const ia = img.naturalWidth / Math.max(1, img.naturalHeight), oa = S.width / S.height;
        if (ia > oa) { tex.repeat.set(oa / ia, 1); tex.offset.set((1 - oa / ia) / 2, 0); } else { tex.repeat.set(1, ia / oa); tex.offset.set(0, (1 - ia / oa) / 2); }
      }
      tex.needsUpdate = true;
      Object.assign(env, { bgTex: tex, bgKey: key, bgImg: img });
    }
    this.scene.background = env.bgTex;
    // three.js puts the middle of an equirectangular picture at +X; +90 turns it to -Z (where cameras usually look)
    this.scene.backgroundRotation.set(0, bd.mode === "pano" ? (90 + (bd.rotate || 0)) * D2R : 0, 0);
  }

  _entity(spec, kind, buildKey, build) {
    let ent = this.entities.get(spec.id);
    if (ent && (ent.kind !== kind || ent.buildKey !== buildKey)) { this._remove(spec.id, ent); ent = null; }
    if (!ent) {
      ent = { id: spec.id, kind, buildKey, object: new THREE.Group() };
      ent.object.userData.entityId = spec.id;
      build(ent);
      this.world.add(ent.object);
      this.entities.set(spec.id, ent);
    }
    ent.spec = spec;
    const pk = json(spec.path);
    if (ent.pathKey !== pk) { ent.path = buildPath(spec.path.keys, spec.path.curve); ent.pathKey = pk; }
    return ent;
  }

  _syncActor(a) {
    const ent = this._entity(a, "actor", json([a.kind, a.preset, a.scale, a.body, a.color == null]), (ent) => {
      ent.rig = a.kind === "animal" ? buildAnimal({ type: a.preset, color: a.color || undefined }) : buildHuman({ body: a.preset, shape: a.body, color: a.color || undefined });
      ent.rig.root.scale.setScalar(a.scale);
      shadows(ent.rig.root);
      ent.object.add(ent.rig.root);
      ent.height = ent.rig.height * a.scale;
      ent.lib = a.kind === "animal" ? ANIMAL_ACTIONS : HUMAN_ACTIONS;
      ent.gait = GAIT[a.kind === "animal" ? a.preset : "human"] || GAIT.dog;
      if (a.kind === "human") ent.ankle = ankleHeight(ent);
    });
    if (a.color) ent.rig.setColor(a.color);
    ent.rig.setDisplay(this.displayOverride || this.project.settings.display || a.display);
    applyLook(ent.object, this.project.settings.look, true);
  }

  _syncProp(o) {
    const def = propDef(o.type, this.project.assets);
    const raw = def?.model ? this.modelSource?.(def.model) ?? null : null;
    // custom assets rebuild when their parts change (def.sig); model props when their file finishes loading
    const ent = this._entity(o, "prop", json([o.type, o.color, o.scale, def?.sig, raw ? 1 : 0]), (ent) => {
      ent.mesh = def ? def.build(o.color || def.color, raw) : new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), new THREE.MeshStandardMaterial({ color: "#f0f" }));
      // fewer draw calls in big scenes (s08); imported models keep their own meshes
      if (def && !def.model) mergeStatic(ent.mesh, Array.isArray(o.scale) ? o.scale[1] : o.scale);
      if (Array.isArray(o.scale)) ent.mesh.scale.fromArray(o.scale); else ent.mesh.scale.setScalar(o.scale);
      shadows(ent.mesh);
      ent.object.add(ent.mesh);
    });
    ent.def = def;
    applyLook(ent.object, this.project.settings.look, false);
  }

  _syncLight(l) {
    const ent = this._entity(l, "light", json([l.type, l.shadow]), (ent) => {
      const { group, light } = buildLight(l);
      ent.light = light;
      ent.object.add(group);
    });
    const L = ent.light;
    L.color.set(l.color);
    L.intensity = l.intensity;
    L.distance = l.distance;
    if (L.isSpotLight) L.angle = l.angle * D2R;
  }

  // ---------- evaluation ----------

  /** Pose every entity at time t */
  evaluate(t) {
    this.time = t;
    if (!this.project) return;
    for (const a of this.project.actors) this._evalActor(this.entities.get(a.id), t);
    this.world.updateMatrixWorld(true);
    // gaze needs everyone posed first: it looks at other actors' heads (a01)
    if (this.project.actors.some((a) => a.gaze?.length)) { applyGaze(this, t); this.world.updateMatrixWorld(true); }
    for (const a of this.project.actors) {
      const ent = this.entities.get(a.id), st = this.actorState.get(a.id);
      st.aimPoint = this._aimPoint(ent);
    }
    for (const o of this.project.props) this._evalProp(this.entities.get(o.id), t);
    for (const l of this.project.lights) this._evalLight(this.entities.get(l.id), t);
    this.world.updateMatrixWorld(true);
  }

  /** Position and facing without posing (cheap; used for other times than the evaluated one). Actors stand on walkable props. */
  placement(ent, t) {
    const a = ent.spec, pos = new THREE.Vector3().fromArray(samplePath(ent.path, t).pos);
    if (ent.kind === "actor" && this.terrain.length) pos.y = Math.max(pos.y, groundAt(terrainAt(this.terrain, t), pos.x, pos.z));
    return { pos, yaw: sampleYaw(ent.path, t, a.yaw, a.facing) };
  }

  _evalActor(ent, t) {
    const a = ent.spec, rig = ent.rig;
    const s = samplePath(ent.path, t);
    const pos = new THREE.Vector3().fromArray(s.pos), yaw = sampleYaw(ent.path, t, a.yaw, a.facing);
    // walkable props: the body rides the ground under it unless the path is set higher by hand
    const placed = this.terrain.length ? terrainAt(this.terrain, t) : null, pathY = pos.y;
    const ground = placed ? groundAt(placed, pos.x, pos.z) : 0;
    pos.y = Math.max(pathY, ground);
    ent.object.position.copy(pos);
    ent.object.quaternion.setFromAxisAngle(UP, yaw * D2R);
    const ctx = { dist: s.dist, speed: Math.abs(sampleSpeed(ent.path, t)), height: ent.height, type: a.preset, body: a.body, duration: 2, altitude: Math.max(0, pathY - ground), time: t };
    const gs = a.kind === "human" && a.autoGait ? sampleGaitTrack(this._gaitTrack(ent), t) : null;
    // leaning into a turn tips the whole body about the feet
    const lean = gs ? turnBody(ctx.speed, gs.turn).lean : 0;
    if (lean) ent.object.quaternion.multiply(_q.setFromAxisAngle(FWD, -lean * D2R));
    const base = this._basePose(ent, t, ctx, gs);
    const modeOf = this._modeOf(ent);
    let pose = evalTrack(a.actions, a.actions.length - 1, t, base, (c, lt) => this._clipPose(ent, c, lt, ctx, base), null, modeOf);
    if (a.upper.length && rig.upperBody.length) {
      const full = pose;
      pose = evalTrack(a.upper, a.upper.length - 1, t, full, (c, lt) => this._clipPose(ent, c, lt, ctx, full), rig.upperBody, modeOf);
    }
    applyPose(rig, pose);
    if (a.kind === "human") {
      const held = heldHands(this.project.props, a.id, t, (o) => this.entities.get(o.id)?.def?.hold || null);
      const hands = handsAt(a, t, (c) => modeOf(c).hold, held);
      rig.setHands(hands.l, hands.r);
    }
    if (placed && a.kind === "human" && pathY <= ground + 0.01) plantFeet(ent, placed, ground);
    this.actorState.set(a.id, { pos: ent.object.position.clone(), yaw, aimPoint: null });
  }

  // { hold: keep the clip after it ends, loop: keep the clock running (cycles) instead of freezing on the end pose }
  _modeOf(ent) {
    return (c) => {
      if (c.type === "pose") return { hold: !!c.hold, loop: false };
      const act = ent.lib[c.type];
      return { hold: c.hold ?? act?.hold ?? HOLD_BY_DEFAULT.includes(c.type), loop: !!act?.loop };
    };
  }

  _actionPose(ent, key, lt, ctx, params, duration) {
    const act = ent.lib[key];
    if (!act) return toPose(null, ent.rig.jointNames);
    // idle / walk / run take the actor's walking style (a04) unless the clip sets its own
    const style = act.params && "style" in act.params ? ent.spec.gait : null;
    return toPose(act.pose(lt, { ...act.params, ...style, ...params }, { ...ctx, duration }), ent.rig.jointNames);
  }

  // idle, or (auto gait) idle / walk / run mixed by the actual speed along the path.
  // gs (humans, a12): shared step clock, so walk and run stay in step, strides follow the speed,
  // turning on the spot shuffles the feet and the head leads the turn
  _basePose(ent, t, ctx, gs = null) {
    const a = ent.spec;
    const idle = this._actionPose(ent, "idle", t, ctx, null, 2);
    if (!a.autoGait) return idle;
    if (ent.lib.fly?.types.includes(a.preset) && ctx.altitude > BIRD_FLY_HEIGHT) return this._actionPose(ent, "fly", t, ctx, null, 2);
    const g = ent.gait;
    const wWalk = smoothstep(g.walk[0], g.walk[1], ctx.speed), wRun = smoothstep(g.run[0], g.run[1], ctx.speed);
    const wStep = gs ? (1 - wWalk) * smoothstep(20, 60, Math.abs(gs.turn)) : 0;
    let pose = idle;
    if (wWalk > 0 || wStep > 0) {
      const f = gs && strideFactors(ctx.speed, ctx.height);
      const c = gs ? { ...ctx, gait: { cycle: gs.cycle, walk: STEP_IN_PLACE + (f.walk - STEP_IN_PLACE) * wWalk, run: f.run } } : ctx;
      pose = blendPose(idle, this._actionPose(ent, "walk", t, c, null, 2), Math.max(wWalk, wStep));
      if (wRun > 0 && ent.lib.run) pose = blendPose(pose, this._actionPose(ent, "run", t, c, null, 2), wRun);
    }
    const look = gs ? turnBody(ctx.speed, gs.turn).look : 0;
    if (look) for (const [j, k] of [["neck", 0.4], ["head", 0.6]]) pose.rot[j]?.premultiply(_q.setFromAxisAngle(UP, look * k * D2R));
    return pose;
  }

  // Step clock for auto gait (a12), rebuilt when the path, timeline length or walking style changes
  _gaitTrack(ent) {
    const a = ent.spec, end = Math.max(this.project.settings.duration, ent.path.keys.at(-1)?.t ?? 0) + 0.5;
    const key = json([ent.pathKey, end, a.gait, a.yaw, a.facing]);
    if (ent.trackKey !== key) {
      const st = gaitStyle(a.gait || {}).stride;
      ent.track = buildGaitTrack(ent.path, {
        end, height: ent.height, band: ent.gait, yaw: a.yaw, facing: a.facing,
        walkLen: ent.lib.walk.params.stride * st * ent.height, runLen: ent.lib.run.params.stride * st * ent.height,
      });
      ent.trackKey = key;
    }
    return ent.track;
  }

  _clipPose(ent, clip, lt, ctx, base) {
    if (clip.type === "pose") return toPose(clip.pose, ent.rig.jointNames);
    // two-person actions see where the partner (params.with) stands
    const c = clip.params?.with ? { ...ctx, partner: this._partner(ent, clip.params.with, ctx.time) } : ctx;
    const pose = this._actionPose(ent, clip.type, lt, c, clip.params, clip.dur);
    // upper-body action on the full-body track: the legs keep doing what the base does
    return ent.lib[clip.type]?.mask === "upper" ? blendPose(base, pose, 1, ent.rig.upperBody) : pose;
  }

  // The partner of a two-person action in this actor's root frame (meters), from placements at time t
  _partner(ent, id, t) {
    const other = this.entities.get(id);
    if (!other || other === ent || other.spec.kind !== "human") return null;
    const me = this.placement(ent, t), them = this.placement(other, t);
    const d = them.pos.sub(me.pos).applyAxisAngle(UP, -me.yaw * D2R);
    return { pos: [d.x, d.y, d.z], yaw: them.yaw - me.yaw, height: other.height, type: other.spec.preset, body: other.spec.body };
  }

  _aimPoint(ent) {
    const j = ent.rig.joints, v = new THREE.Vector3(), w = new THREE.Vector3();
    if (ent.spec.kind === "human") return j.chest.getWorldPosition(v).add(j.head.getWorldPosition(w)).multiplyScalar(0.5);
    const head = j.head || j[ent.rig.jointNames[0]];
    return j[ent.rig.jointNames[0]].getWorldPosition(v).add(head.getWorldPosition(w)).multiplyScalar(0.5);
  }

  _evalProp(ent, t) {
    const { pos, quat } = propPose(this, ent, t);
    ent.object.position.copy(pos);
    ent.object.quaternion.copy(quat);
    animateProp(ent.mesh, ent.spec, t, () => this._rideDist(ent, t));
  }

  // meters a wheeled prop has travelled by t: along the rider's path while an actor rides it (attach joint "root")
  _rideDist(ent, t) {
    const s = attachList(ent.spec).find((x) => x.joint === "root" && t >= (x.from ?? -Infinity) && t < (x.to ?? Infinity));
    const host = s && this.entities.get(s.actor);
    if (host?.kind === "actor") return { dist: samplePath(host.path, t).dist, ridden: true };
    return { dist: samplePath(ent.path, t).dist, ridden: false };
  }

  _evalLight(ent, t) {
    const l = ent.spec, L = ent.light;
    L.position.fromArray(samplePath(ent.path, t).pos);
    if (!L.isSpotLight) return;
    const st = l.aim?.actor && this.actorState.get(l.aim.actor);
    if (st) L.target.position.copy(st.aimPoint);
    else L.target.position.fromArray(Array.isArray(l.aim) ? l.aim : [0, 0, 0]);
  }

  // ---------- cameras ----------

  _getActor(t) {
    return (id) => {
      const ent = this.entities.get(id);
      if (!ent) return null;
      if (Math.abs(t - this.time) < 1e-6) return this.actorState.get(id) || null;
      if (ent.kind !== "actor") return null;
      const p = this.placement(ent, t);
      return { ...p, aimPoint: p.pos.clone().add(new THREE.Vector3(0, ent.height * (ent.spec.kind === "human" ? 0.68 : 0.6), 0)) };
    };
  }

  cameraState(camId, t, aspect) {
    const cam = this.project?.cameras.find((c) => c.id === camId);
    if (!cam) return null;
    if (!this.camCache.has(camId)) this.camCache.set(camId, {});
    return evalCamera(cam, t, aspect, this._getActor(t), this.camCache.get(camId));
  }

  /** Point a THREE.PerspectiveCamera through camera camId at time t. Returns the camera state, or null if the camera does not exist. */
  applyCamera(threeCam, camId, t, aspect = threeCam.aspect) {
    const st = this.cameraState(camId, t, aspect);
    if (!st) return null;
    threeCam.aspect = aspect;
    applyCameraState(threeCam, st, t);
    return st;
  }

  liveCamera(t) {
    return this.project ? liveCameraId(this.project, t) : null;
  }
}

/**
 * Evaluate a clip track at time t, considering clips[0..n].
 * The last clip that has started wins; it fades in from whatever the track did before it.
 * After it ends it either holds (loops keep playing, one-shots freeze on their end pose) or fades back to base.
 */
function evalTrack(clips, n, t, base, poseOf, mask, modeOf) {
  let i = n;
  while (i >= 0 && clips[i].start > t) i--;
  if (i < 0) return base;
  const c = clips[i], lt = t - c.start, blend = c.blend ?? 0.3;
  if (lt < c.dur) {
    const cur = poseOf(c, lt);
    if (lt >= blend || blend <= 0) return mask ? blendPose(base, cur, 1, mask) : cur;
    const prev = evalTrack(clips, i - 1, t, base, poseOf, mask, modeOf);
    return blendPose(prev, cur, smoothstep(0, blend, lt), mask);
  }
  const m = modeOf(c), tt = m.loop ? lt : c.dur;
  if (m.hold) return blendPose(base, poseOf(c, tt), 1, mask);
  const w = 1 - smoothstep(c.dur, c.dur + Math.max(blend, 1e-3), lt);
  if (w <= 0) return base;
  return blendPose(base, poseOf(c, tt), w, mask);
}

export { evalTrack, GAIT, HOLD_BY_DEFAULT };
