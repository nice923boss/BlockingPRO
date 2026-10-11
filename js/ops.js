// Editing operations shared by the viewport, timeline, inspector, library and shortcuts.
// Each one is a single store.edit (one undo step) unless a coalesce id joins it to a drag gesture.
import { uid, actionsFor, attachList, packAttach } from "../runtime/schema.js";
import { buildPath, samplePath, sampleKeys, setSegmentSpeed } from "../runtime/keys.js";
import { CAMERA_MOVES } from "../runtime/camera.js";
import { HUMAN_BODIES } from "../runtime/rig-human.js";
import { ANIMAL_TYPES } from "../runtime/rig-animal.js";
import { propDef } from "../runtime/assets.js";
import { planCrowd } from "../runtime/crowd.js";
import { blockedAt } from "../runtime/collide.js";
import { findEntity, trackKeys, selKeys, selClips, selIds } from "./state.js";
import { deleteMulti } from "./ops-time.js";
import { deleteEntities, duplicateEntities, selectIds } from "./ops-entity.js";
import { round, toast } from "./ui.js";

let S, RT;
export function initOps(store, rt) { S = store; RT = rt; }

const r3 = (v) => v.map((x) => round(x, 3));
const keyEps = (p) => 0.5 / p.settings.fps;

export function uniqueName(p, base) {
  const names = new Set([...p.actors, ...p.props, ...p.lights, ...p.cameras].map((e) => e.name));
  if (!names.has(base)) return base;
  for (let i = 2; ; i++) if (!names.has(`${base} ${i}`)) return `${base} ${i}`;
}
// spread new things so they do not land on top of each other
function spawnPos(p) {
  const n = p.actors.length + p.props.length;
  return [round(((n * 1.3) % 6) - 3, 2), 0, round(-Math.floor(n / 5) * 1.5, 2)];
}

/** Insert or update the key at time t; returns its index in the sorted keys */
export function putKey(keys, t, v, eps) {
  const i = keys.findIndex((k) => Math.abs(k.t - t) < eps);
  if (i >= 0) { keys[i] = { ...keys[i], v }; return i; }
  const tt = round(t, 3);
  const prev = keys.filter((k) => k.t < tt).pop();
  keys.push({ t: tt, v, e: prev?.e || "linear" });
  keys.sort((a, b) => a.t - b.t);
  return keys.findIndex((k) => k.t === tt);
}

/** Current value of a track at the playhead (path position, aim point, lens, roll) */
export function trackValueAt(spec, track, t) {
  if (track === "path") return samplePath(buildPath(spec.path.keys, spec.path.curve), t).pos;
  if (track === "aim") return samplePath(buildPath(spec.aim.keys, spec.aim.curve), t).pos;
  return sampleKeys(spec[track], t, track === "lens" ? 35 : 0);
}

// ---------- entities ----------

export function addActor(kind, preset) {
  const id = uid("a");
  const label = (kind === "animal" ? ANIMAL_TYPES[preset] : HUMAN_BODIES[preset])?.label || "角色";
  S.edit(`新增${label}`, (p) => {
    p.actors.push({ id, kind, preset, name: uniqueName(p, label), path: { keys: [{ t: 0, v: spawnPos(p) }] } });
  });
  S.select({ id });
}

/**
 * a10: count passers-by wandering inside area { x, z, w, d } for the whole scene, as one group in one undo step.
 * They keep 0.6 m from each other and from the actors already there, and walk round the props standing at 0 s.
 */
export function addCrowd({ count, area, speed }) {
  const P = S.project;
  const paths = P.actors.map((a) => buildPath(a.path.keys, a.path.curve));
  const { walkers, skipped } = planCrowd({
    count, area, speed, duration: P.settings.duration, seed: Math.floor(Math.random() * 2 ** 31),
    blocked: blockedAt(RT, P, 0, 0.35),
    others: (t) => paths.map((path) => { const v = samplePath(path, t).pos; return [v[0], v[2]]; }),
  });
  if (!walkers.length) { toast("這個區域放不下路人：區域太小、家具太多或已經太擠", "warn", 5000); return; }
  const ids = walkers.map(() => uid("a"));
  S.edit(`加入 ${walkers.length} 個路人`, (p) => {
    const names = new Set([...p.actors, ...p.props, ...p.lights, ...p.cameras].map((e) => e.name));
    let k = 1;
    walkers.forEach((w, i) => {
      while (names.has(`路人 ${k}`)) k++;
      names.add(`路人 ${k}`);
      p.actors.push({
        id: ids[i], kind: "human", preset: w.preset, name: `路人 ${k}`, color: w.color,
        body: { height: round(HUMAN_BODIES[w.preset].height * w.size, 2) }, path: { curve: "linear", keys: w.keys },
      });
    });
    if (ids.length < 2) return;
    const groups = new Set(p.groups.map((g) => g.name));
    let n = 1;
    while (groups.has(`路人群 ${n}`)) n++;
    p.groups.push({ id: uid("g"), name: `路人群 ${n}`, members: ids });
  });
  selectIds(ids, ids[0]);
  toast(skipped ? `加入 ${walkers.length} 個路人；區域太擠，另外 ${skipped} 個找不到不碰撞的路線` : `加入 ${walkers.length} 個路人，點任一個會選取整群`, skipped ? "warn" : "info", 5000);
}

/** Add a prop at the spawn point; a custom asset from the library is copied into project.assets in the same undo step. */
export function addProp(type, asset = null) {
  const id = uid("o");
  const def = propDef(type, asset ? [asset] : S.project.assets);
  const host = findEntity(S.project, S.sel.id);
  const holder = def?.hold && host?.list === "actors" && host.spec.kind === "human" ? host.spec : null;
  S.edit(`新增${def?.label || "物品"}`, (p) => {
    if (asset) p.assets = [...p.assets.filter((a) => a.id !== asset.id), asset];
    const o = { id, type, name: uniqueName(p, def?.label || "物品"), path: { keys: [{ t: 0, v: spawnPos(p) }] } };
    if (holder) o.attach = { actor: holder.id, joint: "rHand" };
    p.props.push(o);
  });
  if (holder) toast(`已放到「${holder.name}」的右手，可在右側改成左手或指定時間`);
  S.select({ id });
}

export function addLight(type) {
  const id = uid("l");
  const host = findEntity(S.project, S.sel.id);
  S.edit(type === "point" ? "新增點光源" : "新增聚光燈", (p) => {
    p.lights.push({
      id, type, name: uniqueName(p, type === "point" ? "點光源" : "聚光燈"), intensity: type === "point" ? 25 : 60,
      path: { keys: [{ t: 0, v: [2.5, 3.5, 2.5] }] },
      aim: host?.list === "actors" ? { actor: host.spec.id } : [0, 1, 0],
    });
  });
  S.select({ id });
}

export function addCamera(moveKey = null) {
  const id = uid("cam");
  const p0 = S.project;
  const host = findEntity(p0, S.sel.id);
  const target = host?.list === "actors" ? host.spec : p0.actors[0];
  const n = p0.cameras.length;
  const ang = (n * 50 + 30) * (Math.PI / 180);
  S.edit("新增攝影機", (p) => {
    p.cameras.push({
      id, name: uniqueName(p, `${String.fromCharCode(65 + (n % 26))} 機`),
      path: { keys: [{ t: 0, v: r3([Math.sin(ang) * 6, 1.6, Math.cos(ang) * 6]) }] },
      aim: target ? { mode: "actor", actor: target.id, offset: null } : { mode: "point", keys: [{ t: 0, v: [0, 1, 0] }] },
      lens: 35,
    });
    if (!p.cuts.length) p.cuts.push({ t: 0, camera: id });
  });
  S.select({ id });
  if (moveKey) applyMove(id, moveKey, { start: 0, dur: S.project.settings.duration });
}

/** Apply a camera move preset to camera camId over [start, start + dur] */
export function applyMove(camId, moveKey, { start, dur }) {
  const move = CAMERA_MOVES[moveKey];
  const cam = S.project.cameras.find((c) => c.id === camId);
  if (!move || !cam) return;
  const selActor = findEntity(S.project, S.sel.id)?.list === "actors" ? S.sel.id : null;
  const actor = cam.aim.mode === "actor" ? cam.aim.actor : selActor || S.project.actors[0]?.id || null;
  if (move.needsActor && !actor) { toast("這個運鏡需要場景裡有角色可以跟拍", "warn"); return; }
  const t = S.time, aspect = S.project.settings.width / S.project.settings.height;
  // an edit or undo in the same tick is not in the runtime yet (the render loop syncs once per frame)
  if (RT.project !== S.project) RT.sync(S.project);
  const st = RT.cameraState(camId, start, aspect) || RT.cameraState(camId, t, aspect);
  const subject = actor && RT.actorState.get(actor) ? RT.actorState.get(actor).aimPoint.toArray() : st.target.toArray();
  const props = S.project.props.filter((o) => !o.hidden).map((o) => trackValueAt(o, "path", start));
  const out = move.build({ subject: r3(subject), actor, start: round(start, 3), dur: Math.max(0.2, round(dur, 3)), from: r3(st.position.toArray()), lens: st.lens, props });
  if (out.warn) toast(out.warn, "warn");
  S.edit(`運鏡：${move.label}`, (p) => {
    const c = p.cameras.find((x) => x.id === camId);
    if (out.path) c.path = out.path;
    if (out.aim) c.aim = out.aim;
    c.mount = out.mount ?? null;
    if (out.lens) c.lens = out.lens; else if (Array.isArray(c.lens)) c.lens = round(sampleKeys(c.lens, start, 35), 1);
    if (out.shake != null) c.shake = out.shake;
    if (out.roll != null) c.roll = out.roll;
  });
}

export function duplicateSelected() {
  if (selIds(S.sel).length > 1) return duplicateEntities(selIds(S.sel));
  const ent = findEntity(S.project, S.sel.id);
  if (!ent) return;
  const id = uid(ent.list[0]);
  S.edit("複製", (p) => {
    const copy = JSON.parse(JSON.stringify(ent.spec));
    copy.id = id;
    copy.name = uniqueName(p, ent.spec.name + " 複製");
    if (copy.path) copy.path.keys = copy.path.keys.map((k) => ({ ...k, v: [round(k.v[0] + 1, 3), k.v[1], k.v[2]] }));
    for (const tr of ["actions", "upper"]) if (copy[tr]) copy[tr] = copy[tr].map((c) => ({ ...c, id: uid("c") }));
    p[ent.list].push(copy);
  });
  S.select({ id });
}

/** Remove entity id from draft p together with the references to it */
export function dropEntity(p, id) {
  const ent = findEntity(p, id);
  if (!ent) return;
  p[ent.list] = p[ent.list].filter((e) => e.id !== id);
  for (const o of p.props) if (o.attach) o.attach = packAttach(attachList(o).filter((s) => s.actor !== id));
  for (const l of p.lights) if (l.aim?.actor === id) l.aim = [0, 1, 0];
  for (const a of p.actors) if (a.gaze?.some((g) => g.actor === id)) a.gaze = a.gaze.filter((g) => g.actor !== id);
  for (const c of p.cameras) {
    if (c.aim.mode === "actor" && c.aim.actor === id) c.aim = { mode: "point", keys: [{ t: 0, v: [0, 1, 0] }] };
    if (c.mount?.actor === id) c.mount = null;
  }
  p.cuts = p.cuts.filter((c) => c.camera !== id);
}

/** Delete whatever is selected: a key, a clip, a cut, or the entities (and the references to them) */
export function deleteSelection() {
  const sel = S.sel, ent = findEntity(S.project, sel.id);
  if (selKeys(sel).length + selClips(sel).length > 1) return deleteMulti();
  if (sel.cut != null) {
    S.edit("刪除剪接點", (p) => { p.cuts.splice(sel.cut, 1); });
    S.select({});
    return;
  }
  if (!sel.key && !sel.clip && selIds(sel).length > 1) return deleteEntities(selIds(sel));
  if (!ent) return;
  if (sel.key) {
    const keys = trackKeys(ent.spec, sel.key.track);
    if (sel.key.track !== "lens" && sel.key.track !== "roll" && keys.length <= 1) { toast("至少要保留一個關鍵影格", "warn"); return; }
    S.edit("刪除關鍵影格", (p) => {
      const spec = findEntity(p, sel.id).spec, tr = sel.key.track;
      const ks = trackKeys(spec, tr);
      ks.splice(sel.key.i, 1);
      if ((tr === "lens" || tr === "roll") && ks.length <= 1) spec[tr] = ks.length ? ks[0].v : tr === "lens" ? 35 : 0;
    });
    S.select({ id: sel.id });
    return;
  }
  if (sel.clip) {
    S.edit("刪除動作片段", (p) => {
      const spec = findEntity(p, sel.id).spec;
      spec[sel.clip.track] = spec[sel.clip.track].filter((c) => c.id !== sel.clip.id);
    });
    S.select({ id: sel.id });
    return;
  }
  const id = ent.spec.id;
  S.edit(`刪除「${ent.spec.name}」`, (p) => dropEntity(p, id));
  S.select({});
}

// ---------- keys ----------

/** Drag an entity to pos at the playhead: auto key (insert / update a key) or move the whole path */
export function moveEntityTo(id, pos, opts = {}) { moveEntities([[id, pos]], opts); }

/** moveEntityTo for several entities in one step: targets [[id, pos], ...] */
export function moveEntities(targets, { autoKey = true, coalesce = null } = {}) {
  S.edit(autoKey ? "移動（加路徑點）" : "平移整條路徑", (p) => {
    for (const [id, pos] of targets) {
      const spec = findEntity(p, id)?.spec;
      if (!spec) continue;
      const keys = spec.path.keys;
      if (autoKey) { putKey(keys, S.time, r3(pos), keyEps(p)); continue; }
      const cur = trackValueAt(spec, "path", S.time);
      const d = pos.map((x, i) => x - cur[i]);
      spec.path.keys = keys.map((k) => ({ ...k, v: r3(k.v.map((x, i) => x + d[i])) }));
    }
  }, { coalesce });
}

/** Add a key on track at the playhead with the current value (or v) and select it */
export function addKeyAtPlayhead(id, track = "path", v = null) {
  const ent = findEntity(S.project, id);
  if (!ent) return;
  let index = 0;
  S.edit("加關鍵影格", (p) => {
    const spec = findEntity(p, id).spec;
    if ((track === "lens" || track === "roll") && !Array.isArray(spec[track])) spec[track] = [{ t: 0, v: spec[track], e: "linear" }];
    const val = v ?? trackValueAt(spec, track, S.time);
    index = putKey(trackKeys(spec, track), S.time, Array.isArray(val) ? r3(val) : round(val, 2), keyEps(p));
  });
  S.select({ id, key: { track, i: index } });
}

export function setKeyValue(id, track, i, v, coalesce = null) {
  S.edit("修改關鍵影格", (p) => {
    const ks = trackKeys(findEntity(p, id).spec, track);
    ks[i] = { ...ks[i], v: Array.isArray(v) ? r3(v) : v };
  }, { coalesce });
}

export function patchKey(id, track, i, patch) {
  S.edit("修改關鍵影格", (p) => {
    const ks = trackKeys(findEntity(p, id).spec, track);
    ks[i] = { ...ks[i], ...patch };
    for (const k in ks[i]) if (ks[i][k] === undefined) delete ks[i][k];
  });
}

/** Move key i in time, kept between its neighbours so the order (and the selection) stays */
export function setKeyTime(id, track, i, t, coalesce = null) {
  S.edit("移動關鍵影格", (p) => {
    const ks = trackKeys(findEntity(p, id).spec, track);
    const lo = i > 0 ? ks[i - 1].t + 0.01 : 0, hi = i < ks.length - 1 ? ks[i + 1].t - 0.01 : Infinity;
    ks[i] = { ...ks[i], t: round(Math.max(lo, Math.min(hi, t)), 3) };
  }, { coalesce });
}

export function setSegSpeed(id, track, i, speed) {
  S.edit("修改段落速度", (p) => {
    const spec = findEntity(p, id).spec;
    const holder = track === "aim" ? spec.aim : spec.path;
    holder.keys = setSegmentSpeed(holder.keys, i, speed, holder.curve);
  });
}

// ---------- clips and cuts ----------

export function addClip(id, track, type, t, extra = {}) {
  const ent = findEntity(S.project, id);
  if (!ent) return;
  const act = actionsFor(ent.spec)[type];
  const cid = uid("c");
  S.edit(`加入動作：${act?.label || type}`, (p) => {
    findEntity(p, id).spec[track].push({ id: cid, type, start: round(Math.max(0, t), 2), dur: act?.dur || 2, ...extra });
  });
  S.select({ id, clip: { track, id: cid } });
}

export function patchClip(id, track, clipId, patch, coalesce = null) {
  S.edit("修改動作片段", (p) => {
    const spec = findEntity(p, id).spec;
    spec[track] = spec[track].map((c) => {
      if (c.id !== clipId) return c;
      const out = { ...c, ...patch };
      for (const k in out) if (out[k] === undefined) delete out[k];
      return out;
    });
  }, { coalesce });
}

/** Cut to camera camId at time t (replaces a cut at the same frame; merges repeats of the same camera) */
export function cutTo(camId, t) {
  S.edit("剪接", (p) => {
    const eps = keyEps(p), tt = round(Math.max(0, t), 3);
    const i = p.cuts.findIndex((c) => Math.abs(c.t - tt) < eps);
    if (i >= 0) p.cuts[i] = { ...p.cuts[i], camera: camId };
    else p.cuts.push({ t: p.cuts.length ? tt : 0, camera: camId });
    p.cuts.sort((a, b) => a.t - b.t);
    p.cuts = p.cuts.filter((c, k) => k === 0 || p.cuts[k - 1].camera !== c.camera);
  });
}

export function setCutTime(i, t, coalesce = null) {
  S.edit("移動剪接點", (p) => {
    const cs = p.cuts;
    const lo = i > 0 ? cs[i - 1].t + 0.05 : 0, hi = i < cs.length - 1 ? cs[i + 1].t - 0.05 : p.settings.duration;
    cs[i] = { ...cs[i], t: round(Math.max(lo, Math.min(hi, t)), 3) };
  }, { coalesce });
}

export function patchEntity(id, patch, label = "修改屬性") {
  S.edit(label, (p) => {
    const ent = findEntity(p, id);
    const list = p[ent.list];
    const i = list.indexOf(ent.spec);
    const out = { ...ent.spec, ...patch };
    for (const k in out) if (out[k] === undefined) delete out[k];
    list[i] = out;
  });
}

export function patchSettings(patch, label = "修改場景設定") {
  S.edit(label, (p) => { p.settings = { ...p.settings, ...patch }; });
}
