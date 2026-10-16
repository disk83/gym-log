import { db, type Cycle, type Exercise, type Log, type Routine, type Session, type Setting } from './db'

// JSON backup (spec section 6): every table plus a format version, and a
// validated import that replaces all data in one transaction.

export const BACKUP_APP = 'gym-log'
export const BACKUP_VERSION = 1

export interface BackupTables {
  exercises: Exercise[]
  routines: Routine[]
  cycles: Cycle[]
  sessions: Session[]
  logs: Log[]
  settings: Setting[]
}

export interface Backup {
  app: typeof BACKUP_APP
  version: typeof BACKUP_VERSION
  exportedAt: string
  tables: BackupTables
}

export type TableName = keyof BackupTables

export const TABLE_NAMES: TableName[] = ['exercises', 'routines', 'cycles', 'sessions', 'logs', 'settings']

// ---------- Export ----------

export async function readAllTables(): Promise<BackupTables> {
  return db.transaction('r', db.tables, async () => {
    const [exercises, routines, cycles, sessions, logs, settings] = await Promise.all([
      db.exercises.toArray(),
      db.routines.toArray(),
      db.cycles.toArray(),
      db.sessions.toArray(),
      db.logs.toArray(),
      db.settings.toArray(),
    ])
    return { exercises, routines, cycles, sessions, logs, settings }
  })
}

export function makeBackup(tables: BackupTables, now = new Date()): Backup {
  return { app: BACKUP_APP, version: BACKUP_VERSION, exportedAt: now.toISOString(), tables }
}

export function backupFileName(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `gym-backup-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.json`
}

export function backupFile(tables: BackupTables, now = new Date()): File {
  return new File([JSON.stringify(makeBackup(tables, now), null, 1)], backupFileName(now), { type: 'application/json' })
}

// ---------- Validation ----------

type FieldRule = 'string' | 'number' | 'boolean' | 'string|null' | 'string[]' | 'any' | readonly string[]

interface Fields {
  required: Record<string, FieldRule>
  optional?: Record<string, FieldRule>
}

const SCHEMA: Record<TableName, Fields> = {
  exercises: {
    required: {
      id: 'string',
      name: 'string',
      remarks: 'string',
      type: ['strength', 'timed'],
      loadType: ['total', 'per_dumbbell', 'bodyweight'],
      defaultSets: 'number',
      defaultReps: 'number',
      archived: 'boolean',
    },
    optional: { machine: 'string', defaultWeight: 'number' },
  },
  routines: {
    required: { id: 'string', name: 'string', remarks: 'string', exerciseIds: 'string[]', archived: 'boolean' },
  },
  cycles: {
    required: {
      id: 'string',
      name: 'string',
      remarks: 'string',
      routineIds: 'string[]',
      active: 'boolean',
      archived: 'boolean',
    },
  },
  sessions: {
    required: { id: 'string', startedAt: 'string', finishedAt: 'string|null', routineId: 'string|null', cycleId: 'string|null' },
    optional: { extraExerciseIds: 'string[]', remarks: 'string' },
  },
  logs: {
    required: {
      id: 'string',
      sessionId: 'string',
      exerciseId: 'string',
      sets: 'number',
      repsOrSeconds: 'number',
      remarks: 'string',
      loggedAt: 'string',
    },
    optional: { weight: 'number' },
  },
  settings: { required: { key: 'string', value: 'any' } },
}

function matches(value: unknown, rule: FieldRule): boolean {
  if (Array.isArray(rule)) return typeof value === 'string' && rule.includes(value)
  switch (rule) {
    case 'string':
      return typeof value === 'string'
    case 'number':
      return typeof value === 'number' && Number.isFinite(value)
    case 'boolean':
      return typeof value === 'boolean'
    case 'string|null':
      return value === null || typeof value === 'string'
    case 'string[]':
      return Array.isArray(value) && value.every((v) => typeof v === 'string')
    default:
      return true
  }
}

function describe(rule: FieldRule): string {
  if (Array.isArray(rule)) return `one of ${rule.map((r) => `"${r}"`).join(', ')}`
  return (
    { string: 'text', number: 'a number', boolean: 'true or false', 'string|null': 'text or null', 'string[]': 'a list of text', any: 'present' } as Record<string, string>
  )[rule as string]
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export type ValidationResult = { ok: true; backup: Backup } | { ok: false; error: string }

/** Check a parsed backup file before anything is touched. */
export function validateBackup(data: unknown): ValidationResult {
  const fail = (error: string): ValidationResult => ({ ok: false, error })
  if (!isObject(data) || data.app !== BACKUP_APP) return fail('This is not a Gym Log backup file.')
  if (data.version !== BACKUP_VERSION) {
    return fail(
      `This backup uses format version ${JSON.stringify(data.version)}, which this app does not know (it reads version ${BACKUP_VERSION}). Nothing was changed.`,
    )
  }
  if (typeof data.exportedAt !== 'string' || Number.isNaN(Date.parse(data.exportedAt))) {
    return fail('The backup has no valid export date.')
  }
  if (!isObject(data.tables)) return fail('The backup has no tables.')
  const tables = data.tables

  for (const name of TABLE_NAMES) {
    const rows = tables[name]
    if (!Array.isArray(rows)) return fail(`The backup is missing the "${name}" table.`)
    const { required, optional = {} } = SCHEMA[name]
    const key = name === 'settings' ? 'key' : 'id'
    const seen = new Set<unknown>()
    for (let i = 0; i < rows.length; i++) {
      const row: unknown = rows[i]
      const where = `${name}, row ${i + 1}`
      if (!isObject(row)) return fail(`${where}: not a record.`)
      for (const [field, rule] of Object.entries(required)) {
        if (!(field in row)) return fail(`${where}: missing field "${field}".`)
        if (!matches(row[field], rule)) return fail(`${where}: "${field}" must be ${describe(rule)}.`)
      }
      for (const [field, rule] of Object.entries(optional)) {
        if (row[field] !== undefined && !matches(row[field], rule)) {
          return fail(`${where}: "${field}" must be ${describe(rule)}.`)
        }
      }
      if (seen.has(row[key])) return fail(`${where}: duplicate ${key} "${String(row[key])}".`)
      seen.add(row[key])
    }
  }
  return { ok: true, backup: data as unknown as Backup }
}

/** Parse and validate the text of a backup file. */
export function parseBackup(text: string): ValidationResult {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return { ok: false, error: 'This file is not valid JSON.' }
  }
  return validateBackup(data)
}

export function tableCounts(tables: BackupTables): Record<TableName, number> {
  return Object.fromEntries(TABLE_NAMES.map((n) => [n, tables[n].length])) as Record<TableName, number>
}

// ---------- Import ----------

/**
 * Replace all data with the backup's, in a single transaction: if anything
 * fails, the transaction aborts and the existing data stays as it was.
 */
export async function importBackup(backup: Backup): Promise<void> {
  const check = validateBackup(backup)
  if (!check.ok) throw new Error(check.error)
  await db.transaction('rw', db.tables, async () => {
    for (const name of TABLE_NAMES) {
      const table = db.table(name)
      await table.clear()
      await table.bulkAdd(backup.tables[name])
    }
  })
}

// ---------- Last export reminder ----------

export const LAST_EXPORT_KEY = 'gym-log:lastBackupExport'
const REMIND_AFTER_DAYS = 30

export function getLastExport(): string | null {
  try {
    return localStorage.getItem(LAST_EXPORT_KEY)
  } catch {
    return null
  }
}

export function setLastExport(now = new Date()): void {
  try {
    localStorage.setItem(LAST_EXPORT_KEY, now.toISOString())
  } catch {
    // Storage blocked: the reminder will keep showing.
  }
}

/** True if no export was ever done or the last one is older than 30 days. */
export function backupReminderDue(lastExport: string | null, now = new Date()): boolean {
  if (!lastExport) return true
  const t = Date.parse(lastExport)
  if (Number.isNaN(t)) return true
  return now.getTime() - t > REMIND_AFTER_DAYS * 86_400_000
}
