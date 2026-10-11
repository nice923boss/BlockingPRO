// Project files: new, open (file, folder or drag and drop), save as .blockingpro.json.
// A project folder (as made by the BlockingPRO SKILL) holds one *.blockingpro.json and optional *.blockingpro-assets.json packs;
// custom assets found while opening are also added to the tool's library.
import { h, toast, confirmBox, modal, downloadBlob, safeName } from "./ui.js";
import { FORMAT, emptyProject } from "../runtime/schema.js";
import { readAssets } from "../runtime/assets.js";
import { assetLib, reportMerge } from "./asset-library.js";
import { isAudioFile, importAudioFiles, linkAudioFiles } from "./audio.js";
import { isImageFile, linkImageFiles } from "./images.js";
import { isModelFile, linkModelFiles, modelNames } from "./models.js";

const MAX_JSON_BYTES = 20 * 1024 * 1024;

export async function newProject(store) {
  const P = store.project;
  if (P.actors.length + P.props.length > 0 && !(await confirmBox("新場景", "要清空目前的場景嗎？可用 Ctrl+Z 復原。", "清空"))) return;
  store.load(emptyProject(), "新場景");
}

/** Download the project; only the custom assets its props use go into the file. */
export function saveProject(store) {
  const P = store.project;
  const used = new Set(P.props.map((o) => o.type));
  const out = { ...P, assets: P.assets.filter((a) => used.has(a.id)) };
  const blob = new Blob([JSON.stringify(out, null, 2)], { type: "application/json" });
  downloadBlob(blob, `${safeName(P.name)}.blockingpro.json`);
  const models = modelNames(out.assets);
  if (models.length) toast(`已下載專案檔。模型檔沒有包在專案檔裡，要給別人或換電腦時，把 ${models.join("、")} 和專案檔放在同一個資料夾。`, "info", 9000);
  else toast("已下載專案檔");
}

const pathOf = (f) => f.webkitRelativePath || f.relPath || f.name;

/** Read and classify JSON files: projects and asset packs. Unreadable files are reported, not fatal. */
async function classify(files) {
  const projects = [], packs = [], bad = [];
  for (const f of files) {
    if (!/\.json$/i.test(f.name) || f.size > MAX_JSON_BYTES) continue;
    let json;
    try {
      json = JSON.parse(await f.text());
    } catch (err) {
      console.error(`BlockingPRO: ${pathOf(f)} 不是有效的 JSON`, err);
      bad.push(`${pathOf(f)}（${err.message}）`);
      continue;
    }
    if (json?.format === FORMAT) projects.push({ file: f, json });
    else {
      const r = readAssets(json);
      if (r.kind === "pack" || r.kind === "list" || r.kind === "asset") packs.push({ file: f, assets: r.assets });
    }
  }
  return { projects, packs, bad };
}

function chooseProject(projects) {
  return new Promise((done) => {
    const close = modal("選擇要開啟的專案", h("div", {},
      h("p", { class: "note" }, `資料夾裡有 ${projects.length} 個專案檔，選一個開啟：`),
      h("div", { class: "list" }, projects.map((p) => h("div", { class: "li", onclick: () => { done(p); close(); } },
        h("span", { class: "grow" }, `${p.json.name || "未命名場景"}`), h("span", { class: "chip" }, pathOf(p.file)))))),
    [{ label: "取消", onClick: (c) => { c(); done(null); } }], { onClose: () => done(null) });
  });
}

/**
 * Open a set of files (a folder, a drop, or one picked file).
 * One project is loaded (asking which when there are several); every asset pack and the project's own assets go into the library.
 */
export async function openFiles(store, files, { source = "", confirmReplace = true } = {}) {
  const { projects, packs, bad } = await classify(files);
  const label = source || (files.length === 1 ? files[0].name : "檔案");
  const sounds = files.filter(isAudioFile);
  // only sound files (dropped or picked): add them to the audio track at the playhead
  if (!projects.length && !packs.length && sounds.length && !bad.length) { await importAudioFiles(store, sounds, store.time); return true; }
  const pictures = files.filter(isImageFile);
  if (!projects.length && !packs.length && pictures.length && !bad.length) {
    toast("圖片要當地面底圖或背景圖：先點空白處取消選取，在右側「場景設定」的「環境」選擇圖片。", "info", 8000);
    return false;
  }
  if (!projects.length && !packs.length && files.some(isModelFile) && !bad.length) {
    toast("GLB／OBJ 模型要先做成物品：到左側素材庫「自訂」分頁按「匯入模型」。", "info", 8000);
    return false;
  }
  if (!projects.length && !packs.length) {
    const why = bad.length ? `：${bad.slice(0, 3).join("、")}` : "（需要 *.blockingpro.json 專案檔或 *.blockingpro-assets.json 物品包）";
    toast(`「${label}」裡沒有可以開啟的 BlockingPRO 檔案${why}`, "err", 7000);
    return false;
  }
  if (bad.length) toast(`略過 ${bad.length} 個無法讀取的 JSON：${bad.slice(0, 3).join("、")}`, "warn", 6000);
  const packAssets = packs.flatMap((p) => p.assets);
  const models = files.filter(isModelFile);
  if (!projects.length) {
    if (models.length) await linkModels(packAssets, models);
    reportMerge(await assetLib.mergeImported(packAssets, `「${label}」`), `「${label}」`);
    return true;
  }
  const chosen = projects.length > 1 ? await chooseProject(projects) : projects[0];
  if (!chosen) return false;
  const P = store.project;
  if (confirmReplace && P.actors.length + P.props.length > 0
    && !(await confirmBox("開啟專案", `要用「${chosen.json.name || pathOf(chosen.file)}」取代目前的場景嗎？可用 Ctrl+Z 復原。`, "開啟"))) return false;

  // props may use assets that live only in a pack next to the project: embed those so the project opens on its own
  const json = { ...chosen.json };
  const own = Array.isArray(json.assets) ? json.assets : [];
  const ownIds = new Set(own.map((a) => a?.id));
  const types = new Set((Array.isArray(json.props) ? json.props : []).map((o) => o?.type));
  const borrowed = packAssets.filter((a) => a && types.has(a.id) && !ownIds.has(a.id));
  json.assets = [...own, ...borrowed];

  // sound files next to the project go into the browser store before loading, so the clips find them right away
  const linked = sounds.length ? await linkAudioFiles({ audio: (Array.isArray(json.audio) ? json.audio : []).filter((x) => x?.file) }, sounds) : [];
  const linkedPics = pictures.length ? await linkImageFiles({ settings: json.settings || {} }, pictures) : [];
  if (models.length) await linkModels([...json.assets, ...packAssets], models);
  const issues = store.load(json, `開啟 ${pathOf(chosen.file)}`);
  const Q = store.project;
  const summary = `${Q.cameras.length} 台攝影機、${Q.cuts.length} 個剪接點、${Q.settings.duration} 秒`;
  if (issues.errors.length) toast(`已開啟「${Q.name}」（${summary}），但有 ${issues.errors.length} 個錯誤，見右側「檢查」`, "warn", 7000);
  else toast(`已開啟「${Q.name}」：${summary}`, "info", 5000);
  if (issues.notes.length) toast(`舊版專案已自動升級：${issues.notes.join("；")}。儲存後就是新格式。`, "info", 7000);
  if (issues.newer) toast("這個專案是較新版 BlockingPRO 存的，不認得的欄位可能被略過，請更新 BlockingPRO 後再編輯。", "warn", 9000);
  if (linked.length) toast(`已連結資料夾裡的音訊：${linked.join("、")}`);
  if (linkedPics.length) toast(`已連結資料夾裡的圖片：${linkedPics.join("、")}`);
  const toLibrary = [...json.assets, ...packAssets.filter((a) => !json.assets.includes(a))];
  if (toLibrary.length) reportMerge(await assetLib.mergeImported(toLibrary, `專案「${Q.name}」`), `專案「${Q.name}」`);
  return true;
}

async function linkModels(assets, files) {
  const linked = await linkModelFiles(assets, files);
  if (linked.length) toast(`已連結資料夾裡的模型：${linked.join("、")}`);
}

function pick(attrs, onFiles) {
  const input = h("input", { type: "file", style: { display: "none" }, ...attrs });
  input.addEventListener("change", () => {
    const files = [...input.files];
    input.remove();
    if (files.length) onFiles(files);
  });
  document.body.append(input);
  input.click();
}

export function openProject(store) {
  pick({ accept: ".json,application/json" }, (files) => openFiles(store, files));
}

/** Pick a project folder (for example one made by the BlockingPRO SKILL). */
export function openFolder(store) {
  pick({ webkitdirectory: true, multiple: true }, (files) => {
    const folder = (files[0].webkitRelativePath || "").split("/")[0] || "資料夾";
    openFiles(store, files, { source: `資料夾「${folder}」` });
  });
}

/**
 * Open a folder inside the BlockingPRO folder by its path, from the address (index.html?project=projects/<name>,
 * which tools/serve.py --project opens). The server lists the folder; only the files openFiles can use are fetched.
 */
export async function openServerFolder(store, rel) {
  try {
    const res = await fetch(`/api/folder?path=${encodeURIComponent(rel)}`);
    const list = await res.json();
    if (!res.ok) throw new Error(list.error || `HTTP ${res.status}`);
    const base = `/${list.folder.split("/").map(encodeURIComponent).join("/")}/`;
    const wanted = list.files.filter((f) => /\.json$/i.test(f.name) || isAudioFile(f) || isImageFile(f) || isModelFile(f));
    const files = await Promise.all(wanted.map(async (f) => {
      const r = await fetch(base + encodeURIComponent(f.name));
      if (!r.ok) throw new Error(`讀不到 ${list.folder}/${f.name}（HTTP ${r.status}）`);
      return new File([await r.blob()], f.name);
    }));
    return await openFiles(store, files, { source: `資料夾「${list.folder}」` });
  } catch (err) {
    console.error(`BlockingPRO: 無法開啟網址指定的專案 ${rel}`, err);
    toast(`無法開啟網址指定的專案「${rel}」：${err.message}`, "err", 9000);
    return false;
  }
}

/** Files inside a dropped folder (two levels deep is enough for a project folder). */
async function entryFiles(entry, depth = 0, prefix = "") {
  if (entry.isFile) {
    const f = await new Promise((ok, fail) => entry.file(ok, fail));
    f.relPath = prefix + f.name;
    return [f];
  }
  if (!entry.isDirectory || depth > 2) return [];
  const reader = entry.createReader();
  const all = [];
  for (;;) {
    const batch = await new Promise((ok, fail) => reader.readEntries(ok, fail));
    if (!batch.length) break;
    all.push(...batch);
  }
  const nested = await Promise.all(all.map((e) => entryFiles(e, depth + 1, `${prefix}${entry.name}/`)));
  return nested.flat();
}

/** Drop a project file, an asset pack or a whole project folder anywhere on the window */
export function enableDrop(store) {
  const hint = h("div", { class: "drop-hint" }, "放開以開啟 BlockingPRO 專案檔、專案資料夾、物品包或音訊檔");
  document.body.append(hint);
  let depth = 0;
  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes("Files");
  addEventListener("dragenter", (e) => { if (!hasFiles(e)) return; depth++; hint.classList.add("show"); });
  addEventListener("dragleave", () => { if (--depth <= 0) { depth = 0; hint.classList.remove("show"); } });
  addEventListener("dragover", (e) => { if (hasFiles(e)) e.preventDefault(); });
  addEventListener("drop", async (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth = 0;
    hint.classList.remove("show");
    const entries = [...e.dataTransfer.items].map((it) => it.webkitGetAsEntry?.()).filter(Boolean);
    const folder = entries.find((x) => x.isDirectory);
    try {
      const files = entries.length ? (await Promise.all(entries.map((x) => entryFiles(x)))).flat() : [...e.dataTransfer.files];
      if (files.length) await openFiles(store, files, { source: folder ? `資料夾「${folder.name}」` : "" });
    } catch (err) {
      console.error("BlockingPRO: 讀取拖入的檔案失敗", err);
      toast(`讀取拖入的檔案失敗：${err.message}`, "err", 6000);
    }
  });
}
