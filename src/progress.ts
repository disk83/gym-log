import { db, type Exercise, type Log, type Session } from './db'
import { estimated1RM } from './strength'

// Per-exercise progress for the small chart on the log screen: one value per
// session, a trend verdict (up, down, flat, stalled) and the sparkline
// geometry. Nothing is stored; it is all derived from the logs.

/** How many of the latest sessions the sparkline shows. */
export const WINDOW = 8
/** A change smaller than this (relative to the recent average) counts as flat. */
export const FLAT_BAND = 0.02
/** This many sessions without a new best counts as stalled. */
export const STALLED_AFTER = 4
/** How many previous sessions the latest one is compared with. */
const BASELINE = 3

export type ProgressUnit = '1RM' | 'reps' | 's'

/**
 * The number plotted for an exercise: the estimated 1RM for weighted strength
 * exercises (so more weight or more reps both count), the reps of bodyweight
 * exercises, the seconds of timed ones. Undefined when a log has no value
 * (a weighted exercise logged without weight).
 */
export function progressValue(log: Pick<Log, 'repsOrSeconds' | 'weight'>, exercise: Exercise): number | undefined {
  if (exercise.type === 'strength' && exercise.loadType !== 'bodyweight') return estimated1RM(log, exercise)
  return log.repsOrSeconds >= 1 ? log.repsOrSeconds : undefined
}

export function progressUnit(exercise: Exercise): ProgressUnit {
  if (exercise.type === 'timed') return 's'
  return exercise.loadType === 'bodyweight' ? 'reps' : '1RM'
}

export type TrendKind = 'up' | 'down' | 'flat' | 'stalled'

export interface Trend {
  kind: TrendKind
  /** Sessions since the best value (0 when the latest session is the best). */
  sessionsSinceBest: number
}

/**
 * Verdict for a series of per-session values, oldest first. Needs at least 2.
 *
 * - stalled: the best value is STALLED_AFTER or more sessions old.
 * - otherwise the latest value against the average of the (up to 3) sessions
 *   before it: more than 2% above is up, more than 2% below is down, else flat.
 */
export function trendOf(values: readonly number[]): Trend | undefined {
  if (values.length < 2) return undefined
  const best = Math.max(...values)
  const sessionsSinceBest = values.length - 1 - values.lastIndexOf(best)
  if (sessionsSinceBest >= STALLED_AFTER) return { kind: 'stalled', sessionsSinceBest }

  const latest = values[values.length - 1]
  const previous = values.slice(-1 - BASELINE, -1)
  const baseline = previous.reduce((sum, v) => sum + v, 0) / previous.length
  const change = baseline > 0 ? (latest - baseline) / baseline : 0
  const kind: TrendKind = change > FLAT_BAND ? 'up' : change < -FLAT_BAND ? 'down' : 'flat'
  return { kind, sessionsSinceBest }
}

export interface ProgressPoint {
  /** Start of the session (ISO). */
  date: string
  value: number
  sets: number
  repsOrSeconds: number
  weight?: number
}

export interface Progress {
  unit: ProgressUnit
  /** One point per session, oldest first; all of the history, not just the window. */
  points: ProgressPoint[]
  /** The value of each point, oldest first. */
  values: number[]
  trend: Trend
}

/**
 * Progress from an exercise's logs, given the session of each log. Only
 * sessions that started on or before `upTo` count (the session being looked
 * at, so editing an old session does not see the future). Returns undefined
 * with fewer than 2 values: there is nothing to compare yet.
 */
export function buildProgress(
  logs: readonly Log[],
  sessions: ReadonlyMap<string, Session>,
  exercise: Exercise,
  upTo?: string,
): Progress | undefined {
  const found: { point: ProgressPoint; loggedAt: string }[] = []
  for (const log of logs) {
    const session = sessions.get(log.sessionId)
    if (!session || (upTo != null && session.startedAt > upTo)) continue
    const value = progressValue(log, exercise)
    if (value == null) continue
    const point: ProgressPoint = { date: session.startedAt, value, sets: log.sets, repsOrSeconds: log.repsOrSeconds }
    if (log.weight != null) point.weight = log.weight
    found.push({ point, loggedAt: log.loggedAt })
  }
  found.sort((a, b) => a.point.date.localeCompare(b.point.date) || a.loggedAt.localeCompare(b.loggedAt))
  const points = found.map((f) => f.point)
  const values = points.map((p) => p.value)
  const trend = trendOf(values)
  return trend && { unit: progressUnit(exercise), points, values, trend }
}

/** Progress up to `session` (the whole history when omitted). */
export async function loadProgress(exercise: Exercise, session?: Pick<Session, 'startedAt'>): Promise<Progress | undefined> {
  const logs = await db.logs.where('exerciseId').equals(exercise.id).toArray()
  const ids = [...new Set(logs.map((l) => l.sessionId))]
  const sessions = (await db.sessions.bulkGet(ids)).filter((s): s is Session => s != null)
  return buildProgress(logs, new Map(sessions.map((s) => [s.id, s])), exercise, session?.startedAt)
}

// ---------- Sparkline geometry ----------

export interface SparkPoint {
  x: number
  y: number
}

/**
 * Pixel positions for the latest WINDOW values inside a width × height box,
 * with `pad` kept free on every side so dots are not clipped. The vertical
 * range is the window's own min to max; a flat series sits in the middle.
 */
export function sparkPoints(values: readonly number[], width: number, height: number, pad = 4): SparkPoint[] {
  const shown = values.slice(-WINDOW)
  const min = Math.min(...shown)
  const max = Math.max(...shown)
  const innerW = width - 2 * pad
  const innerH = height - 2 * pad
  return shown.map((v, i) => ({
    x: pad + (shown.length === 1 ? innerW / 2 : (i / (shown.length - 1)) * innerW),
    y: pad + (max === min ? innerH / 2 : (1 - (v - min) / (max - min)) * innerH),
  }))
}

// ---------- Full chart axes ----------

export interface Scale {
  min: number
  max: number
  ticks: number[]
}

/**
 * A y axis with round tick values that covers [min, max], about `target`
 * ticks. With `integer` the step is a whole number (reps, seconds). A single
 * value (min equals max) gets some room above and below.
 */
export function niceScale(min: number, max: number, target = 5, integer = false): Scale {
  if (min === max) {
    const pad = integer ? 1 : Math.max(Math.abs(min) * 0.05, 1)
    min -= pad
    max += pad
  }
  const raw = Math.max((max - min) / (target - 1), integer ? 1 : 0)
  const magnitude = 10 ** Math.floor(Math.log10(raw))
  const normalized = raw / magnitude
  const options = integer ? [1, 2, 5, 10] : [1, 2, 2.5, 5, 10]
  const step = (options.find((o) => normalized <= o) ?? 10) * magnitude
  const lo = Math.floor(min / step + 1e-9) * step
  const hi = Math.ceil(max / step - 1e-9) * step
  const count = Math.round((hi - lo) / step)
  const ticks = Array.from({ length: count + 1 }, (_, i) => Number((lo + i * step).toFixed(10)))
  return { min: ticks[0], max: ticks[ticks.length - 1], ticks }
}

/** Which of `count` x positions get a date label: at most `max`, evenly spread, first and last included. */
export function labelIndices(count: number, max = 5): number[] {
  if (count <= max) return Array.from({ length: count }, (_, i) => i)
  const picked = new Set<number>()
  for (let i = 0; i < max; i++) picked.add(Math.round((i * (count - 1)) / (max - 1)))
  return [...picked]
}
