# BlockingPRO

給 Seedance 等 AI 影片模型做參考畫面的 3D 預演（blocking）編輯器。用程序化白模擺角色、動物、物品與燈光，設定移動路徑、動作、多機位運鏡與剪接，在導演台看剪好的畫面，輸出 MP4。另附 Claude SKILL，能把故事寫成可直接在編輯器開啟的專案資料夾。

**線上版（免安裝）：<https://nice923boss.github.io/BlockingPRO/>**，用 Chrome 或 Edge 打開即可使用。

## 線上版與本機版的差別

| 項目 | 線上版（GitHub Pages） | 本機版 |
|---|---|---|
| 編輯、範例、開啟檔案或資料夾、輸出 MP4 與 PNG、瀏覽器自動暫存 | 可以 | 可以 |
| 自訂物品庫、姿勢庫 | 存在這個瀏覽器（localStorage），換瀏覽器、換電腦或清除網站資料就不見；自訂物品可用素材庫的「匯出」備份，姿勢庫沒有匯出 | 存在 `library/assets.json`、`library/poses.json` |
| 網址 `?project=projects/<名稱>` 直接開資料夾 | 不行，改用「開啟資料夾」 | 可以 |
| SKILL 與 `tools/` 檢查工具 | 不行（需要本機 Python） | 可以 |

## 啟動（本機版）

1. 下載：`git clone https://github.com/nice923boss/BlockingPRO.git`，或在 GitHub 按 Code → Download ZIP。three.js、mediabunny、gifenc 放在 `vendor/`，之後不需要網路。
2. 從 [Releases](https://github.com/nice923boss/BlockingPRO/releases) 下載 `BlockingPRO.exe` 放進 BlockingPRO 資料夾後雙擊（不需要 Python），或有 Python 3 時雙擊 `start.bat`，瀏覽器會開 `http://127.0.0.1:38940/index.html`。關掉黑色視窗或執行 `stop.bat` 停止。exe 要留在 BlockingPRO 資料夾裡；第一次執行若被 Windows SmartScreen 擋下（exe 沒有數位簽章），按「其他資訊」再按「仍要執行」。
3. 用 Chrome 或 Edge（MP4 輸出需要 WebCodecs）。不要直接雙擊 `index.html`。

## 功能

| 區塊 | 內容 |
|---|---|
| 素材庫（左） | 人物 5 種體型、動物 9 種、內建物品 37 種、自訂物品、場景模板 6 種（客廳、辦公室、教室、街道、公園、咖啡店，一鍵放好牆面、門窗與家具）、攝影機（固定機位與 18 種運鏡產生器）、燈光預設 7 種與聚光燈、點光源、動作清單、範例專案 |
| 3D 視窗 | 透視與俯視、拖曳移動、Shift + 點地面加路徑點、對準選取、自動關鍵影格、吸附、工具選單「加入路人群…」（指定人數與區域，產生隨機走動的背景路人並放進同一群組）、「畫牆」（俯視圖點地面放牆角，點回第一個牆角封成房間，Enter 或再點最後一個牆角結束）、「在牆上開門／開窗」（點整片牆，在點的位置切出開口放門窗）；呈現方式：白模、關節、白模＋關節 |
| 導演台 | 依剪接軌顯示成片（PGM），下方多機位小畫面，可切換看單一攝影機 |
| 時間軸 | 剪接軌（點擊編輯剪接時間與說明）、每台攝影機與每個角色的關鍵影格、每段速度（公尺/秒）、動作片段 |
| 屬性（右） | 場景設定（解析度、長度、影格率、燈光、地面）、選取物件的位置、方向、運鏡、動作、檢查訊息；門、電風扇、電梯的開關與轉速動畫（車輪、腳踏車曲柄自動轉，限制見 `GAPS.md` G037） |
| 擺姿勢 | 選取人物後「在目前時間擺姿勢」，點關節旋轉，存成姿勢片段；可存進姿勢庫（`library/poses.json`，所有專案共用），套用到其他角色 |
| 輸出 | 下載 MP4（節目或單一攝影機、整段或區間）、分鏡表 PNG、平面圖 PNG；MP4 對話框勾「輸出成分享用 HTML」，影片、鏡頭表和字幕包成一個網頁檔，對方用瀏覽器打開就能播，點鏡頭表跳到那一鏡（限制見 `GAPS.md` G044） |
| 存檔 | 儲存下載 `<名稱>.blockingpro.json`；開啟單檔或整個資料夾；瀏覽器自動暫存，重新整理會還原 |
| 其他 | 復原與重做（Ctrl+Z、Ctrl+Y）、拖曳調整面板大小、「說明」按鈕有操作說明 |

### 自訂物品

- 素材庫「物品」分頁上方：＋新增、匯入（貼上 JSON）、提示詞教學、匯出，每一列可編輯、複製、刪除。
- 編輯器預覽上可以直接拖曳選取的零件：預覽左上角切換移動、旋轉、縮放，勾「吸附」時移動每格 1 公分、旋轉每格 15 度，放開後數值寫回表單（限制見 `GAPS.md` G036）。
- 內建物品按右鍵可複製成自訂物品，再改零件、顏色或尺寸。斜面、車身輪廓、樹叢等沒有對應零件形狀的部分會換成方塊、圓柱或球（說明欄會寫幾個），動畫與金屬材質不保留（見 `GAPS.md` G035）。
- 存在 `library/assets.json`（伺服器寫入，舊版留 `library/assets.bak.json`）。
- 開啟含自訂物品的專案或資料夾時，物品會加進素材庫；同 id 內容不同會詢問。
- 「提示詞教學」說明怎麼用一般聊天 AI 產生可匯入的物品 JSON：格式、零件形狀、注意事項與範例。

## 資料夾

| 路徑 | 內容 |
|---|---|
| `index.html`、`js/`、`css/` | 編輯器 |
| `runtime/` | 編輯器、輸出、檢查工具共用的場景程式（格式驗證、關鍵影格、人偶、動物、物品、攝影機、燈光、MP4 編碼） |
| `render.html` | 無頭渲染頁，給 `tools/check_scene.py` 用 |
| `examples/` | 範例專案（街頭相遇、咖啡廳對話、遛狗） |
| `projects/` | SKILL 產生的專案資料夾，例如 `projects/esg-recycle-day/` |
| `library/` | 自訂物品庫（`assets.json`）、姿勢庫（`poses.json`） |
| `skill/blockingpro/` | 配套 SKILL 原始檔（SKILL.md、格式參考） |
| `tools/` | `serve.py` 本機伺服器、`check_scene.py` 檢查與渲染、`gen_reference.py` 產生 catalog.md / assets.md、`project_diff.py` 列出兩個專案檔的差異、`check_continuity.py` 檢查長故事各段前後是否連戲、`script_import.py` 讀劇本產生每一場的骨架專案、`smoke_test.py` 編輯器煙霧測試、`ui_test.py` 編輯器操作測試、`compare_ref.py` 參考圖與渲染圖比對、`install_skill.py` 安裝 SKILL、`build_exe.py` 重新打包 `BlockingPRO.exe`（需要 PyInstaller，改了 `serve.py` 後要重跑） |
| `tests/` | runtime 單元測試，`node --test tests/*.mjs` |

## SKILL

安裝（把 `skill/blockingpro/` 複製到 `~/.claude/skills/blockingpro/`，並填入本資料夾路徑）：

```bash
python tools/install_skill.py
```

安裝後在 Claude Code 說「用 BlockingPRO 把這個故事做成預演」並附上故事，SKILL 會在 `projects/<英文代號>/` 寫出：

- `project.blockingpro.json`：專案檔
- `storyboard.md`：分鏡表與每鏡的 Seedance 提示詞
- `assets.blockingpro-assets.json`：用到自訂物品時才有

要改既有專案時，說「把 projects/<英文代號> 的第 3 鏡改成特寫」這類指定鏡頭或角色的要求，SKILL 只改指定的部分：先備份成 `project.blockingpro.json.bak`，改完用 `python tools/project_diff.py 舊檔 新檔` 確認只動到要改的欄位，再重新檢查截圖。

故事超過一段的長度上限（Seedance 2.0 為 15 秒）時，SKILL 會拆成多段，寫成同一個資料夾裡的 `part1.blockingpro.json`、`part2.blockingpro.json`……，下一段開頭的位置、朝向、姿勢、手上的物品照前一段結尾寫，再用 `python tools/check_continuity.py projects/<英文代號>` 檢查前後是否連戲。編輯器開啟這種資料夾時會列出各段讓你選。範例：`projects/park-book/`。

想先比較拍法時，說「這場戲給我 3 種分鏡方案」，SKILL 會用同一套走位做 2 到 3 個只差攝影機和剪接的方案（`variant-a.blockingpro.json`……），各附 sheet.png 和比較表 `variants.md`，你選定後才寫分鏡表。範例：`projects/street-meet-options/`。

有現成劇本時，貼給 SKILL 說「依劇本產生預演」。SKILL 先把劇本存成 `script.txt`，用 `python tools/script_import.py script.txt --out projects/<英文代號>` 每一場產生一個骨架專案（`scene1/`、`scene2/`……：角色、每句台詞的字幕和說話動作、每行動作描述的時間標記、一台全景攝影機），再補走位、物品、攝影機和剪接。工具讀純文字（UTF-8 或 Big5）的中文劇本（「第1場　夜　內　客廳」「阿哲：台詞」「△動作」）和 Fountain 格式；時間依台詞字數估計，只拿掉 `--out` 就只列出大綱。各場是獨立的資料夾，在編輯器裡一次開一場。範例：`projects/umbrella-script/`（限制見 `GAPS.md` G043）。

在編輯器按「開啟資料夾」選這個資料夾（或把資料夾拖進視窗）即可編輯。也可以執行 `python tools/serve.py --project projects/<英文代號>`，或在 BlockingPRO 執行中打開 `http://127.0.0.1:38940/?project=projects/<英文代號>`，編輯器開啟時就載入這個資料夾（只限 BlockingPRO 資料夾裡的專案，限制見 `GAPS.md` G038）。

## 檢查工具

需要 `pip install playwright` 與 `python -m playwright install chromium`（安裝時要網路，之後離線可用）。

```bash
python tools/check_scene.py projects/esg-recycle-day/project.blockingpro.json --shots --overview 0,8
```

- 輸出到 JSON 旁的 `project_check/`：`sheet.png`（每鏡一格）、`overview_<秒>s.png`（俯視走位與機位）。
- `--times 2.5,6.1` 輸出單格，`--mp4` 輸出 MP4，`--camera camB` 只看某台攝影機。
- 傳入 `*.blockingpro-assets.json` 時改為檢查自訂物品（正面、右前、左後三個角度，旁邊放 1.7 公尺參考人）。
- 結束碼：0 正常，1 專案有錯誤，2 渲染或環境失敗。

## 自動測試

```bash
node --test tests/*.mjs
python tools/smoke_test.py
python tools/ui_test.py
```

- `node --test`：runtime 的單元測試（不需要瀏覽器）。
- `smoke_test.py`：用無頭 Chromium 開編輯器，依序測載入、從範例清單載入「街頭相遇」、場景清單選取、改名加復原與重做、空白鍵播放、儲存（檢查下載的 JSON）、說明／版本／下載 MP4／分鏡表 PNG 對話框用 Esc 關閉，任何頁面錯誤都算失敗。需要的套件同檢查工具；沒有伺服器在跑時會自己啟動。`--headed` 顯示瀏覽器視窗。結束碼 0 全部通過，1 有項目失敗。
- `ui_test.py`：用真實滑鼠、鍵盤操作編輯器（約 3 分鐘）。先在暫存資料夾做一個帶地面底圖與背景圖的測試專案，再測：開啟資料夾並連結圖片、MP4 單一攝影機加自訂區間（解碼回來檢查長度與背景圖）、分鏡表 PNG、平面圖 PNG、環境「選擇圖片…」、新的瀏覽器設定檔開專案時的缺圖提示、素材庫新增角色與物品、呈現方式、俯視與透視、對準選取、Shift＋點地面加路徑點、Alt＋拖曳框選、時間軸拖曳與拉長動作片段、燈光編輯、套用運鏡預設、擺姿勢（角度欄位、旋轉環、鏡像、全部歸零、套用）、面板分割拖曳。每項各自執行，一項失敗不影響其他項；參數和結束碼同 `smoke_test.py`。

## 限制

見 `GAPS.md`。主要幾點：白模沒有臉、衣服、手指，動作是程式產生的基本動作；角色與物品之間沒有碰撞，只在編輯器和 check_scene 提醒穿模；Seedance 實際生成效果尚未實測。

## 授權

[MIT](LICENSE)。`vendor/` 裡的函式庫依各自授權（three.js、gifenc 為 MIT，mediabunny 為 MPL-2.0），見 `vendor/README.md`。
