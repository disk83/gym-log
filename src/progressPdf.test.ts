import { describe, expect, it } from 'vitest'
import type { Exercise, Log, Session } from './db'
import { coverPageCount, PDF_MIME, progressReportFile, renderProgressPdf, summaryTiles } from './progressPdf'
import { buildProgressReport, type ProgressReport } from './progressReport'

const exercise = (id: string, overrides: Partial<Exercise> = {}): Exercise => ({
  id,
  name: id,
  remarks: '',
  type: 'strength',
  loadType: 'total',
  defaultSets: 3,
  defaultReps: 10,
  archived: false,
  ...overrides,
})
const session = (id: string, day: string): Session => ({
  id,
  startedAt: `${day}T12:00:00.000Z`,
  finishedAt: `${day}T13:00:00.000Z`,
  routineId: null,
  cycleId: null,
})
let counter = 0
const log = (sessionId: string, exerciseId: string, reps: number, weight?: number): Log => ({
  id: `l${++counter}`,
  sessionId,
  exerciseId,
  sets: 3,
  repsOrSeconds: reps,
  ...(weight != null ? { weight } : {}),
  remarks: '',
  loggedAt: `2026-01-01T00:00:00.${String(counter).padStart(3, '0')}Z`,
})

const sessions = [session('s1', '2026-10-01'), session('s2', '2026-10-08'), session('s3', '2026-10-15')]
const exercises = [
  exercise('bench', { remarks: 'Keep the elbows tucked', machine: 'Rack 2' }),
  exercise('plank', { type: 'timed', loadType: 'bodyweight' }),
  exercise('curl', { name: 'Curl é ñ – "quotes" 漢字', loadType: 'per_dumbbell' }),
  exercise('nowt'),
]
const logs = [
  log('s1', 'bench', 10, 60),
  log('s2', 'bench', 10, 65),
  log('s3', 'bench', 8, 70),
  log('s1', 'plank', 30),
  log('s3', 'plank', 45),
  log('s2', 'curl', 10, 12),
  log('s3', 'nowt', 10), // weighted exercise without a weight: nothing to plot
]
const report = (): ProgressReport =>
  buildProgressReport({ sessions, logs, exercises, routines: [], cycles: [] }, '2026-10-01', '2026-10-31', new Date('2026-11-17T08:30:00Z'))

const text = (bytes: Uint8Array) => new TextDecoder('latin1').decode(bytes)

describe('coverPageCount', () => {
  it('spills the index onto more pages only when it is long', () => {
    expect(coverPageCount(0)).toBe(1)
    expect(coverPageCount(28)).toBe(1)
    expect(coverPageCount(29)).toBe(2)
    expect(coverPageCount(28 + 37)).toBe(2)
    expect(coverPageCount(28 + 37 + 1)).toBe(3)
  })
})

describe('summaryTiles', () => {
  const page = (id: string) => report().pages.find((p) => p.exercise.id === id)!

  it('shows weights, the best estimated 1RM and its change for a weighted exercise', () => {
    const tiles = summaryTiles(page('bench'))
    expect(tiles).toHaveLength(6)
    expect(tiles[0]).toMatchObject({ label: 'Sessions', value: '3' })
    expect(tiles[1]).toEqual({ label: 'Weight, first to latest', value: '60 to 70', sub: '+10' })
    expect(tiles[2]).toEqual({ label: 'Best weight', value: '70' })
    expect(tiles[3]).toEqual({ label: 'Best est. 1RM', value: '88.7' })
    expect(tiles[4]).toMatchObject({ label: 'Latest est. 1RM', value: '88.7' })
    expect(tiles[5]).toEqual({ label: 'Change in est. 1RM', value: '+8.7 (+11%)', sub: 'from 80' })
  })

  it('shows the first and latest session instead of weights for a timed exercise', () => {
    const tiles = summaryTiles(page('plank'))
    expect(tiles[1]).toMatchObject({ label: 'First session', value: '3 × 30 s' })
    expect(tiles[2]).toMatchObject({ label: 'Latest session', value: '3 × 45 s' })
    expect(tiles[3]).toEqual({ label: 'Best seconds', value: '45' })
    expect(tiles[5]).toEqual({ label: 'Change in seconds', value: '+15 (+50%)', sub: 'from 30' })
  })

  it('needs two sessions for a change, and shows dashes when nothing was plotted', () => {
    const single = summaryTiles(page('curl'))
    expect(single[0].sub).toBe('8 Oct 26')
    expect(single[5]).toEqual({ label: 'Change in est. 1RM', value: '-', sub: 'Needs 2 sessions' })
    const none = summaryTiles(page('nowt'))
    expect(none[3]).toEqual({ label: 'Best est. 1RM', value: '-' })
    expect(none[4]).toMatchObject({ value: '-', sub: undefined })
  })
})

describe('renderProgressPdf', () => {
  it('writes a cover plus one page per exercise, reporting progress', async () => {
    const progress: [number, number][] = []
    const bytes = await renderProgressPdf(report(), (done, total) => progress.push([done, total]))
    const out = text(bytes)
    expect(out.startsWith('%PDF-1.4')).toBe(true)
    expect(out.match(/\/Type \/Page /g)).toHaveLength(5) // cover + bench, plank, curl, nowt
    expect(progress).toEqual([[1, 5], [2, 5], [3, 5], [4, 5], [5, 5]])
  })

  it('handles an empty report, a long index and odd characters', async () => {
    const empty = buildProgressReport({ sessions: [], logs: [], exercises: [], routines: [], cycles: [] }, '2026-10-01', '2026-10-31')
    expect(text(await renderProgressPdf(empty)).match(/\/Type \/Page /g)).toHaveLength(1)

    const many = Array.from({ length: 40 }, (_, i) => exercise(`e${i}`))
    const big = buildProgressReport(
      { sessions, logs: many.flatMap((e) => [log('s1', e.id, 10, 50), log('s3', e.id, 10, 55)]), exercises: many, routines: [], cycles: [] },
      '2026-10-01',
      '2026-10-31',
    )
    expect(text(await renderProgressPdf(big)).match(/\/Type \/Page /g)).toHaveLength(2 + 40)
  })

  it('makes a named PDF file', async () => {
    const file = await progressReportFile(report())
    expect(file.name).toBe('gym-progress-2026-10-01_to_2026-10-31.pdf')
    expect(file.type).toBe(PDF_MIME)
    expect(file.size).toBeGreaterThan(1000)
  })
})
