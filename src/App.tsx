import { useState } from 'react'
import { History, type HistoryView } from './history/History'
import { Manage } from './manage/Manage'
import { HomeTab, type HomeView } from './session/HomeTab'

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
  // Kept here so switching tabs mid-session returns to the same screen.
  const [homeView, setHomeView] = useState<HomeView>({ screen: 'home' })
  const [historyView, setHistoryView] = useState<HistoryView>({ screen: 'list' })

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
        {tab === 'home' && <HomeTab view={homeView} setView={setHomeView} />}
        {tab === 'history' && (
          <History
            view={historyView}
            setView={setHistoryView}
            onResume={() => {
              setHomeView({ screen: 'session' })
              select('home')
            }}
          />
        )}
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

