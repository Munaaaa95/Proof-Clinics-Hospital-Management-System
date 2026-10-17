// End-to-end test of the demo script (build plan section 8) against the real backend,
// logging in as each role with the public anon key so Row-Level Security is really exercised.
// Usage: node --env-file=.env scripts/e2e-demo-flow.mjs
// Note: it leaves its test patients in the database (nothing is deletable by design).
import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const password = process.env.DEMO_PASSWORD

const emails = {
  admin: 'admin@proofclinics.test', reception: 'reception@proofclinics.test',
  doctor: 'doctor@proofclinics.test', nurse: 'nurse@proofclinics.test',
  lab: 'lab@proofclinics.test', pharmacy: 'pharmacy@proofclinics.test',
  billing: 'billing@proofclinics.test',
}

let passed = 0, failed = 0
const check = (name, ok, detail = '') => {
  if (ok) { passed++; console.log(`  PASS  ${name}`) }
  else { failed++; console.log(`  FAIL  ${name} ${detail}`) }
}
const section = (t) => console.log(`\n${t}`)
const must = ({ data, error }, what) => {
  if (error) throw new Error(`${what}: ${error.message}`)
  return data
}

const c = {}
for (const [k, email] of Object.entries(emails)) {
  c[k] = createClient(url, anon, { auth: { persistSession: false } })
  const { data, error } = await c[k].auth.signInWithPassword({ email, password })
  if (error) throw new Error(`login ${k}: ${error.message}`)
  c[k].uid = data.user.id
  must(await c[k].rpc('record_login'), 'record_login')
}

const stamp = Date.now().toString().slice(-6)
const name = `Michael Nelson${stamp}`
const dob = '1985-04-12'
const phone = `0803${stamp}9`

section('1. Registration and duplicate alert')
const reg = (n, p) => c.reception.rpc('register_patient', {
  p_full_name: n, p_dob: dob, p_sex: 'male', p_phone: p, p_address: 'Lagos',
  p_kin_name: 'Jane Nelson', p_kin_phone: '08031112222', p_kin_relationship: 'spouse',
  p_kin_relationship_other: null, p_force: false,
})
const r1 = must(await reg(name, phone), 'register')
check('patient created with a Patient ID', r1.status === 'created' && /^PC-\d{6}$/.test(r1.patient_code), JSON.stringify(r1))
const r2 = must(await reg(name, phone), 'register again')
check('second registration triggers duplicate alert', r2.status === 'duplicate' && r2.matches.length > 0)
const patientId = r1.patient_id

const badKin = await c.reception.rpc('register_patient', {
  p_full_name: `Kin Test${stamp}`, p_dob: '1990-01-01', p_sex: 'female', p_phone: null, p_address: null,
  p_kin_name: 'X', p_kin_phone: '1', p_kin_relationship: 'other', p_kin_relationship_other: '',
  p_force: false,
})
check('relationship "Other" requires a description', !!badKin.error)

check('receptionist cannot write allergies', !!(await c.reception.from('patients').update({ allergies: 'penicillin' }).eq('id', patientId)).error)

section('2. Check-in, queue and doctor notification')
const visitId = must(await c.reception.rpc('check_in_patient', {
  p_patient_id: patientId, p_visit_type: 'outpatient', p_department: 'General', p_complaint: 'Fever for 3 days',
}), 'check_in')
check('patient is in the waiting queue',
  (await c.doctor.from('visits').select('id,status').eq('id', visitId).single()).data?.status === 'waiting')
check('second check-in blocked while visit open', !!(await c.reception.rpc('check_in_patient', { p_patient_id: patientId })).error)
const docNotes = (await c.doctor.from('notifications').select('title,patient_id').eq('patient_id', patientId)).data ?? []
check('doctor was notified', docNotes.some((n) => n.title.includes('waiting for consultation')))
check('nurse sees no doctor-only notification',
  ((await c.nurse.from('notifications').select('id').eq('patient_id', patientId)).data ?? []).length === 0)

section('3. Consultation, diagnosis, lab request, prescription')
must(await c.doctor.rpc('start_consultation', { p_visit_id: visitId }), 'start_consultation')
must(await c.nurse.from('vitals').insert({
  patient_id: patientId, visit_id: visitId, temperature_c: 38.4, pulse: 96, resp_rate: 20,
  bp_systolic: 120, bp_diastolic: 80, weight_kg: 74,
}), 'vitals')
check('receptionist cannot enter a diagnosis',
  !!(await c.reception.from('diagnoses').insert({ patient_id: patientId, visit_id: visitId, diagnosis: 'Malaria' })).error)
check('nurse cannot enter a diagnosis',
  !!(await c.nurse.from('diagnoses').insert({ patient_id: patientId, visit_id: visitId, diagnosis: 'Malaria' })).error)
must(await c.doctor.from('consultations').insert({ patient_id: patientId, visit_id: visitId, notes: 'Febrile, rigors', treatment: 'Antimalarial' }), 'consultation')
must(await c.doctor.from('diagnoses').insert({ patient_id: patientId, visit_id: visitId, diagnosis: 'Suspected malaria' }), 'diagnosis')
check('doctor can enter a diagnosis', true)

const mp = must(await c.doctor.from('services').select('id').eq('name', 'Malaria Parasite (MP) Test').single(), 'service')
const labReq = must(await c.doctor.from('lab_requests').insert({
  patient_id: patientId, visit_id: visitId, service_id: mp.id,
}).select('id').single(), 'lab request')
const para = must(await c.doctor.from('drugs').select('id').eq('name', 'Paracetamol 500mg').single(), 'drug')
const rx = must(await c.doctor.from('prescriptions').insert({
  patient_id: patientId, visit_id: visitId, drug_id: para.id, dose: '500mg', route: 'oral',
  frequency: 'TDS', duration_days: 3, quantity: 10,
}).select('id').single(), 'prescription')

section('4. Laboratory: request to finalised result')
check('lab was notified of the request',
  ((await c.lab.from('notifications').select('title').eq('patient_id', patientId)).data ?? []).some((n) => n.title.includes('laboratory request')))
check('lab can see the request',
  !!(await c.lab.from('lab_requests').select('id').eq('id', labReq.id).maybeSingle()).data)
check('receptionist cannot see lab requests',
  ((await c.reception.from('lab_requests').select('id').eq('id', labReq.id)).data ?? []).length === 0)
check('result cannot be entered before the specimen is collected',
  !!(await c.lab.rpc('enter_lab_result', { p_request_id: labReq.id, p_result: 'Positive' })).error)
must(await c.lab.rpc('collect_specimen', { p_request_id: labReq.id, p_specimen_type: 'Blood' }), 'collect')
must(await c.lab.rpc('enter_lab_result', { p_request_id: labReq.id, p_result: 'Plasmodium falciparum +', p_reference_range: 'Negative' }), 'enter result')
check('doctor cannot see an unfinalised result',
  ((await c.doctor.from('lab_results').select('id').eq('lab_request_id', labReq.id)).data ?? []).length === 0)
check('doctor cannot finalise a result', !!(await c.doctor.rpc('finalize_lab_result', { p_request_id: labReq.id })).error)
must(await c.lab.rpc('finalize_lab_result', { p_request_id: labReq.id }), 'finalize')
const seen = (await c.doctor.from('lab_results').select('result,status').eq('lab_request_id', labReq.id).maybeSingle()).data
check('finalised result appears in the doctor\'s record', seen?.status === 'finalized' && seen.result.includes('falciparum'))
check('doctor was notified of the result',
  ((await c.doctor.from('notifications').select('title').eq('patient_id', patientId)).data ?? []).some((n) => n.title.includes('result finalized')))
check('finalised result cannot be edited',
  !!(await c.lab.from('lab_results').update({ result: 'Negative' }).eq('lab_request_id', labReq.id)).error ||
  (await c.lab.from('lab_results').select('result').eq('lab_request_id', labReq.id).single()).data.result.includes('falciparum'))

section('5. Pharmacy: dispensing and stock')
check('pharmacist was notified',
  ((await c.pharmacy.from('notifications').select('title').eq('patient_id', patientId)).data ?? []).some((n) => n.title.includes('ready for dispensing')))
const stock = async () => (await c.pharmacy.from('drug_stock_status').select('quantity,stock_status').eq('drug_id', para.id).single()).data
const before = await stock()
check('nurse cannot dispense', !!(await c.nurse.rpc('dispense_prescription', { p_prescription_id: rx.id })).error)
must(await c.pharmacy.rpc('dispense_prescription', { p_prescription_id: rx.id }), 'dispense')
const after = await stock()
check(`stock dropped by 10 (${before.quantity} -> ${after.quantity})`, before.quantity - after.quantity === 10)
check('cannot dispense the same prescription twice', !!(await c.pharmacy.rpc('dispense_prescription', { p_prescription_id: rx.id })).error)
check('doctor cannot read stock batches directly', ((await c.doctor.from('stock_batches').select('id')).data ?? []).length === 0)

section('6. Admission and bed occupancy')
const beds = must(await c.doctor.from('beds').select('id,bed_number,status').eq('status', 'available').limit(2), 'beds')
const [bedA] = beds
const adm = must(await c.doctor.rpc('admit_patient', { p_visit_id: visitId, p_bed_id: bedA.id, p_diagnosis: 'Malaria', p_nurse_id: c.nurse.uid }), 'admit')
check('bed is now occupied',
  (await c.nurse.from('beds').select('status').eq('id', bedA.id).single()).data.status === 'occupied')
check('nurse was notified of the admission',
  ((await c.nurse.from('notifications').select('title').eq('patient_id', patientId)).data ?? []).some((n) => n.title.includes('admission') || n.title.includes('assigned')))

const p2 = must(await c.reception.rpc('register_patient', {
  p_full_name: `Second Patient${stamp}`, p_dob: '1992-02-02', p_sex: 'female', p_phone: null, p_address: null,
  p_kin_name: 'A', p_kin_phone: '0803', p_kin_relationship: 'mother', p_kin_relationship_other: null, p_force: false,
}), 'register p2')
const v2 = must(await c.reception.rpc('check_in_patient', { p_patient_id: p2.patient_id, p_complaint: 'Headache' }), 'checkin p2')
check('same bed cannot be given to a second patient',
  !!(await c.doctor.rpc('admit_patient', { p_visit_id: v2, p_bed_id: bedA.id, p_diagnosis: 'x' })).error)
check('nurse cannot admit', !!(await c.nurse.rpc('admit_patient', { p_visit_id: v2, p_bed_id: beds[1].id, p_diagnosis: 'x' })).error)

section('7. Medication administration record')
const rx2 = must(await c.doctor.from('prescriptions').insert({
  patient_id: patientId, visit_id: visitId, admission_id: adm, drug_id: para.id, dose: '1g', route: 'IV',
  frequency: 'QDS', quantity: 4,
}).select('id').single(), 'inpatient rx')
const mar = (await c.nurse.from('medication_administrations').select('id,status').eq('prescription_id', rx2.id)).data ?? []
check('prescription appears on the nurse\'s MAR as pending', mar.length === 1 && mar[0].status === 'pending')
check('receptionist cannot record medication', !!(await c.reception.rpc('record_medication', { p_mar_id: mar[0].id, p_status: 'given' })).error)
check('doctor cannot directly mark a dose given',
  !!(await c.doctor.from('medication_administrations').update({ status: 'given' }).eq('id', mar[0].id)).error ||
  (await c.nurse.from('medication_administrations').select('status').eq('id', mar[0].id).single()).data.status === 'pending')
check('refusing a dose needs a reason', !!(await c.nurse.rpc('record_medication', { p_mar_id: mar[0].id, p_status: 'refused' })).error)
must(await c.nurse.rpc('record_medication', { p_mar_id: mar[0].id, p_status: 'given' }), 'give')
const given = (await c.nurse.from('medication_administrations').select('status,administered_by,administered_at').eq('id', mar[0].id).single()).data
check('dose recorded with nurse + time', given.status === 'given' && given.administered_by === c.nurse.uid && !!given.administered_at)
check('a dose cannot be recorded twice', !!(await c.nurse.rpc('record_medication', { p_mar_id: mar[0].id, p_status: 'given' })).error)

section('8. Discharge, bed release and billing')
check('nurse cannot discharge', !!(await c.nurse.rpc('discharge_patient', { p_admission_id: adm, p_summary: 'x' })).error)
must(await c.doctor.rpc('discharge_patient', {
  p_admission_id: adm, p_summary: 'Recovered. Review in 1 week.', p_payment_source: 'hmo',
  p_follow_up_at: new Date(Date.now() + 7 * 86400000).toISOString(),
}), 'discharge')
check('bed is available again',
  (await c.nurse.from('beds').select('status').eq('id', bedA.id).single()).data.status === 'available')
const hist = (await c.doctor.from('admissions').select('status,discharged_at').eq('id', adm).single()).data
check('admission kept as history (not deleted)', hist.status === 'discharged' && !!hist.discharged_at)
const bill = must(await c.billing.from('bill_summary').select('*').eq('visit_id', visitId).single(), 'bill')
check(`bill has charges (billed ${bill.total_billed})`, Number(bill.total_billed) > 0 && bill.payment_status === 'unpaid' && bill.payment_source === 'hmo')
check('billing officer was notified',
  ((await c.billing.from('notifications').select('title').eq('patient_id', patientId)).data ?? []).some((n) => n.title.includes('discharged')))
check('receptionist cannot see bills', ((await c.reception.from('bill_summary').select('*').eq('visit_id', visitId)).data ?? []).length === 0)
check('doctor cannot see bills', ((await c.doctor.from('bill_summary').select('*').eq('visit_id', visitId)).data ?? []).length === 0)
const billRow = must(await c.billing.from('bills').select('id').eq('visit_id', visitId).single(), 'bill id')
must(await c.billing.from('payments').insert({ bill_id: billRow.id, patient_id: patientId, amount: bill.total_billed, source: 'hmo', reference: `RCPT-${stamp}` }), 'payment')
check('payment settles the bill',
  (await c.billing.from('bill_summary').select('payment_status,balance').eq('visit_id', visitId).single()).data.payment_status === 'paid')

section('9. Audit trail')
const audit = (await c.admin.from('audit_log').select('table_name,action,actor_name').eq('patient_id', patientId)).data ?? []
const tables = new Set(audit.map((a) => a.table_name))
for (const t of ['patients', 'visits', 'diagnoses', 'lab_requests', 'lab_results', 'prescriptions', 'dispensing', 'admissions', 'medication_administrations', 'payments']) {
  check(`audit has entries for ${t}`, tables.has(t))
}
check('audit entries name the acting staff member', audit.some((a) => a.actor_name === 'Blessing Udo') && audit.some((a) => a.actor_name.startsWith('Dr.')))
check('receptionist cannot read the audit log', ((await c.reception.from('audit_log').select('id').limit(1)).data ?? []).length === 0)
check('audit log cannot be altered', !!(await c.admin.from('audit_log').update({ action: 'x' }).eq('patient_id', patientId)).error ||
  (await c.admin.from('audit_log').select('action').eq('patient_id', patientId).eq('action', 'x')).data.length === 0)

section('10. Sessions')
for (const k of Object.keys(c)) await c[k].rpc('record_logout')
check('logout recorded', ((await c.admin.from('staff_sessions').select('id').eq('staff_id', c.admin.uid).not('logout_at', 'is', null)).data ?? []).length > 0)

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
