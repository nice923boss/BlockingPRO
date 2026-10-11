// Custom prop editor: form + JSON tab on the left, live three.js preview on the right (with a 1.7 m figure for scale
// and an in-hand preview for props with a hold). Saves to the library and refreshes copies already in the project.
// The selected part can be dragged in the preview (move, rotate, scale); the drag is written back when released.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { TransformControls } from "three/addons/controls/TransformControls.js";
import {
  ASSET_SHAPES, HOLD_PRESETS, ID_PATTERN, normalizeAsset, normalizePart, validateAsset, assetWarnings,
  buildAsset, disposeObject, parseAssetText, propDef, uniqueAssetId,
} from "../runtime/assets.js";
import { PROP_CATS, applyHold } from "../runtime/props.js";
import { buildHuman } from "../runtime/rig-human.js";
import { modelSize, modelStats } from "../runtime/models.js";
import { h, num, select, checkbox, row, vec3Row, toast, modal } from "./ui.js";
import { assetLib } from "./asset-library.js";
import { getModel, onModelReady } from "./models.js";
import * as ops from "./ops.js";

const D2R = Math.PI / 180;
const DRAG_MODES = { translate: "移動", rotate: "旋轉", scale: "縮放" };
const clone = (x) => JSON.parse(JSON.stringify(x));
const vecEq = (v, w) => Array.isArray(v) && v.every((x, i) => x === w[i]);

/**
 * Open the editor. asset: the asset to edit (null for a blank one). isNew: true when it is not in the library yet
 * (blank, duplicated or pasted), which keeps the id editable.
 */
export function openAssetEditor(store, asset = null, { isNew = !asset } = {}) {
  let a = normalizeAsset(clone(asset || {
    id: uniqueAssetId("my_prop", new Set(assetLib.assets.map((x) => x.id))), label: "新物品", cat: "small", color: "#b0b0b0",
    parts: [{ shape: "box", size: [0.4, 0.4, 0.4], pos: [0, 0.2, 0], rot: [0, 0, 0], color: null }],
  }));
  let sel = a.parts?.length ? 0 : -1;
  let tab = "form";
  let inHand = false;
  let showMan = true;
  let dragMode = "translate";
  let snap = true;

  const side = h("div", { class: "ae-side" });
  const canvas = h("canvas");
  const msgs = h("div", { class: "ae-msgs" });
  const handBtn = h("button", { onclick: () => { inHand = !inHand; refreshPreview(true); } }, "拿在手上");
  const manBox = checkbox(showMan, (v) => { showMan = v; refreshPreview(true); });
  const modeBtns = Object.entries(DRAG_MODES).map(([k, label]) => h("button", { title: `拖曳預覽上的把手${label}選取的零件`, onclick: () => setDragMode(k) }, label));
  const snapBox = checkbox(snap, (v) => { snap = v; setSnap(); }, "移動每格 1 公分、旋轉每格 15 度");
  const view = h("div", { class: "ae-view" }, canvas,
    h("div", { class: "viewbar" }, h("label", { class: "chip" }, manBox, " 1.7 公尺人形"), handBtn, h("button", { onclick: () => frame() }, "重設視角"),
      ...modeBtns, h("label", { class: "chip" }, snapBox, " 吸附")),
    msgs);

  // ---------- preview ----------
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(2, devicePixelRatio));
  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#0e1014");
  scene.add(new THREE.HemisphereLight("#ffffff", "#40444f", 1.6));
  const sun = new THREE.DirectionalLight("#ffffff", 2.2);
  sun.position.set(3, 6, 4);
  scene.add(sun);
  const grid = new THREE.GridHelper(20, 20, "#556070", "#2c323e");
  const fine = new THREE.GridHelper(2, 20, "#3a4250", "#232833");
  fine.position.y = 0.001;
  scene.add(grid, fine, new THREE.AxesHelper(0.3));
  const cam = new THREE.PerspectiveCamera(40, 1, 0.01, 200);
  const controls = new OrbitControls(cam, canvas);
  const man = buildHuman({ body: "man", color: "#8a93a3" });
  scene.add(man.root);
  const box = new THREE.BoxHelper(undefined, "#ffb84d");
  scene.add(box);
  const tc = new TransformControls(cam, canvas);
  tc.setSize(0.8);
  scene.add(tc.getHelper());
  let dragStart = null;
  tc.addEventListener("dragging-changed", (e) => {
    controls.enabled = !e.value;
    const o = tc.object;
    if (e.value) dragStart = [o.position.clone(), o.quaternion.clone(), o.scale.clone()];
    else if (!(o.position.equals(dragStart[0]) && o.quaternion.equals(dragStart[1]) && o.scale.equals(dragStart[2]))) commitDrag();
  });
  tc.addEventListener("objectChange", () => box.setFromObject(tc.object));
  let model = null;
  let raf = 0;

  function poseArm(on) {
    const j = man.joints;
    j.rUpperArm.rotation.set(on ? 10 * D2R : 0, 0, on ? -8 * D2R : 0);
    j.rForeArm.rotation.set(on ? -80 * D2R : 0, 0, 0);
  }

  function refreshPreview(reframe = false) {
    if (model) { model.parent?.remove(model); disposeObject(model); }
    model = buildAsset(a, null, a.model ? getModel(a.model.file) : null);
    const def = propDef(a.id, [a]);
    const handOk = inHand && def?.hold;
    handBtn.classList.toggle("on", !!handOk);
    handBtn.disabled = !a.hold;
    poseArm(handOk);
    if (handOk) {
      man.root.visible = true;
      man.root.position.set(0, 0, 0);
      applyHold(model, def.hold, "r");
      man.joints.rHand.add(model);
    } else {
      scene.add(model);
      const b = new THREE.Box3().setFromObject(model);
      man.root.visible = showMan;
      man.root.position.set(b.isEmpty() ? -0.8 : b.min.x - 0.45, 0, 0);
    }
    scene.updateMatrixWorld(true); // the hand moved with the arm pose, so the selection box needs fresh matrices
    const part = model.children.find((o) => o.userData.part === sel);
    box.visible = !!part;
    if (part) box.setFromObject(part);
    // the gizmo edits parts in prop coordinates, so it is off while the prop is in the hand
    if (part && !handOk && tab === "form") tc.attach(part); else tc.detach();
    msgs.replaceChildren(...messages());
    if (reframe) frame();
  }

  function frame() {
    scene.updateMatrixWorld(true);
    const b = new THREE.Box3().setFromObject(model);
    if (man.root.visible) b.union(new THREE.Box3().setFromObject(man.root));
    if (b.isEmpty()) b.set(new THREE.Vector3(-0.5, 0, -0.5), new THREE.Vector3(0.5, 1, 0.5));
    const c = b.getCenter(new THREE.Vector3()), r = Math.max(0.15, b.getSize(new THREE.Vector3()).length() / 2);
    const d = r / Math.tan((cam.fov / 2) * D2R) * 1.15;
    controls.target.copy(c);
    cam.position.copy(c).add(new THREE.Vector3(0.55, 0.35, 0.76).normalize().multiplyScalar(d));
    cam.near = d / 100; cam.far = d * 50;
    cam.updateProjectionMatrix();
    controls.update();
  }

  function messages() {
    const errs = validateAsset(a);
    if (errs.length) return [h("div", { class: "err" }, "還不能儲存："), ...errs.map((e) => h("div", { class: "err" }, `・${e}`))];
    const warns = assetWarnings(a);
    const what = a.model ? `模型 ${a.model.file}` : `${a.parts.length} 個零件`;
    return warns.length ? warns.map((w) => h("div", { class: "warn" }, `・${w}`)) : [h("div", { class: "note" }, `格式正確，${what}，可以儲存。`)];
  }

  function loop() {
    raf = requestAnimationFrame(loop);
    const w = canvas.clientWidth, ht = canvas.clientHeight;
    if (w && ht && (canvas.width !== Math.floor(w * renderer.getPixelRatio()) || canvas.height !== Math.floor(ht * renderer.getPixelRatio()))) {
      renderer.setSize(w, ht, false);
      cam.aspect = w / ht;
      cam.updateProjectionMatrix();
    }
    renderer.render(scene, cam);
  }

  function setDragMode(k) {
    dragMode = k;
    tc.setMode(k);
    tc.setSpace(k === "translate" ? "world" : "local");
    modeBtns.forEach((b, i) => b.classList.toggle("on", Object.keys(DRAG_MODES)[i] === k));
  }
  function setSnap() {
    tc.setTranslationSnap(snap ? 0.01 : null);
    tc.setRotationSnap(snap ? 15 * D2R : null);
  }

  /** Write the dragged mesh back to its part; a box keeps scale 1 and takes the scale into its size. */
  function commitDrag() {
    const o = tc.object, p = a.parts[o?.userData.part];
    if (!p) return;
    const r3 = (x) => Math.round(x * 1000) / 1000 || 0;
    const sc = o.scale.toArray().map((x) => Math.max(0.01, Math.abs(x)));
    const { scale: _, ...rest } = p;
    const next = { ...rest, pos: o.position.toArray().map(r3), rot: [o.rotation.x, o.rotation.y, o.rotation.z].map((x) => Math.round(x / D2R * 10) / 10 || 0) };
    if (p.shape === "box") next.size = p.size.map((x, i) => Math.max(0.005, r3(x * sc[i])));
    else if (!sc.every((x) => Math.abs(x - 1) < 1e-3)) next.scale = sc.map(r3);
    a = { ...a, parts: a.parts.map((x, j) => (j === o.userData.part ? next : x)) };
    render();
  }

  // click a part in the preview to select it (not when the press grabbed the gizmo)
  let down = null;
  canvas.addEventListener("pointerdown", (e) => { down = tc.dragging ? null : [e.clientX, e.clientY]; });
  canvas.addEventListener("pointerup", (e) => {
    if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 4) return;
    const r = canvas.getBoundingClientRect();
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), cam);
    const hit = ray.intersectObjects(model.children, false)[0];
    if (hit) { sel = hit.object.userData.part; tab = "form"; render(); }
  });

  // ---------- form ----------
  /** Value edits: update preview and messages only, so the focused input survives. */
  const changed = (structural = false) => { if (structural) render(); else refreshPreview(); };
  const setA = (patch, structural = false) => { a = { ...a, ...patch }; changed(structural); };
  const setPart = (i, patch, structural = false) => { a = { ...a, parts: a.parts.map((p, j) => (j === i ? { ...p, ...patch } : p)) }; changed(structural); };
  const text = (value, onCommit, attrs = {}) => h("input", { type: "text", value: value ?? "", onchange: (e) => onCommit(e.target.value.trim()), ...attrs });

  function basics() {
    return [
      h("h4", {}, "基本資料"),
      row("id", text(a.id, (v) => setA({ id: v }), { disabled: !isNew, title: isNew ? "小寫英文開頭，只用小寫英文、數字、- 和 _" : "已存在素材庫的物品不能改 id（專案用 id 找物品）" })),
      row("名稱", text(a.label, (v) => setA({ label: v }), { maxlength: 30 })),
      row("分類", select(PROP_CATS, a.cat, (v) => setA({ cat: v }))),
      row("主色", h("input", { type: "color", value: a.color, onchange: (e) => setA({ color: e.target.value }) })),
      row("說明", text(a.desc, (v) => { const { desc, ...rest } = a; a = v ? { ...rest, desc: v } : rest; changed(); })),
    ];
  }

  function hold() {
    const on = !!a.hold;
    const out = [h("h4", {}, "手拿"),
      row("可以拿在手上", checkbox(on, (v) => {
        if (v) setA({ hold: { grip: [0, 0.05, 0], rot: [0, 0, 0] } }, true);
        else { const { hold: _, ...rest } = a; a = rest; inHand = false; render(); }
      }))];
    if (!on) return out;
    const preset = Object.entries(HOLD_PRESETS).find(([, p]) => vecEq(a.hold.rot, p.rot))?.[0] || "";
    out.push(
      row("握法", select([["", "自訂"], ...Object.entries(HOLD_PRESETS).map(([k, p]) => [k, p.label])], preset, (k) => { if (k) setA({ hold: { ...a.hold, rot: HOLD_PRESETS[k].rot.slice() } }, true); })),
      vec3Row("握點 grip", a.hold.grip, (v) => setA({ hold: { ...a.hold, grip: v } }), 0.01),
      vec3Row("旋轉 rot", a.hold.rot, (v) => setA({ hold: { ...a.hold, rot: v } }, true), 5),
      h("div", { class: "note" }, "握點是物品上被手握住的那一點（物品座標）。按預覽上方「拿在手上」檢查握的位置和方向。"));
    return out;
  }

  function partsList() {
    const add = (shape) => {
      const top = a.parts.reduce((m, p) => Math.max(m, (p.pos?.[1] || 0)), 0);
      const p = normalizePart({ shape, pos: [0, 0, 0] });
      const half = shape === "box" ? p.size[1] / 2 : shape === "sphere" || shape === "torus" ? p.radius : p.height / 2;
      p.pos = [0, a.parts.length ? Math.round((top + half) * 100) / 100 : half, 0];
      a = { ...a, parts: [...a.parts, p] };
      sel = a.parts.length - 1;
      render();
    };
    return [
      h("h4", {}, `零件（${a.parts.length}）`),
      h("div", { class: "btns" }, Object.entries(ASSET_SHAPES).map(([k, s]) => h("button", { onclick: () => add(k), title: `新增${s.label}` }, `＋${s.label}`))),
      h("div", { class: "list ae-parts" }, a.parts.map((p, i) => h("div", { class: `li${i === sel ? " sel" : ""}`, onclick: () => { sel = i; render(); } },
        h("span", { class: "sw", style: { background: p.color || a.color, width: "10px", height: "10px", borderRadius: "2px", flex: "none" } }),
        h("span", { class: "grow" }, `${i + 1}. ${p.name || ASSET_SHAPES[p.shape]?.label || p.shape}`),
        h("button", { title: "複製這個零件", onclick: (e) => { e.stopPropagation(); a = { ...a, parts: [...a.parts.slice(0, i + 1), clone(p), ...a.parts.slice(i + 1)] }; sel = i + 1; render(); } }, "複製"),
        h("button", { class: "danger", title: "刪除這個零件", onclick: (e) => { e.stopPropagation(); a = { ...a, parts: a.parts.filter((_, j) => j !== i) }; sel = Math.min(sel, a.parts.length - 1); render(); } }, "刪除")))),
    ];
  }

  function partForm() {
    const p = a.parts[sel];
    if (!p) return [h("div", { class: "note" }, "選一個零件來編輯，或在預覽上點零件。")];
    const tip = h("div", { class: "note" }, "可以在預覽上拖曳把手：先按預覽左上角的移動、旋轉或縮放，放開後數值會更新到下面。");
    const set = (patch, structural) => setPart(sel, patch, structural);
    const dim = (k, label, step = 0.01) => row(label, num(p[k], (v) => set({ [k]: v }), { step, min: 0 }));
    const out = [h("h4", {}, `零件 ${sel + 1}`), tip,
      row("名稱", text(p.name, (v) => { const { name, ...rest } = p; a = { ...a, parts: a.parts.map((x, j) => (j === sel ? (v ? { ...rest, name: v } : rest) : x)) }; render(); }, { placeholder: "選填，例如：桶身" })),
      row("形狀", select(Object.entries(ASSET_SHAPES).map(([k, s]) => [k, s.label]), p.shape, (shape) => {
        const keep = { name: p.name, pos: p.pos, rot: p.rot, scale: p.scale, color: p.color, glow: p.glow, opacity: p.opacity };
        a = { ...a, parts: a.parts.map((x, j) => (j === sel ? normalizePart({ shape, ...keep }) : x)) };
        render();
      }))];
    if (p.shape === "box") out.push(vec3Row("尺寸 寬高深", p.size, (v) => set({ size: v }), 0.01));
    else out.push(dim("radius", p.shape === "torus" ? "環半徑" : "半徑"));
    if (p.shape === "cylinder") out.push(row("頂面半徑", num(p.radiusTop ?? p.radius, (v) => set({ radiusTop: v }), { step: 0.01, min: 0 })));
    if ("height" in ASSET_SHAPES[p.shape].dims) out.push(dim("height", p.shape === "capsule" ? "總高" : "高度"));
    if (p.shape === "torus") out.push(dim("tube", "管半徑"), dim("arc", "角度", 15));
    const scale = p.scale || [1, 1, 1];
    out.push(
      vec3Row("位置 pos", p.pos, (v) => set({ pos: v }), 0.01),
      vec3Row("旋轉 rot", p.rot, (v) => set({ rot: v }), 15),
      vec3Row("縮放 scale", scale, (v) => { if (vecEq(v, [1, 1, 1])) { const { scale: _, ...rest } = p; a = { ...a, parts: a.parts.map((x, j) => (j === sel ? rest : x)) }; changed(); } else set({ scale: v }); }, 0.1),
      row("顏色", h("label", { class: "chip" }, checkbox(p.color == null, (v) => set({ color: v ? null : a.color }, true)), " 跟著主色"),
        p.color == null ? h("span") : h("input", { type: "color", value: p.color, onchange: (e) => set({ color: e.target.value }, true) })),
      row("發光", num(p.glow || 0, (v) => { const { glow: _, ...rest } = p; a = { ...a, parts: a.parts.map((x, j) => (j === sel ? (v > 0 ? { ...rest, glow: v } : rest) : x)) }; changed(); }, { step: 0.1, min: 0, max: 2 })),
      row("不透明度", num(p.opacity ?? 1, (v) => { const { opacity: _, ...rest } = p; a = { ...a, parts: a.parts.map((x, j) => (j === sel ? (v < 1 ? { ...rest, opacity: v } : rest) : x)) }; changed(); }, { step: 0.05, min: 0.05, max: 1 })));
    return out;
  }

  // model assets (p06): unit, front direction and look instead of parts; size follows the file when it is loaded
  function modelForm() {
    const m = a.model, raw = getModel(m.file);
    const setModel = (patch) => {
      const next = { ...m, ...patch };
      if (raw) next.size = modelSize(raw, next.unit, next.yaw);
      setA({ model: next }, true);
    };
    const units = [[1, "公尺"], [0.01, "公分"], [0.001, "毫米"], [0.0254, "英吋"]];
    if (!units.some(([u]) => u === m.unit)) units.push([m.unit, `自訂（${m.unit}）`]);
    const st = raw ? modelStats(raw) : null;
    return [h("h4", {}, "模型"),
      row("檔案", h("span", { class: raw ? null : "warn" }, raw ? m.file : `${m.file}（這個瀏覽器沒有這個檔案，先用半透明方塊代替）`)),
      row("單位", select(units.map(([u, l]) => [String(u), l]), String(m.unit), (v) => setModel({ unit: Number(v) }))),
      row("正面轉向", select([0, 90, 180, -90].map((d) => [String(d), `${d} 度`]), String(m.yaw), (v) => setModel({ yaw: Number(v) }))),
      row("外觀", select({ white: "白模（用主色）", original: "原始材質" }, m.look, (v) => setModel({ look: v }))),
      row("尺寸", h("span", {}, Array.isArray(m.size) ? `寬 ${m.size[0]}、高 ${m.size[1]}、深 ${m.size[2]} 公尺` : "未知")),
      st ? h("div", { class: st.tris > 500000 ? "warn" : "note" }, `${st.meshes} 個網格、${Math.round(st.tris / 1000)} 千個三角面${st.tris > 500000 ? "，面數多，場景放好幾個會變慢" : ""}${st.skinned ? "；有骨架，顯示綁定姿勢，動畫不會播放" : ""}`) : null,
      h("div", { class: "note" }, "對照旁邊 1.7 公尺的人形確認單位；正面要朝藍色軸（+Z），不對就換正面轉向。模型檔存在這個瀏覽器，換電腦時把檔案和專案放同一個資料夾開啟。")];
  }

  function jsonTab() {
    const area = h("textarea", { class: "code", rows: 24, spellcheck: "false", value: JSON.stringify(a, null, 1) });
    return [
      h("div", { class: "note" }, "可以直接改 JSON，或貼上 AI 產生的物品，再按「套用 JSON」。"),
      area,
      h("div", { class: "btns" }, h("button", { class: "primary", onclick: () => {
        const r = parseAssetText(area.value);
        if (r.error) return toast(r.error, "err", 5000);
        if (r.assets.length !== 1) return toast(`這裡一次只能套用 1 個物品（貼上的內容有 ${r.assets.length} 個），多個物品請用「匯入」`, "err", 5000);
        const next = normalizeAsset(r.assets[0]);
        if (!isNew && next.id !== a.id) { toast(`已存在素材庫的物品不能改 id，維持「${a.id}」`, "warn"); next.id = a.id; }
        a = next;
        sel = a.parts?.length ? 0 : -1;
        tab = "form";
        render();
        refreshPreview(true);
      } }, "套用 JSON")),
    ];
  }

  function render() {
    const tabs = h("div", { class: "ae-tabs" },
      h("button", { class: tab === "form" ? "on" : null, onclick: () => { tab = "form"; render(); } }, "表單"),
      h("button", { class: tab === "json" ? "on" : null, onclick: () => { tab = "json"; render(); } }, "JSON"));
    const valid = Array.isArray(a.parts);
    const shape = a.model?.file ? modelForm() : [...partsList(), ...partForm()];
    side.replaceChildren(tabs, ...(tab === "json" || !valid ? jsonTab() : [...basics(), ...hold(), ...shape]));
    refreshPreview();
  }

  // ---------- save ----------
  async function save(close, addToScene) {
    const errs = validateAsset(a);
    if (errs.length) return toast(`還不能儲存：${errs[0]}`, "err", 5000);
    if (isNew && assetLib.get(a.id)) return toast(`id「${a.id}」已在素材庫，請換一個`, "err", 5000);
    if (!(await assetLib.upsert(a))) return;
    const used = store.project.assets.some((x) => x.id === a.id);
    if (used) {
      store.edit(`更新自訂物品「${a.label}」`, (p) => { p.assets = p.assets.map((x) => (x.id === a.id ? a : x)); });
      toast(`已存到素材庫，場景裡的「${a.label}」也一併更新`);
    } else toast(`「${a.label}」已存到素材庫`);
    close();
    if (addToScene) ops.addProp(a.id, a);
  }

  const title = isNew ? "新增自訂物品" : `編輯自訂物品「${a.label}」`;
  modal(title, h("div", { class: "ae" }, side, view), [
    { label: "取消" },
    { label: "儲存到素材庫", onClick: (c) => save(c, false) },
    { label: "儲存並加入場景", primary: true, onClick: (c) => save(c, true) },
  ], {
    wide: true, sticky: true,
    onClose: () => {
      offModel();
      cancelAnimationFrame(raf);
      controls.dispose();
      tc.detach();
      tc.dispose();
      if (model) disposeObject(model);
      disposeObject(man.root);
      box.dispose();
      renderer.dispose();
    },
  });
  // a model file read from IndexedDB after the editor opened: show it and fill in its size
  const offModel = onModelReady((name) => {
    if (name !== a.model?.file) return;
    a = { ...a, model: { ...a.model, size: modelSize(getModel(name), a.model.unit, a.model.yaw) } };
    render();
    refreshPreview(true);
  });
  setDragMode(dragMode);
  setSnap();
  render();
  refreshPreview(true);
  loop();
}
