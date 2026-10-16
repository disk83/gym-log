import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { backupReminderDue, getLastExport } from '../backup'
import { db } from '../db'
import { ExerciseForm } from '../manage/ExerciseForm'
import { byName } from '../manage/format'
import { Field, ScreenHeader } from '../manage/ui'
import {
  addExerciseToSession,
  discardSession,
  getActiveCycle,
  getLastFinishedSession,
  getOpenSession,
  getSuggestedRoutine,
  startSession,
} from '../session'
import { formatDate, formatTime } from './format'
import { LogScreen } from './LogScreen'
import { SessionScreen } from './SessionScreen'

/** Where the Home tab is in the session flow. Not persisted: a relaunch lands on Home. */
export type HomeView =
  | { screen: 'home' }
  | { screen: 'session' }
  | { screen: 'log'; exerciseId: string }
  | { screen: 'new-exercise' }
  | { screen: 'finished'; message: string }

export function HomeTab({ view, setView }: { view: HomeView; setView: (v: HomeView) => void }) {
  const go = (v: HomeView) => {
    setView(v)
    window.scrollTo(0, 0)
  }
  const open = useLiveQuery(async () => ({ session: (await getOpenSession()) ?? null }))
  if (!open) return null
  const session = open.session

  if (view.screen === 'finished') return <Finished message={view.message} onDone={() => go({ screen: 'home' })} />
  if (!session || view.screen === 'home') return <Home onStarted={() => go({ screen: 'session' })} />

  if (view.screen === 'log') {
    return (
      <LogScreen
        key={view.exerciseId}
        sessionId={session.id}
        exerciseId={view.exerciseId}
        onDone={() => go({ screen: 'session' })}
      />
    )
  }
  if (view.screen === 'new-exercise') {
    return (
      <ExerciseForm
        title="New exercise"
        onDone={async (savedId) => {
          if (!savedId) return go({ screen: 'session' })
          await addExerciseToSession(session.id, savedId)
          go({ screen: 'log', exerciseId: savedId })
        }}
      />
    )
  }
  return (
    <SessionScreen
      session={session}
      onHome={() => go({ screen: 'home' })}
      onOpen={(exerciseId) => go({ screen: 'log', exerciseId })}
      onNewExercise={() => go({ screen: 'new-exercise' })}
      onFinished={(message) => go({ screen: 'finished', message })}
    />
  )
}

const FREE = ''

function Home({ onStarted }: { onStarted: () => void }) {
  const data = useLiveQuery(async () => {
    const [open, cycle, suggested, routines, last] = await Promise.all([
      getOpenSession(),
      getActiveCycle(),
      getSuggestedRoutine(),
      db.routines.toArray(),
      getLastFinishedSession(),
    ])
    const summary = async (id: string) => {
      const logs = await db.logs.where('sessionId').equals(id).sortBy('loggedAt')
      const names = (await db.exercises.bulkGet(logs.map((l) => l.exerciseId))).map((e) => e?.name ?? '?')
      return { count: logs.length, names }
    }
    return {
      open: open ?? null,
      openSummary: open ? await summary(open.id) : null,
      cycle: cycle ?? null,
      suggested: suggested ?? null,
      routines,
      last: last ?? null,
      lastSummary: last ? await summary(last.id) : null,
    }
  })
  // undefined = follow the suggestion.
  const [picked, setPicked] = useState<string | undefined>(undefined)
  const [error, setError] = useState('')
  if (!data) return null

  const routineName = (id: string | null) =>
    id == null ? 'Free session' : (data.routines.find((r) => r.id === id)?.name ?? 'Deleted routine')

  if (data.open) {
    const { open, openSummary } = data
    async function discard() {
      const n = openSummary!.count
      const what = n ? ` and its ${n} logged exercise${n === 1 ? '' : 's'}` : ''
      if (window.confirm(`Discard this session${what}? This cannot be undone.`)) await discardSession(open.id)
    }
    return (
      <>
        <ScreenHeader title="Gym Log" />
        <section className="card">
          <span className="card-label">Session in progress</span>
          <span className="card-title">{routineName(open.routineId)}</span>
          <span className="muted">
            Started {formatDate(open.startedAt)}, {formatTime(open.startedAt)} · {openSummary!.count} logged
          </span>
        </section>
        <div className="actions">
          <button type="button" className="btn btn-primary" onClick={onStarted}>
            Resume
          </button>
          <button type="button" className="btn btn-danger" onClick={discard}>
            Discard
          </button>
        </div>
      </>
    )
  }

  const available = data.routines.filter((r) => !r.archived)
  const cycleIds = data.cycle?.routineIds ?? []
  const inCycle = cycleIds.flatMap((id) => available.filter((r) => r.id === id))
  const others = available.filter((r) => !cycleIds.includes(r.id)).sort(byName)
  const fallback = data.suggested?.id ?? FREE
  const choice = picked !== undefined && (picked === FREE || available.some((r) => r.id === picked)) ? picked : fallback

  async function start() {
    setError('')
    try {
      await startSession(choice === FREE ? null : choice)
      setPicked(undefined)
      onStarted()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <>
      <ScreenHeader title="Gym Log" />
      <BackupBanner />
      {!data.cycle && (
        <p className="notice">No active cycle. Set one in Manage → Cycles. You can still start a free session.</p>
      )}
      {data.cycle && (
        <section className="card">
          <span className="card-label">Suggested next · {data.cycle.name}</span>
          <span className="card-title">{data.suggested?.name ?? 'No routine in this cycle'}</span>
        </section>
      )}

      <Field label="Routine">
        <select value={choice} onChange={(e) => setPicked(e.target.value)}>
          {inCycle.length > 0 && (
            <optgroup label={data.cycle!.name}>
              {inCycle.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                  {r.id === data.suggested?.id ? ' (suggested)' : ''}
                </option>
              ))}
            </optgroup>
          )}
          {others.length > 0 && (
            <optgroup label={inCycle.length ? 'Other routines' : 'Routines'}>
              {others.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </optgroup>
          )}
          <option value={FREE}>No routine (free session)</option>
        </select>
      </Field>

      <button type="button" className="btn btn-primary btn-wide" onClick={start}>
        Start session
      </button>
      {error && (
        <p className="errors" role="alert">
          {error}
        </p>
      )}

      <h2 className="section-title">Last session</h2>
      {data.last ? (
        <section className="card">
          <span className="card-title">{routineName(data.last.routineId)}</span>
          <span className="muted">
            {formatDate(data.last.startedAt)} · {data.lastSummary!.count} exercise
            {data.lastSummary!.count === 1 ? '' : 's'} logged
          </span>
          {data.lastSummary!.names.length > 0 && <span className="row-sub">{data.lastSummary!.names.join(', ')}</span>}
        </section>
      ) : (
        <p className="muted">No finished sessions yet.</p>
      )}
    </>
  )
}

/** Reminder to export a backup if none was done or the last is older than 30 days. */
function BackupBanner() {
  const last = getLastExport()
  if (!backupReminderDue(last)) return null
  return (
    <p className="notice notice-warn" role="status">
      {last
        ? `Your last backup was ${Math.floor((Date.now() - Date.parse(last)) / 86_400_000)} days ago.`
        : 'You have not exported a backup yet.'}{' '}
      Export one in Manage → Report.
    </p>
  )
}

function Finished({ message, onDone }: { message: string; onDone: () => void }) {
  return (
    <>
      <ScreenHeader title="Well done" />
      <p className="finish-message">{message}</p>
      <button type="button" className="btn btn-primary btn-wide" onClick={onDone}>
        Done
      </button>
    </>
  )
}
