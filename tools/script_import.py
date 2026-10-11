"""Turn a screenplay into BlockingPRO skeleton projects: cast, dialogue subtitles, talk gestures and beat markers (k04).

Usage:
    python tools/script_import.py script.txt                        (print the outline only)
    python tools/script_import.py script.txt --out projects/<code>  (also write one folder per scene)

Reads (UTF-8, or Big5 / CP950):
    Chinese:  scene headings 「第1場 公園 日 外」「場2　夜　內　客廳」「S3 公園／日」「內景 客廳 夜」,
              scene info lines 「時間：傍晚」「地點：公園」, cast lines 「人物：小雯（女）、阿凱（男，25歲）」,
              dialogue 「阿凱：小雯！」「阿凱（揮手）：小雯！」「旁白：……」, title lines 「劇名：……」,
              action lines (a leading △ ▲ ※ is dropped; an action line with a colon needs the △).
              A speaker name alone on its line with the text below is not recognised: write 「名字：台詞」.
    Fountain: INT. / EXT. headings, upper-case character cues with the dialogue below, (parentheticals),
              (V.O.) / (O.S.), title page, transitions (CUT TO:), notes [[...]], sections # and synopses =.
Timing is an estimate: dialogue at --cps Chinese characters (or --wps English words) per second, each action line
--action seconds, --gap seconds between beats. A scene longer than --max seconds is split into parts between beats.

Each scene becomes <out>/scene<N>/project.blockingpro.json, or part1.blockingpro.json, part2 ... when split:
    actors    every speaker and cast-line name of the scene; the same id and colour in every scene; lined up 1.2 m
              apart facing the camera; body type from the cast-line note (女 woman, 男 man, 童 child, 老 elder), else man
    upper     a talk clip over each line (none for V.O. / O.S. / narration)
    subtitles one per sentence, with the speaker
    markers   each action line and parenthetical at the time it happens
    camA      one wide camera, so the file opens and passes check_scene before any blocking is written
Blocking, props, cameras and cuts are left for the SKILL (or the editor).
Exit code: 0 done, 1 no dialogue or action found, 2 the script cannot be read or an output file already exists.
"""
import argparse
import math
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from gen_reference import compact_json  # noqa: E402

PALETTE = ["#e07a5f", "#3d5a80", "#81b29a", "#f2cc8f", "#9d4edd", "#2a9d8f", "#e76f51", "#6d597a"]
LIGHT_NAMES = {"day": "白天", "sunset": "黃昏", "night": "夜景", "indoor": "室內"}
TITLE_KEYS = {"劇名", "片名", "標題", "劇本名稱", "title"}
META_KEYS = TITLE_KEYS | {"編劇", "作者", "日期", "版本", "備註", "credit", "author", "authors", "source", "draft date",
                          "date", "contact", "notes", "copyright"}
CAST_KEYS = {"人物", "出場人物", "登場人物", "角色"}
TIME_KEYS = {"時間"}
PLACE_KEYS = {"地點", "場景", "場地"}
NARRATORS = {"旁白", "畫外音", "os", "o.s.", "vo", "v.o.", "narrator"}
OFFSCREEN = re.compile(r"^(?:v\.?o\.?|o\.?s\.?|o\.?c\.?|畫外音|旁白|os|vo)$", re.I)
MIN_LINE, TAIL, SPACING = 1.0, 0.5, 1.2

NUM = "0-9０-９一二三四五六七八九十百零〇"
HEADING = re.compile(rf"^(?:【\s*)?(?:第\s*[{NUM}]+\s*場|場\s*[{NUM}]+|[Ss]\s*\d+(?![0-9A-Za-z])|\d+\s*(?:[.．](?=\s)|、)"
                     r"|(?:INT|EXT|INT\./EXT|EXT\./INT|I/E)(?:\.|\s)|內景|外景)", re.I)
KEY_LINE = re.compile(r"^([^：:]{1,12}?)\s*[：:]\s*(.*)$")
SPEAKER = re.compile(r"^@?([A-Za-z][A-Za-z.' \-]{0,19}?|[^\s：:，,。！？!?、「」『』（）()\[\]【】]{1,6})\s*"
                     r"(?:[（(]([^）)]*)[）)])?\s*[：:]\s*(.*)$")
CUE = re.compile(r"^(?:@(.+?)|([A-Z][A-Z0-9 .'\-]*[A-Z0-9.]))\s*(?:\(([^)]*)\))?\s*\^?$")
TRANSITION = re.compile(r"^(?:>.*|[A-Z][A-Z .']*TO:|FADE (?:IN|OUT)[.:]?|(?:切至|切到|溶至|轉場|淡入|淡出|黑場)[^。]{0,10})$")
PAREN = re.compile(r"[（(]([^）)]*)[）)]")
CAST_ITEM = re.compile(r"([^、，,／/（(]+?)\s*(?:[（(]([^）)]*)[）)])?\s*(?:[、，,／/]|$)")
SENTENCE = re.compile(r".+?(?:[。！？…]+|[.!?]+(?=\s|$))[」』”’）)\"']*|.+$")
CJK = re.compile(r"[㐀-鿿豈-﫿]")
WORD = re.compile(r"[A-Za-z0-9]+(?:'[A-Za-z]+)?")


def read_text(path: Path) -> str:
    data = path.read_bytes()
    for enc in ("utf-8-sig", "cp950"):
        try:
            return data.decode(enc)
        except UnicodeDecodeError:
            pass
    raise ValueError("不是 UTF-8 或 Big5 編碼")


def clean(line: str) -> str:
    line = re.sub(r"\[\[.*?\]\]|/\*.*?\*/", "", line)
    return line.strip().strip("　")


def guess_preset(note: str) -> "str | None":
    age = re.search(r"(\d+)\s*歲", note)
    if age:
        n = int(age.group(1))
        if n < 13:
            return "child"
        if n >= 65:
            return "elder"
    for preset, pat in (("child", r"童|孩|小學|國小|child|kid|boy|girl"), ("elder", r"老|長者|阿嬤|阿公|奶奶|爺爺|elder"),
                        ("woman", r"女|female|woman"), ("man", r"男|male|man")):
        if re.search(pat, note, re.I):
            return preset
    return None


def scene_light(info: str, interior: bool) -> str:
    if interior:
        return "indoor"
    if re.search(r"夜|晚上|深夜|NIGHT", info, re.I):
        return "night"
    if re.search(r"黃昏|傍晚|夕陽|DUSK|SUNSET|EVENING", info, re.I):
        return "sunset"
    return "day"


TIME_WORDS = re.compile(r"^(?:日|夜|白天|晚上|深夜|清晨|早晨|早上|上午|中午|下午|傍晚|黃昏|黎明|凌晨|"
                        r"DAY|NIGHT|MORNING|AFTERNOON|EVENING|DUSK|DAWN|SUNSET|CONTINUOUS|LATER)$", re.I)
SIDE_WORDS = re.compile(r"^(?:內|外|內景|外景|內外|INT\.?|EXT\.?|INT\./EXT\.?|EXT\./INT\.?|I/E\.?)$", re.I)


def finish_scene(sc: dict) -> None:
    """Work out place, interior and lighting from the heading and the 時間／地點 lines."""
    rest = HEADING.sub("", sc["heading"], count=1).strip("】 　")
    tokens = [x for x in re.split(r"[\s　/／,，、|]+|\s[-–]\s", rest) if x and x not in "-–"]
    sides = [x for x in tokens if SIDE_WORDS.match(x)] + ([sc["heading"][:3]] if re.match(r"內景|外景", sc["heading"]) else [])
    interior = any(re.match(r"內(?!外)|INT\.?$", x, re.I) for x in sides) and not any(re.match(r"外|EXT", x, re.I) for x in sides)
    place = " ".join(x for x in tokens if not TIME_WORDS.match(x) and not SIDE_WORDS.match(x))
    sc["place"] = sc.get("place") or place
    if not sides and re.search(r"室內|客廳|房間|臥室|教室|辦公室|餐廳|咖啡廳|廚房|店內", sc["place"]):
        interior = True
    sc["light"] = scene_light(" ".join(tokens) + " " + sc.get("time", ""), interior)


def parse(text: str) -> tuple:
    title, scenes, cast, notes = "", [], {}, []
    cur = None

    def scene() -> dict:
        nonlocal cur
        if cur is None:
            cur = {"heading": "", "beats": [], "names": []}
            scenes.append(cur)
            notes.append("沒有找到場景標題，標題前的內容當成第 1 場")
        return cur

    def person(name: str, note: str = "") -> None:
        name = name.strip()
        if name not in cast:
            cast[name] = {"id": f"actor{len(cast) + 1}", "color": PALETTE[len(cast) % len(PALETTE)], "preset": None}
        if note and not cast[name]["preset"]:
            cast[name]["preset"] = guess_preset(note)
        sc = scene()
        if name not in sc["names"]:
            sc["names"].append(name)

    def line(name: "str | None", paren: str, text: str, voice: bool = True) -> None:
        parens = [paren] if paren else []
        if paren and OFFSCREEN.match(paren.strip()):
            parens, voice = [], False
        parens += [p.strip() for p in PAREN.findall(text) if p.strip()]
        text = PAREN.sub("", text).strip()
        if len(text) > 1 and text[0] in "「『\"“" and text[-1] in "」』\"”":
            text = text[1:-1].strip()
        if name is not None and name.lower() in NARRATORS:
            name, voice = None, False
        if name is not None:
            person(name)
        if not text:
            scene()["beats"].append({"kind": "action", "text": f"{name or '旁白'}：{'、'.join(parens)}"})
        else:
            scene()["beats"].append({"kind": "line", "speaker": name, "text": text, "parens": parens, "voice": voice})

    lines = text.splitlines()
    i, blank = 0, True
    while i < len(lines):
        s = clean(lines[i])
        i += 1
        if not s:
            blank = True
            continue
        was_blank, blank = blank, False
        if s.startswith(("#", "=")):
            continue
        if s.startswith(("△", "▲", "※", "!")):
            scene()["beats"].append({"kind": "action", "text": s.lstrip("△▲※! 　")})
            continue
        if TRANSITION.match(s):
            continue
        if (s.startswith(".") and len(s) > 1 and s[1] not in ". ") or HEADING.match(s):
            cur = {"heading": s.lstrip(".").strip(), "beats": [], "names": []}
            scenes.append(cur)
            continue
        m = KEY_LINE.match(s)
        key = m.group(1).strip().lower() if m else ""
        if key in META_KEYS:
            if key in TITLE_KEYS and not title:
                title = m.group(2).strip()
            continue
        if key in CAST_KEYS:
            for name, note in CAST_ITEM.findall(m.group(2)):
                if name.strip():
                    person(name, note or "")
            continue
        if key in TIME_KEYS:
            scene()["time"] = m.group(2).strip()
            continue
        if key in PLACE_KEYS:
            scene()["place"] = m.group(2).strip()
            continue
        m = SPEAKER.match(s)
        if m:
            name, paren, said = m.group(1).strip(), (m.group(2) or "").strip(), m.group(3).strip()
            while not said and i < len(lines) and clean(lines[i]):
                said = clean(lines[i])
                i += 1
            line(name, paren, said)
            continue
        m = CUE.match(s)
        if m and was_blank and i < len(lines) and clean(lines[i]) and not HEADING.match(clean(lines[i])):
            name, ext = (m.group(1) or m.group(2).title()).strip(), (m.group(3) or "").strip()
            said, parens = [], []
            while i < len(lines) and clean(lines[i]):
                d = clean(lines[i])
                i += 1
                if d.startswith("(") and d.endswith(")"):
                    parens.append(d[1:-1])
                else:
                    said.append(d)
            text = " ".join(said) + "".join(f"({p})" for p in parens)
            line(name, ext, text)
            continue
        scene()["beats"].append({"kind": "action", "text": s})
    for sc in scenes:
        finish_scene(sc)
    return title, [sc for sc in scenes if sc["beats"]], cast, notes


def speak_seconds(text: str, a: argparse.Namespace) -> float:
    return max(MIN_LINE, len(CJK.findall(text)) / a.cps + len(WORD.findall(text)) / a.wps)


def timed(beats: list, a: argparse.Namespace) -> list:
    out, t = [], 0.0
    for b in beats:
        pieces = [] if b["kind"] == "action" else [(x.strip(), speak_seconds(x, a)) for x in SENTENCE.findall(b["text"]) if x.strip()]
        dur = sum(d for _, d in pieces) if pieces else a.action
        out.append({**b, "t": t, "dur": dur, "pieces": pieces})
        t += dur + a.gap
    return out


def length(part: list) -> float:
    """Seconds from the first beat to the end of the last one plus the tail, rounded up to 0.1 (the project duration)."""
    return math.ceil(round((part[-1]["t"] + part[-1]["dur"] - part[0]["t"] + TAIL) * 10, 6)) / 10


def split(beats: list, limit: float) -> list:
    """Fewest parts within the limit (a single beat over it stays whole), cut at the beat starts closest to equal lengths."""
    end = length(beats)
    if end <= limit or len(beats) == 1:
        return [beats]
    for k in range(math.ceil(end / limit), len(beats) + 1):
        cuts = sorted({min(range(1, len(beats)), key=lambda i: abs(beats[i]["t"] - j * end / k)) for j in range(1, k)})
        parts = [beats[a:b] for a, b in zip([0] + cuts, cuts + [len(beats)])]
        if all(length(p) <= limit or len(p) == 1 for p in parts):
            return parts
    return [[b] for b in beats]


def r2(x: float) -> float:
    return round(x, 2)


def label40(text: str) -> str:
    return text if len(text) <= 40 else text[:39] + "…"


def build(sc: dict, n: int, part: list, k: int, total: int, cast: dict, title: str) -> dict:
    start = part[0]["t"]
    duration = length(part)
    markers, subs, talks = [], [], {}
    for b in part:
        t0 = r2(b["t"] - start)
        if b["kind"] == "action":
            markers.append({"t": t0, "label": label40(b["text"])})
            continue
        aid = cast[b["speaker"]]["id"] if b["speaker"] else None
        if b["parens"]:
            markers.append({"t": t0, "label": label40(f"{b['speaker'] or '旁白'}：{'、'.join(b['parens'])}")})
        if aid and b["voice"]:
            talks.setdefault(aid, []).append({"type": "talk", "start": t0, "dur": r2(b["dur"])})
        t = b["t"] - start
        for text, d in b["pieces"]:
            subs.append({"t": r2(t), "dur": r2(d), "text": text[:200], **({"actor": aid} if aid else {})})
            t += d
    names = sc["names"]
    actors = [{
        "id": cast[name]["id"], "name": name, "kind": "human", "preset": cast[name]["preset"] or "man",
        "color": cast[name]["color"], "facing": "fixed", "yaw": 0,
        "path": {"keys": [{"t": 0, "v": [r2((i - (len(names) - 1) / 2) * SPACING), 0, 0]}]},
        **({"upper": talks[cast[name]["id"]]} if cast[name]["id"] in talks else {}),
    } for i, name in enumerate(names)]
    name = " ".join(x for x in (title, f"第 {n} 場", sc["place"]) if x) + (f"（第 {k} 段，共 {total} 段）" if total > 1 else "")
    return {
        "format": "blockingpro", "version": 1, "name": name,
        "settings": {"width": 1280, "height": 720, "fps": 30, "duration": duration, "lighting": sc["light"], "markers": markers},
        "actors": actors, "props": [], "lights": [],
        "cameras": [{"id": "camA", "name": "A 機 全景", "path": {"keys": [{"t": 0, "v": [0, 1.6, r2(max(5, 2.5 + len(names) * SPACING))]}]},
                     "aim": {"mode": "point", "keys": [{"t": 0, "v": [0, 1, 0]}]}, "lens": 28}],
        "cuts": [{"t": 0, "camera": "camA", "note": "全景（劇本匯入的預設機位，走位和攝影機還沒寫）"}],
        "subtitles": subs, "assets": [],
    }


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser(description="把劇本轉成 BlockingPRO 骨架專案（角色、對白字幕、說話手勢、節拍標記）")
    ap.add_argument("script", help="劇本文字檔（UTF-8 或 Big5）")
    ap.add_argument("--out", help="寫出專案的資料夾，每一場一個子資料夾；不給就只列出大綱")
    ap.add_argument("--cps", type=float, default=4, help="中文台詞每秒字數，預設 4")
    ap.add_argument("--wps", type=float, default=2.5, help="英文台詞每秒字數（word），預設 2.5")
    ap.add_argument("--action", type=float, default=2, help="每行動作描述的秒數，預設 2")
    ap.add_argument("--gap", type=float, default=0.3, help="節拍之間的間隔秒數，預設 0.3")
    ap.add_argument("--max", type=float, default=15, help="每段上限秒數，超過就拆段，預設 15（Seedance 2.0）")
    a = ap.parse_args()
    src = Path(a.script)
    try:
        title, scenes, cast, notes = parse(read_text(src))
    except (OSError, ValueError) as err:
        print(f"讀不到劇本 {src}：{err}", file=sys.stderr)
        return 2
    if not scenes:
        print(f"{src} 裡沒有找到台詞或動作描述", file=sys.stderr)
        return 1

    plans = []
    for n, sc in enumerate(scenes, 1):
        beats = timed(sc["beats"], a)
        parts = split(beats, a.max)
        for b in beats:
            if b["dur"] + TAIL > a.max:
                notes.append(f"第 {n} 場有一個節拍約 {b['dur']:.1f} 秒，超過 --max {a.max:g} 秒，單獨成一段，建議拆短")
        plans.append((n, sc, beats, parts))

    out = Path(a.out) if a.out else None
    files = []
    for n, sc, _, parts in plans:
        for k, part in enumerate(parts, 1):
            name = "project.blockingpro.json" if len(parts) == 1 else f"part{k}.blockingpro.json"
            files.append((out / f"scene{n}" / name if out else None, build(sc, n, part, k, len(parts), cast, title)))
    if out:
        exists = [str(f) for f, _ in files if f.exists()]
        if exists:
            print("這些檔案已經存在，沒有寫出任何檔案（換一個 --out 資料夾，或先把舊檔改名）：\n  " + "\n  ".join(exists), file=sys.stderr)
            return 2

    print(f"劇本：{src}" + (f"　劇名：{title}" if title else ""))
    print("角色：" + "、".join(f"{name} {c['id']} {c['preset'] or 'man（體型未標示）'}" for name, c in cast.items()) if cast else "角色：沒有台詞")
    for n, sc, beats, parts in plans:
        total = length(beats)
        head = sc["heading"] or "（沒有標題）"
        print(f"\n第 {n} 場：{head}　地點 {sc['place'] or '未寫'}　燈光 {sc['light']}（{LIGHT_NAMES[sc['light']]}）　約 {total:.1f} 秒" +
              (f"，拆成 {len(parts)} 段" if len(parts) > 1 else ""))
        for k, part in enumerate(parts, 1):
            if len(parts) > 1:
                print(f"  第 {k} 段（從 {part[0]['t']:.1f} 秒起）")
            for b in part:
                span = f"{b['t'] - part[0]['t']:5.1f} 到 {b['t'] - part[0]['t'] + b['dur']:5.1f} 秒"
                if b["kind"] == "action":
                    print(f"  {span}　動作　{b['text']}")
                else:
                    who = (b["speaker"] or "旁白") + "".join(f"（{p}）" for p in b["parens"]) + ("" if b["voice"] else "〔畫外〕")
                    print(f"  {span}　{who}：{b['text']}")
    if out:
        for f, project in files:
            f.parent.mkdir(parents=True, exist_ok=True)
            f.write_text(compact_json(project) + "\n", encoding="utf-8", newline="\n")
        print("\n寫出：\n  " + "\n  ".join(str(f) for f, _ in files))
    for note in dict.fromkeys(notes):
        print(f"提醒：{note}")
    print("提醒：時間是估計值；只在動作描述出現、沒有台詞也不在「人物：」行的角色沒有建立；走位、物品、攝影機、剪接還沒寫。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
