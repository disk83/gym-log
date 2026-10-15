import Dexie, { type EntityTable } from 'dexie'

// Data model from gym-log-spec.md section 2.
// All ids are UUID strings (crypto.randomUUID()); dates are ISO strings.

export type ExerciseType = 'strength' | 'timed'
export type LoadType = 'total' | 'per_dumbbell' | 'bodyweight'

export interface Exercise {
  id: string
  name: string
  machine?: string
  remarks: string
  type: ExerciseType
  loadType: LoadType
  defaultSets: number
  /** Reps for strength exercises, seconds for timed ones. */
  defaultReps: number
  defaultWeight?: number
  archived: boolean
}

export interface Routine {
  id: string
  name: string
  remarks: string
  /** Ordered list of exercise ids. */
  exerciseIds: string[]
  /** Routines with history are archived instead of deleted. */
  archived: boolean
}

export interface Cycle {
  id: string
  name: string
  remarks: string
  /** Ordered list of routine ids. */
  routineIds: string[]
  /** Exactly one cycle can be active. */
  active: boolean
  /** Cycles with history are archived instead of deleted. */
  archived: boolean
}

export interface Session {
  id: string
  startedAt: string
  /** null while the session is open. */
  finishedAt: string | null
  /** null for a free session. */
  routineId: string | null
  /** The active cycle when the session started; null if none was active. */
  cycleId: string | null
}

export interface Log {
  id: string
  sessionId: string
  exerciseId: string
  sets: number
  repsOrSeconds: number
  weight?: number
  remarks: string
  loggedAt: string
}

/** Key-value app settings, e.g. last backup export date. */
export interface Setting {
  key: string
  value: unknown
}

export const db = new Dexie('gym-log') as Dexie & {
  exercises: EntityTable<Exercise, 'id'>
  routines: EntityTable<Routine, 'id'>
  cycles: EntityTable<Cycle, 'id'>
  sessions: EntityTable<Session, 'id'>
  logs: EntityTable<Log, 'id'>
  settings: EntityTable<Setting, 'key'>
}

// Only indexed fields are listed. Booleans and nulls are not valid IndexedDB
// keys, so archived/active/finishedAt are filtered in memory instead.
db.version(1).stores({
  exercises: 'id, name',
  routines: 'id, name',
  cycles: 'id, name',
  sessions: 'id, startedAt, routineId, cycleId',
  logs: 'id, sessionId, exerciseId, loggedAt, [exerciseId+loggedAt], [sessionId+exerciseId]',
  settings: 'key',
})

/** Ask the browser to keep IndexedDB data from being evicted (spec section 6). */
export async function requestPersistentStorage(): Promise<boolean> {
  if (!navigator.storage?.persist) return false
  if (await navigator.storage.persisted()) return true
  return navigator.storage.persist()
}
