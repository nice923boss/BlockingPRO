"""Editor operation test: drives the editor with real mouse and keyboard input (Playwright) through the
operations that smoke_test.py does not cover (GAPS G015).

    python tools/ui_test.py [--port 38940] [--headed]

Builds a test folder (street-meet + a ground image + a backdrop picture) in a temp directory, then checks:
open folder with linked pictures, MP4 of one camera over a custom range (and that the backdrop shows in it),
storyboard PNG, floor plan PNG, the "choose picture" button, the missing-picture warning (fresh browser profile),
adding from the library, display mode, top / perspective view, focus, Shift+click path point, Alt+drag box select,
dragging and resizing an action clip, light editing, camera move presets, posing (angle field, rotation ring,
mirror, reset, apply) and the panel splitter. Each check runs on its own; a failure does not stop the rest.
Exit code 0 = all passed, 1 = a check failed, 2 = could not start.
"""
import argparse
import base64
import json
import re
import shutil
import sys
import tempfile
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))
from check_scene import ensure_server  # noqa: E402

BG_RGB = (230, 30, 200)  # backdrop colour, easy to find in the exported video
NAME = "介面測試"


def make_folder(tmp: Path) -> Path:
    folder = tmp / "ui-test"
    folder.mkdir()
    P = json.loads((ROOT / "examples/street-meet.blockingpro.json").read_text(encoding="utf-8"))
    P["name"] = NAME
    P["settings"]["ground"] = {**P["settings"].get("ground", {}), "image": {"file": "floor.png", "width": 10, "x": 0, "z": 0, "rotate": 0, "opacity": 0.7}}
    P["settings"]["backdrop"] = {"file": "bg.png", "mode": "flat", "rotate": 0}
    (folder / "project.blockingpro.json").write_text(json.dumps(P, ensure_ascii=False, indent=2), encoding="utf-8")
    floor = Image.new("RGB", (256, 256), (240, 240, 240))
    for i in range(0, 256, 32):
        floor.paste((60, 60, 60), (i, 0, i + 2, 256))
        floor.paste((60, 60, 60), (0, i, 256, i + 2))
    floor.save(folder / "floor.png")
    Image.new("RGB", (640, 360), BG_RGB).save(folder / "bg.png")
    Image.new("RGB", (640, 360), (30, 200, 230)).save(tmp / "bg2.png")
    return folder


# ---------- page helpers ----------

def boot(ctx, local):
    page = ctx.new_page()
    page.set_default_timeout(15000)
    log = []
    page.on("console", lambda m: log.append(f"{m.type}: {m.text}"))
    page.on("pageerror", lambda e: log.append(f"pageerror: {e}"))
    page.on("requestfailed", lambda r: log.append(f"requestfailed: {r.url} {r.failure}"))
    page.goto(local + "index.html")
    try:
        page.wait_for_function("window.BlockingPRO && !document.getElementById('boot')", timeout=60000)
    except Exception:
        msg = page.evaluate("document.getElementById('bootMsg')?.innerText")
        raise RuntimeError(f"編輯器沒有載入完成：{msg}｜{' / '.join(log[-8:])}") from None
    return page


def js(page, expr, arg=None):
    return page.evaluate(expr, arg)


def top(page, label):
    page.locator("#topbar").get_by_role("button", name=label, exact=True).click()


def insp_row(page, label):
    return page.locator("#insp .row").filter(has=page.locator("label", has_text=re.compile(f"^{re.escape(label)}$")))


def modal_button(page, label):
    return page.locator(".modal-back .modal button", has_text=re.compile(f"^{re.escape(label)}$"))


def toast_has(page, text, timeout=8000):
    try:
        page.locator(".toast", has_text=text).first.wait_for(timeout=timeout)
        return True
    except Exception:
        return False


def screen_of(page, p):
    """Screen position of world point p in the 3D view"""
    return js(page, """(p) => {
        const vp = BlockingPRO.viewport, v = vp.camera.position.clone().set(p[0], p[1], p[2]).project(vp.camera);
        const r = vp.renderer.domElement.getBoundingClientRect();
        return [r.left + (v.x + 1) / 2 * r.width, r.top + (1 - v.y) / 2 * r.height];
    }""", p)


def actor_pos(page, aid):
    return js(page, """(id) => {
        const spec = BlockingPRO.store.project.actors.find((a) => a.id === id);
        return BlockingPRO.viewport.tools.anchor({ list: 'actors', spec }, true).toArray();
    }""", aid)


def outliner_pick(page, text):
    page.locator("#outliner .li", has_text=text).first.click()


def drag(page, x0, y0, x1, y1, steps=12):
    page.mouse.move(x0, y0)
    page.mouse.down()
    page.mouse.move(x1, y1, steps=steps)
    page.mouse.up()


def decode_video(page, data: bytes, mime: str):
    """Duration, size and the share of pixels near the backdrop colour in a frame 0.3 s in"""
    return js(page, """async ([b64, mime, bg]) => {
        const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        const v = document.createElement('video');
        v.muted = true;
        v.src = URL.createObjectURL(new Blob([bin], { type: mime }));
        await new Promise((ok, bad) => { v.onloadeddata = ok; v.onerror = () => bad(new Error('瀏覽器無法解碼，錯誤碼 ' + (v.error && v.error.code))); });
        v.currentTime = 0.3;
        await new Promise((ok) => { v.onseeked = ok; });
        const c = document.createElement('canvas');
        c.width = v.videoWidth; c.height = v.videoHeight;
        const g = c.getContext('2d');
        g.drawImage(v, 0, 0);
        const d = g.getImageData(0, 0, c.width, c.height).data;
        let near = 0;
        for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i] - bg[0]) + Math.abs(d[i + 1] - bg[1]) + Math.abs(d[i + 2] - bg[2]) < 60) near++;
        return { dur: v.duration, w: v.videoWidth, h: v.videoHeight, bgShare: near / (d.length / 4) };
    }""", [base64.b64encode(data).decode(), mime, list(BG_RGB)])


# ---------- checks (each returns (ok, detail)) ----------

def c_open_folder(page, folder):
    with page.expect_file_chooser() as fc:
        top(page, "開啟資料夾")
    fc.value.set_files(str(folder))
    confirm = modal_button(page, "開啟")
    try:
        confirm.wait_for(timeout=3000)
        confirm.click()
    except Exception:
        pass  # empty scene: no confirm box
    page.wait_for_function(f"BlockingPRO.store.project.name === '{NAME}'")
    linked = toast_has(page, "已連結資料夾裡的圖片")
    stored = js(page, """() => new Promise((ok) => {
        const r = indexedDB.open('blockingpro-images');
        r.onsuccess = () => { const q = r.result.transaction('files').objectStore('files').getAllKeys(); q.onsuccess = () => ok(q.result.sort()); };
    })""")
    missing = toast_has(page, "圖片不在這台電腦", timeout=1500)
    return linked and stored == ["bg.png", "floor.png"] and not missing, f"瀏覽器已存 {stored}，連結提示 {linked}，缺圖提示 {missing}"


def c_mp4(page):
    cam = js(page, "BlockingPRO.store.project.cameras[1]")
    top(page, "下載 MP4")
    modal = page.locator(".modal-back .modal")
    modal.locator(".row", has=page.locator("label", has_text="鏡頭")).locator("select").select_option(cam["id"])
    modal.locator(".row", has=page.locator("label", has_text="範圍")).locator("select").select_option("custom")
    nums = modal.locator(".row", has=page.locator("label", has_text="起訖")).locator("input")
    nums.nth(0).fill("0.5")
    nums.nth(0).press("Tab")
    nums.nth(1).fill("1.5")
    nums.nth(1).press("Tab")
    with page.expect_download(timeout=180000) as dl:
        modal_button(page, "開始輸出").click()
    name = dl.value.suggested_filename
    data = Path(dl.value.path()).read_bytes()
    mime = "video/webm" if name.endswith(".webm") else "video/mp4"
    try:
        v = decode_video(page, data, mime)
    except Exception as err:
        return False, f"{name}（{len(data) // 1024} KB）讀不回來：{str(err).splitlines()[0]}"
    ok = cam["name"] in name and abs(v["dur"] - 1.0) < 0.1 and (v["w"], v["h"]) == (1280, 720) and v["bgShare"] > 0.03
    return ok, f"{name}，{v['dur']:.2f} 秒，{v['w']}x{v['h']}，背景色佔畫面 {v['bgShare'] * 100:.1f}%"


def c_sheet(page):
    top(page, "分鏡表 PNG")
    with page.expect_download(timeout=60000) as dl:
        modal_button(page, "下載").click()
    im = Image.open(dl.value.path())
    return im.width >= 960 and im.height > 200, f"{dl.value.suggested_filename} {im.width}x{im.height}"


def c_overview(page):
    with page.expect_download(timeout=60000) as dl:
        top(page, "平面圖 PNG")
    im = Image.open(dl.value.path())
    return im.width >= 1000, f"{dl.value.suggested_filename} {im.width}x{im.height}"


def c_choose_picture(page, pic):
    page.keyboard.press("Escape")
    js(page, "BlockingPRO.store.select({})")
    insp_row(page, "背景圖").get_by_role("button", name="移除").click()
    with page.expect_file_chooser() as fc:
        insp_row(page, "背景圖").get_by_role("button", name="選擇圖片…").click()
    fc.value.set_files(str(pic))
    page.wait_for_function("BlockingPRO.store.project.settings.backdrop?.file === 'bg2.png'")
    return True, "背景圖換成 bg2.png"


def c_missing_picture(browser, local, folder):
    ctx = browser.new_context(viewport={"width": 1440, "height": 900})
    ctx.add_init_script("try { localStorage.setItem('blockingpro.tour.done', '1'); } catch {}")
    try:
        page = boot(ctx, local)
        with page.expect_file_chooser() as fc:
            top(page, "開啟")
        fc.value.set_files(str(folder / "project.blockingpro.json"))
        page.wait_for_function(f"BlockingPRO.store.project.name === '{NAME}'")
        return toast_has(page, "圖片不在這台電腦的瀏覽器裡：floor.png、bg.png"), "新的瀏覽器設定檔只開專案檔"
    finally:
        ctx.close()


def c_library(page):
    n0 = js(page, "[BlockingPRO.store.project.actors.length, BlockingPRO.store.project.props.length]")
    page.locator("#library .tabs button", has_text="角色").click()
    page.locator("#library .lib-item").first.click()
    page.locator("#library .tabs button", has_text="物品").click()
    page.locator("#library .lib-item", has_text="椅子").first.click()
    n1 = js(page, "[BlockingPRO.store.project.actors.length, BlockingPRO.store.project.props.length]")
    added = js(page, "[BlockingPRO.store.project.actors.at(-1).id, BlockingPRO.store.project.props.at(-1).type]")
    for _ in range(2):  # take both back out so the later checks see street-meet
        page.locator("#topbar").get_by_role("button", name="↶ 復原").click()
    return n1 == [n0[0] + 1, n0[1] + 1], f"角色 {n0[0]} → {n1[0]}，物品 {n0[1]} → {n1[1]}（{added[1]}）"


def c_display(page):
    sel = page.locator(".viewbar select")
    sel.select_option("joints")
    on = js(page, "BlockingPRO.store.project.settings.display")
    sel.select_option("")
    off = js(page, "BlockingPRO.store.project.settings.display")
    return on == "joints" and not off, f"全部關節 → {on}，各自設定 → {off}"


def c_views(page):
    def height():
        return js(page, "BlockingPRO.viewport.camera.position.y - BlockingPRO.viewport.orbit.target.y")
    page.locator(".viewbar button", has_text="視角").click()
    page.locator(".menu button", has_text="俯視（T）").click()
    h_top = height()
    page.locator(".viewbar button", has_text="視角").click()
    page.locator(".menu button", has_text="透視（P）").click()
    h_persp = height()
    return abs(h_top - 16) < 0.1 and abs(h_persp - 4.6) < 0.1, f"俯視高 {h_top:.2f}，透視高 {h_persp:.2f}"


def c_focus(page):
    outliner_pick(page, "小雯")
    page.locator(".viewbar button", has_text="視角").click()
    page.locator(".menu button", has_text="對準選取（F）").click()
    d = js(page, """(() => {
        const vp = BlockingPRO.viewport, p = vp._selPosition();
        return [vp.orbit.target.distanceTo(p), vp.camera.position.distanceTo(vp.orbit.target)];
    })()""")
    return d[0] < 0.01 and abs(d[1] - 5.5) < 0.05, f"目標離小雯 {d[0]:.3f} 公尺，鏡頭距離 {d[1]:.2f}"


def c_shift_click(page):
    outliner_pick(page, "小雯")
    js(page, "BlockingPRO.store.setTime(2.2)")
    n0 = js(page, "BlockingPRO.store.project.actors.find((a) => a.id === 'woman').path.keys.length")
    p = actor_pos(page, "woman")
    x, y = screen_of(page, [p[0] + 1.5, 0, p[2] + 1.0])
    page.keyboard.down("Shift")
    page.mouse.click(x, y)
    page.keyboard.up("Shift")
    keys = js(page, "BlockingPRO.store.project.actors.find((a) => a.id === 'woman').path.keys")
    hit = [k for k in keys if abs(k["t"] - 2.2) < 0.01]
    page.locator("#topbar").get_by_role("button", name="↶ 復原").click()
    ok = len(keys) == n0 + 1 and hit and abs(hit[0]["v"][0] - (p[0] + 1.5)) < 0.2 and abs(hit[0]["v"][2] - (p[2] + 1.0)) < 0.2
    return bool(ok), f"路徑點 {n0} → {len(keys)}，新點 {hit[0]['v'] if hit else '無'}"


def c_box_select(page):
    js(page, "BlockingPRO.store.select({})")
    js(page, "BlockingPRO.viewport.orbit.target.set(0, 0, 0)")  # the focus check left the view close on one person
    page.locator(".viewbar button", has_text="視角").click()
    page.locator(".menu button", has_text="透視（P）").click()
    pts = [screen_of(page, actor_pos(page, a)) for a in ("woman", "man")]
    xs, ys = [p[0] for p in pts], [p[1] for p in pts]
    x0, y0, x1, y1 = min(xs) - 30, min(ys) - 30, max(xs) + 30, max(ys) + 30
    on_view = js(page, """([a, b]) => [a, b].every(([x, y]) => document.elementFromPoint(x, y)?.classList.contains('main3d'))""", [[x0, y0], [x1, y1]])
    page.keyboard.down("Alt")
    drag(page, x0, y0, x1, y1)
    page.keyboard.up("Alt")
    ids = js(page, "(() => { const s = BlockingPRO.store.sel; return [s.id, ...(s.ids || [])]; })()")
    return on_view and {"woman", "man"} <= set(ids), f"框的兩角都在 3D 視窗 {on_view}，選到 {sorted(set(i for i in ids if i))}"


def c_clip_drag(page):
    outliner_pick(page, "小雯")
    js(page, "BlockingPRO.store.setTime(1)")
    page.locator("#library .tabs button", has_text="動作").click()
    page.locator("#library .lib-item", has_text="揮手").first.click()
    clip = js(page, "BlockingPRO.store.project.actors.find((a) => a.id === 'woman').upper.find((c) => c.type === 'wave')")
    el = page.locator(f'.tl-clip[data-id="woman"][data-clip="{clip["id"]}"]')
    el.scroll_into_view_if_needed()  # the track sits below the visible part of the timeline
    b = el.bounding_box()
    drag(page, b["x"] + b["width"] / 2, b["y"] + b["height"] / 2, b["x"] + b["width"] / 2 + 60, b["y"] + b["height"] / 2)
    moved = js(page, f"BlockingPRO.store.project.actors.find((a) => a.id === 'woman').upper.find((c) => c.id === '{clip['id']}')")
    g = el.locator(".grip").bounding_box()
    drag(page, g["x"] + g["width"] / 2, g["y"] + g["height"] / 2, g["x"] + g["width"] / 2 + 40, g["y"] + g["height"] / 2)
    sized = js(page, f"BlockingPRO.store.project.actors.find((a) => a.id === 'woman').upper.find((c) => c.id === '{clip['id']}')")
    ok = moved["start"] > clip["start"] + 0.1 and abs(moved["dur"] - clip["dur"]) < 1e-6 and sized["dur"] > moved["dur"] + 0.1 and abs(sized["start"] - moved["start"]) < 1e-6
    return ok, f"起點 {clip['start']:.2f} → {moved['start']:.2f}，長度 {moved['dur']:.2f} → {sized['dur']:.2f}"


def c_light(page):
    page.locator("#library .tabs button", has_text="燈光").click()
    page.locator("#library .lib-item", has_text="聚光燈").first.click()
    lid = js(page, "BlockingPRO.store.project.lights.at(-1).id")
    sel = js(page, "BlockingPRO.store.sel.id")
    field = insp_row(page, "強度").locator("input")
    field.fill("321")
    field.press("Tab")
    val = js(page, "BlockingPRO.store.project.lights.at(-1).intensity")
    insp_row(page, "種類").locator("select").select_option("point")
    kind = js(page, "BlockingPRO.store.project.lights.at(-1).type")
    return sel == lid and val == 321 and kind == "point", f"選取 {sel}，強度 {val}，種類 {kind}"


def c_camera_preset(page):
    cam = js(page, "BlockingPRO.store.project.cameras[0]")
    outliner_pick(page, cam["name"])
    insp_row(page, "運鏡").locator("select").select_option("dollyIn")
    page.locator("#insp button", has_text=re.compile("^套用$")).click()
    after = js(page, f"BlockingPRO.store.project.cameras.find((c) => c.id === '{cam['id']}').path")
    n = len(after["keys"])
    page.locator("#topbar").get_by_role("button", name="↶ 復原").click()
    back = js(page, f"BlockingPRO.store.project.cameras.find((c) => c.id === '{cam['id']}').path")
    return n == 2 and after != cam["path"] and back == cam["path"], f"「{cam['name']}」套推軌後 {n} 個路徑點，復原後還原 {back == cam['path']}"


def c_posing(page):
    outliner_pick(page, "小雯")
    js(page, "BlockingPRO.store.setTime(3)")
    n0 = js(page, "(() => { const a = BlockingPRO.store.project.actors.find((x) => x.id === 'woman'); return [...a.actions, ...a.upper].filter((c) => c.type === 'pose').length; })()")
    page.locator("#insp button", has_text="在目前時間擺姿勢").click()
    joint = page.locator("#insp .list .li", has_text=re.compile("^右")).nth(1)
    joint.click()
    jname = js(page, "BlockingPRO.store.posing.joint")
    # angle field
    x = insp_row(page, "旋轉 X / Y / Z").locator("input").first
    x.fill("30")
    x.press("Tab")
    r_field = js(page, f"BlockingPRO.posing.draft.rot['{jname}']")
    # rotation ring: hover around the joint until the gizmo reports an axis, then drag it
    c = js(page, f"""(() => {{
        const rig = BlockingPRO.rt.entities.get('woman').rig, vp = BlockingPRO.viewport;
        const p = rig.joints['{jname}'].getWorldPosition(vp.camera.position.clone());
        const v = p.project(vp.camera), r = vp.renderer.domElement.getBoundingClientRect();
        return [r.left + (v.x + 1) / 2 * r.width, r.top + (1 - v.y) / 2 * r.height];
    }})()""")
    grab = None
    for rad in range(20, 200, 8):
        for deg in range(0, 360, 15):
            import math
            px, py = c[0] + rad * math.cos(math.radians(deg)), c[1] + rad * math.sin(math.radians(deg))
            page.mouse.move(px, py)
            if js(page, "BlockingPRO.viewport.tc.axis") in ("X", "Y", "Z"):
                grab = (px, py)
                break
        if grab:
            break
    r_ring = None
    if grab:
        drag(page, grab[0], grab[1], grab[0] + 50, grab[1] + 40)
        r_ring = js(page, f"BlockingPRO.posing.draft.rot['{jname}']")
    # mirror, reset, apply
    page.locator("#insp button", has_text="左右鏡像").click()
    mirror = "l" + jname[1:]
    r_mirror = js(page, f"BlockingPRO.posing.draft.rot['{mirror}']")
    page.locator("#insp button", has_text="全部歸零").click()
    r_reset = js(page, "Object.values(BlockingPRO.posing.draft.rot).filter((r) => r.some((x) => Math.abs(x) > 1e-6)).length")
    joint = page.locator("#insp .list .li", has_text=re.compile("^右")).nth(1)
    joint.click()
    x = insp_row(page, "旋轉 X / Y / Z").locator("input").first
    x.fill("45")
    x.press("Tab")
    page.locator("#insp button", has_text="套用（寫入時間軸）").click()
    n1 = js(page, "(() => { const a = BlockingPRO.store.project.actors.find((x) => x.id === 'woman'); return [...a.actions, ...a.upper].filter((c) => c.type === 'pose').length; })()")
    posing = js(page, "!!BlockingPRO.store.posing")
    ok = (r_field and abs(r_field[0] - 30) < 0.01 and grab and r_ring and r_ring != r_field and r_mirror
          and any(abs(v) > 1e-6 for v in r_mirror) and r_reset == 0 and n1 == n0 + 1 and not posing)
    return bool(ok), (f"關節 {jname}：欄位 {r_field}，旋轉環 {'抓到' if grab else '沒抓到'} {r_ring}，"
                      f"鏡像 {mirror} {r_mirror}，歸零後剩 {r_reset} 個，姿勢片段 {n0} → {n1}")


def c_splitter(page):
    w0 = page.locator("#library").bounding_box()["width"]
    s = page.locator("#splitL").bounding_box()
    drag(page, s["x"] + s["width"] / 2, s["y"] + 200, s["x"] + s["width"] / 2 + 60, s["y"] + 200)
    w1 = page.locator("#library").bounding_box()["width"]
    t = page.locator("#splitT").bounding_box()
    h0 = page.locator("#timeline").bounding_box()["height"]
    drag(page, t["x"] + 300, t["y"] + t["height"] / 2, t["x"] + 300, t["y"] + t["height"] / 2 - 50)
    h1 = page.locator("#timeline").bounding_box()["height"]
    return abs(w1 - w0 - 60) < 3 and abs(h1 - h0 - 50) < 3, f"素材庫寬 {w0:.0f} → {w1:.0f}，時間軸高 {h0:.0f} → {h1:.0f}"


def main() -> int:
    ap = argparse.ArgumentParser(description="BlockingPRO 編輯器操作測試（G015 清單）")
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
    tmp = Path(tempfile.mkdtemp(prefix="bp_ui_"))
    errors, results = [], []
    local = f"http://127.0.0.1:{args.port}/"

    def run(name, fn, *a):
        try:
            ok, detail = fn(*a)
        except Exception as err:  # a missing element or timeout fails this check only
            ok, detail = False, f"執行中斷：{str(err).splitlines()[0]}"
        results.append(bool(ok))
        print(f"{'通過' if ok else '失敗'}  {name}：{detail}", flush=True)

    try:
        folder = make_folder(tmp)
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=not args.headed)
            ctx = browser.new_context(viewport={"width": 1440, "height": 900}, accept_downloads=True)
            ctx.add_init_script("try { localStorage.setItem('blockingpro.tour.done', '1'); } catch {}")
            ctx.route("**/*", lambda r: r.continue_() if r.request.url.startswith(local)
                      else (errors.append(f"拒絕本機以外的請求：{r.request.url}"), r.abort()))
            page = boot(ctx, local)
            page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
            page.on("console", lambda m: errors.append(f"console: {m.text}") if m.type == "error" else None)

            run("開啟資料夾並連結圖片", c_open_folder, page, folder)
            run("MP4 單一攝影機、自訂區間、帶背景圖", c_mp4, page)
            run("分鏡表 PNG", c_sheet, page)
            run("平面圖 PNG", c_overview, page)
            run("環境「選擇圖片…」", c_choose_picture, page, tmp / "bg2.png")
            run("圖片不在瀏覽器時的提示", c_missing_picture, browser, local, folder)
            run("從素材庫加角色與物品", c_library, page)
            run("呈現方式切換", c_display, page)
            run("俯視與透視切換", c_views, page)
            run("對準選取", c_focus, page)
            run("Shift＋點地面加路徑點", c_shift_click, page)
            run("Alt＋拖曳框選（真實按鍵）", c_box_select, page)
            run("時間軸拖曳與拉長動作片段", c_clip_drag, page)
            run("燈光編輯", c_light, page)
            run("屬性面板套用運鏡預設", c_camera_preset, page)
            run("擺姿勢：角度欄位、旋轉環、鏡像、歸零、套用", c_posing, page)
            run("面板分割拖曳", c_splitter, page)
            browser.close()
    finally:
        if server:
            server.terminate()
        shutil.rmtree(tmp, ignore_errors=True)

    results.append(not errors)
    print(f"{'通過' if not errors else '失敗'}  沒有頁面錯誤{'：' + str(len(errors)) + ' 則' if errors else ''}")
    for e in errors[:20]:
        print(f"  {e}")
    print(f"\n{sum(results)}/{len(results)} 項通過")
    return 0 if all(results) else 1


if __name__ == "__main__":
    sys.exit(main())
