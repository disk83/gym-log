import { unzlibSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { A4, encodeWinAnsi, fitText, PdfDoc, textWidth, wrapText } from './pdf'

const latin1 = (bytes: Uint8Array) => new TextDecoder('latin1').decode(bytes)

describe('encodeWinAnsi', () => {
  it('keeps ASCII and Latin-1 letters', () => {
    expect([...encodeWinAnsi('Sentadilla ñ é')]).toEqual([...'Sentadilla '].map((c) => c.charCodeAt(0)).concat([0xf1, 0x20, 0xe9]))
  })

  it('maps the extra Windows-1252 characters and replaces the rest', () => {
    expect([...encodeWinAnsi('–…•')]).toEqual([0x96, 0x85, 0x95])
    expect(latin1(encodeWinAnsi('a→b漢'))).toBe('a?b?')
  })

  it('turns control characters into spaces', () => {
    expect(latin1(encodeWinAnsi('a\tb\nc'))).toBe('a b c')
  })
})

describe('text measuring', () => {
  it('uses the Helvetica widths', () => {
    // H 722 + e 556 + l 222 + l 222 + o 556 = 2278
    expect(textWidth('Hello', 10)).toBeCloseTo(22.78, 5)
    expect(textWidth('Hello', 10, true)).toBeGreaterThan(textWidth('Hello', 10))
  })

  it('measures an accented letter like its base letter', () => {
    expect(textWidth('é', 10)).toBe(textWidth('e', 10))
  })

  it('fits text with an ellipsis', () => {
    expect(fitText('Short', 100, 10)).toBe('Short')
    const cut = fitText('A very long exercise name indeed', 60, 10)
    expect(cut.endsWith('…')).toBe(true)
    expect(textWidth(cut, 10)).toBeLessThanOrEqual(60)
  })

  it('wraps text into at most the given lines', () => {
    const lines = wrapText('one two three four five six seven eight nine ten', 60, 10, 2)
    expect(lines).toHaveLength(2)
    expect(lines[1].endsWith('…')).toBe(true)
    expect(wrapText('short', 100, 10, 3)).toEqual(['short'])
    expect(wrapText('', 100, 10, 3)).toEqual([])
  })
})

describe('PdfDoc', () => {
  function sample() {
    const doc = new PdfDoc({ title: 'Gym progress – test', created: new Date('2026-11-17T08:00:00Z') })
    const first = doc.addPage()
    first.text(40, 60, 'Hello (world) \\ ñ', { size: 20, bold: true, color: '#16a34a' })
    first.line(40, 80, 200, 80, { width: 2, color: '#ff0000', dash: [3, 2] })
    first.rect(40, 100, 100, 50, { fill: '#eeeeee', stroke: '#000000' })
    first.circle(100, 200, 5, { fill: '#000000' })
    first.polyline([[40, 300], [80, 260], [120, 280]], { width: 1.5 })
    first.polygon([[10, 10], [20, 10], [15, 20]], { fill: '#000000' })
    doc.addPage().text(A4.width, 50, 'Second', { align: 'right' })
    return doc
  }

  it('writes a well-formed file with one page object per page', () => {
    const doc = sample()
    const bytes = doc.build()
    const text = latin1(bytes)
    expect(text.startsWith('%PDF-1.4')).toBe(true)
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true)
    expect(doc.pageCount).toBe(2)
    expect(text.match(/\/Type \/Page /g)).toHaveLength(2)
    expect(text).toContain('/Count 2')
  })

  it('has an xref table whose offsets point at the objects', () => {
    const bytes = sample().build()
    const text = latin1(bytes)
    const startxref = Number(/startxref\n(\d+)\n%%EOF/.exec(text)![1])
    expect(text.slice(startxref, startxref + 4)).toBe('xref')
    const entries = [...text.slice(startxref).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]))
    expect(entries).toHaveLength(9) // catalog, tree, 2 fonts, info, 2 pages x 2
    entries.forEach((offset, i) => expect(text.slice(offset, offset + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`))
  })

  it('writes the page content compressed, with text as hex WinAnsi', () => {
    const bytes = sample().build()
    const text = latin1(bytes)
    const stream = /stream\n([\s\S]*?)\nendstream/.exec(text)!
    const start = text.indexOf(stream[1], text.indexOf('stream\n'))
    const length = Number(/\/Length (\d+) \/Filter/.exec(text)![1])
    const content = latin1(unzlibSync(bytes.slice(start, start + length)))
    // "Hello (world) \ ñ" with the brackets and backslash written safely as hex.
    expect(content).toContain('<48656c6c6f2028776f726c6429205c20f1>')
    expect(content).toContain('0.09 0.64 0.29 rg')
    expect(content).toContain('/F2 20 Tf')
    expect(content).toContain('[3 2] 0 d')
    // y is flipped: baseline 60 from the top of an A4 page.
    expect(content).toContain(`40 ${A4.height - 60} Td`)
  })

  it('stores the title as UTF-16 and the creation date', () => {
    const text = latin1(sample().build())
    expect(text).toContain('/Title <feff')
    expect(text).toContain('/CreationDate (D:20261117080000Z)')
  })

  it('rejects a bad colour', () => {
    expect(() => new PdfDoc().addPage().text(0, 0, 'x', { color: 'red' })).toThrow('Invalid colour')
  })
})
