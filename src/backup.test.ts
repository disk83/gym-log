import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BACKUP_VERSION,
  backupFile,
  backupFileName,
  backupReminderDue,
  importBackup,
  parseBackup,
  readAllTables,
  tableCounts,
  validateBackup,
  type Backup,
  type BackupTables,
} from './backup'
import { createCycle, createExercise, createRoutine, setExerciseArchived, type ExerciseInput } from './data'
import { db } from './db'
import { updateSession } from './history'
import { addExerciseToSession, finishSession, saveLog, startSession } from './session'

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

/** A bit of everything: archived items, a free session, an open session, optional fields set and unset. */
async function seed() {
  const a = await createExercise(bench)
  const b = await createExercise({ ...bench, name: 'Plank', machine: undefined, defaultWeight: undefined, type: 'timed', loadType: 'bodyweight' })
  const c = await createExercise({ ...bench, name: 'Curl', loadType: 'per_dumbbell' })
  const r = await createRoutine({ name: 'Push', remarks: 'Monday', exerciseIds: [a, b] })
  await createCycle({ name: 'Main', remarks: '', routineIds: [r] })
  const s1 = await startSession(r, new Date('2026-02-11T09:00:00Z'))
  await saveLog(s1, a, { sets: 4, repsOrSeconds: 8, weight: 72.5, remarks: 'hard' }, new Date('2026-02-11T09:10:00Z'))
  await saveLog(s1, b, { sets: 3, repsOrSeconds: 45, remarks: '' }, new Date('2026-02-11T09:20:00Z'))
  await addExerciseToSession(s1, c)
  await finishSession(s1, new Date('2026-02-11T10:00:00Z'))
  await updateSession(s1, { date: '2026-02-11', remarks: 'Felt good' })
  await setExerciseArchived(c, true)
  const s2 = await startSession(null, new Date('2026-02-12T09:00:00Z'))
  await saveLog(s2, a, { sets: 3, repsOrSeconds: 10, weight: 60, remarks: '' }, new Date('2026-02-12T09:10:00Z'))
  await db.settings.put({ key: 'example', value: { nested: [1, 'two', null] } })
}

const sortById = <T extends { id?: string; key?: string }>(rows: T[]) =>
  rows.slice().sort((x, y) => String(x.id ?? x.key).localeCompare(String(y.id ?? y.key)))

function normalized(tables: BackupTables) {
  return Object.fromEntries(Object.entries(tables).map(([name, rows]) => [name, sortById(rows)]))
}

async function exportedText(): Promise<string> {
  return backupFile(await readAllTables(), new Date('2026-10-16T08:00:00Z')).text()
}

function validBackup(): Backup {
  return {
    app: 'gym-log',
    version: 1,
    exportedAt: '2026-10-16T08:00:00.000Z',
    tables: { exercises: [], routines: [], cycles: [], sessions: [], logs: [], settings: [] },
  }
}

beforeEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(db.tables.map((t) => t.clear()))
})

describe('export and import round trip', () => {
  it('export, wipe, import gives identical data', async () => {
    await seed()
    const before = normalized(await readAllTables())
    const text = await exportedText()

    const parsed = JSON.parse(text)
    expect(parsed.version).toBe(BACKUP_VERSION)
    expect(parsed.exportedAt).toBe('2026-10-16T08:00:00.000Z')
    expect(Object.keys(parsed.tables).sort()).toEqual(['cycles', 'exercises', 'logs', 'routines', 'sessions', 'settings'])

    await Promise.all(db.tables.map((t) => t.clear()))
    expect(await db.logs.count()).toBe(0)

    const result = parseBackup(text)
    if (!result.ok) throw new Error(result.error)
    expect(tableCounts(result.backup.tables)).toEqual({ exercises: 3, routines: 1, cycles: 1, sessions: 2, logs: 3, settings: 1 })
    await importBackup(result.backup)

    expect(normalized(await readAllTables())).toEqual(before)
  })

  it('import replaces existing data instead of merging', async () => {
    await seed()
    const text = await exportedText()
    await Promise.all(db.tables.map((t) => t.clear()))
    await createExercise({ ...bench, name: 'Something new' })

    const result = parseBackup(text)
    if (!result.ok) throw new Error(result.error)
    await importBackup(result.backup)
    const names = (await db.exercises.toArray()).map((e) => e.name).sort()
    expect(names).toEqual(['Bench press', 'Curl', 'Plank'])
  })

  it('names the file after the local export date', () => {
    expect(backupFileName(new Date(2026, 9, 6, 23, 30))).toBe('gym-backup-2026-10-06.json')
  })
})

describe('rejecting invalid files', () => {
  const reject = (data: unknown) => {
    const result = typeof data === 'string' ? parseBackup(data) : validateBackup(data)
    expect(result.ok).toBe(false)
    return result.ok ? '' : result.error
  }

  it('accepts a valid empty backup', () => {
    expect(validateBackup(validBackup()).ok).toBe(true)
  })

  it('rejects text that is not JSON', () => {
    expect(reject('{"app": "gym-log",')).toMatch(/not valid JSON/)
  })

  it('rejects JSON that is not a Gym Log backup', () => {
    expect(reject([])).toMatch(/not a Gym Log backup/)
    expect(reject({ ...validBackup(), app: 'other' })).toMatch(/not a Gym Log backup/)
  })

  it('rejects an unknown or missing version', () => {
    expect(reject({ ...validBackup(), version: 2 })).toMatch(/format version 2.*does not know/)
    expect(reject({ ...validBackup(), version: '1' })).toMatch(/format version "1"/)
    const { version: _, ...noVersion } = validBackup()
    expect(reject(noVersion)).toMatch(/format version undefined/)
  })

  it('rejects a missing table', () => {
    const b = validBackup() as unknown as { tables: Record<string, unknown> }
    delete b.tables.logs
    expect(reject(b)).toMatch(/missing the "logs" table/)
  })

  it('rejects missing or wrongly typed fields', () => {
    const b = validBackup()
    b.tables.logs = [{ id: 'l1', sessionId: 's1', exerciseId: 'e1', sets: '3', repsOrSeconds: 10, remarks: '', loggedAt: '' }] as never
    expect(reject(b)).toMatch(/logs, row 1: "sets" must be a number/)

    const c = validBackup()
    c.tables.exercises = [{ id: 'e1', name: 'X', remarks: '', type: 'cardio', loadType: 'total', defaultSets: 3, defaultReps: 10, archived: false }] as never
    expect(reject(c)).toMatch(/"type" must be one of "strength", "timed"/)

    const d = validBackup()
    d.tables.sessions = [{ id: 's1', startedAt: '2026-01-01T00:00:00Z', routineId: null, cycleId: null }] as never
    expect(reject(d)).toMatch(/sessions, row 1: missing field "finishedAt"/)
  })

  it('rejects duplicate ids', () => {
    const b = validBackup()
    const routine = { id: 'r1', name: 'A', remarks: '', exerciseIds: [], archived: false }
    b.tables.routines = [routine, { ...routine, name: 'B' }]
    expect(reject(b)).toMatch(/routines, row 2: duplicate id "r1"/)
  })

  it('an invalid file is rejected without touching the data', async () => {
    await seed()
    const before = normalized(await readAllTables())
    await expect(importBackup({ ...validBackup(), version: 99 } as unknown as Backup)).rejects.toThrow(/version 99/)
    expect(normalized(await readAllTables())).toEqual(before)
  })
})

describe('failed import', () => {
  it('leaves the existing data untouched', async () => {
    await seed()
    const before = normalized(await readAllTables())
    const result = parseBackup(await exportedText())
    if (!result.ok) throw new Error(result.error)
    const replacement = structuredClone(result.backup)
    replacement.tables.exercises[0].name = 'Changed'

    // Fail on the last table, after the others were already cleared and refilled.
    const failing = vi.spyOn(db.table('settings'), 'bulkAdd').mockRejectedValue(new Error('disk full'))
    await expect(importBackup(replacement)).rejects.toThrow('disk full')
    expect(failing).toHaveBeenCalled()

    vi.restoreAllMocks()
    expect(normalized(await readAllTables())).toEqual(before)
  })
})

describe('backup reminder', () => {
  const now = new Date('2026-10-16T12:00:00Z')
  it('is due when no export was ever done', () => {
    expect(backupReminderDue(null, now)).toBe(true)
  })
  it('is not due within 30 days', () => {
    expect(backupReminderDue('2026-09-17T12:00:00Z', now)).toBe(false)
    expect(backupReminderDue('2026-10-16T08:00:00Z', now)).toBe(false)
  })
  it('is due after 30 days', () => {
    expect(backupReminderDue('2026-09-16T11:59:00Z', now)).toBe(true)
  })
})
