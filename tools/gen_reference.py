"""Generate the BlockingPRO SKILL reference tables from the runtime, so the SKILL never drifts from the editor.

Usage:
    python tools/gen_reference.py [--port 38940]

Writes:
    skill/blockingpro/reference/catalog.md   bodies, joints, actions, animals, built-in props (with measured sizes),
                                              lighting, easings, lenses, settings defaults
    skill/blockingpro/reference/assets.md    custom prop format (same tables as the in-app prompt guide)

Loads render.html in headless Chromium and imports the runtime modules there (the page's import map resolves "three").
Starts tools/serve.py when nothing answers on the port.
"""
import argparse
import json
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from check_scene import ROOT, ensure_server  # noqa: E402

OUT = ROOT / "skill" / "blockingpro" / "reference"
HEADER = "<!-- 由 tools/gen_reference.py 產生，不要手改。改 runtime 後重跑：python tools/gen_reference.py -->\n\n"

COLLECT = """async () => {
  const mod = (p) => import(p.startsWith(".") ? new URL(p, location.href).href : p);
  const [rh, ra, ah, aa, pr, lt, ky, cm, sc, as, ap, sn, THREE, tr, pa] = await Promise.all([
    "./runtime/rig-human.js", "./runtime/rig-animal.js", "./runtime/actions.js", "./runtime/actions-animal.js",
    "./runtime/props.js", "./runtime/lights.js", "./runtime/keys.js", "./runtime/camera.js", "./runtime/schema.js",
    "./runtime/assets.js", "./js/asset-prompt.js", "./runtime/scene.js", "three", "./runtime/terrain.js",
    "./runtime/prop-anim.js"].map(mod));
  const r2 = (x) => Math.round(x * 100) / 100;
  const box = new THREE.Box3(), size = new THREE.Vector3();
  const props = Object.entries(pr.PROPS).map(([id, p]) => {
    const o = p.build(p.color);
    o.updateMatrixWorld(true);
    box.setFromObject(o).getSize(size);
    as.disposeObject(o);
    return { id, label: p.label, cat: p.cat, hold: !!p.hold, walk: tr.isTerrain(id), state: pa.STATE_TYPES[id]?.label || null,
      size: size.toArray().map(r2) };
  });
  const action = ([id, a]) => ({ id, label: a.label, mask: a.mask || "full", dur: a.dur, loop: !!a.loop,
    hold: a.hold ?? sn.HOLD_BY_DEFAULT.includes(id), params: a.params || {}, ui: a.ui || {}, types: a.types || null });
  return {
    bodies: rh.HUMAN_BODIES, joints: rh.HUMAN_JOINTS, upper: rh.UPPER_BODY,
    humanActions: Object.entries(ah.HUMAN_ACTIONS).map(action),
    animals: Object.fromEntries(Object.entries(ra.ANIMAL_TYPES).map(([k, a]) => [k, { ...a, joints: ra.buildAnimal({ type: k }).jointNames }])),
    animalActions: Object.entries(aa.ANIMAL_ACTIONS).map(action),
    props, cats: pr.PROP_CATS,
    lighting: Object.fromEntries(Object.entries(lt.LIGHTING).map(([k, l]) => [k, { label: l.label, bg: l.bg }])),
    easings: Object.fromEntries(Object.entries(ky.EASINGS).map(([k, e]) => [k, e.label])),
    moves: Object.fromEntries(Object.entries(cm.CAMERA_MOVES).map(([k, m]) => [k, { label: m.label, needsActor: !!m.needsActor }])),
    lenses: cm.LENS_PRESETS, gait: sn.GAIT,
    defaults: sc.DEFAULT_SETTINGS, targets: sc.TARGETS, display: sc.DISPLAY_MODES, format: sc.FORMAT, version: sc.VERSION,
    looks: sc.LOOKS, shakeStyles: sc.SHAKE_STYLES,
    asset: { fields: ap.ASSET_FIELDS, parts: ap.PART_FIELDS, cautions: ap.CAUTIONS, example: ap.EXAMPLE_PACK, builtin: ap.BUILTIN_IDS,
      holds: as.HOLD_PRESETS, shapes: Object.fromEntries(Object.entries(as.ASSET_SHAPES).map(([k, s]) => [k, { label: s.label, dims: s.dims }])),
      maxParts: as.MAX_PARTS, idPattern: as.ID_PATTERN.source, packFormat: as.ASSET_PACK_FORMAT },
  };
}"""


def table(head, rows):
    esc = lambda x: str(x).replace("|", "\\|").replace("\n", " ")
    lines = ["| " + " | ".join(head) + " |", "|" + "|".join("---" for _ in head) + "|"]
    lines += ["| " + " | ".join(esc(c) for c in r) + " |" for r in rows]
    return "\n".join(lines) + "\n"


def compact_json(data, indent: int = 2) -> str:
    """Pretty JSON with short arrays and leaf objects (parts, keys) kept on one line."""
    def flat(x):
        return not isinstance(x, (dict, list)) or (isinstance(x, list) and all(not isinstance(y, (dict, list)) for y in x))

    def dump(x, level):
        pad, inner = " " * (indent * level), " " * (indent * (level + 1))
        if flat(x) or (isinstance(x, dict) and all(flat(v) for v in x.values())):
            return json.dumps(x, ensure_ascii=False, separators=(", ", ": "))
        if isinstance(x, list):
            return "[\n" + ",\n".join(inner + dump(v, level + 1) for v in x) + "\n" + pad + "]"
        return "{\n" + ",\n".join(f"{inner}{json.dumps(k, ensure_ascii=False)}: {dump(v, level + 1)}" for k, v in x.items()) + "\n" + pad + "}"
    return dump(data, 0)


def num(x):
    return f"{x:g}"


def params_text(a):
    out = []
    for k, v in a["params"].items():
        ui = a["ui"].get(k)
        if ui and ui[1] == "actor":
            out.append(f"`{k}` {ui[0]}（填另一個角色的 id）")
        elif ui and ui[1] == "choice":
            opts = "、".join(f"{c}（{l}）" for c, l in ui[2].items())
            out.append(f"`{k}` {ui[0]}，可用 {opts}，預設 {v}")
        else:
            out.append(f"`{k}` {ui[0]}，{num(ui[1])} 到 {num(ui[2])}，預設 {num(v)}" if ui else f"`{k}` 預設 {num(v)}")
    return "；".join(out) or "無"


def catalog(d) -> str:
    D, T = d["defaults"], d["targets"]
    md = [HEADER, "# BlockingPRO 名錄\n\n",
          "專案 JSON 裡所有可用的代號都列在這裡。代號一律用英文 key（表格第一欄），中文只是說明。\n\n"]

    md.append("## 場景設定 settings\n\n")
    md.append(table(["欄位", "預設", "說明"], [
        ["width / height", f"{D['width']} / {D['height']}", "輸出解析度。參考影片建議 1280x720 或 720x1280，各模型限制見目標模型表"],
        ["fps", D["fps"], "每秒格數，1 到 120"],
        ["duration", D["duration"], "總長（秒）。超過目標模型上限時，輸出可自動分段"],
        ["target", f"\"{D['target']}\"", "要交給哪個 AI 影片模型，決定輸出時的長度、解析度、fps 警告與分段長度，見下表"],
        ["lighting", D["lighting"], "燈光預設，見下表"],
        ["background", "null", "背景色 #rrggbb；null 用燈光預設的背景"],
        ["ground", json.dumps(D["ground"], ensure_ascii=False), "地面：show 顯示、grid 格線、color 顏色"],
        ["display", "null", "全場顯示方式覆寫：" + "、".join(f"`{k}` {v}" for k, v in d["display"].items()) + "；null 依各角色設定"],
        ["look", "null", "白模外觀：" + "、".join(f"`{k}` {v}" for k, v in d["looks"].items()) + "；null 是預設的白色材質"],
        ["letterbox", "null", "遮幅：`\"2.39\"` 或 `\"1.85\"`（字串），導演台畫上下黑邊，輸出 MP4 可選擇保留；null 不加"],
        ["markers", "[]", "時間軸標記 `[{ \"t\": 2, \"label\": \"轉身\" }]`，只在編輯器顯示，用來標節拍"],
    ]))

    md.append("\n## 目標模型 settings.target\n\n")
    md.append("規格依 2026-10-10 查到的文件（來源見 BlockingPRO 的 docs/dev-log.md），平台改版後可能過時。"
              "短邊上限是建議值，超過只警告；短邊下限低於會被平台拒絕。\n\n")
    md.append(table(["代號", "名稱", "參考影片長度（秒）", "短邊", "fps", "說明"], [
        [f"`{k}`", t["label"], "不收影片", "", "", t["note"]] if t.get("video") is False else
        [f"`{k}`", t["label"], f"{num(t['minDuration'])} 到 {num(t['maxDuration'])}",
         f"{t['minShort']} 到 {t['maxShort']}", f"{t['fps'][0]} 到 {t['fps'][1]}", t["note"]] for k, t in T.items()]))

    md.append("\n## 燈光預設 settings.lighting\n\n")
    md.append(table(["代號", "名稱", "預設背景"], [[f"`{k}`", v["label"], v["bg"]] for k, v in d["lighting"].items()]))

    md.append("\n## 緩動 e（每個關鍵影格的 e 決定「從這一格到下一格」怎麼變化）\n\n")
    md.append(table(["代號", "名稱"], [[f"`{k}`", v] for k, v in d["easings"].items()]))
    md.append("\n自訂速度曲線：`e` 也可以寫四個數字 `[x1, y1, x2, y2]`，和 CSS cubic-bezier 相同（x 在 0 到 1；y 超出 0 到 1 會先超過再拉回）。"
              "例如 `[0.7, 0, 0.3, 1]` 是比 inOut 更強的慢起慢停。\n")

    md.append("\n## 人物體型 actors[].preset（kind: \"human\"）\n\n")
    md.append(table(["代號", "名稱", "身高（公尺）"], [[f"`{k}`", b["label"], b["height"]] for k, b in d["bodies"].items()]))

    md.append("\n## 人物關節（擺姿勢 pose.rot、附著 attach.joint 用）\n\n")
    md.append("、".join(f"`{j}`" for j in d["joints"]) + "\n\n")
    md.append("上半身動作只會動這些關節：" + "、".join(f"`{j}`" for j in d["upper"]) + "。\n")
    md.append("l 開頭是角色自己的左邊，r 開頭是右邊。小物預設放在 `rHand`。\n")

    md.append("\n## 人物動作 actions[] / upper[] 的 type\n\n")
    md.append("軌道欄是 `upper` 的動作放在 `upper` 陣列，可以疊在走路上；`actions` 的是全身動作。"
              "「結束後」是片段結束時的預設行為（片段可用 `hold` 覆寫）：停在最後姿勢，或淡回走路／待機。\n\n")
    md.append(table(["type", "名稱", "軌道", "預設秒數", "循環", "結束後", "params"], [
        [f"`{a['id']}`", a["label"], "upper" if a["mask"] == "upper" else "actions", num(a["dur"]), "循環" if a["loop"] else "單次",
         "停住" if a["hold"] else "淡回", params_text(a)] for a in d["humanActions"]]))

    md.append("\n## 動物 actors[].preset（kind: \"animal\"）\n\n")
    md.append(table(["代號", "名稱", "腳", "肩高（公尺）", "全高（公尺）", "關節"], [
        [f"`{k}`", a["label"], a["legs"], a["shoulder"], a["height"], "、".join(a["joints"])] for k, a in d["animals"].items()]))

    md.append("\n## 動物動作 actions[] 的 type（動物沒有 upper 軌）\n\n")
    md.append(table(["type", "名稱", "適用", "預設秒數", "循環", "params"], [
        [f"`{a['id']}`", a["label"], "、".join(a["types"]) if a["types"] else "全部", num(a["dur"]), "循環" if a["loop"] else "單次",
         params_text(a)] for a in d["animalActions"]]))

    md.append("\n## 自動步態（autoGait: true 時依路徑速度自動切換）\n\n")
    md.append("速度在 walk 區間內從待機淡入走路，在 run 區間內從走路淡入跑步（公尺/秒）。"
              "路徑兩個關鍵影格的距離除以時間差就是速度：人走路約 1.2 到 1.5，跑步 3 以上。\n\n")
    md.append(table(["對象", "走路區間", "跑步區間"], [
        [k, f"{num(g['walk'][0])} 到 {num(g['walk'][1])}", f"{num(g['run'][0])} 到 {num(g['run'][1])}"] for k, g in d["gait"].items()]))

    md.append("\n## 內建物品 props[].type\n\n")
    md.append("尺寸是 scale 1 時實際量到的外框（寬 x 高 x 深，公尺；寬沿 X、深沿 Z，正面朝 +Z）。"
              "可手持的物品附著到手上時會自動套用握法。可行走的物品，角色路徑走上去時身體和腳會踩在表面上（見 format.md「可行走的物品」）。"
              "備註寫「state」的物品可以用 state 關鍵影格做開關或轉速動畫；汽車、機車、腳踏車的車輪自動滾動（見 format.md「物品動畫」）。"
              "內建物品以外的類型要寫在專案的 `assets` 裡，見 assets.md。\n\n")
    for cat, label in d["cats"].items():
        rows = [[f"`{p['id']}`", p["label"], " x ".join(num(x) for x in p["size"]),
                 "、".join(x for x in ["可手持" if p["hold"] else "", "可行走" if p["walk"] else "",
                                        f"state：{p['state']}" if p["state"] else ""] if x)]
                for p in d["props"] if p["cat"] == cat]
        if rows:
            md.append(f"### {label}（{cat}）\n\n")
            md.append(table(["type", "名稱", "寬 x 高 x 深", "備註"], rows) + "\n")

    md.append("## 鏡頭焦距 cameras[].lens（毫米，全片幅，長邊 36 mm）\n\n")
    md.append(table(["焦距", "水平視角（16:9）", "常見用途"], [
        [f"{mm}", f"{2 * math.degrees(math.atan(18 / mm)):.0f} 度", use] for mm, use in zip(d["lenses"], [
            "極廣角，空間誇張", "廣角，室內全景", "廣角，大場面、環境", "標準偏廣，一般敘事（預設）",
            "標準，接近人眼", "人像特寫", "長焦，壓縮背景、偷拍感"])]))

    md.append("\n## 晃動樣式 cameras[].shakeStyle（搭配 shake 強度）\n\n")
    md.append("shake 是強度（0 不晃），shakeStyle 決定晃的樣子，預設 `handheld`。shake 不能放關鍵影格，整台攝影機全程同一種晃法。\n\n")
    md.append(table(["代號", "名稱"], [[f"`{k}`", v] for k, v in d["shakeStyles"].items()]))

    md.append("\n## 編輯器的運鏡產生器（參考）\n\n")
    md.append("編輯器素材庫「攝影機」分頁可一鍵產生下列運鏡。專案 JSON 裡沒有運鏡代號，要直接寫攝影機的 path / aim / mount / lens 關鍵影格；"
              "寫法見 SKILL.md 的「運鏡配方」。\n\n")
    md.append(table(["名稱", "需要角色"], [[m["label"], "是" if m["needsActor"] else ""] for m in d["moves"].values()]))
    return "".join(md)


def assets(d) -> str:
    A = d["asset"]
    md = [HEADER, "# 自訂物品格式\n\n",
          "內建物品不夠用時，用簡單幾何零件組成自訂物品。和 BlockingPRO 內「提示詞教學」用的是同一份規則。\n\n",
          "## 放在哪裡\n\n",
          "- 專案用到的自訂物品寫在專案檔的 `assets` 陣列，`props[].type` 填物品的 `id`。專案檔自己就能開，換電腦也看得到。\n",
          f"- 也可以另外輸出物品包 `名稱.blockingpro-assets.json`：`{{ \"format\": \"{A['packFormat']}\", \"version\": 1, \"assets\": [ ... ] }}`。"
          "和專案檔放同一個資料夾時，「開啟資料夾」會一起讀進來，並加入工具的素材庫。\n",
          "- 開啟專案時，專案裡的自訂物品會自動加進工具的素材庫（同 id 同內容略過，內容不同會詢問）。\n\n",
          "## 物品欄位\n\n", table(["欄位", "必填", "說明"], A["fields"]),
          f"\nid 規則（正規表示式）：`{A['idPattern']}`\n\n",
          "## 零件欄位（parts 裡的每一項）\n\n", table(["欄位", "適用", "說明"], A["parts"]),
          "\n每個零件也可以有 `name`（零件名稱，只用來辨識）。\n\n",
          "## 形狀與預設尺寸\n\n",
          table(["shape", "名稱", "沒寫尺寸時的預設"], [[f"`{k}`", s["label"], json.dumps(s["dims"], ensure_ascii=False)] for k, s in A["shapes"].items()]),
          "\n## 手持旋轉 hold.rot 常用值\n\n",
          "手的座標：手腕往指尖是 -Y。rot 是物品在手裡的旋轉（角度，依 X、Y、Z 順序）。\n\n",
          table(["rot", "用途"], [[json.dumps(h["rot"]), h["label"]] for h in A["holds"].values()]),
          "\n## 注意事項\n\n", "".join(f"- {c}\n" for c in A["cautions"]),
          "\n## 匯入的 3D 模型（model，只由編輯器產生）\n\n",
          "編輯器素材庫「自訂」分頁的「匯入模型」可以把 GLB 或 OBJ 檔做成物品。這種物品的 `parts` 是空陣列 `[]`，"
          "另外有 `model` 欄位。SKILL 和聊天 AI 不要自己寫 `model`（AI 產生不了模型檔），讀到既有專案裡的模型物品時保留原樣即可。\n\n",
          table(["model 欄位", "說明"], [
              ["`file`", "模型檔名（.glb 或 .obj，不含資料夾）。檔案放在專案檔旁邊，檢查工具和「開啟資料夾」從那裡讀"],
              ["`unit`", "檔案裡 1 單位等於幾公尺：公尺 1、公分 0.01、毫米 0.001、英吋 0.0254"],
              ["`yaw`", "讓模型正面朝 +Z 要轉的角度"],
              ["`size`", "換算後的 [寬, 高, 深]（公尺），找不到模型檔時用這個尺寸畫半透明方塊"],
              ["`look`", "`white`：白模，用物品主色；`original`：模型自己的材質"],
          ]),
          "\n找不到模型檔時，編輯器和檢查工具都用半透明方塊代替並提醒，不算錯誤。骨架動畫不播放，只顯示模型的預設姿勢。\n",
          "\n## 範例（物品包）\n\n```json\n", compact_json(A["example"]), "\n```\n"]
    return "".join(md)


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser(description="從 runtime 產生 SKILL 參考表")
    ap.add_argument("--port", type=int, default=38940)
    args = ap.parse_args()

    from playwright.sync_api import sync_playwright

    try:
        server = ensure_server(args.port)
    except RuntimeError as err:
        print(f"錯誤：{err}")
        return 2
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch()
            page = browser.new_page()
            page.goto(f"http://127.0.0.1:{args.port}/render.html")
            page.wait_for_function("window.__ready === true", timeout=60000)
            data = page.evaluate(COLLECT)
            browser.close()
    finally:
        if server:
            server.terminate()

    OUT.mkdir(parents=True, exist_ok=True)
    for name, text in (("catalog.md", catalog(data)), ("assets.md", assets(data))):
        if "\u2014" in text:
            print(f"錯誤：{name} 含有破折號，請改 runtime 文字")
            return 1
        (OUT / name).write_text(text, encoding="utf-8", newline="\n")
        print(OUT / name)
    print(f"人物動作 {len(data['humanActions'])}、動物動作 {len(data['animalActions'])}、內建物品 {len(data['props'])}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
