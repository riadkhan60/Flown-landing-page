// Builds the deployable site into dist/. The stylesheet is inlined into index.html, so the first
// paint doesn't wait for it, and the files the page loads are copied under names that carry their
// content hash, so browsers can keep them for good. The build checks that the compressed page still
// arrives in the first round trip of a new connection. The source files are left as they are, for
// local preview.
// usage: node scripts/build.mjs
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const dist = path.join(root, 'dist')
// Every file in here is named after its content, so vercel.json caches the folder as immutable.
const HASHED = 'immutable'
// Files that don't refer to other files, so they still work from another folder.
const LEAF = /\.(js|mjs|svg|png|jpe?g|gif|webp|avif|ico|woff2?|ttf|otf)$/i
// A new connection's first round trip carries 10 TCP segments (14,600 bytes); leave room for the headers.
const FIRST_ROUND_TRIP = 14600 - 400
// Vercel compresses as it serves, with brotli at quality 3 (its responses match q3 byte for byte),
// so that is the size that has to fit, not what the slowest setting would make of the page.
const HOST_BROTLI_QUALITY = 3

const isLocal = (url) => !/^([a-z][a-z\d+.-]*:|\/\/|#)/i.test(url)
const split = (url) => url.match(/^([^?#]*)(.*)$/).slice(1)
const attrs = (tag) => Object.fromEntries([...tag.matchAll(/([\w:-]+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s"'>]+))?/g)].slice(1).map(([, k, v = '']) => [k.toLowerCase(), v.replace(/^["']|["']$/g, '')]))

// The path from the site root of a local URL found in a file at `from` (also a path from the root).
function resolve(url, from) {
  const [p] = split(url)
  const rel = p.startsWith('/') ? p.slice(1) : path.posix.join(path.posix.dirname(from), p)
  return path.posix.normalize(decodeURI(rel))
}

// Copies a file the page loads into dist/. A leaf file goes into HASHED under a name that carries
// its content hash; anything else keeps its path. Returns the URL to use from the page.
const copied = new Map()
function publish(rel) {
  if (!copied.has(rel)) {
    const file = path.join(root, rel)
    if (rel.startsWith('..') || !fs.existsSync(file) || !fs.statSync(file).isFile()) throw new Error(`index.html refers to ${rel}, which isn't a file in the site`)
    const data = fs.readFileSync(file)
    let out = rel
    if (LEAF.test(rel)) {
      // A name that already holds the start of the file's hash (archivo-e2a4c3c6.woff2) is kept.
      const { name, ext } = path.posix.parse(rel)
      const hash = crypto.createHash('sha256').update(data).digest('hex')
      const named = name.match(/[\da-f]{8,}/gi)?.some((h) => hash.startsWith(h.toLowerCase()))
      out = `${HASHED}/${named ? name : `${name}.${hash.slice(0, 10)}`}${ext}`
    }
    fs.mkdirSync(path.dirname(path.join(dist, out)), { recursive: true })
    fs.writeFileSync(path.join(dist, out), data)
    copied.set(rel, encodeURI(out))
  }
  return copied.get(rel)
}
const publishUrl = (url, from) => (isLocal(url) && split(url)[0] ? publish(resolve(url, from)) + split(url)[1] : url)

// Comments and whitespace only, so there is nothing to get wrong in the values. Strings and url()
// are copied untouched. Whitespace is dropped next to { } ; , > and after a colon, but never before
// a colon (".a :hover" is not ".a:hover") and never around + or -, which calc() needs. A comment
// between two words becomes an empty one, because dropping it would join them ("0/**/auto").
const CSS_TOKENS = /("(?:\\[^]|[^"\\])*"|'(?:\\[^]|[^'\\])*'|url\(\s*[^'"\s)][^)]*\))/
function minifyCss(css) {
  // "--x: ;" holds a space, which older browsers need: to them "--x:;" is invalid. The passes below
  // would drop that space.
  if (/--[\w-]+\s*:\s*[;}]/.test(css.replace(new RegExp(`${CSS_TOKENS.source}|/\\*[^]*?\\*/`, 'g'), ''))) {
    console.warn('A custom property is set to a space, so the stylesheet is left unminified.')
    return css
  }
  return css
    .replace(new RegExp(`${CSS_TOKENS.source}|/\\*[^]*?\\*/`, 'g'), (m, token, at, all) => {
      if (token) return token
      const joins = /[^\s{};,:()[\]>~=]/
      return joins.test(all[at - 1] ?? ' ') && joins.test(all[at + m.length] ?? ' ') ? '/**/' : ''
    })
    .split(CSS_TOKENS)
    .map((part, i) => (i % 2 ? part : part.replace(/[ \t\n\r\f]+/g, ' ').replace(/ ?([{};,>]) ?/g, '$1').replace(/: /g, ':').replace(/;}/g, '}')))
    .join('')
    .trim()
}

// Points the url()s in a stylesheet at `from` to their published copies, as seen from the page.
// Comments and strings are matched first so a url( inside one is left alone.
const CSS_URLS = /\/\*[^]*?\*\/|url\(\s*("(?:\\[^]|[^"\\])*"|'(?:\\[^]|[^'\\])*'|[^'"\s)][^)]*?)\s*\)|"(?:\\[^]|[^"\\])*"|'(?:\\[^]|[^'\\])*'/g
const publishCssUrls = (css, from) => css.replace(CSS_URLS, (m, value) => {
  if (value === undefined) return m
  const q = /^["']/.test(value) ? value[0] : ''
  return `url(${q}${publishUrl(q ? value.slice(1, -1) : value, from)}${q})`
})

// Collapses whitespace in text, which renders the same as long as nothing preserves it. A run that
// holds a line break becomes one line break. Tags, attribute values and raw-text elements are kept.
function minifyHtml(html) {
  return html.replace(/<!--[^]*?-->|<(script|style|pre|textarea)\b[^]*?<\/\1\s*>|<[a-z/!](?:"[^"]*"|'[^']*'|[^'">])*>|[^<]+/gi, (m) => {
    if (m.startsWith('<!--')) return ''
    if (m.startsWith('<')) return m
    return m.replace(/[ \t\n\r\f]*\n[ \t\n\r\f]*/g, '\n')
  })
}

// Only a plain <link rel=stylesheet> is inlined: one with an onload, a title or the like relies on
// being a separate file.
const inlinable = (a) => a.rel === 'stylesheet' && isLocal(a.href) && Object.keys(a).every((k) => ['rel', 'href', 'media', 'type'].includes(k))
const LOADS = /^(script|img|source|video|audio|input)$/i
const LINK_LOADS = /\b(stylesheet|icon|apple-touch-icon|mask-icon|preload|modulepreload|prefetch|manifest)\b/i

// Points the src, href and poster attributes of a tag that loads a file at its published copy.
const publishAttrs = (tag) => tag.replace(/(\s)([\w:-]+)(\s*=\s*)("[^"]*"|'[^']*'|[^\s"'>]+)/g, (m, space, name, eq, value) => {
  if (!/^(href|src|poster)$/i.test(name)) return m
  const q = /^["']/.test(value) ? value[0] : ''
  return space + name + eq + q + publishUrl(q ? value.slice(1, -1) : value, 'index.html') + q
})

function publishTag(tag, name, css) {
  const a = attrs(tag)
  if (/^(a|area)$/i.test(name)) {
    // Links to other pages or files keep their names, but must be there.
    if (a.href && isLocal(a.href) && split(a.href)[0] && !fs.existsSync(path.join(dist, resolve(a.href, 'index.html')))) throw new Error(`index.html links to ${a.href}, which isn't in dist/`)
    return tag
  }
  if (/^link$/i.test(name)) {
    if (!LINK_LOADS.test(a.rel)) return tag
    if (!inlinable(a)) return publishAttrs(tag)
    const style = minifyCss(publishCssUrls(css.get(a.href), resolve(a.href, 'index.html')))
    if (/<\/style/i.test(style)) throw new Error(`${a.href} contains "</style", which would end the inlined <style> early`)
    return `<style${a.media ? ` media="${a.media}"` : ''}>${style}</style>`
  }
  if (!LOADS.test(name)) return tag
  if (a.srcset) throw new Error('index.html uses srcset, which the build does not publish yet')
  if (/^script$/i.test(name) && a.type === 'module' && a.src && isLocal(a.src)) {
    // A module that imports others would look for them next to its published copy.
    const js = fs.readFileSync(path.join(root, resolve(a.src, 'index.html')), 'utf8')
    if (/^\s*import\s*[\w*{'"]|\bimport\s*\(/m.test(js)) throw new Error(`${a.src} imports other modules; the build only publishes self-contained ones`)
  }
  return publishAttrs(tag)
}

function build(source) {
  const sheets = [...source.matchAll(/<link\b(?:"[^"]*"|'[^']*'|[^'">])*>/gi)].map(([tag]) => attrs(tag)).filter(inlinable)
  const css = new Map(sheets.map((a) => [a.href, fs.readFileSync(path.join(root, resolve(a.href, 'index.html')), 'utf8')]))
  for (const [href, text] of css) if (/@import/i.test(text)) throw new Error(`${href} uses @import; inline what it imports instead`)
  const keepsWhitespace = /white-space(-collapse)?\s*:\s*(pre|break-spaces|preserve)/i.test(source + [...css.values()].join(''))
  if (keepsWhitespace) console.warn('Some text keeps its whitespace, so the HTML is left unminified.')

  const html = keepsWhitespace ? source : minifyHtml(source)
  // Comments and the insides of <script> and <style> are matched whole, so a tag in them is left alone.
  return html.replace(/<!--[^]*?-->|<(script|style)\b((?:"[^"]*"|'[^']*'|[^'">])*)>([^]*?)(<\/\1\s*>)|<([a-z]+)\b(?:"[^"]*"|'[^']*'|[^'">])*>/gi, (m, raw, rawAttrs, body, close, name) => {
    if (m.startsWith('<!--')) return m
    if (!raw) return publishTag(m, name, css)
    if (/^style$/i.test(raw)) return `<${raw}${rawAttrs}>${publishCssUrls(body, 'index.html')}${close}`
    return publishTag(`<${raw}${rawAttrs}>`, raw, css) + body + close
  })
}

fs.rmSync(dist, { recursive: true, force: true })
fs.mkdirSync(dist)
// Everything in assets/ is published under its own name too, so the font licence and any outside
// links to these files keep working. Those copies are revalidated rather than cached for good.
if (fs.existsSync(path.join(root, 'assets'))) fs.cpSync(path.join(root, 'assets'), path.join(dist, 'assets'), { recursive: true })

const html = build(fs.readFileSync(path.join(root, 'index.html'), 'utf8'))
fs.writeFileSync(path.join(dist, 'index.html'), html)

const kb = (n) => `${(n / 1024).toFixed(1)} KB`
const brotli = (q) => zlib.brotliCompressSync(html, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: q } }).length
const served = brotli(HOST_BROTLI_QUALITY)
console.log(`dist/index.html  ${kb(Buffer.byteLength(html))}, ${kb(served)} brotli as Vercel serves it (${kb(brotli(11))} at best, ${kb(zlib.gzipSync(html, { level: 9 }).length)} gzip)`)
for (const out of copied.values()) console.log(`dist/${decodeURI(out)}  ${kb(fs.statSync(path.join(dist, decodeURI(out))).size)}`)
if (served > FIRST_ROUND_TRIP) console.warn(`As Vercel serves it, the page is ${served} bytes, more than the ${FIRST_ROUND_TRIP} that arrive in the first round trip.`)
