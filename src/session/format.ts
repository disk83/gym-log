import type { Exercise, Log } from '../db'

/** e.g. "Tue 13 Oct 2026". */
export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
}

/** e.g. "10:42". */
export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
}

/** e.g. "3 × 10 @ 60", "3 × 10 @ 20 per dumbbell", "3 × 45 s". */
export function formatLogValues(log: Pick<Log, 'sets' | 'repsOrSeconds' | 'weight'>, exercise?: Exercise): string {
  const reps = exercise?.type === 'timed' ? `${log.repsOrSeconds} s` : `${log.repsOrSeconds}`
  const perDumbbell = exercise?.loadType === 'per_dumbbell' ? ' per dumbbell' : ''
  const weight = log.weight != null ? ` @ ${log.weight}${perDumbbell}` : ''
  return `${log.sets} × ${reps}${weight}`
}
