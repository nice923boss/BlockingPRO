// Editor state: the project (replaced, never mutated), selection, playhead, undo / redo, the local draft and saved versions.
import { normalize, validate, emptyProject, migrate } from "../runtime/schema.js";

const AUTOSAVE_KEY = "blockingpro.autosave.v1";
const VERSIONS_KEY = "blockingpro.versions.v1";
const MAX_UNDO = 200;
const MAX_VERSIONS = 10;
const VERSION_EVERY_MS = 3 * 60 * 1000;
export const SPEEDS = [0.25, 0.5, 1, 1.5, 2];
export const STORAGE_QUOTA = 5 * 1024 * 1024; // Chrome gives each origin about 5 MB of localStorage

// ids / keys / clips hold the whole multi-selection; id / key / clip stay the primary item the panels show
export const emptySel = () => ({ id: null, ids: [], key: null, keys: [], clip: null, clips: [], cut: null });
/** All selected entity ids (primary included) */
export const selIds = (sel) => (sel.ids?.length ? sel.ids : sel.id ? [sel.id] : []);
/** All selected keys as [{ id, track, i }] (primary included) */
export const selKeys = (sel) => (sel.keys?.length ? sel.keys : sel.key && sel.id ? [{ id: sel.id, ...sel.key }] : []);
/** All selected clips as [{ id, track, clipId }] (primary included) */
export const selClips = (sel) => (sel.clips?.length ? sel.clips : sel.clip && sel.id ? [{ id: sel.id, track: sel.clip.track, clipId: sel.clip.id }] : []);

const clone = (o) => JSON.parse(JSON.stringify(o));

/** Find an entity by id: { spec, list } where list is "actors" | "props" | "lights" | "cameras" */
export function findEntity(project, id) {
  if (!id) return null;
  for (const list of ["actors", "props", "lights", "cameras"]) {
    const spec = project[list].find((e) => e.id === id);
    if (spec) return { spec, list };
  }
  return null;
}

/** Key array of a track on a (draft) entity: "path" | "aim" | "lens" | "roll" */
export function trackKeys(spec, track) {
  if (track === "path") return spec.path.keys;
  if (track === "aim") return spec.aim?.keys || null;
  if (track === "lens" || track === "roll") return Array.isArray(spec[track]) ? spec[track] : null;
  return null;
}

/** Bytes this origin uses in localStorage (two bytes per character), or null when storage is off */
export function storageUsage() {
  try {
    let n = 0;
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); n += (k.length + (localStorage.getItem(k) || "").length) * 2; }
    return n;
  } catch { return null; }
}

/** Saved versions, newest first: [{ at, name, project }] */
export function listVersions() {
  try { const v = JSON.parse(localStorage.getItem(VERSIONS_KEY) || "[]"); return Array.isArray(v) ? v : []; } catch { return []; }
}

const isQuota = (err) => err?.name === "QuotaExceededError" || err?.code === 22;

export function createStore() {
  const listeners = new Set();
  let saveTimer = 0, saveFailed = false, lastVersionAt = 0, lastVersionJson = "";
  const s = {
    project: emptyProject(),
    sel: emptySel(),
    time: 0,
    playing: false,
    loop: true,
    speed: 1,
    range: null, // { a, b }: in / out points; playback loops inside them
    posing: null,
    preview: null, // camera id shown on the program monitor instead of the cut list
    undoStack: [],
    redoStack: [],
    lastAction: "",
    _co: null,
    gesture: null,
    issues: { errors: [], warnings: [] },
  };

  const emit = (what) => { for (const fn of listeners) fn(what); };

  // Write the draft; when storage is full, drop the oldest saved versions until it fits.
  function writeDraft(text) {
    for (;;) {
      try { localStorage.setItem(AUTOSAVE_KEY, text); return; } catch (err) {
        const vers = listVersions();
        if (!isQuota(err) || !vers.length) throw err;
        vers.pop();
        try { localStorage.setItem(VERSIONS_KEY, JSON.stringify(vers)); } catch { localStorage.removeItem(VERSIONS_KEY); }
      }
    }
  }

  // Versions are a convenience: when they do not fit, keep fewer instead of blocking the draft.
  function pushVersion(project, force = false) {
    if (!project.actors.length && !project.props.length && !project.cameras.length) return;
    const text = JSON.stringify(project);
    if (text === lastVersionJson || (!force && Date.now() - lastVersionAt < VERSION_EVERY_MS)) return;
    let vers = [{ at: Date.now(), name: project.name, project }, ...listVersions().filter((v) => JSON.stringify(v.project) !== text)].slice(0, MAX_VERSIONS);
    while (vers.length) {
      try { localStorage.setItem(VERSIONS_KEY, JSON.stringify(vers)); break; } catch (err) {
        if (!isQuota(err)) { console.warn("BlockingPRO: 無法寫入版本紀錄", err); return; }
        vers = vers.slice(0, -1);
      }
    }
    lastVersionAt = Date.now();
    lastVersionJson = text;
  }

  function autosave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        writeDraft(JSON.stringify(s.project));
        if (saveFailed) { saveFailed = false; emit("storage"); }
      } catch (err) {
        if (!saveFailed) { console.warn("BlockingPRO: 無法寫入自動暫存", err); saveFailed = true; emit("storage"); }
        return;
      }
      pushVersion(s.project);
    }, 500);
  }

  function fixSelection() {
    const p = s.project;
    let sel = s.sel;
    if (sel.ids.length) sel = { ...sel, ids: sel.ids.filter((id) => findEntity(p, id)) };
    if (sel.keys.length) sel = { ...sel, keys: sel.keys.filter((k) => { const e = findEntity(p, k.id); const ks = e && trackKeys(e.spec, k.track); return !!ks && k.i < ks.length; }) };
    if (sel.clips.length) sel = { ...sel, clips: sel.clips.filter((c) => (findEntity(p, c.id)?.spec[c.track] || []).some((x) => x.id === c.clipId)) };
    const ent = findEntity(p, sel.id);
    if (sel.id && !ent) sel = { ...emptySel(), ids: sel.ids, id: sel.ids[0] || null };
    else if (ent) {
      if (sel.key) {
        const keys = trackKeys(ent.spec, sel.key.track);
        if (!keys || sel.key.i >= keys.length) sel = { ...sel, key: null };
      }
      if (sel.clip && !(ent.spec[sel.clip.track] || []).some((c) => c.id === sel.clip.id)) sel = { ...sel, clip: null };
    }
    if (sel.cut != null && sel.cut >= p.cuts.length) sel = { ...sel, cut: null };
    s.sel = sel;
    if (s.preview && !p.cameras.some((c) => c.id === s.preview)) s.preview = null;
    if (s.range && s.range.b > p.settings.duration) s.range = s.range.a < p.settings.duration - 0.05 ? { a: s.range.a, b: p.settings.duration } : null;
  }

  function setProject(next, label) {
    s.project = next;
    s.issues = validate(next);
    s.lastAction = label || "";
    fixSelection();
    autosave();
    emit("project");
  }

  const store = {
    get project() { return s.project; },
    get sel() { return s.sel; },
    get time() { return s.time; },
    get playing() { return s.playing; },
    get loop() { return s.loop; },
    get speed() { return s.speed; },
    get range() { return s.range; },
    get posing() { return s.posing; },
    get preview() { return s.preview; },
    get issues() { return s.issues; },
    get lastAction() { return s.lastAction; },
    get canUndo() { return s.undoStack.length > 0; },
    get canRedo() { return s.redoStack.length > 0; },
    get saveFailed() { return saveFailed; },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },

    /**
     * Change the project. fn gets a deep copy to modify (or returns a replacement).
     * Edits with the same coalesce id (one drag gesture) share a single undo step.
     */
    edit(label, fn, { coalesce = s.gesture } = {}) {
      const draft = clone(s.project);
      const out = fn(draft);
      const next = normalize(out || draft);
      if (!(coalesce && s._co === coalesce)) {
        s.undoStack.push({ project: s.project, label });
        if (s.undoStack.length > MAX_UNDO) s.undoStack.shift();
        s.redoStack = [];
      }
      s._co = coalesce;
      setProject(next, label);
    },

    /**
     * Replace the whole project (open file, new, example, restore a version).
     * Older file versions are upgraded first. Returns the validation result plus
     * notes (upgrade steps applied) and newer (file made by a newer BlockingPRO).
     */
    load(json, label = "載入專案") {
      const { project, notes, newer } = migrate(json);
      const next = normalize(project);
      pushVersion(s.project, true);
      s.undoStack.push({ project: s.project, label });
      s.redoStack = [];
      s._co = null;
      s.sel = emptySel();
      s.posing = null;
      s.preview = null;
      s.range = null;
      s.time = 0;
      setProject(next, label);
      emit("sel");
      emit("time");
      return { ...s.issues, notes, newer };
    },

    undo() {
      const prev = s.undoStack.pop();
      if (!prev) return;
      s.redoStack.push({ project: s.project, label: prev.label });
      s._co = null;
      setProject(prev.project, `復原：${prev.label}`);
      emit("sel");
    },
    redo() {
      const next = s.redoStack.pop();
      if (!next) return;
      s.undoStack.push({ project: s.project, label: next.label });
      s._co = null;
      setProject(next.project, `重做：${next.label}`);
      emit("sel");
    },

    select(sel) {
      s.sel = { ...emptySel(), ...sel };
      s._co = null;
      fixSelection();
      emit("sel");
    },

    setTime(t) {
      const d = s.project.settings.duration;
      s.time = Math.max(0, Math.min(d, t));
      emit("time");
    },
    setPlaying(on) {
      if (on && s.posing) return;
      if (on) {
        const r = s.range;
        if (r && (s.time < r.a || s.time >= r.b - 1e-6)) s.time = r.a;
        else if (!r && s.time >= s.project.settings.duration - 1e-6) s.time = 0;
      }
      s.playing = on;
      emit("play");
    },
    setLoop(on) { s.loop = on; emit("play"); },
    setSpeed(x) { s.speed = SPEEDS.includes(x) ? x : 1; emit("play"); },
    /** In / out points; null or a span under 0.05 s clears them */
    setRange(r) {
      const d = s.project.settings.duration;
      const a = r ? Math.max(0, Math.min(r.a, r.b)) : 0, b = r ? Math.min(d, Math.max(r.a, r.b)) : 0;
      s.range = r && b - a >= 0.05 ? { a, b } : null;
      emit("play");
    },
    setPosing(p) { s.posing = p; if (p) s.playing = false; emit("posing"); },
    setPreview(id) { s.preview = id || null; emit("preview"); },

    /** Edits between begin and end (one drag on a number field) share one undo step */
    beginGesture() { s.gesture = `g${Date.now()}${Math.random()}`; },
    endGesture() { s.gesture = null; },

    /** Save the current project as a version now (before restoring an older one) */
    snapshot() { pushVersion(s.project, true); },

    /** Restore the local draft if there is one */
    restoreDraft() {
      try {
        const txt = localStorage.getItem(AUTOSAVE_KEY);
        if (!txt) return false;
        const next = normalize(migrate(JSON.parse(txt)).project);
        s.project = next;
        s.issues = validate(next);
        s.lastAction = "已還原上次的編輯";
        pushVersion(next, true); // each session start keeps the draft it opened with
        emit("project");
        return true;
      } catch (err) {
        console.warn("BlockingPRO: 自動暫存無法還原", err);
        return false;
      }
    },
  };
  return store;
}
