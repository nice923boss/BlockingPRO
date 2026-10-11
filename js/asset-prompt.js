// Text for making custom props with any chat AI (no SKILL needed): field tables, cautions, the copyable prompt and examples.
// The in-app guide (asset-dialogs.js) and tools/gen_reference.py both read from here, so the two never drift apart.
import { PROPS, PROP_CATS } from "../runtime/props.js";
import { ASSET_SHAPES, HOLD_PRESETS, ASSET_PACK_FORMAT, MAX_PARTS } from "../runtime/assets.js";

export const BUILTIN_IDS = Object.keys(PROPS);
const cats = Object.entries(PROP_CATS).map(([k, v]) => `${k}（${v}）`).join("、");
const holds = Object.values(HOLD_PRESETS).map((p) => `[${p.rot.join(", ")}] ${p.label}`).join("；");

/** [field, required, explanation] for one asset. */
export const ASSET_FIELDS = [
  ["id", "必填", "物品代號。小寫英文字母開頭，只用小寫英文、數字、- 和 _，2 到 40 字，例如 recycle_bin。不能和內建物品同名。"],
  ["label", "必填", "顯示名稱，最多 30 字，例如「分類回收桶」。"],
  ["cat", "必填", `分類，五選一：${cats}。`],
  ["color", "必填", "主色，#rrggbb 六碼。零件的 color 寫 null 時用這個顏色，在場景裡改物品顏色也只會改這些零件。"],
  ["desc", "選填", "一句說明，例如尺寸或用途。"],
  ["hold", "選填", "可以拿在手上的物品才需要：{ \"grip\": [x, y, z], \"rot\": [x, y, z] }。grip 是物品上被握住的點（物品座標，公尺），rot 是握著時的旋轉（角度）。"],
  ["parts", "必填", `零件陣列，1 到 ${MAX_PARTS} 個，建議 60 個以內。`],
];

/** [field, applies to, explanation] for one part. */
export const PART_FIELDS = [
  ["shape", "全部", `形狀：${Object.entries(ASSET_SHAPES).map(([k, v]) => `${k}（${v.label}）`).join("、")}。`],
  ["size", "box", "[寬 x, 高 y, 深 z]，公尺。"],
  ["radius", "cylinder、cone、sphere、capsule、torus", "半徑，公尺。torus 是圓環中心線的半徑。"],
  ["radiusTop", "cylinder（選填）", "頂面半徑，做杯子、燈罩這類上寬下窄的形狀。0 就是尖頂。"],
  ["height", "cylinder、cone、capsule", "高度，公尺。capsule 是含兩端半球的總高。"],
  ["tube", "torus", "圓環管子的半徑，公尺。"],
  ["arc", "torus", "圓環角度 1 到 360，180 就是半圓（做把手、拱門）。"],
  ["pos", "全部", "零件中心的位置 [x, y, z]，公尺。"],
  ["rot", "全部", "零件旋轉 [x, y, z]，角度，依 X、Y、Z 順序。圓柱、圓錐、膠囊預設是直立的（沿 Y 軸），要躺平就轉 X 或 Z 90 度。"],
  ["scale", "選填", "[x, y, z] 縮放，例如把球壓扁成橢圓。"],
  ["color", "選填", "零件顏色 #rrggbb。寫 null 或省略就跟著物品主色。"],
  ["glow", "選填", "自發光強度 0 到 2，做燈泡、螢幕、招牌。"],
  ["opacity", "選填", "透明度 0.05 到 1，做玻璃、水。"],
];

export const CAUTIONS = [
  "單位一律是公尺。一般人身高約 1.7，門高約 2.1，桌面高約 0.75，馬克杯高約 0.1。",
  "Y 軸朝上。原點（0, 0, 0）在物品底部的正中央，最低的零件底面要剛好在 y = 0。零件的 pos 是零件「中心」，所以高 0.8 的箱子放在地上時 pos 的 y 是 0.4。",
  "物品的正面朝 +Z（朝向鏡頭的那一面）。椅子的椅背在 -Z，車頭朝 +Z。",
  "吊燈、招牌這類懸掛物一樣把底部放在 y = 0，掛多高在場景裡調。",
  `id 不能和內建物品重複。內建物品有：${BUILTIN_IDS.join("、")}。`,
  "顏色只能用 #rrggbb 六碼（例如 #2e7d32），不能用 #fff、red 或 rgb()。",
  "這是預演用的示意模型，抓輪廓和比例就好，不用做細節。零件超過 80 個會提醒，上限 300 個。",
  `拿在手上的物品要加 hold。rot 常用：${holds}。grip 填物品上被握住那一點的座標。`,
  "AI 回覆時常在 JSON 前後加說明或用 ``` 包起來，直接整段貼上就好，BlockingPRO 會自己挑出 JSON，也能容忍最後多一個逗號。",
  "匯入後先看預覽：浮在空中、陷進地面、底面中心偏掉、尺寸看起來不對，編輯器會列出提醒。有錯誤時把錯誤訊息整段貼回給 AI，請它修正。",
];

export const EXAMPLE_ASSETS = [
  {
    id: "recycle_bin", label: "分類回收桶", cat: "small", color: "#2e7d32", desc: "寬 45 公分、高 85 公分的戶外回收桶",
    parts: [
      { name: "桶身", shape: "box", size: [0.45, 0.8, 0.45], pos: [0, 0.4, 0], rot: [0, 0, 0], color: null },
      { name: "桶蓋", shape: "box", size: [0.48, 0.05, 0.48], pos: [0, 0.825, 0], rot: [0, 0, 0], color: "#1b5e20" },
      { name: "投入口", shape: "box", size: [0.25, 0.04, 0.02], pos: [0, 0.7, 0.226], rot: [0, 0, 0], color: "#111111" },
      { name: "標籤", shape: "box", size: [0.26, 0.16, 0.01], pos: [0, 0.48, 0.23], rot: [0, 0, 0], color: "#ffffff" },
    ],
  },
  {
    id: "tumbler", label: "隨行保溫瓶", cat: "small", color: "#4f8fbf", desc: "高 23 公分，可以拿在手上",
    hold: { grip: [0, 0.09, 0], rot: [0, 0, 0] },
    parts: [
      { name: "瓶身", shape: "cylinder", radius: 0.035, height: 0.2, pos: [0, 0.1, 0], rot: [0, 0, 0], color: null },
      { name: "瓶蓋", shape: "cylinder", radius: 0.037, height: 0.03, pos: [0, 0.215, 0], rot: [0, 0, 0], color: "#333333" },
    ],
  },
];

export const EXAMPLE_PACK = { format: ASSET_PACK_FORMAT, version: 1, assets: EXAMPLE_ASSETS };

export const DESC_EXAMPLES = [
  "一台太陽能板，傾斜 30 度裝在支架上，約 1.6 x 1 公尺",
  "電動機車，車頭朝 +Z，座墊高 0.75 公尺",
  "一支可以拿在手上的麥克風",
  "辦公室的電腦螢幕和鍵盤（放在桌上用，不含桌子）",
  "一棵盆栽，陶盆加三片大葉子",
];

const list = (rows) => rows.map(([k, req, d]) => `- ${k}（${req}）：${d}`).join("\n");

/** The full prompt to paste into ChatGPT, Claude, Gemini or another chat AI. */
export function buildAssetPrompt(desc) {
  const want = String(desc || "").trim() || "（在這裡寫要做的物品，例如：一台太陽能板，傾斜 30 度裝在支架上）";
  return `你是 3D 示意模型的建模助手。請把我描述的物品，用簡單幾何零件組成，輸出成 BlockingPRO 可以匯入的 JSON。

## 要做的物品
${want}

## 輸出規則
- 只輸出一個 \`\`\`json 程式碼區塊，區塊外不要寫說明。
- 最外層固定用這個格式（一個或多個物品都一樣）：
  { "format": "${ASSET_PACK_FORMAT}", "version": 1, "assets": [ 物品, 物品... ] }
- JSON 要合法：用雙引號、不要註解、最後一項後面不要逗號。

## 座標與單位
${CAUTIONS.slice(0, 4).map((c) => `- ${c}`).join("\n")}

## 物品欄位
${list(ASSET_FIELDS)}

## 零件欄位
${list(PART_FIELDS)}

## 其他規則
${CAUTIONS.slice(4, 8).map((c) => `- ${c}`).join("\n")}

## 範例
\`\`\`json
${JSON.stringify(EXAMPLE_PACK, null, 1)}
\`\`\`

## 輸出前自我檢查
1. 每個零件的最低點都不低於 y = 0，而且至少一個零件剛好貼地。
2. 物品底面的中心在 x = 0、z = 0 附近，正面朝 +Z。
3. 尺寸是真實比例（公尺），和一個 1.7 公尺的人比起來合理。
4. 所有顏色都是 #rrggbb 六碼，id 沒有和內建物品重複。`;
}
