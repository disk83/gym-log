import { describe, expect, it } from 'vitest'
import { estimated1RM } from './strength'

const strength = { type: 'strength' } as const

describe('estimated1RM (Epley)', () => {
  it('goes up when the weight goes up, even if reps drop', () => {
    expect(estimated1RM({ weight: 60, repsOrSeconds: 10 }, strength)).toBe(80)
    expect(estimated1RM({ weight: 65, repsOrSeconds: 8 }, strength)).toBe(82.3)
  })

  it('goes up when reps go up at the same weight', () => {
    expect(estimated1RM({ weight: 60, repsOrSeconds: 12 }, strength)).toBe(84)
  })

  it('rounds to one decimal', () => {
    expect(estimated1RM({ weight: 72.5, repsOrSeconds: 8 }, strength)).toBe(91.8)
  })

  it('is undefined without a weight, with zero weight or without reps', () => {
    expect(estimated1RM({ repsOrSeconds: 10 }, strength)).toBeUndefined()
    expect(estimated1RM({ weight: 0, repsOrSeconds: 10 }, strength)).toBeUndefined()
    expect(estimated1RM({ weight: 60, repsOrSeconds: 0 }, strength)).toBeUndefined()
  })

  it('is undefined for timed exercises and for unknown (deleted) exercises', () => {
    expect(estimated1RM({ weight: 10, repsOrSeconds: 45 }, { type: 'timed' })).toBeUndefined()
    expect(estimated1RM({ weight: 60, repsOrSeconds: 10 }, undefined)).toBeUndefined()
  })
})
