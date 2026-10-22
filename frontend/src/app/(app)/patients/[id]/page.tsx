'use client'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { ok, useQuery } from '@/lib/hooks'
import { ageOf, fmtDate, fmtDateTime, lagosToday, many, titleCase } from '@/lib/format'
import { hasRole } from '@/lib/roles'
import { BookAppointmentModal, DEPARTMENTS } from '@/components/BookAppointmentModal'
import { FeedbackModal, ratingLabel } from '@/components/FeedbackModal'
import { Async, Icon, Button, Card, EmptyState, ErrorBox, Field, Input, Select, StatusPill, Table, Tabs, Td, Textarea, Th, Tr, cx, titleCaseVisit, useAction, useToast } from '@/components/ui'

interface Patient {
  id: string; patient_code: string; full_name: string; dob: string; sex: string; phone: string | null; address: string | null
  allergies: string | null; medical_history: string | null; created_at: string
  kin: { full_name: string; phone: string; relationship: string; relationship_other: string | null; is_emergency_contact: boolean }[]
}
type Row = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
type HistTab = 'visits' | 'diagnoses' | 'medications' | 'labs' | 'admissions' | 'appointments' | 'referrals' | 'antenatal'
const PATHWAYS = [
  { v: 'outpatient', l: 'Outpatient', i: 'stethoscope' }, { v: 'inpatient', l: 'Inpatient', i: 'hotel' },
  { v: 'admission', l: 'Admission', i: 'login' }, { v: 'referral', l: 'Referral', i: 'move_up' },
]

export default function PatientProfilePage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const { staff } = useAuth()
  const toast = useToast()
  const [tab, setTab] = useState<HistTab>('visits')
  const [editing, setEditing] = useState(false)
  const [booking, setBooking] = useState(false)
  const [feedbackFor, setFeedbackFor] = useState<Row | null>(null)
  const canFeedback = hasRole(staff?.role, 'receptionist', 'nurse', 'doctor', 'hospital_admin', 'super_admin')
  const canEditClinical = hasRole(staff?.role, 'doctor', 'nurse', 'community_health', 'hospital_admin', 'super_admin')
  const canCheckIn = hasRole(staff?.role, 'receptionist', 'doctor', 'nurse', 'hospital_admin', 'super_admin')
  const canBook = hasRole(staff?.role, 'receptionist', 'doctor', 'hospital_admin', 'super_admin')

  const q = useQuery(async () => {
    const patient = ok(await supabase.from('patients').select('id, patient_code, full_name, dob, sex, phone, address, allergies, medical_history, created_at, kin:next_of_kin(full_name, phone, relationship, relationship_other, is_emergency_contact)').eq('id', id).single() as never) as Patient
    const [visits, dx, rx, labs, adm, appts, anc] = await Promise.all([
      supabase.from('visits').select('id, visit_type, department, complaint, status, disposition, checked_in_at, feedback_rating, feedback_note, doctor:staff!visits_doctor_id_fkey(full_name)').eq('patient_id', id).order('checked_in_at', { ascending: false }),
      supabase.from('diagnoses').select('id, diagnosis, created_at, by:staff!diagnoses_entered_by_fkey(full_name)').eq('patient_id', id).order('created_at', { ascending: false }),
      supabase.from('prescriptions').select('id, dose, route, frequency, duration_days, quantity, status, prescribed_at, drug:drugs(name)').eq('patient_id', id).order('prescribed_at', { ascending: false }),
      supabase.from('lab_requests').select('id, status, requested_at, service:services(name), result:lab_results(result, reference_range, status)').eq('patient_id', id).order('requested_at', { ascending: false }),
      supabase.from('admissions').select('id, status, admitted_at, discharged_at, diagnosis, discharge_summary, bed:beds(bed_number, ward:wards(name))').eq('patient_id', id).order('admitted_at', { ascending: false }),
      supabase.from('appointments').select('id, scheduled_at, appt_type, status, reason, doctor:staff!appointments_doctor_id_fkey(full_name)').eq('patient_id', id).order('scheduled_at', { ascending: false }),
      supabase.from('anc_records').select('id, lmp, edd, gravida, parity').eq('patient_id', id).maybeSingle(),
    ])
    return {
      patient,
      visits: (visits.data ?? []) as Row[], dx: (dx.data ?? []) as Row[], rx: (rx.data ?? []) as Row[], labs: (labs.data ?? []) as Row[],
      adm: (adm.data ?? []) as Row[], appts: (appts.data ?? []) as Row[], anc: anc.data as Row | null,
    }
  }, [id], ['visits', 'diagnoses', 'prescriptions', 'lab_requests', 'lab_results', 'admissions', 'appointments', 'patients'])

  const d = q.data
  const p = d?.patient
  const open = d?.visits.find((v) => ['waiting', 'in_consultation'].includes(v.status))
  const admitted = d?.adm.find((a) => a.status === 'active')

  return (
    <Async q={q}>
      {p && d && (
        <>
          <Card className="p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="flex items-start gap-4">
                <span className="w-14 h-14 rounded-full bg-primary-fixed text-on-primary-fixed-variant flex items-center justify-center text-headline-md font-semibold shrink-0">{p.full_name.split(' ').map((x) => x[0]).slice(0, 2).join('')}</span>
                <div className="space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <h1 className="text-headline-lg">{p.full_name}</h1>
                    {admitted ? <StatusPill status="active" /> : open ? <StatusPill status={open.status} /> : null}
                    {admitted && <span className="text-label-xs text-outline">Admitted</span>}
                  </div>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-body-sm text-on-surface-variant">
                    {p.allergies
                      ? <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-error-container text-on-error-container text-label-xs"><Icon name="warning" className="text-[14px]" filled />Allergy: {p.allergies}</span>
                      : <span className="inline-flex px-2 py-0.5 rounded-md bg-surface-container-high text-label-xs">No known allergies recorded</span>}
                    <span>Patient ID: <strong className="text-on-surface">{p.patient_code}</strong></span>
                    <span>{titleCase(p.sex)}, {ageOf(p.dob)} yrs</span><span>Born {fmtDate(p.dob)}</span><span>Registered {fmtDate(p.created_at)}</span>
                  </div>
                </div>
              </div>
              <div className="flex gap-2">
                {canBook && <Button variant="secondary" onClick={() => setBooking(true)}>Book Appointment</Button>}
                {canCheckIn && !open && !admitted && <a href="#start-visit"><Button>Start a Visit</Button></a>}
              </div>
            </div>
          </Card>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
            <Card className="p-6 space-y-3">
              <h2 className="text-headline-md flex items-center gap-2">Contact and Next of Kin</h2>
              <dl className="grid grid-cols-[8rem_1fr] gap-y-2 text-body-sm">
                <dt className="text-outline">Phone</dt><dd>{p.phone ?? '—'}</dd>
                <dt className="text-outline">Address</dt><dd>{p.address ?? '—'}</dd>
                {p.kin.length === 0 ? <><dt className="text-outline">Next of kin</dt><dd>None recorded</dd></> : p.kin.map((k, i) => (
                  <div key={i} className="contents">
                    <dt className="text-outline">Next of kin</dt><dd>{k.full_name} ({k.relationship === 'other' ? k.relationship_other : titleCase(k.relationship)})</dd>
                    <dt className="text-outline">Kin phone</dt><dd>{k.phone}</dd>
                    <dt className="text-outline">Emergency contact</dt><dd>{k.is_emergency_contact ? <span className="px-2 py-0.5 rounded bg-tertiary-fixed text-on-tertiary-fixed-variant text-label-xs">Yes</span> : 'No'}</dd>
                  </div>
                ))}
              </dl>
            </Card>

            <Card className="p-6 space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-headline-md flex items-center gap-2">Medical History and Allergies</h2>
                {canEditClinical && !editing && <Button small variant="secondary" onClick={() => setEditing(true)}>Edit</Button>}
              </div>
              {editing ? <ClinicalForm p={p} onDone={() => { setEditing(false); q.reload(); toast('Saved') }} onCancel={() => setEditing(false)} /> : (
                <dl className="space-y-2 text-body-sm">
                  <div><dt className="text-label-xs text-outline uppercase">Allergies</dt><dd>{p.allergies || 'None recorded'}</dd></div>
                  <div><dt className="text-label-xs text-outline uppercase">Medical history</dt><dd>{p.medical_history || 'None recorded'}</dd></div>
                </dl>
              )}
              <p className="flex items-center gap-1.5 text-label-xs text-outline">Only doctors and nurses can edit clinical information.</p>
            </Card>
          </div>

          {canCheckIn && (
            open || admitted
              ? <Card className="px-5 py-4 flex items-center gap-2 text-body-sm">{admitted ? 'This patient is currently admitted.' : `This patient already has an open visit (${titleCaseVisit(open!.status)}). A patient with an open visit cannot be checked in again.`}</Card>
              : <StartVisit patientId={p.id} onDone={() => { toast('Patient checked in'); router.push('/queue') }} />
          )}

          <Card className="overflow-hidden">
            <div className="p-5 pb-3 space-y-3">
              <h2 className="text-headline-md flex items-center gap-2">Patient History</h2>
              <Tabs value={tab} onChange={setTab} tabs={[
                { id: 'visits', label: 'Visits', count: d.visits.length }, { id: 'diagnoses', label: 'Diagnoses', count: d.dx.length }, { id: 'medications', label: 'Medications', count: d.rx.length },
                { id: 'labs', label: 'Lab Results', count: d.labs.length }, { id: 'admissions', label: 'Admissions', count: d.adm.length }, { id: 'appointments', label: 'Appointments', count: d.appts.length },
                { id: 'referrals', label: 'Referrals', count: d.visits.filter((v) => v.visit_type === 'referral').length }, { id: 'antenatal', label: 'Antenatal' },
              ]} />
            </div>
            <History tab={tab} d={d} onFeedback={canFeedback ? setFeedbackFor : undefined} />
            <p className="px-5 py-4 text-label-xs text-outline">Lab results show only after the lab has finalised them. What each role can see depends on its permissions, so a tab can be empty.</p>
          </Card>

          <FeedbackModal visit={feedbackFor ? { id: feedbackFor.id, patientName: p.full_name, rating: feedbackFor.feedback_rating, note: feedbackFor.feedback_note } : null}
            onClose={() => setFeedbackFor(null)} onSaved={() => { setFeedbackFor(null); q.reload() }} />
          <BookAppointmentModal open={booking} onClose={() => setBooking(false)} defaultDay={lagosToday()} presetPatient={{ patient_id: p.id, patient_code: p.patient_code, full_name: p.full_name, dob: p.dob, sex: p.sex }}
            onDone={() => { setBooking(false); q.reload() }} />
        </>
      )}
    </Async>
  )
}

function ClinicalForm({ p, onDone, onCancel }: { p: Patient; onDone: () => void; onCancel: () => void }) {
  const { busy, run } = useAction()
  const [allergies, setAllergies] = useState(p.allergies ?? '')
  const [history, setHistory] = useState(p.medical_history ?? '')
  async function save() {
    const r = await run(async () => {
      const { error } = await supabase.from('patients').update({ allergies: allergies.trim() || null, medical_history: history.trim() || null }).eq('id', p.id)
      if (error) throw error
      return true
    })
    if (r) onDone()
  }
  return (
    <div className="space-y-3">
      <Field label="Allergies"><Input value={allergies} onChange={(e) => setAllergies(e.target.value)} placeholder="e.g. Co-trimoxazole (skin rash)" /></Field>
      <Field label="Medical history"><Textarea rows={3} value={history} onChange={(e) => setHistory(e.target.value)} /></Field>
      <div className="flex gap-2"><Button busy={busy} onClick={() => void save()}>Save</Button><Button variant="ghost" onClick={onCancel}>Cancel</Button></div>
    </div>
  )
}

function StartVisit({ patientId, onDone }: { patientId: string; onDone: () => void }) {
  const [type, setType] = useState('outpatient')
  const [dept, setDept] = useState('General')
  const [complaint, setComplaint] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const { busy, run } = useAction()
  async function go() {
    setErr(null)
    if (!complaint.trim()) return setErr('Enter the reason for the visit')
    try {
      const { error } = await supabase.rpc('check_in_patient', { p_patient_id: patientId, p_visit_type: type, p_department: dept, p_complaint: complaint.trim() })
      if (error) throw error
      onDone()
    } catch (e) { setErr(e instanceof Error ? e.message : String((e as { message?: string })?.message ?? e)) }
  }
  return (
    <Card className="p-6 space-y-4" >
      <h2 id="start-visit" className="text-headline-md flex items-center gap-2">Start a Visit</h2>
      <div className="flex flex-wrap gap-2">
        {PATHWAYS.map((x) => <button key={x.v} type="button" onClick={() => setType(x.v)} className={cx('h-9 px-4 rounded-lg text-body-sm border', type === x.v ? 'border-primary bg-primary-fixed/40 text-primary font-medium' : 'border-outline-variant/50 hover:bg-surface-container-low')}>{x.l}</button>)}
      </div>
      <p className="flex items-center gap-1.5 text-body-sm text-on-surface-variant">Name, date of birth, phone, address and next of kin carry over from registration. Nothing is typed again.</p>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
        <Field label="Department *"><Select value={dept} onChange={(e) => setDept(e.target.value)}>{DEPARTMENTS.map((x) => <option key={x}>{x}</option>)}</Select></Field>
        <Field label="Complaint *"><Input value={complaint} onChange={(e) => setComplaint(e.target.value)} placeholder="Reason for the visit" /></Field>
        <Button busy={busy} onClick={() => void run(go)}>Check In</Button>
      </div>
      {err && <ErrorBox message={err} />}
    </Card>
  )
}

function History({ tab, d, onFeedback }: { tab: HistTab; onFeedback?: (v: Row) => void; d: { visits: Row[]; dx: Row[]; rx: Row[]; labs: Row[]; adm: Row[]; appts: Row[]; anc: Row | null } }) {
  const empty = (t: string) => <EmptyState title={t} />
  if (tab === 'visits') return d.visits.length === 0 ? empty('No visits yet') : (
    <Table head={<><Th>Date</Th><Th>Type</Th><Th>Department</Th><Th>Doctor</Th><Th>Outcome</Th><Th>Patient feedback</Th></>}>
      {d.visits.map((v) => <Tr key={v.id}><Td>{fmtDate(v.checked_in_at)}</Td><Td>{titleCaseVisit(v.visit_type)}</Td><Td>{v.department}</Td><Td>{v.doctor?.full_name ?? '—'}</Td><Td>{v.status === 'completed' ? (v.disposition ? titleCase(v.disposition) : 'Completed') : <StatusPill status={v.status} />}</Td>
        <Td>{v.feedback_rating || v.feedback_note ? <div><span className="font-medium">{ratingLabel(v.feedback_rating)}</span>{v.feedback_note && <div className="text-label-xs text-on-surface-variant max-w-xs">{v.feedback_note}</div>}</div> : v.status === 'completed' && onFeedback ? <Button small variant="secondary" onClick={() => onFeedback(v)}>Add feedback</Button> : <span className="text-outline">—</span>}</Td></Tr>)}
    </Table>
  )
  if (tab === 'diagnoses') return d.dx.length === 0 ? empty('No diagnoses recorded, or your role cannot see them') : (
    <Table head={<><Th>Date</Th><Th>Diagnosis</Th><Th>Entered by</Th></>}>{d.dx.map((x) => <Tr key={x.id}><Td>{fmtDate(x.created_at)}</Td><Td>{x.diagnosis}</Td><Td>{x.by?.full_name}</Td></Tr>)}</Table>
  )
  if (tab === 'medications') return d.rx.length === 0 ? empty('No medication recorded, or your role cannot see it') : (
    <Table head={<><Th>Drug</Th><Th>Dose and frequency</Th><Th>Quantity</Th><Th>Status</Th><Th>Prescribed</Th></>}>
      {d.rx.map((x) => <Tr key={x.id}><Td className="font-medium">{x.drug?.name}</Td><Td>{x.dose} {String(x.route).toLowerCase()}, {x.frequency}{x.duration_days ? `, ${x.duration_days} days` : ''}</Td><Td>{x.quantity}</Td><Td><StatusPill status={x.status} /></Td><Td>{fmtDate(x.prescribed_at)}</Td></Tr>)}
    </Table>
  )
  if (tab === 'labs') return d.labs.length === 0 ? empty('No lab tests, or your role cannot see them') : (
    <Table head={<><Th>Test</Th><Th>Requested</Th><Th>Status</Th><Th>Result</Th><Th>Reference range</Th></>}>
      {d.labs.map((x) => { const r = many<Row>(x.result).find((y) => y.status === 'finalized'); return <Tr key={x.id}><Td className="font-medium">{x.service?.name}</Td><Td>{fmtDate(x.requested_at)}</Td><Td><StatusPill status={x.status} /></Td><Td>{r?.result ?? '—'}</Td><Td>{r?.reference_range ?? '—'}</Td></Tr> })}
    </Table>
  )
  if (tab === 'admissions') return d.adm.length === 0 ? empty('No admissions yet') : (
    <Table head={<><Th>Admitted</Th><Th>Discharged</Th><Th>Ward and bed</Th><Th>Diagnosis</Th><Th>Summary</Th><Th /></>}>
      {d.adm.map((x) => <Tr key={x.id}><Td>{fmtDate(x.admitted_at)}</Td><Td>{x.discharged_at ? fmtDate(x.discharged_at) : <StatusPill status="active" />}</Td><Td>{x.bed?.ward?.name}, {x.bed?.bed_number}</Td><Td>{x.diagnosis}</Td><Td className="max-w-xs truncate">{x.discharge_summary ?? '—'}</Td><Td className="text-right whitespace-nowrap"><Link href={x.status === 'active' ? `/inpatient/${x.id}` : `/discharge/${x.id}`} className="text-primary text-label-sm hover:underline">{x.status === 'active' ? 'Open chart' : 'Print summary'}</Link></Td></Tr>)}
    </Table>
  )
  if (tab === 'appointments') return d.appts.length === 0 ? empty('No appointments yet') : (
    <Table head={<><Th>When</Th><Th>Doctor</Th><Th>Type</Th><Th>Status</Th></>}>
      {d.appts.map((x) => <Tr key={x.id}><Td>{fmtDateTime(x.scheduled_at)}</Td><Td>{x.doctor?.full_name ?? '—'}</Td><Td>{titleCaseVisit(x.appt_type)}</Td><Td><StatusPill status={x.status} /></Td></Tr>)}
    </Table>
  )
  if (tab === 'referrals') {
    const r = d.visits.filter((v) => v.visit_type === 'referral')
    return r.length === 0 ? empty('No referrals yet') : (
      <Table head={<><Th>Date</Th><Th>Department</Th><Th>Reason</Th><Th>Status</Th></>}>{r.map((v) => <Tr key={v.id}><Td>{fmtDate(v.checked_in_at)}</Td><Td>{v.department}</Td><Td>{v.complaint}</Td><Td><StatusPill status={v.status} /></Td></Tr>)}</Table>
    )
  }
  return d.anc ? (
    <div className="p-5 text-body-sm space-y-2">
      <p>Antenatal record open: LMP {fmtDate(d.anc.lmp)}, due {fmtDate(d.anc.edd)}, G{d.anc.gravida} P{d.anc.parity}.</p>
      <Link href="/antenatal-care"><Button small variant="secondary">Open Antenatal Care</Button></Link>
    </div>
  ) : (
    <div className="p-5 text-body-sm space-y-2"><p className="text-on-surface-variant">No antenatal record for this patient.</p><Link href="/antenatal-care"><Button small variant="secondary">Open Antenatal Care</Button></Link></div>
  )
}

void useEffect
