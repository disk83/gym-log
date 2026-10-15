import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from './db'
import {
  createCycle,
  createExercise,
  createRoutine,
  moveItem,
  removeCycle,
  removeExercise,
  removeRoutine,
  setActiveCycle,
  setCycleArchived,
  setExerciseArchived,
  updateExercise,
  updateCycle,
  updateRoutine,
  type ExerciseInput,
} from './data'

const bench: ExerciseInput = {
  name: 'Bench press',
  machine: 'Rack 2',
  remarks: '3-4 x 8-10',
  type: 'strength',
  loadType: 'total',
  defaultSets: 3,
  defaultReps: 10,
  defaultWeight: 60,
}

function exercise(name: string): ExerciseInput {
  return { ...bench, name }
}

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()))
})

describe('moveItem', () => {
  it('moves forward and backward', () => {
    expect(moveItem(['a', 'b', 'c', 'd'], 0, 2)).toEqual(['b', 'c', 'a', 'd'])
    expect(moveItem(['a', 'b', 'c', 'd'], 3, 1)).toEqual(['a', 'd', 'b', 'c'])
  })

  it('ignores out of range indexes', () => {
    expect(moveItem(['a', 'b'], 0, 5)).toEqual(['a', 'b'])
  })
})

describe('exercises', () => {
  it('creates an exercise, not archived', async () => {
    const id = await createExercise(bench)
    expect(await db.exercises.get(id)).toEqual({ ...bench, id, archived: false })
  })

  it('edits an exercise and removes cleared optional fields', async () => {
    const id = await createExercise(bench)
    await setExerciseArchived(id, true)
    const { machine: _m, defaultWeight: _w, ...rest } = bench
    await updateExercise(id, { ...rest, name: 'Plank', type: 'timed', loadType: 'bodyweight', defaultReps: 45 })
    const saved = await db.exercises.get(id)
    expect(saved).toMatchObject({ name: 'Plank', type: 'timed', loadType: 'bodyweight', defaultReps: 45, archived: true })
    expect(saved).not.toHaveProperty('machine')
    expect(saved).not.toHaveProperty('defaultWeight')
  })

  it('archives and restores', async () => {
    const id = await createExercise(bench)
    await setExerciseArchived(id, true)
    expect((await db.exercises.get(id))?.archived).toBe(true)
    await setExerciseArchived(id, false)
    expect((await db.exercises.get(id))?.archived).toBe(false)
  })

  it('deletes an exercise without history and drops it from routines', async () => {
    const a = await createExercise(exercise('A'))
    const b = await createExercise(exercise('B'))
    const r = await createRoutine({ name: 'Push', remarks: '', exerciseIds: [a, b] })
    expect(await removeExercise(a)).toBe('deleted')
    expect(await db.exercises.get(a)).toBeUndefined()
    expect((await db.routines.get(r))?.exerciseIds).toEqual([b])
  })

  it('archives an exercise with history instead of deleting it', async () => {
    const a = await createExercise(exercise('A'))
    const r = await createRoutine({ name: 'Push', remarks: '', exerciseIds: [a] })
    await db.logs.add({
      id: 'log1', sessionId: 's1', exerciseId: a, sets: 3, repsOrSeconds: 10, remarks: '', loggedAt: '2026-01-01T10:00:00Z',
    })
    expect(await removeExercise(a)).toBe('archived')
    expect((await db.exercises.get(a))?.archived).toBe(true)
    expect((await db.routines.get(r))?.exerciseIds).toEqual([a])
  })
})

describe('routines', () => {
  it('creates, edits and reorders exercises', async () => {
    const [a, b, c] = await Promise.all(['A', 'B', 'C'].map((n) => createExercise(exercise(n))))
    const id = await createRoutine({ name: 'Push', remarks: '', exerciseIds: [a, b, c] })
    expect(await db.routines.get(id)).toEqual({ id, name: 'Push', remarks: '', exerciseIds: [a, b, c], archived: false })

    await updateRoutine(id, { name: 'Push', remarks: '', exerciseIds: moveItem([a, b, c], 2, 0) })
    expect((await db.routines.get(id))?.exerciseIds).toEqual([c, a, b])

    // Removing an exercise from a routine leaves the exercise itself alone.
    await updateRoutine(id, { name: 'Push day', remarks: 'heavy', exerciseIds: [c, b] })
    expect(await db.routines.get(id)).toMatchObject({ name: 'Push day', remarks: 'heavy', exerciseIds: [c, b] })
    expect(await db.exercises.get(a)).toBeDefined()
  })

  it('deletes a routine without history and drops it from cycles', async () => {
    const r1 = await createRoutine({ name: 'Push', remarks: '', exerciseIds: [] })
    const r2 = await createRoutine({ name: 'Pull', remarks: '', exerciseIds: [] })
    const c = await createCycle({ name: 'PPL', remarks: '', routineIds: [r1, r2] })
    expect(await removeRoutine(r1)).toBe('deleted')
    expect((await db.cycles.get(c))?.routineIds).toEqual([r2])
  })

  it('archives a routine with history', async () => {
    const r = await createRoutine({ name: 'Push', remarks: '', exerciseIds: [] })
    await db.sessions.add({ id: 's1', startedAt: '2026-01-01T10:00:00Z', finishedAt: null, routineId: r, cycleId: null })
    expect(await removeRoutine(r)).toBe('archived')
    expect((await db.routines.get(r))?.archived).toBe(true)
  })
})

describe('cycles', () => {
  it('makes the first cycle active and later ones inactive', async () => {
    const c1 = await createCycle({ name: 'One', remarks: '', routineIds: [] })
    const c2 = await createCycle({ name: 'Two', remarks: '', routineIds: [] })
    expect((await db.cycles.get(c1))?.active).toBe(true)
    expect((await db.cycles.get(c2))?.active).toBe(false)
  })

  it('reorders routines', async () => {
    const c = await createCycle({ name: 'PPL', remarks: '', routineIds: ['a', 'b', 'c'] })
    await updateCycle(c, { name: 'PPL', remarks: '', routineIds: moveItem(['a', 'b', 'c'], 0, 2) })
    expect((await db.cycles.get(c))?.routineIds).toEqual(['b', 'c', 'a'])
  })

  it('keeps exactly one active cycle', async () => {
    const ids = [
      await createCycle({ name: 'One', remarks: '', routineIds: [] }),
      await createCycle({ name: 'Two', remarks: '', routineIds: [] }),
      await createCycle({ name: 'Three', remarks: '', routineIds: [] }),
    ]
    await setActiveCycle(ids[2])
    await setActiveCycle(ids[1])
    const active = (await db.cycles.toArray()).filter((c) => c.active).map((c) => c.id)
    expect(active).toEqual([ids[1]])
  })

  it('deactivates a cycle when it is archived, and reactivating unarchives it', async () => {
    const c = await createCycle({ name: 'One', remarks: '', routineIds: [] })
    await setCycleArchived(c, true)
    expect(await db.cycles.get(c)).toMatchObject({ archived: true, active: false })
    await setActiveCycle(c)
    expect(await db.cycles.get(c)).toMatchObject({ archived: false, active: true })
  })

  it('deletes without history, archives with history', async () => {
    const c1 = await createCycle({ name: 'One', remarks: '', routineIds: [] })
    const c2 = await createCycle({ name: 'Two', remarks: '', routineIds: [] })
    await db.sessions.add({ id: 's1', startedAt: '2026-01-01T10:00:00Z', finishedAt: null, routineId: null, cycleId: c2 })
    expect(await removeCycle(c1)).toBe('deleted')
    expect(await db.cycles.get(c1)).toBeUndefined()
    expect(await removeCycle(c2)).toBe('archived')
    expect((await db.cycles.get(c2))?.archived).toBe(true)
  })
})
