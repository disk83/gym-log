import { useEffect, useState, type FormEvent } from 'react'
import { db, type Exercise, type ExerciseType, type LoadType } from '../db'
import { createExercise, removeExercise, setExerciseArchived, updateExercise, type ExerciseInput } from '../data'
import { parseNumber } from './format'
import { Field, ScreenHeader, confirmDiscard, confirmRemove } from './ui'

interface Draft {
  name: string
  machine: string
  remarks: string
  type: ExerciseType
  loadType: LoadType
  sets: string
  reps: string
  weight: string
}

const EMPTY: Draft = {
  name: '',
  machine: '',
  remarks: '',
  type: 'strength',
  loadType: 'total',
  sets: '3',
  reps: '10',
  weight: '',
}

function toDraft(e: Exercise): Draft {
  return {
    name: e.name,
    machine: e.machine ?? '',
    remarks: e.remarks,
    type: e.type,
    loadType: e.loadType,
    sets: String(e.defaultSets),
    reps: String(e.defaultReps),
    weight: e.defaultWeight != null ? String(e.defaultWeight) : '',
  }
}

/** Validate the draft; returns the input to save or a list of errors. */
function toInput(d: Draft): ExerciseInput | string[] {
  const errors: string[] = []
  const name = d.name.trim()
  const sets = parseNumber(d.sets)
  const reps = parseNumber(d.reps)
  const weight = parseNumber(d.weight)
  if (!name) errors.push('Name is required.')
  if (sets == null || !Number.isInteger(sets) || sets < 1) errors.push('Sets must be a whole number of at least 1.')
  if (reps == null || !Number.isInteger(reps) || reps < 1)
    errors.push(`${d.type === 'timed' ? 'Seconds' : 'Reps'} must be a whole number of at least 1.`)
  if (d.weight.trim() !== '' && weight == null) errors.push('Weight must be a number, or left empty.')
  if (errors.length) return errors

  const input: ExerciseInput = {
    name,
    remarks: d.remarks.trim(),
    type: d.type,
    loadType: d.loadType,
    defaultSets: sets!,
    defaultReps: reps!,
  }
  if (d.machine.trim()) input.machine = d.machine.trim()
  if (weight != null) input.defaultWeight = weight
  return input
}

export function ExerciseForm({
  id,
  onDone,
  title,
}: {
  id?: string
  /** Called with the saved exercise's id after a save, without one otherwise. */
  onDone: (savedId?: string) => void
  title?: string
}) {
  const [existing, setExisting] = useState<Exercise | null | undefined>(id ? undefined : null)
  const [draft, setDraft] = useState<Draft>(EMPTY)
  const [initial, setInitial] = useState<Draft>(EMPTY)
  const [errors, setErrors] = useState<string[]>([])

  useEffect(() => {
    if (!id) return
    void db.exercises.get(id).then((e) => {
      setExisting(e ?? null)
      if (e) {
        setDraft(toDraft(e))
        setInitial(toDraft(e))
      }
    })
  }, [id])

  if (existing === undefined) return null
  if (id && !existing) {
    return (
      <>
        <ScreenHeader title="Exercise" onBack={() => onDone()} />
        <p className="muted">This exercise no longer exists.</p>
      </>
    )
  }

  const dirty = JSON.stringify(draft) !== JSON.stringify(initial)
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }))

  async function save(e: FormEvent) {
    e.preventDefault()
    const result = toInput(draft)
    if (Array.isArray(result)) {
      setErrors(result)
      return
    }
    const savedId = existing ? existing.id : await createExercise(result)
    if (existing) await updateExercise(existing.id, result)
    onDone(savedId)
  }

  async function toggleArchive() {
    if (!existing) return
    await setExerciseArchived(existing.id, !existing.archived)
    onDone()
  }

  async function remove() {
    if (!existing || !confirmRemove('exercise', existing.name)) return
    const result = await removeExercise(existing.id)
    if (result === 'archived') window.alert('This exercise has history, so it was archived instead.')
    onDone()
  }

  return (
    <form onSubmit={save} noValidate>
      <ScreenHeader
        title={title ?? (existing ? 'Edit exercise' : 'New exercise')}
        onBack={() => confirmDiscard(dirty) && onDone()}
      />
      {existing?.archived && <p className="notice">This exercise is archived.</p>}

      <Field label="Name">
        <input value={draft.name} onChange={(e) => set('name', e.target.value)} autoComplete="off" />
      </Field>
      <Field label="Machine (optional)">
        <input value={draft.machine} onChange={(e) => set('machine', e.target.value)} autoComplete="off" />
      </Field>
      <Field label="Remarks">
        <textarea
          value={draft.remarks}
          onChange={(e) => set('remarks', e.target.value)}
          rows={2}
          placeholder="e.g. 3-4 x 8-10"
        />
      </Field>

      <fieldset className="field">
        <legend className="field-label">Type</legend>
        <div className="segmented">
          {(['strength', 'timed'] as const).map((t) => (
            <button
              key={t}
              type="button"
              aria-pressed={draft.type === t}
              className={draft.type === t ? 'seg on' : 'seg'}
              onClick={() => set('type', t)}
            >
              {t === 'strength' ? 'Strength' : 'Timed'}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className="field">
        <legend className="field-label">Load type</legend>
        <div className="segmented">
          {(
            [
              ['total', 'Total'],
              ['per_dumbbell', 'Per dumbbell'],
              ['bodyweight', 'Bodyweight'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={draft.loadType === value}
              className={draft.loadType === value ? 'seg on' : 'seg'}
              onClick={() => set('loadType', value)}
            >
              {label}
            </button>
          ))}
        </div>
      </fieldset>

      <div className="field-row">
        <Field label="Default sets">
          <input inputMode="numeric" value={draft.sets} onChange={(e) => set('sets', e.target.value)} />
        </Field>
        <Field label={draft.type === 'timed' ? 'Default seconds' : 'Default reps'}>
          <input inputMode="numeric" value={draft.reps} onChange={(e) => set('reps', e.target.value)} />
        </Field>
        <Field label="Default weight">
          <input
            inputMode="decimal"
            value={draft.weight}
            onChange={(e) => set('weight', e.target.value)}
            placeholder="optional"
          />
        </Field>
      </div>

      {errors.length > 0 && (
        <ul className="errors" role="alert">
          {errors.map((err) => (
            <li key={err}>{err}</li>
          ))}
        </ul>
      )}

      <div className="actions">
        <button type="submit" className="btn btn-primary">
          Save
        </button>
        {existing && (
          <>
            <button type="button" className="btn" onClick={toggleArchive}>
              {existing.archived ? 'Restore' : 'Archive'}
            </button>
            <button type="button" className="btn btn-danger" onClick={remove}>
              Delete
            </button>
          </>
        )}
      </div>
    </form>
  )
}
