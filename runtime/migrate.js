// Project format version and upgrades from older versions. No imports, so Node tests can load it.
export const FORMAT = "blockingpro";
export const VERSION = 2;
// Upgrades from older format versions. Each step takes a plain object of version n and returns version n + 1.
// The note is shown to the user when a file is upgraded on open; quiet steps only add optional fields, so there is nothing to tell.
// To change the format: bump VERSION, add MIGRATIONS[old] that rewrites the old fields, and a case in tests/migrate.test.mjs.
export const MIGRATIONS = {
  1: { note: "v1 → v2：新增時間標記、群組、字幕軌欄位（舊內容不變）", quiet: true, up: (p) => p },
};

/** Upgrade a raw project object to `target`. Returns { project, notes, newer } (newer: written by a later version). */
export function migrate(input, steps = MIGRATIONS, target = VERSION) {
  let p = input && typeof input === "object" ? input : {};
  const notes = [];
  let v = Number.isInteger(p.version) ? p.version : 1;
  const newer = v > target;
  while (v < target && steps[v]) { const m = steps[v]; p = m.up(p); if (!m.quiet) notes.push(m.note); v++; }
  return { project: { ...p, version: Math.min(v, target) }, notes, newer };
}
