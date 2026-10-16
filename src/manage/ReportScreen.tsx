import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import {
  backupFile,
  getLastExport,
  importBackup,
  parseBackup,
  readAllTables,
  setLastExport,
  tableCounts,
  type Backup,
} from '../backup'
import { defaultRange, loadReport, previewText, rangeBounds, reportFile } from '../report'
import { formatDate } from '../session/format'
import { shareOrDownload, type ShareOutcome } from '../share'
import { Field } from './ui'

// Manage → Report: the trainer report (spec section 5) and backup (section 6).

export function ReportScreen() {
  return (
    <>
      <ReportSection />
      <BackupSection />
      <StorageStatus />
    </>
  )
}

function outcomeText(outcome: ShareOutcome, name: string): string {
  if (outcome === 'shared') return `Shared ${name}.`
  if (outcome === 'downloaded') return `Downloaded ${name}.`
  return ''
}

// ---------- Report ----------

function ReportSection() {
  const [range, setRange] = useState(defaultRange)
  const [file, setFile] = useState<File | null>(null)
  const [message, setMessage] = useState('')

  let rangeError = ''
  try {
    rangeBounds(range.start, range.end)
  } catch (e) {
    rangeError = e instanceof Error ? e.message : String(e)
  }
  const report = useLiveQuery(
    () => (rangeError ? undefined : loadReport(range.start, range.end)),
    [range.start, range.end, rangeError],
  )

  function change(next: Partial<typeof range>) {
    setRange({ ...range, ...next })
    setFile(null)
    setMessage('')
  }

  function generate() {
    if (!report || report.rows.length === 0) return
    setFile(reportFile(report, range.start, range.end))
    setMessage('')
  }

  async function share() {
    if (!file) return
    // No await before this call: iOS needs share() inside the tap.
    setMessage(outcomeText(await shareOrDownload(file), file.name))
  }

  const empty = report && report.rows.length === 0

  return (
    <>
      <h2 className="section-title section-title-first">Trainer report</h2>
      <div className="field-row field-row-2">
        <Field label="Start date">
          <input type="date" value={range.start} max={range.end} onChange={(e) => change({ start: e.target.value })} />
        </Field>
        <Field label="End date">
          <input type="date" value={range.end} min={range.start} onChange={(e) => change({ end: e.target.value })} />
        </Field>
      </div>
      {rangeError ? (
        <p className="errors" role="alert">
          {rangeError}
        </p>
      ) : empty ? (
        <p className="notice">No logged sessions started in this range. Choose other dates.</p>
      ) : (
        <p className="notice">{report ? previewText(report) : ' '}</p>
      )}
      <button type="button" className="btn btn-primary btn-wide" disabled={!report || !!empty || !!rangeError} onClick={generate}>
        Generate Excel
      </button>
      {file && (
        <section className="card file-card">
          <span className="card-label">Ready</span>
          <span className="card-title">{file.name}</span>
          <button type="button" className="btn btn-primary btn-wide" onClick={share}>
            Share
          </button>
        </section>
      )}
      {message && <p className="notice notice-ok">{message}</p>}
    </>
  )
}

// ---------- Backup ----------

const COUNT_LABELS: [keyof ReturnType<typeof tableCounts>, string, string][] = [
  ['exercises', 'exercise', 'exercises'],
  ['routines', 'routine', 'routines'],
  ['cycles', 'cycle', 'cycles'],
  ['sessions', 'session', 'sessions'],
  ['logs', 'log', 'logs'],
]

function countsText(backup: Backup): string {
  const counts = tableCounts(backup.tables)
  return COUNT_LABELS.map(([key, one, many]) => `${counts[key]} ${counts[key] === 1 ? one : many}`).join(', ')
}

function BackupSection() {
  // Kept loaded so "Export backup" can build the file and share it within the tap.
  const tables = useLiveQuery(readAllTables)
  const [lastExport, setLastExportState] = useState(getLastExport)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [pending, setPending] = useState<{ backup: Backup; name: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  async function exportBackup() {
    if (!tables) return
    setError('')
    const now = new Date()
    const file = backupFile(tables, now)
    // No await before this call: iOS needs share() inside the tap.
    const outcome = await shareOrDownload(file)
    if (outcome !== 'cancelled') {
      setLastExport(now)
      setLastExportState(now.toISOString())
    }
    setMessage(outcomeText(outcome, file.name))
  }

  async function pick(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    setMessage('')
    setError('')
    setPending(null)
    if (!file) return
    const result = parseBackup(await file.text())
    if (!result.ok) setError(`Cannot import ${file.name}: ${result.error}`)
    else setPending({ backup: result.backup, name: file.name })
  }

  async function confirmImport() {
    if (!pending) return
    setBusy(true)
    try {
      await importBackup(pending.backup)
      setMessage(`Imported ${pending.name}: ${countsText(pending.backup)}.`)
      setPending(null)
    } catch (e) {
      setError(`Import failed, nothing was changed. ${e instanceof Error ? e.message : String(e)}`)
      setPending(null)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <h2 className="section-title">Backup</h2>
      <p className="muted backup-last">
        {lastExport ? `Last export: ${formatDate(lastExport)}.` : 'No backup exported from this device yet.'}
      </p>
      <button type="button" className="btn btn-primary btn-wide" disabled={!tables} onClick={exportBackup}>
        Export backup
      </button>
      <button type="button" className="btn btn-wide" onClick={() => input.current?.click()}>
        Import backup
      </button>
      <input ref={input} type="file" accept="application/json,.json" hidden onChange={pick} />

      {pending && (
        <section className="card confirm-card" role="alertdialog" aria-label="Confirm import">
          <span className="card-label">Replace all data?</span>
          <span className="card-title">{pending.name}</span>
          <span>
            Exported {formatDate(pending.backup.exportedAt)}. Contains {countsText(pending.backup)}.
          </span>
          <span className="confirm-warning">All current data on this phone will be deleted and replaced.</span>
          <div className="actions">
            <button type="button" className="btn btn-danger" disabled={busy} onClick={confirmImport}>
              Replace all data
            </button>
            <button type="button" className="btn" disabled={busy} onClick={() => setPending(null)}>
              Cancel
            </button>
          </div>
        </section>
      )}
      {error && (
        <p className="errors" role="alert">
          {error}
        </p>
      )}
      {message && <p className="notice notice-ok">{message}</p>}
    </>
  )
}

// ---------- Storage ----------

function StorageStatus() {
  const [persisted, setPersisted] = useState<boolean | null | undefined>(undefined)
  useEffect(() => {
    if (!navigator.storage?.persisted) {
      setPersisted(null)
      return
    }
    navigator.storage.persisted().then(setPersisted, () => setPersisted(null))
  }, [])
  if (persisted === undefined) return null
  return (
    <p className={persisted ? 'notice notice-ok storage-status' : 'notice storage-status'}>
      {persisted === null
        ? 'Persistent storage: not supported by this browser.'
        : persisted
          ? 'Persistent storage: granted. The browser will not clear this data on its own.'
          : 'Persistent storage: not granted. Export backups regularly.'}
    </p>
  )
}
