// Right panel: properties of whatever is selected (scene, actor, prop, light, camera, key, clip, cut) or the posing tools.
import { h, fmt, round, num, select, checkbox, row, vec3Row, nextFrame } from "./ui.js";
import * as ops from "./ops.js";
import { findEntity, trackKeys, selIds } from "./state.js";
import { deleteEntities, duplicateEntities, groupEntities, toggleFlag, groupOf } from "./ops-entity.js";
import { DISPLAY_MODES, LOOKS, TARGETS, targetOf, actionsFor } from "../runtime/schema.js";
import { HUMAN_BODIES, BODY_LIMITS, resolveBody } from "../runtime/rig-human.js";
import { ANIMAL_TYPES } from "../runtime/rig-animal.js";
import { propDef } from "../runtime/assets.js";
import { LIGHTING } from "../runtime/lights.js";
import { EASINGS, CURVE_OF, isCurve, easeLabel, buildPath, segmentSpeeds } from "../runtime/keys.js";
import { curveEditor } from "./curve-editor.js";
import { posePanel } from "./pose-panel.js";
import { envImageRows } from "./inspector-env.js";
import { cameraPanel } from "./inspector-camera.js";
import { attachPanel } from "./inspector-attach.js";
import { gazeRows } from "./inspector-gaze.js";
import { sitPairRows, sitRows } from "./inspector-sit.js";
import { stateRows } from "./inspector-state.js";
import { HAND_SHAPES } from "../runtime/hands.js";
import { GAIT_STYLES, AMP_RANGE } from "../runtime/gait-style.js";

const RES = [["1280x720", "1280 x 720（橫式 720p）"], ["720x1280", "720 x 1280（直式 720p）"], ["960x960", "960 x 960（方形）"], ["854x480", "854 x 480（480p）"], ["1920x1080", "1920 x 1080（1080p）"]];
const TRACK = { path: "路徑", aim: "對準點", lens: "焦距", roll: "滾轉" };
// size and frame rate every target model accepts: 720p in the project's orientation, 24 fps (o12)
const SPEC = (S) => (S.height > S.width ? { width: 720, height: 1280, fps: 24 } : { width: 1280, height: 720, fps: 24 });
const fitsSpec = (S) => { const t = SPEC(S); return S.width === t.width && S.height === t.height && S.fps === t.fps; };
const note = (t, cls = "note") => h("div", { class: cls }, t);
const btns = (...b) => h("div", { class: "btns" }, b);
const text = (value, onCommit) => h("input", { type: "text", value, onchange: (e) => onCommit(e.target.value.trim()) });
const color = (value, onCommit) => h("input", { type: "color", value, onchange: (e) => onCommit(e.target.value) });
// left and right hand shape (a08); the blank choice leaves that hand to the actions and held props.
// On the actor the blank already means relaxed, so that entry is left out there.
const handsRow = (value, blank, onCommit) => row("手勢（左手／右手）", h("div", { class: "inline" }, ...["l", "r"].map((side) =>
  select([["", blank], ...Object.entries(HAND_SHAPES).filter(([, label]) => label !== blank)], value?.[side] || "", (v) => {
    const out = { ...(value || {}), [side]: v };
    if (!v) delete out[side];
    onCommit(Object.keys(out).length ? out : undefined);
  }))));
// height, build and head ratio on top of the preset (a05); unset fields follow the preset
const BODY_FIELDS = [["height", "身高（公尺）", 0.01], ["build", "胖瘦", 0.05], ["head", "頭身比例", 0.05]];
const bodyRows = (a) => {
  const B = resolveBody(a.preset, a.body), cur = { ...a.body }; // latest values: no re-render while a field has focus
  const shown = { height: B.height, build: a.body?.build ?? 1, head: a.body?.head ?? 1 };
  return [
    ...BODY_FIELDS.map(([k, label, step]) => row(label, num(shown[k], (v) => { cur[k] = v; ops.patchEntity(a.id, { body: { ...cur } }, "改身形"); },
      { step, min: BODY_LIMITS[k][0], max: BODY_LIMITS[k][1], digits: 2 }))),
    btns(h("button", { disabled: !a.body, onclick: () => ops.patchEntity(a.id, { body: undefined }, "重設身形") }, "身形回到類型預設")),
  ];
};
// walking style and motion size for idle / walk / run (a04); the defaults (normal, 1) are left out of the file
const gaitRows = (a) => {
  const cur = { ...a.gait }; // latest values: no re-render while a field has focus
  const set = (k, v, dflt) => {
    if (v === dflt) delete cur[k]; else cur[k] = v;
    ops.patchEntity(a.id, { gait: Object.keys(cur).length ? { ...cur } : undefined }, "改步態");
  };
  return [
    row("步態風格", select(Object.entries(GAIT_STYLES), a.gait?.style || "normal", (v) => set("style", v, "normal"))),
    row("動作幅度", num(a.gait?.amp ?? 1, (v) => set("amp", v, 1), { step: 0.05, min: AMP_RANGE[0], max: AMP_RANGE[1], digits: 2 })),
    note("待機、走路、跑步都套用；個別片段可另外指定。建議速度：疲累 0.7 到 1、悠閒 0.8 到 1.1、急促 1.6 到 2 公尺/秒"),
  ];
};

export class Inspector {
  constructor(el, store, rt, { posing, viewport }) {
    Object.assign(this, { el, store, rt, posing, viewport });
    this.pending = false;
    store.subscribe((what) => {
      if (what === "time" && store.playing) return;
      if (what === "play" && store.playing) return;
      this.schedule();
    });
    // a re-render would steal the caret: wait until the field loses focus
    el.addEventListener("focusout", () => setTimeout(() => this.schedule(), 0));
    this.render();
  }

  schedule() {
    if (this.pending) return;
    this.pending = true;
    nextFrame(() => {
      this.pending = false;
      const a = document.activeElement;
      if (a && this.el.contains(a) && a.matches("input[type=number], input[type=text], textarea")) return;
      this.render();
    });
  }

  render() {
    const s = this.store, sel = s.sel, ent = findEntity(s.project, sel.id);
    const parts = [];
    if (s.posing) parts.push(...posePanel(s, this.rt, this.posing));
    else {
      if (sel.cut != null) parts.push(...this.cutPanel(sel.cut));
      if (ent && !sel.key && !sel.clip && selIds(sel).length > 1) parts.push(...this.multiPanel(selIds(sel)));
      if (ent && sel.key) parts.push(...this.keyPanel(ent.spec, sel.key));
      if (ent && sel.clip) parts.push(...this.clipPanel(ent.spec, sel.clip));
      if (ent) parts.push(...this[ent.list](ent.spec));
      if (!ent && sel.cut == null) parts.push(...this.scene());
    }
    const top = this.el.scrollTop;
    this.el.replaceChildren(h("div", { class: "insp" }, parts));
    this.el.scrollTop = top;
  }

  // ---------- scene ----------

  scene() {
    const s = this.store, P = s.project, S = P.settings, iss = s.issues;
    const res = `${S.width}x${S.height}`;
    return [
      h("h4", {}, "場景設定"),
      row("場景名稱", text(P.name, (v) => s.edit("改場景名稱", (d) => { d.name = v || d.name; }))),
      row("解析度", select(RES.some(([k]) => k === res) ? RES : [[res, `${S.width} x ${S.height}（自訂）`], ...RES], res, (v) => {
        const [w, hh] = v.split("x").map(Number);
        ops.patchSettings({ width: w, height: hh }, "改解析度");
      })),
      row("總長（秒）", num(S.duration, (v) => ops.patchSettings({ duration: v }, "改總長"), { step: 0.5, min: 0.5, max: 600, digits: 2 })),
      row("影格率", select([["24", "24 fps"], ["25", "25 fps"], ["30", "30 fps"]], String(S.fps), (v) => ops.patchSettings({ fps: Number(v) }, "改影格率"))),
      row("給哪個模型", select(Object.entries(TARGETS).map(([k, v]) => [k, v.label]), S.target, (v) => ops.patchSettings({ target: v }, "改輸出目標模型"))),
      note(targetOf(S).note),
      fitsSpec(S) ? "" : btns(h("button", { onclick: () => ops.patchSettings(SPEC(S), "套用建議規格") }, `套用建議規格（${SPEC(S).width}x${SPEC(S).height}、24 fps）`)),
      h("h4", {}, "環境"),
      row("燈光預設", select(Object.entries(LIGHTING).map(([k, v]) => [k, v.label]), S.lighting, (v) => ops.patchSettings({ lighting: v }, "改燈光預設"))),
      row("背景色", h("div", { class: "inline" },
        color(S.background || LIGHTING[S.lighting]?.bg || "#000000", (v) => ops.patchSettings({ background: v }, "改背景色")),
        h("button", { disabled: !S.background, onclick: () => ops.patchSettings({ background: null }, "背景色跟燈光預設") }, "跟燈光"))),
      row("地面", h("div", { class: "inline" },
        h("label", {}, checkbox(S.ground.show, (v) => ops.patchSettings({ ground: { ...S.ground, show: v } }, "地面")), " 顯示"),
        h("label", {}, checkbox(S.ground.grid, (v) => ops.patchSettings({ ground: { ...S.ground, grid: v } }, "格線")), " 格線"),
        color(S.ground.color, (v) => ops.patchSettings({ ground: { ...S.ground, color: v } }, "地面顏色")))),
      ...envImageRows(S),
      row("統一呈現", select([["", "各角色自己設定"], ...Object.entries(DISPLAY_MODES)], S.display || "", (v) => ops.patchSettings({ display: v || null }, "統一呈現方式"))),
      row("白模外觀", select([["", "白模（預設）"], ...Object.entries(LOOKS)], S.look || "", (v) => ops.patchSettings({ look: v || null }, "改白模外觀"))),
      row("遮幅", select([["", "不加"], ["2.39", "2.39：1 寬銀幕"], ["1.85", "1.85：1"]], S.letterbox || "", (v) => ops.patchSettings({ letterbox: v || null }, "改遮幅"))),
      note("白模外觀套用到 3D 視窗、導演台與輸出；遮幅在導演台畫黑邊，輸出時可選擇保留"),
      h("h4", {}, "檢查"),
      ...(iss.errors.length || iss.warnings.length ? [...iss.errors.map((e) => note(e, "err")), ...iss.warnings.map((w) => note(w, "warn"))] : [note("沒有發現問題")]),
    ];
  }

  /** Several entities selected: actions on all of them; the panels below show the primary one */
  multiPanel(ids) {
    const P = this.store.project, specs = ids.map((id) => findEntity(P, id)?.spec).filter(Boolean);
    const allHidden = specs.every((e) => e.hidden), allLocked = specs.every((e) => e.locked);
    const g = groupOf(P, ids[0]), sameGroup = g && ids.length === g.members.length && ids.every((id) => g.members.includes(id));
    return [
      h("h4", {}, `已選取 ${specs.length} 個物件`),
      btns(
        h("button", { onclick: () => duplicateEntities(ids) }, "複製"),
        h("button", { disabled: sameGroup, onclick: () => groupEntities(ids) }, "建立群組"),
        h("button", { onclick: () => toggleFlag(ids, "hidden") }, allHidden ? "顯示" : "隱藏"),
        h("button", { onclick: () => toggleFlag(ids, "locked") }, allLocked ? "解鎖" : "鎖定"),
        h("button", { class: "danger", onclick: () => deleteEntities(ids) }, "刪除")),
      note("拖曳 3D 箭頭會一起移動；Ctrl＋C 複製到剪貼簿，可在其他專案 Ctrl＋V 貼上。下方顯示藍框最亮的那一個（主選取）的屬性。"),
      ...sitPairRows(this.store),
    ];
  }

  // ---------- shared entity parts ----------

  head(spec, title) {
    return [h("h4", {}, title), row("名稱", text(spec.name, (v) => v && ops.patchEntity(spec.id, { name: v }, "改名")))];
  }

  position(spec) {
    const v = ops.trackValueAt(spec, "path", this.store.time);
    const auto = this.viewport.autoKey;
    return [
      vec3Row("位置（目前）", v.map((x) => round(x, 3)), (nv) => ops.moveEntityTo(spec.id, nv, { autoKey: auto })),
      note(auto ? "修改位置會在目前時間加路徑點（自動關鍵影格開啟）" : "修改位置會平移整條路徑（自動關鍵影格關閉）"),
    ];
  }

  keyList(spec, track) {
    const s = this.store, holder = track === "aim" ? spec.aim : spec.path, keys = holder.keys;
    const speeds = segmentSpeeds(buildPath(keys, holder.curve));
    return h("div", { class: "list" }, keys.map((k, i) => h("div", {
      class: `li${s.sel.key?.track === track && s.sel.key.i === i ? " sel" : ""}`,
      onclick: () => { s.select({ id: spec.id, key: { track, i } }); s.setTime(k.t); },
    }, h("span", {}, `${i + 1}`), h("span", { class: "grow" }, `${fmt(k.t)} 秒`),
      i < keys.length - 1 ? h("span", { class: "chip" }, `${easeLabel(k.e)}｜${speeds[i] > 0.005 ? fmt(speeds[i]) + " m/s" : "停留"}`) : null)));
  }

  path(spec, track = "path") {
    const holder = track === "aim" ? spec.aim : spec.path;
    return [
      row("曲線", select([["smooth", "平滑曲線"], ["linear", "直線轉折"]], holder.curve, (v) => ops.patchEntity(spec.id, track === "aim" ? { aim: { ...spec.aim, curve: v } } : { path: { ...spec.path, curve: v } }, "改曲線"))),
      this.keyList(spec, track),
      btns(h("button", { onclick: () => ops.addKeyAtPlayhead(spec.id, track) }, `在目前時間加${TRACK[track]}點`)),
      note("Shift + 點地面也可以加路徑點；點選路徑點後可調速度與加減速"),
    ];
  }

  tail(spec) {
    const s = this.store;
    return [
      h("h4", {}, "操作"),
      btns(
        h("button", { onclick: () => ops.duplicateSelected() }, "複製"),
        h("button", { class: "danger", onclick: () => { s.select({ id: spec.id }); ops.deleteSelection(); } }, "刪除"),
      ),
    ];
  }

  actorOptions(blank = null) {
    return [...(blank ? [["", blank]] : []), ...this.store.project.actors.map((a) => [a.id, a.name])];
  }

  // ---------- entities ----------

  actors(a) {
    const s = this.store, P = s.project, presets = a.kind === "animal" ? ANIMAL_TYPES : HUMAN_BODIES, lib = actionsFor(a);
    const clips = [...a.actions.map((c) => ["actions", c]), ...a.upper.map((c) => ["upper", c])].sort((x, y) => x[1].start - y[1].start);
    return [
      ...this.head(a, a.kind === "animal" ? "動物" : "角色"),
      row("類型", select(Object.entries(presets).map(([k, v]) => [k, v.label]), a.preset, (v) => ops.patchEntity(a.id, { preset: v }, "改類型"))),
      row("顏色", h("div", { class: "inline" }, color(a.color || "#d9dde4", (v) => ops.patchEntity(a.id, { color: v }, "改顏色")),
        h("button", { disabled: !a.color, onclick: () => ops.patchEntity(a.id, { color: null }, "預設顏色") }, "預設"))),
      row("呈現", select(Object.entries(DISPLAY_MODES), a.display, (v) => ops.patchEntity(a.id, { display: v }, "改呈現方式"))),
      P.settings.display ? note("場景設定已統一呈現方式，這裡的設定暫時不作用", "warn") : null,
      row("大小倍率", num(a.scale, (v) => ops.patchEntity(a.id, { scale: v }, "改大小"), { step: 0.05, min: 0.2, max: 5, digits: 2 })),
      ...(a.kind === "human" ? bodyRows(a) : []),
      row("面向", select([["path", "跟著移動方向"], ["fixed", "固定方向"]], a.facing, (v) => ops.patchEntity(a.id, { facing: v }, "改面向"))),
      row(a.facing === "fixed" ? "方向（度）" : "起始方向（度）", num(a.yaw, (v) => ops.patchEntity(a.id, { yaw: v }, "改方向"), { step: 15, digits: 1 })),
      row("自動步態", checkbox(a.autoGait, (v) => ops.patchEntity(a.id, { autoGait: v }, "自動步態"), "依移動速度自動切換待機、走路、跑步；人類的步幅隨速度變化，轉彎時傾身、原地轉身會踏步")),
      note("自動步態：沒有動作片段的時段，依移動速度自動待機、走路或跑步"),
      ...(a.kind === "human" ? gaitRows(a) : []),
      a.kind === "human" ? handsRow(a.hands, "自然", (v) => ops.patchEntity(a.id, { hands: v }, "改手勢")) : null,
      a.kind === "human" ? note("指向、揮手、拍手等動作和手上拿東西時會自動換手勢；個別動作片段也能另外指定") : null,
      h("h4", {}, "位置與路徑"),
      ...this.position(a),
      ...this.path(a),
      h("h4", {}, "動作"),
      clips.length ? h("div", { class: "list" }, clips.map(([track, c]) => h("div", {
        class: `li${s.sel.clip?.id === c.id ? " sel" : ""}`,
        onclick: () => { s.select({ id: a.id, clip: { track, id: c.id } }); s.setTime(c.start); },
      }, h("span", { class: "grow" }, c.type === "pose" ? "姿勢" : lib[c.type]?.label || c.type),
        track === "upper" ? h("span", { class: "chip" }, "上半身") : null, h("span", { class: "chip" }, `${fmt(c.start)} 秒起 ${fmt(c.dur)} 秒`)))) : note("還沒有動作片段"),
      btns(h("button", { onclick: () => this.posing.start(a.id) }, "在目前時間擺姿勢")),
      note("在時間軸的動作列雙擊可加入動作，或從左側「動作」分頁點選（加在播放頭位置）"),
      ...gazeRows(this, a),
      ...this.tail(a),
    ];
  }

  props(o) {
    const s = this.store, def = propDef(o.type, s.project.assets);
    return [
      ...this.head(o, `物品：${def?.label || o.type}`),
      row("顏色", h("div", { class: "inline" }, color(o.color || def?.color || "#999999", (v) => ops.patchEntity(o.id, { color: v }, "改顏色")),
        h("button", { disabled: !o.color, onclick: () => ops.patchEntity(o.id, { color: null }, "預設顏色") }, "預設"))),
      Array.isArray(o.scale)
        ? vec3Row("大小 X / Y / Z", o.scale, (v) => ops.patchEntity(o.id, { scale: v }, "改大小"), 0.1)
        : row("大小倍率", h("div", { class: "inline" }, num(o.scale, (v) => ops.patchEntity(o.id, { scale: v }, "改大小"), { step: 0.1, min: 0.05, max: 50, digits: 2 }),
          h("button", { title: "分開設定長寬高", onclick: () => ops.patchEntity(o.id, { scale: [o.scale, o.scale, o.scale] }, "分軸縮放") }, "分軸"))),
      ...attachPanel(this, o, def),
      ...sitRows(s, o),
      ...stateRows(this, o),
      h("h4", {}, "位置與路徑"),
      row("面向", select([["fixed", "固定方向"], ["path", "跟著移動方向"]], o.facing, (v) => ops.patchEntity(o.id, { facing: v }, "改面向"))),
      row("方向（度）", num(o.yaw, (v) => ops.patchEntity(o.id, { yaw: v }, "改方向"), { step: 15, digits: 1 })),
      ...this.position(o),
      ...this.path(o),
      ...this.tail(o),
    ];
  }

  lights(l) {
    const aimActor = !!l.aim?.actor;
    return [
      ...this.head(l, l.type === "point" ? "點光源" : "聚光燈"),
      row("種類", select([["spot", "聚光燈"], ["point", "點光源"]], l.type, (v) => ops.patchEntity(l.id, { type: v }, "改燈光種類"))),
      row("顏色", color(l.color, (v) => ops.patchEntity(l.id, { color: v }, "改燈光顏色"))),
      row("強度", num(l.intensity, (v) => ops.patchEntity(l.id, { intensity: v }, "改強度"), { step: 5, min: 0, max: 2000, digits: 1 })),
      l.type === "spot" ? row("光束角（度）", num(l.angle, (v) => ops.patchEntity(l.id, { angle: v }, "改光束角"), { step: 5, min: 2, max: 89, digits: 1 })) : null,
      row("照射距離", num(l.distance, (v) => ops.patchEntity(l.id, { distance: v }, "改照射距離"), { step: 1, min: 0, max: 200, digits: 1 })),
      note("照射距離 0 代表不限"),
      row("投射陰影", checkbox(l.shadow, (v) => ops.patchEntity(l.id, { shadow: v }, "陰影"))),
      l.type === "spot" ? row("對準", select(this.actorOptions("固定點"), aimActor ? l.aim.actor : "", (v) => ops.patchEntity(l.id, { aim: v ? { actor: v } : [0, 1, 0] }, "改對準"))) : null,
      l.type === "spot" && !aimActor ? vec3Row("對準點", l.aim, (v) => ops.patchEntity(l.id, { aim: v }, "改對準點")) : null,
      h("h4", {}, "位置與路徑"),
      ...this.position(l),
      ...this.path(l),
      ...this.tail(l),
    ];
  }

  cameras(c) {
    return cameraPanel(this, c);
  }

  // ---------- key / clip / cut ----------

  keyPanel(spec, key) {
    const keys = trackKeys(spec, key.track), k = keys?.[key.i];
    if (!k) return [];
    const isVec = Array.isArray(k.v), last = key.i === keys.length - 1;
    const out = [
      h("h4", {}, `${TRACK[key.track]}點 ${key.i + 1}／${keys.length}`),
      row("時間（秒）", num(k.t, (v) => ops.setKeyTime(spec.id, key.track, key.i, v), { step: 0.1, min: 0, digits: 3 })),
      isVec ? vec3Row("位置", k.v, (v) => ops.setKeyValue(spec.id, key.track, key.i, v))
        : row(TRACK[key.track], num(k.v, (v) => ops.setKeyValue(spec.id, key.track, key.i, v), { step: 1, digits: 1 })),
    ];
    if (!last) {
      const setE = (e) => ops.patchKey(spec.id, key.track, key.i, { e });
      const opts = [...Object.entries(EASINGS).map(([e, x]) => [e, x.label]), ["custom", "自訂曲線"]];
      out.push(row("到下一點", select(opts, isCurve(k.e) ? "custom" : k.e, (v) => setE(v === "custom" ? [...(CURVE_OF[k.e] || CURVE_OF.inOut)] : v))));
      if (k.e !== "hold") out.push(curveEditor(k.e, setE));
      if (isVec) {
        const holder = key.track === "aim" ? spec.aim : spec.path;
        const sp = segmentSpeeds(buildPath(holder.keys, holder.curve))[key.i] || 0;
        out.push(
          row("平均速度 m/s", num(sp, (v) => v > 0 && ops.setSegSpeed(spec.id, key.track, key.i, v), { step: 0.1, min: 0.05, max: 100, digits: 2 })),
          note("改速度會移動下一個點的時間，後面的點跟著平移。參考：走路 1.4、快走 2、跑步 3.5 到 5 m/s"),
        );
      }
    }
    if (key.track === "path" && findEntity(this.store.project, spec.id)?.list === "actors") {
      out.push(row("停留時面向", h("div", { class: "inline" },
        num(k.yaw, (v) => ops.patchKey(spec.id, "path", key.i, { yaw: v }), { step: 15, digits: 1 }),
        h("button", { disabled: k.yaw == null, onclick: () => ops.patchKey(spec.id, "path", key.i, { yaw: undefined }) }, "清除"))),
        note("角色停在這個點時要面向的角度（度），留空就沿用移動方向"));
    }
    out.push(btns(h("button", { class: "danger", onclick: () => ops.deleteSelection() }, "刪除這個點")));
    return out;
  }

  clipPanel(spec, ref) {
    const c = spec[ref.track]?.find((x) => x.id === ref.id);
    if (!c) return [];
    const act = c.type === "pose" ? null : actionsFor(spec)[c.type];
    const patch = (p) => ops.patchClip(spec.id, ref.track, c.id, p);
    const hold = c.hold ?? (c.type === "pose" ? false : act?.hold ?? false);
    const out = [
      h("h4", {}, `動作片段：${c.type === "pose" ? "姿勢" : act?.label || c.type}`),
      row("開始（秒）", num(c.start, (v) => patch({ start: v }), { step: 0.1, min: 0, digits: 2 })),
      row("長度（秒）", num(c.dur, (v) => patch({ dur: v }), { step: 0.1, min: 0.05, digits: 2 })),
      row("淡入（秒）", num(c.blend ?? 0.3, (v) => patch({ blend: v }), { step: 0.05, min: 0, digits: 2 })),
      row("結束後保持", checkbox(hold, (v) => patch({ hold: v }), "勾選：片段結束後停在最後的姿勢；不勾：淡回走路或待機")),
      spec.kind === "human" ? handsRow(c.hands, "依動作", (v) => patch({ hands: v })) : null,
    ];
    const params = { ...(c.params || {}) }; // latest values: no re-render while a number field has focus
    // what the clip plays when a param is unset: idle / walk / run fall back to the actor's walking style
    const dflt = { ...act?.params, ...(act?.params && "style" in act.params ? spec.gait : null) };
    for (const [k, [label, min, max, step]] of Object.entries(act?.ui || {})) {
      const set = (v) => { params[k] = v; patch({ params: { ...params } }); };
      if (min === "actor") {
        const others = this.store.project.actors.filter((x) => x.kind === "human" && x.id !== spec.id).map((x) => [x.id, x.name]);
        out.push(row(label, select([["", "（未指定：對著假想的人）"], ...others], c.params?.[k] || "", set)));
        continue;
      }
      if (min === "choice") {
        out.push(row(label, select([["", `（預設：${max[dflt[k]] || dflt[k]}）`], ...Object.entries(max)], c.params?.[k] || "", (v) => {
          if (v) params[k] = v; else delete params[k];
          patch({ params: Object.keys(params).length ? { ...params } : undefined });
        })));
        continue;
      }
      out.push(row(label, num(c.params?.[k] ?? dflt[k], set, { step, min, max, digits: 3 })));
    }
    if (act?.pair) out.push(note("雙人動作：對象也要放同一時間、同長度的片段（握手對握手、擁抱對擁抱、遞出對接過）。在動作庫選兩人再按動作，會自動擺好。"));
    if (c.type === "pose") out.push(btns(h("button", { class: "primary", onclick: () => this.posing.start(spec.id, c.id) }, "編輯這個姿勢")));
    if (act?.loop) out.push(note("循環動作：長度內會重複播放"));
    out.push(btns(h("button", { class: "danger", onclick: () => ops.deleteSelection() }, "刪除片段")));
    return out;
  }

  cutPanel(i) {
    const s = this.store, P = s.project, cut = P.cuts[i];
    if (!cut) return [];
    const next = P.cuts[i + 1]?.t ?? P.settings.duration;
    return [
      h("h4", {}, `剪接點 ${i + 1}／${P.cuts.length}`),
      row("時間（秒）", i === 0 ? h("span", {}, "0（開場）") : num(cut.t, (v) => ops.setCutTime(i, v), { step: 0.1, min: 0, digits: 3 })),
      row("攝影機", select(P.cameras.map((c) => [c.id, c.name]), cut.camera, (v) => s.edit("改剪接攝影機", (d) => { d.cuts[i].camera = v; }))),
      note(`這個鏡頭長 ${fmt(next - cut.t)} 秒`),
      row("鏡頭說明", h("textarea", { rows: 3, maxlength: 300, placeholder: "這個鏡頭拍什麼，例如：中景，小芸把寶特瓶丟進回收桶", value: cut.note || "",
        onchange: (e) => s.edit("修改鏡頭說明", (d) => { const v = e.target.value.trim(); if (v) d.cuts[i].note = v; else delete d.cuts[i].note; }) })),
      i > 0 ? btns(h("button", { class: "danger", onclick: () => ops.deleteSelection() }, "刪除剪接點")) : note("第一個剪接點固定在 0 秒，只能換攝影機"),
    ];
  }
}
