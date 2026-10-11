<!-- 由 tools/gen_reference.py 產生，不要手改。改 runtime 後重跑：python tools/gen_reference.py -->

# BlockingPRO 名錄

專案 JSON 裡所有可用的代號都列在這裡。代號一律用英文 key（表格第一欄），中文只是說明。

## 場景設定 settings

| 欄位 | 預設 | 說明 |
|---|---|---|
| width / height | 1280 / 720 | 輸出解析度。參考影片建議 1280x720 或 720x1280，各模型限制見目標模型表 |
| fps | 30 | 每秒格數，1 到 120 |
| duration | 8 | 總長（秒）。超過目標模型上限時，輸出可自動分段 |
| target | "seedance-2.0" | 要交給哪個 AI 影片模型，決定輸出時的長度、解析度、fps 警告與分段長度，見下表 |
| lighting | day | 燈光預設，見下表 |
| background | null | 背景色 #rrggbb；null 用燈光預設的背景 |
| ground | {"show": true, "grid": true, "color": "#5a606b"} | 地面：show 顯示、grid 格線、color 顏色 |
| display | null | 全場顯示方式覆寫：`white` 白模、`joints` 關節、`both` 白模＋關節；null 依各角色設定 |
| look | null | 白模外觀：`clay` 陶土色、`wire` 線框、`toon` 卡通描邊、`deep` 依角色顏色加深；null 是預設的白色材質 |
| letterbox | null | 遮幅：`"2.39"` 或 `"1.85"`（字串），導演台畫上下黑邊，輸出 MP4 可選擇保留；null 不加 |
| markers | [] | 時間軸標記 `[{ "t": 2, "label": "轉身" }]`，只在編輯器顯示，用來標節拍 |

## 目標模型 settings.target

規格依 2026-10-10 查到的文件（來源見 BlockingPRO 的 docs/dev-log.md），平台改版後可能過時。短邊上限是建議值，超過只警告；短邊下限低於會被平台拒絕。

| 代號 | 名稱 | 參考影片長度（秒） | 短邊 | fps | 說明 |
|---|---|---|---|---|---|
| `seedance-2.0` | Seedance 2.0 | 2 到 15 | 300 到 720 | 24 到 60 | 參考影片單段 2 到 15 秒、720p 以內（API 可到 6000 px，網頁版限制未確認）；不接受寫實人臉 |
| `seedance-2.5` | Seedance 2.5 | 2 到 30 | 300 到 1080 | 24 到 60 | 參考影片單段 2 到 30 秒，輸出最高 1080p、24 fps |
| `kling-3.0-omni` | Kling 3.0 Omni | 3 到 10 | 700 到 1080 | 24 到 60 | 網頁版參考影片 3 到 10 秒（API 寫 15.5 秒）；短邊至少 700，480p 會被拒絕 |
| `kling-motion` | Kling 動作控制 | 3 到 30 | 340 到 1080 | 24 到 60 | 只學單一角色的動作，運鏡和剪接不會帶過去；請只輸出一台攝影機、不剪接 |
| `veo-3.1` | Veo 3.1 | 不收影片 |  |  | 不接受上傳影片當參考，請改用首尾格 PNG（首幀圖）；輸出 4、6、8 秒 |
| `runway-aleph` | Runway Aleph | 2 到 30 | 480 到 1080 | 24 到 30 | 參考影片 2 到 30 秒、480p 到 1080p、24 到 30 fps，輸出長度和參考影片相同 |

## 燈光預設 settings.lighting

| 代號 | 名稱 | 預設背景 |
|---|---|---|
| `day` | 白天 | #9fb3c8 |
| `overcast` | 陰天 | #a7adb4 |
| `sunset` | 黃昏 | #e4a074 |
| `night` | 夜景 | #141a2a |
| `indoor` | 室內 | #3a3631 |
| `studio` | 三點打光 | #2a2f38 |
| `neutral` | 灰階中性 | #2a2f38 |

## 緩動 e（每個關鍵影格的 e 決定「從這一格到下一格」怎麼變化）

| 代號 | 名稱 |
|---|---|
| `linear` | 等速 |
| `in` | 漸快 |
| `out` | 漸慢 |
| `inOut` | 慢快慢 |
| `hold` | 停格 |

自訂速度曲線：`e` 也可以寫四個數字 `[x1, y1, x2, y2]`，和 CSS cubic-bezier 相同（x 在 0 到 1；y 超出 0 到 1 會先超過再拉回）。例如 `[0.7, 0, 0.3, 1]` 是比 inOut 更強的慢起慢停。

## 人物體型 actors[].preset（kind: "human"）

| 代號 | 名稱 | 身高（公尺） |
|---|---|---|
| `man` | 成年男性 | 1.78 |
| `woman` | 成年女性 | 1.65 |
| `child` | 兒童 | 1.2 |
| `elder` | 長者 | 1.66 |
| `bulky` | 壯漢 | 1.86 |

## 人物關節（擺姿勢 pose.rot、附著 attach.joint 用）

`hips`、`spine`、`chest`、`neck`、`head`、`lUpperArm`、`lForeArm`、`lHand`、`rUpperArm`、`rForeArm`、`rHand`、`lThigh`、`lShin`、`lFoot`、`rThigh`、`rShin`、`rFoot`

上半身動作只會動這些關節：`spine`、`chest`、`neck`、`head`、`lUpperArm`、`lForeArm`、`lHand`、`rUpperArm`、`rForeArm`、`rHand`。
l 開頭是角色自己的左邊，r 開頭是右邊。小物預設放在 `rHand`。

## 人物動作 actions[] / upper[] 的 type

軌道欄是 `upper` 的動作放在 `upper` 陣列，可以疊在走路上；`actions` 的是全身動作。「結束後」是片段結束時的預設行為（片段可用 `hold` 覆寫）：停在最後姿勢，或淡回走路／待機。

| type | 名稱 | 軌道 | 預設秒數 | 循環 | 結束後 | params |
|---|---|---|---|---|---|---|
| `idle` | 待機 | actions | 4 | 循環 | 淡回 | `breathe` 呼吸幅度，0 到 3，預設 1；`style` 風格，可用 normal（一般）、tired（疲累）、hurried（急促）、relaxed（悠閒），預設 normal |
| `walk` | 走路 | actions | 4 | 循環 | 淡回 | `stride` 步幅，0.4 到 1.2，預設 0.8；`swing` 擺臂，0 到 2，預設 1；`style` 風格，可用 normal（一般）、tired（疲累）、hurried（急促）、relaxed（悠閒），預設 normal；`amp` 動作幅度，0.5 到 1.5，預設 1 |
| `run` | 跑步 | actions | 3 | 循環 | 淡回 | `stride` 步幅，0.8 到 2.2，預設 1.5；`lean` 前傾角度，0 到 30，預設 12；`style` 風格，可用 normal（一般）、tired（疲累）、hurried（急促）、relaxed（悠閒），預設 normal；`amp` 動作幅度，0.5 到 1.5，預設 1 |
| `sneak` | 潛行 | actions | 4 | 循環 | 淡回 | `stride` 步幅，0.3 到 0.9，預設 0.55 |
| `sit` | 坐下 | actions | 1.5 | 單次 | 停住 | `seat` 座高（公尺），0.25 到 0.75，預設 0.45 |
| `sitting` | 坐著 | actions | 4 | 循環 | 停住 | `seat` 座高（公尺），0.25 到 0.75，預設 0.45；`breathe` 呼吸幅度，0 到 3，預設 1 |
| `standUp` | 起身 | actions | 1.6 | 單次 | 淡回 | `seat` 座高（公尺），0.25 到 0.75，預設 0.45 |
| `crouch` | 蹲下 | actions | 1.5 | 單次 | 停住 | 無 |
| `kneel` | 跪下 | actions | 1.8 | 單次 | 停住 | 無 |
| `lie` | 躺著 | actions | 4 | 循環 | 停住 | `breathe` 呼吸幅度，0 到 3，預設 1 |
| `fall` | 跌倒 | actions | 2 | 單次 | 停住 | 無 |
| `jump` | 跳躍 | actions | 1.6 | 單次 | 淡回 | `height` 跳躍高度（公尺），0.1 到 1，預設 0.4 |
| `bow` | 鞠躬 | actions | 2.5 | 單次 | 淡回 | `angle` 鞠躬角度，10 到 80，預設 45 |
| `punch` | 出拳 | actions | 1 | 循環 | 淡回 | `rate` 每秒出拳次數，0.5 到 3，預設 1 |
| `kick` | 踢 | actions | 1.4 | 單次 | 淡回 | `height` 踢腿高度（公尺），0.3 到 1.4，預設 0.9 |
| `pickUp` | 撿起 | actions | 2.4 | 單次 | 淡回 | 無 |
| `push` | 推 | actions | 2 | 單次 | 淡回 | 無 |
| `dance` | 跳舞 | actions | 4.4 | 循環 | 淡回 | `bpm` 節拍（BPM），60 到 160，預設 110 |
| `cheer` | 歡呼 | actions | 2 | 循環 | 淡回 | `rate` 彈跳頻率，1 到 3，預設 2 |
| `wave` | 揮手 | upper | 2 | 循環 | 淡回 | `rate` 揮動頻率，0.5 到 4，預設 2 |
| `point` | 指向 | upper | 2 | 單次 | 淡回 | 無 |
| `talk` | 說話手勢 | upper | 4 | 循環 | 淡回 | `energy` 手勢幅度，0 到 2，預設 1 |
| `phone` | 講電話 | upper | 3 | 單次 | 淡回 | 無 |
| `clap` | 拍手 | upper | 2 | 循環 | 淡回 | `rate` 每秒拍手次數，1 到 5，預設 2.5 |
| `lookAround` | 張望 | upper | 4 | 循環 | 淡回 | `period` 來回秒數，2 到 8，預設 4 |
| `armsCrossed` | 雙手抱胸 | upper | 3 | 單次 | 淡回 | 無 |
| `handsUp` | 舉手投降 | upper | 3 | 單次 | 淡回 | 無 |
| `drink` | 喝東西 | upper | 4 | 循環 | 淡回 | 無 |
| `carry` | 抱物 | upper | 3 | 單次 | 淡回 | `ready` 一開始就抱著（1），0 到 1，預設 0 |
| `think` | 思考 | upper | 3 | 單次 | 淡回 | 無 |
| `shrug` | 聳肩 | upper | 1.2 | 單次 | 淡回 | 無 |
| `handshake` | 握手（雙人） | actions | 3 | 單次 | 淡回 | `with` 對象（填另一個角色的 id）；`rate` 每秒上下次數，0 到 4，預設 2 |
| `hug` | 擁抱（雙人） | actions | 3.5 | 單次 | 淡回 | `with` 對象（填另一個角色的 id） |
| `give` | 遞出（雙人） | actions | 2.4 | 單次 | 淡回 | `with` 對象（填另一個角色的 id） |
| `receive` | 接過（雙人） | actions | 2.4 | 單次 | 淡回 | `with` 對象（填另一個角色的 id） |
| `openDoor` | 開門 | upper | 2.5 | 單次 | 淡回 | `push` 推門（1）或拉門（0），0 到 1，預設 1 |
| `typing` | 打字 | upper | 4 | 循環 | 淡回 | `rate` 每秒敲鍵次數，1 到 8，預設 4 |
| `lookPhone` | 看手機 | upper | 4 | 單次 | 淡回 | 無 |
| `liftBox` | 搬起箱子 | actions | 2.4 | 單次 | 淡回 | 無 |
| `putDown` | 放下箱子 | actions | 2.4 | 單次 | 淡回 | 無 |
| `holdChild` | 抱小孩 | upper | 4 | 單次 | 淡回 | `rock` 搖晃幅度，0 到 2，預設 1 |
| `ride` | 騎車 | actions | 4 | 循環 | 淡回 | `vehicle` 車種，可用 motorcycle（機車）、bike（腳踏車），預設 motorcycle |

## 動物 actors[].preset（kind: "animal"）

| 代號 | 名稱 | 腳 | 肩高（公尺） | 全高（公尺） | 關節 |
|---|---|---|---|---|---|
| `dog` | 狗 | 4 | 0.55 | 0.62 | body、spine、chest、neck、head、tail1、tail2、tail3、lFrontUpper、lFrontLower、lFrontFoot、lBackUpper、lBackLower、lBackFoot、rFrontUpper、rFrontLower、rFrontFoot、rBackUpper、rBackLower、rBackFoot |
| `cat` | 貓 | 4 | 0.25 | 0.3 | body、spine、chest、neck、head、tail1、tail2、tail3、lFrontUpper、lFrontLower、lFrontFoot、lBackUpper、lBackLower、lBackFoot、rFrontUpper、rFrontLower、rFrontFoot、rBackUpper、rBackLower、rBackFoot |
| `horse` | 馬 | 4 | 1.6 | 2.21 | body、spine、chest、neck、head、tail1、tail2、tail3、lFrontUpper、lFrontLower、lFrontFoot、lBackUpper、lBackLower、lBackFoot、rFrontUpper、rFrontLower、rFrontFoot、rBackUpper、rBackLower、rBackFoot |
| `bird` | 鳥 | 2 | 0.2 | 0.28 | body、neck、head、tail、lWing、lWingTip、lLeg、lShank、lFoot、rWing、rWingTip、rLeg、rShank、rFoot |
| `rabbit` | 兔 | 4 | 0.18 | 0.24 | body、spine、chest、neck、head、tail1、tail2、tail3、lFrontUpper、lFrontLower、lFrontFoot、lBackUpper、lBackLower、lBackFoot、rFrontUpper、rFrontLower、rFrontFoot、rBackUpper、rBackLower、rBackFoot |
| `cow` | 牛 | 4 | 1.4 | 1.46 | body、spine、chest、neck、head、tail1、tail2、tail3、lFrontUpper、lFrontLower、lFrontFoot、lBackUpper、lBackLower、lBackFoot、rFrontUpper、rFrontLower、rFrontFoot、rBackUpper、rBackLower、rBackFoot |
| `sheep` | 羊 | 4 | 0.75 | 0.92 | body、spine、chest、neck、head、tail1、tail2、tail3、lFrontUpper、lFrontLower、lFrontFoot、lBackUpper、lBackLower、lBackFoot、rFrontUpper、rFrontLower、rFrontFoot、rBackUpper、rBackLower、rBackFoot |
| `chicken` | 雞 | 2 | 0.31 | 0.43 | body、neck、head、tail、lWing、lWingTip、lLeg、lShank、lFoot、rWing、rWingTip、rLeg、rShank、rFoot |
| `duck` | 鴨 | 2 | 0.24 | 0.36 | body、neck、head、tail、lWing、lWingTip、lLeg、lShank、lFoot、rWing、rWingTip、rLeg、rShank、rFoot |

## 動物動作 actions[] 的 type（動物沒有 upper 軌）

| type | 名稱 | 適用 | 預設秒數 | 循環 | params |
|---|---|---|---|---|---|
| `idle` | 待機 | dog、cat、horse、rabbit、cow、sheep、bird、chicken、duck | 4 | 循環 | `breathe` 呼吸幅度，0 到 3，預設 1 |
| `walk` | 走路 | dog、cat、horse、rabbit、cow、sheep、bird、chicken、duck | 4 | 循環 | `stride` 步幅倍率，0.6 到 1.4，預設 1 |
| `run` | 奔跑 | dog、cat、horse、rabbit、cow、sheep、bird、chicken、duck | 3 | 循環 | `stride` 步幅倍率，0.6 到 1.4，預設 1 |
| `sit` | 坐下 | dog、cat | 1.5 | 單次 | 無 |
| `lie` | 趴下 | dog、cat、horse、rabbit、cow、sheep | 2 | 單次 | 無 |
| `eat` | 低頭吃 | dog、cat、horse、rabbit、cow、sheep、bird、chicken、duck | 4 | 循環 | `rate` 進食頻率，0.5 到 2，預設 1 |
| `jump` | 跳躍 | dog、cat、rabbit | 1.2 | 單次 | `height` 跳躍高度倍率，0.3 到 2，預設 1 |
| `fly` | 飛行 | bird、chicken、duck | 4 | 循環 | `freq` 拍翅頻率（次/秒），2 到 10，預設 5 |
| `glide` | 滑翔 | bird、duck | 4 | 循環 | `bank` 側傾幅度（度），0 到 20，預設 4 |
| `wagTail` | 搖尾巴 | dog | 3 | 循環 | `rate` 搖動頻率（次/秒），1 到 6，預設 3 |
| `rear` | 抬前腿 | horse | 3 | 單次 | `angle` 抬身角度，25 到 65，預設 50 |

## 自動步態（autoGait: true 時依路徑速度自動切換）

速度在 walk 區間內從待機淡入走路，在 run 區間內從走路淡入跑步（公尺/秒）。路徑兩個關鍵影格的距離除以時間差就是速度：人走路約 1.2 到 1.5，跑步 3 以上。

| 對象 | 走路區間 | 跑步區間 |
|---|---|---|
| human | 0.1 到 0.5 | 2.2 到 3 |
| dog | 0.1 到 0.4 | 1.6 到 2.4 |
| cat | 0.05 到 0.3 | 1 到 1.6 |
| horse | 0.2 到 0.8 | 2.5 到 4 |
| bird | 0.05 到 0.25 | 0.8 到 1.4 |
| rabbit | 0.05 到 0.25 | 0.8 到 1.4 |
| cow | 0.15 到 0.6 | 2 到 3 |
| sheep | 0.1 到 0.45 | 1.5 到 2.3 |
| chicken | 0.05 到 0.3 | 0.9 到 1.5 |
| duck | 0.05 到 0.25 | 0.7 到 1.2 |

## 內建物品 props[].type

尺寸是 scale 1 時實際量到的外框（寬 x 高 x 深，公尺；寬沿 X、深沿 Z，正面朝 +Z）。可手持的物品附著到手上時會自動套用握法。可行走的物品，角色路徑走上去時身體和腳會踩在表面上（見 format.md「可行走的物品」）。備註寫「state」的物品可以用 state 關鍵影格做開關或轉速動畫；汽車、機車、腳踏車的車輪自動滾動（見 format.md「物品動畫」）。內建物品以外的類型要寫在專案的 `assets` 裡，見 assets.md。

### 家具（furniture）

| type | 名稱 | 寬 x 高 x 深 | 備註 |
|---|---|---|---|
| `table` | 桌子 | 1.4 x 0.75 x 0.8 |  |
| `chair` | 椅子 | 0.44 x 0.92 x 0.44 |  |
| `sofa` | 沙發 | 2 x 0.85 x 0.9 |  |
| `bed` | 床 | 1.72 x 1.05 x 2.21 |  |
| `bookshelf` | 書櫃 | 0.9 x 1.9 x 0.32 |  |
| `tv` | 電視 | 1.6 x 1.29 x 0.41 |  |
| `counter` | 吧台 | 2.1 x 1.05 x 0.72 |  |
| `desk` | 辦公桌 | 1.4 x 1.22 x 0.7 |  |
| `bench` | 長椅 | 1.6 x 0.91 x 0.61 |  |
| `fan` | 電風扇 | 0.49 x 1.36 x 0.38 | state：轉速 |

### 建築（building）

| type | 名稱 | 寬 x 高 x 深 | 備註 |
|---|---|---|---|
| `wall` | 牆 | 4 x 2.8 x 0.17 |  |
| `door` | 門 | 1.02 x 2.16 x 0.2 | state：開門 |
| `window` | 窗戶 | 1.32 x 1.24 x 0.2 |  |
| `stairs` | 樓梯 | 1 x 2.32 x 2.52 | 可行走 |
| `steps` | 台階 | 1.2 x 0.61 x 1.2 | 可行走 |
| `ramp` | 斜坡 | 1.2 x 0.51 x 3 | 可行走 |
| `stage` | 舞台 | 4.01 x 0.61 x 3 | 可行走 |
| `elevator` | 電梯 | 2 x 2.4 x 1.61 | 可行走、state：電梯門 |
| `building` | 建築物 | 12.12 x 10 x 9.26 |  |
| `fence` | 圍欄 | 2.52 x 1.08 x 0.12 |  |
| `streetlight` | 路燈 | 0.34 x 4.56 x 1.7 |  |

### 交通（vehicle）

| type | 名稱 | 寬 x 高 x 深 | 備註 |
|---|---|---|---|
| `car` | 汽車 | 2 x 1.47 x 4.56 |  |
| `bike` | 腳踏車 | 0.64 x 1 x 1.78 |  |
| `motorcycle` | 機車 | 0.7 x 1.34 x 1.81 |  |

### 自然（nature）

| type | 名稱 | 寬 x 高 x 深 | 備註 |
|---|---|---|---|
| `tree` | 樹 | 3.55 x 5.25 x 3.1 |  |
| `bush` | 灌木 | 1.6 x 0.88 x 1.42 |  |
| `rock` | 石頭 | 0.98 x 0.61 x 0.79 |  |

### 小物（small）

| type | 名稱 | 寬 x 高 x 深 | 備註 |
|---|---|---|---|
| `box` | 紙箱 | 0.45 x 0.45 x 0.46 | 可手持 |
| `baby` | 嬰兒 | 0.2 x 0.14 x 0.46 | 可手持 |
| `cup` | 杯子 | 0.1 x 0.14 x 0.1 | 可手持 |
| `phone` | 手機 | 0.07 x 0.15 x 0.01 | 可手持 |
| `bag` | 包包 | 0.34 x 0.34 x 0.13 | 可手持 |
| `book` | 書 | 0.16 x 0.23 x 0.03 | 可手持 |
| `umbrella` | 雨傘 | 1.04 x 0.99 x 1.04 | 可手持 |
| `pistol` | 手槍 | 0.03 x 0.15 x 0.21 | 可手持 |
| `bat` | 球棒 | 0.06 x 0.84 x 0.07 | 可手持 |
| `marker` | 地面標記 | 0.7 x 0.01 x 0.7 |  |

## 鏡頭焦距 cameras[].lens（毫米，全片幅，長邊 36 mm）

| 焦距 | 水平視角（16:9） | 常見用途 |
|---|---|---|
| 14 | 104 度 | 極廣角，空間誇張 |
| 18 | 90 度 | 廣角，室內全景 |
| 24 | 74 度 | 廣角，大場面、環境 |
| 35 | 54 度 | 標準偏廣，一般敘事（預設） |
| 50 | 40 度 | 標準，接近人眼 |
| 85 | 24 度 | 人像特寫 |
| 135 | 15 度 | 長焦，壓縮背景、偷拍感 |

## 晃動樣式 cameras[].shakeStyle（搭配 shake 強度）

shake 是強度（0 不晃），shakeStyle 決定晃的樣子，預設 `handheld`。shake 不能放關鍵影格，整台攝影機全程同一種晃法。

| 代號 | 名稱 |
|---|---|
| `handheld` | 手持 |
| `walk` | 手持走路 |
| `breathe` | 呼吸微晃 |
| `vehicle` | 車上震動 |
| `impact` | 衝擊震動 |

## 編輯器的運鏡產生器（參考）

編輯器素材庫「攝影機」分頁可一鍵產生下列運鏡。專案 JSON 裡沒有運鏡代號，要直接寫攝影機的 path / aim / mount / lens 關鍵影格；寫法見 SKILL.md 的「運鏡配方」。

| 名稱 | 需要角色 |
|---|---|
| 固定機位 |  |
| 推軌（推近） |  |
| 拉軌（拉遠） |  |
| 橫移 |  |
| 搖鏡（水平） |  |
| 搖鏡（仰俯） |  |
| 環繞 |  |
| 升降（升起） |  |
| 跟拍（背後） | 是 |
| 跟拍（側面） | 是 |
| 手持晃動 |  |
| 希區考克變焦 |  |
| 鳥瞰 |  |
| 低角度仰拍 |  |
| 甩鏡 |  |
| 荷蘭角（傾斜） |  |
| 螺旋上升 |  |
| 穿越前景 |  |
| 推軌加變焦 |  |
