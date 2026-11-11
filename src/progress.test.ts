import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { createExercise, type ExerciseInput } from './data'
import { db, type Exercise, type Log, type Session } from './db'
import {
  buildProgress,
  loadProgress,
  progressUnit,
  progressValue,
  sparkPoints,
  trendOf,
  WINDOW,
} from './progress'
import { finishSession, saveLog, startSession } from './session'

const exercise = (overrides: Partial<Exercise> = {}): Exercise => ({
  id: 'ex',
  name: 'Bench press',
  remarks: '',
  type: 'strength',
  loadType: 'total',
  defaultSets: 3,
  defaultReps: 10,
  archived: false,
  ...overrides,
})

describe('progressValue and unit', () => {
  it('uses the estimated 1RM for weighted strength exercises', () => {
    expect(progressValue({ repsOrSeconds: 10, weight: 60 }, exercise())).toBe(80)
    expect(progressUnit(exercise())).toBe('1RM')
    expect(progressUnit(exercise({ loadType: 'per_dumbbell' }))).toBe('1RM')
  })

  it('has no value for a weighted exercise logged without weight', () => {
    expect(progressValue({ repsOrSeconds: 10 }, exercise())).toBeUndefined()
  })

  it('uses reps for bodyweight exercises, even if some weight was added', () => {
    const pullUp = exercise({ loadType: 'bodyweight' })
    expect(progressValue({ repsOrSeconds: 8 }, pullUp)).toBe(8)
    expect(progressValue({ repsOrSeconds: 8, weight: 10 }, pullUp)).toBe(8)
    expect(progressUnit(pullUp)).toBe('reps')
  })

  it('uses seconds for timed exercises', () => {
    const plank = exercise({ type: 'timed', loadType: 'bodyweight' })
    expect(progressValue({ repsOrSeconds: 45 }, plank)).toBe(45)
    expect(progressUnit(plank)).toBe('s')
  })
})

describe('trendOf', () => {
  it('needs at least two sessions', () => {
    expect(trendOf([])).toBeUndefined()
    expect(trendOf([80])).toBeUndefined()
  })

  it('is up when the latest is clearly above the recent average', () => {
    expect(trendOf([80, 82, 85])).toEqual({ kind: 'up', sessionsSinceBest: 0 })
  })

  it('is down when the latest is clearly below the recent average', () => {
    expect(trendOf([85, 83, 82])).toEqual({ kind: 'down', sessionsSinceBest: 2 })
  })

  it('is flat inside the 2% band', () => {
    expect(trendOf([80, 80.5, 80.2])).toEqual({ kind: 'flat', sessionsSinceBest: 1 })
  })

  it('compares with the 3 sessions before the latest only', () => {
    // Old low values do not drag the baseline down: baseline is 88 → 89 is flat.
    expect(trendOf([50, 60, 88, 88, 88, 89])?.kind).toBe('flat')
  })

  it('is stalled after 4 sessions without a new best, whatever the latest change', () => {
    expect(trendOf([90, 85, 86, 85, 86])).toEqual({ kind: 'stalled', sessionsSinceBest: 4 })
    // 3 sessions since the best is not stalled yet.
    expect(trendOf([90, 85, 86, 85])?.kind).toBe('down')
  })

  it('counts a tie for the best from the most recent one', () => {
    expect(trendOf([80, 85, 85])).toEqual({ kind: 'up', sessionsSinceBest: 0 })
  })
})

const session = (id: string, startedAt: string): Session => ({ id, startedAt, finishedAt: null, routineId: null, cycleId: null })
const log = (id: string, sessionId: string, weight: number | undefined, reps: number, loggedAt: string): Log => ({
  id,
  sessionId,
  exerciseId: 'ex',
  sets: 3,
  repsOrSeconds: reps,
  weight,
  remarks: '',
  loggedAt,
})

describe('buildProgress', () => {
  const sessions = new Map(
    [
      session('s1', '2026-02-01T09:00:00Z'),
      session('s2', '2026-02-08T09:00:00Z'),
      session('s3', '2026-02-15T09:00:00Z'),
    ].map((s) => [s.id, s]),
  )
  // Given out of order on purpose.
  const logs = [
    log('l3', 's3', 65, 8, '2026-02-15T09:10:00Z'),
    log('l1', 's1', 60, 10, '2026-02-01T09:10:00Z'),
    log('l2', 's2', 60, 12, '2026-02-08T09:10:00Z'),
  ]

  it('orders by session date and reports the trend', () => {
    const progress = buildProgress(logs, sessions, exercise())
    expect(progress?.values).toEqual([80, 84, 82.3])
    expect(progress?.unit).toBe('1RM')
    expect(progress?.trend.kind).toBe('flat')
  })

  it('ignores sessions after upTo, so an old session does not see the future', () => {
    expect(buildProgress(logs, sessions, exercise(), '2026-02-08T09:00:00Z')?.values).toEqual([80, 84])
    expect(buildProgress(logs, sessions, exercise(), '2026-02-01T09:00:00Z')).toBeUndefined()
  })

  it('skips logs with no value and logs of unknown sessions', () => {
    const extra = [...logs, log('l4', 's2', undefined, 10, '2026-02-08T09:20:00Z'), log('l5', 'gone', 70, 5, '2026-03-01T09:00:00Z')]
    expect(buildProgress(extra, sessions, exercise())?.values).toEqual([80, 84, 82.3])
  })
})

describe('sparkPoints', () => {
  it('spreads values across the box with the highest at the top', () => {
    expect(sparkPoints([1, 2, 3], 100, 40)).toEqual([
      { x: 4, y: 36 },
      { x: 50, y: 20 },
      { x: 96, y: 4 },
    ])
  })

  it('puts a flat series in the middle', () => {
    expect(sparkPoints([5, 5, 5], 100, 40).map((p) => p.y)).toEqual([20, 20, 20])
  })

  it('only draws the latest sessions', () => {
    const values = Array.from({ length: WINDOW + 4 }, (_, i) => i)
    expect(sparkPoints(values, 100, 40)).toHaveLength(WINDOW)
  })
})

describe('loadProgress', () => {
  beforeEach(async () => {
    await Promise.all(db.tables.map((t) => t.clear()))
  })

  const bench: ExerciseInput = {
    name: 'Bench press',
    remarks: '',
    type: 'strength',
    loadType: 'total',
    defaultSets: 3,
    defaultReps: 10,
    defaultWeight: 60,
  }

  it('reads the history of the exercise from the database, up to the given session', async () => {
    const id = await createExercise(bench)
    const ex = (await db.exercises.get(id))!
    const s1 = await startSession(null, new Date('2026-02-01T09:00:00Z'))
    await saveLog(s1, id, { sets: 3, repsOrSeconds: 10, weight: 60, remarks: '' }, new Date('2026-02-01T09:10:00Z'))
    await finishSession(s1, new Date('2026-02-01T10:00:00Z'))
    const s2 = await startSession(null, new Date('2026-02-08T09:00:00Z'))
    await saveLog(s2, id, { sets: 3, repsOrSeconds: 10, weight: 62.5, remarks: '' }, new Date('2026-02-08T09:10:00Z'))
    await finishSession(s2, new Date('2026-02-08T10:00:00Z'))
    const s3 = await startSession(null, new Date('2026-02-15T09:00:00Z'))

    // The open third session has no log yet: two values so far.
    expect((await loadProgress(ex, (await db.sessions.get(s3))!))?.values).toEqual([80, 83.3])
    // Looking at the first session alone: nothing to compare.
    expect(await loadProgress(ex, (await db.sessions.get(s1))!)).toBeUndefined()
  })
})
