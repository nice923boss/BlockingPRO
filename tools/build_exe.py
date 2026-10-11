"""Build BlockingPRO.exe (Windows) so the editor runs without installing Python.

    python tools/build_exe.py

Needs PyInstaller (pip install pyinstaller). Packs tools/serve.py into one exe and puts it in the BlockingPRO folder.
The exe only replaces start.bat: it serves the folder it sits in (index.html, js, vendor, library, projects stay as
plain files, so the prop and pose libraries are still saved there), opens the browser, and stops when its window
is closed. Moving the exe out of the BlockingPRO folder makes it refuse to start.
"""
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")
    try:
        import PyInstaller  # noqa: F401
    except ImportError:
        print("錯誤：沒有安裝 PyInstaller，請先執行 python -m pip install pyinstaller")
        return 2
    work = Path(tempfile.mkdtemp(prefix="bp_exe_"))
    try:
        cmd = [sys.executable, "-m", "PyInstaller", "--onefile", "--console", "--noconfirm", "--clean",
               "--name", "BlockingPRO", "--distpath", str(ROOT), "--workpath", str(work / "build"),
               "--specpath", str(work), str(ROOT / "tools" / "serve.py")]
        if subprocess.run(cmd).returncode != 0:
            print("錯誤：PyInstaller 打包失敗，訊息見上方")
            return 1
    finally:
        shutil.rmtree(work, ignore_errors=True)
    exe = ROOT / "BlockingPRO.exe"
    print(f"\n完成：{exe}（{exe.stat().st_size / 1024 / 1024:.1f} MB）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
