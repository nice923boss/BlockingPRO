// Editor entry: wires the store, the shared scene runtime and the panels, runs the render loop and the shortcuts.
import { createStore, findEntity, selIds, storageUsage, listVersions, STORAGE_QUOTA } from "./state.js";
import { SceneRuntime } from "../runtime/scene.js";
import { findCollisions } from "../runtime/collide.js";
import * as ops from "./ops.js";
import { initTimeOps, addMarker, setInPoint, setOutPoint, jumpMark } from "./ops-time.js";
import { initEntityOps, copyEntities, pasteEntities, groupEntities, groupOf, ungroup, toggleFlag } from "./ops-entity.js";
import { initViewOps } from "./ops-view.js";
import { initViewbar } from "./viewbar.js";
import { Posing } from "./posing.js";
import { Viewport } from "./viewport.js";
import { Timeline } from "./timeline.js";
import { AudioPlayer } from "./audio.js";
import { getImage, onImageReady, ensureImages } from "./images.js";
import { getModel, onModelReady, ensureModels } from "./models.js";
import { Monitor } from "./monitor.js";
import { LiveCut } from "./livecut.js";
import { initCameraOps } from "./ops-camera.js";
import { initPairOps } from "./ops-pair.js";
import { initSitOps } from "./ops-sit.js";
import { Inspector } from "./inspector.js";
import { Outliner } from "./outliner.js";
import { Library } from "./library.js";
import { startTour, tourSeen } from "./tour.js";
import { openMp4Dialog, openSheetDialog, downloadOverview } from "./exporter.js";
import { openMoreMenu } from "./export-extra.js";
import { newProject, openProject, openFolder, openFiles, openServerFolder, saveProject, enableDrop } from "./fileio.js";
import { assetLib } from "./asset-library.js";
import { poseLib } from "./pose-lib.js";
import { h, splitter, toast, modal, isTyping, scrubHooks, downloadBlob, safeName, fmt } from "./ui.js";

const $ = (id) => document.getElementById(id);

const store = createStore();
const restored = store.restoreDraft();
const rt = new SceneRuntime();
rt.imageSource = getImage; // ground image and backdrop pictures live in IndexedDB
rt.modelSource = getModel; // so do the GLB / OBJ files of imported model props
ops.initOps(store, rt);
initTimeOps(store);
initEntityOps(store);
initViewOps(store);
initCameraOps(store, rt);
initPairOps(store);
initSitOps(store);
rt.sync(store.project);
// one drag on a number field is one undo step
scrubHooks.begin = () => store.beginGesture();
scrubHooks.end = () => store.endGesture();

const posing = new Posing(store, rt);
const viewport = new Viewport($("view"), store, rt, posing);
const monitor = new Monitor($("monitor"), store, rt);
const livecut = new LiveCut(store, rt, () => { monitor.layoutKey = ""; monitor.renderHead(); });
monitor.livecut = livecut;
new Timeline($("timeline"), store, { onEditPose: (id, clipId) => posing.start(id, clipId) });
new AudioPlayer(store);
const outlinerEl = h("div", { id: "outliner" });
$("right").prepend(outlinerEl);
new Outliner(outlinerEl, store);
new Inspector($("insp"), store, rt, { posing, viewport });
const library = new Library($("library"), store, viewport);

// ---------- top bar, view bar, status bar ----------

const projName = h("input", { id: "projName", title: "場景名稱（也是下載檔名）", onchange: (e) => store.edit("修改場景名稱", (d) => { d.name = e.target.value.trim() || "未命名場景"; }) });
const undoBtn = h("button", { title: "復原（Ctrl+Z）", onclick: () => undo() }, "↶ 復原");
const redoBtn = h("button", { title: "重做（Ctrl+Y）", onclick: () => redo() }, "↷ 重做");
let busy = false;
const exportCtl = { busy: (on) => { busy = on; } };

$("topbar").append(
  h("span", { class: "brand" }, "Blocking", h("b", {}, "PRO")),
  h("button", { title: "清空成新場景", onclick: () => newProject(store) }, "新場景"),
  h("button", { title: "開啟 .blockingpro.json 或物品包（Ctrl+O），也可以直接把檔案拖進視窗", onclick: () => openProject(store) }, "開啟"),
  h("button", { title: "開啟專案資料夾（SKILL 產生的資料夾），一起匯入裡面的自訂物品；也可以把資料夾拖進視窗", onclick: () => openFolder(store) }, "開啟資料夾"),
  h("button", { title: "下載專案檔（Ctrl+S）", onclick: () => saveProject(store) }, "儲存"),
  h("button", { title: "載入內建範例", onclick: () => library.show("examples") }, "範例"),
  h("button", { title: "自動保留的最近 10 份版本，可以還原", onclick: () => showVersions() }, "版本"),
  h("span", { class: "sep" }),
  projName,
  h("span", { class: "sep" }),
  undoBtn, redoBtn,
  h("span", { class: "grow" }),
  h("button", { title: "依時間平均取格，標上秒數與機位", onclick: () => openSheetDialog(store, rt) }, "分鏡表 PNG"),
  h("button", { title: "播放頭時間的俯視平面圖：走位路徑、機位與視線", onclick: () => downloadOverview(store, rt) }, "平面圖 PNG"),
  h("button", { title: "首尾格 PNG、AI 影片提示詞、GIF 預覽、分鏡表 PDF、鏡頭表 CSV", onclick: (e) => openMoreMenu(e.currentTarget, store, rt, exportCtl) }, "更多輸出 ▾"),
  h("button", { class: "primary", title: "依剪接輸出 MP4；可每鏡分檔、依上限分段、關節版、深度圖", onclick: () => openMp4Dialog(store, rt, exportCtl) }, "下載 MP4"),
  h("button", { title: "快捷鍵與操作說明", onclick: () => showHelp() }, "說明"),
);

const viewbar = initViewbar($("view"), store, viewport);
const renderViewbar = viewbar.render;

const status = h("span", { class: "grow" });
const counts = h("span", {});
$("statusbar").append(status, counts, h("span", { class: "credit" }, "製作者：黃政文"));
function renderChrome() {
  const P = store.project;
  if (document.activeElement !== projName) projName.value = P.name;
  undoBtn.disabled = !store.canUndo || !!store.posing;
  redoBtn.disabled = !store.canRedo || !!store.posing;
  status.textContent = store.lastAction || "就緒";
  const iss = store.issues;
  counts.textContent = `角色 ${P.actors.length}｜物品 ${P.props.length}｜燈 ${P.lights.length}｜攝影機 ${P.cameras.length}｜剪接 ${P.cuts.length}${iss.errors.length ? `｜錯誤 ${iss.errors.length}` : ""}${iss.warnings.length ? `｜提醒 ${iss.warnings.length}` : ""}`;
  counts.style.color = iss.errors.length ? "var(--danger)" : "";
  document.title = `${P.name}｜BlockingPRO`;
}

const HELP = [
  ["播放", [
    ["空白鍵", "播放／暫停"], ["← →", "上一格／下一格"], ["Shift＋← →", "跳到上一個／下一個標記或剪接點"], ["Home End", "開頭／結尾"],
    ["I／O", "在播放頭設入點／出點，播放只在入出點之間循環"], ["時間軸工具列", "播放速度 0.25 到 2 倍、循環、清除入出點"],
  ]],
  ["時間軸", [
    ["M", "在播放頭加標記（段落名稱，雙擊標記改名，可拖曳）"], ["1 到 9", "在播放頭切到第 N 台攝影機"],
    ["K", "在播放頭幫選取的物件加路徑點"], ["Shift／Ctrl＋點", "多選關鍵影格與動作片段，拖曳其中一個一起移動"],
    ["空白處拖曳", "框選關鍵影格與動作片段（按住 Shift 加選）"], ["吸附", "拖曳時對齊剪接點、標記、片段邊緣、播放頭，工具列可關閉"],
    ["對白列雙擊", "加一句字幕，導演台下方顯示"], ["尺標右鍵", "加標記、設入出點"],
    ["時間縮放", "選一段時間整體放慢或加快，後面的內容跟著移動"], ["鏡頭表", "所有鏡頭的秒數、攝影機、說明直接在表格裡改"],
  ]],
  ["編輯", [
    ["Delete", "刪除選取的項目（剪接點、路徑點、動作片段、物件）"], ["Ctrl+D", "複製選取的物件"],
    ["Ctrl+C／Ctrl+V", "複製物件到剪貼簿（含路徑與動作），可以在其他專案貼上"],
    ["Ctrl+G／Ctrl+Shift+G", "選取的物件組成群組／解散群組；點群組任一成員會選取整組"],
    ["H／L", "隱藏（只在 3D 編輯視窗）／鎖定選取的物件"], ["場景清單", "右上方，可搜尋、收合分類；Ctrl＋點加選、Shift＋點選一段"],
    ["Ctrl+Z／Ctrl+Y", "復原／重做"], ["數值欄位", "左右拖曳欄位或欄位名稱調整數值（Shift 加快、Ctrl 微調）"],
    ["Esc", "關閉對話框與選單；取消選取；擺姿勢時取消"], ["Enter", "擺姿勢時套用"], ["?", "開啟這份說明"],
  ]],
  ["3D 視窗", [
    ["F／T／P", "對準選取／俯視／透視"], ["Shift＋點地面", "在播放頭加路徑點"], ["Ctrl＋點", "加選或取消選取；多選時拖曳箭頭一起移動"],
    ["Alt＋拖曳", "框選角色、物品、攝影機"], ["右鍵", "物件選單：複製、刪除、對準、加路徑點、從這台攝影機看、駕駛"],
    ["R", "旋轉環：拖曳水平環轉動角色或物品的方向"], ["小物件拖曳", "左右移動時自動放到桌面或地面（工具選單可關閉）"],
    ["量尺", "點兩個物件或地面量距離"], ["洋蔥皮", "顯示選取角色前後 0.5、1 秒的姿勢"], ["四分割", "俯視、前視、右視加上透視"],
    ["路徑刻度", "選取物件的路徑上每秒一個刻度，間距越大走得越快"], ["⚠ 穿模", "角色穿過其他角色或物品時，路徑標紅，工具列可以跳到那個時間點"],
    ["工具 ▾", "從目前視角建立攝影機、把視角存到選取的攝影機"], ["駕駛攝影機", "WASD 移動、QE 升降、Shift 加速、左鍵拖曳轉向、Esc 結束；移動寫進那台攝影機"],
  ]],
  ["檔案", [["Ctrl+S／Ctrl+O", "儲存／開啟專案檔"], ["版本", "自動保留最近 10 份版本，可以還原"]]],
];

function showHelp() {
  if (document.querySelector(".modal-back")) return;
  modal("BlockingPRO 操作說明", h("div", {},
    h("div", { class: "help" }, HELP.map(([title, keys]) => h("section", {}, h("h3", {}, title),
      h("div", { class: "list" }, keys.map(([k, v]) => h("div", { class: "li", style: { cursor: "default" } }, h("kbd", {}, k), h("span", { class: "grow" }, v))))))),
    h("p", { class: "note" }, "流程：左側素材庫加入角色、物品、攝影機，3D 視窗拖曳擺位、Shift＋點地面畫走位，時間軸加動作與剪接，導演台確認畫面，最後下載 MP4 給 Seedance 當參考。"),
    h("p", { class: "note" }, "編輯內容會自動暫存在這台電腦的瀏覽器；要換電腦或備份，請按「儲存」下載專案檔。"),
  ), [{ label: "關閉" }, { label: "新手導覽", onClick: (close) => { close(); startTour(store, library); } }], { wide: true });
}

// ---------- versions, storage, crash backup ----------

const hhmm = (ms) => new Date(ms).toLocaleString("zh-TW", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
const kb = (n) => `${Math.round(n / 1024)} KB`;

function showVersions() {
  const vers = listVersions(), used = storageUsage();
  const body = h("div", {},
    h("p", { class: "note" }, "編輯時每隔幾分鐘自動保留一份，開啟其他專案前也會保留目前的內容，最多 10 份。還原前會先把目前的內容存成一份版本，也可以用 Ctrl＋Z 回到還原前。"),
    vers.length
      ? h("div", { class: "list" }, vers.map((v) => h("div", { class: "li", style: { cursor: "default" } },
        h("span", { class: "grow" }, `${hhmm(v.at)}　${v.name}`,
          h("span", { class: "note" }, `　角色 ${v.project.actors?.length || 0}｜物品 ${v.project.props?.length || 0}｜攝影機 ${v.project.cameras?.length || 0}｜${fmt(v.project.settings?.duration || 0)} 秒`)),
        h("button", { onclick: () => { close(); store.load(v.project, `還原版本 ${hhmm(v.at)}`); toast(`已還原 ${hhmm(v.at)} 的版本`); } }, "還原"))))
      : h("p", {}, "還沒有版本紀錄。"),
    h("p", { class: "note" }, used == null ? "瀏覽器暫存無法使用（例如無痕視窗），請記得按「儲存」下載專案檔。" : `瀏覽器暫存使用 ${kb(used)}／約 ${kb(STORAGE_QUOTA)}。`),
  );
  const close = modal("版本紀錄", body, [{ label: "關閉" }], { wide: true });
}

// Warn once per session when the browser storage is nearly full or a draft could not be written.
let warnedFull = false, warnedFail = false;
function checkStorage() {
  if (store.saveFailed && !warnedFail) {
    warnedFail = true;
    toast("瀏覽器暫存已滿或無法寫入，這次的修改沒有自動暫存，請按「儲存」下載專案檔", "err", 8000);
  }
  const used = storageUsage();
  if (used != null && used > STORAGE_QUOTA * 0.8 && !warnedFull) {
    warnedFull = true;
    toast(`瀏覽器暫存快滿了（${kb(used)}／約 ${kb(STORAGE_QUOTA)}），請按「儲存」下載專案檔備份；舊版本紀錄會先被刪掉`, "warn", 8000);
  }
}

// On an unexpected error, download a backup of the project once, so a broken session does not lose work.
let backedUp = false;
function crashBackup(err) {
  const msg = String(err?.message || err || "");
  if (backedUp || /ResizeObserver loop/.test(msg) || err?.name === "AbortError" ||(!store.project.actors.length && !store.project.cameras.length)) return;
  backedUp = true;
  console.error("BlockingPRO: 發生未預期的錯誤，已下載備份", err);
  const stamp = new Date().toLocaleString("sv-SE").slice(0, 16).replace(/[-: ]/g, ""); // local time, YYYYMMDDhhmm
  downloadBlob(new Blob([JSON.stringify(store.project, null, 2)], { type: "application/json" }), `${safeName(store.project.name)}-備份-${stamp}.blockingpro.json`);
  toast("發生未預期的錯誤，已自動下載專案備份檔。建議儲存後重新整理頁面。", "err", 10000);
}
addEventListener("error", (e) => {
  // scripts from other origins (CDN, extensions) report no details; they are not editor bugs
  if (e.filename && !e.filename.startsWith(location.origin)) return;
  crashBackup(e.error || e.message);
});
addEventListener("unhandledrejection", (e) => crashBackup(e.reason));

// ---------- splitters ----------

splitter($("splitL"), $("main"), "--left", { sign: 1, min: 170, max: 480, storeKey: "blockingpro.ui.left" });
splitter($("splitR"), $("main"), "--right", { sign: -1, min: 240, max: 560, storeKey: "blockingpro.ui.right" });
splitter($("splitM"), $("stage"), "--mon", { sign: -1, min: 200, max: 1400, storeKey: "blockingpro.ui.mon" });
splitter($("splitT"), $("center"), "--tl", { axis: "y", sign: -1, min: 120, max: 700, storeKey: "blockingpro.ui.tl" });

// ---------- render loop ----------

let needSync = false, needRebuild = true, dirty = true, posingId = null, collideAt = performance.now(); // collideAt: when to rerun the walk-through check
store.subscribe((what) => {
  dirty = true;
  if (what === "project") { needSync = true; needRebuild = true; collideAt = performance.now() + 150; renderViewbar(); ensureImages(store.project); ensureModels(store.project); }
  if (what === "sel") needRebuild = true;
  if (what === "time") viewport.updateGizmo();
  if (what === "posing") {
    const id = store.posing?.id || null;
    if (id !== posingId) { posingId = id; needRebuild = true; renderViewbar(); }
    else viewport.updateGizmo();
  }
  if (what === "storage") checkStorage();
  if (what !== "time") renderChrome();
});

// a picture finished loading from IndexedDB: rebuild the backdrop
onImageReady(() => { needSync = true; dirty = true; });
onModelReady(() => { needSync = true; dirty = true; });
ensureImages(store.project);
ensureModels(store.project);

let last = performance.now(), lastFrame = 0;
function frame(now) {
  requestAnimationFrame(frame);
  lastFrame = performance.now();
  step(now);
}
// requestAnimationFrame stops in a background tab or a hidden window (the page can still report "visible"):
// a timer then drives the loop so playback keeps real time, the sound stays in step and panels update
setInterval(() => { const now = performance.now(); if (now - lastFrame > 250) step(now); }, 100);

function step(now) {
  const dt = Math.max(0, (now - last) / 1000); // real elapsed time; a rAF timestamp can be slightly older than a timer step
  last = now;
  if (busy) return; // the MP4 encoder drives the shared scene
  if (store.playing) {
    // with in / out points playback stays inside them
    const r = store.range, a = r ? r.a : 0, b = r ? r.b : store.project.settings.duration;
    let t = store.time + dt * store.speed;
    if (t >= b) {
      if (store.loop) t = a + ((t - a) % Math.max(1e-3, b - a));
      else { t = b; store.setPlaying(false); }
    }
    store.setTime(t);
  }
  if (needSync) {
    needSync = false;
    rt.sync(store.project);
    posing.afterSync();
  }
  rt.evaluate(store.time);
  posing.apply();
  if (needRebuild) { needRebuild = false; viewport.rebuild(); }
  // walk-through check: once edits pause, not on every drag step
  if (collideAt && now >= collideAt && !store.playing) {
    collideAt = 0;
    viewport.setCollisions(findCollisions(rt, store.project));
    renderViewbar();
  }
  viewport.render(dirty); // shadows are redrawn only when something changed
  if (dirty || monitor.dirty) { dirty = false; monitor.render(); }
}

// ---------- shortcuts ----------

function undo() { if (!store.posing) store.undo(); }
function redo() { if (!store.posing) store.redo(); }

addEventListener("keydown", (e) => {
  if (isTyping(e) || document.querySelector(".modal-back")) return;
  const k = e.key, ctrl = e.ctrlKey || e.metaKey, P = store.project, fps = P.settings.fps;
  if (store.posing) {
    if (k === "Enter") { e.preventDefault(); posing.bake(); return; }
    if (k === "Escape") { e.preventDefault(); posing.cancel(); return; }
  }
  if (ctrl) {
    const lk = k.toLowerCase();
    if (lk === "z" && !e.shiftKey) undo();
    else if (lk === "y" || (lk === "z" && e.shiftKey)) redo();
    else if (lk === "s") saveProject(store);
    else if (lk === "o") openProject(store);
    else if (lk === "d") { if (!store.posing) ops.duplicateSelected(); }
    else if (lk === "c") {
      // leave text copying (selected words in a panel) to the browser
      if (store.posing || !store.sel.id || getSelection()?.toString()) return;
      copyEntities(selIds(store.sel));
    } else if (lk === "v") { if (!store.posing) pasteEntities(); }
    else if (lk === "g") {
      if (store.posing) return;
      if (e.shiftKey) { const g = groupOf(P, store.sel.id); if (g) ungroup(g.id); }
      else groupEntities(selIds(store.sel));
    } else return;
    e.preventDefault();
    return;
  }
  if (e.altKey) return;
  if (k === " ") store.setPlaying(!store.playing);
  else if (k === "?") showHelp();
  else if (e.shiftKey && (k === "ArrowLeft" || k === "ArrowRight")) jumpMark(k === "ArrowLeft" ? -1 : 1);
  else if (k === "m" || k === "M") addMarker(store.time);
  else if (k === "i" || k === "I") setInPoint();
  else if (k === "o" || k === "O") setOutPoint();
  else if (k === "ArrowLeft") store.setTime(store.time - 1 / fps);
  else if (k === "ArrowRight") store.setTime(store.time + 1 / fps);
  else if (k === "Home") store.setTime(0);
  else if (k === "End") store.setTime(P.settings.duration);
  else if (k === "Delete" || k === "Backspace") { if (!store.posing) ops.deleteSelection(); }
  else if (k === "Escape") { if (!viewbar.escape()) { store.select({}); store.setPreview(null); } }
  else if (/^[1-9]$/.test(k)) {
    const cam = P.cameras[+k - 1];
    if (!cam) return;
    if (livecut.recording) livecut.press(cam.id);
    else ops.cutTo(cam.id, store.time);
  }
  else if (k === "f" || k === "F") viewport.focusSelected();
  else if (k === "t" || k === "T") viewport.viewTop();
  else if (k === "p" || k === "P") viewport.viewPersp();
  else if (k === "r" || k === "R") { if (!store.posing) viewbar.toggleRotate(); }
  else if (k === "h" || k === "H") { if (!store.posing && store.sel.id) toggleFlag(selIds(store.sel), "hidden"); }
  else if (k === "l" || k === "L") { if (!store.posing && store.sel.id) toggleFlag(selIds(store.sel), "locked"); }
  else if (k === "k" || k === "K") {
    const ent = findEntity(P, store.sel.id);
    if (!ent || store.posing || (ent.list === "cameras" && ent.spec.mount) || (ent.list === "props" && ent.spec.attach)) return;
    ops.addKeyAtPlayhead(ent.spec.id, "path", ops.trackValueAt(ent.spec, "path", store.time));
  } else return;
  e.preventDefault();
});

// ---------- start ----------

enableDrop(store);
assetLib.load();
poseLib.load();
poseLib.subscribe(() => { if (store.posing) store.setPosing({ ...store.posing }); });
renderViewbar();
renderChrome();
$("boot")?.remove();
requestAnimationFrame(frame);
if (restored) toast("已還原上次的編輯（暫存在這台電腦的瀏覽器）");
// ?project=projects/<name> (tools/serve.py --project): open that folder; dropped from the address so a reload keeps later edits
const projectParam = new URLSearchParams(location.search).get("project");
if (projectParam) {
  const url = new URL(location.href);
  url.searchParams.delete("project");
  history.replaceState(null, "", url);
  openServerFolder(store, projectParam);
}
// first visit with an empty editor: walk through the basic steps once
if (!restored && !projectParam && !tourSeen()) startTour(store, library);
checkStorage();
setInterval(checkStorage, 60000); // usage grows with autosave; reading it on every edit would be wasteful

// handle for automated checks (tools / browser tests)
window.BlockingPRO = { store, rt, ops, posing, viewport, monitor, livecut, assetLib, poseLib, openFiles: (files, opts) => openFiles(store, files, opts) };
