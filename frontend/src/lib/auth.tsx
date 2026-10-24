'use client'
import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabase'
import type { StaffRole } from './roles'

export interface Staff { id: string; full_name: string; role: StaffRole; department: string | null; position: string | null }

interface AuthState {
  session: Session | null
  staff: Staff | null
  loading: boolean
  signIn: (email: string, password: string) => Promise<string | null>
  signOut: () => Promise<void>
}

const Ctx = createContext<AuthState | null>(null)
export const useAuth = () => {
  const v = useContext(Ctx)
  if (!v) throw new Error('useAuth outside AuthProvider')
  return v
}

// Last-activity timestamp shared across tabs; the idle sign-out in Shell reads it.
export const ACTIVITY_KEY = 'hms:last-activity'
const clearActivity = () => { try { localStorage.removeItem(ACTIVITY_KEY) } catch { /* storage unavailable */ } }

const STAFF_COLS ='id, full_name, role, department, position, active'

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [staff, setStaff] = useState<Staff | null>(null)
  const [loading, setLoading] = useState(true)

  const loadStaff = useCallback(async (s: Session | null) => {
    if (!s) { setStaff(null); return }
    const { data, error } = await supabase.from('staff').select(STAFF_COLS).eq('id', s.user.id).maybeSingle()
    if (error) return // a failed read (for example during a token refresh) must not sign the person out of the screen
    setStaff(data && data.active !== false ? (data as Staff) : null)
  }, [])

  useEffect(() => {
    let alive = true
    supabase.auth.getSession().then(async ({ data }) => {
      if (!alive) return
      setSession(data.session)
      await loadStaff(data.session)
      if (alive) setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s)
      // Do not await Supabase calls inside this callback (it can deadlock); defer them.
      if (event === 'SIGNED_OUT') setStaff(null)
      else setTimeout(() => { void loadStaff(s) }, 0)
    })
    return () => { alive = false; sub.subscription.unsubscribe() }
  }, [loadStaff])

  const signIn = useCallback(async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) return error.message === 'Invalid login credentials' ? 'Wrong email or password.' : error.message
    const { data: row } = await supabase.from('staff').select(STAFF_COLS).eq('id', data.user.id).maybeSingle()
    if (!row || row.active === false) {
      await supabase.auth.signOut()
      return 'This account is not an active staff account.'
    }
    clearActivity()
    setSession(data.session)
    setStaff(row as Staff)
    await supabase.rpc('record_login')
    return null
  }, [])

  const signOut = useCallback(async () => {
    await supabase.rpc('record_logout')
    await supabase.auth.signOut()
    clearActivity()
    setStaff(null)
  }, [])

  return <Ctx.Provider value={{ session, staff, loading, signIn, signOut }}>{children}</Ctx.Provider>
}
