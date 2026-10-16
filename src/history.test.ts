import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db, type Log, type Session } from './db'
import { createCycle, createExercise, createRoutine, updateExercise, type ExerciseInput } from './data'
import { daysBetween, deleteLog, deleteSession, logsInOrder, sessionsNewestFirst, shiftDays, toDateInput, updateSession } from './history'
import {
  finishSession,
  getLastLog,
  getSessionLog,
  getSuggestedRoutine,
  lastLogOptionsFor,
  pickLastLog,
  prefillValues,
  saveLog,
  startSession,
} from './session'

const bench: ExerciseInput = {
  name: 'Bench press',
  machine: 'Rack 2',
  remarks: '',
  type: 'strength',
  loadType: 'total',
  defaultSets: 3,
  defaultReps: 10,
  defaultWeight: 60,
}

const at = (iso: string) => new Date(iso)

/** A finished session on `day` (2026-01-DD) with one log of `exerciseId` at `weight`. */
async function sessionWithLog(routineId: string | null, day: number, exerciseId: string, weight: number) {
  const d = String(day).padStart(2, '0')
  const s = await startSession(routineId, at(`2026-01-${d}T10:00:00Z`))
  await saveLog(s, exerciseId, { sets: 3, repsOrSeconds: 10, weight, remarks: '' }, at(`2026-01-${d}T10:10:00Z`))
  await finishSession(s, at(`2026-01-${d}T11:00:00Z`))
  return s
}

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()))
})

describe('"Last time" after history edits', () => {
  it('editing an old log does not change "Last time" when a newer log exists', async () => {
    const e = await createExercise(bench)
    const old = await sessionWithLog(null, 1, e, 60)
    await sessionWithLog(null, 2, e, 70)

    // Edit the old log much later: it is saved last, but its session is older.
    await saveLog(old, e, { sets: 5, repsOrSeconds: 5, weight: 100, remarks: 'edited' }, at('2026-02-01T09:00:00Z'))

    const last = await getLastLog(e)
    expect(last?.log.weight).toBe(70)
    expect(last?.date).toBe('2026-01-02T10:00:00.000Z')
    expect(prefillValues((await db.exercises.get(e))!, last?.log).weight).toBe(70)
    // And the edit was really saved.
    expect((await getSessionLog(old, e))?.weight).toBe(100)
  })

  it('deleting the most recent log makes "Last time" fall back to the previous one', async () => {
    const e = await createExercise(bench)
    await sessionWithLog(null, 1, e, 60)
    const newer = await sessionWithLog(null, 2, e, 70)
    expect((await getLastLog(e))?.log.weight).toBe(70)

    await deleteLog((await getSessionLog(newer, e))!.id)
    expect((await getLastLog(e))?.log.weight).toBe(60)

    // With no log left, the prefill falls back to the exercise defaults.
    await deleteLog((await db.logs.toArray())[0].id)
    expect(await getLastLog(e)).toBeUndefined()
    expect(prefillValues((await db.exercises.get(e))!, undefined).weight).toBe(60)
  })

  it('deleting a whole session deletes its logs and falls back too', async () => {
    const e = await createExercise(bench)
    await sessionWithLog(null, 1, e, 60)
    const newer = await sessionWithLog(null, 2, e, 70)
    await deleteSession(newer)
    expect(await db.sessions.get(newer)).toBeUndefined()
    expect(await db.logs.where('sessionId').equals(newer).count()).toBe(0)
    expect((await getLastLog(e))?.log.weight).toBe(60)
  })

  it('moving a session to a later date makes it "Last time"', async () => {
    const e = await createExercise(bench)
    const first = await sessionWithLog(null, 1, e, 60)
    await sessionWithLog(null, 2, e, 70)
    await updateSession(first, { date: toDateInput('2026-01-03T10:00:00Z'), remarks: '' })
    expect((await getLastLog(e))?.log.weight).toBe(60)
  })
})

describe('adding a log to a past session', () => {
  it('adds the log to that session without making it "Last time" when a newer one exists', async () => {
    const e1 = await createExercise(bench)
    const e2 = await createExercise({ ...bench, name: 'Row', machine: undefined })
    const past = await sessionWithLog(null, 1, e1, 60)
    await sessionWithLog(null, 3, e2, 40)

    // Added today to the session of the 1st.
    await saveLog(past, e2, { sets: 4, repsOrSeconds: 8, weight: 35, remarks: 'forgot it' }, at('2026-02-01T09:00:00Z'))

    const logs = logsInOrder(await db.logs.where('sessionId').equals(past).toArray())
    expect(logs.map((l) => l.exerciseId)).toEqual([e1, e2])
    expect(logs[1]).toMatchObject({ sets: 4, repsOrSeconds: 8, weight: 35, remarks: 'forgot it' })
    // The newer session of the 3rd is still "Last time" for e2.
    expect((await getLastLog(e2))?.log.weight).toBe(40)
  })

  it('becomes "Last time" when it is the most recent log of the exercise', async () => {
    const e1 = await createExercise(bench)
    const e2 = await createExercise({ ...bench, name: 'Row' })
    await sessionWithLog(null, 1, e2, 30)
    const past = await sessionWithLog(null, 2, e1, 60)
    await saveLog(past, e2, { sets: 3, repsOrSeconds: 10, weight: 35, remarks: '' }, at('2026-02-01T09:00:00Z'))
    expect((await getLastLog(e2))?.log.weight).toBe(35)
  })

  it('prefills from the log before that session, ignoring newer sessions', async () => {
    const e = await createExercise(bench)
    await sessionWithLog(null, 1, e, 50)
    const other = await createExercise({ ...bench, name: 'Row' })
    const past = await sessionWithLog(null, 2, other, 30)
    await sessionWithLog(null, 3, e, 70)

    const session = (await db.sessions.get(past))!
    const before = await getLastLog(e, lastLogOptionsFor(session))
    expect(before?.log.weight).toBe(50)
  })
})

describe('next-routine suggestion after history edits', () => {
  it('deleting the session the suggestion was based on recalculates it', async () => {
    const e = await createExercise(bench)
    const a = await createRoutine({ name: 'Push', remarks: '', exerciseIds: [e] })
    const b = await createRoutine({ name: 'Pull', remarks: '', exerciseIds: [e] })
    const c = await createRoutine({ name: 'Legs', remarks: '', exerciseIds: [e] })
    await createCycle({ name: 'PPL', remarks: '', routineIds: [a, b, c] })

    await sessionWithLog(a, 1, e, 60)
    const pull = await sessionWithLog(b, 2, e, 60)
    expect((await getSuggestedRoutine())?.id).toBe(c)

    await deleteSession(pull)
    expect((await getSuggestedRoutine())?.id).toBe(b)
  })

  it('changing a session date reorders the history the suggestion is based on', async () => {
    const e = await createExercise(bench)
    const a = await createRoutine({ name: 'Push', remarks: '', exerciseIds: [e] })
    const b = await createRoutine({ name: 'Pull', remarks: '', exerciseIds: [e] })
    await createCycle({ name: 'PP', remarks: '', routineIds: [a, b] })
    const push = await sessionWithLog(a, 1, e, 60)
    await sessionWithLog(b, 2, e, 60)
    expect((await getSuggestedRoutine())?.id).toBe(a)

    await updateSession(push, { date: toDateInput('2026-01-03T10:00:00Z'), remarks: '' })
    expect((await getSuggestedRoutine())?.id).toBe(b)
  })
})

describe('editing a session', () => {
  it('moves start, finish and logs by whole days and saves remarks', async () => {
    const e = await createExercise(bench)
    const s = await sessionWithLog(null, 5, e, 60)
    const before = (await db.sessions.get(s))!
    const log = (await getSessionLog(s, e))!

    await updateSession(s, { date: toDateInput(shiftDays(before.startedAt, -2)), remarks: '  felt strong ' })
    const after = (await db.sessions.get(s))!
    expect(after.startedAt).toBe(shiftDays(before.startedAt, -2))
    expect(after.finishedAt).toBe(shiftDays(before.finishedAt!, -2))
    expect(after.remarks).toBe('felt strong')
    expect((await getSessionLog(s, e))!.loggedAt).toBe(shiftDays(log.loggedAt, -2))

    await updateSession(s, { date: toDateInput(after.startedAt), remarks: '' })
    expect(await db.sessions.get(s)).not.toHaveProperty('remarks')
  })

  it('shows edits to an exercise in its past logs', async () => {
    const e = await createExercise(bench)
    const s = await sessionWithLog(null, 1, e, 60)
    await updateExercise(e, { ...bench, name: 'Incline bench', machine: 'Bench 3' })
    const log = (await getSessionLog(s, e))!
    expect(await db.exercises.get(log.exerciseId)).toMatchObject({ name: 'Incline bench', machine: 'Bench 3' })
  })
})

describe('pure helpers', () => {
  const session = (id: string, startedAt: string): Session => ({
    id,
    startedAt,
    finishedAt: startedAt,
    routineId: null,
    cycleId: null,
  })
  const log = (id: string, sessionId: string, loggedAt: string): Log => ({
    id,
    sessionId,
    exerciseId: 'e',
    sets: 3,
    repsOrSeconds: 10,
    remarks: '',
    loggedAt,
  })

  it('pickLastLog orders by session date, not save time, and respects the options', () => {
    const sessions = new Map([
      ['old', session('old', '2026-01-01T10:00:00Z')],
      ['new', session('new', '2026-01-02T10:00:00Z')],
    ])
    const logs = [log('l1', 'new', '2026-01-02T10:10:00Z'), log('l2', 'old', '2026-03-01T10:00:00Z'), log('l3', 'gone', '2026-04-01T00:00:00Z')]
    expect(pickLastLog(logs, sessions)?.log.id).toBe('l1')
    expect(pickLastLog(logs, sessions, { excludeSessionId: 'new' })?.log.id).toBe('l2')
    expect(pickLastLog(logs, sessions, { before: '2026-01-02T10:00:00Z' })?.log.id).toBe('l2')
    expect(pickLastLog(logs, sessions, { before: '2026-01-01T10:00:00Z' })).toBeUndefined()
  })

  it('sorts sessions newest first and logs in logged order', () => {
    const list = sessionsNewestFirst([session('a', '2026-01-01T10:00:00Z'), session('b', '2026-01-03T10:00:00Z')])
    expect(list.map((s) => s.id)).toEqual(['b', 'a'])
    const logs = logsInOrder([log('x', 's', '2026-01-01T10:20:00Z'), log('y', 's', '2026-01-01T10:10:00Z')])
    expect(logs.map((l) => l.id)).toEqual(['y', 'x'])
  })

  it('counts calendar days', () => {
    expect(daysBetween('2026-01-05T10:00:00Z', toDateInput('2026-01-05T10:00:00Z'))).toBe(0)
    expect(daysBetween('2026-01-05T10:00:00Z', toDateInput('2026-01-08T10:00:00Z'))).toBe(3)
    expect(() => daysBetween('2026-01-05T10:00:00Z', '2026-02-30')).toThrow()
  })
})
