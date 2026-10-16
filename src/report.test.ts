// Run these in a zone with daylight saving and a non-zero offset, so local
// dates differ from UTC dates.
declare const process: { env: Record<string, string | undefined> }
process.env.TZ = 'America/New_York'

import 'fake-indexeddb/auto'
import { strFromU8, unzipSync } from 'fflate'
import { beforeEach, describe, expect, it } from 'vitest'
import { createExercise, createRoutine, setExerciseArchived, type ExerciseInput } from './data'
import { db, type Session } from './db'
import {
  buildReport,
  defaultRange,
  loadReport,
  previewText,
  rangeBounds,
  reportCells,
  reportFile,
  reportFileName,
  sessionsInRange,
} from './report'
import { finishSession, saveLog, startSession } from './session'
import { excelDate } from './xlsx'

const session = (id: string, startedAt: string): Session => ({
  id,
  startedAt: new Date(startedAt).toISOString(),
  finishedAt: null,
  routineId: null,
  cycleId: null,
})

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()))
})

describe('date range filter', () => {
  it('runs in the expected time zone', () => {
    expect(new Date(2026, 0, 15).getTimezoneOffset()).toBe(300)
  })

  it('includes both ends and excludes sessions just outside, in local time', () => {
    const sessions = [
      session('before', '2026-02-09T23:59:59.999-05:00'),
      session('first', '2026-02-10T00:00:00-05:00'),
      session('middle', '2026-02-15T12:00:00-05:00'),
      session('last', '2026-02-20T23:59:59.999-05:00'),
      session('after', '2026-02-21T00:00:00-05:00'),
    ]
    expect(sessionsInRange(sessions, '2026-02-10', '2026-02-20').map((s) => s.id)).toEqual(['first', 'middle', 'last'])
  })

  it('uses the local date, not the UTC date', () => {
    // 23:30 on 28 Feb in New York is already 1 March in UTC.
    const late = session('late', '2026-03-01T04:30:00Z')
    expect(sessionsInRange([late], '2026-02-01', '2026-02-28')).toHaveLength(1)
    expect(sessionsInRange([late], '2026-03-01', '2026-03-31')).toHaveLength(0)
  })

  it('handles a range ending on a daylight saving change', () => {
    // Clocks go forward on 8 March 2026 in New York.
    const sessions = [session('dst', '2026-03-08T23:30:00-04:00'), session('next', '2026-03-09T00:00:00-04:00')]
    expect(sessionsInRange(sessions, '2026-03-08', '2026-03-08').map((s) => s.id)).toEqual(['dst'])
  })

  it('a single day range covers exactly that day', () => {
    const [from, to] = rangeBounds('2026-02-10', '2026-02-10')
    expect(new Date(from).toISOString()).toBe('2026-02-10T05:00:00.000Z')
    expect(new Date(to).toISOString()).toBe('2026-02-11T05:00:00.000Z')
  })

  it('rejects a start after the end and invalid dates', () => {
    expect(() => rangeBounds('2026-02-11', '2026-02-10')).toThrow(/on or before/)
    expect(() => rangeBounds('2026-02-30', '2026-03-01')).toThrow(/valid/)
    expect(() => rangeBounds('', '2026-03-01')).toThrow(/valid/)
  })

  it('defaults to the last 30 days, today included', () => {
    expect(defaultRange(new Date('2026-10-16T10:00:00-04:00'))).toEqual({ start: '2026-09-17', end: '2026-10-16' })
    // Late evening local time, already the next day in UTC.
    expect(defaultRange(new Date('2026-10-16T23:00:00-04:00'))).toEqual({ start: '2026-09-17', end: '2026-10-16' })
  })
})

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

describe('report rows', () => {
  it('sorts by session date, then by the order the logs were made', async () => {
    const a = await createExercise(bench)
    const b = await createExercise({ ...bench, name: 'Plank', machine: undefined, type: 'timed', loadType: 'bodyweight' })
    const c = await createExercise({ ...bench, name: 'Curl', machine: undefined, loadType: 'per_dumbbell' })
    const routine = await createRoutine({ name: 'Push', remarks: '', exerciseIds: [a, b] })

    // Insert the later session first, so table order is not date order.
    const s2 = await startSession(null, new Date('2026-02-12T18:00:00-05:00'))
    await saveLog(s2, c, { sets: 3, repsOrSeconds: 12, weight: 12, remarks: 'easy' }, new Date('2026-02-12T18:05:00-05:00'))
    await finishSession(s2, new Date('2026-02-12T19:00:00-05:00'))

    const s1 = await startSession(routine, new Date('2026-02-11T09:00:00-05:00'))
    await saveLog(s1, b, { sets: 3, repsOrSeconds: 45, remarks: '' }, new Date('2026-02-11T09:20:00-05:00'))
    await saveLog(s1, a, { sets: 4, repsOrSeconds: 8, weight: 70, remarks: 'hard' }, new Date('2026-02-11T09:10:00-05:00'))
    await finishSession(s1, new Date('2026-02-11T10:00:00-05:00'))

    // Outside the range, and an empty session inside it.
    const old = await startSession(null, new Date('2026-02-01T09:00:00-05:00'))
    await saveLog(old, a, { sets: 1, repsOrSeconds: 1, weight: 1, remarks: '' }, new Date('2026-02-01T09:05:00-05:00'))
    await finishSession(old, new Date('2026-02-01T10:00:00-05:00'))
    await finishSession(await startSession(null, new Date('2026-02-13T09:00:00-05:00')))

    // Archived exercises still appear.
    await setExerciseArchived(a, true)

    const report = await loadReport('2026-02-10', '2026-02-20')
    expect(previewText(report)).toBe('3 logs in 2 sessions')
    expect(report.rows).toEqual([
      {
        date: '2026-02-11',
        session: 1,
        routine: 'Push',
        exercise: 'Bench press',
        machine: 'Rack 2',
        sets: 4,
        repsOrSeconds: 8,
        weight: 70,
        loadType: 'total',
        remarks: 'hard',
      },
      {
        date: '2026-02-11',
        session: 1,
        routine: 'Push',
        exercise: 'Plank',
        machine: '',
        sets: 3,
        repsOrSeconds: 45,
        loadType: 'bodyweight',
        remarks: '',
      },
      {
        date: '2026-02-12',
        session: 2,
        routine: 'Free session',
        exercise: 'Curl',
        machine: '',
        sets: 3,
        repsOrSeconds: 12,
        weight: 12,
        loadType: 'per dumbbell',
        remarks: 'easy',
      },
    ])
  })

  it('is empty when no session started in the range', () => {
    const report = buildReport({ sessions: [], logs: [], exercises: [], routines: [] }, '2026-02-10', '2026-02-20')
    expect(report).toEqual({ rows: [], sessionCount: 0 })
    expect(previewText(report)).toBe('0 logs in 0 sessions')
  })
})

describe('xlsx file', () => {
  it('names the file after the range', () => {
    expect(reportFileName('2026-09-17', '2026-10-16')).toBe('gym-report-2026-09-17_to_2026-10-16.xlsx')
  })

  it('writes real dates and numbers, a frozen header and column widths', async () => {
    const row = {
      date: '2026-02-11',
      session: 1,
      routine: 'Push & pull',
      exercise: 'Bench <press>',
      machine: 'Rack 2',
      sets: 4,
      repsOrSeconds: 8,
      weight: 72.5,
      loadType: 'total',
      remarks: 'hard',
    }
    expect(excelDate(2026, 2, 11).date).toBe(46064)
    expect(reportCells(row).slice(0, 2)).toEqual([{ date: 46064 }, 1])

    const file = reportFile({ rows: [row], sessionCount: 1 }, '2026-02-10', '2026-02-20')
    expect(file.name).toBe('gym-report-2026-02-10_to_2026-02-20.xlsx')
    const zip = unzipSync(new Uint8Array(await file.arrayBuffer()))
    const sheet = strFromU8(zip['xl/worksheets/sheet1.xml'])
    const strings = strFromU8(zip['xl/sharedStrings.xml'])

    expect(sheet).toContain('<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>')
    expect(sheet).toContain('<col min="10" max="10" width="40" customWidth="1"/>')
    expect(sheet).toContain('<c r="A2" s="2"><v>46064</v></c>')
    expect(sheet).toContain('<c r="B2"><v>1</v></c>')
    expect(sheet).toContain('<c r="F2"><v>4</v></c>')
    expect(sheet).toContain('<c r="G2"><v>8</v></c>')
    expect(sheet).toContain('<c r="H2"><v>72.5</v></c>')
    expect(sheet).toContain('<autoFilter ref="A1:J2"/>')
    expect(strings).toContain('Reps or seconds')
    expect(strings).toContain('Bench &lt;press&gt;')
    expect(strings).toContain('Push &amp; pull')
  })
})
