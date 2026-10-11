// Edits made from the 3D view: facing from the rotate ring, cameras and camera keys from the editor view.
import { uid } from "../runtime/schema.js";
import { findEntity } from "./state.js";
import { putKey, trackValueAt, uniqueName } from "./ops.js";
import { round } from "./ui.js";

let S;
export function initViewOps(store) { S = store; }

const r3 = (v) => v.map((x) => round(x, 3));
const keyEps = (p) => 0.5 / p.settings.fps;

/**
 * Face an actor or prop toward yaw (degrees) at the playhead.
 * One key: the base yaw. Several keys: a key at the playhead keeps the position and carries the yaw.
 */
export function setYaw(id, yaw, coalesce = null) {
  const y = round((((yaw + 180) % 360) + 360) % 360 - 180, 1);
  S.edit("旋轉方向", (p) => {
    const spec = findEntity(p, id)?.spec;
    if (!spec) return;
    const keys = spec.path.keys;
    if (keys.length <= 1) {
      spec.yaw = y;
      if (keys[0]) delete keys[0].yaw;
      return;
    }
    const i = putKey(keys, S.time, r3(trackValueAt(spec, "path", S.time)), keyEps(p));
    keys[i] = { ...keys[i], yaw: y };
  }, { coalesce });
}

/**
 * Store a camera position (and aim point, when the camera aims at a point) from the editor view.
 * autoKey: key at the playhead; otherwise the whole path (and aim path) shifts.
 */
export function saveCameraView(camId, pos, target, { autoKey = true, coalesce = null } = {}) {
  S.edit(autoKey ? "存成攝影機關鍵影格" : "移動攝影機", (p) => {
    const cam = findEntity(p, camId)?.spec;
    if (!cam || cam.mount) return;
    const tracks = [["path", pos], ...(cam.aim.mode === "point" ? [["aim", target]] : [])];
    for (const [track, v] of tracks) {
      const holder = track === "path" ? cam.path : cam.aim;
      if (autoKey) { putKey(holder.keys, S.time, r3(v), keyEps(p)); continue; }
      const cur = trackValueAt(cam, track, S.time), d = v.map((x, i) => x - cur[i]);
      holder.keys = holder.keys.map((k) => ({ ...k, v: r3(k.v.map((x, i) => x + d[i])) }));
    }
  }, { coalesce });
}

/** New fixed camera looking from pos at target with the given lens; the first camera also gets the first cut */
export function cameraFromView(pos, target, lens) {
  const id = uid("cam"), n = S.project.cameras.length;
  S.edit("從視角建立攝影機", (p) => {
    p.cameras.push({
      id, name: uniqueName(p, `${String.fromCharCode(65 + (n % 26))} 機`),
      path: { keys: [{ t: 0, v: r3(pos) }] },
      aim: { mode: "point", keys: [{ t: 0, v: r3(target) }] },
      lens: round(lens, 1),
    });
    if (!p.cuts.length) p.cuts.push({ t: 0, camera: id });
  });
  S.select({ id });
  return id;
}
