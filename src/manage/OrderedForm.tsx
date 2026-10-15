import { useState, type FormEvent, type ReactNode } from 'react'
import { moveItem, type RemoveResult } from '../data'
import { SortableList } from './SortableList'
import { Field, PickerSheet, ScreenHeader, confirmDiscard, confirmRemove } from './ui'

export interface Candidate {
  id: string
  label: string
  detail?: string
  archived: boolean
}

export interface OrderedValues {
  name: string
  remarks: string
  ids: string[]
}

interface Props {
  /** "routine" or "cycle". */
  kind: string
  /** "exercise" or "routine". */
  childKind: string
  existing: (OrderedValues & { archived: boolean }) | null
  /** Every possible child, archived ones included so existing entries keep their label. */
  candidates: Candidate[]
  onSave: (values: OrderedValues) => Promise<void>
  onToggleArchive: () => Promise<void>
  onRemove: () => Promise<RemoveResult>
  onDone: () => void
  /** Extra content under the header, e.g. the cycle's active state. */
  extra?: ReactNode
}

/** Shared create/edit form for routines (ordered exercises) and cycles (ordered routines). */
export function OrderedForm(props: Props) {
  const { kind, childKind, existing, candidates, onDone } = props
  const initial: OrderedValues = existing
    ? { name: existing.name, remarks: existing.remarks, ids: existing.ids }
    : { name: '', remarks: '', ids: [] }
  const [draft, setDraft] = useState<OrderedValues>(initial)
  const [picking, setPicking] = useState(false)
  const [error, setError] = useState('')

  const byId = new Map(candidates.map((c) => [c.id, c]))
  // Skip ids whose item no longer exists.
  const ids = draft.ids.filter((id) => byId.has(id))
  const dirty = JSON.stringify({ ...draft, ids }) !== JSON.stringify(initial)
  const Children = childKind[0].toUpperCase() + childKind.slice(1) + 's'

  async function save(e: FormEvent) {
    e.preventDefault()
    const name = draft.name.trim()
    if (!name) {
      setError('Name is required.')
      return
    }
    await props.onSave({ name, remarks: draft.remarks.trim(), ids })
    onDone()
  }

  async function toggleArchive() {
    await props.onToggleArchive()
    onDone()
  }

  async function remove() {
    if (!existing || !confirmRemove(kind, existing.name)) return
    if ((await props.onRemove()) === 'archived') window.alert(`This ${kind} has history, so it was archived instead.`)
    onDone()
  }

  const available = candidates.filter((c) => !c.archived && !ids.includes(c.id))

  return (
    <form onSubmit={save} noValidate>
      <ScreenHeader
        title={existing ? `Edit ${kind}` : `New ${kind}`}
        onBack={() => confirmDiscard(dirty) && onDone()}
      />
      {existing?.archived && <p className="notice">This {kind} is archived.</p>}
      {props.extra}

      <Field label="Name">
        <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} autoComplete="off" />
      </Field>
      <Field label="Remarks">
        <textarea value={draft.remarks} onChange={(e) => setDraft({ ...draft, remarks: e.target.value })} rows={2} />
      </Field>

      <div className="field">
        <span className="field-label">
          {Children} ({ids.length})
        </span>
        {ids.length === 0 ? (
          <p className="muted">No {childKind}s yet.</p>
        ) : (
          <SortableList
            items={ids.map((id) => {
              const c = byId.get(id)!
              return { id, label: c.label, detail: [c.archived && 'Archived', c.detail].filter(Boolean).join(' · ') }
            })}
            onMove={(from, to) => setDraft({ ...draft, ids: moveItem(ids, from, to) })}
            onRemove={(index) => setDraft({ ...draft, ids: ids.filter((_, i) => i !== index) })}
          />
        )}
        <button type="button" className="btn btn-wide" onClick={() => setPicking(true)}>
          ＋ Add {childKind}
        </button>
      </div>

      {error && (
        <p className="errors" role="alert">
          {error}
        </p>
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

      {picking && (
        <PickerSheet
          title={`Add ${childKind}`}
          items={available}
          emptyText={
            candidates.some((c) => !c.archived)
              ? `Every ${childKind} is already in this ${kind}.`
              : `No ${childKind}s yet. Create one in Manage → ${Children} first.`
          }
          onPick={(id) => setDraft((d) => ({ ...d, ids: [...d.ids.filter((x) => byId.has(x)), id] }))}
          onClose={() => setPicking(false)}
        />
      )}
    </form>
  )
}
