"""Install the blockingpro SKILL into ~/.claude/skills, filling in the real tool folder path.

Usage: python tools/install_skill.py [--dest <skills folder>]
"""
import argparse
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "skill" / "blockingpro"


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description="安裝 blockingpro SKILL")
    parser.add_argument("--dest", default=str(Path.home() / ".claude" / "skills"), help="skills 資料夾")
    args = parser.parse_args()

    target = Path(args.dest) / "blockingpro"
    if target.exists():
        shutil.rmtree(target)
    shutil.copytree(SOURCE, target)

    root_text = ROOT.as_posix()
    for md in target.rglob("*.md"):
        text = md.read_text(encoding="utf-8")
        if "<ROOT>" in text:
            md.write_text(text.replace("<ROOT>", root_text), encoding="utf-8")
    print(f"已安裝到 {target}")
    print(f"ROOT = {root_text}")


if __name__ == "__main__":
    main()
