import { zlibSync } from 'fflate'

// A minimal PDF writer, enough for the progress report: A4-style pages with
// text (built-in Helvetica), lines, rectangles, circles and polylines. No
// fonts are embedded, so text is limited to the standard Western Latin set
// (WinAnsi); anything else is written as "?". Coordinates are in points with
// the origin at the top left of the page, y growing downwards.

export const A4 = { width: 595.28, height: 841.89 }

/** A colour as "#rrggbb". */
export type Color = string

// ---------- Text encoding and measuring ----------

/** Code points in the Windows-1252 block 0x80-0x9F that are not Latin-1. */
const WIN_ANSI_SPECIAL: Record<number, number> = {
  0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87,
  0x02c6: 0x88, 0x2030: 0x89, 0x0160: 0x8a, 0x2039: 0x8b, 0x0152: 0x8c, 0x017d: 0x8e, 0x2018: 0x91,
  0x2019: 0x92, 0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x02dc: 0x98,
  0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b, 0x0153: 0x9c, 0x017e: 0x9e, 0x0178: 0x9f,
}

/** The text as WinAnsi bytes: unsupported characters become "?", control characters a space. */
export function encodeWinAnsi(text: string): Uint8Array {
  const bytes: number[] = []
  for (const ch of text.normalize('NFC')) {
    const c = ch.codePointAt(0)!
    if (c >= 0x300 && c <= 0x36f) continue // a combining mark that did not compose
    if (c < 0x20 || c === 0x7f) bytes.push(0x20)
    else if (c <= 0x7e || (c >= 0xa0 && c <= 0xff)) bytes.push(c)
    else bytes.push(WIN_ANSI_SPECIAL[c] ?? 0x3f)
  }
  return Uint8Array.from(bytes)
}

// Helvetica glyph widths (1000 units per em) for ASCII 32..126.
// prettier-ignore
const REGULAR_WIDTHS = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
  556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
]
// prettier-ignore
const BOLD_WIDTHS = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611,
  975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556,
  333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611,
  611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584,
]

const OTHER_WIDTHS: Record<string, number> = { '×': 584, '·': 278, '–': 556, '—': 1000, '•': 350, '…': 1000, '→': 556 }

function glyphWidth(ch: string, bold: boolean): number {
  const table = bold ? BOLD_WIDTHS : REGULAR_WIDTHS
  const c = ch.codePointAt(0)!
  if (c >= 32 && c <= 126) return table[c - 32]
  if (ch in OTHER_WIDTHS) return OTHER_WIDTHS[ch]
  // An accented letter is about as wide as its base letter.
  const base = ch.normalize('NFD').codePointAt(0)!
  if (base >= 32 && base <= 126 && base !== c) return table[base - 32]
  return 556
}

/** Width in points of a text in Helvetica (regular or bold) at a font size. */
export function textWidth(text: string, size: number, bold = false): number {
  let units = 0
  for (const ch of text) units += glyphWidth(ch, bold)
  return (units * size) / 1000
}

/** The text cut so it fits `maxWidth`, ending with "…" when something was removed. */
export function fitText(text: string, maxWidth: number, size: number, bold = false): string {
  if (textWidth(text, size, bold) <= maxWidth) return text
  const chars = [...text]
  while (chars.length > 0 && textWidth(chars.join('') + '…', size, bold) > maxWidth) chars.pop()
  return chars.join('').trimEnd() + '…'
}

/** The text broken into at most `maxLines` lines that fit `maxWidth`; the last line ends with "…" if cut. */
export function wrapText(text: string, maxWidth: number, size: number, maxLines: number, bold = false): string[] {
  const words = text.split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let current = ''
  for (let i = 0; i < words.length; i++) {
    const next = current ? `${current} ${words[i]}` : words[i]
    if (textWidth(next, size, bold) <= maxWidth || !current) {
      current = next
      continue
    }
    if (lines.length === maxLines - 1) {
      return [...lines, fitText([current, ...words.slice(i)].join(' '), maxWidth, size, bold)]
    }
    lines.push(current)
    current = words[i]
  }
  if (current) lines.push(fitText(current, maxWidth, size, bold))
  return lines
}

// ---------- Pages ----------

export interface TextStyle {
  size?: number
  bold?: boolean
  color?: Color
  align?: 'left' | 'center' | 'right'
}

export interface StrokeStyle {
  width?: number
  color?: Color
  /** On and off lengths of a dashed line. */
  dash?: [number, number]
}

export interface ShapeStyle {
  fill?: Color
  stroke?: Color
  width?: number
}

/** Numbers in a content stream: at most 2 decimals, no trailing zeros. */
function n(value: number): string {
  return String(Math.round(value * 100) / 100)
}

function rgb(color: Color): string {
  const m = /^#([0-9a-f]{6})$/i.exec(color)
  if (!m) throw new Error(`Invalid colour: ${color}`)
  const v = parseInt(m[1], 16)
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255].map((c) => n(c / 255)).join(' ')
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

export class PdfPage {
  readonly ops: string[] = []

  constructor(
    readonly width = A4.width,
    readonly height = A4.height,
  ) {}

  private flip(y: number): number {
    return this.height - y
  }

  /** Text with its baseline at y; x is the left edge, centre or right edge by `align`. */
  text(x: number, y: number, text: string, { size = 10, bold = false, color = '#000000', align = 'left' }: TextStyle = {}): void {
    const w = textWidth(text, size, bold)
    const left = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x
    this.ops.push(
      `${rgb(color)} rg BT /${bold ? 'F2' : 'F1'} ${n(size)} Tf ${n(left)} ${n(this.flip(y))} Td <${hex(encodeWinAnsi(text))}> Tj ET`,
    )
  }

  line(x1: number, y1: number, x2: number, y2: number, style: StrokeStyle = {}): void {
    this.polyline(
      [
        [x1, y1],
        [x2, y2],
      ],
      style,
    )
  }

  polyline(points: readonly (readonly [number, number])[], { width = 1, color = '#000000', dash }: StrokeStyle = {}): void {
    if (points.length < 2) return
    const path = points.map(([x, y], i) => `${n(x)} ${n(this.flip(y))} ${i === 0 ? 'm' : 'l'}`).join(' ')
    const dashOp = dash ? `[${n(dash[0])} ${n(dash[1])}] 0 d` : '[] 0 d'
    this.ops.push(`q ${rgb(color)} RG ${n(width)} w 1 J 1 j ${dashOp} ${path} S Q`)
  }

  private paint({ fill, stroke, width = 1 }: ShapeStyle, shape: string): void {
    if (!fill && !stroke) return
    const colors = `${fill ? `${rgb(fill)} rg ` : ''}${stroke ? `${rgb(stroke)} RG ${n(width)} w ` : ''}`
    const paint = fill && stroke ? 'B' : fill ? 'f' : 'S'
    this.ops.push(`q ${colors}${shape} ${paint} Q`)
  }

  /** A rectangle with its top-left corner at (x, y). */
  rect(x: number, y: number, w: number, h: number, style: ShapeStyle): void {
    this.paint(style, `${n(x)} ${n(this.flip(y + h))} ${n(w)} ${n(h)} re`)
  }

  circle(cx: number, cy: number, r: number, style: ShapeStyle): void {
    const k = 0.5523 * r
    const y = this.flip(cy)
    const path = [
      `${n(cx + r)} ${n(y)} m`,
      `${n(cx + r)} ${n(y + k)} ${n(cx + k)} ${n(y + r)} ${n(cx)} ${n(y + r)} c`,
      `${n(cx - k)} ${n(y + r)} ${n(cx - r)} ${n(y + k)} ${n(cx - r)} ${n(y)} c`,
      `${n(cx - r)} ${n(y - k)} ${n(cx - k)} ${n(y - r)} ${n(cx)} ${n(y - r)} c`,
      `${n(cx + k)} ${n(y - r)} ${n(cx + r)} ${n(y - k)} ${n(cx + r)} ${n(y)} c h`,
    ].join(' ')
    this.paint(style, path)
  }

  /** A filled closed shape. */
  polygon(points: readonly (readonly [number, number])[], style: ShapeStyle): void {
    if (points.length < 3) return
    this.paint(style, points.map(([x, y], i) => `${n(x)} ${n(this.flip(y))} ${i === 0 ? 'm' : 'l'}`).join(' ') + ' h')
  }
}

// ---------- Document ----------

export interface PdfInfo {
  title?: string
  created?: Date
}

function pdfDate(d: Date): string {
  const pad = (v: number) => String(v).padStart(2, '0')
  return `D:${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
}

/** A text string as UTF-16BE hex, which any viewer shows correctly. */
function utf16Hex(text: string): string {
  let out = 'feff'
  for (let i = 0; i < text.length; i++) out += text.charCodeAt(i).toString(16).padStart(4, '0')
  return out
}

export class PdfDoc {
  private readonly pages: PdfPage[] = []

  constructor(private readonly info: PdfInfo = {}) {}

  get pageCount(): number {
    return this.pages.length
  }

  addPage(): PdfPage {
    const page = new PdfPage()
    this.pages.push(page)
    return page
  }

  build(): Uint8Array {
    const encoder = new TextEncoder()
    const chunks: Uint8Array[] = []
    const offsets: number[] = []
    let length = 0
    const push = (data: string | Uint8Array) => {
      const bytes = typeof data === 'string' ? encoder.encode(data) : data
      chunks.push(bytes)
      length += bytes.length
    }
    // Object ids: 1 catalog, 2 page tree, 3-4 fonts, 5 info, then a page and its content per page.
    const object = (id: number, body: string | (() => void)) => {
      offsets[id] = length
      push(`${id} 0 obj\n`)
      if (typeof body === 'string') push(body)
      else body()
      push('\nendobj\n')
    }
    const pageId = (i: number) => 6 + 2 * i
    const contentId = (i: number) => 7 + 2 * i
    const total = 5 + 2 * this.pages.length

    push('%PDF-1.4\n')
    push(Uint8Array.from([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a])) // a binary comment so tools treat the file as binary
    object(1, '<< /Type /Catalog /Pages 2 0 R >>')
    object(2, `<< /Type /Pages /Count ${this.pages.length} /Kids [${this.pages.map((_, i) => `${pageId(i)} 0 R`).join(' ')}] >>`)
    object(3, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>')
    object(4, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>')
    const info = ['/Producer (Gym Log)']
    if (this.info.title) info.push(`/Title <${utf16Hex(this.info.title)}>`)
    if (this.info.created) info.push(`/CreationDate (${pdfDate(this.info.created)})`)
    object(5, `<< ${info.join(' ')} >>`)

    this.pages.forEach((page, i) => {
      object(
        pageId(i),
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${n(page.width)} ${n(page.height)}] ` +
          `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentId(i)} 0 R >>`,
      )
      const content = zlibSync(encoder.encode(page.ops.join('\n')))
      object(contentId(i), () => {
        push(`<< /Length ${content.length} /Filter /FlateDecode >>\nstream\n`)
        push(content)
        push('\nendstream')
      })
    })

    const xref = length
    push(`xref\n0 ${total + 1}\n0000000000 65535 f \n`)
    for (let id = 1; id <= total; id++) push(`${String(offsets[id]).padStart(10, '0')} 00000 n \n`)
    push(`trailer\n<< /Size ${total + 1} /Root 1 0 R /Info 5 0 R >>\nstartxref\n${xref}\n%%EOF\n`)

    const out = new Uint8Array(length)
    let at = 0
    for (const chunk of chunks) {
      out.set(chunk, at)
      at += chunk.length
    }
    return out
  }
}
