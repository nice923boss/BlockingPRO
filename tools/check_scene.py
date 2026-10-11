"""Validate a BlockingPRO project and render check images with headless Chromium.

Usage:
    python tools/check_scene.py scene.blockingpro.json [--out DIR] [--count 8 | --shots] [--times 0.5,3]
                                [--overview 0,4] [--camera CAM_ID] [--mp4]
    python tools/check_scene.py props.blockingpro-assets.json     (asset pack: front / front 45 / back 45 views)

Outputs (default folder: <json name>_check next to the JSON):
    overview_<t>s.png  top-down plan at time t: walk paths, cameras and their sight lines
    f_<t>s.png         single program frames for --times
    <name>.mp4         with --mp4 (same encoder as the editor)
    sheet.png          program frames at even times (or one per shot with --shots), labelled with time,
                       camera and the shot note (printed last)

Also prints the editor's checks: the shot size of each cut (judged at its midpoint on the aimed actor when in frame, else the biggest one),
and reminders for walk-throughs (actors passing through each other or a prop, sampled every 0.1 s) and for actor pairs
that swap left and right across a cut (180-degree line). These reminders do not change the exit code.

Uses render.html, the same runtime as the editor, so what passes here opens the same way in BlockingPRO.
Starts tools/serve.py when nothing answers on the port. Works offline: three.js and the encoders come from vendor/,
and requests to any other host are refused and reported as render errors.
Exit code: 0 ok, 1 project errors, 2 render or environment failure.
"""
import argparse
import base64
import json
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def server_up(base: str) -> bool:
    try:
        with urllib.request.urlopen(base + "/render.html", timeout=1) as res:
            return res.status == 200
    except OSError:
        return False


def ensure_server(port: int):
    """Return the server process when this script started it, else None."""
    base = f"http://127.0.0.1:{port}"
    if server_up(base):
        return None
    proc = subprocess.Popen([sys.executable, str(ROOT / "tools" / "serve.py"), "--port", str(port)],
                            stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    for _ in range(50):
        if server_up(base):
            return proc
        if proc.poll() is not None:
            raise RuntimeError(f"本機伺服器啟動失敗：{proc.stderr.read().decode('utf-8', 'replace').strip()}")
        time.sleep(0.2)
    proc.terminate()
    raise RuntimeError(f"本機伺服器 {base} 沒有回應")


def save_data_url(url: str, path: Path) -> Path:
    path.write_bytes(base64.b64decode(url.split(",", 1)[1]))
    return path


def model_files(project, folder: Path) -> dict:
    """Base64 of the GLB / OBJ files that imported model props use, read from the project folder."""
    files = {}
    for a in project.get("assets") or []:
        name = (a.get("model") or {}).get("file") if isinstance(a, dict) else None
        if not isinstance(name, str) or not name or name in files or Path(name).name != name:
            continue
        path = folder / name
        if path.is_file():
            files[name] = base64.b64encode(path.read_bytes()).decode("ascii")
        else:
            print(f"提醒：找不到模型檔 {path}，畫面裡會用半透明方塊代替")
    return files


def floats(text: str):
    return [float(x) for x in text.split(",") if x.strip()] if text else []


def tag(t: float) -> str:
    return f"{t:.2f}".rstrip("0").rstrip(".")


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser(description="檢查 BlockingPRO 專案並輸出檢查圖")
    ap.add_argument("project", help=".blockingpro.json 專案檔")
    ap.add_argument("--out", help="輸出資料夾（預設：專案檔旁的 <檔名>_check）")
    ap.add_argument("--count", type=int, default=8, help="分鏡表張數（預設 8）")
    ap.add_argument("--shots", action="store_true", help="分鏡表每個鏡頭一格（取鏡頭中間），附鏡頭說明")
    ap.add_argument("--times", default="", help="另外輸出單格畫面的秒數，逗號分隔，例如 0.5,3,7.2")
    ap.add_argument("--overview", default="0", help="平面圖的秒數，逗號分隔（預設 0）")
    ap.add_argument("--camera", default=None, help="只看某台攝影機的 id（預設：依剪接）")
    ap.add_argument("--mp4", action="store_true", help="另外輸出 MP4")
    ap.add_argument("--port", type=int, default=38940)
    args = ap.parse_args()

    src = Path(args.project).resolve()
    try:
        project = json.loads(src.read_text(encoding="utf-8-sig"))
    except (OSError, json.JSONDecodeError) as err:
        print(f"錯誤：讀不到或不是有效的 JSON：{src}（{err}）")
        return 1
    stem = src.name.removesuffix(".json").removesuffix(".blockingpro")
    out = Path(args.out).resolve() if args.out else src.with_name(f"{stem}_check")
    out.mkdir(parents=True, exist_ok=True)

    from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeout

    try:
        server = ensure_server(args.port)
    except RuntimeError as err:
        print(f"錯誤：{err}")
        return 2
    page_errors = []
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch()
            page = browser.new_page(viewport={"width": 1280, "height": 900})
            page.on("pageerror", lambda e: page_errors.append(str(e)))
            page.on("console", lambda m: page_errors.append(m.text) if m.type == "error" else None)
            local = f"http://127.0.0.1:{args.port}/"

            def local_only(route):
                # a remote dependency would make the check pass only when online, so it fails here instead
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
                for e in page_errors:
                    print(f"  {e}")
                return 2

            pack = not (isinstance(project, dict) and project.get("format") == "blockingpro")
            if pack:
                prev = page.evaluate("(j) => window.BP.assetPreview(j)", project)
                for e in prev["errors"]:
                    print(f"錯誤：{e}")
                for w in prev["warnings"]:
                    print(f"提醒：{w}")
                if prev["errors"] or not prev["project"]:
                    print(f"共 {len(prev['errors'])} 個錯誤，未輸出檢查圖")
                    return 1
                project = prev["project"]
                print(f"物品包：{len(project['assets'])} 個物品（{'、'.join(a['label'] for a in project['assets'])}），"
                      "旁邊放 1.7 公尺參考人，依序從正面、右前 45 度、左後 45 度看")
            models = model_files(project, src.parent)
            if models:
                for e in page.evaluate("(m) => window.BP.loadModels(m)", models):
                    print(f"提醒：模型檔無法讀取，用半透明方塊代替：{e}")
            result = page.evaluate("(j) => window.BP.load(j)", project)
            if result.get("notes"):
                print(f"提醒：舊版專案已自動升級：{'；'.join(result['notes'])}。檔案本身沒有改，在編輯器儲存後就是新格式")
            if result.get("newer"):
                print("提醒：這個專案是較新版 BlockingPRO 存的，不認得的欄位可能被略過，請更新 BlockingPRO")
            for e in result["errors"]:
                print(f"錯誤：{e}")
            for w in result["warnings"]:
                print(f"提醒：{w}")
            if result["errors"]:
                print(f"共 {len(result['errors'])} 個錯誤，未輸出檢查圖")
                return 1

            info = page.evaluate("() => window.BP.info()")
            S = info["settings"]
            cams = {cid: name for cid, name in info["cameras"]}
            cuts = "、".join(f"{c['t']}s {cams.get(c['camera'], c['camera'])}" + (f"（{c['note']}）" if c.get("note") else "")
                            for c in info["cuts"]) or "無"
            print(f"場景「{info['name']}」：{S['width']}x{S['height']}，{S['fps']} fps，{S['duration']} 秒；"
                  f"角色 {info['actors']}、物品 {info['props']}、燈 {info['lights']}、攝影機 {len(cams)}；剪接 {cuts}")
            if args.camera and args.camera not in cams:
                print(f"錯誤：沒有 id 為 {args.camera} 的攝影機（可用：{'、'.join(cams)}）")
                return 1
            if not pack:
                checks = page.evaluate("() => window.BP.analyze()")
                if checks["shots"]:
                    print("景別（每鏡中間那一格；攝影機對準角色時看那個角色，否則看畫面中最大的角色）：")
                    for i, s in enumerate(checks["shots"], 1):
                        who = f"（{s['actor']}）" if s["actor"] else ""
                        print(f"  鏡 {i}：{tag(s['t0'])} 到 {tag(s['t1'])} 秒，{cams.get(s['camera'], s['camera'])}，{s['size']}{who}")
                for c in checks["collisions"][:20]:
                    print(f"提醒：穿模 {c}")
                if len(checks["collisions"]) > 20:
                    print(f"提醒：穿模還有 {len(checks['collisions']) - 20} 處沒有列出")
                for a in checks["axis"]:
                    print(f"提醒：{a}")

            written = []
            for t in floats(args.overview):
                url = page.evaluate("(t) => window.BP.overview(t, 900)", t)
                written.append(save_data_url(url, out / f"overview_{tag(t)}s.png"))
            for t in floats(args.times):
                url = page.evaluate("([t, c]) => window.BP.frame(t, { camera: c })", [t, args.camera])
                written.append(save_data_url(url, out / f"f_{tag(t)}s.png"))
            if args.mp4:
                res = page.evaluate("(c) => window.BP.mp4({ camera: c })", args.camera)
                mp4 = out / f"{stem}.mp4"
                mp4.write_bytes(base64.b64decode(res["base64"]))
                written.append(mp4)
                note = "" if res["codec"] == "avc" else f"（這個瀏覽器不能編 H.264，改用 {res['codec']}）"
                print(f"MP4：{res['frames']} 格，{res['width']}x{res['height']}，編碼 {res['codec']}{note}")
            if pack:
                url = page.evaluate("() => window.BP.sheet({ times: [0.5, 1.5, 2.5], cols: 3 })")
            elif args.shots:
                ends = [c["t"] for c in info["cuts"][1:]] + [S["duration"]]
                times = [round((c["t"] + e) / 2, 2) for c, e in zip(info["cuts"], ends)][:24] or [S["duration"] / 2]
                url = page.evaluate("([t, c]) => window.BP.sheet({ times: t, cols: Math.min(4, t.length), camera: c })",
                                    [times, args.camera])
            else:
                url = page.evaluate("([n, c]) => window.BP.sheet({ count: n, camera: c })", [args.count, args.camera])
            sheet = save_data_url(url, out / "sheet.png")
            browser.close()
    finally:
        if server:
            server.terminate()

    if page_errors:
        print("渲染時發生錯誤：")
        for e in page_errors:
            print(f"  {e}")
        return 2
    for path in written:
        print(path)
    print(sheet)
    return 0


if __name__ == "__main__":
    sys.exit(main())
