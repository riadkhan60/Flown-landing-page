# Flown landing page

The marketing page for [Flown](https://github.com/samiulakhan12/windows-screen-studio), a free,
open-source screen recorder for Windows.

It is a static page with no build step and no dependencies: one HTML file, one stylesheet and one
small script. The only external request is the Archivo font from Google Fonts.

```
index.html        the page
styles.css        all styles; colour and type tokens are at the top
demo.js           the editor demo in the hero
assets/           the app icon, used as the favicon
```

## Preview

`demo.js` is an ES module, so open the page through a local server rather than from the file system:

```bash
python3 -m http.server 4173
# then open http://localhost:4173
```

## Deploy

Any static host works as-is: Vercel, Netlify, Cloudflare Pages or GitHub Pages. Point it at the
repository root. There is nothing to build.

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
