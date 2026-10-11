"""Serve BlockingPRO over http://127.0.0.1 (ES modules and the MP4 encoder need http, not file://).

Usage:
    python tools/serve.py [--port 38940] [--open] [--project projects/<name>]
    BlockingPRO.exe [same options]   (built by tools/build_exe.py; serves the folder it sits in; with no options it opens the browser)

--project opens the editor with that project folder (or project file) already loaded; the path is relative to the
BlockingPRO folder and must be inside it. When the server is already running, the browser is opened and the command exits.

Responses carry Cache-Control: no-cache so edited files show up on a normal reload.
The port stays fixed because drafts (localStorage / IndexedDB) are stored per origin.

API for the libraries shared by every project on this machine:
    GET /api/assets   the custom prop library (library/assets.json), or an empty one when the file does not exist yet
    PUT /api/assets   replace it (JSON body, format "blockingpro-library", at most 5 MB);
                      the previous file is kept as library/assets.bak.json
    GET /api/poses    the pose library (library/poses.json, format "blockingpro-poses", list "poses")
    PUT /api/poses    replace it, same rules (previous file kept as library/poses.bak.json)

Opening a project from the address (index.html?project=projects/<name>):
    GET /api/folder?path=<path>   {"folder": path relative to the BlockingPRO folder, "files": [{"name", "size"}]}:
                                  the files directly inside that folder; a file path gives its folder with only that file.
                                  Paths outside the BlockingPRO folder are refused.
"""
import argparse
import functools
import http.server
import json
import os
import sys
import threading
import urllib.parse
import urllib.request
import webbrowser
from pathlib import Path

# the exe built by tools/build_exe.py sits in the BlockingPRO folder itself
ROOT = Path(sys.executable).resolve().parent if getattr(sys, "frozen", False) else Path(__file__).resolve().parent.parent
# API path -> (file, format, list key, name shown in errors)
LIBRARIES = {
    "/api/assets": (ROOT / "library" / "assets.json", "blockingpro-library", "assets", "素材庫"),
    "/api/poses": (ROOT / "library" / "poses.json", "blockingpro-poses", "poses", "姿勢庫"),
}
MAX_LIBRARY_BYTES = 5 * 1024 * 1024
_write_lock = threading.Lock()


def read_library(path: Path, fmt: str, key: str) -> dict:
    if not path.exists():
        return {"format": fmt, "version": 1, key: []}
    return json.loads(path.read_text(encoding="utf-8-sig"))


def inside_root(rel: str) -> Path:
    """Resolve a path given relative to the BlockingPRO folder; anything that leaves it raises ValueError."""
    target = (ROOT / rel).resolve()
    if not target.is_relative_to(ROOT):
        raise ValueError(f"只能開啟 BlockingPRO 資料夾裡的專案：{rel}")
    return target


def list_folder(rel: str) -> dict:
    target = inside_root(rel)
    if target.is_file():
        folder, files = target.parent, [target]
    elif target.is_dir():
        folder, files = target, sorted(p for p in target.iterdir() if p.is_file())
    else:
        raise FileNotFoundError(f"找不到 {rel}")
    return {"folder": folder.relative_to(ROOT).as_posix(), "files": [{"name": p.name, "size": p.stat().st_size} for p in files]}


def write_library(path: Path, data: dict) -> None:
    text = json.dumps(data, ensure_ascii=False, indent=1)
    with _write_lock:
        path.parent.mkdir(exist_ok=True)
        tmp = path.with_suffix(".tmp")
        tmp.write_text(text, encoding="utf-8")
        if path.exists():
            os.replace(path, path.with_name(path.stem + ".bak.json"))
        os.replace(tmp, path)


class Handler(http.server.SimpleHTTPRequestHandler):
    # Windows registry can map .js to text/plain, which breaks ES modules
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".js": "text/javascript",
        ".mjs": "text/javascript",
        ".json": "application/json",
    }

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def _send_json(self, status: int, data: dict) -> None:
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _from_this_app(self) -> bool:
        """Block writes from other sites open in the same browser (Origin) and DNS rebinding (Host)."""
        port = self.server.server_port
        hosts = {f"127.0.0.1:{port}", f"localhost:{port}"}
        origin = self.headers.get("Origin")
        return self.headers.get("Host", "") in hosts and (origin is None or origin.split("://", 1)[-1] in hosts)

    def do_GET(self):
        url = urllib.parse.urlsplit(self.path)
        if url.path == "/api/folder":
            rel = urllib.parse.parse_qs(url.query).get("path", [""])[0]
            try:
                return self._send_json(200, list_folder(rel))
            except ValueError as err:
                return self._send_json(403, {"error": str(err)})
            except OSError as err:
                return self._send_json(404, {"error": str(err)})
        lib = LIBRARIES.get(url.path)
        if not lib:
            return super().do_GET()
        path, fmt, key, label = lib
        try:
            self._send_json(200, read_library(path, fmt, key))
        except (OSError, ValueError) as err:
            self._send_json(500, {"error": f"讀不到{label}檔案 {path}：{err}"})

    def do_PUT(self):
        lib = LIBRARIES.get(self.path.split("?", 1)[0])
        if not lib:
            return self._send_json(404, {"error": "找不到這個 API"})
        path, fmt, key, label = lib
        if not self._from_this_app():
            return self._send_json(403, {"error": "只接受 BlockingPRO 本機頁面的請求"})
        length = int(self.headers.get("Content-Length") or 0)
        if not 0 < length <= MAX_LIBRARY_BYTES:
            return self._send_json(413, {"error": f"{label}大小不對（{length} bytes，上限 5 MB）"})
        try:
            data = json.loads(self.rfile.read(length).decode("utf-8"))
        except (UnicodeDecodeError, ValueError) as err:
            return self._send_json(400, {"error": f"不是有效的 JSON：{err}"})
        if not isinstance(data, dict) or data.get("format") != fmt or not isinstance(data.get(key), list):
            return self._send_json(400, {"error": f"格式不對：需要 {{\"format\": \"{fmt}\", \"{key}\": [...]}}"})
        try:
            write_library(path, data)
        except OSError as err:
            return self._send_json(500, {"error": f"寫不進{label}檔案 {path}：{err}"})
        self._send_json(200, {"ok": True, "count": len(data[key])})


class Server(http.server.ThreadingHTTPServer):
    # On Windows SO_REUSEADDR lets a second process bind the same port and silently share requests
    allow_reuse_address = False


def already_running(url: str) -> bool:
    try:
        with urllib.request.urlopen(url, timeout=1) as res:
            return b"<title>BlockingPRO</title>" in res.read(2048)
    except OSError:
        return False


def main() -> int:
    ap = argparse.ArgumentParser(description="Serve BlockingPRO locally")
    ap.add_argument("--port", type=int, default=38940)
    ap.add_argument("--open", action="store_true", help="open the editor in the default browser")
    ap.add_argument("--project", help="open the editor with this project folder loaded (relative to the BlockingPRO folder; implies --open)")
    args = ap.parse_args()
    if getattr(sys, "frozen", False):
        args.open = args.open or len(sys.argv) == 1  # double-clicking the exe should show the editor
        if not (ROOT / "index.html").exists():
            print(f"找不到 index.html：BlockingPRO.exe 要放在 BlockingPRO 資料夾裡（目前在 {ROOT}）。", file=sys.stderr)
            return 1
    url = f"http://127.0.0.1:{args.port}/index.html"
    page = url
    if args.project:
        try:
            target = inside_root(args.project)
        except ValueError as err:
            print(f"{err}。其他位置的專案請在編輯器按「開啟資料夾」。", file=sys.stderr)
            return 1
        if not target.exists():
            print(f"找不到專案：{target}", file=sys.stderr)
            return 1
        page = f"{url}?project={urllib.parse.quote(target.relative_to(ROOT).as_posix())}"
        args.open = True
    if already_running(url):
        print(f"BlockingPRO 已在執行：{page}", flush=True)
        if args.open:
            webbrowser.open(page)
        return 0
    handler = functools.partial(Handler, directory=str(ROOT))
    try:
        server = Server(("127.0.0.1", args.port), handler)
    except OSError as err:
        print(f"無法使用連接埠 {args.port}（{err}）。請先關閉占用此連接埠的程式，或執行 stop.bat。", file=sys.stderr)
        return 1
    print(f"BlockingPRO: {page}", flush=True)
    if args.open:
        webbrowser.open(page)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    code = main()
    if code and getattr(sys, "frozen", False):
        input("按 Enter 關閉視窗")  # the exe's console window would close before the error can be read
    sys.exit(code)
