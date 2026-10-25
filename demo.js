// The hero editor. Like Flown's own compositor, every frame is a pure function of time,
// so playing, scrubbing and looping all go through render(t).

const DURATION = 12
const FRAME = { w: 1280, h: 720 }
const CARD = { x: 100, y: 56, w: 1080, h: 608 }
const CONTENT = { x: 100, y: 92 } // top-left of the recorded app, under the browser bar

// Cursor path in app pixels: [time, x, y]
const PATH = [
  [0, 640, 470],
  [0.35, 640, 470],
  [1.6, 975, 47],
  [2.25, 968, 54],
  [3.1, 930, 142],
  [3.6, 932, 146],
  [4.6, 820, 330],
  [6.6, 800, 360],
  [7.3, 640, 340],
  [8.7, 640, 340],
  [9.35, 520, 236],
  [10.0, 526, 244],
  [11.6, 640, 470],
  [12, 640, 470]
]
const CLICKS = [1.85, 3.45, 9.55]

// Camera keys: level and what it looks at. 'center' is the whole frame, 'cursor' follows it.
const CAMERA = [
  { t: 0, s: 1, f: 'center' },
  { t: 1.05, s: 1, f: 'center' },
  { t: 1.75, s: 1.9, f: 'cursor' },
  { t: 4.0, s: 1.9, f: 'cursor' },
  { t: 4.8, s: 1.6, f: [910, 524] },
  { t: 6.2, s: 1.6, f: [910, 524] },
  { t: 6.9, s: 1, f: 'center' },
  { t: 7.45, s: 1, f: 'center' },
  { t: 8.15, s: 1.5, f: [540, 220] },
  { t: 10.2, s: 1.5, f: [540, 220] },
  { t: 10.9, s: 1, f: 'center' },
  { t: 12, s: 1, f: 'center' }
]

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
const lerp = (a, b, u) => a + (b - a) * u
const smoothstep = (u) => u * u * (3 - 2 * u)
const easeInOut = (u) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2)
/** 0 before `a`, 1 between `a` and `b`, 0 after `b`, with short fades. */
const during = (t, a, b, fade = 0.16) => smoothstep(clamp((t - a) / fade, 0, 1)) * (1 - smoothstep(clamp((t - b) / fade, 0, 1)))

function segmentAt(keys, t, time) {
  let i = 0
  while (i < keys.length - 2 && time(keys[i + 1]) <= t) i++
  const a = keys[i]
  const b = keys[i + 1]
  const span = time(b) - time(a)
  return { a, b, i, u: span > 0 ? clamp((t - time(a)) / span, 0, 1) : 1 }
}

function cursorAt(t) {
  const { a, b, i, u } = segmentAt(PATH, clamp(t, 0, DURATION), (k) => k[0])
  const e = easeInOut(u)
  const dx = b[1] - a[1]
  const dy = b[2] - a[2]
  // A slight arc, like a hand moving a mouse, alternating sides.
  const bow = Math.sin(Math.PI * e) * 0.09 * (i % 2 ? -1 : 1)
  return { x: lerp(a[1], b[1], e) - dy * bow, y: lerp(a[2], b[2], e) + dx * bow }
}

/** The camera trails the cursor: the average of where it was over the last 0.4 s. */
function trailingCursor(t) {
  let x = 0
  let y = 0
  const n = 8
  for (let k = 0; k < n; k++) {
    const p = cursorAt(Math.max(0, t - k * 0.055))
    x += p.x
    y += p.y
  }
  return { x: CONTENT.x + x / n, y: CONTENT.y + y / n }
}

function focusPoint(f, t) {
  if (f === 'center') return { x: FRAME.w / 2, y: FRAME.h / 2 }
  if (f === 'cursor') return trailingCursor(t)
  return { x: CONTENT.x + f[0], y: CONTENT.y + f[1] }
}

function cameraAt(t) {
  const { a, b, u } = segmentAt(CAMERA, clamp(t, 0, DURATION), (k) => k.t)
  const e = easeInOut(u)
  const s = lerp(a.s, b.s, e)
  const fa = focusPoint(a.f, t)
  const fb = b.f === a.f ? fa : focusPoint(b.f, t)
  let cx = lerp(fa.x, fb.x, e)
  let cy = lerp(fa.y, fb.y, e)
  // Keep the view inside the frame, and inside the recording once zoomed in.
  const inside = clamp((s - 1) / 0.3, 0, 1)
  const bounds = {
    x0: lerp(0, CARD.x, inside),
    y0: lerp(0, CARD.y, inside),
    x1: lerp(FRAME.w, CARD.x + CARD.w, inside),
    y1: lerp(FRAME.h, CARD.y + CARD.h, inside)
  }
  const hw = FRAME.w / s / 2
  const hh = FRAME.h / s / 2
  cx = bounds.x1 - bounds.x0 > hw * 2 ? clamp(cx, bounds.x0 + hw, bounds.x1 - hw) : (bounds.x0 + bounds.x1) / 2
  cy = bounds.y1 - bounds.y0 > hh * 2 ? clamp(cy, bounds.y0 + hh, bounds.y1 - hh) : (bounds.y0 + bounds.y1) / 2
  return { s, tx: FRAME.w / 2 - cx * s, ty: FRAME.h / 2 - cy * s }
}

const formatTime = (t) => {
  const tenths = Math.floor(t * 10 + 1e-6)
  const secs = Math.floor(tenths / 10)
  return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}.${tenths % 10}`
}

function setup() {
  const root = document.getElementById('editor-demo')
  if (!root) return
  const $ = (id) => document.getElementById(id)
  const stage = $('stage')
  const frame = $('frame')
  const scene = $('scene')
  const cursor = $('cursor')
  const ripple = $('ripple')
  const exportBtn = $('app-export')
  const menu = $('app-menu')
  const menuPdf = $('app-menu-pdf')
  const toastPdf = $('toast-pdf')
  const toastRemind = $('toast-remind')
  const scrim = $('app-scrim')
  const palette = $('app-palette')
  const typed = $('pal-typed')
  const remind = $('pal-remind')
  const keys = $('keys')
  const playBtn = $('play')
  const timeNow = $('time-now').firstChild
  const lanes = $('lanes')
  const playhead = $('playhead')

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)')

  let t = 0
  let playing = false
  let userPaused = false
  let inView = false
  let last = 0
  let raf = 0
  let laneLeft = 0
  let laneWidth = 0

  // Most of the frame holds still most of the time, so render() only writes what changed since the
  // last frame. Setting textContent, even to the same string, makes the browser restyle and lay out
  // the page again, and every style write is parsed before the browser can tell it's the same.
  const written = new Map()
  function changed(node, key, value) {
    let was = written.get(node)
    if (!was) written.set(node, (was = {}))
    if (was[key] === value) return false
    was[key] = value
    return true
  }
  const setStyle = (el, prop, value) => {
    if (changed(el, prop, value)) el.style[prop] = value
  }
  const setClass = (el, name, on) => {
    if (changed(el, name, on)) el.classList.toggle(name, on)
  }
  const setAttr = (el, name, value) => {
    if (changed(el, name, value)) el.setAttribute(name, value)
  }

  // The playhead moves by transform, which needs no layout. Rounding to whole device pixels keeps
  // its edges as crisp as when it was placed with `left`.
  function placePlayhead(time) {
    const dpr = window.devicePixelRatio || 1
    setStyle(playhead, 'transform', `translateX(${Math.round((time / DURATION) * laneWidth * dpr) / dpr}px)`)
  }

  function render(time) {
    // Camera, with a touch of motion blur while it moves
    const cam = cameraAt(time)
    setStyle(scene, 'transform', `translate(${cam.tx}px, ${cam.ty}px) scale(${cam.s})`)
    let blur = 0
    if (playing && !reduceMotion.matches) {
      const prev = cameraAt(Math.max(0, time - 1 / 60))
      const moved = Math.hypot(cam.tx - prev.tx, cam.ty - prev.ty) + Math.abs(cam.s - prev.s) * 900
      blur = clamp((moved - 1.5) * 0.12, 0, 1.6)
    }
    setStyle(scene, 'filter', blur > 0.05 ? `blur(${blur.toFixed(2)}px)` : '')

    // Cursor and clicks
    const p = cursorAt(time)
    let press = 1
    let rippleOn = false
    for (const c of CLICKS) {
      const d = time - c
      if (d > -0.08 && d < 0.14) press = 0.82
      if (d >= 0 && d < 0.55) {
        const u = d / 0.55
        const at = cursorAt(c)
        setStyle(ripple, 'transform', `translate(${at.x}px, ${at.y}px) scale(${lerp(0.25, 1, 1 - Math.pow(1 - u, 3))})`)
        setStyle(ripple, 'opacity', String(0.9 * (1 - u)))
        rippleOn = true
      }
    }
    if (!rippleOn) setStyle(ripple, 'opacity', '0')
    setStyle(cursor, 'transform', `translate(${p.x}px, ${p.y}px) scale(${press})`)

    // The recorded app
    setClass(exportBtn, 'is-pressed', time > 1.78 && time < 2.0)
    const menuOn = during(time, 1.95, 3.5, 0.12)
    setStyle(menu, 'opacity', String(menuOn))
    setStyle(menu, 'transform', `scale(${lerp(0.96, 1, menuOn)})`)
    setClass(menuPdf, 'is-hover', time > 2.95 && time < 3.5)
    const toast1 = during(time, 3.7, 6.6, 0.22)
    setStyle(toastPdf, 'opacity', String(toast1))
    setStyle(toastPdf, 'transform', `translateY(${lerp(12, 0, toast1)}px)`)
    const palOn = during(time, 7.12, 9.62, 0.14)
    setStyle(palette, 'opacity', String(palOn))
    setStyle(palette, 'transform', `translateY(${lerp(-8, 0, palOn)}px) scale(${lerp(0.98, 1, palOn)})`)
    setStyle(scrim, 'opacity', String(palOn))
    const letters = 'remind'.slice(0, clamp(Math.floor((time - 7.6) / 0.11), 0, 6))
    if (changed(typed, 'text', letters)) typed.textContent = letters
    setClass(remind, 'is-hover', time > 9.1)
    const toast2 = during(time, 9.8, 11.5, 0.22)
    setStyle(toastRemind, 'opacity', String(toast2))
    setStyle(toastRemind, 'transform', `translateY(${lerp(12, 0, toast2)}px)`)

    // Keystroke overlay, drawn over the output frame. Hidden, not just transparent, while it's out:
    // even at opacity 0 its backdrop blur costs the GPU every frame.
    const keysOn = during(time, 7.0, 8.6, 0.14)
    setStyle(keys, 'opacity', String(keysOn))
    setStyle(keys, 'visibility', keysOn > 0 ? 'visible' : 'hidden')
    setStyle(keys, 'transform', `translateX(-50%) translateY(${lerp(10, 0, keysOn)}px)`)

    // Transport. The readout's text node is rewritten in place, which skips the restyle.
    const label = formatTime(time)
    if (changed(timeNow, 'text', label)) timeNow.data = label
    placePlayhead(time)
    setAttr(playhead, 'aria-valuenow', time.toFixed(1))
    setAttr(playhead, 'aria-valuetext', label)
  }

  function tick(now) {
    if (!playing) return
    const dt = Math.min(0.1, (now - last) / 1000)
    last = now
    t = (t + dt) % DURATION
    render(t)
    raf = requestAnimationFrame(tick)
  }

  function play() {
    if (playing) return
    playing = true
    last = performance.now()
    root.classList.add('is-playing')
    playBtn.classList.add('is-playing')
    playBtn.setAttribute('aria-label', 'Pause')
    raf = requestAnimationFrame(tick)
  }

  function pause() {
    playing = false
    cancelAnimationFrame(raf)
    root.classList.remove('is-playing')
    playBtn.classList.remove('is-playing')
    playBtn.setAttribute('aria-label', 'Play')
    render(t)
  }

  function seek(time) {
    t = clamp(time, 0, DURATION - 0.001)
    render(t)
  }

  playBtn.addEventListener('click', () => {
    if (playing) {
      userPaused = true
      pause()
    } else {
      userPaused = false
      play()
    }
  })

  // Scrubbing: click or drag anywhere on the timeline lanes. Where they start is read once per drag,
  // so a pointer move doesn't make the browser lay out what the last one drew before it can answer.
  const timeFromPointer = (e) => ((e.clientX - laneLeft) / laneWidth) * DURATION
  lanes.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return
    const r = lanes.getBoundingClientRect()
    laneLeft = r.left
    laneWidth = r.width
    lanes.setPointerCapture(e.pointerId)
    userPaused = true
    pause()
    seek(timeFromPointer(e))
    playhead.focus({ preventScroll: true })
  })
  lanes.addEventListener('pointermove', (e) => {
    if (lanes.hasPointerCapture(e.pointerId)) seek(timeFromPointer(e))
  })

  playhead.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 1 : 0.1
    const moves = { ArrowLeft: -step, ArrowDown: -step, ArrowRight: step, ArrowUp: step }
    if (e.key in moves) seek(t + moves[e.key])
    else if (e.key === 'Home') seek(0)
    else if (e.key === 'End') seek(DURATION)
    else if (e.key === ' ') playBtn.click()
    else return
    e.preventDefault()
    if (e.key !== ' ' && playing) {
      userPaused = true
      pause()
    }
  })

  // Scale the 1280 x 720 frame to the stage, and keep the playhead's travel matched to the lanes.
  // The scale is set on the frame itself: an inherited custom property would restyle all of it.
  const resized = new ResizeObserver((entries) => {
    for (const { target, contentRect } of entries) {
      if (target === stage) {
        frame.style.transform = `scale(${contentRect.width / FRAME.w})`
      } else {
        laneWidth = contentRect.width
        placePlayhead(t)
      }
    }
  })
  resized.observe(stage)
  resized.observe(lanes)

  // Play while on screen, unless the visitor paused it or prefers less motion.
  new IntersectionObserver(
    ([entry]) => {
      inView = entry.isIntersecting
      if (inView && !userPaused && !reduceMotion.matches) play()
      else if (!inView && playing) pause()
    },
    { threshold: 0.2 }
  ).observe(stage)

  // With reduced motion, start on a zoomed-in frame so the idea still comes across.
  if (reduceMotion.matches) t = 2.7
  render(t)
}

setup()
