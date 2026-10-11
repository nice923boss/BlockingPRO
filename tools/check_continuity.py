"""Check that the parts of a long story join up: where each part ends, the next one starts the same way (k02).

Usage:
    python tools/check_continuity.py part1.blockingpro.json part2.blockingpro.json [part3 ...] [--port 38940]
    python tools/check_continuity.py projects/<code>        (every *.blockingpro.json in the folder, part2 before part10)
    python tools/check_continuity.py part1.blockingpro.json (one part: print where everything is when it ends)

For each pair of consecutive parts, compares the end of the first (t = its duration) with the start of the next (t = 0):
    actors (by id): name, kind, body type, colour, size, display; position (over 0.05 m), facing (over 10 degrees),
                    posture (head position relative to the feet, over 0.15 m) with the clips in effect on both sides
    props (by id):  type, name, colour, size; who holds it, the joint and grip (upright, pos, rot); position when nobody holds it
    settings (except duration and markers), and custom asset definitions used in both parts
Actors or props in only one of the two parts are listed but are not mismatches. Cameras and lights are not compared:
the join between parts is treated as a cut.

Uses render.html (BP.state), the same runtime as the editor. Starts tools/serve.py when nothing answers on the port.
Exit code: 0 continuous, 1 mismatches or project errors, 2 a file cannot be read or render failure.
"""
import argparse
import json
import re
import sys
from math import dist
from pathlib import Path

from check_scene import ensure_server, model_files, tag

POS_TOL, YAW_TOL, POSE_TOL = 0.05, 10, 0.15
ACTOR_FIELDS = {"name": "名字", "kind": "種類", "preset": "體型", "color": "顏色", "scale": "大小", "body": "身形", "display": "顯示"}
PROP_FIELDS = {"type": "類型", "name": "名字", "color": "顏色", "scale": "大小"}


def short(value) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def xyz(v) -> str:
    return "[" + ", ".join(f"{x:.2f}" for x in v) + "]"


def label(kind: str, e: dict) -> str:
    return f"{kind} {e['id']}" + (f"（{e['name']}）" if e.get("name") else "")


def clips(e: dict) -> str:
    return "、".join(e["clips"]) or "沒有動作片段"


def holder(e: dict) -> str:
    h = e["holder"]
    if not h:
        return "沒有人拿"
    grip = "，直立" if h["upright"] else ""
    grip += f"，pos {short(h['pos'])}" if h["pos"] else ""
    grip += f"，rot {short(h['rot'])}" if h["rot"] else ""
    return f"{h['actor']} 的 {h['joint']}" + (f"（{grip[1:]}）" if grip else "")


def part_files(args: list) -> list:
    if len(args) == 1 and Path(args[0]).is_dir():
        natural = lambda p: [int(s) if s.isdigit() else s for s in re.split(r"(\d+)", p.name)]
        return sorted(Path(args[0]).glob("*.blockingpro.json"), key=natural)
    return [Path(a) for a in args]


def compare(a: dict, b: dict) -> tuple:
    """(mismatch lines, info lines) between the end state a of one part and the start state b of the next."""
    bad, info = [], []
    for k in sorted({*a["settings"], *b["settings"]} - {"duration", "markers"}):
        if a["settings"].get(k) != b["settings"].get(k):
            bad.append(f"設定 {k}：{short(a['settings'].get(k))} → {short(b['settings'].get(k))}")

    for kind, key in (("角色", "actors"), ("物品", "props")):
        ma, mb = {e["id"]: e for e in a[key]}, {e["id"]: e for e in b[key]}
        info += [f"只在前一段：{label(kind, e)}" for i, e in ma.items() if i not in mb]
        info += [f"只在後一段：{label(kind, e)}" for i, e in mb.items() if i not in ma]
        for i in [i for i in ma if i in mb]:
            ea, eb, name = ma[i], mb[i], label(kind, mb[i])
            for f, zh in (ACTOR_FIELDS if key == "actors" else PROP_FIELDS).items():
                if ea.get(f) != eb.get(f):
                    bad.append(f"{name}：{zh} {short(ea.get(f))} → {short(eb.get(f))}")
            if key == "actors":
                d = dist(ea["pos"], eb["pos"])
                if d > POS_TOL:
                    bad.append(f"{name}：位置差 {d:.2f} 公尺（{xyz(ea['pos'])} → {xyz(eb['pos'])}）")
                turn = abs((ea["yaw"] - eb["yaw"] + 180) % 360 - 180)
                if turn > YAW_TOL:
                    bad.append(f"{name}：朝向差 {turn:.0f} 度（yaw {ea['yaw']:g} → {eb['yaw']:g}）")
                rel = lambda e: [h - p for h, p in zip(e["head"], e["pos"])]
                if dist(rel(ea), rel(eb)) > POSE_TOL:
                    # same clip on both sides: the next part's clip fades in from standing (blend defaults to 0.3 s)
                    hint = "；t = 0 的延續片段要寫 \"blend\": 0，不然會從站姿淡入" if eb["clips"] and ea["clips"] == eb["clips"] else ""
                    bad.append(f"{name}：姿勢不同，頭部相對腳的位置差 {dist(rel(ea), rel(eb)):.2f} 公尺"
                               f"（前一段結束：{clips(ea)}；後一段開始：{clips(eb)}{hint}）")
            elif ea["holder"] != eb["holder"]:
                bad.append(f"{name}：拿的人或握法不同（前一段結束：{holder(ea)}；後一段開始：{holder(eb)}）")
            elif not ea["holder"] and dist(ea["pos"], eb["pos"]) > POS_TOL:
                bad.append(f"{name}：位置差 {dist(ea['pos'], eb['pos']):.2f} 公尺（{xyz(ea['pos'])} → {xyz(eb['pos'])}）")

    types = {p["type"] for p in a["props"]} & {p["type"] for p in b["props"]}
    for t in sorted(types & a["assets"].keys()):
        if a["assets"][t] != b["assets"].get(t):
            bad.append(f"自訂物品 {t}：兩段的定義不同")
    return bad, info


def print_end(state: dict, t: float) -> None:
    print(f"「{state['name']}」結束時（{tag(t)} 秒），下一段 t = 0 照這裡寫：")
    for e in state["actors"]:
        print(f"  {label('角色', e)}：位置 {xyz(e['pos'])}，yaw {e['yaw']:g}，{clips(e)}")
    for e in state["props"]:
        where = f"拿在 {holder(e)}" if e["holder"] else f"位置 {xyz(e['pos'])}"
        print(f"  {label('物品', e)}：{where}")


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser(description="檢查長故事拆成的多段專案前後是否連戲")
    ap.add_argument("parts", nargs="+", help="依順序列出各段 .blockingpro.json，或放各段專案檔的資料夾")
    ap.add_argument("--port", type=int, default=38940)
    args = ap.parse_args()

    files = part_files(args.parts)
    if not files:
        print(f"錯誤：資料夾裡沒有 .blockingpro.json：{args.parts[0]}")
        return 2
    projects = []
    for f in files:
        try:
            projects.append(json.loads(f.read_text(encoding="utf-8-sig")))
        except (OSError, json.JSONDecodeError) as err:
            print(f"錯誤：讀不到或不是有效的 JSON：{f}（{err}）")
            return 2

    from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeout

    try:
        server = ensure_server(args.port)
    except RuntimeError as err:
        print(f"錯誤：{err}")
        return 2
    page_errors, states = [], []
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch()
            page = browser.new_page()
            page.on("pageerror", lambda e: page_errors.append(str(e)))
            page.on("console", lambda m: page_errors.append(m.text) if m.type == "error" else None)
            local = f"http://127.0.0.1:{args.port}/"

            def local_only(route):
                if route.request.url.startswith(local):
                    route.continue_()
                else:
                    page_errors.append(f"拒絕本機以外的請求：{route.request.url}")
                    route.abort()
            page.route("**/*", local_only)
            page.goto(f"http://127.0.0.1:{args.port}/render.html")
            try:
                page.wait_for_function("window.__ready === true", timeout=60000)
            except PlaywrightTimeout:
                print("錯誤：render.html 60 秒內沒有載入完成（vendor 資料夾缺檔或程式錯誤）")
                return 2
            for n, (f, project) in enumerate(zip(files, projects), 1):
                models = model_files(project, f.parent)
                if models:
                    page.evaluate("(m) => window.BP.loadModels(m)", models)
                result = page.evaluate("(j) => window.BP.load(j)", project)
                if result["errors"]:
                    print(f"錯誤：第 {n} 段 {f.name} 有 {len(result['errors'])} 個專案錯誤，先用 check_scene.py 修正：")
                    for e in result["errors"]:
                        print(f"  {e}")
                    return 1
                end = page.evaluate("() => window.BP.info()")["settings"]["duration"]
                states.append({"file": f, "end": end, "start_state": page.evaluate("() => window.BP.state(0)"),
                               "end_state": page.evaluate("(t) => window.BP.state(t)", end)})
            browser.close()
    finally:
        if server:
            server.terminate()
    if page_errors:
        print("渲染時發生錯誤：")
        for e in page_errors:
            print(f"  {e}")
        return 2

    for n, s in enumerate(states, 1):
        print(f"第 {n} 段：「{s['end_state']['name']}」{tag(s['end'])} 秒（{s['file']}）")
    if len(states) == 1:
        print_end(states[0]["end_state"], states[0]["end"])
        return 0
    total = 0
    for n in range(1, len(states)):
        bad, info = compare(states[n - 1]["end_state"], states[n]["start_state"])
        print(f"第 {n} 段結束 → 第 {n + 1} 段開始：{'連戲' if not bad else f'{len(bad)} 處不連戲'}")
        for line in bad:
            print(f"  不連戲：{line}")
        for line in info:
            print(f"  說明：{line}")
        total += len(bad)
    print("全部連戲" if not total else f"共 {total} 處不連戲")
    return 1 if total else 0


if __name__ == "__main__":
    sys.exit(main())
