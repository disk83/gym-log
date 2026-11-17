import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db, type Cycle, type Exercise, type Log, type Routine, type Session } from './db'
import {
  buildProgressReport,
  earliestSession,
  loadProgressReport,
  orderExercises,
  presetRange,
  progressPreviewText,
  progressReportFileName,
  RECENT_ROWS,
  valueChange,
  valueLabelIndices,
  weightChange,
  type ProgressReportData,
} from './progressReport'

const exercise = (id: string, overrides: Partial<Exercise> = {}): Exercise => ({
  id,
  name: id,
  remarks: '',
  type: 'strength',
  loadType: 'total',
  defaultSets: 3,
  defaultReps: 10,
  archived: false,
  ...overrides,
})
const routine = (id: string, exerciseIds: string[], overrides: Partial<Routine> = {}): Routine => ({
  id,
  name: id,
  remarks: '',
  exerciseIds,
  archived: false,
  ...overrides,
})
const cycle = (routineIds: string[], active = true): Cycle => ({
  id: `cycle-${routineIds.join('')}`,
  name: 'Cycle',
  remarks: '',
  routineIds,
  active,
  archived: false,
})
// Noon UTC keeps the local date the same in every time zone.
const session = (id: string, day: string): Session => ({
  id,
  startedAt: `${day}T12:00:00.000Z`,
  finishedAt: `${day}T13:00:00.000Z`,
  routineId: null,
  cycleId: null,
})
let logCounter = 0
const log = (sessionId: string, exerciseId: string, reps: number, weight?: number, extra: Partial<Log> = {}): Log => ({
  id: `log-${++logCounter}`,
  sessionId,
  exerciseId,
  sets: 3,
  repsOrSeconds: reps,
  ...(weight != null ? { weight } : {}),
  remarks: '',
  loggedAt: `2026-01-01T00:00:${String(logCounter % 60).padStart(2, '0')}.000Z`,
  ...extra,
})

const NOW = new Date('2026-11-17T08:30:00.000Z')

function data(overrides: Partial<ProgressReportData> = {}): ProgressReportData {
  return { sessions: [], logs: [], exercises: [], routines: [], cycles: [], ...overrides }
}

describe('orderExercises', () => {
  it('follows the active cycle, then the rest by name', () => {
    const exercises = [exercise('zeta'), exercise('alpha'), exercise('row'), exercise('squat'), exercise('bench')]
    const routines = [routine('push', ['bench', 'squat']), routine('pull', ['row', 'squat'])]
    const cycles = [cycle(['pull', 'push']), cycle(['push'], false)]
    expect(orderExercises(exercises, routines, cycles)).toEqual(['row', 'squat', 'bench', 'alpha', 'zeta'])
  })

  it('sorts everything by name without an active cycle', () => {
    expect(orderExercises([exercise('b'), exercise('a')], [routine('r', ['b', 'a'])], [cycle(['r'], false)])).toEqual(['a', 'b'])
  })
})

describe('buildProgressReport', () => {
  const exercises = [exercise('bench'), exercise('plank', { type: 'timed', loadType: 'bodyweight' }), exercise('pullup', { loadType: 'bodyweight' })]
  const sessions = [
    session('s1', '2026-10-01'),
    session('s2', '2026-10-08'),
    session('s3', '2026-10-15'),
    session('empty', '2026-10-20'),
    session('old', '2026-06-01'),
  ]
  const logs = [
    log('s1', 'bench', 10, 60),
    log('s2', 'bench', 10, 65),
    log('s3', 'bench', 8, 70, { remarks: 'felt heavy' }),
    log('old', 'bench', 10, 40),
    log('s1', 'plank', 45),
    log('s3', 'plank', 60),
    log('s2', 'pullup', 8),
  ]

  it('builds one page per exercise with logs in range, in cycle order', () => {
    const report = buildProgressReport(
      data({ sessions, logs, exercises, routines: [routine('r', ['plank', 'bench'])], cycles: [cycle(['r'])] }),
      '2026-10-01',
      '2026-10-31',
      NOW,
    )
    expect(report.pages.map((p) => p.exercise.id)).toEqual(['plank', 'bench', 'pullup'])
    expect(report.sessionCount).toBe(3) // the empty session does not count
    expect(report.generatedAt).toBe(NOW.toISOString())
    expect(report.start).toBe('2026-10-01')
  })

  it('computes the summary of a weighted exercise from the range only', () => {
    const report = buildProgressReport(data({ sessions, logs, exercises }), '2026-10-01', '2026-10-31', NOW)
    const bench = report.pages.find((p) => p.exercise.id === 'bench')!
    expect(bench.unit).toBe('1RM')
    expect(bench.sessionCount).toBe(3)
    expect(bench.firstDate).toBe('2026-10-01T12:00:00.000Z')
    expect(bench.lastDate).toBe('2026-10-15T12:00:00.000Z')
    expect(bench.firstWeight).toBe(60)
    expect(bench.lastWeight).toBe(70)
    expect(bench.bestWeight).toBe(70)
    expect(weightChange(bench)).toBe(10)
    // 60 x 10 -> 80, 65 x 10 -> 86.7, 70 x 8 -> 88.7
    expect(bench.entries.map((e) => e.est1RM)).toEqual([80, 86.7, 88.7])
    expect(bench.firstValue).toBe(80)
    expect(bench.lastValue).toBe(88.7)
    expect(bench.bestValue).toBe(88.7)
    expect(valueChange(bench)).toEqual({ change: 8.7, percent: 11 })
    expect(bench.trend?.kind).toBe('up')
    expect(bench.recent[0]).toMatchObject({ remarks: 'felt heavy', weight: 70 })
  })

  it('uses seconds and reps for timed and bodyweight exercises, without weights', () => {
    const report = buildProgressReport(data({ sessions, logs, exercises }), '2026-10-01', '2026-10-31', NOW)
    const plank = report.pages.find((p) => p.exercise.id === 'plank')!
    expect(plank.unit).toBe('s')
    expect(plank.bestValue).toBe(60)
    expect(plank.bestWeight).toBeUndefined()
    expect(weightChange(plank)).toBeUndefined()
    const pullup = report.pages.find((p) => p.exercise.id === 'pullup')!
    expect(pullup.unit).toBe('reps')
    expect(pullup.sessionCount).toBe(1)
    expect(pullup.trend).toBeUndefined() // a single session has no trend
  })

  it('counts the trend of every exercise', () => {
    const report = buildProgressReport(data({ sessions, logs, exercises }), '2026-10-01', '2026-10-31', NOW)
    // bench up, plank up (45 -> 60), pullup none
    expect(report.trends).toEqual({ up: 2, down: 0, flat: 0, stalled: 0, none: 1 })
  })

  it('lists the latest sessions newest first, at most RECENT_ROWS', () => {
    const many = Array.from({ length: 12 }, (_, i) => session(`m${i}`, `2026-09-${String(i + 1).padStart(2, '0')}`))
    const report = buildProgressReport(
      data({ sessions: many, logs: many.map((s, i) => log(s.id, 'bench', 10, 50 + i)), exercises: [exercise('bench')] }),
      '2026-09-01',
      '2026-09-30',
      NOW,
    )
    const page = report.pages[0]
    expect(page.entries).toHaveLength(12)
    expect(page.recent).toHaveLength(RECENT_ROWS)
    expect(page.recent.map((e) => e.weight)).toEqual([61, 60, 59, 58, 57, 56, 55, 54])
  })

  it('keeps a weighted exercise logged without weight, with nothing to plot', () => {
    const report = buildProgressReport(
      data({ sessions, logs: [log('s1', 'bench', 10)], exercises: [exercise('bench')] }),
      '2026-10-01',
      '2026-10-31',
      NOW,
    )
    const page = report.pages[0]
    expect(page.entries).toHaveLength(1)
    expect(page.bestValue).toBeUndefined()
    expect(page.bestWeight).toBeUndefined()
    expect(report.trends.none).toBe(1)
  })

  it('lists the routines of an exercise, those of the active cycle first, archived ones left out', () => {
    const report = buildProgressReport(
      data({
        sessions,
        logs: [log('s1', 'bench', 10, 60)],
        exercises: [exercise('bench')],
        routines: [routine('a-extra', ['bench']), routine('pull', ['bench']), routine('push', ['bench']), routine('old', ['bench'], { archived: true })],
        cycles: [cycle(['push', 'pull'])],
      }),
      '2026-10-01',
      '2026-10-31',
      NOW,
    )
    expect(report.pages[0].routines).toEqual(['push', 'pull', 'a-extra'])
  })

  it('includes archived exercises and skips logs of unknown ones', () => {
    const report = buildProgressReport(
      data({
        sessions,
        logs: [log('s1', 'bench', 10, 60), log('s1', 'ghost', 10, 60)],
        exercises: [exercise('bench', { archived: true })],
      }),
      '2026-10-01',
      '2026-10-31',
      NOW,
    )
    expect(report.pages.map((p) => p.exercise.id)).toEqual(['bench'])
  })

  it('is empty when nothing was logged in the range', () => {
    const report = buildProgressReport(data({ sessions, logs, exercises }), '2026-01-01', '2026-01-31', NOW)
    expect(report.pages).toEqual([])
    expect(report.sessionCount).toBe(0)
    expect(progressPreviewText(report)).toBe('0 exercises in 0 sessions')
  })

  it('rejects an invalid range', () => {
    expect(() => buildProgressReport(data(), '2026-10-31', '2026-10-01')).toThrow('on or before')
  })
})

describe('small helpers', () => {
  it('has no change without values and no percentage from zero', () => {
    expect(valueChange({})).toBeUndefined()
    expect(valueChange({ firstValue: 0, lastValue: 5 })).toEqual({ change: 5, percent: undefined })
    expect(valueChange({ firstValue: 100, lastValue: 90 })).toEqual({ change: -10, percent: -10 })
  })

  it('labels every point when there are few, otherwise the best, latest and first', () => {
    expect([...valueLabelIndices(5, 2)]).toEqual([0, 1, 2, 3, 4])
    expect([...valueLabelIndices(30, 10)].sort((a, b) => a - b)).toEqual([0, 10, 29])
    // A best that is also the latest, or right beside it, is not labelled twice.
    expect([...valueLabelIndices(30, 29)].sort((a, b) => a - b)).toEqual([0, 29])
    expect([...valueLabelIndices(30, 28)].sort((a, b) => a - b)).toEqual([0, 28])
  })

  it('names the file and the range shortcuts', () => {
    expect(progressReportFileName('2026-09-17', '2026-10-16')).toBe('gym-progress-2026-09-17_to_2026-10-16.pdf')
    const now = new Date(2026, 10, 17, 9)
    expect(presetRange('3m', now)).toEqual({ start: '2026-08-17', end: '2026-11-17' })
    expect(presetRange('6m', now)).toEqual({ start: '2026-05-17', end: '2026-11-17' })
    expect(presetRange('all', now, new Date(2026, 2, 5, 12).toISOString())).toEqual({ start: '2026-03-05', end: '2026-11-17' })
    expect(presetRange('all', now)).toEqual({ start: '2026-11-17', end: '2026-11-17' })
  })
})

describe('loading from the database', () => {
  beforeEach(async () => {
    await Promise.all([db.exercises.clear(), db.routines.clear(), db.cycles.clear(), db.sessions.clear(), db.logs.clear()])
  })

  it('builds the report from the stored tables', async () => {
    expect(await earliestSession()).toBeUndefined()
    await db.exercises.bulkAdd([exercise('bench')])
    await db.routines.bulkAdd([routine('push', ['bench'])])
    await db.cycles.bulkAdd([cycle(['push'])])
    await db.sessions.bulkAdd([session('s1', '2026-10-01'), session('s2', '2026-10-08'), session('far', '2025-01-01')])
    await db.logs.bulkAdd([log('s1', 'bench', 10, 60), log('s2', 'bench', 10, 65), log('far', 'bench', 10, 30)])
    expect(await earliestSession()).toBe('2025-01-01T12:00:00.000Z')
    const report = await loadProgressReport('2026-10-01', '2026-10-31', NOW)
    expect(report.pages).toHaveLength(1)
    expect(report.pages[0].entries.map((e) => e.weight)).toEqual([60, 65])
    expect(report.pages[0].routines).toEqual(['push'])
    expect(report.sessionCount).toBe(2)
  })
})
