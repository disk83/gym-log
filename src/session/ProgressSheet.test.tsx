// Dates are labelled in local time; pin a zone so the expected labels are stable.
declare const process: { env: Record<string, string | undefined> }
process.env.TZ = 'Europe/Madrid'

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { Exercise } from '../db'
import { buildProgress } from '../progress'
import { FullChart } from './ProgressSheet'

const bench: Exercise = {
  id: 'ex',
  name: 'Bench press',
  remarks: '',
  type: 'strength',
  loadType: 'total',
  defaultSets: 3,
  defaultReps: 10,
  archived: false,
}

function progressFor(weights: number[], exercise: Exercise = bench) {
  const sessions = new Map(
    weights.map((_, i) => {
      const startedAt = new Date(Date.UTC(2026, 1, 1 + i * 7, 10)).toISOString()
      return [`s${i}`, { id: `s${i}`, startedAt, finishedAt: null, routineId: null, cycleId: null }]
    }),
  )
  const logs = weights.map((weight, i) => ({
    id: `l${i}`,
    sessionId: `s${i}`,
    exerciseId: exercise.id,
    sets: 3,
    repsOrSeconds: 10,
    weight,
    remarks: '',
    loggedAt: new Date(Date.UTC(2026, 1, 1 + i * 7, 10, 10)).toISOString(),
  }))
  const progress = buildProgress(logs, sessions, exercise)
  if (!progress) throw new Error('no progress')
  return progress
}

describe('FullChart', () => {
  it('marks both axes, every value and the dates', () => {
    const progress = progressFor([60, 62.5, 65])
    const html = renderToStaticMarkup(
      <FullChart exercise={bench} progress={progress} count={Infinity} selected={2} onSelect={() => {}} />,
    )
    expect(html).toContain('Est. 1RM')
    expect(html).toContain('Session date')
    // 1RM = weight × (1 + 10/30): 80, 83.3, 86.7.
    for (const value of ['80', '83.3', '86.7']) expect(html).toContain(`>${value}<`)
    expect(html).toContain('1 Feb')
    expect(html).toContain('15 Feb')
  })

  it('draws a ring on the best session and a tap target on every point', () => {
    const progress = progressFor([60, 70, 65, 62.5])
    const html = renderToStaticMarkup(
      <FullChart exercise={bench} progress={progress} count={Infinity} selected={3} onSelect={() => {}} />,
    )
    expect(html.match(/pchart-best/g)).toHaveLength(1)
    expect(html.match(/pchart-hit/g)).toHaveLength(4)
  })

  it('only labels the selected, best and latest points when there are many sessions', () => {
    const progress = progressFor(Array.from({ length: 20 }, (_, i) => 60 + (i % 5)))
    const html = renderToStaticMarkup(
      <FullChart exercise={bench} progress={progress} count={Infinity} selected={10} onSelect={() => {}} />,
    )
    expect(html.match(/pchart-value/g)!.length).toBeLessThanOrEqual(3)
  })

  it('does not write the best and latest values on top of each other when they are neighbours', () => {
    const weights = Array.from({ length: 20 }, () => 60)
    weights[18] = 70
    weights[19] = 65
    const html = renderToStaticMarkup(
      <FullChart exercise={bench} progress={progressFor(weights)} count={Infinity} selected={10} onSelect={() => {}} />,
    )
    // Selected (80), best (93.3); the latest (86.7) is right next to the best, so it is left out.
    expect(html.match(/pchart-value/g)).toHaveLength(2)
    expect(html).toContain('>93.3<')
    expect(html).not.toContain('>86.7<')
  })

  it('titles the y axis per dumbbell for dumbbell exercises', () => {
    const curl = { ...bench, id: 'curl', loadType: 'per_dumbbell' as const }
    const dumbbell = renderToStaticMarkup(
      <FullChart exercise={curl} progress={progressFor([10, 12], curl)} count={Infinity} selected={1} onSelect={() => {}} />,
    )
    expect(dumbbell).toContain('Est. 1RM (per dumbbell)')
  })
})
