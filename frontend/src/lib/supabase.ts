import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

// One browser client. The session lives in localStorage; every query runs as the signed-in staff member,
// so the database's row-level security decides what each role may see and do.
export const supabase = createClient(url, anon, {
  auth: { persistSession: true, autoRefreshToken: true },
})
