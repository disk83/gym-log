import { db, type Cycle, type Exercise, type Log, type Routine, type Session } from './db'

// Session flow (spec section 3). The pure helpers are exported for tests;
// the async functions write to Dexie straight away.

// ---------- Pure helpers ----------

/** Newest first, by start time (finish time breaks ties). */
function newestFirst(a: Session, b: Session): number {
  return b.startedAt.localeCompare(a.startedAt) || (b.finishedAt ?? '').localeCompare(a.finishedAt ?? '')
}

/**
 * The suggested next routine id, derived from history only:
 * the routine after the most recent finished session whose routine belongs to
 * the active cycle, wrapping around; the first routine if there is no such
 * session. Archived or missing routines are skipped, since they cannot start
 * a new session. Free sessions (routineId null) never count.
 */
export function suggestNextRoutineId(
  activeCycle: Cycle | undefined,
  routines: readonly Routine[],
  sessions: readonly Session[],
): string | null {
  if (!activeCycle) return null
  const order = activeCycle.routineIds
  if (order.length === 0) return null
  const usable = new Set(routines.filter((r) => !r.archived).map((r) => r.id))

  const last = sessions
    .filter((s) => s.finishedAt && s.routineId && order.includes(s.routineId))
    .sort(newestFirst)[0]
  const start = last ? order.indexOf(last.routineId!) + 1 : 0

  for (let i = 0; i < order.length; i++) {
    const id = order[(start + i) % order.length]
    if (usable.has(id)) return id
  }
  return null
}

export interface LogValues {
  sets: number
  repsOrSeconds: number
  weight?: number
  remarks: string
}

/** Prefill for the log screen: the most recent log of the exercise, else the exercise defaults. */
export function prefillValues(exercise: Exercise, lastLog: Log | undefined): LogValues {
  const values: LogValues = lastLog
    ? { sets: lastLog.sets, repsOrSeconds: lastLog.repsOrSeconds, weight: lastLog.weight, remarks: lastLog.remarks }
    : { sets: exercise.defaultSets, repsOrSeconds: exercise.defaultReps, weight: exercise.defaultWeight, remarks: '' }
  if (values.weight == null) delete values.weight
  return values
}

/**
 * Exercise ids shown on the session screen, in order: the routine's exercises,
 * then the ones added during the session, then anything logged that is in
 * neither (e.g. removed from the routine meanwhile). Archived exercises of the
 * routine are left out unless already logged in this session.
 */
export function sessionExerciseIds(
  routine: Routine | undefined,
  session: Session,
  logs: readonly Log[],
  exercises: ReadonlyMap<string, Exercise>,
): string[] {
  const logged = new Set(logs.map((l) => l.exerciseId))
  const ids: string[] = []
  const add = (id: string) => {
    const e = exercises.get(id)
    if (!e || ids.includes(id)) return
    if (e.archived && !logged.has(id)) return
    ids.push(id)
  }
  routine?.exerciseIds.forEach(add)
  session.extraExerciseIds?.forEach(add)
  logs.forEach((l) => add(l.exerciseId))
  return ids
}

/** True if the session has a routine and every one of its (non-archived) exercises was logged. */
export function isRoutineComplete(
  routine: Routine | undefined,
  logs: readonly Log[],
  exercises: ReadonlyMap<string, Exercise>,
): boolean {
  if (!routine) return false
  const logged = new Set(logs.map((l) => l.exerciseId))
  return routine.exerciseIds.every((id) => {
    const e = exercises.get(id)
    return !e || e.archived || logged.has(id)
  })
}

export interface LastLog {
  log: Log
  /** Start of the log's session: the date "Last time" shows. */
  date: string
}

export interface LastLogOptions {
  /** Ignore the logs of this session. */
  excludeSessionId?: string
  /** Only consider sessions that started before this ISO date. */
  before?: string
}

/**
 * The most recent of `logs` by the date of its session, not by when it was
 * saved, so editing or adding a log to an old session never makes it "last
 * time". Logs of the same session fall back to save order. Logs whose session
 * is missing are ignored.
 */
export function pickLastLog(
  logs: readonly Log[],
  sessions: ReadonlyMap<string, Session>,
  { excludeSessionId, before }: LastLogOptions = {},
): LastLog | undefined {
  let best: LastLog | undefined
  for (const log of logs) {
    const session = sessions.get(log.sessionId)
    if (!session || session.id === excludeSessionId) continue
    if (before != null && session.startedAt >= before) continue
    const newer =
      !best || session.startedAt > best.date || (session.startedAt === best.date && log.loggedAt > best.log.loggedAt)
    if (newer) best = { log, date: session.startedAt }
  }
  return best
}

/** Message on the end screen. */
export function finishMessage(complete: boolean, nextRoutineName: string | undefined): string {
  if (complete) return nextRoutineName ? `Routine complete, next: ${nextRoutineName}` : 'Routine complete'
  return nextRoutineName ? `Session finished, next suggested: ${nextRoutineName}` : 'Session finished'
}

// ---------- Queries ----------

export async function getActiveCycle(): Promise<Cycle | undefined> {
  return db.cycles.filter((c) => c.active && !c.archived).first()
}

export async function getSuggestedRoutine(): Promise<Routine | undefined> {
  const [cycle, routines, sessions] = await Promise.all([
    getActiveCycle(),
    db.routines.toArray(),
    db.sessions.toArray(),
  ])
  const id = suggestNextRoutineId(cycle, routines, sessions)
  return id ? routines.find((r) => r.id === id) : undefined
}

export async function getOpenSession(): Promise<Session | undefined> {
  return db.sessions.filter((s) => s.finishedAt == null).first()
}

export async function getLastFinishedSession(): Promise<Session | undefined> {
  const finished = await db.sessions.filter((s) => s.finishedAt != null).toArray()
  return finished.sort(newestFirst)[0]
}

/** Most recent log of an exercise from any session, optionally ignoring one session. */
export async function getLastLog(exerciseId: string, options: LastLogOptions = {}): Promise<LastLog | undefined> {
  const logs = await db.logs.where('exerciseId').equals(exerciseId).toArray()
  const ids = [...new Set(logs.map((l) => l.sessionId))]
  const sessions = (await db.sessions.bulkGet(ids)).filter((s): s is Session => s != null)
  return pickLastLog(logs, new Map(sessions.map((s) => [s.id, s])), options)
}

/** "Last time" for the log screen of `session`: anything but this session if it is open, else only older sessions. */
export function lastLogOptionsFor(session: Pick<Session, 'id' | 'startedAt' | 'finishedAt'>): LastLogOptions {
  return session.finishedAt
    ? { excludeSessionId: session.id, before: session.startedAt }
    : { excludeSessionId: session.id }
}

export async function getSessionLog(sessionId: string, exerciseId: string): Promise<Log | undefined> {
  return db.logs.where('[sessionId+exerciseId]').equals([sessionId, exerciseId]).first()
}

// ---------- Writes ----------

/** Start a session. Throws if one is already open or the routine is archived. */
export async function startSession(routineId: string | null, now = new Date()): Promise<string> {
  return db.transaction('rw', db.sessions, db.cycles, db.routines, async () => {
    if (await getOpenSession()) throw new Error('A session is already open.')
    if (routineId) {
      const routine = await db.routines.get(routineId)
      if (!routine || routine.archived) throw new Error('This routine cannot be started.')
    }
    const cycle = await getActiveCycle()
    const id = crypto.randomUUID()
    await db.sessions.add({
      id,
      startedAt: now.toISOString(),
      finishedAt: null,
      routineId,
      cycleId: cycle?.id ?? null,
      extraExerciseIds: [],
    })
    return id
  })
}

/** Delete a session and its logs. */
export async function discardSession(id: string): Promise<void> {
  await db.transaction('rw', db.sessions, db.logs, async () => {
    await db.logs.where('sessionId').equals(id).delete()
    await db.sessions.delete(id)
  })
}

/** Add an exercise that is not in the routine to an open session. */
export async function addExerciseToSession(sessionId: string, exerciseId: string): Promise<void> {
  await db.transaction('rw', db.sessions, db.exercises, async () => {
    const exercise = await db.exercises.get(exerciseId)
    if (!exercise || exercise.archived) throw new Error('This exercise cannot be added.')
    const session = await db.sessions.get(sessionId)
    if (!session || session.finishedAt) throw new Error('The session is not open.')
    const extra = session.extraExerciseIds ?? []
    if (!extra.includes(exerciseId)) await db.sessions.update(sessionId, { extraExerciseIds: [...extra, exerciseId] })
  })
}

/** Create or update the one log of an exercise in a session. Returns the log id. */
export async function saveLog(
  sessionId: string,
  exerciseId: string,
  values: LogValues,
  now = new Date(),
): Promise<string> {
  return db.transaction('rw', db.logs, async () => {
    const existing = await getSessionLog(sessionId, exerciseId)
    const log: Log = {
      id: existing?.id ?? crypto.randomUUID(),
      sessionId,
      exerciseId,
      sets: values.sets,
      repsOrSeconds: values.repsOrSeconds,
      remarks: values.remarks,
      loggedAt: existing?.loggedAt ?? now.toISOString(),
    }
    if (values.weight != null) log.weight = values.weight
    await db.logs.put(log)
    return log.id
  })
}

/** Set finishedAt and return the end-screen message. */
export async function finishSession(id: string, now = new Date()): Promise<string> {
  const session = await db.sessions.get(id)
  if (!session) throw new Error('Session not found.')
  if (!session.finishedAt) await db.sessions.update(id, { finishedAt: now.toISOString() })

  const [routine, logs, exercises, next] = await Promise.all([
    session.routineId ? db.routines.get(session.routineId) : undefined,
    db.logs.where('sessionId').equals(id).toArray(),
    db.exercises.toArray(),
    getSuggestedRoutine(),
  ])
  const complete = isRoutineComplete(routine, logs, new Map(exercises.map((e) => [e.id, e])))
  return finishMessage(complete, next?.name)
}
