import { sparkPoints, WINDOW, type Progress, type ProgressUnit, type TrendKind } from '../progress'

const WIDTH = 112
const HEIGHT = 36

const UNIT_LABELS: Record<ProgressUnit, string> = { '1RM': 'Est. 1RM', reps: 'Reps', s: 'Seconds' }

function trendText(kind: TrendKind, sessionsSinceBest: number): { icon: string; text: string } {
  switch (kind) {
    case 'up':
      return { icon: '▲', text: 'Trending up' }
    case 'down':
      return { icon: '▼', text: 'Trending down' }
    case 'flat':
      return { icon: '▬', text: 'Holding steady' }
    case 'stalled':
      return { icon: '●', text: `No new best in ${sessionsSinceBest} sessions` }
  }
}

/** 82 → "82", 82.35 → "82.4". */
function formatValue(value: number): string {
  return String(Math.round(value * 10) / 10)
}

/**
 * A small reference for the log screen: a sparkline of the last sessions and
 * a one-line verdict. Not interactive, it only has to say up, down or stuck.
 */
export function ProgressChart({ progress }: { progress: Progress }) {
  const { values, unit, trend } = progress
  const shown = values.slice(-WINDOW)
  const points = sparkPoints(values, WIDTH, HEIGHT)
  const last = points[points.length - 1]
  const { icon, text } = trendText(trend.kind, trend.sessionsSinceBest)
  const label = `${UNIT_LABELS[unit]}, last ${shown.length} sessions: ${shown.map(formatValue).join(', ')}. ${text}.`

  return (
    <section className={`progress progress-${trend.kind}`} aria-label={label}>
      <svg className="progress-spark" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} width={WIDTH} height={HEIGHT} aria-hidden="true">
        <polyline className="progress-line" points={points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')} />
        <circle className="progress-dot" cx={last.x} cy={last.y} r="3.5" />
      </svg>
      <div className="progress-text" aria-hidden="true">
        <span className="progress-verdict">
          <span className="progress-icon">{icon}</span> {text}
        </span>
        <span className="muted progress-sub">
          {UNIT_LABELS[unit]} {formatValue(shown[shown.length - 1])} · last {shown.length} sessions
        </span>
      </div>
    </section>
  )
}
