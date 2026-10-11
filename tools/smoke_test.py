"""Editor smoke test: opens index.html in headless Chromium and clicks through the basic flow.

    python tools/smoke_test.py [--port 38940] [--headed]

Steps: load without errors, load an example from the library, select in the scene list, rename + undo / redo,
play, save (checks the downloaded JSON), open and close dialogs with Esc. Any page error or console error fails.
Starts tools/serve.py when nothing answers on the port. Exit code 0 = all passed, 1 = a step failed.
"""
import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from check_scene import ensure_server  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser(description="BlockingPRO 編輯器煙霧測試")
    ap.add_argument("--port", type=int, default=38940)
    ap.add_argument("--headed", action="store_true", help="顯示瀏覽器視窗")
    args = ap.parse_args()
    sys.stdout.reconfigure(encoding="utf-8")

    from playwright.sync_api import sync_playwright

    try:
        server = ensure_server(args.port)
    except RuntimeError as err:
        print(f"錯誤：{err}")
        return 2
    errors, results = [], []

    def step(name, ok, detail=""):
        results.append(ok)
        print(f"{'通過' if ok else '失敗'}  {name}{'：' + detail if detail else ''}")

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=not args.headed)
            ctx = browser.new_context(viewport={"width": 1440, "height": 900}, accept_downloads=True)
            # a fresh profile would start the guided tour and cover the editor
            ctx.add_init_script("try { localStorage.setItem('blockingpro.tour.done', '1'); } catch {}")
            page = ctx.new_page()
            page.set_default_timeout(10000)
            page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
            page.on("console", lambda m: errors.append(f"console: {m.text}") if m.type == "error" else None)
            local = f"http://127.0.0.1:{args.port}/"
            page.route("**/*", lambda r: r.continue_() if r.request.url.startswith(local)
                       else (errors.append(f"拒絕本機以外的請求：{r.request.url}"), r.abort()))
            page.goto(local + "index.html")

            try:
                # 1. boot
                page.wait_for_function("window.BlockingPRO && !document.getElementById('boot')", timeout=60000)
                step("載入編輯器", True)

                # 2. example from the library (confirm box only when the scene is not empty)
                page.locator("#topbar").get_by_role("button", name="範例", exact=True).click()
                page.locator("#library .li", has_text="街頭相遇").click()
                confirm = page.locator(".modal-back button", has_text="載入")
                if confirm.count():
                    confirm.click()
                page.wait_for_function("BlockingPRO.store.project.name === '街頭相遇'", timeout=10000)
                n = page.evaluate("(() => { const P = BlockingPRO.store.project; return [P.actors.length, P.cameras.length, P.cuts.length]; })()")
                step("載入範例「街頭相遇」", n == [2, 3, 3], f"角色 {n[0]}、攝影機 {n[1]}、剪接 {n[2]}")

                # 3. scene list selection shows in the inspector
                page.locator("#outliner .li", has_text="小雯").first.click()
                sel = page.evaluate("BlockingPRO.store.sel.id")
                values = page.locator("#insp input").evaluate_all("els => els.map((e) => e.value).join(' ')")
                step("場景清單選取", sel == "woman" and "小雯" in values, f"選取 {sel}")

                # 4. rename, undo, redo
                name = page.locator("#projName")
                name.fill("煙霧測試")
                name.press("Enter")
                name.evaluate("(e) => e.blur()")
                renamed = page.evaluate("BlockingPRO.store.project.name")
                page.locator("#topbar").get_by_role("button", name="↶ 復原").click()
                undone = page.evaluate("BlockingPRO.store.project.name")
                page.locator("#topbar").get_by_role("button", name="↷ 重做").click()
                redone = page.evaluate("BlockingPRO.store.project.name")
                step("改名、復原、重做", (renamed, undone, redone) == ("煙霧測試", "街頭相遇", "煙霧測試"), f"{renamed} → {undone} → {redone}")

                # 5. playback advances the playhead
                page.evaluate("BlockingPRO.store.setTime(0)")
                page.locator("#timeline").click(position={"x": 5, "y": 5})
                page.keyboard.press(" ")
                page.wait_for_timeout(1000)
                page.keyboard.press(" ")
                t = page.evaluate("BlockingPRO.store.time")
                step("空白鍵播放", 0.5 < t < 2.0, f"1 秒後播放頭 {t:.2f} 秒")

                # 6. save downloads a valid project
                with page.expect_download() as dl:
                    page.locator("#topbar").get_by_role("button", name="儲存", exact=True).click()
                saved = json.loads(Path(dl.value.path()).read_text(encoding="utf-8"))
                ok = saved.get("format") == "blockingpro" and saved.get("name") == "煙霧測試" and len(saved.get("actors", [])) == 2
                step("儲存專案檔", ok, dl.value.suggested_filename)

                # 7. dialogs open and close with Esc
                for label in ("說明", "版本", "下載 MP4", "分鏡表 PNG"):
                    page.locator("#topbar").get_by_role("button", name=label, exact=True).click()
                    opened = page.locator(".modal-back").count() > 0
                    page.keyboard.press("Escape")
                    page.wait_for_timeout(200)
                    closed = page.locator(".modal-back").count() == 0
                    step(f"對話框「{label}」開關", opened and closed)

                # 8. the monitor and the 3D view actually drew something
                drawn = page.evaluate("""(() => {
                    const cv = document.querySelector('#view canvas');
                    return cv && cv.width > 100 && cv.height > 100;
                })()""")
                step("3D 視圖有畫布", bool(drawn))

            except Exception as err:  # a missing element or timeout ends the run; report it as a failed step
                step("執行中斷", False, str(err).splitlines()[0])
            browser.close()
    finally:
        if server:
            server.terminate()

    step("沒有頁面錯誤", not errors, f"{len(errors)} 則" if errors else "")
    for e in errors[:20]:
        print(f"  {e}")
    passed = sum(results)
    print(f"\n{passed}/{len(results)} 項通過")
    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
