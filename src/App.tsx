import { useState } from 'react'
import { Manage } from './manage/Manage'
import { ScreenHeader } from './manage/ui'

type Tab = 'home' | 'history' | 'manage'

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'home', label: 'Home', icon: '⌂' },
  { id: 'history', label: 'History', icon: '☰' },
  { id: 'manage', label: 'Manage', icon: '⚙' },
]

const TAB_KEY = 'gym-log:tab'

function initialTab(): Tab {
  try {
    const saved = localStorage.getItem(TAB_KEY)
    if (TABS.some((t) => t.id === saved)) return saved as Tab
  } catch {
    // Storage blocked: fall back to Home.
  }
  return 'home'
}

export default function App() {
  const [tab, setTab] = useState<Tab>(initialTab)

  function select(next: Tab) {
    setTab(next)
    window.scrollTo(0, 0)
    try {
      localStorage.setItem(TAB_KEY, next)
    } catch {
      // Ignore: remembering the tab is a convenience.
    }
  }

  return (
    <>
      <main className="shell">
        {tab === 'home' && <Placeholder title="Gym Log" text="Sessions arrive in the next build step." />}
        {tab === 'history' && <Placeholder title="History" text="Past sessions arrive in a later build step." />}
        {tab === 'manage' && <Manage />}
      </main>
      <nav className="tabbar" aria-label="Main">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={tab === t.id ? 'tab on' : 'tab'}
            aria-current={tab === t.id ? 'page' : undefined}
            onClick={() => select(t.id)}
          >
            <span className="tab-icon" aria-hidden="true">
              {t.icon}
            </span>
            {t.label}
          </button>
        ))}
      </nav>
    </>
  )
}

function Placeholder({ title, text }: { title: string; text: string }) {
  return (
    <>
      <ScreenHeader title={title} />
      <p className="muted">{text}</p>
    </>
  )
}
