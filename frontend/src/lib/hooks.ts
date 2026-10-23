'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from './supabase'

export interface Query<T> { data: T | null; loading: boolean; error: string | null; reload: () => void }

let channelCount = 0

// Call onChange whenever one of the tables changes (Supabase Realtime). RLS applies to realtime, so a role only
// hears about rows it may read. Bursts of events are collapsed into one call.
export function useLive(tables: string[], onChange: () => void, filter?: { table: string; filter: string }) {
  const cb = useRef(onChange)
  cb.current = onChange
  const key = tables.join(',') + (filter ? `|${filter.table}:${filter.filter}` : '')
  useEffect(() => {
    if (!tables.length && !filter) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const fire = () => { clearTimeout(timer); timer = setTimeout(() => cb.current(), 250) }
    let ch = supabase.channel(`live-${++channelCount}`)
    for (const t of tables) ch = ch.on('postgres_changes', { event: '*', schema: 'public', table: t }, fire)
    if (filter) ch = ch.on('postgres_changes', { event: '*', schema: 'public', table: filter.table, filter: filter.filter }, fire)
    ch.subscribe()
    return () => { clearTimeout(timer); void supabase.removeChannel(ch) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
}

// Run an async loader with loading/error state and reload(). Re-runs when deps change, and quietly (no spinner)
// whenever one of the listed tables changes in real time.
export function useQuery<T>(loader: () => Promise<T>, deps: unknown[] = [], tables: string[] = []): Query<T> {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const loaderRef = useRef(loader)
  loaderRef.current = loader
  const seq = useRef(0)

  const run = useCallback(async (quiet: boolean) => {
    const n = ++seq.current
    if (!quiet) setLoading(true)
    try {
      const d = await loaderRef.current()
      if (n === seq.current) { setData(d); setError(null) }
    } catch (e) {
      if (n === seq.current) setError(e instanceof Error ? e.message : String((e as { message?: string })?.message ?? e))
    } finally {
      if (n === seq.current) setLoading(false)
    }
  }, [])

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void run(false) }, deps)
  useLive(tables, () => { void run(true) })
  return { data, loading, error, reload: () => { void run(true) } }
}

export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value)
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t) }, [value, ms])
  return v
}

// Unwrap a Supabase response: throw the database's error message so the UI can show it.
export function ok<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message)
  return res.data as T
}
