import type { Exercise } from '../db'

const LOAD_LABELS: Record<Exercise['loadType'], string> = {
  total: 'total',
  per_dumbbell: 'per dumbbell',
  bodyweight: 'bodyweight',
}

/** e.g. "3 × 10 @ 60 total · Rack 2" or "3 × 45 s · bodyweight". */
export function exerciseSummary(e: Exercise): string {
  const reps = e.type === 'timed' ? `${e.defaultReps} s` : `${e.defaultReps}`
  const load = e.defaultWeight != null ? `@ ${e.defaultWeight} ${LOAD_LABELS[e.loadType]}` : LOAD_LABELS[e.loadType]
  return [`${e.defaultSets} × ${reps} ${load}`, e.machine].filter(Boolean).join(' · ')
}

export function byName<T extends { name: string }>(a: T, b: T): number {
  return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
}

/** Parse a typed number. Accepts a comma as the decimal separator. */
export function parseNumber(text: string): number | undefined {
  const t = text.trim().replace(',', '.')
  if (t === '' || !/^\d+(\.\d+)?$|^\d*\.\d+$/.test(t)) return undefined
  return Number(t)
}
