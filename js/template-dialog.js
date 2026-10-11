// p01 scene templates: place a room or outdoor set in one undo step, next to the current props or in place of them.
import { h, modal, row, num, select, checkbox, round, toast } from "./ui.js";
import { uid } from "../runtime/schema.js";
import { propDef } from "../runtime/assets.js";
import { LIGHTING } from "../runtime/lights.js";
import { TEMPLATES, placeTemplate } from "../runtime/templates.js";
import { dropEntity, uniqueName } from "./ops.js";

export function openTemplate(store, vp, key) {
  const T = TEMPLATES[key], P = store.project;
  const loose = P.props.filter((o) => !o.attach).length; // props on the set, not in someone's hand
  const t = vp?.orbit.target;
  const f = { x: loose ? round(t?.x || 0, 1) : 0, z: loose ? round(t?.z || 0, 1) : 0, mode: "add", light: true };
  const field = (k) => num(f[k], (v) => { f[k] = v; }, { step: 0.5, min: -100, max: 100, digits: 2 });
  modal(`場景模板：${T.label}`, h("div", {},
    h("p", { class: "note" }, `${T.desc}共 ${T.props.length} 件物品。`),
    loose ? row("放法", select({ add: "加到現有場景", replace: `先清除現有的 ${loose} 件物品` }, f.mode, (v) => { f.mode = v; })) : null,
    row("中心 X", field("x")),
    row("中心 Z", field("z")),
    row("燈光", h("label", { class: "note" }, checkbox(f.light, (v) => { f.light = v; }), ` 改成「${LIGHTING[T.lighting].label}」`)),
    h("p", { class: "note" }, "室內場景只有後牆和左右牆，前方（+Z）留給攝影機。清除時保留角色手上的小物、攝影機與燈具。整組是一次操作，Ctrl+Z 可復原。"),
  ), [
    { label: "取消" },
    { label: "放入", primary: true, onClick: (c) => { c(); applyTemplate(store, key, { center: [f.x, f.z], replace: f.mode === "replace", lighting: f.light }); } },
  ]);
}

function applyTemplate(store, key, { center, replace, lighting }) {
  const T = TEMPLATES[key], list = placeTemplate(key, center);
  store.edit(`場景模板：${T.label}`, (p) => {
    if (replace) for (const o of p.props.filter((x) => !x.attach)) dropEntity(p, o.id);
    for (const { v, name, ...o } of list) {
      p.props.push({ ...o, id: uid("o"), name: uniqueName(p, name || propDef(o.type, [])?.label || "物品"), path: { keys: [{ t: 0, v }] } });
    }
    if (lighting) p.settings = { ...p.settings, lighting: T.lighting, background: null };
  });
  store.select({});
  toast(`已放入「${T.label}」${list.length} 件物品`);
}
