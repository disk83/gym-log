import { db, type Cycle, type Exercise, type Routine } from './db'

// Data access for the Manage screens. Every function writes to Dexie straight
// away; the UI reads back through live queries.

export type ExerciseInput = Omit<Exercise, 'id' | 'archived'>
export type RoutineInput = Omit<Routine, 'id' | 'archived'>
export type CycleInput = Omit<Cycle, 'id' | 'archived' | 'active'>

/** What a remove call actually did (spec section 2: archive when history exists). */
export type RemoveResult = 'deleted' | 'archived'

function newId(): string {
  return crypto.randomUUID()
}

/** Return a copy of `list` with the item at `from` moved to `to`. */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  const next = list.slice()
  if (from < 0 || from >= next.length || to < 0 || to >= next.length) return next
  const [item] = next.splice(from, 1)
  next.splice(to, 0, item)
  return next
}

// ---------- Exercises ----------

export async function createExercise(input: ExerciseInput): Promise<string> {
  const id = newId()
  await db.exercises.add({ ...input, id, archived: false })
  return id
}

export async function updateExercise(id: string, input: ExerciseInput): Promise<void> {
  const existing = await db.exercises.get(id)
  if (!existing) throw new Error(`Exercise ${id} not found`)
  // put (not update) so cleared optional fields are really removed.
  await db.exercises.put({ ...input, id, archived: existing.archived })
}

export async function setExerciseArchived(id: string, archived: boolean): Promise<void> {
  await db.exercises.update(id, { archived })
}

export async function exerciseHasHistory(id: string): Promise<boolean> {
  return (await db.logs.where('exerciseId').equals(id).count()) > 0
}

/**
 * Delete an exercise, or archive it if it has logs. A real delete also
 * removes it from every routine.
 */
export async function removeExercise(id: string): Promise<RemoveResult> {
  return db.transaction('rw', db.exercises, db.routines, db.logs, async () => {
    if (await exerciseHasHistory(id)) {
      await db.exercises.update(id, { archived: true })
      return 'archived'
    }
    await db.routines
      .filter((r) => r.exerciseIds.includes(id))
      .modify((r) => {
        r.exerciseIds = r.exerciseIds.filter((x) => x !== id)
      })
    await db.exercises.delete(id)
    return 'deleted'
  })
}

// ---------- Routines ----------

export async function createRoutine(input: RoutineInput): Promise<string> {
  const id = newId()
  await db.routines.add({ ...input, exerciseIds: [...input.exerciseIds], id, archived: false })
  return id
}

export async function updateRoutine(id: string, input: RoutineInput): Promise<void> {
  const existing = await db.routines.get(id)
  if (!existing) throw new Error(`Routine ${id} not found`)
  await db.routines.put({ ...input, exerciseIds: [...input.exerciseIds], id, archived: existing.archived })
}

export async function setRoutineArchived(id: string, archived: boolean): Promise<void> {
  await db.routines.update(id, { archived })
}

export async function routineHasHistory(id: string): Promise<boolean> {
  return (await db.sessions.where('routineId').equals(id).count()) > 0
}

/** Delete a routine, or archive it if it has sessions. A real delete also removes it from every cycle. */
export async function removeRoutine(id: string): Promise<RemoveResult> {
  return db.transaction('rw', db.routines, db.cycles, db.sessions, async () => {
    if (await routineHasHistory(id)) {
      await db.routines.update(id, { archived: true })
      return 'archived'
    }
    await db.cycles
      .filter((c) => c.routineIds.includes(id))
      .modify((c) => {
        c.routineIds = c.routineIds.filter((x) => x !== id)
      })
    await db.routines.delete(id)
    return 'deleted'
  })
}

// ---------- Cycles ----------

/** Create a cycle. It becomes active if no other cycle is active yet. */
export async function createCycle(input: CycleInput): Promise<string> {
  const id = newId()
  await db.transaction('rw', db.cycles, async () => {
    const anyActive = (await db.cycles.filter((c) => c.active).count()) > 0
    await db.cycles.add({ ...input, routineIds: [...input.routineIds], id, active: !anyActive, archived: false })
  })
  return id
}

export async function updateCycle(id: string, input: CycleInput): Promise<void> {
  const existing = await db.cycles.get(id)
  if (!existing) throw new Error(`Cycle ${id} not found`)
  await db.cycles.put({
    ...input,
    routineIds: [...input.routineIds],
    id,
    active: existing.active,
    archived: existing.archived,
  })
}

/** Make `id` the only active cycle. Archived cycles are unarchived first. */
export async function setActiveCycle(id: string): Promise<void> {
  await db.transaction('rw', db.cycles, async () => {
    if (!(await db.cycles.get(id))) throw new Error(`Cycle ${id} not found`)
    await db.cycles
      .filter((c) => c.active && c.id !== id)
      .modify({ active: false })
    await db.cycles.update(id, { active: true, archived: false })
  })
}

/** Archiving a cycle also deactivates it, so an archived cycle is never active. */
export async function setCycleArchived(id: string, archived: boolean): Promise<void> {
  await db.cycles.update(id, archived ? { archived: true, active: false } : { archived: false })
}

export async function cycleHasHistory(id: string): Promise<boolean> {
  return (await db.sessions.where('cycleId').equals(id).count()) > 0
}

export async function removeCycle(id: string): Promise<RemoveResult> {
  return db.transaction('rw', db.cycles, db.sessions, async () => {
    if (await cycleHasHistory(id)) {
      await db.cycles.update(id, { archived: true, active: false })
      return 'archived'
    }
    await db.cycles.delete(id)
    return 'deleted'
  })
}
