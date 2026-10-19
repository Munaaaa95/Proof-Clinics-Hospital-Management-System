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
  p_follow_up_at: new Date(Date.now() + 8 * 86400000).toISOString(),
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

// Sections 10-13 assume the database was reset first (node --env-file=.env scripts/reset-demo-data.mjs)
const serverNow = new Date(must(await c.admin.rpc('server_time'), 'server_time')).getTime()   // DB clock, not this PC's
const lagosDay = (ms) => new Date(ms).toLocaleDateString('en-CA', { timeZone: 'Africa/Lagos' })
const lagosToday = lagosDay(serverNow)
const rows = async (q) => { const { data, error } = await q; if (error) throw new Error(error.message); return data ?? [] }

section('10. Dashboard views')
const sum = (await c.admin.from('dash_summary').select('*').single()).data
check(`summary tiles (inpatients ${sum?.active_inpatients}, waiting ${sum?.waiting_patients})`, sum && sum.active_inpatients >= 3 && sum.waiting_patients >= 3)
check('A. inpatients show ward, bed and doctor', (await rows(c.nurse.from('dash_inpatients').select('*')))
  .some((r) => r.patient_name === 'Chinedu Okeke' && r.ward === 'Male Ward' && r.bed_number === 'B1' && r.doctor_name.startsWith('Dr.')))
const dis = await rows(c.doctor.from('dash_discharged').select('*').eq('patient_name', 'Samuel Johnson'))
check('B. discharged list hides payment info from doctors', dis.length === 1 && dis[0].payment_status === null && dis[0].payment_source === null)
const disB = await rows(c.billing.from('dash_discharged').select('*').eq('patient_name', 'Samuel Johnson'))
check('B. billing sees payment source and status', disB[0]?.payment_status === 'partial' && disB[0]?.payment_source === 'hmo')
check('B. patient feedback rating shown', disB[0]?.feedback_rating === 'great')
const wait = await rows(c.doctor.from('dash_waiting').select('*').eq('patient_name', 'Aisha Bello'))
check('C. waiting list shows complaint and waiting time', wait.length === 1 && wait[0].complaint.includes('Cough') && wait[0].waiting_minutes >= 0)
check('D. admissions list includes active and past', (await rows(c.admin.from('dash_admissions').select('admission_status'))).some((r) => r.admission_status === 'discharged')
  && (await rows(c.admin.from('dash_admissions').select('admission_status'))).some((r) => r.admission_status === 'active'))
const dl = await rows(c.doctor.from('dash_lab').select('*').in('patient_name', ['Chinedu Okeke', 'Funke Adebayo']))
check('E. lab shows a finalised result, hides an unfinalised one',
  dl.find((r) => r.patient_name === 'Chinedu Okeke')?.result?.includes('falciparum') && dl.find((r) => r.patient_name === 'Funke Adebayo')?.result === null)
check('E. receptionist cannot see lab dashboard', (await rows(c.reception.from('dash_lab').select('*'))).length === 0)
check('F. appointments today listed', (await rows(c.reception.from('dash_appointments_today').select('*'))).length >= 5)
const bedSummary = await rows(c.reception.from('dash_bed_summary').select('*'))
const all = bedSummary.find((b) => b.ward === 'All wards')
check(`G. bed totals add up (${all?.occupied} occupied of ${all?.total_beds})`,
  all && all.total_beds === 18 && all.occupied >= 3 && all.occupied + all.available + all.reserved + all.maintenance === all.total_beds)
const anonClient = createClient(url, anon, { auth: { persistSession: false } })
const anonRead = await anonClient.from('dash_summary').select('*')
check('signed-out visitors get nothing from the dashboard', !!anonRead.error || (anonRead.data ?? []).length === 0)

section('11. Patient search')
const s1 = await rows(c.reception.rpc('search_patients', { p_query: 'Chinedu' }))
check('search by name', s1[0]?.full_name === 'Chinedu Okeke' && s1[0].is_admitted === true)
check('search by Patient ID', (await rows(c.reception.rpc('search_patients', { p_query: s1[0].patient_code })))[0]?.full_name === 'Chinedu Okeke')
const s3 = await rows(c.reception.rpc('search_patients', { p_query: '0803 123 0004' }))
check('search by phone (spaces ignored); shows open visit', s3[0]?.full_name === 'Aisha Bello' && s3[0].open_visit_status === 'waiting')
check('search by date of birth', (await rows(c.reception.rpc('search_patients', { p_query: '1990-07-22' })))[0]?.full_name === 'Funke Adebayo')
check('search tolerates a misspelling', (await rows(c.reception.rpc('search_patients', { p_query: 'Chinedu Okekeh' })))[0]?.full_name === 'Chinedu Okeke')
check('one-letter search returns nothing', (await rows(c.reception.rpc('search_patients', { p_query: 'a' }))).length === 0)
check('signed-out visitors cannot search', !!(await anonClient.rpc('search_patients', { p_query: 'Chinedu' })).error)

section('12. Appointments')
const kunleAppt = (await rows(c.reception.from('dash_appointments_today').select('appointment_id').eq('patient_name', 'Kunle Martins')))[0]
const kv = must(await c.reception.rpc('check_in_appointment', { p_appointment_id: kunleAppt.appointment_id }), 'check_in_appointment')
check('checking in an appointment puts the patient in the queue',
  (await rows(c.doctor.from('dash_waiting').select('*').eq('patient_name', 'Kunle Martins'))).length === 1)
check('appointment status follows the visit (waiting)',
  (await rows(c.reception.from('dash_appointments_today').select('appointment_status').eq('patient_name', 'Kunle Martins')))[0].appointment_status === 'waiting')
check('same appointment cannot be checked in twice', !!(await c.reception.rpc('check_in_appointment', { p_appointment_id: kunleAppt.appointment_id })).error)
must(await c.doctor.rpc('start_consultation', { p_visit_id: kv }), 'start')
check('appointment follows the visit (in consultation)',
  (await rows(c.reception.from('dash_appointments_today').select('appointment_status').eq('patient_name', 'Kunle Martins')))[0].appointment_status === 'in_consultation')
must(await c.doctor.rpc('complete_visit', { p_visit_id: kv, p_disposition: 'home' }), 'complete')
check('appointment follows the visit (completed)',
  (await rows(c.reception.from('dash_appointments_today').select('appointment_status').eq('patient_name', 'Kunle Martins')))[0].appointment_status === 'completed')
const kunleId = (await rows(c.reception.from('dash_appointments_today').select('patient_id').eq('patient_name', 'Kunle Martins')))[0].patient_id
must(await c.reception.from('appointments').insert({
  patient_id: kunleId, doctor_id: c.doctor.uid, appt_type: 'follow_up', reason: 'E2E review', scheduled_at: new Date(serverNow + 86400e3 * 3).toISOString(),
}), 'book')
check('doctor is notified of a new appointment',
  (await rows(c.doctor.from('notifications').select('title').eq('patient_id', kunleId))).some((n) => n.title === 'New appointment'))

section('13. Reports')
const from = lagosDay(serverNow - 7 * 86400e3)
const rep = must(await c.admin.rpc('report_summary', { p_from: from, p_to: lagosToday }), 'report')
check(`visits counted (${rep.visits.total})`, rep.visits.total >= 10 && rep.visits.unique_patients >= 10)
check('admissions and bed occupancy', rep.admissions.active_now >= 3 && rep.beds.total === 18 && rep.beds.occupancy_percent > 0)
check('revenue billed/paid/outstanding add up', Number(rep.revenue.billed) > 0 &&
  Number(rep.revenue.billed) - Number(rep.revenue.paid) === Number(rep.revenue.outstanding))
check('lab workload and pharmacy usage present', rep.lab_workload.length > 0 && rep.pharmacy_usage.length > 0)
check('daily series covers every day in range', rep.daily_visits.length === 8)
const repAdm = must(await c.admin.rpc('report_summary', { p_from: from, p_to: lagosToday, p_visit_type: 'admission' }), 'report filtered')
check('visit-type filter works', repAdm.visits.outpatient === 0 && repAdm.visits.inpatient_or_admission >= 6)
const repDoc = must(await c.admin.rpc('report_summary', { p_from: from, p_to: lagosToday, p_doctor_id: c.doctor.uid }), 'report doctor')
check('doctor filter narrows results', repDoc.visits.total > 0 && repDoc.visits.total < rep.visits.total)
check('receptionist cannot run reports', !!(await c.reception.rpc('report_summary', { p_from: from, p_to: lagosToday })).error)
check('billing officer cannot run reports', !!(await c.billing.rpc('report_summary', { p_from: from, p_to: lagosToday })).error)
check('backwards date range rejected', !!(await c.admin.rpc('report_summary', { p_from: lagosToday, p_to: from })).error)

section('14. Antenatal care (record_anc_visit, anc_summary)')
const mum = must(await c.reception.rpc('register_patient', {
  p_full_name: `Anc Test${stamp}`, p_dob: '1996-03-03', p_sex: 'female', p_phone: null, p_address: 'Lagos',
  p_kin_name: 'B', p_kin_phone: '0803', p_kin_relationship: 'spouse', p_kin_relationship_other: null, p_force: false,
}), 'register mother')
const ancCall = (client, extra) => client.rpc('record_anc_visit', { p_patient_id: mum.patient_id, ...extra })
const lmp = lagosDay(serverNow - 140 * 86400e3)
const edd = new Date(Date.parse(lmp) + 280 * 86400e3).toISOString().slice(0, 10)
check('receptionist cannot record antenatal care', !!(await ancCall(c.reception, { p_lmp: lmp })).error)
check('pharmacist cannot record antenatal care', !!(await ancCall(c.pharmacy, { p_lmp: lmp })).error)
check('male patient rejected', !!(await c.nurse.rpc('record_anc_visit', { p_patient_id: patientId, p_lmp: lmp })).error)
check('first visit needs the LMP', !!(await ancCall(c.nurse, {})).error)
check('LMP in the future rejected', !!(await ancCall(c.nurse, { p_lmp: lagosDay(serverNow + 5 * 86400e3) })).error)
check('systolic must exceed diastolic', !!(await ancCall(c.nurse, { p_lmp: lmp, p_bp_systolic: 70, p_bp_diastolic: 120 })).error)
check('one blood pressure value alone rejected', !!(await ancCall(c.nurse, { p_lmp: lmp, p_bp_systolic: 120 })).error)
check('parity must be lower than gravida', !!(await ancCall(c.nurse, { p_lmp: lmp, p_gravida: 2, p_parity: 2 })).error)
const anc1 = must(await ancCall(c.nurse, {
  p_lmp: lmp, p_gravida: 2, p_parity: 1, p_bp_systolic: 112, p_bp_diastolic: 72, p_weight_kg: 64,
  p_fundal_height_cm: 20, p_findings: 'Normal growth', p_supplements: 'Folic acid, Iron',
}), 'first ANC visit')
check('first visit opens the record and calculates the EDD', anc1.record_created === true && anc1.edd === edd, JSON.stringify(anc1))
check('gestational weeks calculated from the LMP', anc1.gestational_weeks === 20, JSON.stringify(anc1))
check('follow-up must be after the visit', !!(await ancCall(c.nurse, { p_follow_up_date: lagosToday })).error)
check('visit before the LMP rejected', !!(await ancCall(c.nurse, { p_visit_date: lagosDay(serverNow - 200 * 86400e3) })).error)
const tomorrow = lagosDay(serverNow + 86400e3)
const anc2 = must(await ancCall(c.doctor, { p_findings: 'Well', p_follow_up_date: tomorrow }), 'second ANC visit')
check('second visit reuses the same record', anc2.record_created === false && anc2.anc_record_id === anc1.anc_record_id)
const sumRow = (await rows(c.nurse.from('anc_summary').select('*').eq('patient_id', mum.patient_id)))[0]
check('anc_summary shows visits, weeks and next follow-up',
  sumRow?.visit_count === 2 && sumRow.weeks_now === 20 && sumRow.next_follow_up === tomorrow && sumRow.follow_up_overdue === false && sumRow.edd === edd,
  JSON.stringify(sumRow))
check('anc_summary lists the seeded mother (Ngozi Umeh)', (await rows(c.doctor.from('anc_summary').select('full_name,visit_count'))).some((r) => r.full_name === 'Ngozi Umeh' && r.visit_count === 2))
check('receptionist sees no antenatal summary', (await rows(c.reception.from('anc_summary').select('*'))).length === 0)
check('pharmacist sees no antenatal records', (await rows(c.pharmacy.from('anc_records').select('id'))).length === 0)
const ancAudit = (await c.admin.from('audit_log').select('table_name').eq('patient_id', mum.patient_id)).data ?? []
check('antenatal writes are audited', ancAudit.some((a) => a.table_name === 'anc_records') && ancAudit.some((a) => a.table_name === 'anc_visits'))

section('15. Reminder scheduler')
check('receptionist cannot run the scheduler', !!(await c.reception.rpc('run_reminders')).error)
check('nurse cannot run the scheduler', !!(await c.nurse.rpc('run_reminders')).error)
check('signed-out visitors cannot run the scheduler', !!(await anonClient.rpc('run_reminders')).error)
const bookAppt = (extra) => c.reception.from('appointments').insert({
  patient_id: mum.patient_id, doctor_id: c.doctor.uid, appt_type: 'antenatal', department: 'Antenatal', ...extra,
}).select('id').single()
const apptSoon = must(await bookAppt({ scheduled_at: new Date(serverNow + 3 * 3600e3).toISOString(), reason: 'Reminder test' }), 'book soon')
const apptCancelled = must(await bookAppt({ scheduled_at: new Date(serverNow + 2 * 3600e3).toISOString(), reason: 'Reminder test cancelled', status: 'cancelled' }), 'book cancelled')
const run1 = must(await c.admin.rpc('run_reminders'), 'run_reminders')
check(`scheduler reports what it sent (${JSON.stringify(run1)})`, run1.appointments >= 1 && run1.anc_follow_ups >= 1)
const mumReminders = await rows(c.doctor.from('reminders').select('kind,appointment_id,anc_visit_id,message').eq('patient_id', mum.patient_id))
check('appointment within 24h gets one reminder', mumReminders.filter((r) => r.appointment_id === apptSoon.id).length === 1)
check('cancelled appointment gets none', !mumReminders.some((r) => r.appointment_id === apptCancelled.id))
check('appointment more than 24h away gets none', (await rows(c.doctor.from('reminders').select('id').eq('patient_id', kunleId))).length === 0)
check('ANC follow-up tomorrow gets a reminder naming the date',
  mumReminders.filter((r) => r.kind === 'anc_follow_up').length === 1 &&
  mumReminders.find((r) => r.kind === 'anc_follow_up').message.includes(`Anc Test${stamp}`))
check('doctor was notified of the upcoming appointment',
  (await rows(c.doctor.from('notifications').select('title').eq('patient_id', mum.patient_id))).some((n) => n.title === 'Upcoming appointment'))
check('the clinician who set the follow-up was notified',
  (await rows(c.doctor.from('notifications').select('title').eq('patient_id', mum.patient_id))).some((n) => n.title === 'Antenatal follow-up tomorrow'))
check('other staff were not notified of it',
  !(await rows(c.nurse.from('notifications').select('title').eq('patient_id', mum.patient_id))).some((n) => n.title === 'Antenatal follow-up tomorrow'))
const run2 = must(await c.admin.rpc('run_reminders'), 'run_reminders again')
check('running again repeats nothing', run2.appointments === 0 && run2.anc_follow_ups === 0, JSON.stringify(run2))
check('pharmacist cannot read the reminder log', (await rows(c.pharmacy.from('reminders').select('id'))).length === 0)
check('reminders cannot be edited through the API',
  !!(await c.admin.from('reminders').update({ message: 'x' }).eq('patient_id', mum.patient_id)).error ||
  (await rows(c.admin.from('reminders').select('message').eq('patient_id', mum.patient_id).eq('message', 'x'))).length === 0)

// Medication reminders depend on the time of day, so these use the service role to set the scheduler's clock.
if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
  const svc = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
  const disp = must(await svc.from('dispensing').select('dispensed_at').eq('prescription_id', rx.id).limit(1).single(), 'dispensing')
  const dayAfter = lagosDay(Date.parse(disp.dispensed_at) + 86400e3)
  const at = (day, hhmm) => new Date(`${day}T${hhmm}:00+01:00`).toISOString()
  const runAt = async (iso) => must(await svc.rpc('run_reminders', { p_now: iso }), 'run_reminders at ' + iso)
  const rxReminders = async () => rows(svc.from('reminders').select('due_at,message').eq('prescription_id', rx.id))
  check('inpatient prescriptions are not reminded', (await rows(svc.from('reminders').select('id').eq('prescription_id', rx2.id))).length === 0)
  await runAt(at(dayAfter, '08:05'))
  const medRows = await rxReminders()
  check('home prescription (TDS) gets the 08:00 dose reminder', medRows.length === 1 && medRows[0].message.includes('Paracetamol 500mg') && medRows[0].message.includes('TDS'), JSON.stringify(medRows))
  check('same dose is not reminded twice', (await runAt(at(dayAfter, '08:05'))).medication === 0 && (await rxReminders()).length === 1)
  check('a dose missed by more than 2 hours is skipped', (await runAt(at(dayAfter, '11:05'))).medication === 0)
  await runAt(at(lagosDay(Date.parse(at(dayAfter, '08:05')) + 4 * 86400e3), '20:05'))
  check('no reminders after the course has ended', (await rxReminders()).length === 1)
} else {
  console.log('  SKIP  medication reminder checks (SUPABASE_SERVICE_ROLE_KEY not set)')
}

section('16. Expiry alerts')
check('receptionist cannot run expiry alerts', !!(await c.reception.rpc('generate_expiry_alerts')).error)
check('nurse cannot run expiry alerts', !!(await c.nurse.rpc('generate_expiry_alerts')).error)
check('signed-out visitors cannot run expiry alerts', !!(await anonClient.rpc('generate_expiry_alerts')).error)
const expiry1 = must(await c.pharmacy.rpc('generate_expiry_alerts'), 'expiry alerts')
check(`batch expiring within 90 days is reported (${expiry1} new)`, expiry1 >= 1)
check('pharmacist and admin were notified',
  (await rows(c.pharmacy.from('notifications').select('title,body').eq('type', 'expiry'))).some((n) => n.title === 'Drug approaching expiry' && n.body.includes('ORS')) &&
  (await rows(c.admin.from('notifications').select('title').eq('type', 'expiry'))).some((n) => n.title === 'Drug approaching expiry'))
check('doctor is not notified of expiry', (await rows(c.doctor.from('notifications').select('id').eq('type', 'expiry'))).length === 0)
check('running again repeats nothing (safe to schedule daily)', (await c.admin.rpc('generate_expiry_alerts')).data === 0)
if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
  const svc2 = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
  const ibu = must(await svc2.from('drugs').select('id').eq('name', 'Ibuprofen 400mg').single(), 'ibuprofen')
  must(await svc2.from('stock_batches').insert({ drug_id: ibu.id, batch_number: 'OLD-1', expiry_date: lagosDay(serverNow - 3 * 86400e3), quantity: 5 }), 'expired batch')
  check('a batch that expires with stock left is reported once more', (await c.admin.rpc('generate_expiry_alerts')).data === 1)
  check('...and only once', (await c.admin.rpc('generate_expiry_alerts')).data === 0)
  check('expired batch notice says so',
    (await rows(c.admin.from('notifications').select('title,body').eq('type', 'expiry'))).some((n) => n.title === 'Drug batch expired' && n.body.includes('OLD-1')))
  check('an expired batch is not counted as usable stock',
    (await rows(c.pharmacy.from('drug_stock_status').select('quantity').eq('drug_id', ibu.id)))[0].quantity === 150)
} else {
  console.log('  SKIP  expired-batch checks (SUPABASE_SERVICE_ROLE_KEY not set)')
}

section('17. Sessions')
for (const k of Object.keys(c)) await c[k].rpc('record_logout')
check('logout recorded', ((await c.admin.from('staff_sessions').select('id').eq('staff_id', c.admin.uid).not('logout_at', 'is', null)).data ?? []).length > 0)

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
