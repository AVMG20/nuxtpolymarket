"""Paints the Nitro Rush van's livery: python3 scripts/nitro-rush-van/livery.py [out.webp]

One 2048 square atlas, laid out as `build.py` maps it (pixels, origin top left):

    right flank   0,0      1800 x 703   rear of the van on the left; 400 px per metre, the sill 108 px up from the bottom
    left flank    0,703    1800 x 703   front of the van on the left
    front         1800,0    247 x 229
    rear          0,1406    694 x 642
    roof, bonnet  694,1406 1350 x 570   the van's length runs left (tail) to right (nose)

Artwork has to sit inside its own rectangle: anything that crosses into the next one lands on another panel.
To repaint the van, edit this script or paint over the file it writes; the model never needs to change.
Needs Pillow and the macOS system fonts named below.
"""
import math
import random
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parents[2] / 'public/games/nitro-rush/van-livery.webp'

# Everything is drawn at twice the size and scaled down, for clean edges.
SS = 2
ATLAS = 2048

BASE = (140, 211, 246)
HEART = (84, 172, 234)
NAVY = (22, 34, 128)
ROYAL = (36, 76, 208)
WHITE = (255, 255, 255)
SHUT = (44, 108, 168)
SHUT_LIGHT = (196, 236, 252)
CLEAR = (0, 0, 0, 0)

FONTS = '/System/Library/Fonts/'
SCRIPT = (FONTS + 'Supplemental/SignPainter.ttc', 1)
BLOCK = (FONTS + 'Avenir Next.ttc', 9)

NAME = "Bonnie Blue's"
TITLE = 'BANG BUS'
TAGLINE = 'NITRO RUSH TOUR'


def font(spec, size):
    return ImageFont.truetype(spec[0], size, index=spec[1])


def heart_points(cx, cy, size, angle=0.0, steps=72):
    pts = []
    for i in range(steps + 1):
        t = i / steps * math.tau
        x = 16 * math.sin(t) ** 3 / 34
        y = -(13 * math.cos(t) - 5 * math.cos(2 * t) - 2 * math.cos(3 * t) - math.cos(4 * t)) / 34
        pts.append((cx + (x * math.cos(angle) - y * math.sin(angle)) * size, cy + (x * math.sin(angle) + y * math.cos(angle)) * size))
    return pts


def hearts(img, ppm, seed):
    """Upright outlined hearts in a deeper blue, with tiny white ones sprinkled between them."""
    rng = random.Random(seed)
    d = ImageDraw.Draw(img)
    w, h = img.size
    placed = []
    area = w * h / (ppm * ppm)
    for _ in range(int(area * 70)):
        size = rng.uniform(0.17, 0.44) * ppm
        x, y = rng.uniform(0, w), rng.uniform(0, h)
        if any(math.hypot(x - px, y - py) < (size + ps) * 0.58 for px, py, ps in placed):
            continue
        placed.append((x, y, size))
        d.line(heart_points(x, y, size, rng.uniform(-0.14, 0.14)), fill=HEART, width=max(2, round(0.014 * ppm)), joint='curve')
    for _ in range(int(area * 5)):
        size = rng.uniform(0.05, 0.08) * ppm
        x, y = rng.uniform(0, w), rng.uniform(0, h)
        if any(math.hypot(x - px, y - py) < ps * 0.62 for px, py, ps in placed):
            continue
        d.polygon(heart_points(x, y, size), fill=WHITE)


def wordmark():
    """The name: script over heavy leaning capitals on a navy backing, heart arcs rising behind it,
    a swoosh underneath that ends in a heart, and the tour's tagline below."""
    title_font = font(BLOCK, 400)
    name_font = font(SCRIPT, 360)
    box = title_font.getbbox(TITLE)
    tw, th = box[2] - box[0], box[3] - box[1]
    left, top = 260, 560
    size = (tw + 760, th + 1000)
    title_at = (left - box[0], top - box[1])
    name_at = (left + 30, top - 330)
    name_turn = (4.5, (left + 30, top - 120))

    def lettering(fill, stroke, stroke_fill, shift=(0, 0)):
        """Both lines on one layer; the script is tipped up to the right."""
        name = Image.new('RGBA', size, CLEAR)
        ImageDraw.Draw(name).text((name_at[0] + shift[0], name_at[1] + shift[1]), NAME, font=name_font, fill=fill, stroke_width=stroke, stroke_fill=stroke_fill)
        layer = name.rotate(name_turn[0], resample=Image.BICUBIC, center=name_turn[1])
        ImageDraw.Draw(layer).text((title_at[0] + shift[0], title_at[1] + shift[1]), TITLE, font=title_font, fill=fill, stroke_width=stroke, stroke_fill=stroke_fill)
        return layer

    img = Image.new('RGBA', size, CLEAR)
    d = ImageDraw.Draw(img)
    right = left + tw
    base = top + th

    # Heart arcs behind the right half: blue, white, blue. Only the lobes show; the rest hides behind the backing.
    arcs = Image.new('RGBA', size, CLEAR)
    ad = ImageDraw.Draw(arcs)
    arc = heart_points(left + tw * 0.83, top - 30, tw * 0.62)
    ad.line(arc, fill=WHITE, width=96, joint='curve')
    ad.line(arc, fill=ROYAL, width=76, joint='curve')
    ad.line(arc, fill=WHITE, width=30, joint='curve')
    ad.rectangle((0, base - 60, size[0], size[1]), fill=CLEAR)
    img.alpha_composite(arcs)

    # The swoosh: a ribbon under the letters, pointed at both ends and fattest past the middle.
    x0, x1 = left - 150, right + 110
    upper, lower = [], []
    for i in range(61):
        t = i / 60
        x = x0 + (x1 - x0) * t
        y = base + 74 - 96 * t ** 1.6
        upper.append((x, y - 6))
        lower.append((x, y + 22 + 132 * math.sin(math.pi * t ** 0.8) ** 0.9))
    d.polygon(upper + lower[::-1], fill=NAVY)
    d.line([(x, (y + lower[i][1]) / 2 + 6) for i, (x, y) in enumerate(upper)][8:50], fill=WHITE, width=9, joint='curve')

    # A white keyline round the navy backing, then the letters with a royal blue drop.
    img.alpha_composite(lettering(WHITE, 54, WHITE))
    img.alpha_composite(lettering(NAVY, 42, NAVY))
    img.alpha_composite(lettering(ROYAL, 0, None, (10, 13)))
    img.alpha_composite(lettering(WHITE, 0, None))

    # The heart the swoosh ends in.
    cx, cy = right + 96, base - 52
    d = ImageDraw.Draw(img)
    d.polygon(heart_points(cx, cy, 330, 0.12), fill=WHITE)
    d.polygon(heart_points(cx, cy, 300, 0.12), fill=NAVY)
    d.polygon(heart_points(cx, cy, 210, 0.12), fill=WHITE)

    # Tagline, a heart before it and a rule either side.
    tag_font = font(BLOCK, 118)
    tb = tag_font.getbbox(TAGLINE)
    tag_w = tb[2] - tb[0]
    mid = (left + right) / 2 + 20
    y = base + 300
    text_x = mid - tag_w / 2 + 70
    d.text((text_x - tb[0], y - (tb[1] + tb[3]) / 2), TAGLINE, font=tag_font, fill=NAVY)
    d.polygon(heart_points(text_x - 82, y + 4, 128), fill=NAVY)
    for a, b in ((text_x - 400, text_x - 170), (text_x + tag_w + 40, text_x + tag_w + 270)):
        d.line((a, y + 4, b, y + 4), fill=NAVY, width=9)
    return img.crop(img.getbbox())


def tag():
    """The tagline again as a navy pill, for the cab doors."""
    f = font(BLOCK, 112)
    box = f.getbbox(TAGLINE)
    w, h = box[2] - box[0] + 330, 210
    img = Image.new('RGBA', (w, h), CLEAR)
    d = ImageDraw.Draw(img)
    d.rounded_rectangle((0, 0, w - 1, h - 1), h // 2, fill=NAVY)
    d.rounded_rectangle((12, 12, w - 13, h - 13), h // 2 - 12, outline=WHITE, width=7)
    d.polygon(heart_points(118, h / 2 + 4, 120), fill=WHITE)
    d.text((210 - box[0], h / 2 - (box[1] + box[3]) / 2), TAGLINE, font=f, fill=WHITE)
    return img


MARK = wordmark()
TAG_IMG = tag()


def place(img, art, cx, cy, width, turn=0):
    """Pastes `art` `width` pixels wide, centred on (cx, cy)."""
    scaled = art.resize((round(width), round(width * art.height / art.width)), Image.LANCZOS)
    if turn:
        scaled = scaled.rotate(turn, expand=True, resample=Image.BICUBIC)
    img.alpha_composite(scaled, (round(cx - scaled.width / 2), round(cy - scaled.height / 2)))


def shut(d, pts, ppm):
    """A panel gap: a dark line with a thin highlight beside it, where the next panel's edge catches the light."""
    w = max(2, round(0.006 * ppm))
    d.line([(x + w, y + w) for x, y in pts], fill=SHUT_LIGHT, width=max(1, w // 2), joint='curve')
    d.line(pts, fill=SHUT, width=w, joint='curve')


def region(w, h, ppm, seed):
    img = Image.new('RGBA', (w * SS, h * SS), (*BASE, 255))
    hearts(img, ppm * SS, seed)
    return img


def flank(right):
    """One side, as someone standing beside the van sees it."""
    ppm = 400 * SS
    img = region(1800, 703, 400, 11 if right else 23)
    d = ImageDraw.Draw(img)
    x = (lambda y: (y + 2.25) * ppm) if right else (lambda y: (2.25 - y) * ppm)
    z = lambda v: (703 * SS) - v * ppm
    # Shut lines: the cab door, up over its window and down round the wheel arch, and the sliding door behind it.
    shut(d, [(x(0.42), z(0.33)), (x(0.42), z(1.64)), (x(0.86), z(1.64)), (x(1.37), z(1.14)), (x(1.37), z(0.9))], ppm)
    shut(d, [(x(0.42), z(0.33)), (x(0.94), z(0.33))], ppm)
    shut(d, [(x(-0.72), z(0.33)), (x(-0.72), z(1.64)), (x(0.42), z(1.64))], ppm)
    shut(d, [(x(-0.72), z(0.33)), (x(0.42), z(0.33))], ppm)
    # The filler flap behind the cab door.
    d.rounded_rectangle((min(x(0.3), x(0.16)), z(0.62), max(x(0.3), x(0.16)), z(0.48)), round(0.02 * ppm), outline=SHUT, width=max(2, round(0.005 * ppm)))
    # The name fills the panel between the rear arch and the cab door, clear of the roof's curve and the arch.
    place(img, MARK, x(-0.6), z(1.2), 1.62 * ppm)
    place(img, TAG_IMG, x(0.82), z(0.89), 0.62 * ppm)
    return img


def rear():
    ppm = 694 / 1.9 * SS
    img = region(694, 642, 694 / 1.9, 37)
    d = ImageDraw.Draw(img)
    x = lambda v: (v + 0.95) * ppm
    z = lambda v: (642 * SS) - v * ppm
    # The two doors: the split between them and the line round them.
    shut(d, [(x(0), z(0.64)), (x(0), z(1.62))], ppm)
    shut(d, [(x(-0.7), z(0.64)), (x(-0.7), z(1.62)), (x(0.7), z(1.62)), (x(0.7), z(0.64))], ppm)
    place(img, MARK, x(0.02), z(1.33), 1.06 * ppm)
    return img


def top():
    """Roof and bonnet, drawn nose down: the bonnet reads from ahead of the van, the roof from the chase camera behind it."""
    ppm = 300 * SS
    img = region(570, 1350, 300, 53)
    x = lambda v: (0.95 - v) * ppm
    y = lambda v: (v + 2.25) * ppm
    d = ImageDraw.Draw(img)
    # The bonnet's shut line: across under the screen and forward along each wing.
    shut(d, [(x(0.69), y(2.12)), (x(0.69), y(1.63)), (x(-0.69), y(1.63)), (x(-0.69), y(2.12))], ppm)
    place(img, MARK, x(0), y(1.87), 0.8 * ppm)
    place(img, MARK, x(0), y(-0.7), 1.05 * ppm, 180)
    return img


def front():
    return region(247, 229, 130, 71)


def small(img):
    return img.resize((img.width // SS, img.height // SS), Image.LANCZOS)


atlas = Image.new('RGBA', (ATLAS, ATLAS), (*BASE, 255))
atlas.paste(small(flank(True)), (0, 0))
atlas.paste(small(flank(False)), (0, 703))
atlas.paste(small(front()), (1800, 0))
atlas.paste(small(rear()), (0, 1406))
# Turned onto its side to fit: the atlas keeps the van's length along x.
atlas.paste(small(top()).transpose(Image.TRANSPOSE), (694, 1406))
OUT.parent.mkdir(parents=True, exist_ok=True)
atlas.convert('RGB').save(OUT, quality=92, method=6)
print('mark', MARK.size, 'aspect', round(MARK.width / MARK.height, 2))
print('wrote', OUT, OUT.stat().st_size // 1024, 'KB')
