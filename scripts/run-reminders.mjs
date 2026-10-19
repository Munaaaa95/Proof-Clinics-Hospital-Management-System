// Runs the reminder scheduler (spec 12, 25) once, or every 5 minutes with --loop.
// pg_cron does this automatically where it is available; use this script when it is not, or to trigger
// reminders during a rehearsal. Delivery in the demo is the `reminders` table plus in-app notifications.
// Usage: node --env-file=.env scripts/run-reminders.mjs [--loop]
// Uses the service role key (server-side only).
import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) { console.error('Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env'); process.exit(1) }
const db = createClient(url, key, { auth: { persistSession: false } })

async function run() {
  const { data, error } = await db.rpc('run_reminders')
  if (error) { console.error(`${new Date().toISOString()}  run_reminders failed: ${error.message}`); return }
  console.log(`${new Date().toISOString()}  appointments ${data.appointments}, medication ${data.medication}, ANC follow-ups ${data.anc_follow_ups}`)
}

await run()
if (process.argv.includes('--loop')) {
  console.log('Looping every 5 minutes. Ctrl+C to stop.')
  setInterval(run, 5 * 60 * 1000)
}
