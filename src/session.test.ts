import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db, type Cycle, type Exercise, type Log, type Routine, type Session } from './db'
import { createCycle, createExercise, createRoutine, removeExercise, setActiveCycle, type ExerciseInput } from './data'
import {
  addExerciseToSession,
  discardSession,
  finishMessage,
  finishSession,
  getLastLog,
  getOpenSession,
  getSuggestedRoutine,
  prefillValues,
  saveLog,
  sessionExerciseIds,
  startSession,
  suggestNextRoutineId,
} from './session'

// ---------- Fixtures ----------

function routine(id: string, archived = false): Routine {
  return { id, name: id.toUpperCase(), remarks: '', exerciseIds: [], archived }
}

function cycle(id: string, routineIds: string[]): Cycle {
  return { id, name: id, remarks: '', routineIds, active: true, archived: false }
}

let day = 0
/** A finished session, each one a day after the previous. */
function done(routineId: string | null, cycleId: string | null = 'c1'): Session {
  day++
  const d = String(day).padStart(2, '0')
  return {
    id: `s${day}`,
    startedAt: `2026-01-${d}T10:00:00.000Z`,
    finishedAt: `2026-01-${d}T11:00:00.000Z`,
    routineId,
    cycleId,
  }
}

const routines = ['a', 'b', 'c'].map((id) => routine(id))
const abc = cycle('c1', ['a', 'b', 'c'])

const bench: ExerciseInput = {
  name: 'Bench press',
  remarks: '3-4 x 8-10',
  type: 'strength',
  loadType: 'total',
  defaultSets: 3,
  defaultReps: 10,
  defaultWeight: 60,
}

function exerciseRecord(over: Partial<Exercise> = {}): Exercise {
  return { ...bench, id: 'e1', archived: false, ...over }
}

beforeEach(async () => {
  day = 0
  await Promise.all(db.tables.map((t) => t.clear()))
})

// ---------- Next routine suggestion ----------

describe('suggestNextRoutineId', () => {
  it('suggests the first routine of the active cycle when there is no history', () => {
    expect(suggestNextRoutineId(abc, routines, [])).toBe('a')
  })

  it('suggests the routine after the most recent finished one', () => {
    expect(suggestNextRoutineId(abc, routines, [done('a')])).toBe('b')
    expect(suggestNextRoutineId(abc, routines, [done('a'), done('b')])).toBe('c')
  })

  it('wraps from the last routine to the first', () => {
    expect(suggestNextRoutineId(abc, routines, [done('a'), done('b'), done('c')])).toBe('a')
  })

  it('uses the most recent session, not the order of the list', () => {
    const older = done('c')
    const newer = done('a')
    expect(suggestNextRoutineId(abc, routines, [newer, older])).toBe('b')
  })

  it('ignores free sessions', () => {
    expect(suggestNextRoutineId(abc, routines, [done('a'), done(null)])).toBe('b')
    expect(suggestNextRoutineId(abc, routines, [done(null)])).toBe('a')
  })

  it('ignores open sessions', () => {
    const open = { ...done('b'), finishedAt: null }
    expect(suggestNextRoutineId(abc, routines, [done('a'), open])).toBe('b')
  })

  it('ignores sessions whose routine is not in the active cycle', () => {
    const others = [...routines, routine('x')]
    expect(suggestNextRoutineId(abc, others, [done('a'), done('x')])).toBe('b')
    expect(suggestNextRoutineId(abc, others, [done('x')])).toBe('a')
  })

  it('follows the new cycle after the active cycle changes', () => {
    const others = [...routines, routine('x'), routine('y')]
    const history = [done('a'), done('b')]
    // A cycle with none of the done routines starts at its first routine.
    expect(suggestNextRoutineId(cycle('c2', ['x', 'y']), others, history)).toBe('x')
    // A routine shared with the new cycle counts, whichever cycle it was done in.
    expect(suggestNextRoutineId(cycle('c2', ['x', 'b', 'y']), others, history)).toBe('y')
  })

  it('skips archived routines', () => {
    const withArchived = [routine('a'), routine('b', true), routine('c')]
    expect(suggestNextRoutineId(abc, withArchived, [done('a')])).toBe('c')
  })

  it('returns null with no active cycle or an empty one', () => {
    expect(suggestNextRoutineId(undefined, routines, [done('a')])).toBeNull()
    expect(suggestNextRoutineId(cycle('c1', []), routines, [])).toBeNull()
  })
})

describe('suggestion from the database', () => {
  it('moves forward when a routine session finishes, not after a free one', async () => {
    const a = await createRoutine({ name: 'Push', remarks: '', exerciseIds: [] })
    const b = await createRoutine({ name: 'Pull', remarks: '', exerciseIds: [] })
    await createCycle({ name: 'PPL', remarks: '', routineIds: [a, b] })
    expect((await getSuggestedRoutine())?.id).toBe(a)

    await finishSession(await startSession(a, new Date('2026-01-01T10:00:00Z')))
    expect((await getSuggestedRoutine())?.id).toBe(b)

    await finishSession(await startSession(null, new Date('2026-01-02T10:00:00Z')))
    expect((await getSuggestedRoutine())?.id).toBe(b)

    await finishSession(await startSession(b, new Date('2026-01-03T10:00:00Z')))
    expect((await getSuggestedRoutine())?.id).toBe(a)
  })

  it('switches with the active cycle', async () => {
    const a = await createRoutine({ name: 'Push', remarks: '', exerciseIds: [] })
    const x = await createRoutine({ name: 'Legs', remarks: '', exerciseIds: [] })
    await createCycle({ name: 'One', remarks: '', routineIds: [a] })
    const two = await createCycle({ name: 'Two', remarks: '', routineIds: [x, a] })
    await finishSession(await startSession(a))
    expect((await getSuggestedRoutine())?.id).toBe(a)
    await setActiveCycle(two)
    expect((await getSuggestedRoutine())?.id).toBe(x)
  })
})

// ---------- Prefill ----------

describe('prefillValues', () => {
  const log: Log = {
    id: 'l1',
    sessionId: 's1',
    exerciseId: 'e1',
    sets: 4,
    repsOrSeconds: 8,
    weight: 65,
    remarks: 'seat 4',
    loggedAt: '2026-01-01T10:00:00Z',
  }

  it('uses the last log when there is one', () => {
    expect(prefillValues(exerciseRecord(), log)).toEqual({ sets: 4, repsOrSeconds: 8, weight: 65, remarks: 'seat 4' })
  })

  it('keeps a weightless last log weightless, even if the exercise has a default weight', () => {
    const { weight: _w, ...noWeight } = log
    expect(prefillValues(exerciseRecord(), noWeight)).toEqual({ sets: 4, repsOrSeconds: 8, remarks: 'seat 4' })
  })

  it('falls back to the exercise defaults', () => {
    expect(prefillValues(exerciseRecord(), undefined)).toEqual({ sets: 3, repsOrSeconds: 10, weight: 60, remarks: '' })
    const plank = exerciseRecord({ type: 'timed', loadType: 'bodyweight', defaultReps: 45, defaultWeight: undefined })
    expect(prefillValues(plank, undefined)).toEqual({ sets: 3, repsOrSeconds: 45, remarks: '' })
  })

  it('finds the most recent log across routines and sessions', async () => {
    const e = await createExercise(bench)
    const r1 = await createRoutine({ name: 'Push', remarks: '', exerciseIds: [e] })
    const s1 = await startSession(r1, new Date('2026-01-01T10:00:00Z'))
    await saveLog(s1, e, { sets: 3, repsOrSeconds: 10, weight: 60, remarks: '' }, new Date('2026-01-01T10:10:00Z'))
    await finishSession(s1)
    const s2 = await startSession(null, new Date('2026-01-02T10:00:00Z'))
    await saveLog(s2, e, { sets: 4, repsOrSeconds: 8, weight: 70, remarks: 'free' }, new Date('2026-01-02T10:10:00Z'))
    await finishSession(s2)

    const s3 = await startSession(r1, new Date('2026-01-03T10:00:00Z'))
    expect(await getLastLog(e, s3)).toMatchObject({ sessionId: s2, weight: 70 })
    // While editing this session's log, "last time" still points to the previous one.
    await saveLog(s3, e, { sets: 5, repsOrSeconds: 5, weight: 80, remarks: '' }, new Date('2026-01-03T10:10:00Z'))
    expect(await getLastLog(e, s3)).toMatchObject({ sessionId: s2 })
    expect(await getLastLog(e)).toMatchObject({ sessionId: s3 })
  })
})

// ---------- Finish message ----------

describe('finishMessage', () => {
  it('formats both cases', () => {
    expect(finishMessage(true, 'Pull')).toBe('Routine complete, next: Pull')
    expect(finishMessage(false, 'Pull')).toBe('Session finished, next suggested: Pull')
    expect(finishMessage(false, undefined)).toBe('Session finished')
  })

  async function setup() {
    const e1 = await createExercise({ ...bench, name: 'A' })
    const e2 = await createExercise({ ...bench, name: 'B' })
    const push = await createRoutine({ name: 'Push', remarks: '', exerciseIds: [e1, e2] })
    const pull = await createRoutine({ name: 'Pull', remarks: '', exerciseIds: [] })
    await createCycle({ name: 'PPL', remarks: '', routineIds: [push, pull] })
    return { e1, e2, push }
  }
  const values = { sets: 3, repsOrSeconds: 10, weight: 60, remarks: '' }

  it('says complete when every routine exercise was logged', async () => {
    const { e1, e2, push } = await setup()
    const s = await startSession(push)
    await saveLog(s, e2, values)
    await saveLog(s, e1, values)
    expect(await finishSession(s)).toBe('Routine complete, next: Pull')
    expect((await db.sessions.get(s))?.finishedAt).toBeTruthy()
  })

  it('says finished when an exercise is missing', async () => {
    const { e1, push } = await setup()
    const s = await startSession(push)
    await saveLog(s, e1, values)
    expect(await finishSession(s)).toBe('Session finished, next suggested: Pull')
  })

  it('does not count an archived routine exercise as missing', async () => {
    const { e1, e2, push } = await setup()
    const old = await startSession(null, new Date('2026-01-01T10:00:00Z'))
    await saveLog(old, e2, values)
    await finishSession(old)
    expect(await removeExercise(e2)).toBe('archived')
    const s = await startSession(push, new Date('2026-01-02T10:00:00Z'))
    await saveLog(s, e1, values)
    expect(await finishSession(s)).toBe('Routine complete, next: Pull')
  })

  it('a free session keeps the current suggestion', async () => {
    const { e1 } = await setup()
    const s = await startSession(null)
    await saveLog(s, e1, values)
    expect(await finishSession(s)).toBe('Session finished, next suggested: Push')
  })
})

// ---------- Session lifecycle ----------

describe('session lifecycle', () => {
  it('allows only one open session', async () => {
    const s = await startSession(null)
    await expect(startSession(null)).rejects.toThrow()
    expect((await getOpenSession())?.id).toBe(s)
  })

  it('keeps one log per exercise per session', async () => {
    const e = await createExercise(bench)
    const s = await startSession(null)
    const id1 = await saveLog(s, e, { sets: 3, repsOrSeconds: 10, weight: 60, remarks: '' })
    const id2 = await saveLog(s, e, { sets: 4, repsOrSeconds: 10, remarks: 'no weight' })
    expect(id2).toBe(id1)
    const logs = await db.logs.toArray()
    expect(logs).toHaveLength(1)
    expect(logs[0]).toMatchObject({ sets: 4, remarks: 'no weight' })
    expect(logs[0]).not.toHaveProperty('weight')
  })

  it('discards a session and its logs', async () => {
    const e = await createExercise(bench)
    const s = await startSession(null)
    await saveLog(s, e, { sets: 3, repsOrSeconds: 10, remarks: '' })
    await discardSession(s)
    expect(await db.sessions.count()).toBe(0)
    expect(await db.logs.count()).toBe(0)
  })

  it('adds exercises outside the routine, but not archived ones', async () => {
    const e1 = await createExercise({ ...bench, name: 'A' })
    const e2 = await createExercise({ ...bench, name: 'B' })
    const e3 = await createExercise({ ...bench, name: 'C' })
    await db.exercises.update(e3, { archived: true })
    const r = await createRoutine({ name: 'Push', remarks: '', exerciseIds: [e1] })
    const s = await startSession(r)
    await addExerciseToSession(s, e2)
    await addExerciseToSession(s, e2)
    await expect(addExerciseToSession(s, e3)).rejects.toThrow()

    const session = (await db.sessions.get(s))!
    const exercises = new Map((await db.exercises.toArray()).map((e) => [e.id, e]))
    expect(sessionExerciseIds(await db.routines.get(r), session, [], exercises)).toEqual([e1, e2])
  })

  it('refuses to start an archived routine', async () => {
    const r = await createRoutine({ name: 'Push', remarks: '', exerciseIds: [] })
    await db.routines.update(r, { archived: true })
    await expect(startSession(r)).rejects.toThrow()
  })
})
