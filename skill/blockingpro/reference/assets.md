<!-- 由 tools/gen_reference.py 產生，不要手改。改 runtime 後重跑：python tools/gen_reference.py -->

# 自訂物品格式

內建物品不夠用時，用簡單幾何零件組成自訂物品。和 BlockingPRO 內「提示詞教學」用的是同一份規則。

## 放在哪裡

- 專案用到的自訂物品寫在專案檔的 `assets` 陣列，`props[].type` 填物品的 `id`。專案檔自己就能開，換電腦也看得到。
- 也可以另外輸出物品包 `名稱.blockingpro-assets.json`：`{ "format": "blockingpro-assets", "version": 1, "assets": [ ... ] }`。和專案檔放同一個資料夾時，「開啟資料夾」會一起讀進來，並加入工具的素材庫。
- 開啟專案時，專案裡的自訂物品會自動加進工具的素材庫（同 id 同內容略過，內容不同會詢問）。

## 物品欄位

| 欄位 | 必填 | 說明 |
|---|---|---|
| id | 必填 | 物品代號。小寫英文字母開頭，只用小寫英文、數字、- 和 _，2 到 40 字，例如 recycle_bin。不能和內建物品同名。 |
| label | 必填 | 顯示名稱，最多 30 字，例如「分類回收桶」。 |
| cat | 必填 | 分類，五選一：furniture（家具）、building（建築）、vehicle（交通）、nature（自然）、small（小物）。 |
| color | 必填 | 主色，#rrggbb 六碼。零件的 color 寫 null 時用這個顏色，在場景裡改物品顏色也只會改這些零件。 |
| desc | 選填 | 一句說明，例如尺寸或用途。 |
| hold | 選填 | 可以拿在手上的物品才需要：{ "grip": [x, y, z], "rot": [x, y, z] }。grip 是物品上被握住的點（物品座標，公尺），rot 是握著時的旋轉（角度）。 |
| parts | 必填 | 零件陣列，1 到 300 個，建議 60 個以內。 |

id 規則（正規表示式）：`^[a-z][a-z0-9_-]{1,39}$`

## 零件欄位（parts 裡的每一項）

| 欄位 | 適用 | 說明 |
|---|---|---|
| shape | 全部 | 形狀：box（方塊）、cylinder（圓柱）、cone（圓錐）、sphere（球）、capsule（膠囊）、torus（圓環）。 |
| size | box | [寬 x, 高 y, 深 z]，公尺。 |
| radius | cylinder、cone、sphere、capsule、torus | 半徑，公尺。torus 是圓環中心線的半徑。 |
| radiusTop | cylinder（選填） | 頂面半徑，做杯子、燈罩這類上寬下窄的形狀。0 就是尖頂。 |
| height | cylinder、cone、capsule | 高度，公尺。capsule 是含兩端半球的總高。 |
| tube | torus | 圓環管子的半徑，公尺。 |
| arc | torus | 圓環角度 1 到 360，180 就是半圓（做把手、拱門）。 |
| pos | 全部 | 零件中心的位置 [x, y, z]，公尺。 |
| rot | 全部 | 零件旋轉 [x, y, z]，角度，依 X、Y、Z 順序。圓柱、圓錐、膠囊預設是直立的（沿 Y 軸），要躺平就轉 X 或 Z 90 度。 |
| scale | 選填 | [x, y, z] 縮放，例如把球壓扁成橢圓。 |
| color | 選填 | 零件顏色 #rrggbb。寫 null 或省略就跟著物品主色。 |
| glow | 選填 | 自發光強度 0 到 2，做燈泡、螢幕、招牌。 |
| opacity | 選填 | 透明度 0.05 到 1，做玻璃、水。 |

每個零件也可以有 `name`（零件名稱，只用來辨識）。

## 形狀與預設尺寸

| shape | 名稱 | 沒寫尺寸時的預設 |
|---|---|---|
| `box` | 方塊 | {"size": [0.3, 0.3, 0.3]} |
| `cylinder` | 圓柱 | {"radius": 0.1, "height": 0.3} |
| `cone` | 圓錐 | {"radius": 0.1, "height": 0.3} |
| `sphere` | 球 | {"radius": 0.1} |
| `capsule` | 膠囊 | {"radius": 0.05, "height": 0.3} |
| `torus` | 圓環 | {"radius": 0.15, "tube": 0.03, "arc": 360} |

## 手持旋轉 hold.rot 常用值

手的座標：手腕往指尖是 -Y。rot 是物品在手裡的旋轉（角度，依 X、Y、Z 順序）。

| rot | 用途 |
|---|---|
| [0, 0, 0] | 直立握（杯子、瓶子、手提物） |
| [90, 0, 0] | 朝手指方向（槍、手電筒、遙控器） |
| [180, 0, 0] | 往下垂（刀、棍子、球拍） |

## 注意事項

- 單位一律是公尺。一般人身高約 1.7，門高約 2.1，桌面高約 0.75，馬克杯高約 0.1。
- Y 軸朝上。原點（0, 0, 0）在物品底部的正中央，最低的零件底面要剛好在 y = 0。零件的 pos 是零件「中心」，所以高 0.8 的箱子放在地上時 pos 的 y 是 0.4。
- 物品的正面朝 +Z（朝向鏡頭的那一面）。椅子的椅背在 -Z，車頭朝 +Z。
- 吊燈、招牌這類懸掛物一樣把底部放在 y = 0，掛多高在場景裡調。
- id 不能和內建物品重複。內建物品有：table、chair、sofa、bed、bookshelf、tv、counter、desk、bench、fan、wall、door、window、stairs、steps、ramp、stage、elevator、building、fence、streetlight、car、bike、motorcycle、tree、bush、rock、box、baby、cup、phone、bag、book、umbrella、pistol、bat、marker。
- 顏色只能用 #rrggbb 六碼（例如 #2e7d32），不能用 #fff、red 或 rgb()。
- 這是預演用的示意模型，抓輪廓和比例就好，不用做細節。零件超過 80 個會提醒，上限 300 個。
- 拿在手上的物品要加 hold。rot 常用：[0, 0, 0] 直立握（杯子、瓶子、手提物）；[90, 0, 0] 朝手指方向（槍、手電筒、遙控器）；[180, 0, 0] 往下垂（刀、棍子、球拍）。grip 填物品上被握住那一點的座標。
- AI 回覆時常在 JSON 前後加說明或用 ``` 包起來，直接整段貼上就好，BlockingPRO 會自己挑出 JSON，也能容忍最後多一個逗號。
- 匯入後先看預覽：浮在空中、陷進地面、底面中心偏掉、尺寸看起來不對，編輯器會列出提醒。有錯誤時把錯誤訊息整段貼回給 AI，請它修正。

## 匯入的 3D 模型（model，只由編輯器產生）

編輯器素材庫「自訂」分頁的「匯入模型」可以把 GLB 或 OBJ 檔做成物品。這種物品的 `parts` 是空陣列 `[]`，另外有 `model` 欄位。SKILL 和聊天 AI 不要自己寫 `model`（AI 產生不了模型檔），讀到既有專案裡的模型物品時保留原樣即可。

| model 欄位 | 說明 |
|---|---|
| `file` | 模型檔名（.glb 或 .obj，不含資料夾）。檔案放在專案檔旁邊，檢查工具和「開啟資料夾」從那裡讀 |
| `unit` | 檔案裡 1 單位等於幾公尺：公尺 1、公分 0.01、毫米 0.001、英吋 0.0254 |
| `yaw` | 讓模型正面朝 +Z 要轉的角度 |
| `size` | 換算後的 [寬, 高, 深]（公尺），找不到模型檔時用這個尺寸畫半透明方塊 |
| `look` | `white`：白模，用物品主色；`original`：模型自己的材質 |

找不到模型檔時，編輯器和檢查工具都用半透明方塊代替並提醒，不算錯誤。骨架動畫不播放，只顯示模型的預設姿勢。

## 範例（物品包）

```json
{
  "format": "blockingpro-assets",
  "version": 1,
  "assets": [
    {
      "id": "recycle_bin",
      "label": "分類回收桶",
      "cat": "small",
      "color": "#2e7d32",
      "desc": "寬 45 公分、高 85 公分的戶外回收桶",
      "parts": [
        {"name": "桶身", "shape": "box", "size": [0.45, 0.8, 0.45], "pos": [0, 0.4, 0], "rot": [0, 0, 0], "color": null},
        {"name": "桶蓋", "shape": "box", "size": [0.48, 0.05, 0.48], "pos": [0, 0.825, 0], "rot": [0, 0, 0], "color": "#1b5e20"},
        {"name": "投入口", "shape": "box", "size": [0.25, 0.04, 0.02], "pos": [0, 0.7, 0.226], "rot": [0, 0, 0], "color": "#111111"},
        {"name": "標籤", "shape": "box", "size": [0.26, 0.16, 0.01], "pos": [0, 0.48, 0.23], "rot": [0, 0, 0], "color": "#ffffff"}
      ]
    },
    {
      "id": "tumbler",
      "label": "隨行保溫瓶",
      "cat": "small",
      "color": "#4f8fbf",
      "desc": "高 23 公分，可以拿在手上",
      "hold": {"grip": [0, 0.09, 0], "rot": [0, 0, 0]},
      "parts": [
        {"name": "瓶身", "shape": "cylinder", "radius": 0.035, "height": 0.2, "pos": [0, 0.1, 0], "rot": [0, 0, 0], "color": null},
        {"name": "瓶蓋", "shape": "cylinder", "radius": 0.037, "height": 0.03, "pos": [0, 0.215, 0], "rot": [0, 0, 0], "color": "#333333"}
      ]
    }
  ]
}
```
