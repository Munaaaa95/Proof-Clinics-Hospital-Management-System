// Permission review (build plan: "no role can act outside its permissions").
// Logs in as each role with the public anon key and tries things that role must NOT be able to do.
// Every check passes when the database refuses the action (or shows the role nothing).
// Usage: node --env-file=.env scripts/permission-check.mjs   (run reset-demo-data.mjs first)
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
const refused = (res) => !!res.error
const sees = async (q) => ((await q).data ?? []).length

const c = {}
for (const [k, email] of Object.entries(emails)) {
  c[k] = createClient(url, anon, { auth: { persistSession: false } })
  const { data, error } = await c[k].auth.signInWithPassword({ email, password })
  if (error) throw new Error(`login ${k}: ${error.message}`)
  c[k].uid = data.user.id
}
const anonClient = createClient(url, anon, { auth: { persistSession: false } })

// One patient with an open visit, a prescription, a lab request and a bill to attack.
const stamp = Date.now().toString().slice(-6)
const reg = must(await c.reception.rpc('register_patient', {
  p_full_name: `Permission Probe${stamp}`, p_dob: '1990-02-02', p_sex: 'female', p_phone: `0809${stamp}1`, p_address: 'Lagos',
  p_kin_name: 'Kin', p_kin_phone: '08030000000', p_kin_relationship: 'spouse', p_kin_relationship_other: null, p_force: true,
}), 'register')
const patientId = reg.patient_id
const visitId = must(await c.reception.rpc('check_in_patient', {
  p_patient_id: patientId, p_visit_type: 'outpatient', p_department: 'General Outpatient', p_complaint: 'probe',
}), 'check in')
must(await c.doctor.rpc('start_consultation', { p_visit_id: visitId }), 'start consultation')
const drug = must(await c.doctor.from('drugs').select('id').eq('name', 'Paracetamol 500mg').single(), 'drug')
const mp = must(await c.doctor.from('services').select('id').eq('name', 'Malaria Parasite (MP) Test').single(), 'service')
const rx = must(await c.doctor.from('prescriptions').insert({
  patient_id: patientId, visit_id: visitId, drug_id: drug.id, dose: '500mg', frequency: 'twice daily', quantity: 4,
}).select('id').single(), 'prescription')
const lab = must(await c.doctor.from('lab_requests').insert({
  patient_id: patientId, visit_id: visitId, service_id: mp.id, requested_by: c.doctor.uid,
}).select('id').single(), 'lab request')

section('1. Diagnosis and consultation are doctor-only')
for (const k of ['reception', 'nurse', 'lab', 'pharmacy', 'billing']) {
  check(`${k} cannot write a diagnosis`, refused(await c[k].from('diagnoses').insert({
    visit_id: visitId, patient_id: patientId, diagnosis: 'probe', entered_by: c[k].uid })))
}
check('doctor cannot write a diagnosis in another doctor\'s name', refused(await c.doctor.from('diagnoses').insert({
  visit_id: visitId, patient_id: patientId, diagnosis: 'probe', entered_by: c.nurse.uid })))
check('nurse cannot write a consultation', refused(await c.nurse.from('consultations').insert({
  visit_id: visitId, patient_id: patientId, doctor_id: c.nurse.uid, notes: 'probe' })))

section('2. Prescriptions cannot skip the pharmacy')
for (const k of ['reception', 'nurse', 'lab', 'pharmacy', 'billing']) {
  check(`${k} cannot prescribe`, refused(await c[k].from('prescriptions').insert({
    patient_id: patientId, visit_id: visitId, drug_id: drug.id, dose: '1', frequency: 'daily', quantity: 1 })))
}
check('doctor cannot create a prescription already marked dispensed', refused(await c.doctor.from('prescriptions').insert({
  patient_id: patientId, visit_id: visitId, drug_id: drug.id, dose: '1', frequency: 'daily', quantity: 1, status: 'dispensed' })))
check('doctor cannot mark an existing prescription dispensed', refused(await c.doctor.from('prescriptions')
  .update({ status: 'dispensed' }).eq('id', rx.id)) ||
  (await c.admin.from('prescriptions').select('status').eq('id', rx.id).single()).data.status === 'prescribed')
check('doctor cannot change a prescription once it is dispensed', await (async () => {
  must(await c.pharmacy.rpc('dispense_prescription', { p_prescription_id: rx.id }), 'dispense')
  await c.doctor.from('prescriptions').update({ quantity: 9999, status: 'cancelled' }).eq('id', rx.id)
  const row = (await c.admin.from('prescriptions').select('quantity,status').eq('id', rx.id).single()).data
  return row.quantity === 4 && row.status === 'dispensed'
})())

section('3. Stock moves only through the dispensing functions')
for (const k of ['doctor', 'nurse', 'reception', 'billing', 'lab']) {
  check(`${k} cannot dispense`, refused(await c[k].rpc('dispense_prescription', { p_prescription_id: rx.id })))
}
check('pharmacist cannot edit a stock batch directly', await (async () => {
  const b = (await c.pharmacy.from('stock_batches').select('id,quantity').limit(1).single()).data
  await c.pharmacy.from('stock_batches').update({ quantity: b.quantity + 1000 }).eq('id', b.id)
  return (await c.admin.from('stock_batches').select('quantity').eq('id', b.id).single()).data.quantity === b.quantity
})())
check('pharmacist cannot write the stock ledger', refused(await c.pharmacy.from('stock_movements').insert({
  drug_id: drug.id, change: 100, reason: 'received' })))
check('pharmacist cannot prescribe or request tests', refused(await c.pharmacy.from('lab_requests').insert({
  patient_id: patientId, visit_id: visitId, service_id: mp.id, requested_by: c.pharmacy.uid })))
check('nobody but pharmacist/admin receives stock', refused(await c.doctor.rpc('receive_stock', {
  p_drug_id: drug.id, p_batch_number: 'PROBE', p_expiry: '2030-01-01', p_quantity: 5 })))

section('4. Lab results cannot be skipped or forged')
check('a lab request created as finalized is stored as requested', await (async () => {
  const r = await c.doctor.from('lab_requests').insert({
    patient_id: patientId, visit_id: visitId, service_id: mp.id, requested_by: c.doctor.uid, status: 'finalized' }).select('id').single()
  return !r.error && (await c.admin.from('lab_requests').select('status').eq('id', r.data.id).single()).data.status === 'requested'
})())
check('doctor cannot request a test in another doctor\'s name', refused(await c.doctor.from('lab_requests').insert({
  patient_id: patientId, visit_id: visitId, service_id: mp.id, requested_by: c.nurse.uid })))
check('doctor cannot change lab request status directly', await (async () => {
  await c.doctor.from('lab_requests').update({ status: 'finalized' }).eq('id', lab.id)
  return (await c.admin.from('lab_requests').select('status').eq('id', lab.id).single()).data.status === 'requested'
})())
for (const k of ['doctor', 'nurse', 'reception', 'pharmacy', 'billing']) {
  check(`${k} cannot enter a lab result`, refused(await c[k].rpc('enter_lab_result', { p_request_id: lab.id, p_result: 'probe', p_reference_range: null })))
  check(`${k} cannot finalise a lab result`, refused(await c[k].rpc('finalize_lab_result', { p_request_id: lab.id })))
}
check('lab cannot request tests', refused(await c.lab.from('lab_requests').insert({
  patient_id: patientId, visit_id: visitId, service_id: mp.id, requested_by: c.lab.uid })))

section('5. Visits and the queue')
check('receptionist cannot complete a visit', refused(await c.reception.rpc('complete_visit', { p_visit_id: visitId, p_disposition: 'home', p_follow_up_plan: null })))
check('receptionist cannot start a consultation', refused(await c.reception.rpc('start_consultation', { p_visit_id: visitId })))
check('receptionist cannot set a disposition directly', await (async () => {
  await c.reception.from('visits').update({ disposition: 'home' }).eq('id', visitId)
  return (await c.admin.from('visits').select('disposition').eq('id', visitId).single()).data.disposition == null
})())
check('receptionist cannot mark a visit completed directly (it would skip the consultation fee)', await (async () => {
  await c.reception.from('visits').update({ status: 'completed' }).eq('id', visitId)
  return (await c.admin.from('visits').select('status').eq('id', visitId).single()).data.status !== 'completed'
})())

section('6. Inpatient actions')
for (const k of ['reception', 'nurse', 'lab', 'pharmacy', 'billing']) {
  check(`${k} cannot discharge`, refused(await c[k].rpc('discharge_patient', {
    p_admission_id: '00000000-0000-0000-0000-000000000000', p_summary: 'probe', p_payment_source: 'patient', p_follow_up_at: null })))
}
for (const k of ['reception', 'nurse', 'lab', 'pharmacy', 'billing']) {
  check(`${k} cannot admit`, refused(await c[k].rpc('admit_patient', {
    p_visit_id: visitId, p_bed_id: '00000000-0000-0000-0000-000000000000', p_diagnosis: 'probe', p_nurse_id: null })))
}
for (const k of ['doctor', 'reception', 'lab', 'pharmacy', 'billing']) {
  check(`${k} cannot give a medication dose`, refused(await c[k].rpc('record_medication', {
    p_mar_id: '00000000-0000-0000-0000-000000000000', p_status: 'given', p_notes: null })))
}
check('nobody can mark a bed occupied by hand', refused(await c.admin.from('beds').update({ status: 'occupied' }).eq('status', 'available')) ||
  (await c.admin.from('beds').select('id').eq('status', 'occupied')).data.length === (await c.admin.from('dash_bed_summary').select('occupied').eq('ward', 'All wards').single()).data.occupied)

section('7. Billing is closed to everyone but billing and admins')
for (const k of ['reception', 'doctor', 'nurse', 'lab', 'pharmacy']) {
  check(`${k} sees no bills, bill items or payments`,
    (await sees(c[k].from('bills').select('id')) + await sees(c[k].from('bill_items').select('id')) + await sees(c[k].from('payments').select('id'))) === 0)
}
check('billing officer cannot record a payment in someone else\'s name', refused(await c.billing.from('payments').insert({
  bill_id: (await c.admin.from('bills').select('id').limit(1).single()).data.id, patient_id: patientId, amount: 1, source: 'patient', recorded_by: c.doctor.uid })))
check('nobody can edit a payment', await (async () => {
  const p = (await c.billing.from('payments').select('id,amount').limit(1)).data?.[0]
  if (!p) return true
  await c.billing.from('payments').update({ amount: 1 }).eq('id', p.id)
  return (await c.admin.from('payments').select('amount').eq('id', p.id).single()).data.amount === p.amount
})())
check('non-billing roles do not see payment_source on the discharged dashboard',
  (await c.nurse.from('dash_discharged').select('payment_source').not('payment_source', 'is', null)).data?.length === 0)

section('8. Clinical data is hidden from non-clinical roles')
for (const k of ['pharmacy', 'billing', 'lab']) {
  check(`${k} sees no diagnoses, consultations or vitals`,
    (await sees(c[k].from('diagnoses').select('id')) + await sees(c[k].from('consultations').select('id')) + await sees(c[k].from('vitals').select('id'))) === 0)
}
check('receptionist sees no diagnoses or consultations',
  (await sees(c.reception.from('diagnoses').select('id')) + await sees(c.reception.from('consultations').select('id'))) === 0)
check('doctor and nurse see no un-finalised lab results', (await sees(c.doctor.from('lab_results').select('id').neq('status', 'finalized'))) === 0 &&
  (await sees(c.nurse.from('lab_results').select('id').neq('status', 'finalized'))) === 0)
check('receptionist cannot edit allergies', await (async () => {
  await c.reception.from('patients').update({ allergies: 'probe' }).eq('id', patientId)
  return (await c.admin.from('patients').select('allergies').eq('id', patientId).single()).data.allergies !== 'probe'
})())

section('9. Records are never deleted, the audit log is private')
for (const t of ['patients', 'visits', 'diagnoses', 'prescriptions', 'payments', 'audit_log', 'stock_batches']) {
  const before = (await c.admin.from(t).select('*', { count: 'exact', head: true })).count
  await c.admin.from(t).delete().not('id', 'is', null)
  const after = (await c.admin.from(t).select('*', { count: 'exact', head: true })).count
  check(`even an admin cannot delete from ${t}`, after === before && before > 0, `${before} -> ${after}`)
}
for (const k of ['reception', 'doctor', 'nurse', 'lab', 'pharmacy', 'billing']) {
  check(`${k} cannot read the audit log`, (await sees(c[k].from('audit_log').select('id'))) === 0)
}

section('9b. Inpatient notes')
{
  const active = (await c.admin.from('admissions').select('id, patient_id').eq('status', 'active').limit(2)).data ?? []
  const gone = (await c.admin.from('admissions').select('id').eq('status', 'discharged').limit(1)).data ?? []
  const adm = active[0]
  const other = active[1] ?? active[0]
  check('there is an admitted patient to test with', !!adm)
  const note = (k, type, extra = {}) => c[k].from('progress_notes').insert({ admission_id: adm.id, patient_id: adm.patient_id, note_type: type, body: 'probe', author_id: c[k].uid, ...extra })
  for (const k of ['reception', 'lab', 'pharmacy', 'billing']) {
    check(`${k} cannot write an inpatient note`, refused(await note(k, 'progress')))
    check(`${k} cannot read inpatient notes`, (await sees(c[k].from('progress_notes').select('id'))) === 0)
  }
  check('a nurse can add a nursing note', !(await note('nurse', 'nursing')).error)
  check('a nurse cannot write a treatment plan', refused(await note('nurse', 'treatment_plan')))
  check('a doctor can write a treatment plan', !(await note('doctor', 'treatment_plan')).error)
  check('a note cannot be written in someone else\'s name', refused(await note('doctor', 'progress', { author_id: c.nurse.uid })))
  check('an empty note is refused', refused(await note('doctor', 'progress', { body: '   ' })))
  const wrongPatient = await c.doctor.from('progress_notes').insert({ admission_id: adm.id, patient_id: other.patient_id, note_type: 'progress', body: 'patient id probe', author_id: c.doctor.uid }).select('patient_id').single()
  check('the patient always comes from the admission', !wrongPatient.error && wrongPatient.data.patient_id === adm.patient_id, JSON.stringify(wrongPatient.error ?? wrongPatient.data))
  if (gone[0]) check('no notes on a discharged admission', refused(await c.doctor.from('progress_notes').insert({ admission_id: gone[0].id, patient_id: adm.patient_id, note_type: 'progress', body: 'probe', author_id: c.doctor.uid })))
  check('a note cannot be edited', await (async () => {
    const n = (await c.doctor.from('progress_notes').select('id, body').eq('admission_id', adm.id).limit(1)).data[0]
    await c.doctor.from('progress_notes').update({ body: 'changed' }).eq('id', n.id)
    return (await c.admin.from('progress_notes').select('body').eq('id', n.id).single()).data.body === n.body
  })())
  check('a note cannot be deleted', await (async () => {
    const before = (await c.admin.from('progress_notes').select('*', { count: 'exact', head: true })).count
    await c.admin.from('progress_notes').delete().not('id', 'is', null)
    return (await c.admin.from('progress_notes').select('*', { count: 'exact', head: true })).count === before
  })())
}

section('10. Notifications are private')
check('a doctor cannot read the nurse\'s notifications', (await sees(c.doctor.from('notifications').select('id').eq('recipient_staff_id', c.nurse.uid))) === 0)
check('a doctor cannot mark the nurse\'s notification read', await (async () => {
  const n = (await c.admin.from('notifications').select('id,read_at').eq('recipient_staff_id', c.nurse.uid).is('read_at', null).limit(1)).data?.[0]
  if (!n) return true
  await c.doctor.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', n.id)
  return (await c.admin.from('notifications').select('read_at').eq('id', n.id).single()).data.read_at === null
})())

section('11. Staff accounts and the signed-out visitor')
check('a nurse cannot create a staff account', refused(await c.nurse.from('staff').insert({
  id: crypto.randomUUID(), staff_code: `X${stamp}`, full_name: 'Probe', role: 'super_admin' })))
check('a nurse cannot promote herself', await (async () => {
  await c.nurse.from('staff').update({ role: 'super_admin' }).eq('id', c.nurse.uid)
  return (await c.admin.from('staff').select('role').eq('id', c.nurse.uid).single()).data.role === 'nurse'
})())
for (const t of ['patients', 'visits', 'staff', 'drugs', 'audit_log', 'dash_summary']) {
  check(`signed-out visitor sees nothing in ${t}`, (await sees(anonClient.from(t).select('*').limit(1))) === 0)
}
check('signed-out visitor cannot register a patient', refused(await anonClient.rpc('register_patient', {
  p_full_name: 'Anon', p_dob: '2000-01-01', p_sex: 'male', p_phone: null, p_address: null, p_kin_name: null,
  p_kin_phone: null, p_kin_relationship: null, p_kin_relationship_other: null, p_force: true })))

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
