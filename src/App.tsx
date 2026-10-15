import { useEffect, useState } from 'react'
import { db } from './db'

export default function App() {
  const [dbStatus, setDbStatus] = useState('Opening database…')

  useEffect(() => {
    db.open()
      .then(() => setDbStatus('Database ready'))
      .catch((err: unknown) => setDbStatus(`Database error: ${String(err)}`))
  }, [])

  return (
    <main className="shell">
      <h1>Gym Log</h1>
      <p className="muted">{dbStatus}</p>
    </main>
  )
}
