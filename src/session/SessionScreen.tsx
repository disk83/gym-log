import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { db, type Session } from '../db'
import { byName, exerciseSummary } from '../manage/format'
import { PickerSheet, ScreenHeader } from '../manage/ui'
import { addExerciseToSession, finishSession, sessionExerciseIds } from '../session'
import { formatLogValues, formatTime } from './format'

interface Props {
  session: Session
  onHome: () => void
  onOpen: (exerciseId: string) => void
  onNewExercise: () => void
  onFinished: (message: string) => void
}

export function SessionScreen({ session, onHome, onOpen, onNewExercise, onFinished }: Props) {
  const data = useLiveQuery(
    async () => {
      const [routine, logs, exercises] = await Promise.all([
        session.routineId ? db.routines.get(session.routineId) : undefined,
        db.logs.where('sessionId').equals(session.id).toArray(),
        db.exercises.toArray(),
      ])
      return { routine, logs, exercises }
    },
    [session.id, session.routineId],
  )
  const [picking, setPicking] = useState(false)
  const [finishing, setFinishing] = useState(false)
  if (!data) return null

  const exercises = new Map(data.exercises.map((e) => [e.id, e]))
  const logs = new Map(data.logs.map((l) => [l.exerciseId, l]))
  const ids = sessionExerciseIds(data.routine, session, data.logs, exercises)
  const nextId = ids.find((id) => !logs.has(id))
  const inRoutine = new Set(data.routine?.exerciseIds ?? [])
  const addable = data.exercises
    .filter((e) => !e.archived && !ids.includes(e.id))
    .sort(byName)
    .map((e) => ({ id: e.id, label: e.name, detail: exerciseSummary(e) }))

  async function add(exerciseId: string) {
    await addExerciseToSession(session.id, exerciseId)
    setPicking(false)
    onOpen(exerciseId)
  }

  async function finish() {
    const missing = ids.filter((id) => inRoutine.has(id) && !logs.has(id)).length
    const question = missing
      ? `Finish now? ${missing} routine exercise${missing === 1 ? ' is' : 's are'} not logged.`
      : 'Finish this session?'
    if (finishing || !window.confirm(question)) return
    setFinishing(true)
    try {
      onFinished(await finishSession(session.id))
    } finally {
      setFinishing(false)
    }
  }

  const title = session.routineId ? (data.routine?.name ?? 'Deleted routine') : 'Free session'

  return (
    <>
      <ScreenHeader title={title} onBack={onHome} />
      <p className="muted session-meta">
        Started {formatTime(session.startedAt)} · {data.logs.length} of {ids.length} logged
      </p>

      {ids.length === 0 && (
        <p className="muted">{session.routineId ? 'This routine has no exercises.' : 'Add the exercises you do.'}</p>
      )}
      <ul className="rows">
        {ids.map((id) => {
          const e = exercises.get(id)!
          const log = logs.get(id)
          const isNext = id === nextId
          const extra = !inRoutine.has(id) && session.routineId
          return (
            <li key={id}>
              <button
                type="button"
                className={['row', log && 'row-done', isNext && 'row-next'].filter(Boolean).join(' ')}
                onClick={() => onOpen(id)}
              >
                <span className="status" aria-hidden="true">
                  {log ? '✓' : isNext ? '▶' : '○'}
                </span>
                <span className="row-text">
                  <span className="row-title">
                    {e.name}
                    {isNext && <span className="badge">Next</span>}
                    {extra && <span className="badge badge-muted">Added</span>}
                  </span>
                  <span className="row-sub">
                    {log ? `Done · ${formatLogValues(log, e)}` : [e.machine, e.remarks].filter(Boolean).join(' · ')}
                  </span>
                </span>
                <span className="chevron">›</span>
              </button>
            </li>
          )
        })}
      </ul>

      <button type="button" className="btn btn-wide" onClick={() => setPicking(true)}>
        ＋ Add exercise
      </button>

      <div className="sticky-actions">
        <button type="button" className="btn btn-primary btn-wide" onClick={finish} disabled={finishing}>
          Finish
        </button>
      </div>

      {picking && (
        <PickerSheet
          title="Add exercise"
          closeLabel="Cancel"
          items={addable}
          emptyText="Every exercise is already in this session."
          onPick={add}
          onClose={() => setPicking(false)}
          top={
            <button
              type="button"
              className="btn btn-wide btn-first"
              onClick={() => {
                setPicking(false)
                onNewExercise()
              }}
            >
              ＋ Create a new exercise
            </button>
          }
        />
      )}
    </>
  )
}
