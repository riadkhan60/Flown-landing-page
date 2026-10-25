# Flown landing page

The marketing page for [Flown](https://github.com/samiulakhan12/windows-screen-studio), a free,
open-source screen recorder for Windows.

It is a static page with no dependencies: one HTML file, one stylesheet and one small script. A
small build inlines the stylesheet into the page for production. Everything is served from the
site itself, fonts included, so a visit makes four requests: the page, one font file, the demo
script and the favicon.

```
index.html           the page
styles.css           all styles; colour and type tokens are at the top
demo.js              the editor demo in the hero
assets/              the app icon (favicon) and the fonts
scripts/build.mjs    builds the deployable site into dist/
tools/build-fonts.py rebuilds the fonts in assets/fonts when the copy changes
vercel.json          build and caching settings for Vercel
```

## Preview

`demo.js` is an ES module, so open the page through a local server rather than from the file system:

```bash
python3 -m http.server 4173
# then open http://localhost:4173
```

To preview what gets deployed, build the site and serve `dist/` instead:

```bash
npm run build
python3 -m http.server 4173 -d dist
```

## Build

`npm run build` (or `node scripts/build.mjs`) writes the deployable site to `dist/`. It needs Node 18
or later and nothing else; there is no `npm install`.

- `styles.css` goes into a `<style>` element, so the first paint doesn't wait for a second download.
- The files the page loads (`demo.js`, the favicon, the fonts) are copied into `dist/immutable/`
  under names that carry their content hash (`demo.<hash>.js`), and the page's references are
  updated to match. A name that already holds its hash, like the fonts', is kept. `assets/` is also
  copied as it is, so the font licence and any outside links to those files keep working.
- Comments, and whitespace that can't change the result, are removed from the HTML and the CSS.
  Apart from pointing `src`, `href` and `url()`s at the published copies, nothing else is
  rewritten: text, values and strings are copied as they are.
- The build stops if the page refers to a local file that doesn't exist.

The build prints the page's compressed size. Keep it under about 14 KB as Vercel serves it, which is
brotli at quality 3 rather than at its smallest: that is what a new connection delivers in its
first round trip, so the page and all of its styles arrive at once.
Going over adds a round trip before the page is complete (about 170 ms on a slow phone connection),
and the build warns when that happens.

`demo.js` stays a file of its own for the same reason: inlined, it would take the page past the
first round trip. On its own it downloads alongside the font, and the first paint doesn't need it,
because the hero frame is also fitted to the stage in CSS.

## Deploy

On Vercel, import the repository. `vercel.json` runs the build, serves `dist/` and sets the caching:

- Everything under `/immutable/` is cached for a year as immutable. Each file there is named after
  its content, so a changed file gets a new URL.
- Everything else, the page included, is revalidated on every visit, so a new deploy shows up
  straight away. An unchanged file is answered with a short 304.

Other static hosts work the same way: set the build command to `npm run build`, the output
directory to `dist`, and give `/immutable/*` the same long cache. The repository root also works
unbuilt; it is just slower to first paint, because the stylesheet is a separate request.

## The hero demo

The editor in the hero is HTML and CSS, not a video. `demo.js` draws every frame as a function of
time, the same way Flown's own compositor does, so playing, scrubbing and looping all share one
`render(t)`:

- `PATH` is the cursor's route through the recorded app, and `CLICKS` are the click times.
- `CAMERA` holds the zoom keys: a level and what the camera looks at (the frame, the cursor, or a fixed point).
- The recorded app is laid out in a fixed 1280 × 720 frame and scaled to fit, so the positions in
  `PATH` and `CAMERA` stay in step with the markup in `index.html`. If you move something in the
  app, update its coordinates in `demo.js`.

The demo plays while it is on screen and stops when it scrolls away. With *reduce motion* turned on,
it starts paused on a zoomed-in frame. The playhead can be dragged, or moved with the arrow keys
(hold Shift for one-second steps).

`render(t)` only writes what changed since the last frame. While the demo plays, the parts that
move or fade over the recording (cursor, ripple, toasts, palette and its scrim) and the playhead get
compositor layers of their own; the overlays live in `.card-over`, outside the card's rounded clip,
for that reason. Paused, everything is drawn as one picture again, so a paused frame looks the same
however you got to it.

## Fonts

Archivo is self-hosted in `assets/fonts` under the SIL Open Font License (`assets/fonts/OFL.txt`),
cut down to the widths the page uses. It comes in two files, split by `unicode-range`:

- `archivo-<hash>.woff2` holds exactly the characters on the page and is preloaded.
- `archivo-ext-<hash>.woff2` holds the rest of ASCII and Latin-1 and the usual punctuation. It only
  downloads if the page uses one of its characters.

Until the font arrives, text is set in Arial scaled to Archivo's widths and line height
(`Archivo Fallback` and, for the wide headings, `Archivo Wide Fallback`), so nothing moves when it
swaps in. If you set something new in the wide style, give it `font-family: var(--font-wide)` too.

When the copy gains a character, the page still works: the character comes from the ext file, at
the cost of a second download. To fold it into the preloaded file, run

```bash
pip install fonttools brotli
python3 tools/build-fonts.py <archivo-latin.woff2>
```

(the script's header says where to get the source file), then copy the printed file names and
`unicode-range`s into the `@font-face` rules in `styles.css` and the preload in `index.html`. The
script fails if the page uses a character neither file has.

## Before launch

- The Download buttons point to the app's
  [GitHub releases](https://github.com/samiulakhan12/windows-screen-studio/releases). Publish a
  release with the installer there, or change the three `releases` links in `index.html` to wherever
  the installer lives.
- The FAQ says the installer isn't code-signed yet. Update that answer once releases are signed.
