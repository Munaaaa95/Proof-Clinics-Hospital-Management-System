import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

// Remove any session an earlier version left in browser storage, so it cannot log a new tab in.
if (typeof window !== 'undefined') {
  for (const store of [window.localStorage, window.sessionStorage]) {
    try {
      Object.keys(store)
        .filter(k => k.startsWith('sb-') && k.endsWith('-auth-token'))
        .forEach(k => store.removeItem(k))
    } catch { /* storage unavailable */ }
  }
}

// The session is held in memory only. Closing, reopening or duplicating a tab, or refreshing the page,
// starts signed out, because nothing is written to the browser for the next page to pick up.
const memory = new Map<string, string>()
const memoryStorage = {
  getItem: (k: string) => memory.get(k) ?? null,
  setItem: (k: string, v: string) => { memory.set(k, v) },
  removeItem: (k: string) => { memory.delete(k) },
}

// One browser client. Every query runs as the signed-in staff member, so the database's row-level
// security decides what each role may see and do.
export const supabase = createClient(url, anon, {
  auth: { persistSession: true, autoRefreshToken: true, storage: memoryStorage },
})
