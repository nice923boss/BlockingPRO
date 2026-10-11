// 3D view toolbar and hint line: view / tool menus, toggles, walk-through badge, pilot bar.
import { DISPLAY_MODES } from "../runtime/schema.js";
import { findEntity } from "./state.js";
import * as ops from "./ops.js";
import { saveCameraView } from "./ops-view.js";
import { openCrowd } from "./crowd-dialog.js";
import { h, select, menu, toast, fmt } from "./ui.js";

const HINTS = {
  posing: "擺姿勢：點關節球選取，拖曳旋轉環調整｜Enter 套用、Esc 取消",
  ruler: "量尺：點兩個物件或地面量距離，第三下重新開始｜Esc 或再按一次量尺結束",
  wallDraw: "畫牆：點地面放牆角（每格 10 公分，開「吸附」50 公分；接近水平或垂直自動對齊）｜點第一個角封閉房間，在最後一角再點一下或 Enter 完成｜Backspace 刪最後一角、Esc 取消",
  wallCut: (what) => `開${what}：點一面整片的牆，${what}開在點的位置（綠框預覽），可連續開｜Ctrl+Z 復原、Esc 結束`,
  rotate: "旋轉：拖曳水平環轉動選取物件的方向（有多個路徑點時寫在播放頭）｜R 或 Esc 結束",
  normal: "左鍵旋轉、右鍵平移、滾輪縮放｜點物件選取（Ctrl＋點多選、Alt＋拖曳框選）、右鍵選單｜Shift＋點地面加路徑點｜R 旋轉方向",
};

export function initViewbar(el, store, vp) {
  const bar = h("div", { class: "viewbar" }), hint = h("div", { class: "viewhint" });
  el.append(bar, hint);
  const tools = vp.tools, wall = vp.wall;
  const at = (e) => { const r = e.currentTarget.getBoundingClientRect(); return [r.left, r.bottom + 2]; };
  const toggle = (label, on, title, fn) => h("button", { class: on ? "on" : null, title, onclick: () => { fn(); render(); } }, label);
  const selCam = () => { const ent = findEntity(store.project, store.sel.id); return ent?.list === "cameras" ? ent.spec : null; };

  function saveToCamera() {
    const cam = selCam();
    if (!cam) return toast("先在場景裡選取一台攝影機", "warn");
    if (cam.mount) return toast("跟著角色移動的攝影機不能存視角", "warn");
    if (cam.locked) return toast(`「${cam.name}」已鎖定，先解除鎖定`, "warn");
    saveCameraView(cam.id, vp.camera.position.toArray(), vp.orbit.target.toArray(), { autoKey: vp.autoKey });
    const where = vp.autoKey ? `（${fmt(store.time)} 秒的關鍵影格）` : "（整條路徑一起移動）";
    toast(cam.aim.mode === "actor" ? `已把機位存到「${cam.name}」${where}；這台對準角色，只存位置` : `已把目前視角存到「${cam.name}」${where}`);
  }

  function viewMenu(e) {
    menu(...at(e), [
      { label: "透視（P）", onClick: () => vp.viewPersp() },
      { label: "俯視（T）", onClick: () => vp.viewTop() },
      { label: "對準選取（F）", onClick: () => vp.focusSelected() },
    ]);
  }

  function toolMenu(e) {
    const cam = selCam();
    menu(...at(e), [
      { label: "從目前視角建立攝影機", onClick: () => tools.cameraFromView() },
      cam && { label: `目前視角存到「${cam.name}」`, onClick: saveToCamera },
      cam && { label: `駕駛「${cam.name}」（WASD）`, onClick: () => vp.pilotStart(cam.id) },
      { label: "加入路人群…", onClick: () => openCrowd(vp) },
      { label: `${wall.mode === "draw" ? "✓ " : ""}畫牆（點地面放牆角）`, onClick: () => wall.set(wall.mode === "draw" ? null : "draw") },
      { label: `${wall.mode === "door" ? "✓ " : ""}在牆上開門`, onClick: () => wall.set(wall.mode === "door" ? null : "door") },
      { label: `${wall.mode === "window" ? "✓ " : ""}在牆上開窗`, onClick: () => wall.set(wall.mode === "window" ? null : "window") },
      { label: `${tools.dropOnSurface ? "✓ " : ""}拖曳小物件時放到桌面或地面`, onClick: () => { tools.dropOnSurface = !tools.dropOnSurface; } },
    ]);
  }

  function collisionMenu(e) {
    const P = store.project, name = (id) => findEntity(P, id)?.spec.name || id;
    const list = vp.collisions;
    menu(...at(e), [
      ...list.slice(0, 15).map((c) => ({
        label: `${fmt(c.t0)} 到 ${fmt(c.t1)} 秒：${name(c.a)} ${c.kind === "actor" ? "和" : "穿過"} ${name(c.b)}${c.kind === "actor" ? " 重疊" : ""}`,
        onClick: () => { store.setTime(c.t0); store.select({ id: c.a }); },
      })),
      list.length > 15 && { label: `還有 ${list.length - 15} 處，先修正上面幾處`, onClick: () => {} },
    ]);
  }

  function render() {
    if (vp.pilot) {
      const cam = findEntity(store.project, vp.pilot.id)?.spec, rec = !!vp.pilot.rec;
      bar.replaceChildren(
        h("span", { class: "pilotbar" }, `駕駛「${cam?.name || ""}」：WASD 移動、QE 升降、Shift 加速`),
        rec ? "" : toggle("自動關鍵影格", vp.autoKey, "開啟：在播放頭寫入關鍵影格；關閉：整條路徑一起移動", () => { vp.autoKey = !vp.autoKey; }),
        h("button", { class: rec ? "rec on" : "rec", title: "從目前時間開始播放，同時用 WASD 和滑鼠駕駛；停止播放時，這段飛行會簡化成關鍵影格，取代這段時間原本的路徑（Ctrl+Z 可復原）", onclick: () => vp.pilotRecord() }, rec ? "■ 停止錄製" : "● 錄製運鏡"),
        h("button", { class: "primary", title: "回到原本的編輯視角（Esc）", onclick: () => vp.pilotStop() }, "結束駕駛"),
      );
      hint.textContent = rec ? "錄製中：看 3D 視窗駕駛，導演台要等寫入後才會顯示新運鏡｜空白鍵結束錄製"
        : "左鍵拖曳轉向｜移動會寫進這台攝影機，導演台同步預覽｜「錄製運鏡」邊播放邊駕駛｜Esc 結束";
      return;
    }
    const S = store.project.settings, n = vp.collisions.length;
    bar.replaceChildren(
      h("button", { title: "透視、俯視、對準選取", onclick: viewMenu }, "視角 ▾"),
      toggle("四分割", !!vp.quad, "俯視、前視、右視加上透視（右上）", () => vp.setQuad(!vp.quad)),
      toggle("自動關鍵影格", vp.autoKey, "開啟：拖曳物件時在播放頭寫入路徑點；關閉：整條路徑一起平移", () => { vp.autoKey = !vp.autoKey; }),
      toggle("吸附", vp.snap, "移動每格 10 公分、旋轉每格 15 度", () => vp.setSnap(!vp.snap)),
      toggle("旋轉", vp.rotateMode, "拖曳水平環轉動角色或物品的方向（R）", () => toggleRotate(false)),
      toggle("量尺", !!tools.ruler, "點兩個物件或地面量距離", () => { wall.set(null); tools.setRuler(!tools.ruler); }),
      toggle("洋蔥皮", vp.onion.on, "顯示選取角色前後 0.5、1 秒的姿勢（藍：之前，橘：之後）", () => { vp.onion.on = !vp.onion.on; }),
      h("button", { title: "建立攝影機、存視角、駕駛攝影機、加入路人群、畫牆與開門窗", onclick: toolMenu }, "工具 ▾"),
      wall.mode ? h("button", { class: "primary", title: "Esc", onclick: () => wall.set(null) }, wall.mode === "draw" ? "結束畫牆" : "結束開門窗") : "",
      select([["", "呈現：各自設定"], ...Object.entries(DISPLAY_MODES).map(([k, l]) => [k, `呈現：全部${l}`])], S.display || "", (v) => ops.patchSettings({ display: v || null }, "修改呈現方式")),
      n ? h("button", { class: "warnbtn", title: "角色穿過其他角色或物品的時間點（點一下跳過去）", onclick: collisionMenu }, `⚠ 穿模 ${n} 處`) : "",
    );
    hint.textContent = store.posing ? HINTS.posing : wall.mode === "draw" ? HINTS.wallDraw : wall.mode ? HINTS.wallCut(wall.mode === "door" ? "門" : "窗") : tools.ruler ? HINTS.ruler : vp.rotateMode ? HINTS.rotate : HINTS.normal;
  }

  function toggleRotate(rerender = true) {
    vp.rotateMode = !vp.rotateMode;
    vp.updateGizmo();
    if (rerender) render();
  }

  /** Esc: leave the ruler or the rotate ring first; false when nothing was on */
  function escape() {
    if (tools.ruler) tools.setRuler(false);
    else if (vp.rotateMode) { vp.rotateMode = false; vp.updateGizmo(); }
    else return false;
    render();
    return true;
  }

  vp.onToolChange = render;
  return { render, toggleRotate, escape };
}
