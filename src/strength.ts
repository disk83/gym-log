import type { Exercise, Log } from './db'

/**
 * Estimated one-rep max (Epley): weight × (1 + reps / 30), rounded to one
 * decimal. A single number that goes up both when the weight goes up (even if
 * reps drop) and when the reps go up at the same weight, so it works as the
 * progress metric for an exercise.
 *
 * Only defined for strength exercises with a positive weight and at least one
 * rep. Timed and bodyweight-only logs return undefined. The formula gets less
 * accurate above ~12 reps, but the value is still computed so trends stay
 * continuous.
 */
export function estimated1RM(
  log: Pick<Log, 'repsOrSeconds' | 'weight'>,
  exercise: Pick<Exercise, 'type'> | undefined,
): number | undefined {
  if (exercise?.type !== 'strength') return undefined
  const { weight, repsOrSeconds: reps } = log
  if (weight == null || !(weight > 0) || !(reps >= 1)) return undefined
  return Math.round(weight * (1 + reps / 30) * 10) / 10
}
