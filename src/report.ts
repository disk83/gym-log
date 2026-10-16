import { db, type Exercise, type Log, type Routine, type Session } from './db'
import { logsInOrder, toDateInput } from './history'
import { LOAD_LABELS } from './manage/format'
import { buildXlsx, excelDate, XLSX_MIME, type Cell, type Column } from './xlsx'

// Trainer report (spec section 5): every log of the sessions started in a
// date range, one row per log, as a single .xlsx sheet.

// ---------- Date range ----------

function parseDay(value: string): [number, number, number] | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!m) return undefined
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const check = new Date(y, mo - 1, d)
  return check.getMonth() === mo - 1 && check.getDate() === d ? [y, mo, d] : undefined
}

/**
 * Local-time bounds of an inclusive date range, as [start, end) in ms:
 * from local midnight of `start` to local midnight of the day after `end`.
 * Throws on an invalid date or a start after the end.
 */
export function rangeBounds(start: string, end: string): [number, number] {
  const s = parseDay(start)
  const e = parseDay(end)
  if (!s || !e) throw new Error('Choose a valid start and end date.')
  const from = new Date(s[0], s[1] - 1, s[2]).getTime()
  const to = new Date(e[0], e[1] - 1, e[2] + 1).getTime()
  if (from >= to) throw new Error('The start date must be on or before the end date.')
  return [from, to]
}

/** Default range: the last 30 days, today included. */
export function defaultRange(now = new Date()): { start: string; end: string } {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29, 12)
  return { start: toDateInput(start.toISOString()), end: toDateInput(now.toISOString()) }
}

/** Sessions started in the inclusive local date range, oldest first (ties by id). */
export function sessionsInRange(sessions: readonly Session[], start: string, end: string): Session[] {
  const [from, to] = rangeBounds(start, end)
  return sessions
    .filter((s) => {
      const t = new Date(s.startedAt).getTime()
      return t >= from && t < to
    })
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt) || a.id.localeCompare(b.id))
}

// ---------- Rows ----------

export interface ReportRow {
  /** Local date the session started, as "YYYY-MM-DD". */
  date: string
  /** 1-based number of the session within the report. */
  session: number
  routine: string
  exercise: string
  machine: string
  sets: number
  repsOrSeconds: number
  weight?: number
  loadType: string
  remarks: string
}

export interface ReportData {
  sessions: readonly Session[]
  logs: readonly Log[]
  exercises: readonly Exercise[]
  routines: readonly Routine[]
}

export interface Report {
  rows: ReportRow[]
  /** Sessions in range that have at least one log. */
  sessionCount: number
}

/**
 * One row per log of every session started in the range, sorted by session
 * start and then by the order the logs were made. Archived exercises and
 * routines are included like any other.
 */
export function buildReport(data: ReportData, start: string, end: string): Report {
  const exercises = new Map(data.exercises.map((e) => [e.id, e]))
  const routines = new Map(data.routines.map((r) => [r.id, r]))
  const logsBySession = new Map<string, Log[]>()
  for (const log of data.logs) {
    const list = logsBySession.get(log.sessionId)
    if (list) list.push(log)
    else logsBySession.set(log.sessionId, [log])
  }

  const rows: ReportRow[] = []
  let sessionCount = 0
  for (const session of sessionsInRange(data.sessions, start, end)) {
    const logs = logsBySession.get(session.id)
    if (!logs?.length) continue
    sessionCount++
    const routine =
      session.routineId == null ? 'Free session' : (routines.get(session.routineId)?.name ?? 'Deleted routine')
    for (const log of logsInOrder(logs)) {
      const exercise = exercises.get(log.exerciseId)
      const row: ReportRow = {
        date: toDateInput(session.startedAt),
        session: sessionCount,
        routine,
        exercise: exercise?.name ?? 'Deleted exercise',
        machine: exercise?.machine ?? '',
        sets: log.sets,
        repsOrSeconds: log.repsOrSeconds,
        loadType: exercise ? LOAD_LABELS[exercise.loadType] : '',
        remarks: log.remarks,
      }
      if (log.weight != null) row.weight = log.weight
      rows.push(row)
    }
  }
  return { rows, sessionCount }
}

/** e.g. "12 logs in 3 sessions". */
export function previewText(report: Report): string {
  const n = report.rows.length
  const m = report.sessionCount
  return `${n} log${n === 1 ? '' : 's'} in ${m} session${m === 1 ? '' : 's'}`
}

export async function loadReport(start: string, end: string): Promise<Report> {
  const [from, to] = rangeBounds(start, end)
  // Pad by a day each side: the index holds UTC strings, the exact filter is local.
  const sessions = await db.sessions
    .where('startedAt')
    .between(new Date(from - 86_400_000).toISOString(), new Date(to + 86_400_000).toISOString())
    .toArray()
  const ids = sessions.map((s) => s.id)
  const [logs, exercises, routines] = await Promise.all([
    db.logs.where('sessionId').anyOf(ids).toArray(),
    db.exercises.toArray(),
    db.routines.toArray(),
  ])
  return buildReport({ sessions, logs, exercises, routines }, start, end)
}

// ---------- File ----------

export const REPORT_COLUMNS: Column[] = [
  { header: 'Date', width: 12 },
  { header: 'Session', width: 9 },
  { header: 'Routine', width: 20 },
  { header: 'Exercise', width: 26 },
  { header: 'Machine', width: 16 },
  { header: 'Sets', width: 6 },
  { header: 'Reps or seconds', width: 16 },
  { header: 'Weight', width: 9 },
  { header: 'Load type', width: 14 },
  { header: 'Remarks', width: 40 },
]

export function reportCells(row: ReportRow): Cell[] {
  const [y, m, d] = row.date.split('-').map(Number)
  return [
    excelDate(y, m, d),
    row.session,
    row.routine,
    row.exercise,
    row.machine,
    row.sets,
    row.repsOrSeconds,
    row.weight,
    row.loadType,
    row.remarks,
  ]
}

export function reportFileName(start: string, end: string): string {
  return `gym-report-${start}_to_${end}.xlsx`
}

export function reportFile(report: Report, start: string, end: string): File {
  const bytes = buildXlsx('Report', REPORT_COLUMNS, report.rows.map(reportCells))
  return new File([bytes as BlobPart], reportFileName(start, end), { type: XLSX_MIME })
}
