# Flown landing page

The marketing page for [Flown](https://github.com/samiulakhan12/windows-screen-studio), a free,
open-source screen recorder for Windows.

It is a static page with no dependencies: one HTML file, one stylesheet and one small script. A
small build inlines the stylesheet and the script into the page for production. The only external
request is the Archivo font from Google Fonts.

```
index.html        the page
styles.css        all styles; colour and type tokens are at the top
demo.js           the editor demo in the hero
assets/           the app icon, used as the favicon
scripts/build.mjs builds the deployable site into dist/
vercel.json       build and caching settings for Vercel
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

`npm run build` (or `node scripts/build.mjs`) writes the deployable site to `dist/`. It needs Node 20
or later and nothing else; there is no `npm install`.

- `styles.css` goes into a `<style>` element and `demo.js` into a module script at the end of the
  body, so the first paint doesn't wait for either of them to download. Module scripts run once the
  page has been parsed wherever they sit, so the demo starts at the same moment as before.
- Comments, and whitespace that can't change the result, are removed from the HTML and the CSS.
  Nothing else is rewritten: text, values, strings and `url()`s are copied as they are, and
  `demo.js` is inlined as it is.
- `assets/` is copied over. Files whose names don't already carry a content hash get one
  (`flown-icon.d3241e76fe.svg`), and the references in the page are updated to match.
- The build stops if the page refers to a local file that isn't in `dist/`.

The build prints the page's compressed size. Keep it under about 14 KB with brotli: that is what a
new connection delivers in its first round trip, so the whole page, styles and script included,
arrives at once. Going over adds a round trip before the page is complete (about 170 ms on a slow
phone connection), and the build warns when that happens.

## Deploy

On Vercel, import the repository. `vercel.json` runs the build, serves `dist/` and sets the caching:

- Everything under `/assets/` is cached for a year as immutable. Each file there is named after its
  content, so a changed file gets a new URL.
- The page itself is revalidated on every visit, so a new deploy shows up straight away. An
  unchanged page is answered with a short 304.

Other static hosts work the same way: set the build command to `npm run build`, the output
directory to `dist`, and give `/assets/*` the same long cache. The repository root also works
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

## Before launch

- The Download buttons point to the app's
  [GitHub releases](https://github.com/samiulakhan12/windows-screen-studio/releases). Publish a
  release with the installer there, or change the three `releases` links in `index.html` to wherever
  the installer lives.
- The FAQ says the installer isn't code-signed yet. Update that answer once releases are signed.
