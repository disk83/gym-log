import { db, type Log, type Session } from './db'
import { discardSession } from './session'

// History browsing and editing (spec section 3, "Editing history"). Nothing
// derived is stored, so "Last time", the prefill and the next-routine
// suggestion follow every edit here on their own.

// ---------- Pure helpers ----------

/** Newest first by start time; ties by id so the order is stable. */
export function sessionsNewestFirst(sessions: readonly Session[]): Session[] {
  return sessions.slice().sort((a, b) => b.startedAt.localeCompare(a.startedAt) || b.id.localeCompare(a.id))
}

/** A session's logs in the order they were logged. */
export function logsInOrder(logs: readonly Log[]): Log[] {
  return logs.slice().sort((a, b) => a.loggedAt.localeCompare(b.loggedAt) || a.id.localeCompare(b.id))
}

/** The local calendar date of an ISO time, as a date input value ("2026-10-16"). */
export function toDateInput(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function parseDateInput(value: string): Date | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!m) return undefined
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return d.getDate() === Number(m[3]) ? d : undefined
}

/** Whole calendar days from the local date of `iso` to the date input value `date`. */
export function daysBetween(iso: string, date: string): number {
  const to = parseDateInput(date)
  if (!to) throw new Error(`Invalid date: ${date}`)
  const from = parseDateInput(toDateInput(iso))!
  // Noon-to-noon avoids off-by-one around daylight saving changes.
  from.setHours(12)
  to.setHours(12)
  return Math.round((to.getTime() - from.getTime()) / 86_400_000)
}

/** Move an ISO time by whole calendar days, keeping its local time of day. */
export function shiftDays(iso: string, days: number): string {
  const d = new Date(iso)
  d.setDate(d.getDate() + days)
  return d.toISOString()
}

// ---------- Writes ----------

export interface SessionEdit {
  /** New local date, as a date input value. */
  date: string
  remarks: string
}

/**
 * Change a session's date and remarks. Changing the date moves the start,
 * the finish and every log of the session by the same number of days, so
 * times of day and the log order stay as they were.
 */
export async function updateSession(id: string, edit: SessionEdit): Promise<void> {
  await db.transaction('rw', db.sessions, db.logs, async () => {
    const session = await db.sessions.get(id)
    if (!session) throw new Error('Session not found.')
    const days = daysBetween(session.startedAt, edit.date)
    const remarks = edit.remarks.trim()
    const next: Session = { ...session, startedAt: shiftDays(session.startedAt, days), remarks }
    if (session.finishedAt) next.finishedAt = shiftDays(session.finishedAt, days)
    if (!remarks) delete next.remarks
    await db.sessions.put(next)
    if (days !== 0) {
      await db.logs
        .where('sessionId')
        .equals(id)
        .modify((l) => {
          l.loggedAt = shiftDays(l.loggedAt, days)
        })
    }
  })
}

export async function deleteLog(id: string): Promise<void> {
  await db.logs.delete(id)
}

/** Delete a session and all of its logs. */
export const deleteSession = discardSession
