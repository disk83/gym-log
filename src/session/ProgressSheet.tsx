import { useEffect, useState } from 'react'
import { db, type Exercise } from '../db'
import { labelIndices, loadProgress, niceScale, type Progress } from '../progress'
import { formatDate, formatLogValues, formatShortDate } from './format'
import { formatValue, trendText, UNIT_LABELS } from './ProgressChart'

// The full progress chart for one exercise: a full-screen sheet with labelled
// axes, a value on every point, the best session ringed, a readout for the
// selected session, and the session list below.

// SVG drawing space; the SVG scales to the screen width.
const W = 360
const H = 260
const M = { left: 46, right: 14, top: 22, bottom: 38 }
const PAD_X = 12
/** With more points than this, only the selected, best and latest ones get a value label. */
const LABEL_ALL_UP_TO = 12

const RANGES = [
  { id: '10', label: 'Last 10', count: 10 },
  { id: '30', label: 'Last 30', count: 30 },
  { id: 'all', label: 'All', count: Infinity },
] as const
type RangeId = (typeof RANGES)[number]['id']

function yTitle(exercise: Exercise, progress: Progress): string {
  const base = UNIT_LABELS[progress.unit]
  return exercise.loadType === 'per_dumbbell' && progress.unit === '1RM' ? `${base} (per dumbbell)` : base
}

/**
 * Which points get their value written next to them: all of them when there
 * are few, otherwise the selected, best and latest, skipping one that would
 * sit right beside a more important one.
 */
function valueLabelIndices(count: number, selected: number, best: number): Set<number> {
  if (count <= LABEL_ALL_UP_TO) return new Set(Array.from({ length: count }, (_, i) => i))
  const picked: number[] = []
  for (const i of [selected, best, count - 1]) {
    if (picked.every((j) => Math.abs(i - j) > 1)) picked.push(i)
  }
  return new Set(picked)
}

export function FullChart({
  exercise,
  progress,
  count,
  selected,
  onSelect,
}: {
  exercise: Exercise
  progress: Progress
  /** How many of the latest sessions to draw. */
  count: number
  /** Index within the drawn sessions. */
  selected: number
  onSelect: (index: number) => void
}) {
  const shown = progress.points.slice(-count)
  const values = shown.map((p) => p.value)
  const scale = niceScale(Math.min(...values), Math.max(...values), 5, progress.unit !== '1RM')
  const innerW = W - M.left - M.right
  const innerH = H - M.top - M.bottom
  const x = (i: number) => M.left + PAD_X + (i / (shown.length - 1)) * (innerW - 2 * PAD_X)
  const y = (v: number) => M.top + (1 - (v - scale.min) / (scale.max - scale.min)) * innerH

  const best = Math.max(...values)
  const bestIndex = values.lastIndexOf(best)
  const lastIndex = shown.length - 1
  const withYear = new Date(shown[0].date).getFullYear() !== new Date(shown[lastIndex].date).getFullYear()
  const labelled = valueLabelIndices(shown.length, selected, bestIndex)
  const path = shown.map((p, i) => `${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ')

  return (
    <svg className="pchart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${yTitle(exercise, progress)} by session`}>
      <text className="pchart-axis-title" x={M.left} y={12}>
        {yTitle(exercise, progress)}
      </text>

      {scale.ticks.map((t) => (
        <g key={t}>
          <line className="pchart-grid" x1={M.left} x2={W - M.right} y1={y(t)} y2={y(t)} />
          <text className="pchart-tick" x={M.left - 6} y={y(t)} textAnchor="end" dominantBaseline="middle">
            {formatValue(t)}
          </text>
        </g>
      ))}
      <line className="pchart-axis" x1={M.left} x2={M.left} y1={M.top} y2={H - M.bottom} />
      <line className="pchart-axis" x1={M.left} x2={W - M.right} y1={H - M.bottom} y2={H - M.bottom} />

      {labelIndices(shown.length).map((i) => (
        <text key={i} className="pchart-tick" x={x(i)} y={H - M.bottom + 16} textAnchor="middle">
          {formatShortDate(shown[i].date, withYear)}
        </text>
      ))}
      <text className="pchart-axis-title" x={M.left + innerW / 2} y={H - 4} textAnchor="middle">
        Session date
      </text>

      <polyline className="pchart-line" points={path} />
      {shown.map((p, i) => (
        <g key={p.date + i}>
          {i === bestIndex && <circle className="pchart-best" cx={x(i)} cy={y(p.value)} r="8" />}
          <circle
            className={i === selected ? 'pchart-dot pchart-dot-selected' : 'pchart-dot'}
            cx={x(i)}
            cy={y(p.value)}
            r={i === selected ? 5 : 3.5}
          />
          {labelled.has(i) && (
            <text className="pchart-value" x={x(i)} y={y(p.value) - (i === bestIndex ? 13 : 9)} textAnchor="middle">
              {formatValue(p.value)}
            </text>
          )}
          {/* Bigger invisible target so a finger can hit the point. */}
          <circle
            className="pchart-hit"
            cx={x(i)}
            cy={y(p.value)}
            r="16"
            onClick={() => onSelect(i)}
            role="button"
            aria-label={`${formatShortDate(p.date, true)}: ${formatValue(p.value)}`}
          />
        </g>
      ))}
    </svg>
  )
}

export function ProgressSheet({
  exerciseId,
  upTo,
  onClose,
}: {
  exerciseId: string
  /** Only sessions that started on or before this ISO date count (omit for all). */
  upTo?: string
  onClose: () => void
}) {
  const [data, setData] = useState<{ exercise: Exercise; progress: Progress | undefined } | null | undefined>(undefined)
  const [range, setRange] = useState<RangeId>('all')
  const [picked, setPicked] = useState<number | undefined>(undefined)

  useEffect(() => {
    void (async () => {
      const exercise = await db.exercises.get(exerciseId)
      if (!exercise) return setData(null)
      setData({ exercise, progress: await loadProgress(exercise, upTo ? { startedAt: upTo } : undefined) })
    })()
  }, [exerciseId, upTo])

  const progress = data?.progress
  const count = RANGES.find((r) => r.id === range)!.count
  const shown = progress ? progress.points.slice(-count) : []
  const selected = Math.min(picked ?? shown.length - 1, shown.length - 1)
  const point = shown[selected]
  // The previous session may be just outside the drawn range.
  const offset = progress ? progress.points.length - shown.length : 0
  const previous = progress && selected + offset > 0 ? progress.points[selected + offset - 1] : undefined
  const change = point && previous ? Math.round((point.value - previous.value) * 10) / 10 : undefined
  const verdict = progress ? trendText(progress.trend.kind, progress.trend.sessionsSinceBest) : undefined

  return (
    <div className="sheet" role="dialog" aria-modal="true" aria-label="Progress">
      <div className="sheet-header">
        <h2>{data ? data.exercise.name : 'Progress'}</h2>
        <button type="button" className="btn btn-primary" onClick={onClose}>
          Close
        </button>
      </div>
      <div className="sheet-body">
        {data === null && <p className="muted">This exercise no longer exists.</p>}
        {data && !progress && (
          <p className="muted">Log this exercise in at least 2 sessions to see how it is progressing.</p>
        )}
        {data && progress && point && verdict && (
          <>
            <p className={`pchart-verdict progress-${progress.trend.kind}`}>
              <span className="progress-icon">{verdict.icon}</span> {verdict.text}
            </p>

            {progress.points.length > 10 && (
              <div className="segmented" role="tablist">
                {RANGES.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    role="tab"
                    aria-selected={range === r.id}
                    className={range === r.id ? 'seg on' : 'seg'}
                    onClick={() => {
                      setRange(r.id)
                      setPicked(undefined)
                    }}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
            )}

            <FullChart exercise={data.exercise} progress={progress} count={count} selected={selected} onSelect={setPicked} />
            <p className="muted pchart-legend">Tap a point for details. The ringed point is the best session.</p>

            <section className="card pchart-readout">
              <span className="card-label">{formatDate(point.date)}</span>
              <span className="card-title">{formatLogValues(point, data.exercise)}</span>
              <span>
                {UNIT_LABELS[progress.unit]} {formatValue(point.value)}
                {change != null && (
                  <span className={change > 0 ? 'pchart-up' : change < 0 ? 'pchart-down' : 'muted'}>
                    {' '}
                    ({change > 0 ? '+' : ''}
                    {formatValue(change)} vs previous)
                  </span>
                )}
              </span>
              <div className="pchart-step">
                <button type="button" className="btn btn-small" disabled={selected === 0} onClick={() => setPicked(selected - 1)}>
                  ‹ Earlier
                </button>
                <button
                  type="button"
                  className="btn btn-small"
                  disabled={selected === shown.length - 1}
                  onClick={() => setPicked(selected + 1)}
                >
                  Later ›
                </button>
              </div>
            </section>

            <h3 className="pchart-list-title">Sessions</h3>
            <ul className="rows pchart-list">
              {shown
                .map((p, i) => ({ p, i }))
                .reverse()
                .map(({ p, i }) => (
                  <li key={p.date + i}>
                    <button
                      type="button"
                      className={i === selected ? 'row pchart-row-selected' : 'row'}
                      onClick={() => setPicked(i)}
                    >
                      <span className="row-text">
                        <span className="row-title">{formatDate(p.date)}</span>
                        <span className="row-sub">{formatLogValues(p, data.exercise)}</span>
                      </span>
                      <span className="pchart-row-value">{formatValue(p.value)}</span>
                    </button>
                  </li>
                ))}
            </ul>
          </>
        )}
      </div>
    </div>
  )
}
