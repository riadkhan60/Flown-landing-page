# Builds the self-hosted Archivo in assets/fonts from the Google Fonts variable font.
#
# Source: the "latin" file listed by
#   https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,100..900
# (fetched with a current Chrome user agent; v25 is k3kQo8UDI-1M0wlSfdnoLg.woff2).
#
#   pip install fonttools brotli
#   python3 tools/build-fonts.py <archivo-latin.woff2>
#
# then put the printed file names and unicode-ranges into the @font-face rules in
# styles.css and the preload in index.html.
#
# The width axis is cut to 100..125, the widths the page uses. 100 is the default and
# 125 the old maximum, so no deltas are rescaled and every outline, advance and kerning
# value is unchanged at the coordinates the page uses. Limiting weight to the page's
# 400..780 too would save another 3 KB, but it rescales and rounds the deltas, which
# shows up as changed pixels.
#
# Two files: "core" has every character the page uses plus ASCII and the usual
# punctuation, and is preloaded. "ext" has the rest of Latin-1 and is only downloaded
# if the page ever uses one of its characters. Same input, same bytes, same names.

import hashlib
import html.parser
import os
import re
import sys

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'assets', 'fonts')

CORE = sorted(
    set(range(0x20, 0x7F))
    | {0xA0, 0xAD, 0xD7}                   # nbsp, soft hyphen, ×
    | set(map(ord, '–—‘’“”•…'))
)
EXT = sorted(
    set(map(ord, '©®°·«»÷±£¥¢'))
    | {u for u in range(0xC0, 0x100) if chr(u).isalpha()}
    | set(map(ord, 'ıŒœ‚„′″‹›€™−'))
)


def build(src, unicodes):
    font = instancer.instantiateVariableFont(TTFont(src), {'wdth': (100, 125)}, updateFontNames=False)
    font['fvar'].instances = []  # named instances are for font menus
    if 'STAT' in font:
        del font['STAT']
    opts = subset.Options()
    opts.layout_features = ['kern', 'liga', 'tnum', 'rvrn']  # rvrn swaps $ and ¢ from weight 500
    opts.name_IDs = [0, 1, 2, 3, 4, 5, 6, 13, 14]  # keep the copyright and licence records
    opts.notdef_outline = True
    opts.recalc_bounds = True
    opts.flavor = 'woff2'
    sub = subset.Subsetter(opts)
    sub.populate(unicodes=unicodes)
    sub.subset(font)
    font.recalcTimestamp = False  # keep head.modified from the source, so the hash is stable
    return font, opts


def unicode_range(cmap):
    cps, out, i = sorted(cmap), [], 0
    while i < len(cps):
        j = i
        while j + 1 < len(cps) and cps[j + 1] == cps[j] + 1:
            j += 1
        out.append(f'U+{cps[i]:X}' if i == j else f'U+{cps[i]:X}-{cps[j]:X}')
        i = j + 1
    return ', '.join(out)


class TextChars(html.parser.HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.chars, self.skip = set(), 0

    def handle_starttag(self, tag, attrs):
        self.skip += tag in ('script', 'style', 'title')

    def handle_endtag(self, tag):
        self.skip -= tag in ('script', 'style', 'title')

    def handle_data(self, data):
        if not self.skip:
            self.chars |= set(data)


def page_chars():
    p = TextChars()
    with open(os.path.join(ROOT, 'index.html'), encoding='utf-8') as f:
        p.feed(f.read())
    chars = set(p.chars)
    with open(os.path.join(ROOT, 'demo.js'), encoding='utf-8') as f:
        for m in re.finditer(r"'([^'\\\n]*)'|\"([^\"\\\n]*)\"|`([^`]*)`", f.read()):
            chars |= set(next((g for g in m.groups() if g), ''))
    return {c for c in chars if not c.isspace()} | set('0123456789:.')  # the demo's clock


def main(src):
    os.makedirs(OUT, exist_ok=True)
    cmaps, written = {}, set()
    for name, unicodes in (('archivo', CORE), ('archivo-ext', EXT)):
        font, opts = build(src, unicodes)
        tmp = os.path.join(OUT, name + '.tmp')
        subset.save_font(font, tmp, opts)
        with open(tmp, 'rb') as f:
            digest = hashlib.sha256(f.read()).hexdigest()[:8]
        path = os.path.join(OUT, f'{name}-{digest}.woff2')
        os.replace(tmp, path)
        written.add(os.path.basename(path))
        cmaps[name] = font.getBestCmap()
        print(f'{os.path.relpath(path, ROOT)}  {os.path.getsize(path)} bytes')
        print(f'  unicode-range: {unicode_range(cmaps[name])};')
    for old in os.listdir(OUT):
        if old.startswith('archivo-') and old.endswith('.woff2') and old not in written:
            os.remove(os.path.join(OUT, old))

    chars = page_chars()
    missing = sorted(c for c in chars if ord(c) not in cmaps['archivo'] and ord(c) not in cmaps['archivo-ext'])
    in_ext = sorted(c for c in chars if ord(c) not in cmaps['archivo'] and ord(c) in cmaps['archivo-ext'])
    print(f'{len(chars)} characters on the page')
    if in_ext:
        print('  in the ext file, so it will be downloaded too (add them to CORE):', ' '.join(in_ext))
    if missing:
        print('  MISSING from both files (add them to CORE or EXT):', ' '.join(f'{c} U+{ord(c):04X}' for c in missing))
        sys.exit(1)


if __name__ == '__main__':
    if len(sys.argv) != 2:
        sys.exit('usage: python3 tools/build-fonts.py <archivo-latin.woff2>')
    main(sys.argv[1])
