// Proves real-time propagation between separate logged-in sessions (spec 31, build plan Week 1 gate):
// one user acts, another user's open connection receives the change without refreshing.
// Also proves real-time respects permissions.
// Usage: node --env-file=.env scripts/realtime-check.mjs
import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const password = process.env.DEMO_PASSWORD

let passed = 0, failed = 0
const check = (name, ok, detail = '') => { ok ? passed++ : failed++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name} ${ok ? '' : detail}`) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function login(email) {
  const c = createClient(url, anon, { auth: { persistSession: false } })
  const { data, error } = await c.auth.signInWithPassword({ email, password })
  if (error) throw new Error(`${email}: ${error.message}`)
  c.uid = data.user.id
  c.realtime.setAuth(data.session.access_token)
  return c
}

// Listen to a table and collect events; resolves once SUBSCRIBED.
async function listen(client, table, filter) {
  const events = []
  const channel = client.channel(`rt-${table}-${Math.random().toString(36).slice(2)}`)
    .on('postgres_changes', { event: '*', schema: 'public', table, ...(filter ? { filter } : {}) }, (p) => events.push(p))
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`subscribe timeout on ${table}`)), 15000)
    channel.subscribe((status) => { if (status === 'SUBSCRIBED') { clearTimeout(t); resolve() } })
  })
  return { events, channel }
}
const waitFor = async (fn, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end) { if (fn()) return true; await sleep(150) } return false }

const reception = await login('reception@proofclinics.test')
const doctor = await login('doctor@proofclinics.test')
const nurse = await login('nurse@proofclinics.test')
const lab = await login('lab@proofclinics.test')
const pharmacy = await login('pharmacy@proofclinics.test')
const billing = await login('billing@proofclinics.test')

const stamp = Date.now().toString().slice(-6)

console.log('\nWeek 1 gate: registration -> queue appears live for the doctor')
const doctorQueue = await listen(doctor, 'visits')
const doctorNotes = await listen(doctor, 'notifications', `recipient_staff_id=eq.${doctor.uid}`)
const nurseNotes = await listen(nurse, 'notifications', `recipient_staff_id=eq.${nurse.uid}`)
const labReqsForReception = await listen(reception, 'lab_requests')   // reception must NOT receive these
const labReqsForLab = await listen(lab, 'lab_requests')
const labFeed = await listen(lab, 'notifications', `recipient_staff_id=eq.${lab.uid}`)
const bedFeed = await listen(nurse, 'beds')
const billFeed = await listen(billing, 'bill_items')
const rxFeed = await listen(pharmacy, 'prescriptions')

const reg = (await reception.rpc('register_patient', {
  p_full_name: `Realtime Test${stamp}`, p_dob: '1991-03-03', p_sex: 'female', p_phone: `0809${stamp}1`, p_address: null,
  p_kin_name: 'RT Kin', p_kin_phone: '08090000001', p_kin_relationship: 'mother', p_kin_relationship_other: null, p_force: false,
})).data
const visitId = (await reception.rpc('check_in_patient', { p_patient_id: reg.patient_id, p_complaint: 'Realtime check' })).data

check('doctor\'s open queue received the new visit', await waitFor(() => doctorQueue.events.some((e) => e.eventType === 'INSERT' && e.new.id === visitId)))
check('doctor\'s bell received the notification', await waitFor(() => doctorNotes.events.some((e) => e.new?.patient_id === reg.patient_id)))
check('the nurse did not receive the doctor\'s notification', !nurseNotes.events.some((e) => e.new?.patient_id === reg.patient_id))

console.log('\nLab request reaches the lab live, and not reception')
await doctor.rpc('start_consultation', { p_visit_id: visitId })
const svc = (await doctor.from('services').select('id').eq('name', 'Urinalysis').single()).data
const lr = (await doctor.from('lab_requests').insert({ patient_id: reg.patient_id, visit_id: visitId, service_id: svc.id }).select('id').single()).data
check('lab screen received the request', await waitFor(() => labReqsForLab.events.some((e) => e.new?.id === lr.id)))
check('lab notification arrived', await waitFor(() => labFeed.events.some((e) => e.new?.patient_id === reg.patient_id)))
await sleep(1500)
check('reception did NOT receive lab requests (permissions apply to real-time)', !labReqsForReception.events.some((e) => e.new?.id === lr.id))

console.log('\nPrescription reaches pharmacy live; billing updates live')
const para = (await doctor.from('drugs').select('id').eq('name', 'Ibuprofen 400mg').single()).data
const rx = (await doctor.from('prescriptions').insert({
  patient_id: reg.patient_id, visit_id: visitId, drug_id: para.id, dose: '400mg', route: 'oral', frequency: 'BD', quantity: 2,
}).select('id').single()).data
check('pharmacy screen received the prescription', await waitFor(() => rxFeed.events.some((e) => e.new?.id === rx.id)))
check('billing screen received the lab charge live', await waitFor(() => billFeed.events.some((e) => e.new?.patient_id === reg.patient_id && e.new?.category === 'lab')))

console.log('\nAdmission flips the bed on the nurse\'s board live')
const bed = (await doctor.from('beds').select('id').eq('status', 'available').limit(1).single()).data
await doctor.rpc('admit_patient', { p_visit_id: visitId, p_bed_id: bed.id, p_diagnosis: 'Observation', p_nurse_id: nurse.uid })
check('nurse\'s bed board saw the bed become occupied',
  await waitFor(() => bedFeed.events.some((e) => e.new?.id === bed.id && e.new?.status === 'occupied')))
check('nurse was notified of the admission', await waitFor(() => nurseNotes.events.some((e) => e.new?.patient_id === reg.patient_id)))

const adm = (await doctor.from('admissions').select('id').eq('patient_id', reg.patient_id).eq('status', 'active').single()).data
await doctor.rpc('discharge_patient', { p_admission_id: adm.id, p_summary: 'Realtime check done' })
check('discharge released the bed on the board live',
  await waitFor(() => bedFeed.events.some((e) => e.new?.id === bed.id && e.new?.status === 'available')))

for (const c of [doctorQueue, doctorNotes, nurseNotes, labReqsForReception, labReqsForLab, labFeed, bedFeed, billFeed, rxFeed]) await c.channel.unsubscribe()
console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
