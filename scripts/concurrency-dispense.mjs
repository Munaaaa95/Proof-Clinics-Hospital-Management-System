// Proves stock-reducing dispense is safe when several pharmacists click at the same moment (build plan 2.5:
// "two pharmacists could dispense at the same time"). Fires real parallel calls from separate logged-in sessions.
// Uses its own test drug, so the Paracetamol 100 -> 90 demo number is untouched.
// Usage: node --env-file=.env scripts/concurrency-dispense.mjs
// Needs the service role key (test setup only). Fake data only; never run against real records.
import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const password = process.env.DEMO_PASSWORD
if (!url || !anon || !serviceKey || !password) {
  console.error('Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY and DEMO_PASSWORD in .env')
  process.exit(1)
}

const ROUNDS = 5
let passed = 0, failed = 0
const check = (name, ok, detail = '') => { ok ? passed++ : failed++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name} ${ok ? '' : detail}`) }
const section = (t) => console.log(`\n${t}`)
const must = ({ data, error }, what) => { if (error) throw new Error(`${what}: ${error.message}`); return data }

const svc = createClient(url, serviceKey, { auth: { persistSession: false } })
async function pharmacist() {
  const c = createClient(url, anon, { auth: { persistSession: false } })
  const { error } = await c.auth.signInWithPassword({ email: 'pharmacy@proofclinics.test', password })
  if (error) throw new Error(`login pharmacy: ${error.message}`)
  return c
}
// Four separate sessions, so the calls really are separate connections' worth of requests.
const sessions = await Promise.all([pharmacist(), pharmacist(), pharmacist(), pharmacist()])

// ---- test setup
const doctor = must(await svc.from('staff').select('id').eq('role', 'doctor').order('staff_code').limit(1).single(), 'doctor').id
const drug = must(await svc.from('drugs').upsert({ name: 'Concurrency Test Tablet', unit: 'tablet', min_stock: 0, unit_price: 1 }, { onConflict: 'name' }).select('id').single(), 'drug')
const patient = must(await svc.from('patients').insert({ full_name: `Concurrency Test ${Date.now().toString().slice(-6)}`, dob: '1980-01-01', sex: 'male' }).select('id').single(), 'patient')
const visit = must(await svc.from('visits').insert({ patient_id: patient.id, visit_type: 'outpatient', department: 'General', status: 'in_consultation', doctor_id: doctor }).select('id').single(), 'visit')

const setStock = async (...quantities) => {
  // Batches are referenced by the stock ledger, so they are emptied rather than deleted.
  must(await svc.from('stock_batches').update({ quantity: 0 }).eq('drug_id', drug.id).gt('quantity', 0), 'empty old batches')
  const future = (n) => new Date(Date.now() + n * 86400e3).toISOString().slice(0, 10)
  for (const [i, q] of quantities.entries()) {
    must(await svc.from('stock_batches').insert({ drug_id: drug.id, batch_number: `CT-${i}`, expiry_date: future(100 + i * 100), quantity: q }), 'batch')
  }
}
const newRx = async (quantity) => must(await svc.from('prescriptions').insert({
  patient_id: patient.id, visit_id: visit.id, drug_id: drug.id, dose: '1', route: 'oral', frequency: 'OD',
  duration_days: 1, quantity, prescribed_by: doctor,
}).select('id').single(), 'prescription').id
const stockLeft = async () => must(await svc.from('stock_batches').select('quantity').eq('drug_id', drug.id), 'stock').reduce((s, b) => s + b.quantity, 0)
const dispensedFor = async (ids) => must(await svc.from('dispensing').select('quantity').in('prescription_id', ids), 'dispensing').reduce((s, d) => s + d.quantity, 0)
// Fire the calls together; each is [session, prescription id]
const fire = (calls) => Promise.all(calls.map(([s, id]) => s.rpc('dispense_prescription', { p_prescription_id: id })))
const won = (results) => results.filter((r) => !r.error).length

section(`1. Two pharmacists dispense the SAME prescription (${ROUNDS} rounds)`)
for (let i = 1; i <= ROUNDS; i++) {
  await setStock(100)
  const rx = await newRx(10)
  const res = await fire([[sessions[0], rx], [sessions[1], rx], [sessions[2], rx]])
  const left = await stockLeft()
  check(`round ${i}: exactly one succeeded, stock 100 -> ${left}, dispensed once`,
    won(res) === 1 && left === 90 && (await dispensedFor([rx])) === 10,
    `successes=${won(res)} left=${left} errors=${res.filter((r) => r.error).map((r) => r.error.message).join(' | ')}`)
}

section(`2. Two prescriptions compete for stock that covers only one (${ROUNDS} rounds)`)
for (let i = 1; i <= ROUNDS; i++) {
  await setStock(10)
  const a = await newRx(10), b = await newRx(10)
  const res = await fire([[sessions[0], a], [sessions[1], b]])
  const left = await stockLeft()
  const failure = res.find((r) => r.error)?.error?.message ?? ''
  check(`round ${i}: one succeeded, one refused, stock never negative (left ${left})`,
    won(res) === 1 && left === 0 && /insufficient/i.test(failure) && (await dispensedFor([a, b])) === 10, `successes=${won(res)} left=${left} err=${failure}`)
}

section(`3. Stock spread over two batches, partial fill is all-or-nothing (${ROUNDS} rounds)`)
for (let i = 1; i <= ROUNDS; i++) {
  await setStock(6, 6)      // 12 in total: one request for 10 fits, a second cannot
  const a = await newRx(10), b = await newRx(10)
  const res = await fire([[sessions[0], a], [sessions[1], b]])
  const left = await stockLeft()
  const rows = must(await svc.from('stock_batches').select('quantity').eq('drug_id', drug.id), 'batches')
  check(`round ${i}: one filled across both batches, the loser took nothing (left ${left})`,
    won(res) === 1 && left === 2 && rows.every((r) => r.quantity >= 0) && (await dispensedFor([a, b])) === 10, `successes=${won(res)} left=${left}`)
}

section(`4. Six prescriptions of 5 against 20 tablets, four sessions in parallel (${ROUNDS} rounds)`)
for (let i = 1; i <= ROUNDS; i++) {
  await setStock(20)
  const ids = []
  for (let k = 0; k < 6; k++) ids.push(await newRx(5))
  const res = await fire(ids.map((id, k) => [sessions[k % sessions.length], id]))
  const left = await stockLeft()
  check(`round ${i}: exactly four filled, stock exactly 0, no deadlock (left ${left})`,
    won(res) === 4 && left === 0 && (await dispensedFor(ids)) === 20, `successes=${won(res)} left=${left} errors=${res.filter((r) => r.error).map((r) => r.error.message).join(' | ')}`)
}

section('5. Bill is created once per visit despite parallel dispenses')
const bills = must(await svc.from('bills').select('id').eq('visit_id', visit.id), 'bills')
check('one bill for the visit', bills.length === 1, `bills=${bills.length}`)
const items = must(await svc.from('bill_items').select('quantity').eq('bill_id', bills[0].id).eq('category', 'pharmacy'), 'bill items')
const billed = items.reduce((s, i) => s + Number(i.quantity), 0)
const allRx = must(await svc.from('prescriptions').select('id').eq('visit_id', visit.id), 'rx')
check(`billed tablets equal dispensed tablets (${billed})`, billed === (await dispensedFor(allRx.map((r) => r.id))))

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
