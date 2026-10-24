'use client'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { ACTIVITY_KEY, useAuth } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { useQuery } from '@/lib/hooks'
import { NAV, ROLE_LABEL, canSee } from '@/lib/roles'
import { initials } from '@/lib/format'
import { cx, Icon, LoadingBlock, ToastProvider } from './ui'

function Logo() {
  return (
    <div className="leading-tight">
      <div className="text-[17px] font-semibold tracking-tight text-on-surface">Proof Clinics</div>
      <div className="text-[10.5px] uppercase tracking-[0.14em] text-outline mt-0.5">Hospital Management</div>
    </div>
  )
}

export function BrandMark() { return <Logo /> }

function Sidebar() {
  const path = usePathname()
  const { staff } = useAuth()
  const items = NAV.filter((n) => canSee(n, staff?.role))
  const groups = Array.from(new Set(items.map((n) => n.group)))
  return (
    <aside className="print:hidden fixed left-0 top-0 h-screen w-60 bg-surface-container-lowest border-r border-outline-variant/70 z-50 flex flex-col justify-between overflow-y-auto">
      <div className="flex flex-col">
        <div className="h-16 px-5 flex items-center border-b border-outline-variant/70"><Logo /></div>
        <nav className="flex flex-col py-3" aria-label="Main">
          {groups.map((g) => (
            <div key={g} className="mb-4">
              {g !== 'Overview' && <div className="px-5 pb-1 text-[10.5px] font-medium uppercase tracking-[0.12em] text-outline">{g}</div>}
              {items.filter((n) => n.group === g).map((n) => {
                const active = path === n.path || path.startsWith(n.path + '/')
                return (
                  <Link key={n.path} href={n.path} aria-current={active ? 'page' : undefined}
                    className={cx('block px-5 py-2 text-[13.5px] border-l-2 transition-colors',
                      active ? 'border-primary text-primary font-medium bg-primary-fixed/40' : 'border-transparent text-on-surface-variant hover:text-on-surface hover:bg-surface-container-low')}>
                    {n.label}
                  </Link>
                )
              })}
            </div>
          ))}
        </nav>
      </div>
    </aside>
  )
}

function TopBar() {
  const router = useRouter()
  const { staff, signOut } = useAuth()
  const [q, setQ] = useState('')
  const [menu, setMenu] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  const unread = useQuery(async () => {
    if (!staff) return 0
    const { count } = await supabase.from('notifications').select('id', { count: 'exact', head: true })
      .eq('recipient_staff_id', staff.id).is('read_at', null)
    return count ?? 0
  }, [staff?.id], ['notifications'])

  useEffect(() => {
    const h = (e: MouseEvent) => { if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenu(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  const count = unread.data ?? 0
  return (
    <header className="print:hidden fixed top-0 left-60 right-0 h-16 bg-surface-container-lowest border-b border-outline-variant/70 z-40 px-space-lg flex items-center justify-between gap-space-lg">
      <form className="flex-1 max-w-xl" onSubmit={(e) => { e.preventDefault(); if (q.trim().length >= 2) router.push(`/search?q=${encodeURIComponent(q.trim())}`) }}>
        <div className="relative flex items-center">
          <Icon name="search" className="absolute left-3 text-outline text-[18px]" />
          <input value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search patients"
            className="w-full pl-9 pr-4 h-9 rounded-lg border border-outline-variant bg-surface-container-low text-on-surface text-body-sm placeholder:text-outline focus:bg-surface-container-lowest focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors"
            placeholder="Search by name, Patient ID, phone or date of birth" />
        </div>
      </form>
      <div className="flex items-center gap-space-md">
        <Link href="/notifications" aria-label={`Notifications${count ? `, ${count} unread` : ''}`}
          className="relative w-9 h-9 inline-flex items-center justify-center rounded-lg text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface transition-colors">
          <Icon name="notifications" className="text-[22px]" />
          {count > 0 && <span className="absolute top-0.5 right-0 inline-flex h-[17px] min-w-[17px] px-1 items-center justify-center rounded-full bg-error text-[10px] font-semibold text-on-error">{count > 99 ? '99+' : count}</span>}
        </Link>
        <div className="h-6 w-px bg-outline-variant/60" />
        <div ref={menuRef} className="relative">
          <button type="button" onClick={() => setMenu((m) => !m)} className="flex items-center gap-2.5 hover:bg-surface-container-low px-2 py-1.5 rounded-lg transition-colors">
            <div className="w-8 h-8 rounded-full bg-primary text-on-primary flex items-center justify-center text-[11px] font-semibold tracking-wide">{initials(staff?.full_name)}</div>
            <div className="hidden md:flex flex-col text-left">
              <span className="text-[13px] text-on-surface leading-tight font-medium">{staff?.full_name}</span>
              <span className="text-label-xs text-on-surface-variant leading-tight">{staff ? ROLE_LABEL[staff.role] : ''}</span>
            </div>
          </button>
          {menu && (
            <div className="absolute right-0 mt-1 w-44 bg-surface-container-lowest rounded-lg shadow-lg border border-outline-variant/60 py-1 z-50">
              <button type="button" onClick={async () => { await signOut(); router.replace('/login') }}
                className="w-full flex items-center gap-2 text-left px-3 py-2 text-body-sm text-on-surface hover:bg-surface-container-low">
                <Icon name="logout" className="text-[18px] text-outline" />Sign out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}

const IDLE_MS = 15 * 60 * 1000
const WARN_MS = 60 * 1000
const ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart'] as const

// Signs the person out after 15 minutes without activity, with a one-minute warning first.
// Activity is shared across tabs through localStorage, so a second open tab does not keep a stale session alive.
function IdleSignOut() {
  const router = useRouter()
  const { signOut } = useAuth()
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null)
  const lastRef = useRef(0)
  const warningRef = useRef(false)

  useEffect(() => {
    const stored = () => { try { return Number(localStorage.getItem(ACTIVITY_KEY)) || 0 } catch { return 0 } }
    const touch = () => {
      const now = Date.now()
      if (now - lastRef.current < 1000) return
      lastRef.current = now
      try { localStorage.setItem(ACTIVITY_KEY, String(now)) } catch { /* storage unavailable */ }
    }
    lastRef.current = stored() || Date.now()
    touch()

    let done = false
    const leave = async () => {
      if (done) return
      done = true
      await signOut()
      router.replace('/login')
    }
    const onActivity = () => { if (!warningRef.current) touch() }
    ACTIVITY_EVENTS.forEach((e) => window.addEventListener(e, onActivity, { passive: true }))

    const tick = () => {
      const idle = Date.now() - Math.max(lastRef.current, stored())
      if (idle >= IDLE_MS) { void leave(); return }
      warningRef.current = idle >= IDLE_MS - WARN_MS
      setSecondsLeft(warningRef.current ? Math.ceil((IDLE_MS - idle) / 1000) : null)
    }
    tick()
    const timer = setInterval(tick, 1000)
    return () => {
      clearInterval(timer)
      ACTIVITY_EVENTS.forEach((e) => window.removeEventListener(e, onActivity))
    }
  }, [signOut, router])

  if (secondsLeft === null) return null
  return (
    <div role="alertdialog" aria-modal="true" aria-label="Session about to expire"
      className="print:hidden fixed inset-0 z-[100] flex items-center justify-center bg-black/40">
      <div className="w-full max-w-sm bg-surface-container-lowest rounded-lg shadow-lg border border-outline-variant/60 p-6 flex flex-col gap-3">
        <h2 className="text-headline-md">Still there?</h2>
        <p className="text-body-sm text-on-surface-variant">
          You will be signed out in {secondsLeft} second{secondsLeft === 1 ? '' : 's'} because there has been no activity.
        </p>
        <button type="button" autoFocus
          onClick={() => { warningRef.current = false; lastRef.current = 0; setSecondsLeft(null); window.dispatchEvent(new Event('mousedown')) }}
          className="self-end px-4 py-2 rounded-lg bg-primary text-on-primary text-body-md-medium">
          Stay signed in
        </button>
      </div>
    </div>
  )
}

// Paths every signed-in member of staff may open (they are reached from search, the bell and bed cards, not the menu).
const OPEN_PATHS = ['/notifications', '/search', '/patients', '/discharge']

export function Shell({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const path = usePathname()
  const { staff, session, loading } = useAuth()

  useEffect(() => { if (!loading && !session) router.replace('/login') }, [loading, session, router])

  if (loading || !session || !staff) {
    return <div className="min-h-screen flex items-center justify-center bg-background"><LoadingBlock label={!loading && session && !staff ? 'Checking your staff account…' : 'Loading…'} /></div>
  }

  const item = NAV.find((n) => path === n.path || path.startsWith(n.path + '/'))
  const open = OPEN_PATHS.some((p) => path === p || path.startsWith(p + '/'))
  const allowed = open || (item ? canSee(item, staff.role) : true)

  return (
    <ToastProvider>
      <IdleSignOut />
      <Sidebar />
      <div className="pl-60 print:pl-0 min-h-screen flex flex-col bg-background print:bg-white">
        <TopBar />
        <main className="flex-1 w-full pt-16 print:pt-0 bg-background print:bg-white">
          <div className="flex flex-col w-full px-10 py-9 gap-9 max-w-[1500px] print:p-0">
            {allowed ? children : (
              <div className="flex flex-col items-center justify-center gap-2 py-24 text-center">
                <h1 className="text-headline-md">You do not have access to this page</h1>
                <p className="text-body-sm text-on-surface-variant">Your role ({ROLE_LABEL[staff.role]}) does not use this screen.</p>
                <Link href="/dashboard" className="mt-2 text-primary text-body-md-medium hover:underline">Back to the dashboard</Link>
              </div>
            )}
          </div>
        </main>
      </div>
    </ToastProvider>
  )
}
