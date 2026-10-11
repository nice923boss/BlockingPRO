"""List what changed between two BlockingPRO projects, entity by entity.

Usage:
    python tools/project_diff.py before.blockingpro.json after.blockingpro.json

Actors, props, lights, cameras, custom assets and groups are matched by id, cuts by their time, so moving an entry
within its list is not a change. Prints one line per changed field: "path: old → new". In a list (for example
path.keys), a removed entry is numbered as in the old file and an added one as in the new file.
Used by the SKILL after editing an existing project, to confirm that only the requested shots or actors changed.
Exit code: 0 same, 1 different, 2 a file cannot be read.
"""
import difflib
import json
import sys
from pathlib import Path

LISTS = {"actors": "角色", "props": "物品", "lights": "燈", "cameras": "攝影機", "assets": "自訂物品", "groups": "群組"}


def short(value, limit=90) -> str:
    text = json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    return text if len(text) <= limit else text[: limit - 1] + "…"


def fields(a, b, path: str, out: list) -> None:
    """Append a line for every leaf that differs between a and b."""
    if isinstance(a, dict) and isinstance(b, dict):
        for k in [*a, *(k for k in b if k not in a)]:
            p = f"{path}.{k}" if path else k
            if k not in b:
                out.append(f"{p}：刪除（原本 {short(a[k])}）")
            elif k not in a:
                out.append(f"{p}：新增 {short(b[k])}")
            else:
                fields(a[k], b[k], p, out)
    elif isinstance(a, list) and isinstance(b, list) and any(isinstance(x, (dict, list)) for x in a + b):
        sa, sb = [short(x, 10**9) for x in a], [short(x, 10**9) for x in b]
        for op, i1, i2, j1, j2 in difflib.SequenceMatcher(None, sa, sb, autojunk=False).get_opcodes():
            if op == "equal":
                continue
            if op == "replace" and i2 - i1 == j2 - j1:
                for i, j in zip(range(i1, i2), range(j1, j2)):
                    fields(a[i], b[j], f"{path}[{j}]", out)
                continue
            out += [f"{path}[{i}]：刪除 {short(a[i])}" for i in range(i1, i2)]
            out += [f"{path}[{j}]：新增 {short(b[j])}" for j in range(j1, j2)]
    elif a != b:
        out.append(f"{path}：{short(a)} → {short(b)}")


def keyed(items, key) -> dict:
    return {key(x): x for x in items if isinstance(x, dict)} if isinstance(items, list) else {}


def compare(old: dict, new: dict) -> list:
    """[(heading, [field lines])] for every entity, cut or top-level field that differs."""
    report = []

    def entity(heading, a, b):
        if a is None:
            report.append((f"{heading}：新增", []))
        elif b is None:
            report.append((f"{heading}：刪除", []))
        else:
            lines = []
            fields(a, b, "", lines)
            if lines:
                report.append((f"{heading}：修改", lines))

    for top in [*old, *(k for k in new if k not in old)]:
        a, b = old.get(top), new.get(top)
        if top in LISTS:
            ma, mb = keyed(a or [], lambda x: x.get("id")), keyed(b or [], lambda x: x.get("id"))
            for i in [*ma, *(i for i in mb if i not in ma)]:
                e = mb.get(i) or ma.get(i)
                entity(f"{LISTS[top]} {i}" + (f"（{e['name']}）" if e.get("name") else ""), ma.get(i), mb.get(i))
        elif top == "cuts":
            ma, mb = keyed(a or [], lambda x: x.get("t")), keyed(b or [], lambda x: x.get("t"))
            order = sorted(mb)
            for t in sorted({*ma, *mb}, key=float):
                n = f"鏡 {order.index(t) + 1}，" if t in mb else ""
                entity(f"剪接 {n}{t} 秒", ma.get(t), mb.get(t))
        elif isinstance(a, dict) and isinstance(b, dict):
            entity(top, a, b)
        else:
            entity(top, None if a is None else {top: a}, None if b is None else {top: b})
    return report


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    if len(sys.argv) != 3:
        print(__doc__)
        return 2
    projects = []
    for name in sys.argv[1:]:
        try:
            projects.append(json.loads(Path(name).read_text(encoding="utf-8-sig")))
        except (OSError, json.JSONDecodeError) as err:
            print(f"錯誤：讀不到或不是有效的 JSON：{name}（{err}）")
            return 2
    report = compare(*projects)
    if not report:
        print("兩個專案內容相同")
        return 0
    for heading, lines in report:
        print(heading)
        for line in lines:
            print(f"  {line}")
    print(f"共 {len(report)} 項不同")
    return 1


if __name__ == "__main__":
    sys.exit(main())
