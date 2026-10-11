"""Compare a reference still with a BlockingPRO render of the same shot.

    python tools/compare_ref.py ref.png render.png [--out compare.png] [--grid 80]

Writes one image: left = 50/50 blend, right = edge overlay (red = reference edges, green = render edges,
yellow = both). Both halves carry a pixel grid so offsets can be read off. The render is resized to the
reference size. Used by the SKILL section "參考圖反推機位"; render the candidate camera with
check_scene.py --camera <id> --times <t>.
"""
import argparse
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter


def edges(im: Image.Image) -> Image.Image:
    return im.convert("L").filter(ImageFilter.FIND_EDGES).point(lambda v: 255 if v > 18 else 0)


def grid(im: Image.Image, step: int, line, text) -> None:
    d = ImageDraw.Draw(im)
    for x in range(0, im.width, step):
        d.line([(x, 0), (x, im.height)], fill=line)
        d.text((x + 2, 2), str(x), fill=text)
    for y in range(0, im.height, step):
        d.line([(0, y), (im.width, y)], fill=line)
        d.text((2, y + 2), str(y), fill=text)


def main() -> int:
    ap = argparse.ArgumentParser(description="參考圖與渲染圖比對（混合與邊緣疊圖）")
    ap.add_argument("ref")
    ap.add_argument("render")
    ap.add_argument("--out", help="輸出檔，預設是 render 旁的 <render>_cmp.png")
    ap.add_argument("--grid", type=int, default=80, help="格線間距（像素）")
    args = ap.parse_args()
    sys.stdout.reconfigure(encoding="utf-8")

    try:
        ref = Image.open(args.ref).convert("RGB")
        ren = Image.open(args.render).convert("RGB")
    except OSError as err:
        print(f"錯誤：讀不到圖片：{err}")
        return 2
    if ren.size != ref.size:
        print(f"提醒：渲染圖 {ren.size[0]}x{ren.size[1]} 縮放成參考圖的 {ref.size[0]}x{ref.size[1]}；比例不同時畫面會變形，請讓專案 settings 的寬高比和參考圖相同")
        ren = ren.resize(ref.size)

    blend = Image.blend(ref, ren, 0.5)
    grid(blend, args.grid, (0, 255, 255), (255, 255, 0))
    overlay = Image.merge("RGB", (edges(ref), edges(ren), Image.new("L", ref.size, 0)))
    grid(overlay, args.grid, (40, 40, 160), (255, 255, 255))

    out = Image.new("RGB", (ref.width * 2, ref.height))
    out.paste(blend, (0, 0))
    out.paste(overlay, (ref.width, 0))
    path = Path(args.out) if args.out else Path(args.render).with_name(Path(args.render).stem + "_cmp.png")
    out.save(path)
    print(path)
    return 0


if __name__ == "__main__":
    sys.exit(main())
