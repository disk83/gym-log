import { useState, type ReactNode } from 'react'

export function ScreenHeader({ title, onBack }: { title: string; onBack?: () => void }) {
  return (
    <header className="screen-header">
      {onBack && (
        <button type="button" className="back-btn" onClick={onBack}>
          ‹ Back
        </button>
      )}
      <h1>{title}</h1>
    </header>
  )
}

/** Archived items, collapsed by default. */
export function ArchivedSection({ count, children }: { count: number; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  if (count === 0) return null
  return (
    <section className="archived">
      <button type="button" className="archived-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span>{open ? '▾' : '▸'}</span> Archived ({count})
      </button>
      {open && children}
    </section>
  )
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
    </label>
  )
}

/** Full-screen sheet for picking items to add to a list. Tapping an item adds it. */
export function PickerSheet({
  title,
  items,
  emptyText,
  onPick,
  onClose,
  closeLabel = 'Done',
  top,
}: {
  title: string
  items: { id: string; label: string; detail?: string }[]
  emptyText: string
  onPick: (id: string) => void
  onClose: () => void
  closeLabel?: string
  /** Shown above the list, e.g. a "create new" button. */
  top?: ReactNode
}) {
  return (
    <div className="sheet" role="dialog" aria-modal="true" aria-label={title}>
      <div className="sheet-header">
        <h2>{title}</h2>
        <button type="button" className="btn btn-primary" onClick={onClose}>
          {closeLabel}
        </button>
      </div>
      <div className="sheet-body">
        {top}
        {items.length === 0 ? (
          <p className="muted">{emptyText}</p>
        ) : (
          <ul className="rows">
            {items.map((item) => (
              <li key={item.id}>
                <button type="button" className="row" onClick={() => onPick(item.id)}>
                  <span className="row-text">
                    <span className="row-title">{item.label}</span>
                    {item.detail && <span className="row-sub">{item.detail}</span>}
                  </span>
                  <span className="row-add">＋</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

/** Ask before deleting; the data layer archives instead when history exists. */
export function confirmRemove(kind: string, name: string): boolean {
  return window.confirm(`Delete ${kind} "${name}"? This cannot be undone.`)
}

export function confirmDiscard(dirty: boolean): boolean {
  return !dirty || window.confirm('Discard unsaved changes?')
}
