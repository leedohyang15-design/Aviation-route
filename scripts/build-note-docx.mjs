/*
 * Assemble docs/기술개발노트.docx from the same template the HTML note is
 * built from.
 *
 * Why a second builder rather than a converter: the note is authored as an
 * Artifact page — a body fragment with CSS custom properties and an inline
 * SVG — and every off-the-shelf HTML-to-Word path flattens that into unstyled
 * text, losing the parts of this document that carry meaning (the numbered
 * chapters, the trap callouts, the code blocks, the figure captions).
 * Walking the structure directly keeps them as real Word constructs.
 *
 * It reads the TEMPLATE, not the built HTML: the built file has every
 * screenshot inlined as base64, so parsing it means chewing through most of a
 * megabyte of data URI to find the prose. The template still has {{name}}
 * placeholders, which resolve to docs/images/name.jpg — the same files, read
 * straight from disk.
 *
 * The one thing that cannot be read off disk as a picture is the architecture
 * diagram, which is inline SVG. Rendering SVG needs a browser, and requiring
 * one here would make a Word export depend on a headless Chromium — so the
 * diagram is pre-rendered once and committed as docs/images/diagram.png. If
 * you change the SVG in the template, re-render that file (see 11장).
 *
 *   npm run note:docx
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  AlignmentType, BorderStyle, Document, Footer, HeadingLevel, ImageRun, LevelFormat, Packer,
  PageNumber, Paragraph, ShadingType, Table, TableCell, TableRow, TextRun, WidthType
} from 'docx'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const IMAGES = join(root, 'docs/images')

// ---------------------------------------------------------------------------
// A very small HTML reader.
//
// Enough for a document we author ourselves: tags, attributes, text, and the
// handful of entities the template actually uses. Not a general parser, and
// deliberately so — a dependency would have to be justified for one file.
// ---------------------------------------------------------------------------

const VOID = new Set(['br', 'img', 'link', 'meta', 'hr', 'input'])
const SKIPPED = new Set(['style', 'script', 'title', 'nav'])

const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  mdash: '—', ndash: '–', hellip: '…', middot: '·', times: '×', deg: '°',
  larr: '←', rarr: '→', laquo: '«', raquo: '»', ldquo: '"', rdquo: '"',
  lsquo: "'", rsquo: "'", bull: '•', copy: '©'
}

function decode(s) {
  return s.replace(/&(#x?[0-9a-fA-F]+|\w+);/g, (whole, body) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X'
        ? parseInt(body.slice(2), 16)
        : parseInt(body.slice(1), 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole
    }
    return ENTITIES[body] ?? whole
  })
}

function attrsOf(raw) {
  const out = {}
  const re = /([\w:-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/g
  let m
  while ((m = re.exec(raw))) out[m[1].toLowerCase()] = decode(m[3] ?? m[4] ?? m[5] ?? '')
  return out
}

function parseHtml(html) {
  const doc = { tag: '#root', attrs: {}, kids: [] }
  const stack = [doc]
  const re = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][\w-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g
  let m
  let last = 0
  let skip = 0
  while ((m = re.exec(html))) {
    const text = html.slice(last, m.index)
    if (text && !skip) stack[stack.length - 1].kids.push(decode(text))
    last = re.lastIndex
    if (m[0].startsWith('<!--')) continue
    const closing = m[1] === '/'
    const tag = m[2].toLowerCase()
    const selfClosing = /\/\s*$/.test(m[3] ?? '')
    if (skip) {
      if (closing) skip--
      else if (!VOID.has(tag) && !selfClosing) skip++
      continue
    }
    if (closing) {
      if (VOID.has(tag)) continue
      for (let k = stack.length - 1; k > 0; k--) {
        if (stack[k].tag === tag) {
          stack.length = k
          break
        }
      }
      continue
    }
    if (SKIPPED.has(tag)) {
      if (!VOID.has(tag) && !selfClosing) skip = 1
      continue
    }
    const node = { tag, attrs: attrsOf(m[3] ?? ''), kids: [] }
    stack[stack.length - 1].kids.push(node)
    if (!VOID.has(tag) && !selfClosing) stack.push(node)
  }
  const tail = html.slice(last)
  if (tail && !skip) doc.kids.push(decode(tail))
  return doc
}

const classes = (n) => (n.attrs?.class ?? '').split(/\s+/).filter(Boolean)
const hasClass = (n, c) => classes(n).includes(c)
const elems = (n) => n.kids.filter((k) => typeof k !== 'string')

// ---------------------------------------------------------------------------
// Inline text -> styled runs
// ---------------------------------------------------------------------------

function inlineRuns(node, bold = false, italic = false, code = false, dim = false) {
  const out = []
  for (const k of node.kids) {
    if (typeof k === 'string') {
      if (k) out.push({ t: k, b: bold, i: italic, c: code, d: dim })
      continue
    }
    if (k.tag === 'br') {
      out.push({ t: '\n', b: bold, i: italic, c: code, d: dim })
      continue
    }
    out.push(
      ...inlineRuns(
        k,
        bold || k.tag === 'b' || k.tag === 'strong',
        italic || k.tag === 'i' || k.tag === 'em',
        code || k.tag === 'code' || k.tag === 'kbd' || hasClass(k, 'mono'),
        // `.dim` is how the template greys out a comment inside a <pre>.
        dim || hasClass(k, 'dim')
      )
    )
  }
  return out
}

/** Collapse whitespace across runs the way a browser lays it out. */
function tidy(rs) {
  const out = []
  for (const r of rs) {
    const t = r.t.replace(/[ \t\r\f\v]*\n[ \t\r\f\v]*/g, ' ').replace(/[ \t]+/g, ' ')
    if (!t) continue
    const prev = out[out.length - 1]
    if (prev && prev.b === r.b && prev.i === r.i && prev.c === r.c && prev.d === r.d) prev.t += t
    else out.push({ ...r, t })
  }
  if (out.length) {
    out[0].t = out[0].t.replace(/^\s+/, '')
    out[out.length - 1].t = out[out.length - 1].t.replace(/\s+$/, '')
  }
  return out.filter((r) => r.t)
}

const textOf = (n) => tidy(inlineRuns(n)).map((r) => r.t).join('')

/** A <pre> keeps its line breaks; only the inline styling matters. */
function preLines(node) {
  const lines = []
  let cur = []
  for (const r of inlineRuns(node)) {
    const parts = r.t.split('\n')
    parts.forEach((p, i) => {
      if (i) {
        lines.push(cur)
        cur = []
      }
      if (p) cur.push({ ...r, t: p })
    })
  }
  lines.push(cur)
  while (lines.length && !lines[0].length) lines.shift()
  while (lines.length && !lines[lines.length - 1].length) lines.pop()
  return lines
}

// ---------------------------------------------------------------------------
// Elements -> blocks
// ---------------------------------------------------------------------------

function toBlocks(node, out) {
  for (const k of elems(node)) {
    const t = k.tag
    if (t === 'svg') {
      out.push({ type: 'svg' })
    } else if (t === 'header' && hasClass(k, 'masthead')) {
      masthead(k, out)
    } else if (t === 'section') {
      toBlocks(k, out)
    } else if (t === 'div' && hasClass(k, 'sec-head')) {
      let no = ''
      let title = ''
      let latin = ''
      for (const kid of elems(k)) {
        if (hasClass(kid, 'sec-no')) no = textOf(kid)
        else if (kid.tag === 'h2') title = textOf(kid)
        else if (hasClass(kid, 'sec-latin')) latin = textOf(kid)
      }
      out.push({ type: 'h1', no, text: title, latin })
    } else if (t === 'div' && hasClass(k, 'trap')) {
      const inner = []
      toBlocks(k, inner)
      out.push({ type: 'trap', blocks: inner })
    } else if (t === 'h3') {
      out.push({ type: 'h2', runs: tidy(inlineRuns(k)) })
    } else if (t === 'h4') {
      let tag = ''
      const rest = { tag: 'h4', attrs: {}, kids: [] }
      for (const kid of k.kids) {
        if (typeof kid !== 'string' && hasClass(kid, 'trap-tag')) tag = textOf(kid)
        else rest.kids.push(kid)
      }
      out.push({ type: 'h3', tag, runs: tidy(inlineRuns(rest)) })
    } else if (t === 'p') {
      const runs = tidy(inlineRuns(k))
      if (runs.length) out.push({ type: 'p', runs, lede: hasClass(k, 'lede') })
    } else if (t === 'pre') {
      out.push({ type: 'pre', lines: preLines(k) })
    } else if (t === 'ul' || t === 'ol') {
      const items = elems(k).filter((x) => x.tag === 'li')
      if (hasClass(k, 'steps')) {
        for (const li of items) {
          const inner = []
          toBlocks(li, inner)
          out.push({
            type: 'step',
            blocks: inner.length ? inner : [{ type: 'p', runs: tidy(inlineRuns(li)) }]
          })
        }
      } else {
        out.push({
          type: 'list',
          ordered: t === 'ol',
          items: items.map((li) => tidy(inlineRuns(li)))
        })
      }
    } else if (t === 'dl') {
      const items = []
      let dt = null
      for (const kid of elems(k)) {
        if (kid.tag === 'dt') dt = tidy(inlineRuns(kid))
        else if (kid.tag === 'dd') {
          items.push({ dt: dt ?? [], dd: tidy(inlineRuns(kid)) })
          dt = null
        }
      }
      out.push({ type: 'dl', items })
    } else if (t === 'table') {
      const head = []
      const rows = []
      for (const part of elems(k)) {
        for (const tr of elems(part).filter((x) => x.tag === 'tr')) {
          const cells = elems(tr)
            .filter((x) => x.tag === 'td' || x.tag === 'th')
            .map((cell) => ({ runs: tidy(inlineRuns(cell)), key: hasClass(cell, 'k') }))
          ;(part.tag === 'thead' ? head : rows).push(cells)
        }
      }
      out.push({ type: 'table', head, rows })
    } else if (t === 'figure') {
      let src = null
      let caption = []
      for (const kid of elems(k)) {
        if (kid.tag === 'img') {
          // The template stores {{name}}; the built HTML stores a data URI.
          const raw = kid.attrs.src ?? ''
          const named = /^\{\{([\w-]+)\}\}$/.exec(raw)
          if (named) src = join(IMAGES, `${named[1]}.jpg`)
        } else if (kid.tag === 'figcaption') caption = tidy(inlineRuns(kid))
      }
      if (src) out.push({ type: 'figure', src, caption })
    } else if (t === 'footer') {
      out.push({ type: 'footer', runs: tidy(inlineRuns(k)) })
    } else {
      toBlocks(k, out)
    }
  }
}

function masthead(node, out) {
  const find = (cls, tag) => {
    const stack = [node]
    while (stack.length) {
      const n = stack.pop()
      for (const kid of elems(n)) {
        if ((cls && hasClass(kid, cls)) || (tag && kid.tag === tag)) return kid
        stack.push(kid)
      }
    }
    return null
  }
  const kicker = find('kicker')
  const h1 = find(null, 'h1')
  const sub = find('h1-sub')
  const sf = find('standfirst')
  const meta = find('meta')
  if (kicker) out.push({ type: 'kicker', text: textOf(kicker) })
  if (h1) out.push({ type: 'title', text: textOf(h1) })
  if (sub) out.push({ type: 'subtitle', text: textOf(sub) })
  if (sf) out.push({ type: 'standfirst', runs: tidy(inlineRuns(sf)) })
  if (meta) {
    out.push({ type: 'meta', items: elems(meta).map(textOf).filter(Boolean) })
  }
}

// ---------------------------------------------------------------------------
// Blocks -> Word
// ---------------------------------------------------------------------------

/*
 * The house style, taken from the department's own 기술개발 note rather than
 * invented here: A4, 맑은 고딕 throughout, navy-on-white tables, one blue for
 * structure and one rust for warnings. Chapters do NOT start a new page —
 * that note runs continuously and so does this one.
 */
const PAGE_W = 11906
const MARGIN_X = 1440
const MARGIN_Y = 1200
const CONTENT = PAGE_W - MARGIN_X * 2 // 9026

const INK = '1F2126'
const ACCENT = '1B4FA8' // headings, key cells, inline code
const MUTED = '6E7480'
const WARN = 'B4560F' // the [주의] / [함정] tags
const TABLE_HEAD = '27364F' // navy header row
const SOFT = 'F4F6F9' // the one neutral fill in the palette
const WHITE = 'FFFFFF'
const KO = '맑은 고딕'
// The reference note has no code blocks, so it never had to choose a
// monospace face. This one is full of log lines, paths and commands where
// column alignment is the point, so it keeps one — recoloured to the palette
// rather than to a terminal's.
const MONO = 'Consolas'

function toTextRuns(rs, { size = 19, color = INK, allBold = false } = {}) {
  const out = []
  for (const r of rs ?? []) {
    String(r.t)
      .split('\n')
      .forEach((part, i) => {
        if (i > 0) out.push(new TextRun({ break: 1 }))
        if (!part) return
        out.push(
          new TextRun({
            text: part,
            bold: allBold || !!r.b,
            italics: !!r.i,
            font: r.c ? MONO : KO,
            size: r.c ? size - 2 : size,
            color: r.c ? ACCENT : color
          })
        )
      })
  }
  return out
}

const plain = (text, o) => toTextRuns([{ t: text }], o)

const para = (children, o = {}) =>
  new Paragraph({
    children,
    spacing: { before: o.before ?? 0, after: o.after ?? 120, line: o.line ?? 300 },
    indent: o.indent,
    alignment: o.alignment,
    border: o.border,
    numbering: o.numbering
  })

const chapterRule = { bottom: { style: BorderStyle.SINGLE, size: 10, color: ACCENT, space: 4 } }

/** PNG and JPEG carry their size in the header; no image library needed. */
function pngSize(buf) {
  return buf.length < 24 ? null : { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) }
}
function jpegSize(buf) {
  let i = 2
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) {
      i++
      continue
    }
    const marker = buf[i + 1]
    const len = buf.readUInt16BE(i + 2)
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) }
    }
    i += 2 + len
  }
  return null
}

function render(b, sink, opts = {}) {
  switch (b.type) {
    case 'kicker':
      sink(para(plain(b.text, { size: 17, color: MUTED }), { after: 40 }))
      break
    case 'title':
      // "기술개발 : Sky Explorer AI" in the reference — 20pt, bold, ink.
      sink(
        new Paragraph({
          children: plain(b.text, { size: 40, allBold: true }),
          heading: HeadingLevel.TITLE,
          spacing: { after: 40 }
        })
      )
      break
    case 'subtitle':
      sink(para(plain(b.text, { size: 19, color: ACCENT }), { after: 60 }))
      break
    case 'standfirst':
      sink(para(toTextRuns(b.runs, { size: 19 }), { before: 120, after: 120, line: 320 }))
      break
    case 'meta':
      sink(para(plain(b.items.join('  ·  '), { size: 17, color: MUTED }), { after: 260 }))
      break
    case 'h1': {
      // The reference numbers chapters "1. 개요" — the note stores "01".
      const no = b.no ? `${String(Number(b.no) || b.no)}. ` : ''
      sink(
        new Paragraph({
          children: [
            new TextRun({ text: `${no}${b.text}`, bold: true, size: 28, color: INK, font: KO }),
            ...(b.latin
              ? [new TextRun({ text: `   ${b.latin}`, size: 17, color: MUTED, font: KO })]
              : [])
          ],
          heading: HeadingLevel.HEADING_1,
          spacing: { before: 360, after: 140 },
          border: chapterRule,
          keepNext: true
        })
      )
      break
    }
    case 'h2':
      sink(
        new Paragraph({
          children: toTextRuns(b.runs, { size: 22, color: ACCENT, allBold: true }),
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 280, after: 100 },
          keepNext: true
        })
      )
      break
    case 'h3':
      // Warnings are an inline [tag] in rust, not a box — the reference has
      // no boxed callouts anywhere.
      sink(
        new Paragraph({
          children: [
            ...(b.tag
              ? [new TextRun({ text: `[${b.tag}] `, bold: true, size: 19, color: WARN, font: KO })]
              : []),
            ...toTextRuns(b.runs, { size: 19, allBold: true })
          ],
          heading: HeadingLevel.HEADING_3,
          spacing: { before: 200, after: 80 },
          keepNext: true
        })
      )
      break
    case 'p':
      sink(
        para(toTextRuns(b.runs, { size: 19, color: b.lede ? MUTED : INK }), {
          after: 120,
          line: 300,
          indent: opts.indent
        })
      )
      break
    case 'pre': {
      // One paragraph per source line: Word will not wrap code the way a
      // browser does, and a <pre> is not one paragraph with newlines in it.
      const lines = b.lines.length ? b.lines : [[]]
      lines.forEach((line, i) => {
        sink(
          new Paragraph({
            children: line.length
              ? line.map(
                  (r) =>
                    new TextRun({
                      text: r.t,
                      font: MONO,
                      size: 17,
                      bold: !!r.b,
                      italics: !!r.i,
                      // A greyed-out comment stays grey; everything else is ink.
                      color: r.d ? MUTED : INK
                    })
                )
              : [new TextRun({ text: ' ', font: MONO, size: 17, color: INK })],
            shading: { type: ShadingType.CLEAR, fill: SOFT, color: 'auto' },
            spacing: {
              before: i === 0 ? 100 : 0,
              after: i === lines.length - 1 ? 180 : 0,
              line: 260
            },
            indent: { left: (opts.indent?.left ?? 0) + 120, right: 120 }
          })
        )
      })
      break
    }
    case 'list':
      b.items.forEach((item) =>
        sink(
          para(toTextRuns(item), {
            after: 60,
            numbering: { reference: b.ordered ? 'num' : 'bul', level: 0 }
          })
        )
      )
      break
    case 'dl':
      b.items.forEach((it) => {
        sink(para(toTextRuns(it.dt, { allBold: true, color: ACCENT }), { after: 20, indent: { left: 200 } }))
        sink(para(toTextRuns(it.dd, { color: MUTED }), { after: 120, indent: { left: 560 } }))
      })
      break
    case 'step':
      b.blocks.forEach((inner, i) => {
        if (i === 0 && inner.type === 'h3') {
          sink(
            new Paragraph({
              children: [
                new TextRun({
                  text: `${opts.stepNo ?? 0}. `,
                  bold: true,
                  size: 22,
                  color: ACCENT,
                  font: KO
                }),
                ...toTextRuns(inner.runs, { size: 22, allBold: true })
              ],
              heading: HeadingLevel.HEADING_3,
              spacing: { before: 220, after: 100 },
              keepNext: true
            })
          )
        } else {
          render(inner, sink, { indent: { left: 300 } })
        }
      })
      break
    case 'trap': {
      /*
       * A trap is a heading with a rust [tag] and ordinary prose under it —
       * not a coloured box. The house style has no boxed callouts at all; its
       * device for "careful here" is the inline tag, and ten amber panels in
       * a row would read as a different document. The one concession is the
       * neutral fill from the same palette, so a trap still groups visually
       * when you are flipping pages looking for one.
       */
      const inner = []
      b.blocks.forEach((x) => render(x, (p) => inner.push(p)))
      if (!inner.length) break
      sink(
        new Table({
          columnWidths: [CONTENT],
          width: { size: CONTENT, type: WidthType.DXA },
          borders: {
            top: { style: BorderStyle.NONE },
            bottom: { style: BorderStyle.NONE },
            right: { style: BorderStyle.NONE },
            left: { style: BorderStyle.SINGLE, size: 12, color: WARN },
            insideHorizontal: { style: BorderStyle.NONE },
            insideVertical: { style: BorderStyle.NONE }
          },
          rows: [
            new TableRow({
              children: [
                new TableCell({
                  width: { size: CONTENT, type: WidthType.DXA },
                  shading: { type: ShadingType.CLEAR, fill: SOFT, color: 'auto' },
                  margins: { top: 140, bottom: 140, left: 200, right: 180 },
                  children: inner
                })
              ]
            })
          ]
        })
      )
      sink(para([new TextRun({ text: '' })], { after: 180 }))
      break
    }
    case 'table': {
      const cols = Math.max(b.head[0]?.length ?? 0, ...b.rows.map((r) => r.length), 1)
      const widths = []
      if (b.rows.some((r) => r[0]?.key) && cols > 1) {
        const first = Math.round(CONTENT * 0.18)
        widths.push(first)
        for (let i = 1; i < cols; i++) widths.push(Math.round((CONTENT - first) / (cols - 1)))
      } else {
        for (let i = 0; i < cols; i++) widths.push(Math.round(CONTENT / cols))
      }
      // Column widths must sum exactly to the table width.
      widths[widths.length - 1] += CONTENT - widths.reduce((a, c) => a + c, 0)

      const row = (cells, isHead) =>
        new TableRow({
          tableHeader: isHead,
          children: Array.from({ length: cols }, (_, i) => {
            const cell = cells[i]
            return new TableCell({
              width: { size: widths[i], type: WidthType.DXA },
              shading: isHead
                ? { type: ShadingType.CLEAR, fill: TABLE_HEAD, color: 'auto' }
                : undefined,
              margins: { top: 80, bottom: 80, left: 120, right: 120 },
              children: [
                new Paragraph({
                  // Navy header with white type; the key column in blue —
                  // straight from the reference note's tables.
                  children: toTextRuns(cell?.runs ?? [], {
                    size: 18,
                    color: isHead ? WHITE : cell?.key ? ACCENT : INK,
                    allBold: isHead || !!cell?.key
                  }),
                  spacing: { after: 0, line: 270 }
                })
              ]
            })
          })
        })

      sink(
        new Table({
          columnWidths: widths,
          width: { size: CONTENT, type: WidthType.DXA },
          borders: {
            top: { style: BorderStyle.SINGLE, size: 4, color: 'auto' },
            bottom: { style: BorderStyle.SINGLE, size: 4, color: 'auto' },
            left: { style: BorderStyle.SINGLE, size: 4, color: 'auto' },
            right: { style: BorderStyle.SINGLE, size: 4, color: 'auto' },
            insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: 'auto' },
            insideVertical: { style: BorderStyle.SINGLE, size: 4, color: 'auto' }
          },
          rows: [...b.head.map((r) => row(r, true)), ...b.rows.map((r) => row(r, false))]
        })
      )
      sink(para([new TextRun({ text: '' })], { after: 220 }))
      break
    }
    case 'figure':
    case 'svg': {
      const isDiagram = b.type === 'svg'
      const src = isDiagram ? join(IMAGES, 'diagram.png') : b.src
      if (!existsSync(src)) {
        console.warn(`  (건너뜀) 그림이 없습니다: ${src}`)
        break
      }
      const data = readFileSync(src)
      const dim = isDiagram ? pngSize(data) : jpegSize(data)
      const scale = dim ? Math.min(1, 620 / dim.w) : 1
      sink(
        new Paragraph({
          children: [
            new ImageRun({
              type: isDiagram ? 'png' : 'jpg',
              data,
              transformation: dim
                ? { width: Math.round(dim.w * scale), height: Math.round(dim.h * scale) }
                : { width: 560, height: 315 }
            })
          ],
          alignment: AlignmentType.CENTER,
          spacing: { before: 120, after: 60 }
        })
      )
      sink(
        para(
          toTextRuns(
            isDiagram
              ? [{ t: '데이터가 어디서 와서 어디로 가는지 — 허브와 두 창.' }]
              : b.caption,
            { size: 17, color: MUTED }
          ),
          { after: 240, alignment: AlignmentType.CENTER, line: 280 }
        )
      )
      break
    }
    case 'footer':
      sink(
        para(toTextRuns(b.runs, { size: 17, color: MUTED }), {
          before: 300,
          alignment: AlignmentType.CENTER,
          border: { top: { style: BorderStyle.SINGLE, size: 6, color: 'auto', space: 10 } }
        })
      )
      break
    default:
      break
  }
}

// ---------------------------------------------------------------------------

const template = readFileSync(join(root, 'docs/note.template.html'), 'utf8')
const blocks = []
toBlocks(parseHtml(template), blocks)

const children = []
const push = (p) => children.push(p)
let stepNo = 0
for (const b of blocks) {
  if (b.type === 'h1') stepNo = 0
  if (b.type === 'step') {
    stepNo++
    render(b, push, { stepNo })
  } else {
    render(b, push)
  }
}

const level = (format, text) => ({
  level: 0,
  format,
  text,
  alignment: AlignmentType.LEFT,
  style: { paragraph: { indent: { left: 460, hanging: 230 } } }
})

const doc = new Document({
  creator: 'Aviation Route',
  title: '돔 전시 프로그램 인수인계',
  description: '과학관 돔 전시 프로그램 기술개발 노트',
  numbering: {
    config: [
      { reference: 'bul', levels: [level(LevelFormat.BULLET, '·')] },
      { reference: 'num', levels: [level(LevelFormat.DECIMAL, '%1.')] }
    ]
  },
  styles: { default: { document: { run: { font: KO, size: 19, color: INK } } } },
  sections: [
    {
      properties: {
        page: {
          size: { width: PAGE_W, height: 16838 },
          margin: { top: MARGIN_Y, bottom: MARGIN_Y, left: MARGIN_X, right: MARGIN_X }
        }
      },
      footers: {
        default: new Footer({
          children: [
            new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [
                new TextRun({ children: [PageNumber.CURRENT], font: KO, size: 16, color: MUTED })
              ]
            })
          ]
        })
      },
      children
    }
  ]
})

const outPath = join(root, 'docs/기술개발노트.docx')
const buf = await Packer.toBuffer(doc)
writeFileSync(outPath, buf)
console.log(
  `docs/기술개발노트.docx — ${(buf.length / 1024 / 1024).toFixed(2)}MB, ` +
    `${blocks.length}개 블록 / ${children.length}개 문단·표`
)
