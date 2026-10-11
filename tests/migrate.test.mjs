// node --test tests/*.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { VERSION, MIGRATIONS, migrate } from "../runtime/migrate.js";

test("every version below the current one has an upgrade step", () => {
  for (let v = 1; v < VERSION; v++) assert.equal(typeof MIGRATIONS[v]?.up, "function", `缺少 v${v} 的升級步驟`);
});

test("a file without a version is read as v1 and upgraded to the current version", () => {
  const { project, notes, newer } = migrate({ format: "blockingpro", name: "舊", actors: [] });
  assert.equal(project.version, VERSION);
  assert.equal(project.name, "舊");
  assert.deepEqual(notes, []); // v1 → v2 only adds optional fields
  assert.equal(newer, false);
});

test("a current file is left as it is", () => {
  const src = { format: "blockingpro", version: VERSION, name: "新" };
  const { project, notes, newer } = migrate(src);
  assert.deepEqual(project, src);
  assert.deepEqual(notes, []);
  assert.equal(newer, false);
});

test("a file from a later version is flagged and keeps its fields", () => {
  const { project, newer } = migrate({ version: VERSION + 3, extra: 1 });
  assert.equal(newer, true);
  assert.equal(project.version, VERSION);
  assert.equal(project.extra, 1);
});

test("input that is not an object becomes an empty v-current project", () => {
  for (const bad of [null, undefined, 3, "x"]) assert.deepEqual(migrate(bad).project, { version: VERSION });
});

test("steps run in order and only the non-quiet ones leave a note", () => {
  const steps = {
    1: { note: "a", quiet: true, up: (p) => ({ ...p, a: true }) },
    2: { note: "v2 → v3：cam 改名 cameras", up: ({ cam, ...p }) => ({ ...p, cameras: cam }) },
  };
  const src = { version: 1, cam: [1] };
  const { project, notes } = migrate(src, steps, 3);
  assert.deepEqual(project, { version: 3, a: true, cameras: [1] });
  assert.deepEqual(notes, ["v2 → v3：cam 改名 cameras"]);
  assert.deepEqual(src, { version: 1, cam: [1] }); // the input object is not changed
});
