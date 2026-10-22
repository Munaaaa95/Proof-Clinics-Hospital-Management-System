// Resets the demo database to a known state: wipes activity, restocks drugs, frees beds, then seeds
// FAKE patients in every state the dashboard shows. "Michael Nelson" is deliberately NOT seeded so the
// demo script can register him live.
// Usage: node --env-file=.env scripts/reset-demo-data.mjs
// Uses the service role key (server-side only). Never run against real patient data.
import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) { console.error('Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env'); process.exit(1) }
const db = createClient(url, key, { auth: { persistSession: false } })

const ok = ({ data, error }, what) => { if (error) throw new Error(`${what}: ${error.message}`); return data }
const ins = async (table, rows) => ok(await db.from(table).insert(rows).select(), `insert ${table}`)

// "Now" comes from the database, so a wrong clock on this PC cannot skew the seeded dates.
const serverNow = new Date(ok(await db.rpc('server_time'), 'server_time')).getTime()
const ago = (hours) => new Date(serverNow - hours * 3600e3).toISOString()
const today = new Date(serverNow).toLocaleDateString('en-CA', { timeZone: 'Africa/Lagos' })
const todayAt = (hhmm) => new Date(`${today}T${hhmm}:00+01:00`).toISOString()   // Lagos is UTC+1, no DST
const inDays = (d, hhmm = '10:00') => new Date(new Date(todayAt(hhmm)).getTime() + d * 86400e3).toISOString()

console.log('Resetting activity data...')
ok(await db.rpc('reset_demo_data'), 'reset_demo_data')

// ---- reference lookups
const staffRows = ok(await db.from('staff').select('id, email:staff_code, role, full_name'), 'staff')
const one = (role, n = 0) => {
  const r = staffRows.filter((s) => s.role === role).sort((a, b) => a.email.localeCompare(b.email))[n]
  if (!r) throw new Error(`No staff with role ${role}. Run scripts/create-demo-users.mjs first.`)
  return r.id
}
const doctor = one('doctor', 0), doctor2 = one('doctor', 1), nurse = one('nurse'), lab = one('lab_scientist'), billing = one('billing_officer'), pharmacist = one('pharmacist')
const services = Object.fromEntries(ok(await db.from('services').select('*'), 'services').map((s) => [s.name, s]))
const drugs = Object.fromEntries(ok(await db.from('drugs').select('*'), 'drugs').map((d) => [d.name, d]))
const bedRows = ok(await db.from('beds').select('id, bed_number, ward:wards(name, daily_rate)'), 'beds')
const bed = (ward, no) => bedRows.find((b) => b.ward.name === ward && b.bed_number === no)

// ---- patients (all fake)
const P = {}
const people = [
  ['chinedu', 'Chinedu Okeke', '1978-03-14', 'male', '08031230001'],
  ['funke', 'Funke Adebayo', '1990-07-22', 'female', '08031230002'],
  ['emeka', 'Emeka Obi', '1965-11-02', 'male', '08031230003'],
  ['aisha', 'Aisha Bello', '1995-01-30', 'female', '08031230004'],
  ['tolu', 'Tolu Ajayi', '2001-09-09', 'male', '08031230005'],
  ['grace', 'Grace Eze', '1988-05-18', 'female', '08031230006'],
  ['samuel', 'Samuel Johnson', '1972-12-05', 'male', '08031230007'],
  ['ifeoma', 'Ifeoma Nnadi', '1993-04-27', 'female', '08031230008'],
  ['yusuf', 'Yusuf Danjuma', '1984-08-08', 'male', '08031230009'],
  ['bisi', 'Bisi Adewale', '1999-06-11', 'female', '08031230010'],
  ['kunle', 'Kunle Martins', '1955-02-20', 'male', '08031230011'],
  ['ngozi', 'Ngozi Umeh', '1996-10-10', 'female', '08031230012'],
]
const created = await ins('patients', people.map(([, full_name, dob, sex, phone]) => ({
  full_name, dob, sex, phone, address: 'Lagos, Nigeria',
  allergies: full_name === 'Funke Adebayo' ? 'Penicillin' : null,
})))
people.forEach(([k], i) => { P[k] = created[i].id })
await ins('next_of_kin', people.map(([k, name]) => ({
  patient_id: P[k], full_name: `${name.split(' ')[1]} (Next of kin)`, phone: '08090000000', relationship: 'spouse',
})))

// ---- inpatients, one in each of three wards, occupying beds
const inpatients = [
  { k: 'chinedu', ward: 'Male Ward', bed: 'B1', dx: 'Severe malaria', daysAgo: 2, dr: doctor },
  { k: 'funke', ward: 'Female Ward', bed: 'B2', dx: 'Typhoid fever', daysAgo: 1, dr: doctor2 },
  { k: 'emeka', ward: 'Male Ward', bed: 'B3', dx: 'Hypertensive crisis', daysAgo: 0.3, dr: doctor },
]
const admissionIds = {}
for (const a of inpatients) {
  const [visit] = await ins('visits', [{
    patient_id: P[a.k], visit_type: 'admission', department: 'General', complaint: a.dx,
    status: 'in_consultation', doctor_id: a.dr, checked_in_at: ago(a.daysAgo * 24 + 1),
    started_at: ago(a.daysAgo * 24 + 0.5), disposition: 'admission',
  }])
  const b = bed(a.ward, a.bed)
  const [adm] = await ins('admissions', [{
    patient_id: P[a.k], visit_id: visit.id, bed_id: b.id, doctor_id: a.dr, nurse_id: nurse,
    diagnosis: a.dx, admitted_at: ago(a.daysAgo * 24),
  }])
  ok(await db.from('beds').update({ status: 'occupied' }).eq('id', b.id), 'occupy bed')
  admissionIds[a.k] = { admission: adm.id, visit: visit.id, doctor: a.dr }
  await ins('vitals', [{ patient_id: P[a.k], visit_id: visit.id, temperature_c: 38.1, pulse: 92, resp_rate: 20, bp_systolic: 130, bp_diastolic: 85, weight_kg: 70, recorded_by: nurse }])
  await ins('diagnoses', [{ patient_id: P[a.k], visit_id: visit.id, diagnosis: a.dx, entered_by: a.dr }])
}
// Prescriptions with admission_id create the pending MAR rows (via trigger)
const rxs = await ins('prescriptions', [
  { patient_id: P.chinedu, visit_id: admissionIds.chinedu.visit, admission_id: admissionIds.chinedu.admission, drug_id: drugs['Artemether/Lumefantrine'].id, dose: '80/480mg', route: 'oral', frequency: 'BD', duration_days: 3, quantity: 6, prescribed_by: doctor },
  { patient_id: P.chinedu, visit_id: admissionIds.chinedu.visit, admission_id: admissionIds.chinedu.admission, drug_id: drugs['Paracetamol 500mg'].id, dose: '1g', route: 'oral', frequency: 'TDS', duration_days: 3, quantity: 9, prescribed_by: doctor },
  { patient_id: P.funke, visit_id: admissionIds.funke.visit, admission_id: admissionIds.funke.admission, drug_id: drugs['Paracetamol 500mg'].id, dose: '1g', route: 'oral', frequency: 'TDS', duration_days: 3, quantity: 9, prescribed_by: doctor2 },
  { patient_id: P.emeka, visit_id: admissionIds.emeka.visit, admission_id: admissionIds.emeka.admission, drug_id: drugs['Ibuprofen 400mg'].id, dose: '400mg', route: 'oral', frequency: 'BD', duration_days: 5, quantity: 10, prescribed_by: doctor },
])
// Inpatient notes (spec 8): a progress note and a nursing note each, and a treatment plan for the sickest patient
await ins('progress_notes', [
  { admission_id: admissionIds.chinedu.admission, patient_id: P.chinedu, note_type: 'treatment_plan', body: 'IV artesunate for 24 hours, then oral artemether/lumefantrine. Paracetamol for fever. Review parasite count daily.', author_id: doctor, created_at: ago(46) },
  { admission_id: admissionIds.chinedu.admission, patient_id: P.chinedu, note_type: 'progress', body: 'Day 2. Fever settling, eating small meals. Parasite count falling. Continue current plan.', author_id: doctor, created_at: ago(20) },
  { admission_id: admissionIds.chinedu.admission, patient_id: P.chinedu, note_type: 'nursing', body: 'Slept well. Temperature 37.4 at 06:00. Taking oral fluids. No vomiting overnight.', author_id: nurse, created_at: ago(8) },
  { admission_id: admissionIds.funke.admission, patient_id: P.funke, note_type: 'progress', body: 'Day 1. Widal positive. Started on treatment. Abdominal pain improving.', author_id: doctor2, created_at: ago(10) },
  { admission_id: admissionIds.funke.admission, patient_id: P.funke, note_type: 'nursing', body: 'Comfortable. Encouraged fluids. Bowels not open today.', author_id: nurse, created_at: ago(4) },
  { admission_id: admissionIds.emeka.admission, patient_id: P.emeka, note_type: 'nursing', body: 'Admitted from clinic. BP 190/110 on arrival, now 168/100. Resting, call bell within reach.', author_id: nurse, created_at: ago(5) },
])
// One dose already given by the nurse, so the MAR shows a mix of given and pending
const firstDose = ok(await db.from('medication_administrations').select('id').eq('prescription_id', rxs[1].id).limit(1).single(), 'mar row')
ok(await db.from('medication_administrations').update({ status: 'given', administered_by: nurse, administered_at: ago(2) }).eq('id', firstDose.id), 'give dose')

// ---- lab: one finalised, one collected (awaiting result), one just requested
const labReqs = await ins('lab_requests', [
  { patient_id: P.chinedu, visit_id: admissionIds.chinedu.visit, service_id: services['Malaria Parasite (MP) Test'].id, requested_by: doctor, requested_at: ago(40), status: 'finalized', specimen_type: 'Blood', collected_at: ago(39), collected_by: lab },
  { patient_id: P.funke, visit_id: admissionIds.funke.visit, service_id: services['Full Blood Count (FBC)'].id, requested_by: doctor2, requested_at: ago(5), status: 'collected', specimen_type: 'Blood', collected_at: ago(4), collected_by: lab },
  { patient_id: P.emeka, visit_id: admissionIds.emeka.visit, service_id: services['Fasting Blood Sugar'].id, requested_by: doctor, requested_at: ago(1), status: 'requested', specimen_type: 'Blood' },
])
await ins('lab_results', [{
  lab_request_id: labReqs[0].id, patient_id: P.chinedu, result: 'Plasmodium falciparum ++', reference_range: 'Negative',
  status: 'finalized', entered_by: lab, reviewed_by: lab, entered_at: ago(38), finalized_at: ago(37),
}])

// ---- waiting patients
const waiting = [['aisha', 'Cough and chest pain', 0.7], ['tolu', 'Headache and fever', 0.3], ['grace', 'Abdominal pain', 0.1]]
for (const [k, complaint, h] of waiting) {
  await ins('visits', [{ patient_id: P[k], visit_type: 'outpatient', department: 'General', complaint, status: 'waiting', checked_in_at: ago(h) }])
}

// ---- discharged inpatients, each with a bill in a different payment state
const discharged = [
  { k: 'samuel', ward: 'Male Ward', bed: 'B4', dx: 'Pneumonia', daysAgo: 3, rating: 'great', src: 'hmo', pay: 'partial' },
  { k: 'ifeoma', ward: 'Female Ward', bed: 'B1', dx: 'Gastroenteritis', daysAgo: 2, rating: 'good', src: 'patient', pay: 'full' },
  { k: 'yusuf', ward: 'Male Ward', bed: 'B5', dx: 'Appendicitis (post-op)', daysAgo: 4, rating: 'ok', src: 'government', pay: 'none' },
]
for (const d of discharged) {
  const [visit] = await ins('visits', [{
    patient_id: P[d.k], visit_type: 'admission', department: 'General', complaint: d.dx, status: 'completed',
    doctor_id: doctor, checked_in_at: ago(d.daysAgo * 24 + 1), started_at: ago(d.daysAgo * 24), completed_at: ago(3),
    disposition: 'home', feedback_rating: d.rating, feedback_note: d.rating === 'ok' ? 'Waiting time was long' : null,
  }])
  const b = bed(d.ward, d.bed)
  await ins('admissions', [{
    patient_id: P[d.k], visit_id: visit.id, bed_id: b.id, doctor_id: doctor, nurse_id: nurse, diagnosis: d.dx,
    status: 'discharged', admitted_at: ago(d.daysAgo * 24), discharged_at: ago(3), discharged_by: doctor,
    discharge_summary: 'Recovered well. Review in one week.',
  }])
  const [bill] = await ins('bills', [{ patient_id: P[d.k], visit_id: visit.id, payment_source: d.src }])
  const bedCharge = b.ward.daily_rate * d.daysAgo
  const items = [
    { category: 'bed', description: `${b.ward.name} bed, ${d.daysAgo} day(s)`, quantity: d.daysAgo, unit_price: b.ward.daily_rate },
    { category: 'lab', description: 'Full Blood Count (FBC)', quantity: 1, unit_price: services['Full Blood Count (FBC)'].price },
    { category: 'pharmacy', description: 'Amoxicillin 500mg x15', quantity: 15, unit_price: drugs['Amoxicillin 500mg'].unit_price },
  ]
  await ins('bill_items', items.map((i) => ({ ...i, bill_id: bill.id, patient_id: P[d.k] })))
  const total = bedCharge + services['Full Blood Count (FBC)'].price + 15 * drugs['Amoxicillin 500mg'].unit_price
  const paid = d.pay === 'full' ? total : d.pay === 'partial' ? Math.round(total / 2) : 0
  if (paid > 0) await ins('payments', [{ bill_id: bill.id, patient_id: P[d.k], amount: paid, source: d.src, reference: `RCPT-${d.k.toUpperCase()}`, recorded_by: billing }])
}

// ---- completed outpatient visits
for (const [k, plan] of [['bisi', null], ['kunle', 'Review in 2 weeks']]) {
  const [visit] = await ins('visits', [{
    patient_id: P[k], visit_type: 'outpatient', department: 'General', complaint: 'Routine consultation', status: 'completed',
    doctor_id: doctor, checked_in_at: ago(5), started_at: ago(4.5), completed_at: ago(4),
    disposition: plan ? 'follow_up' : 'home', follow_up_plan: plan, feedback_rating: 'good',
  }])
  await ins('consultations', [{ patient_id: P[k], visit_id: visit.id, doctor_id: doctor, notes: 'Examined. No acute issues.', treatment: 'Advice given' }])
  const [bill] = await ins('bills', [{ patient_id: P[k], visit_id: visit.id, payment_source: 'patient' }])
  const fee = services['General Consultation']
  await ins('bill_items', [{ bill_id: bill.id, patient_id: P[k], category: 'consultation', description: fee.name, quantity: 1, unit_price: fee.price }])
  await ins('payments', [{ bill_id: bill.id, patient_id: P[k], amount: fee.price, source: 'patient', reference: `RCPT-${k.toUpperCase()}`, recorded_by: billing }])
}

// ---- home medication: Bisi was dispensed a 5-day course yesterday, so the reminder log has entries to show.
// (Amoxicillin, not Paracetamol, so the 100 -> 90 demo number is untouched.) Doses that already passed today are
// logged here; the scheduler (run_reminders) adds the later ones as their time comes and never repeats these.
{
  const bisiVisit = ok(await db.from('visits').select('id').eq('patient_id', P.bisi).single(), 'bisi visit')
  const amox = drugs['Amoxicillin 500mg']
  const [rx] = await ins('prescriptions', [{
    patient_id: P.bisi, visit_id: bisiVisit.id, drug_id: amox.id, dose: '500mg', route: 'oral', frequency: 'TDS',
    duration_days: 5, quantity: 15, status: 'dispensed', prescribed_by: doctor, prescribed_at: ago(27),
  }])
  const batch = ok(await db.from('stock_batches').select('id, quantity').eq('drug_id', amox.id).single(), 'amoxicillin batch')
  ok(await db.from('stock_batches').update({ quantity: batch.quantity - 15 }).eq('id', batch.id), 'take stock')
  const dispensedAt = ago(26)
  await ins('dispensing', [{ prescription_id: rx.id, patient_id: P.bisi, drug_id: amox.id, batch_id: batch.id, quantity: 15, dispensed_by: pharmacist, dispensed_at: dispensedAt }])
  await ins('stock_movements', [{ drug_id: amox.id, batch_id: batch.id, change: -15, reason: 'dispensed', reference: rx.id, created_by: pharmacist }])
  const bisiBill = ok(await db.from('bills').select('id').eq('visit_id', bisiVisit.id).single(), 'bisi bill')
  const drugCharge = 15 * amox.unit_price
  await ins('bill_items', [{ bill_id: bisiBill.id, patient_id: P.bisi, category: 'pharmacy', description: 'Amoxicillin 500mg x15', quantity: 15, unit_price: amox.unit_price }])
  if (drugCharge > 0) await ins('payments', [{ bill_id: bisiBill.id, patient_id: P.bisi, amount: drugCharge, source: 'patient', reference: 'RCPT-BISI-RX', recorded_by: billing }])

  // Same dose times and wording as run_reminders() uses for TDS, so its unique key skips these later.
  const start = new Date(dispensedAt).getTime(), end = start + 5 * 86400e3
  const logRows = []
  for (let d = -2; d <= 0; d++) {
    const day = new Date(serverNow + d * 86400e3).toLocaleDateString('en-CA', { timeZone: 'Africa/Lagos' })
    for (const hhmm of ['08:00', '14:00', '20:00']) {
      const due = new Date(`${day}T${hhmm}:00+01:00`).getTime()
      if (due > start && due <= end && due <= serverNow) {
        logRows.push({ kind: 'medication', patient_id: P.bisi, prescription_id: rx.id, due_at: new Date(due).toISOString(),
          message: 'Dear Bisi Adewale, time to take Amoxicillin 500mg (500mg, oral). Prescribed: TDS.', sent_at: new Date(due).toISOString() })
      }
    }
  }
  if (logRows.length) await ins('reminders', logRows)
}

// ---- appointments: a mix of today (various statuses) and the coming days
await ins('appointments', [
  { patient_id: P.ngozi, doctor_id: doctor2, department: 'Antenatal', appt_type: 'antenatal', scheduled_at: todayAt('10:00'), reason: 'ANC follow-up', status: 'confirmed' },
  { patient_id: P.kunle, doctor_id: doctor, department: 'General', appt_type: 'follow_up', scheduled_at: todayAt('11:30'), reason: 'Review', status: 'scheduled' },
  { patient_id: P.bisi, doctor_id: doctor, department: 'General', appt_type: 'consultation', scheduled_at: todayAt('09:00'), reason: 'Routine consultation', status: 'completed' },
  { patient_id: P.grace, doctor_id: doctor2, department: 'General', appt_type: 'consultation', scheduled_at: todayAt('08:30'), reason: 'Abdominal pain', status: 'checked_in' },
  { patient_id: P.tolu, doctor_id: doctor, department: 'General', appt_type: 'consultation', scheduled_at: todayAt('14:00'), reason: 'Fever follow-up', status: 'cancelled' },
  { patient_id: P.aisha, doctor_id: doctor, department: 'General', appt_type: 'consultation', scheduled_at: inDays(1), reason: 'Chest review', status: 'scheduled' },
  { patient_id: P.samuel, doctor_id: doctor, department: 'General', appt_type: 'follow_up', scheduled_at: inDays(6), reason: 'Post-discharge follow-up', status: 'scheduled' },
])

// ---- antenatal: one mother with two visits (history accumulates on one record)
const [anc] = await ins('anc_records', [{ patient_id: P.ngozi, lmp: '2026-05-01', edd: '2027-02-05', gravida: 2, parity: 1, risk_factors: null, created_by: nurse }])
await ins('anc_visits', [
  { anc_record_id: anc.id, patient_id: P.ngozi, visit_date: '2026-09-01', gestational_weeks: 17, bp_systolic: 110, bp_diastolic: 70, weight_kg: 63, fundal_height_cm: 17, findings: 'Normal', supplements: 'Folic acid, Iron', follow_up_date: '2026-10-01', recorded_by: nurse },
  { anc_record_id: anc.id, patient_id: P.ngozi, visit_date: '2026-10-01', gestational_weeks: 21, bp_systolic: 112, bp_diastolic: 72, weight_kg: 65, fundal_height_cm: 21, findings: 'Normal growth', supplements: 'Folic acid, Iron', follow_up_date: today, recorded_by: nurse },
])

// ---- clean slate for audit/notifications so the demo log starts empty
ok(await db.rpc('clear_activity_logs'), 'clear_activity_logs')
console.log('Done. Seeded 12 fake patients: 3 inpatients, 3 waiting, 3 discharged, 2 completed outpatients, 1 ANC, 1 home prescription with medication reminders; Paracetamol stock = 100.')
