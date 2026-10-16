import { useLiveQuery } from 'dexie-react-hooks'
import { useState, type FormEvent } from 'react'
import { db, type Exercise, type Log, type Session } from '../db'
import { deleteSession, logsInOrder, sessionsNewestFirst, toDateInput, updateSession } from '../history'
import { LOAD_LABELS, byName, exerciseSummary } from '../manage/format'
import { Field, PickerSheet, ScreenHeader, confirmDiscard } from '../manage/ui'
import { formatDate, formatTime } from '../session/format'
import { LogScreen } from '../session/LogScreen'

/** Where the History tab is. Kept by the parent so switching tabs returns to the same screen. */
export type HistoryView =
  | { screen: 'list' }
  | { screen: 'detail'; sessionId: string }
  | { screen: 'edit'; sessionId: string }
  | { screen: 'log'; sessionId: string; exerciseId: string }

export function History({
  view,
  setView,
  onResume,
}: {
  view: HistoryView
  setView: (v: HistoryView) => void
  /** Open the in-progress session on the Home tab. */
  onResume: () => void
}) {
  const go = (v: HistoryView) => {
    setView(v)
    window.scrollTo(0, 0)
  }
  if (view.screen === 'list') return <SessionList onOpen={(s) => (s.finishedAt ? go({ screen: 'detail', sessionId: s.id }) : onResume())} />
  const toDetail = () => go({ screen: 'detail', sessionId: view.sessionId })
  if (view.screen === 'edit') return <SessionEditForm key={view.sessionId} sessionId={view.sessionId} onDone={toDetail} />
  if (view.screen === 'log') {
    return (
      <LogScreen
        key={`${view.sessionId}:${view.exerciseId}`}
        sessionId={view.sessionId}
        exerciseId={view.exerciseId}
        onDone={toDetail}
        canDelete
      />
    )
  }
  return (
    <SessionDetail
      sessionId={view.sessionId}
      onBack={() => go({ screen: 'list' })}
      onEdit={() => go({ screen: 'edit', sessionId: view.sessionId })}
      onOpenLog={(exerciseId) => go({ screen: 'log', sessionId: view.sessionId, exerciseId })}
      onResume={onResume}
    />
  )
}

function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`
}

/** Routine name for a session, "Free session" without one. */
function routineLabel(session: Session, routineName: string | undefined): string {
  if (!session.routineId) return 'Free session'
  return routineName ?? 'Deleted routine'
}

// ---------- List ----------

function SessionList({ onOpen }: { onOpen: (s: Session) => void }) {
  const data = useLiveQuery(async () => {
    const [sessions, routines, logs] = await Promise.all([db.sessions.toArray(), db.routines.toArray(), db.logs.toArray()])
    const counts = new Map<string, number>()
    for (const l of logs) counts.set(l.sessionId, (counts.get(l.sessionId) ?? 0) + 1)
    return { sessions: sessionsNewestFirst(sessions), routines: new Map(routines.map((r) => [r.id, r])), counts }
  })
  if (!data) return null

  return (
    <>
      <ScreenHeader title="History" />
      {data.sessions.length === 0 && <p className="muted">No sessions yet. Start one from Home.</p>}
      <ul className="rows">
        {data.sessions.map((s) => {
          const routine = s.routineId ? data.routines.get(s.routineId) : undefined
          const open = !s.finishedAt
          const count = data.counts.get(s.id) ?? 0
          return (
            <li key={s.id}>
              <button type="button" className={open ? 'row row-next' : 'row'} onClick={() => onOpen(s)}>
                <span className="status" aria-hidden="true">
                  {open ? '▶' : '✓'}
                </span>
                <span className="row-text">
                  <span className="row-title">
                    {routineLabel(s, routine?.name)}
                    {open && <span className="badge">In progress</span>}
                    {routine?.archived && <span className="badge badge-muted">Archived</span>}
                  </span>
                  <span className="row-sub">
                    {formatDate(s.startedAt)} · {plural(count, 'exercise')} · {open ? 'Open, tap to resume' : 'Finished'}
                  </span>
                </span>
                <span className="chevron">›</span>
              </button>
            </li>
          )
        })}
      </ul>
    </>
  )
}

// ---------- Detail ----------

/** e.g. "3 × 10 @ 60 · total", "3 × 45 s · bodyweight". */
function logLine(log: Log, exercise: Exercise | undefined): string {
  const reps = exercise?.type === 'timed' ? `${log.repsOrSeconds} s` : `${log.repsOrSeconds}`
  const weight = log.weight != null ? ` @ ${log.weight}` : ''
  const load = exercise ? ` · ${LOAD_LABELS[exercise.loadType]}` : ''
  return `${log.sets} × ${reps}${weight}${load}`
}

function SessionDetail({
  sessionId,
  onBack,
  onEdit,
  onOpenLog,
  onResume,
}: {
  sessionId: string
  onBack: () => void
  onEdit: () => void
  onOpenLog: (exerciseId: string) => void
  onResume: () => void
}) {
  const data = useLiveQuery(async () => {
    const session = await db.sessions.get(sessionId)
    if (!session) return { session: null }
    const [routine, cycle, logs, exercises] = await Promise.all([
      session.routineId ? db.routines.get(session.routineId) : undefined,
      session.cycleId ? db.cycles.get(session.cycleId) : undefined,
      db.logs.where('sessionId').equals(sessionId).toArray(),
      db.exercises.toArray(),
    ])
    return { session, routine, cycle, logs: logsInOrder(logs), exercises }
  }, [sessionId])
  const [picking, setPicking] = useState(false)
  if (!data) return null
  const { session } = data
  if (!session) {
    return (
      <>
        <ScreenHeader title="Session" onBack={onBack} />
        <p className="muted">This session no longer exists.</p>
      </>
    )
  }

  const exercises = new Map(data.exercises.map((e) => [e.id, e]))
  const logged = new Set(data.logs.map((l) => l.exerciseId))
  const addable = data.exercises
    .filter((e) => !e.archived && !logged.has(e.id))
    .sort(byName)
    .map((e) => ({ id: e.id, label: e.name, detail: exerciseSummary(e) }))
  const title = routineLabel(session, data.routine?.name)

  const logCount = data.logs.length

  async function remove() {
    const logsText = logCount
      ? `Its ${plural(logCount, 'logged exercise')} will be deleted too.`
      : 'It has no logged exercises.'
    const question = `Delete the session "${title}" of ${formatDate(session!.startedAt)}? ${logsText} This cannot be undone.`
    if (!window.confirm(question)) return
    await deleteSession(session!.id)
    onBack()
  }

  return (
    <>
      <ScreenHeader title={title} onBack={onBack} />

      <section className="card">
        <span className="card-label">Session</span>
        <span className="card-title">{formatDate(session.startedAt)}</span>
        <span className="muted">
          {session.routineId ? (
            <>
              Routine: {data.routine?.name ?? 'Deleted routine'}
              {data.routine?.archived && ' (archived)'}
            </>
          ) : (
            'Free session, no routine'
          )}
        </span>
        {data.cycle && (
          <span className="muted">
            Cycle: {data.cycle.name}
            {data.cycle.archived && ' (archived)'}
          </span>
        )}
        <span className="muted">
          Started {formatTime(session.startedAt)}
          {session.finishedAt ? ` · Finished ${formatTime(session.finishedAt)}` : ' · In progress'}
        </span>
        {session.remarks && <span className="row-sub">{session.remarks}</span>}
      </section>

      {session.finishedAt ? (
        <button type="button" className="btn btn-wide" onClick={onEdit}>
          Edit date and remarks
        </button>
      ) : (
        <button type="button" className="btn btn-primary btn-wide" onClick={onResume}>
          Resume session
        </button>
      )}

      <h2 className="section-title">{plural(data.logs.length, 'exercise')} logged</h2>
      {data.logs.length === 0 && <p className="muted">Nothing logged in this session.</p>}
      <ul className="rows">
        {data.logs.map((log) => {
          const e = exercises.get(log.exerciseId)
          return (
            <li key={log.id}>
              <button
                type="button"
                className="row"
                onClick={() => (session.finishedAt ? onOpenLog(log.exerciseId) : onResume())}
                disabled={!e}
              >
                <span className="row-text">
                  <span className="row-title">
                    {e?.name ?? 'Deleted exercise'}
                    {e?.archived && <span className="badge badge-muted">Archived</span>}
                  </span>
                  {e?.machine && <span className="row-sub">{e.machine}</span>}
                  <span className="row-sub row-values">{logLine(log, e)}</span>
                  {log.remarks && <span className="row-sub">{log.remarks}</span>}
                </span>
                {e && <span className="chevron">›</span>}
              </button>
            </li>
          )
        })}
      </ul>

      {session.finishedAt && (
        <>
          <button type="button" className="btn btn-wide" onClick={() => setPicking(true)}>
            ＋ Add log
          </button>
          <div className="actions">
            <button type="button" className="btn btn-danger" onClick={remove}>
              Delete session
            </button>
          </div>
        </>
      )}

      {picking && (
        <PickerSheet
          title="Add log"
          closeLabel="Cancel"
          items={addable}
          emptyText="Every exercise is already logged in this session."
          onPick={(id) => {
            setPicking(false)
            onOpenLog(id)
          }}
          onClose={() => setPicking(false)}
        />
      )}
    </>
  )
}

// ---------- Edit date and remarks ----------

function SessionEditForm({ sessionId, onDone }: { sessionId: string; onDone: () => void }) {
  const session = useLiveQuery(async () => (await db.sessions.get(sessionId)) ?? null, [sessionId])
  const [draft, setDraft] = useState<{ date: string; remarks: string } | null>(null)
  const [error, setError] = useState('')
  if (session === undefined) return null
  if (session === null) {
    return (
      <>
        <ScreenHeader title="Edit session" onBack={onDone} />
        <p className="muted">This session no longer exists.</p>
      </>
    )
  }
  const initial = { date: toDateInput(session.startedAt), remarks: session.remarks ?? '' }
  const d = draft ?? initial
  const dirty = d.date !== initial.date || d.remarks !== initial.remarks
  const today = toDateInput(new Date().toISOString())

  async function save(e: FormEvent) {
    e.preventDefault()
    if (!d.date) return setError('Date is required.')
    if (d.date > today) return setError('The date cannot be in the future.')
    try {
      await updateSession(sessionId, d)
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <form onSubmit={save} noValidate>
      <ScreenHeader title="Edit session" onBack={() => confirmDiscard(dirty) && onDone()} />
      <Field label="Date">
        <input type="date" value={d.date} max={today} onChange={(e) => setDraft({ ...d, date: e.target.value })} />
      </Field>
      <p className="muted field-hint">Start and finish times stay the same; only the day changes.</p>
      <Field label="Remarks">
        <textarea value={d.remarks} onChange={(e) => setDraft({ ...d, remarks: e.target.value })} rows={3} />
      </Field>
      {error && (
        <p className="errors" role="alert">
          {error}
        </p>
      )}
      <div className="actions">
        <button type="submit" className="btn btn-primary">
          Save changes
        </button>
      </div>
    </form>
  )
}
