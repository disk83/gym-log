import { strToU8, zipSync } from 'fflate'

// A minimal .xlsx writer: one sheet, a bold frozen header row with an
// autofilter, column widths, and text, number and date cells. Written by hand
// on top of fflate (zip) so it works offline and can freeze the header row,
// which the SheetJS community build cannot write.

/** A date cell, as an Excel serial day number (see excelDate). */
export interface DateCell {
  date: number
}

export type Cell = string | number | DateCell | null | undefined

export interface Column {
  header: string
  /** Width in characters. */
  width: number
}

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

/** Excel serial day number of a calendar date (1900 date system). */
export function excelDate(year: number, month: number, day: number): DateCell {
  return { date: (Date.UTC(year, month - 1, day) - Date.UTC(1899, 11, 30)) / 86_400_000 }
}

/** Column letters for a 0-based index: 0 → A, 25 → Z, 26 → AA. */
export function columnName(index: number): string {
  let name = ''
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    name = String.fromCharCode(65 + ((n - 1) % 26)) + name
  }
  return name
}

function escapeXml(text: string): string {
  return (
    text
      // Control characters are not allowed in XML 1.0.
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
  )
}

const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
const REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const PKG_REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships'
const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'

// Cell style ids, indexes into cellXfs in styles.xml.
const STYLE_HEADER = 1
const STYLE_DATE = 2

const STYLES =
  XML_HEAD +
  `<styleSheet xmlns="${NS}">` +
  '<numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy-mm-dd"/></numFmts>' +
  '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
  '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
  '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="3">' +
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
  '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
  '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  '</cellXfs>' +
  '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
  '</styleSheet>'

/** Build a one-sheet workbook. Returns the .xlsx file bytes. */
export function buildXlsx(sheetName: string, columns: readonly Column[], rows: readonly (readonly Cell[])[]): Uint8Array {
  const strings: string[] = []
  const stringIndex = new Map<string, number>()
  const shared = (text: string) => {
    let i = stringIndex.get(text)
    if (i === undefined) {
      i = strings.length
      strings.push(text)
      stringIndex.set(text, i)
    }
    return i
  }

  const cellXml = (ref: string, cell: Cell, style = 0): string => {
    const s = style ? ` s="${style}"` : ''
    if (cell == null || cell === '') return ''
    if (typeof cell === 'number') return Number.isFinite(cell) ? `<c r="${ref}"${s}><v>${cell}</v></c>` : ''
    if (typeof cell === 'string') return `<c r="${ref}" t="s"${s}><v>${shared(cell)}</v></c>`
    return `<c r="${ref}" s="${STYLE_DATE}"><v>${cell.date}</v></c>`
  }

  const rowXml = (cells: readonly Cell[], r: number, style = 0) =>
    `<row r="${r}">${cells.map((c, i) => cellXml(`${columnName(i)}${r}`, c, style)).join('')}</row>`

  const lastCol = columnName(Math.max(columns.length - 1, 0))
  const lastRow = rows.length + 1
  const range = `A1:${lastCol}${lastRow}`
  const safeName = escapeXml(sheetName.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Sheet1')

  const sheet =
    XML_HEAD +
    `<worksheet xmlns="${NS}" xmlns:r="${REL_NS}">` +
    `<dimension ref="${range}"/>` +
    '<sheetViews><sheetView tabSelected="1" workbookViewId="0">' +
    '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>' +
    '<selection pane="bottomLeft" activeCell="A2" sqref="A2"/>' +
    '</sheetView></sheetViews>' +
    '<sheetFormatPr defaultRowHeight="15"/>' +
    `<cols>${columns.map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.width}" customWidth="1"/>`).join('')}</cols>` +
    '<sheetData>' +
    rowXml(
      columns.map((c) => c.header),
      1,
      STYLE_HEADER,
    ) +
    rows.map((cells, i) => rowXml(cells, i + 2)).join('') +
    '</sheetData>' +
    `<autoFilter ref="${range}"/>` +
    '</worksheet>'

  const sharedStrings =
    XML_HEAD +
    `<sst xmlns="${NS}" count="${strings.length}" uniqueCount="${strings.length}">` +
    strings.map((t) => `<si><t xml:space="preserve">${escapeXml(t)}</t></si>`).join('') +
    '</sst>'

  const workbook =
    XML_HEAD +
    `<workbook xmlns="${NS}" xmlns:r="${REL_NS}">` +
    `<sheets><sheet name="${safeName}" sheetId="1" r:id="rId1"/></sheets>` +
    `<definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">'${safeName.replace(/'/g, "''")}'!$A$1:$${lastCol}$${lastRow}</definedName></definedNames>` +
    '</workbook>'

  const files: Record<string, string> = {
    '[Content_Types].xml':
      XML_HEAD +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>' +
      '</Types>',
    '_rels/.rels':
      XML_HEAD +
      `<Relationships xmlns="${PKG_REL_NS}">` +
      `<Relationship Id="rId1" Type="${REL_NS}/officeDocument" Target="xl/workbook.xml"/>` +
      '</Relationships>',
    'xl/workbook.xml': workbook,
    'xl/_rels/workbook.xml.rels':
      XML_HEAD +
      `<Relationships xmlns="${PKG_REL_NS}">` +
      `<Relationship Id="rId1" Type="${REL_NS}/worksheet" Target="worksheets/sheet1.xml"/>` +
      `<Relationship Id="rId2" Type="${REL_NS}/styles" Target="styles.xml"/>` +
      `<Relationship Id="rId3" Type="${REL_NS}/sharedStrings" Target="sharedStrings.xml"/>` +
      '</Relationships>',
    'xl/worksheets/sheet1.xml': sheet,
    'xl/styles.xml': STYLES,
    'xl/sharedStrings.xml': sharedStrings,
  }

  return zipSync(Object.fromEntries(Object.entries(files).map(([path, xml]) => [path, strToU8(xml)])))
}
