import { useEffect, useState, type FormEvent } from 'react'
import { db, type Exercise, type Log } from '../db'
import { parseNumber } from '../manage/format'
import { Field, ScreenHeader, confirmDiscard } from '../manage/ui'
import { getLastLog, getSessionLog, prefillValues, saveLog, type LogValues } from '../session'
import { formatDate, formatLogValues } from './format'

interface Draft {
  sets: string
  reps: string
  weight: string
  remarks: string
}

function toDraft(v: LogValues): Draft {
  return { sets: String(v.sets), reps: String(v.repsOrSeconds), weight: v.weight != null ? String(v.weight) : '', remarks: v.remarks }
}

function toValues(d: Draft, exercise: Exercise): LogValues | string[] {
  const errors: string[] = []
  const sets = parseNumber(d.sets)
  const reps = parseNumber(d.reps)
  const weight = parseNumber(d.weight)
  const timed = exercise.type === 'timed'
  if (sets == null || !Number.isInteger(sets) || sets < 1) errors.push('Sets must be a whole number of at least 1.')
  if (reps == null || !Number.isInteger(reps) || reps < 1)
    errors.push(`${timed ? 'Seconds' : 'Reps'} must be a whole number of at least 1.`)
  if (d.weight.trim() === '') {
    if (exercise.loadType !== 'bodyweight') errors.push('Weight is required.')
  } else if (weight == null) errors.push('Weight must be a number.')
  if (errors.length) return errors
  const values: LogValues = { sets: sets!, repsOrSeconds: reps!, remarks: d.remarks.trim() }
  if (weight != null) values.weight = weight
  return values
}

interface Loaded {
  exercise: Exercise
  last: Log | undefined
  /** This session's log, when re-opening a logged exercise. */
  current: Log | undefined
}

export function LogScreen({ sessionId, exerciseId, onDone }: { sessionId: string; exerciseId: string; onDone: () => void }) {
  const [loaded, setLoaded] = useState<Loaded | null | undefined>(undefined)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [initial, setInitial] = useState<Draft | null>(null)
  const [errors, setErrors] = useState<string[]>([])

  useEffect(() => {
    void Promise.all([db.exercises.get(exerciseId), getLastLog(exerciseId, sessionId), getSessionLog(sessionId, exerciseId)]).then(
      ([exercise, last, current]) => {
        if (!exercise) return setLoaded(null)
        const d = toDraft(prefillValues(exercise, current ?? last))
        setLoaded({ exercise, last, current })
        setDraft(d)
        setInitial(d)
      },
    )
  }, [sessionId, exerciseId])

  if (loaded === undefined || (loaded && !draft)) return null
  if (loaded === null) {
    return (
      <>
        <ScreenHeader title="Exercise" onBack={onDone} />
        <p className="muted">This exercise no longer exists.</p>
      </>
    )
  }
  const { exercise, last, current } = loaded
  const d = draft!
  const set = (key: keyof Draft, value: string) => setDraft({ ...d, [key]: value })
  const dirty = JSON.stringify(d) !== JSON.stringify(initial)
  const timed = exercise.type === 'timed'
  const bodyweight = exercise.loadType === 'bodyweight'
  const weightLabel =
    (exercise.loadType === 'per_dumbbell' ? 'Weight per dumbbell' : 'Weight') + (bodyweight ? ' (optional)' : '')

  async function save(e: FormEvent) {
    e.preventDefault()
    const result = toValues(d, exercise)
    if (Array.isArray(result)) return setErrors(result)
    await saveLog(sessionId, exerciseId, result)
    onDone()
  }

  return (
    <form onSubmit={save} noValidate>
      <ScreenHeader title={exercise.name} onBack={() => confirmDiscard(dirty) && onDone()} />
      {(exercise.machine || exercise.remarks) && (
        <p className="muted exercise-meta">{[exercise.machine, exercise.remarks].filter(Boolean).join(' · ')}</p>
      )}

      <section className="card last-time">
        <span className="card-label">Last time</span>
        {last ? (
          <>
            <span className="card-title">{formatLogValues(last, exercise)}</span>
            <span className="muted">{formatDate(last.loggedAt)}</span>
            {last.remarks && <span className="row-sub">{last.remarks}</span>}
          </>
        ) : (
          <span className="card-title">No previous log</span>
        )}
      </section>

      {current && <p className="notice notice-ok">Logged in this session. Saving updates it.</p>}

      <div className="field-row">
        <Field label="Sets">
          <input inputMode="numeric" value={d.sets} onChange={(e) => set('sets', e.target.value)} />
        </Field>
        <Field label={timed ? 'Seconds' : 'Reps'}>
          <input inputMode="numeric" value={d.reps} onChange={(e) => set('reps', e.target.value)} />
        </Field>
        <Field label={weightLabel}>
          <input
            inputMode="decimal"
            value={d.weight}
            onChange={(e) => set('weight', e.target.value)}
            placeholder={bodyweight ? 'optional' : undefined}
          />
        </Field>
      </div>
      <Field label="Remarks">
        <textarea value={d.remarks} onChange={(e) => set('remarks', e.target.value)} rows={2} />
      </Field>

      {errors.length > 0 && (
        <ul className="errors" role="alert">
          {errors.map((err) => (
            <li key={err}>{err}</li>
          ))}
        </ul>
      )}

      <div className="actions">
        <button type="submit" className="btn btn-primary">
          {current ? 'Save changes' : 'Save'}
        </button>
      </div>
    </form>
  )
}
