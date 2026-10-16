import { useLiveQuery } from 'dexie-react-hooks'
import { useState, type ReactNode } from 'react'
import { db, type Cycle, type Exercise, type Routine } from '../db'
import {
  createCycle,
  createRoutine,
  removeCycle,
  removeRoutine,
  setActiveCycle,
  setCycleArchived,
  setRoutineArchived,
  updateCycle,
  updateRoutine,
} from '../data'
import { ExerciseForm } from './ExerciseForm'
import { OrderedForm } from './OrderedForm'
import { ReportScreen } from './ReportScreen'
import { byName, exerciseSummary } from './format'
import { ArchivedSection, ScreenHeader } from './ui'

type Section = 'exercises' | 'routines' | 'cycles' | 'report'

/** What the Manage tab shows: a list, or the form for one item (id undefined = new). */
type View = { section: Section; editing?: { id?: string } }

const SECTIONS: [Section, string][] = [
  ['exercises', 'Exercises'],
  ['routines', 'Routines'],
  ['cycles', 'Cycles'],
  ['report', 'Report'],
]

export function Manage() {
  const [view, setView] = useState<View>({ section: 'exercises' })
  const backToList = () => {
    setView({ section: view.section })
    window.scrollTo(0, 0)
  }
  const open = (id?: string) => {
    setView({ section: view.section, editing: { id } })
    window.scrollTo(0, 0)
  }

  if (view.editing) {
    const { id } = view.editing
    if (view.section === 'exercises') return <ExerciseForm key={id ?? 'new'} id={id} onDone={backToList} />
    if (view.section === 'routines') return <RoutineForm key={id ?? 'new'} id={id} onDone={backToList} />
    return <CycleForm key={id ?? 'new'} id={id} onDone={backToList} />
  }

  return (
    <>
      <ScreenHeader title="Manage" />
      <div className="segmented tabs-segmented" role="tablist">
        {SECTIONS.map(([section, label]) => (
          <button
            key={section}
            type="button"
            role="tab"
            aria-selected={view.section === section}
            className={view.section === section ? 'seg on' : 'seg'}
            onClick={() => setView({ section })}
          >
            {label}
          </button>
        ))}
      </div>
      {view.section === 'exercises' && <ExerciseList onOpen={open} />}
      {view.section === 'routines' && <RoutineList onOpen={open} />}
      {view.section === 'cycles' && <CycleList onOpen={open} />}
      {view.section === 'report' && <ReportScreen />}
    </>
  )
}

// ---------- Lists ----------

interface RowData {
  id: string
  title: string
  sub?: string
  badge?: string
  /** Extra button shown next to the row. */
  action?: ReactNode
}

function Rows({ rows, onOpen }: { rows: RowData[]; onOpen: (id: string) => void }) {
  return (
    <ul className="rows">
      {rows.map((r) => (
        <li key={r.id} className={r.action ? 'row-with-action' : undefined}>
          <button type="button" className="row" onClick={() => onOpen(r.id)}>
            <span className="row-text">
              <span className="row-title">
                {r.title}
                {r.badge && <span className="badge">{r.badge}</span>}
              </span>
              {r.sub && <span className="row-sub">{r.sub}</span>}
            </span>
            <span className="chevron">›</span>
          </button>
          {r.action}
        </li>
      ))}
    </ul>
  )
}

function ListShell<T extends { id: string; archived: boolean }>({
  items,
  noun,
  toRow,
  onOpen,
}: {
  items: T[] | undefined
  noun: string
  toRow: (item: T) => RowData
  onOpen: (id?: string) => void
}) {
  if (!items) return null
  const active = items.filter((i) => !i.archived)
  const archived = items.filter((i) => i.archived)
  return (
    <>
      <button type="button" className="btn btn-primary btn-wide" onClick={() => onOpen()}>
        ＋ New {noun}
      </button>
      {active.length === 0 && <p className="muted">No {noun}s yet.</p>}
      <Rows rows={active.map(toRow)} onOpen={onOpen} />
      <ArchivedSection count={archived.length}>
        <Rows rows={archived.map(toRow)} onOpen={onOpen} />
      </ArchivedSection>
    </>
  )
}

function ExerciseList({ onOpen }: { onOpen: (id?: string) => void }) {
  const exercises = useLiveQuery(() => db.exercises.toArray().then((l) => l.sort(byName)))
  return (
    <ListShell
      items={exercises}
      noun="exercise"
      onOpen={onOpen}
      toRow={(e) => ({ id: e.id, title: e.name, sub: exerciseSummary(e) })}
    />
  )
}

function countLabel(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`
}

function RoutineList({ onOpen }: { onOpen: (id?: string) => void }) {
  const routines = useLiveQuery(() => db.routines.toArray().then((l) => l.sort(byName)))
  return (
    <ListShell
      items={routines}
      noun="routine"
      onOpen={onOpen}
      toRow={(r) => ({ id: r.id, title: r.name, sub: countLabel(r.exerciseIds.length, 'exercise') })}
    />
  )
}

function CycleList({ onOpen }: { onOpen: (id?: string) => void }) {
  const cycles = useLiveQuery(() => db.cycles.toArray().then((l) => l.sort(byName)))
  const toRow = (c: Cycle): RowData => ({
    id: c.id,
    title: c.name,
    sub: countLabel(c.routineIds.length, 'routine'),
    badge: c.active ? 'Active' : undefined,
    action:
      c.archived || c.active ? undefined : (
        <button type="button" className="btn btn-small" onClick={() => setActiveCycle(c.id)}>
          Set as active
        </button>
      ),
  })
  return (
    <ListShell
      items={cycles}
      noun="cycle"
      onOpen={onOpen}
      toRow={toRow}
    />
  )
}

// ---------- Forms ----------

function exerciseCandidates(exercises: Exercise[]) {
  return exercises.sort(byName).map((e) => ({ id: e.id, label: e.name, detail: exerciseSummary(e), archived: e.archived }))
}

function RoutineForm({ id, onDone }: { id?: string; onDone: () => void }) {
  const data = useLiveQuery(
    async () => ({
      routine: id ? ((await db.routines.get(id)) ?? null) : null,
      exercises: await db.exercises.toArray(),
    }),
    [id],
  )
  if (!data) return null
  const { routine } = data
  if (id && !routine) return <Gone kind="routine" onDone={onDone} />
  return (
    <OrderedForm
      kind="routine"
      childKind="exercise"
      existing={routine && toValues(routine, routine.exerciseIds)}
      candidates={exerciseCandidates(data.exercises)}
      onSave={async ({ name, remarks, ids }) => {
        const input = { name, remarks, exerciseIds: ids }
        if (routine) await updateRoutine(routine.id, input)
        else await createRoutine(input)
      }}
      onToggleArchive={() => setRoutineArchived(routine!.id, !routine!.archived)}
      onRemove={() => removeRoutine(routine!.id)}
      onDone={onDone}
    />
  )
}

function CycleForm({ id, onDone }: { id?: string; onDone: () => void }) {
  const data = useLiveQuery(
    async () => ({
      cycle: id ? ((await db.cycles.get(id)) ?? null) : null,
      routines: await db.routines.toArray(),
    }),
    [id],
  )
  if (!data) return null
  const { cycle } = data
  if (id && !cycle) return <Gone kind="cycle" onDone={onDone} />
  return (
    <OrderedForm
      kind="cycle"
      childKind="routine"
      existing={cycle && toValues(cycle, cycle.routineIds)}
      candidates={data.routines.sort(byName).map((r: Routine) => ({
        id: r.id,
        label: r.name,
        detail: countLabel(r.exerciseIds.length, 'exercise'),
        archived: r.archived,
      }))}
      extra={
        cycle &&
        (cycle.active ? (
          <p className="notice notice-ok">This is the active cycle.</p>
        ) : (
          <button type="button" className="btn btn-wide" onClick={() => setActiveCycle(cycle.id)}>
            Set as active
          </button>
        ))
      }
      onSave={async ({ name, remarks, ids }) => {
        const input = { name, remarks, routineIds: ids }
        if (cycle) await updateCycle(cycle.id, input)
        else await createCycle(input)
      }}
      onToggleArchive={() => setCycleArchived(cycle!.id, !cycle!.archived)}
      onRemove={() => removeCycle(cycle!.id)}
      onDone={onDone}
    />
  )
}

function toValues(item: { name: string; remarks: string; archived: boolean }, ids: string[]) {
  return { name: item.name, remarks: item.remarks, ids, archived: item.archived }
}

function Gone({ kind, onDone }: { kind: string; onDone: () => void }) {
  return (
    <>
      <ScreenHeader title={kind[0].toUpperCase() + kind.slice(1)} onBack={onDone} />
      <p className="muted">This {kind} no longer exists.</p>
    </>
  )
}
