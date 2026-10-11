// Dialogs around the custom prop library: the prompt guide (make props with any chat AI), paste / file import and
// GLB / OBJ model import.
import { h, toast, modal, confirmBox, downloadBlob, safeName } from "./ui.js";
import { parseAssetText, makeAssetPack, uniqueAssetId } from "../runtime/assets.js";
import { MODEL_EXT, guessUnit, modelSize } from "../runtime/models.js";
import { readModelFile, storeModel } from "./models.js";
import { assetLib, reportMerge } from "./asset-library.js";
import { openAssetEditor } from "./asset-editor.js";
import { ASSET_FIELDS, PART_FIELDS, CAUTIONS, EXAMPLE_PACK, DESC_EXAMPLES, buildAssetPrompt } from "./asset-prompt.js";

export async function copyText(text, what = "內容") {
  try {
    await navigator.clipboard.writeText(text);
    toast(`已複製${what}`);
  } catch (err) {
    // older path still allowed in some embedded browsers that block the async clipboard
    const ta = Object.assign(h("textarea", { style: "position:fixed;opacity:0" }), { value: text });
    document.body.append(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    if (ok) { toast(`已複製${what}`); return; }
    console.error("BlockingPRO: 複製失敗", err);
    toast("瀏覽器不允許自動複製，請在文字框裡按 Ctrl+A 再按 Ctrl+C", "warn", 5000);
  }
}

const table = (head, rows) => h("table", { class: "kv" },
  h("tr", {}, head.map((x) => h("th", {}, x))),
  rows.map((r) => h("tr", {}, h("td", {}, h("code", {}, r[0])), h("td", {}, r[1]), h("td", {}, r[2]))));

const FAQ = [
  ["AI 回覆了一大段文字加 JSON，要怎麼貼？", "整段複製貼上即可。BlockingPRO 會找出 ``` 區塊或第一個 { 到最後一個 } 之間的 JSON。"],
  ["匯入時說 id 和內建物品重複？", "請 AI 換一個 id，例如加上前綴 my_ 或改成更具體的名稱（office_chair 而不是 chair）。"],
  ["物品浮在空中或陷進地面？", "把編輯器下方的提醒貼回給 AI，或在編輯器裡選中零件直接改 pos 的 y。原點必須在物品底部。"],
  ["物品方向反了？", "正面要朝 +Z。可以請 AI「整個物品繞 Y 軸轉 180 度」，或在場景裡改物品的旋轉角度。"],
  ["同一個 id 匯入兩次會怎樣？", "內容一樣就略過；內容不同會問你要覆蓋素材庫，還是保留原本的。"],
  ["刪掉素材庫的物品，用過它的專案會壞嗎？", "不會。專案存檔時會把用到的自訂物品一起存進專案檔，換電腦開也看得到。"],
  ["可以一次做很多個物品嗎？", "可以，assets 陣列裡放多個物品。建議一次 1 到 5 個，太多 AI 容易出錯。"],
  ["用 Claude 的 SKILL 做跟這裡有什麼不同？", "SKILL 會依故事一次產生整個專案資料夾（含自訂物品），這裡是用任何聊天 AI 單獨做物品，格式相同。"],
];

/** The prompt guide: steps, a description box that fills the prompt, format tables, cautions, example and FAQ. */
export function openPromptGuide(store) {
  const desc = h("textarea", { class: "code", rows: 3, placeholder: "描述要做的物品：是什麼、大概尺寸、正面朝哪、會不會拿在手上。可以一次寫好幾個。" });
  const out = h("pre", { class: "code" });
  const update = () => { out.textContent = buildAssetPrompt(desc.value); };
  desc.addEventListener("input", update);
  update();
  const example = JSON.stringify(EXAMPLE_PACK, null, 2);

  const body = h("div", {},
    h("p", {}, "用 ChatGPT、Claude、Gemini 等任何聊天 AI 都能做出可以匯入的自訂物品，不需要安裝 SKILL。做法是把下面產生的提示詞貼給 AI，再把 AI 的回覆貼回 BlockingPRO。"),
    h("h3", {}, "使用步驟"),
    h("ol", {},
      h("li", {}, "在下方「物品描述」寫要做的東西（是什麼、尺寸、正面朝哪、要不要拿在手上）。"),
      h("li", {}, "按「複製提示詞」，貼到聊天 AI 送出。"),
      h("li", {}, "AI 回覆後，整段複製（不用自己挑出 JSON）。"),
      h("li", {}, "回到這裡按「貼上匯入」，貼上後按「加入素材庫」；只有一個物品時也可以先「在編輯器開啟」檢查。"),
      h("li", {}, "到素材庫「物品」分頁的「自訂物品」點名稱，就會放進場景。"),
      h("li", {}, "有錯誤時，把錯誤訊息整段複製貼回給 AI，請它修正後重新輸出。")),
    h("h3", {}, "物品描述"),
    desc,
    h("div", { class: "guide-chips" }, h("span", { class: "note" }, "範例："), DESC_EXAMPLES.map((x) => h("button", { onclick: () => { desc.value = x; update(); } }, x))),
    h("h3", {}, "提示詞（會跟著描述更新）"),
    out,
    h("div", { class: "btns" },
      h("button", { class: "primary", onclick: () => copyText(out.textContent, "提示詞") }, "複製提示詞"),
      h("button", { onclick: () => openPasteImport(store) }, "貼上匯入")),
    h("h3", {}, "檔案格式"),
    h("p", {}, "最外層：", h("code", {}, '{ "format": "blockingpro-assets", "version": 1, "assets": [ ... ] }'), "。存成檔案時檔名建議用 ", h("code", {}, "名稱.blockingpro-assets.json"), "，可以直接拖進 BlockingPRO 視窗匯入。也接受單一物品、物品陣列，或含 assets 的 BlockingPRO 專案檔。"),
    h("p", { class: "note" }, "座標：單位公尺，Y 朝上，原點在物品底部正中央，正面朝 +Z。"),
    h("div", { class: "note" }, "物品欄位"),
    table(["欄位", "必填", "說明"], ASSET_FIELDS),
    h("div", { class: "note" }, "零件欄位（parts 裡的每一項）"),
    table(["欄位", "適用", "說明"], PART_FIELDS),
    h("h3", {}, "注意事項"),
    h("ul", {}, CAUTIONS.map((c) => h("li", {}, c))),
    h("h3", {}, "範例"),
    h("pre", { class: "code" }, example),
    h("div", { class: "btns" },
      h("button", { onclick: () => copyText(example, "範例") }, "複製範例"),
      h("button", { onclick: async () => reportMerge(await assetLib.mergeImported(EXAMPLE_PACK.assets, "範例"), "範例") }, "把範例加入素材庫")),
    h("h3", {}, "常見問題"),
    h("div", {}, FAQ.map(([q, a]) => h("div", { style: { margin: "6px 0" } }, h("div", {}, `問：${q}`), h("div", { class: "note" }, `答：${a}`)))));

  modal("自訂物品提示詞教學", body, [{ label: "關閉" }], { wide: true });
}

/** Paste text or pick a file, then add to the library (or open a single asset in the editor first). */
export function openPasteImport(store) {
  const area = h("textarea", { class: "code", rows: 14, spellcheck: "false", placeholder: "把 AI 的回覆整段貼在這裡（可以含說明文字和 ``` 標記）" });
  const status = h("div", { class: "note" }, "貼上後會檢查格式。");
  let parsed = null;
  const check = () => {
    parsed = area.value.trim() ? parseAssetText(area.value) : null;
    if (!parsed) status.replaceChildren("貼上後會檢查格式。");
    else if (parsed.error) status.replaceChildren(h("span", { class: "err" }, parsed.error));
    else status.replaceChildren(`找到 ${parsed.assets.length} 個物品：${parsed.assets.map((x) => x?.label || x?.id || "（未命名）").join("、")}`);
  };
  area.addEventListener("input", check);
  const file = h("input", { type: "file", accept: ".json,application/json,text/plain", style: { display: "none" }, onchange: async () => {
    const f = file.files[0];
    if (!f) return;
    area.value = await f.text();
    file.value = "";
    check();
  } });
  const ready = () => {
    if (!parsed) { toast("還沒有貼上內容", "warn"); return false; }
    if (parsed.error) { toast(parsed.error, "err", 5000); return false; }
    if (!parsed.assets.length) { toast("裡面沒有物品", "warn"); return false; }
    return true;
  };
  const body = h("div", {}, h("div", { class: "btns" }, h("button", { onclick: () => file.click() }, "選擇檔案…"), file), area, status);
  modal("匯入自訂物品", body, [
    { label: "取消" },
    { label: "在編輯器開啟", onClick: (c) => {
      if (!ready()) return;
      if (parsed.assets.length !== 1) return toast("有多個物品時請直接加入素材庫，再逐一編輯", "warn", 5000);
      c();
      openAssetEditor(store, parsed.assets[0], { isNew: true });
    } },
    { label: "加入素材庫", primary: true, onClick: async (c) => {
      if (!ready()) return;
      const res = await assetLib.mergeImported(parsed.assets, "貼上的內容");
      if (!res) return;
      c();
      reportMerge(res, "貼上的內容");
      if (!res.added.length && !res.updated.length && !res.invalid.length) toast("這些物品都已在素材庫");
    } },
  ], { wide: true, sticky: true });
  area.focus();
}

/** Pick a GLB / OBJ file, keep it in this browser and open it in the asset editor as a new model prop (p06). */
export function openModelImport(store) {
  const input = h("input", { type: "file", accept: ".glb,.obj", style: { display: "none" } });
  input.addEventListener("change", async () => {
    const f = input.files[0];
    input.remove();
    if (!f) return;
    let raw;
    try { raw = await readModelFile(f); } catch (err) {
      console.error(`BlockingPRO: 模型「${f.name}」無法讀取`, err);
      return toast(`「${f.name}」無法讀取：${err.message || err}`, "err", 8000);
    }
    const same = assetLib.assets.filter((x) => x.model?.file === f.name);
    if (same.length && !(await confirmBox("同名模型檔", `素材庫的「${same.map((x) => x.label).join("、")}」也用「${f.name}」，匯入後會一起換成這個檔案。要繼續嗎？`, "繼續"))) return;
    try { await storeModel(f, raw); } catch (err) {
      console.error(`BlockingPRO: 模型「${f.name}」無法存進瀏覽器`, err);
      return toast(`「${f.name}」無法存進瀏覽器：${err.message || err}`, "err", 8000);
    }
    const base = f.name.replace(MODEL_EXT, "");
    const slug = base.toLowerCase().replace(/[^a-z0-9_-]+/g, "_").replace(/^[^a-z]+/, "").slice(0, 34) || "model";
    const unit = guessUnit(raw), size = modelSize(raw, unit, 0);
    openAssetEditor(store, {
      id: uniqueAssetId(slug.length < 2 ? `model_${slug}` : slug, new Set(assetLib.assets.map((x) => x.id))),
      label: base.slice(0, 30) || "模型", cat: size[1] > 0.6 ? "furniture" : "small", color: "#c8c8c8",
      model: { file: f.name, unit, yaw: 0, size, look: "white" }, parts: [],
    }, { isNew: true });
  });
  document.body.append(input);
  input.click();
}

export function exportLibraryPack() {
  if (!assetLib.assets.length) return toast("素材庫還沒有自訂物品", "warn");
  const blob = new Blob([JSON.stringify(makeAssetPack(assetLib.assets, "BlockingPRO 自訂物品"), null, 1)], { type: "application/json" });
  downloadBlob(blob, `${safeName("自訂物品")}.blockingpro-assets.json`);
}
