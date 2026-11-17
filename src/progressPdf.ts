import { A4, fitText, PdfDoc, wrapText, type Color, type PdfPage, type TextStyle } from './pdf'
import { labelIndices, niceScale, type ProgressUnit, type TrendKind } from './progress'
import {
  progressReportFileName,
  valueChange,
  valueLabelIndices,
  weightChange,
  type ExercisePage,
  type ProgressReport,
  type SessionEntry,
} from './progressReport'
import { LOAD_LABELS } from './manage/format'
import { formatLogValues, formatShortDate } from './session/format'
import { formatValue, trendText, UNIT_LABELS } from './session/ProgressChart'

// Draws the progress report (spec section 5b) as a PDF: a cover with an index
// of the exercises, then one page per exercise.

const M = 40
const W = A4.width
const CW = W - 2 * M

const INK: Color = '#111827'
const MUTED: Color = '#6b7280'
const LINE: Color = '#e5e7eb'
const TILE: Color = '#f3f4f6'
const ACCENT: Color = '#16a34a'
const TREND_COLORS: Record<TrendKind | 'none', Color> = {
  up: '#16a34a',
  down: '#dc2626',
  flat: '#6b7280',
  stalled: '#d97706',
  none: '#9ca3af',
}

// ---------- Text helpers ----------

/** A "YYYY-MM-DD" day as an ISO time at local noon, for the date formatters. */
function dayIso(day: string): string {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(y, m - 1, d, 12).toISOString()
}

function rangeText(report: Pick<ProgressReport, 'start' | 'end'>): string {
  return `${formatShortDate(dayIso(report.start), true)} - ${formatShortDate(dayIso(report.end), true)}`
}

function signed(value: number): string {
  return value > 0 ? `+${formatValue(value)}` : formatValue(value)
}

const BEST_LABELS: Record<ProgressUnit, string> = { '1RM': 'est. 1RM', reps: 'reps', s: 'seconds' }

const TYPE_LABELS = { strength: 'Strength', timed: 'Timed' } as const

export interface Tile {
  label: string
  value: string
  sub?: string
}

/** The six summary tiles of an exercise page (2 rows of 3). */
export function summaryTiles(page: ExercisePage): Tile[] {
  const first = page.entries[0]
  const last = page.entries[page.entries.length - 1]
  const unit = BEST_LABELS[page.unit]
  const hasWeights = page.firstWeight != null
  const plotted = page.entries.filter((e) => e.value != null).length
  const delta = plotted >= 2 ? valueChange(page) : undefined
  const sameDay = formatShortDate(page.firstDate, true) === formatShortDate(page.lastDate, true)

  const tiles: Tile[] = [
    {
      label: 'Sessions',
      value: String(page.sessionCount),
      sub: sameDay ? formatShortDate(page.lastDate, true) : `${formatShortDate(page.firstDate, true)} - ${formatShortDate(page.lastDate, true)}`,
    },
  ]
  if (hasWeights) {
    const change = weightChange(page)
    tiles.push(
      {
        label: 'Weight, first to latest',
        value: `${formatValue(page.firstWeight!)} to ${formatValue(page.lastWeight!)}`,
        sub: change == null || change === 0 ? 'No change' : signed(change),
      },
      { label: 'Best weight', value: formatValue(page.bestWeight!) },
    )
  } else {
    tiles.push(
      { label: 'First session', value: formatLogValues(first, page.exercise), sub: formatShortDate(first.date, true) },
      { label: 'Latest session', value: formatLogValues(last, page.exercise), sub: formatShortDate(last.date, true) },
    )
  }
  tiles.push(
    { label: `Best ${unit}`, value: page.bestValue != null ? formatValue(page.bestValue) : '-' },
    {
      label: `Latest ${unit}`,
      value: page.lastValue != null ? formatValue(page.lastValue) : '-',
      sub: page.lastValue != null ? formatShortDate(page.lastDate, true) : undefined,
    },
    {
      label: `Change in ${unit}`,
      value: delta ? `${signed(delta.change)}${delta.percent != null ? ` (${delta.percent > 0 ? '+' : ''}${delta.percent}%)` : ''}` : '-',
      sub: delta ? `from ${formatValue(page.firstValue!)}` : 'Needs 2 sessions',
    },
  )
  return tiles
}

// ---------- Drawing helpers ----------

function marker(page: PdfPage, kind: TrendKind | undefined, cx: number, cy: number, r = 4.5): void {
  const color = TREND_COLORS[kind ?? 'none']
  switch (kind) {
    case 'up':
      page.polygon([[cx, cy - r], [cx + r, cy + r * 0.8], [cx - r, cy + r * 0.8]], { fill: color })
      break
    case 'down':
      page.polygon([[cx - r, cy - r * 0.8], [cx + r, cy - r * 0.8], [cx, cy + r]], { fill: color })
      break
    case 'flat':
      page.rect(cx - r, cy - r * 0.35, 2 * r, r * 0.7, { fill: color })
      break
    case 'stalled':
      page.circle(cx, cy, r * 0.8, { fill: color })
      break
    default:
      page.line(cx - r, cy, cx + r, cy, { width: 1.5, color })
  }
}

function pageHeader(page: PdfPage, report: ProgressReport, number: number, total: number): void {
  page.text(M, 30, `Gym progress report  |  ${rangeText(report)}`, { size: 8, color: MUTED })
  page.text(W - M, 30, `Page ${number} of ${total}`, { size: 8, color: MUTED, align: 'right' })
  page.line(M, 37, W - M, 37, { width: 0.5, color: LINE })
}

function tile(page: PdfPage, x: number, y: number, w: number, h: number, t: Tile): void {
  page.rect(x, y, w, h, { fill: TILE })
  page.text(x + 10, y + 16, t.label, { size: 8, color: MUTED })
  page.text(x + 10, y + 36, fitText(t.value, w - 20, 15, true), { size: 15, bold: true, color: INK })
  if (t.sub) page.text(x + 10, y + 48, fitText(t.sub, w - 20, 8), { size: 8, color: MUTED })
}

// ---------- Cover ----------

const INDEX_ROW = 19
const FIRST_ROWS_TOP = 268
const NEXT_ROWS_TOP = 98
const ROWS_BOTTOM = 805

function indexCapacity(count: number): { pages: number; first: number; next: number } {
  const first = Math.floor((ROWS_BOTTOM - FIRST_ROWS_TOP) / INDEX_ROW)
  const next = Math.floor((ROWS_BOTTOM - NEXT_ROWS_TOP) / INDEX_ROW)
  return { pages: 1 + Math.ceil(Math.max(0, count - first) / next), first, next }
}

/** How many pages the cover and index take for this many exercises (1 up to 28 exercises). */
export function coverPageCount(exerciseCount: number): number {
  return indexCapacity(exerciseCount).pages
}

function indexHeader(page: PdfPage, y: number): void {
  page.text(M, y, 'Exercise', { size: 8, bold: true, color: MUTED })
  page.text(250, y, 'Latest session', { size: 8, bold: true, color: MUTED })
  page.text(390, y, 'Trend', { size: 8, bold: true, color: MUTED })
  page.text(W - M, y, 'Page', { size: 8, bold: true, color: MUTED, align: 'right' })
  page.line(M, y + 5, W - M, y + 5, { width: 0.75, color: LINE })
}

function indexRow(page: PdfPage, top: number, p: ExercisePage, pageNumber: number): void {
  const base = top + 13
  const last = p.entries[p.entries.length - 1]
  page.text(M, base, fitText(p.exercise.name, 200, 10), { size: 10, color: INK })
  page.text(250, base, fitText(formatLogValues(last, p.exercise), 130, 10), { size: 10, color: INK })
  marker(page, p.trend?.kind, 396, base - 3.5, 4)
  const verdict = p.trend ? trendText(p.trend.kind, p.trend.sessionsSinceBest).text : 'Not enough data'
  page.text(408, base, fitText(verdict, 110, 9), { size: 9, color: MUTED })
  page.text(W - M, base, String(pageNumber), { size: 10, color: INK, align: 'right' })
  page.line(M, top + INDEX_ROW, W - M, top + INDEX_ROW, { width: 0.25, color: LINE })
}

function drawCover(doc: PdfDoc, report: ProgressReport, total: number): void {
  const cap = indexCapacity(report.pages.length)
  const page = doc.addPage()
  pageHeader(page, report, 1, total)
  page.text(M, 80, 'Gym progress report', { size: 28, bold: true, color: INK })
  page.text(M, 104, rangeText(report), { size: 13, color: INK })
  page.text(M, 120, `Generated ${formatShortDate(report.generatedAt, true)}`, { size: 9, color: MUTED })

  const { trends } = report
  const stats: { label: string; value: number; color: Color }[] = [
    { label: 'Sessions', value: report.sessionCount, color: INK },
    { label: 'Exercises', value: report.pages.length, color: INK },
    { label: 'Trending up', value: trends.up, color: TREND_COLORS.up },
    { label: 'Holding steady', value: trends.flat, color: TREND_COLORS.flat },
    { label: 'No new best', value: trends.stalled, color: TREND_COLORS.stalled },
    { label: 'Trending down', value: trends.down, color: TREND_COLORS.down },
  ]
  const gap = 7
  const w = (CW - 5 * gap) / 6
  stats.forEach((s, i) => {
    const x = M + i * (w + gap)
    page.rect(x, 145, w, 58, { fill: TILE })
    page.text(x + 10, 163, s.label, { size: 8, color: MUTED })
    page.text(x + 10, 192, String(s.value), { size: 24, bold: true, color: s.color })
  })
  if (trends.none > 0) {
    const n = trends.none
    page.text(M, 220, `${n} exercise${n === 1 ? ' has' : 's have'} fewer than 2 sessions with data, so no trend yet.`, { size: 9, color: MUTED })
  }

  page.text(M, 240, 'Exercises', { size: 11, bold: true, color: INK })
  indexHeader(page, 258)
  let current = page
  report.pages.forEach((p, i) => {
    let top: number
    if (i < cap.first) top = FIRST_ROWS_TOP + i * INDEX_ROW
    else {
      const j = i - cap.first
      if (j % cap.next === 0) {
        const number = 2 + Math.floor(j / cap.next)
        current = doc.addPage()
        pageHeader(current, report, number, total)
        current.text(M, 70, 'Exercises (continued)', { size: 11, bold: true, color: INK })
        indexHeader(current, 90)
      }
      top = NEXT_ROWS_TOP + (j % cap.next) * INDEX_ROW
    }
    indexRow(current, top, p, cap.pages + i + 1)
  })
}

// ---------- Exercise page ----------

const CHART = { left: M + 38, right: W - M - 8, top: 340, bottom: 540, padX: 12 }

function yTitle(page: ExercisePage): string {
  const weighted = page.unit === '1RM'
  const base = weighted ? 'Est. 1RM and weight' : UNIT_LABELS[page.unit]
  return page.exercise.loadType === 'per_dumbbell' && weighted ? `${base} (per dumbbell)` : base
}

function drawChart(page: PdfPage, p: ExercisePage): void {
  const points = p.entries.filter((e): e is SessionEntry & { value: number } => e.value != null)
  page.text(M, 328, yTitle(p), { size: 10, bold: true, color: INK })
  if (points.length === 0) {
    page.rect(CHART.left - 38, CHART.top - 6, CHART.right - CHART.left + 38, CHART.bottom - CHART.top + 6, { stroke: LINE })
    page.text((M + W - M) / 2, (CHART.top + CHART.bottom) / 2, 'Nothing to plot: no weight was logged for this exercise.', {
      size: 10,
      color: MUTED,
      align: 'center',
    })
    return
  }
  const twoLines = p.unit === '1RM'
  const values = points.map((e) => e.value)
  const weights = twoLines ? points.map((e) => e.weight ?? e.value) : []
  const all = [...values, ...weights]
  const scale = niceScale(Math.min(...all), Math.max(...all), 5, p.unit !== '1RM')
  const x = (i: number) =>
    points.length === 1
      ? (CHART.left + CHART.right) / 2
      : CHART.left + CHART.padX + (i / (points.length - 1)) * (CHART.right - CHART.left - 2 * CHART.padX)
  const y = (v: number) => CHART.top + (1 - (v - scale.min) / (scale.max - scale.min)) * (CHART.bottom - CHART.top)

  for (const t of scale.ticks) {
    page.line(CHART.left, y(t), CHART.right, y(t), { width: 0.5, color: LINE })
    page.text(CHART.left - 6, y(t) + 3, formatValue(t), { size: 8, color: MUTED, align: 'right' })
  }
  page.line(CHART.left, CHART.top, CHART.left, CHART.bottom, { width: 0.75, color: MUTED })
  page.line(CHART.left, CHART.bottom, CHART.right, CHART.bottom, { width: 0.75, color: MUTED })

  const withYear = new Date(points[0].date).getFullYear() !== new Date(points[points.length - 1].date).getFullYear()
  for (const i of labelIndices(points.length, 7)) {
    page.text(x(i), CHART.bottom + 15, formatShortDate(points[i].date, withYear), { size: 8, color: MUTED, align: 'center' })
  }
  page.text((CHART.left + CHART.right) / 2, CHART.bottom + 30, 'Session date', { size: 8, color: MUTED, align: 'center' })

  const best = Math.max(...values)
  const bestIndex = values.lastIndexOf(best)
  const labelled = valueLabelIndices(points.length, bestIndex)

  if (twoLines) {
    page.polyline(weights.map((v, i) => [x(i), y(v)] as [number, number]), { width: 1.25, color: MUTED, dash: [4, 3] })
    weights.forEach((v, i) => {
      page.circle(x(i), y(v), 2.5, { fill: MUTED })
      if (points.length <= 12) page.text(x(i), y(v) + 12, formatValue(v), { size: 7, color: MUTED, align: 'center' })
    })
  }
  page.polyline(values.map((v, i) => [x(i), y(v)] as [number, number]), { width: 2, color: ACCENT })
  values.forEach((v, i) => {
    if (i === bestIndex) page.circle(x(i), y(v), 6.5, { stroke: ACCENT, width: 1 })
    page.circle(x(i), y(v), 3, { fill: ACCENT })
    if (labelled.has(i)) page.text(x(i), y(v) - (i === bestIndex ? 10 : 7), formatValue(v), { size: 8, bold: true, color: INK, align: 'center' })
  })

  if (twoLines) {
    const lx = CHART.right - 150
    page.line(lx, 324, lx + 16, 324, { width: 2, color: ACCENT })
    page.text(lx + 20, 327, 'Est. 1RM', { size: 8, color: INK })
    page.line(lx + 70, 324, lx + 86, 324, { width: 1.25, color: MUTED, dash: [4, 3] })
    page.text(lx + 90, 327, 'Weight', { size: 8, color: INK })
  }
}

const TABLE_TOP = 596

function drawTable(page: PdfPage, p: ExercisePage): void {
  const n = p.recent.length
  page.text(M, TABLE_TOP, n < p.sessionCount ? `Last ${n} sessions` : `Sessions (${n})`, { size: 10, bold: true, color: INK })
  const head = TABLE_TOP + 18
  // Weight and estimated 1RM columns only where the exercise has them.
  const showWeight = p.firstWeight != null
  const showRm = p.unit === '1RM'
  const weightX = 270
  const rmX = showWeight ? 340 : 270
  const remarksX = (showRm ? rmX : showWeight ? weightX : 200) + 20
  const header: TextStyle = { size: 8, bold: true, color: MUTED }
  page.text(M, head, 'Date', header)
  page.text(120, head, p.exercise.type === 'timed' ? 'Sets x seconds' : 'Sets x reps', header)
  if (showWeight) page.text(weightX, head, 'Weight', { ...header, align: 'right' })
  if (showRm) page.text(rmX, head, 'Est. 1RM', { ...header, align: 'right' })
  page.text(remarksX, head, 'Remarks', header)
  page.line(M, head + 5, W - M, head + 5, { width: 0.75, color: LINE })
  p.recent.forEach((e, i) => {
    const base = head + 20 + i * 18
    const reps = p.exercise.type === 'timed' ? `${e.repsOrSeconds} s` : String(e.repsOrSeconds)
    page.text(M, base, formatShortDate(e.date, true), { size: 9, color: INK })
    page.text(120, base, `${e.sets} x ${reps}`, { size: 9, color: INK })
    if (showWeight) page.text(weightX, base, e.weight != null ? formatValue(e.weight) : '-', { size: 9, color: INK, align: 'right' })
    if (showRm) page.text(rmX, base, e.est1RM != null ? formatValue(e.est1RM) : '-', { size: 9, color: INK, align: 'right' })
    if (e.remarks) page.text(remarksX, base, fitText(e.remarks, W - M - remarksX, 9), { size: 9, color: MUTED })
    page.line(M, base + 6, W - M, base + 6, { width: 0.25, color: LINE })
  })
}

function drawExercisePage(doc: PdfDoc, report: ProgressReport, p: ExercisePage, number: number, total: number): void {
  const page = doc.addPage()
  pageHeader(page, report, number, total)
  const ex = p.exercise
  page.text(M, 72, fitText(ex.name, CW, 22, true), { size: 22, bold: true, color: INK })
  const meta = [ex.machine, TYPE_LABELS[ex.type], LOAD_LABELS[ex.loadType]].filter(Boolean).join('  |  ')
  page.text(M, 90, fitText(meta, CW, 10), { size: 10, color: MUTED })
  let y = 90
  if (p.routines.length) {
    y += 14
    page.text(M, y, fitText(`Routines: ${p.routines.join(', ')}`, CW, 9), { size: 9, color: MUTED })
  }
  if (ex.remarks.trim()) {
    for (const line of wrapText(`Notes: ${ex.remarks.trim()}`, CW, 9, 2)) {
      y += 12
      page.text(M, y, line, { size: 9, color: MUTED })
    }
  }

  const verdictY = 160
  marker(page, p.trend?.kind, M + 6, verdictY - 4, 5.5)
  if (p.trend) {
    page.text(M + 18, verdictY, trendText(p.trend.kind, p.trend.sessionsSinceBest).text, { size: 13, bold: true, color: TREND_COLORS[p.trend.kind] })
  } else {
    page.text(M + 18, verdictY, 'Not enough data for a trend yet', { size: 13, bold: true, color: MUTED })
  }

  const tiles = summaryTiles(p)
  const gap = 10
  const w = (CW - 2 * gap) / 3
  tiles.forEach((t, i) => tile(page, M + (i % 3) * (w + gap), 178 + Math.floor(i / 3) * 62, w, 52, t))

  drawChart(page, p)
  drawTable(page, p)
}

// ---------- Document ----------

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

/**
 * The PDF for a report. Calls `onProgress(done, total)` after each page and
 * yields to the event loop in between, so the screen can show it.
 */
export async function renderProgressPdf(
  report: ProgressReport,
  onProgress?: (done: number, total: number) => void,
): Promise<Uint8Array> {
  const cover = coverPageCount(report.pages.length)
  const total = cover + report.pages.length
  const doc = new PdfDoc({
    title: `Gym progress report ${report.start} to ${report.end}`,
    created: new Date(report.generatedAt),
  })
  drawCover(doc, report, total)
  onProgress?.(cover, total)
  await tick()
  for (let i = 0; i < report.pages.length; i++) {
    drawExercisePage(doc, report, report.pages[i], cover + i + 1, total)
    onProgress?.(cover + i + 1, total)
    await tick()
  }
  return doc.build()
}

export const PDF_MIME = 'application/pdf'

export async function progressReportFile(
  report: ProgressReport,
  onProgress?: (done: number, total: number) => void,
): Promise<File> {
  const bytes = await renderProgressPdf(report, onProgress)
  return new File([bytes as BlobPart], progressReportFileName(report.start, report.end), { type: PDF_MIME })
}
