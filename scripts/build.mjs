// Builds the deployable site into dist/. The stylesheet and the demo script are inlined into
// index.html so the first paint doesn't wait for them, and the build checks that the compressed
// page still arrives in the first round trip of a new connection. The source files are left as
// they are, for local preview.
// usage: node scripts/build.mjs
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const dist = path.join(root, 'dist')
// A new connection's first round trip carries 10 TCP segments (14,600 bytes); leave room for the headers.
const FIRST_ROUND_TRIP = 14600 - 400

const isLocal = (url) => !/^([a-z][a-z\d+.-]*:|\/\/|#)/i.test(url)
const localPath = (url) => decodeURI(url.replace(/[?#].*$/, '').replace(/^\//, ''))
const attrs = (tag) => Object.fromEntries([...tag.matchAll(/([\w:-]+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s"'>]+))?/g)].slice(1).map(([, k, v = '']) => [k.toLowerCase(), v.replace(/^["']|["']$/g, '')]))

// Comments and whitespace only, so there is nothing to get wrong in the values. Strings and url()
// are copied untouched. Whitespace is dropped next to { } ; , > and after a colon, but never before
// a colon (".a :hover" is not ".a:hover") and never around + or -, which calc() needs.
const CSS_TOKENS = /("(?:\\[^]|[^"\\])*"|'(?:\\[^]|[^'\\])*'|url\(\s*[^'"\s)][^)]*\))/
function minifyCss(css) {
  return css
    .replace(new RegExp(`${CSS_TOKENS.source}|/\\*[^]*?\\*/`, 'g'), (m, token) => token ?? '')
    .split(CSS_TOKENS)
    .map((part, i) => (i % 2 ? part : part.replace(/[ \t\n\r\f]+/g, ' ').replace(/ ?([{};,>]) ?/g, '$1').replace(/: /g, ':').replace(/;}/g, '}')))
    .join('')
    .trim()
}

// Collapses whitespace in text, which renders the same as long as nothing preserves it. A run that
// holds a line break becomes one line break. Tags, attribute values and raw-text elements are kept.
function minifyHtml(html) {
  return html.replace(/<!--[^]*?-->|<(script|style|pre|textarea)\b[^]*?<\/\1\s*>|<[a-z/!](?:"[^"]*"|'[^']*'|[^'">])*>|[^<]+/gi, (m) => {
    if (m.startsWith('<!--')) return ''
    if (m.startsWith('<')) return m
    return m.replace(/[ \t\n\r\f]*\n[ \t\n\r\f]*/g, '\n')
  })
}

function inline(html) {
  html = html.replace(/<link\b[^>]*>/gi, (tag) => {
    const a = attrs(tag)
    if (a.rel !== 'stylesheet' || !isLocal(a.href)) return tag
    const css = minifyCss(fs.readFileSync(path.join(root, localPath(a.href)), 'utf8'))
    if (/<\/style/i.test(css)) throw new Error(`${a.href} contains "</style", which would end the inlined <style> early`)
    return `<style${a.media ? ` media="${a.media}"` : ''}>${css}</style>`
  })
  // Module scripts run after parsing wherever they sit, so the inlined copy goes last and the
  // content that paints first arrives first.
  const scripts = []
  html = html.replace(/(<script\b[^>]*>)<\/script>[ \t]*\n?/gi, (m, tag) => {
    const a = attrs(tag)
    if (a.type !== 'module' || !a.src || !isLocal(a.src) || 'async' in a) return m
    const js = fs.readFileSync(path.join(root, localPath(a.src)), 'utf8')
    if (/^\s*import\s*[\w*{'"]|\bimport\s*\(/m.test(js)) throw new Error(`${a.src} imports other modules; only self-contained modules are inlined`)
    if (/<\/script|<!--/i.test(js)) throw new Error(`${a.src} contains "</script" or "<!--", which would break the inlined <script>`)
    scripts.push(`<script type="module">${js.trim()}</script>`)
    return ''
  })
  return scripts.length ? html.replace(/<\/body>/i, () => `${scripts.join('\n')}\n</body>`) : html
}

// Names every asset by its content, unless its name already carries a hash, so everything under
// /assets can be cached as immutable (see vercel.json).
function fingerprint(html) {
  const dir = path.join(dist, 'assets')
  for (const rel of fs.readdirSync(dir, { recursive: true })) {
    const file = path.join(dir, rel)
    if (fs.statSync(file).isDirectory() || /[.-][\da-f]{8,}\.[^./]+$/i.test(rel)) continue
    const hash = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').slice(0, 10)
    const { dir: d, name, ext } = path.parse(rel)
    const hashed = path.join(d, `${name}.${hash}${ext}`)
    fs.renameSync(file, path.join(dir, hashed))
    html = html.split(`assets/${rel.split(path.sep).join('/')}`).join(`assets/${hashed.split(path.sep).join('/')}`)
  }
  return html
}

function checkReferences(html) {
  const refs = [...html.matchAll(/\s(?:href|src)\s*=\s*["']([^"']+)["']/gi), ...html.matchAll(/url\(\s*["']?([^"')]+?)["']?\s*\)/gi)].map((m) => m[1])
  const missing = refs.filter((url) => isLocal(url) && localPath(url) && !fs.existsSync(path.join(dist, localPath(url))))
  if (missing.length) throw new Error(`index.html refers to files that are not in dist/: ${[...new Set(missing)].join(', ')}`)
}

fs.rmSync(dist, { recursive: true, force: true })
fs.mkdirSync(dist)
fs.cpSync(path.join(root, 'assets'), path.join(dist, 'assets'), { recursive: true })

const source = fs.readFileSync(path.join(root, 'index.html'), 'utf8')
const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8')
const keepsWhitespace = /white-space(-collapse)?\s*:\s*(pre|break-spaces|preserve)/i.test(css + source)
if (keepsWhitespace) console.warn('Some text keeps its whitespace, so the HTML is left unminified.')

let html = inline(keepsWhitespace ? source : minifyHtml(source))
html = fingerprint(html)
checkReferences(html)
fs.writeFileSync(path.join(dist, 'index.html'), html)

const br = zlib.brotliCompressSync(html, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11 } }).length
const gz = zlib.gzipSync(html, { level: 9 }).length
console.log(`dist/index.html  ${(Buffer.byteLength(html) / 1024).toFixed(1)} KB, ${(gz / 1024).toFixed(1)} KB gzip, ${(br / 1024).toFixed(1)} KB brotli`)
if (br > FIRST_ROUND_TRIP) console.warn(`With brotli the page is ${br} bytes, more than the ${FIRST_ROUND_TRIP} that arrive in the first round trip.`)
