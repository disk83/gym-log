import { db, type Cycle, type Exercise, type Log, type Routine, type Session } from './db'
import { toDateInput } from './history'
import { byName } from './manage/format'
import { progressUnit, progressValue, trendOf, type ProgressUnit, type Trend, type TrendKind } from './progress'
import { rangeBounds, sessionsInRange } from './report'
import { estimated1RM } from './strength'

// Progress report (spec section 5b): the data behind the PDF, one page per
// exercise with logs in a date range, plus a cover. Pure functions over the
// same tables as the trainer report; nothing is stored.

/** How many of the latest sessions the table of each exercise page lists. */
export const RECENT_ROWS = 8

/** One log of the exercise in the range, with the session it belongs to. */
export interface SessionEntry {
  /** Start of the session (ISO). */
  date: string
  sets: number
  repsOrSeconds: number
  weight?: number
  /** Estimated one-rep max, for strength logs with a weight. */
  est1RM?: number
  /** The number the progress chart plots; see `progressValue`. */
  value?: number
  remarks: string
}

export interface ExercisePage {
  exercise: Exercise
  /** Routines (not archived) the exercise belongs to, those of the active cycle first. */
  routines: string[]
  unit: ProgressUnit
  /** Every log in the range, oldest first. */
  entries: SessionEntry[]
  /** The latest RECENT_ROWS entries, newest first. */
  recent: SessionEntry[]
  sessionCount: number
  firstDate: string
  lastDate: string
  firstWeight?: number
  lastWeight?: number
  bestWeight?: number
  /** Best, first and latest plotted value. */
  bestValue?: number
  firstValue?: number
  lastValue?: number
  /** Undefined with fewer than 2 plotted values. */
  trend?: Trend
}

export type TrendCounts = Record<TrendKind | 'none', number>

export interface ProgressReport {
  start: string
  end: string
  /** When the report was made (ISO). */
  generatedAt: string
  /** Sessions in the range that have at least one log. */
  sessionCount: number
  /** Exercises with logs in the range, in report order. */
  pages: ExercisePage[]
  trends: TrendCounts
}

export interface ProgressReportData {
  sessions: readonly Session[]
  logs: readonly Log[]
  exercises: readonly Exercise[]
  routines: readonly Routine[]
  cycles: readonly Cycle[]
}

const round1 = (v: number) => Math.round(v * 10) / 10

/**
 * Exercise ids in report order: the active cycle's routines in order, each
 * with its exercises in order (first appearance wins), then every other
 * exercise by name.
 */
export function orderExercises(
  exercises: readonly Exercise[],
  routines: readonly Routine[],
  cycles: readonly Cycle[],
): string[] {
  const known = new Map(exercises.map((e) => [e.id, e]))
  const routineById = new Map(routines.map((r) => [r.id, r]))
  const ordered: string[] = []
  const seen = new Set<string>()
  const active = cycles.find((c) => c.active)
  for (const routineId of active?.routineIds ?? []) {
    for (const id of routineById.get(routineId)?.exerciseIds ?? []) {
      if (known.has(id) && !seen.has(id)) {
        seen.add(id)
        ordered.push(id)
      }
    }
  }
  const rest = exercises.filter((e) => !seen.has(e.id)).sort(byName)
  return [...ordered, ...rest.map((e) => e.id)]
}

function routineNames(exerciseId: string, routines: readonly Routine[], cycles: readonly Cycle[]): string[] {
  const cycleOrder = new Map((cycles.find((c) => c.active)?.routineIds ?? []).map((id, i) => [id, i]))
  return routines
    .filter((r) => !r.archived && r.exerciseIds.includes(exerciseId))
    .sort((a, b) => (cycleOrder.get(a.id) ?? Infinity) - (cycleOrder.get(b.id) ?? Infinity) || byName(a, b))
    .map((r) => r.name)
}

/**
 * The progress report for the inclusive local date range. Sessions without
 * logs are ignored, as in the trainer report; archived exercises with logs in
 * the range are included.
 */
export function buildProgressReport(
  data: ProgressReportData,
  start: string,
  end: string,
  now: Date = new Date(),
): ProgressReport {
  const sessions = new Map(sessionsInRange(data.sessions, start, end).map((s) => [s.id, s]))
  const exercises = new Map(data.exercises.map((e) => [e.id, e]))
  const logsByExercise = new Map<string, { log: Log; session: Session }[]>()
  const sessionsWithLogs = new Set<string>()
  for (const log of data.logs) {
    const session = sessions.get(log.sessionId)
    if (!session || !exercises.has(log.exerciseId)) continue
    sessionsWithLogs.add(session.id)
    const list = logsByExercise.get(log.exerciseId)
    if (list) list.push({ log, session })
    else logsByExercise.set(log.exerciseId, [{ log, session }])
  }

  const pages: ExercisePage[] = []
  const trends: TrendCounts = { up: 0, down: 0, flat: 0, stalled: 0, none: 0 }
  for (const id of orderExercises(data.exercises, data.routines, data.cycles)) {
    const found = logsByExercise.get(id)
    if (!found) continue
    const exercise = exercises.get(id)!
    found.sort(
      (a, b) => a.session.startedAt.localeCompare(b.session.startedAt) || a.log.loggedAt.localeCompare(b.log.loggedAt),
    )
    const entries: SessionEntry[] = found.map(({ log, session }) => {
      const entry: SessionEntry = {
        date: session.startedAt,
        sets: log.sets,
        repsOrSeconds: log.repsOrSeconds,
        remarks: log.remarks,
      }
      if (log.weight != null) entry.weight = log.weight
      const est = estimated1RM(log, exercise)
      if (est != null) entry.est1RM = est
      const value = progressValue(log, exercise)
      if (value != null) entry.value = value
      return entry
    })

    const values = entries.flatMap((e) => (e.value != null ? [e.value] : []))
    const weights = entries.flatMap((e) => (e.weight != null ? [e.weight] : []))
    const trend = trendOf(values)
    trends[trend?.kind ?? 'none']++
    const page: ExercisePage = {
      exercise,
      routines: routineNames(id, data.routines, data.cycles),
      unit: progressUnit(exercise),
      entries,
      recent: entries.slice(-RECENT_ROWS).reverse(),
      sessionCount: new Set(found.map((f) => f.session.id)).size,
      firstDate: entries[0].date,
      lastDate: entries[entries.length - 1].date,
    }
    if (weights.length) {
      page.firstWeight = weights[0]
      page.lastWeight = weights[weights.length - 1]
      page.bestWeight = Math.max(...weights)
    }
    if (values.length) {
      page.firstValue = values[0]
      page.lastValue = values[values.length - 1]
      page.bestValue = Math.max(...values)
    }
    if (trend) page.trend = trend
    pages.push(page)
  }

  return { start, end, generatedAt: now.toISOString(), sessionCount: sessionsWithLogs.size, pages, trends }
}

/** Change from the first to the latest plotted value: absolute and as a percentage (undefined from 0). */
export function valueChange(page: Pick<ExercisePage, 'firstValue' | 'lastValue'>): { change: number; percent?: number } | undefined {
  const { firstValue: first, lastValue: last } = page
  if (first == null || last == null) return undefined
  return { change: round1(last - first), percent: first > 0 ? Math.round(((last - first) / first) * 100) : undefined }
}

/** Weight change from the first to the latest log with a weight. */
export function weightChange(page: Pick<ExercisePage, 'firstWeight' | 'lastWeight'>): number | undefined {
  return page.firstWeight != null && page.lastWeight != null ? round1(page.lastWeight - page.firstWeight) : undefined
}

/**
 * Which chart points get their value written next to them: all of them when
 * there are few, otherwise the first, best and latest, skipping one that
 * would sit right beside a more important one.
 */
export function valueLabelIndices(count: number, bestIndex: number, all = 12): Set<number> {
  if (count <= all) return new Set(Array.from({ length: count }, (_, i) => i))
  const picked: number[] = []
  for (const i of [bestIndex, count - 1, 0]) {
    if (picked.every((j) => Math.abs(i - j) > 1)) picked.push(i)
  }
  return new Set(picked)
}

// ---------- Ranges, loading and file ----------

export type RangePreset = '3m' | '6m' | 'all'

/**
 * The date range of a shortcut: the last 3 or 6 months up to today, or from
 * the earliest session (when known) up to today.
 */
export function presetRange(preset: RangePreset, now: Date, earliest?: string): { start: string; end: string } {
  const end = toDateInput(now.toISOString())
  if (preset === 'all') return { start: earliest ? toDateInput(earliest) : end, end }
  const start = new Date(now.getFullYear(), now.getMonth() - (preset === '3m' ? 3 : 6), now.getDate(), 12)
  return { start: toDateInput(start.toISOString()), end }
}

export async function earliestSession(): Promise<string | undefined> {
  return (await db.sessions.orderBy('startedAt').first())?.startedAt
}

export async function loadProgressReport(start: string, end: string, now = new Date()): Promise<ProgressReport> {
  const [from, to] = rangeBounds(start, end)
  // Pad by a day each side: the index holds UTC strings, the exact filter is local.
  const sessions = await db.sessions
    .where('startedAt')
    .between(new Date(from - 86_400_000).toISOString(), new Date(to + 86_400_000).toISOString())
    .toArray()
  const ids = sessions.map((s) => s.id)
  const [logs, exercises, routines, cycles] = await Promise.all([
    db.logs.where('sessionId').anyOf(ids).toArray(),
    db.exercises.toArray(),
    db.routines.toArray(),
    db.cycles.toArray(),
  ])
  return buildProgressReport({ sessions, logs, exercises, routines, cycles }, start, end, now)
}

export function progressReportFileName(start: string, end: string): string {
  return `gym-progress-${start}_to_${end}.pdf`
}

/** e.g. "12 exercises in 18 sessions". */
export function progressPreviewText(report: Pick<ProgressReport, 'pages' | 'sessionCount'>): string {
  const n = report.pages.length
  const m = report.sessionCount
  return `${n} exercise${n === 1 ? '' : 's'} in ${m} session${m === 1 ? '' : 's'}`
}
