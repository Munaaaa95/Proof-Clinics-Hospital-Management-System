'use client'
import Link from 'next/link'
import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { ok, useQuery } from '@/lib/hooks'
import { ageOf, ageSex, fmtDate, fmtDateTime, fmtTime, many, minutesSince, waitText } from '@/lib/format'
import { AdmitModal } from '@/components/AdmitModal'
import { Async, Button, Card, Drawer, EmptyState, ErrorBox, Field, Icon, Input, LoadingBlock, PageHeader, Select, StatusPill, Table, Td, Textarea, Th, Tr, cx, titleCaseVisit, useAction, useToast } from '@/components/ui'

export default function ConsultationPage() {
  return <Suspense fallback={<LoadingBlock />}><Inner /></Suspense>
}

function Inner() {
  const visit = useSearchParams().get('visit')
  return visit ? <Room visitId={visit} /> : <Picker />
}

// ------------------------------------------------------------------ no visit chosen: list the doctor's work
interface VisitRow {
  id: string; patient_id: string; department: string; complaint: string | null; status: string; checked_in_at: string; doctor_id: string | null
  patient: { full_name: string; patient_code: string; dob: string; sex: string } | null
}
function Picker() {
  const router = useRouter()
  const { staff } = useAuth()
  const { busy, run } = useAction()
  const isDoctor = staff?.role === 'doctor'
  const q = useQuery<VisitRow[]>(async () => ok(await supabase.from('visits')
    .select('id, patient_id, department, complaint, status, checked_in_at, doctor_id, patient:patients(full_name, patient_code, dob, sex)')
    .in('status', ['waiting', 'in_consultation']).order('checked_in_at') as never), [], ['visits'])
  const mine = (q.data ?? []).filter((v) => v.status === 'in_consultation' && (!isDoctor || v.doctor_id === staff?.id))
  const waiting = (q.data ?? []).filter((v) => v.status === 'waiting')
  const start = (v: VisitRow) => run(async () => {
    const { error } = await supabase.rpc('start_consultation', { p_visit_id: v.id })
    if (error) throw error
    router.push(`/consultation?visit=${v.id}`)
  })
  return (
    <>
      <PageHeader title="Clinical Consultation" subtitle="Open a consultation in progress, or start the next waiting patient." />
      <Async q={q}>
        <Card className="overflow-hidden">
          <h2 className="px-5 py-4 text-headline-md">{isDoctor ? 'Your consultations in progress' : 'Consultations in progress'}</h2>
          {mine.length === 0 ? <EmptyState title="No consultation in progress" hint="Start a waiting patient below, or from the queue." /> : (
            <Table head={<><Th>Patient</Th><Th>Department</Th><Th>Complaint</Th><Th>Action</Th></>}>
              {mine.map((v) => <Tr key={v.id}><Td><div className="font-medium">{v.patient?.full_name}</div><div className="text-outline text-label-xs">{v.patient?.patient_code}</div></Td><Td>{v.department}</Td><Td>{v.complaint}</Td>
                <Td><Button small onClick={() => router.push(`/consultation?visit=${v.id}`)}>Resume</Button></Td></Tr>)}
            </Table>
          )}
        </Card>
        <Card className="overflow-hidden">
          <h2 className="px-5 py-4 text-headline-md">Waiting for a doctor</h2>
          {waiting.length === 0 ? <EmptyState title="Nobody is waiting" /> : (
            <Table head={<><Th>Patient</Th><Th>Department</Th><Th>Complaint</Th><Th>Waiting</Th><Th>Action</Th></>}>
              {waiting.map((v) => <Tr key={v.id}><Td><div className="font-medium">{v.patient?.full_name}</div><div className="text-outline text-label-xs">{v.patient?.patient_code} • {ageSex(v.patient?.dob, v.patient?.sex)}</div></Td><Td>{v.department}</Td><Td>{v.complaint}</Td><Td>{waitText(minutesSince(v.checked_in_at))}</Td>
                <Td>{isDoctor ? <Button small busy={busy} onClick={() => void start(v)}>Start Consultation</Button> : <span className="text-outline">Doctors only</span>}</Td></Tr>)}
            </Table>
          )}
        </Card>
      </Async>
    </>
  )
}

// ------------------------------------------------------------------ the consultation room
const ROUTES = ['Oral (PO)', 'Intravenous (IV)', 'Intramuscular (IM)', 'Subcutaneous (SC)', 'Topical', 'Rectal', 'Inhalation']
// Stored as the short code the reminder scheduler understands.
const FREQUENCIES: { code: string; label: string; perDay: number }[] = [
  { code: 'OD', label: 'OD (Once daily)', perDay: 1 }, { code: 'BD', label: 'BD (Twice daily)', perDay: 2 },
  { code: 'TDS', label: 'TDS (Three times daily)', perDay: 3 }, { code: 'QDS', label: 'QDS (Four times daily)', perDay: 4 },
  { code: 'PRN', label: 'PRN (When needed)', perDay: 0 }, { code: 'STAT', label: 'STAT (Immediately, once)', perDay: 0 },
]
const DISPOSITIONS = [{ v: 'home', l: 'Home' }, { v: 'follow_up', l: 'Follow-up' }, { v: 'referral', l: 'Referral' }, { v: 'admission', l: 'Admission' }, { v: 'other', l: 'Other' }]

interface LabRes { result: string | null; reference_range: string | null; status: string }
interface Room {
  visit: {
    id: string; patient_id: string; visit_type: string; department: string; complaint: string | null; status: string; doctor_id: string | null
    started_at: string | null; checked_in_at: string; patient: { full_name: string; patient_code: string; dob: string; sex: string; phone: string | null; allergies: string | null; medical_history: string | null }
  }
  vitals: { id: string; temperature_c: number | null; pulse: number | null; resp_rate: number | null; bp_systolic: number | null; bp_diastolic: number | null; weight_kg: number | null; recorded_at: string }[]
  consultation: { notes: string | null; treatment: string | null } | null
  diagnoses: { id: string; diagnosis: string; created_at: string }[]
  prescriptions: { id: string; dose: string; route: string; frequency: string; duration_days: number | null; quantity: number; status: string; drug: { name: string; unit: string } | null }[]
  labs: { id: string; status: string; service: { name: string; specimen_type: string | null } | null; result: LabRes | LabRes[] | null }[]
  drugs: { id: string; name: string; unit: string }[]
  tests: { id: string; name: string; specimen_type: string | null }[]
  admission: { id: string } | null
}

type TabId = 'vitals' | 'notes' | 'diagnosis' | 'prescriptions' | 'labs'

function Room({ visitId }: { visitId: string }) {
  const router = useRouter()
  const { staff } = useAuth()
  const toast = useToast()
  const [tab, setTab] = useState<TabId>('notes')
  const [history, setHistory] = useState(false)
  const [admit, setAdmit] = useState(false)

  const q = useQuery<Room>(async () => {
    const [v, vit, con, dx, rx, lab, drugs, tests, adm] = await Promise.all([
      supabase.from('visits').select('id, patient_id, visit_type, department, complaint, status, doctor_id, started_at, checked_in_at, patient:patients(full_name, patient_code, dob, sex, phone, allergies, medical_history)').eq('id', visitId).single(),
      supabase.from('vitals').select('id, temperature_c, pulse, resp_rate, bp_systolic, bp_diastolic, weight_kg, recorded_at').eq('visit_id', visitId).order('recorded_at', { ascending: false }),
      supabase.from('consultations').select('notes, treatment').eq('visit_id', visitId).maybeSingle(),
      supabase.from('diagnoses').select('id, diagnosis, created_at').eq('visit_id', visitId).order('created_at'),
      supabase.from('prescriptions').select('id, dose, route, frequency, duration_days, quantity, status, drug:drugs(name, unit)').eq('visit_id', visitId).order('prescribed_at'),
      supabase.from('lab_requests').select('id, status, service:services(name, specimen_type), result:lab_results(result, reference_range, status)').eq('visit_id', visitId).order('requested_at'),
      supabase.from('drugs').select('id, name, unit').order('name'),
      supabase.from('services').select('id, name, specimen_type').eq('category', 'lab').order('name'),
      supabase.from('admissions').select('id').eq('visit_id', visitId).eq('status', 'active').maybeSingle(),
    ])
    return {
      visit: ok(v as never), vitals: ok(vit as never), consultation: ok(con as never), diagnoses: ok(dx as never), prescriptions: ok(rx as never),
      labs: ok(lab as never), drugs: ok(drugs as never), tests: ok(tests as never), admission: ok(adm as never),
    } as Room
  }, [visitId], ['visits', 'vitals', 'consultations', 'diagnoses', 'prescriptions', 'lab_requests', 'lab_results', 'admissions'])

  const r = q.data
  const locked = !!r && r.visit.status !== 'in_consultation'
  const mine = !r || staff?.role !== 'doctor' || r.visit.doctor_id === staff.id
  const readOnly = locked || staff?.role !== 'doctor' || !mine

  if (q.error && !r) return <ErrorBox message={q.error} onRetry={q.reload} />
  if (!r) return <LoadingBlock />
  const { visit } = r
  const p = visit.patient
  const lastV = r.vitals[0]

  const tabs: { id: TabId; icon: string; label: string; count?: number }[] = [
    { id: 'vitals', icon: 'monitor_heart', label: 'Vitals' },
    { id: 'notes', icon: 'edit_note', label: 'Clinical Notes' },
    { id: 'diagnosis', icon: 'clinical_notes', label: 'Diagnosis', count: r.diagnoses.length },
    { id: 'prescriptions', icon: 'prescriptions', label: 'Prescriptions', count: r.prescriptions.length },
    { id: 'labs', icon: 'biotech', label: 'Lab Requests', count: r.labs.length },
  ]

  return (
    <>
      <PageHeader title="Clinical Consultation"
        subtitle={visit.started_at ? `Session started ${fmtDateTime(visit.started_at)} • ${staff?.full_name}` : undefined}
        badge={locked ? <StatusPill status={visit.status} /> : undefined}
        actions={<Link href="/consultation"><Button variant="secondary">All consultations</Button></Link>} />

      <Card className="p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <Link href={`/patients/${visit.patient_id}`} className="text-headline-md hover:underline">{p.full_name}</Link>
            <span className="text-body-sm text-on-surface-variant">{p.sex[0].toUpperCase() + p.sex.slice(1)}, {ageOf(p.dob)} yrs</span>
            {p.allergies
              ? <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-error-container text-on-error-container text-label-xs"><Icon name="warning" className="text-[14px]" filled />Allergy: {p.allergies}</span>
              : <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-surface-container-high text-on-surface-variant text-label-xs">No known allergies recorded</span>}
            <span className="text-body-sm">Patient ID: <strong>{p.patient_code}</strong></span>
            <span className="text-body-sm">Phone: <strong>{p.phone ?? '—'}</strong></span>
          </div>
          <Button variant="secondary" onClick={() => setHistory(true)}>Previous Visits</Button>
        </div>
      </Card>

      <Card className="p-6">
        <h2 className="text-label-sm text-outline uppercase mb-3">Recorded Vitals {lastV && <span className="normal-case text-label-xs">— {fmtTime(lastV.recorded_at)}</span>}</h2>
        {!lastV ? <p className="text-body-sm text-outline">No vitals recorded for this visit yet.</p> : (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {[
              { l: 'Blood Pressure', i: 'cardiology', v: lastV.bp_systolic && lastV.bp_diastolic ? `${lastV.bp_systolic}/${lastV.bp_diastolic}` : '—', u: 'mmHg' },
              { l: 'Pulse', i: 'favorite', v: lastV.pulse ?? '—', u: 'bpm' },
              { l: 'Body Temp', i: 'device_thermostat', v: lastV.temperature_c ?? '—', u: '°C' },
              { l: 'Respiratory Rate', i: 'air', v: lastV.resp_rate ?? '—', u: 'breaths/min' },
              { l: 'Weight', i: 'scale', v: lastV.weight_kg ?? '—', u: 'kg' },
            ].map((x) => (
              <div key={x.l} className="rounded-lg bg-surface-container-low p-3">
                <div className="text-[11px] font-medium uppercase tracking-wider text-outline">{x.l}</div>
                <div className="mt-1"><span className="text-headline-md font-semibold">{x.v}</span> <span className="text-label-xs text-outline">{x.u}</span></div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <div>
        <div className="flex flex-wrap gap-1 border-b border-outline-variant/40">
          {tabs.map((t) => (
            <button key={t.id} type="button" onClick={() => setTab(t.id)}
              className={cx('flex items-center gap-1.5 px-4 h-10 text-label-md -mb-px', tab === t.id ? 'text-primary font-semibold border-b-2 border-primary bg-surface-container-lowest rounded-t-lg' : 'text-secondary hover:text-on-surface')}>
              {t.label}
              {t.count ? <span className="text-label-xs bg-primary-fixed text-on-primary-fixed-variant rounded-full px-1.5">{t.count}</span> : null}
            </button>
          ))}
        </div>
        <Card className="rounded-t-none p-6">
          {readOnly && <p className="mb-4 text-body-sm text-on-surface-variant bg-surface-container-low rounded-lg px-3 py-2">{locked ? 'This visit is completed, so the record is read-only.' : 'Only the treating doctor can change this consultation.'}</p>}
          {tab === 'vitals' && <VitalsTab r={r} readOnly={readOnly || false} onSaved={q.reload} />}
          {tab === 'notes' && <NotesTab r={r} readOnly={readOnly} onSaved={q.reload} />}
          {tab === 'diagnosis' && <DiagnosisTab r={r} readOnly={readOnly} onSaved={q.reload} />}
          {tab === 'prescriptions' && <PrescriptionsTab r={r} readOnly={readOnly} onSaved={q.reload} />}
          {tab === 'labs' && <LabsTab r={r} readOnly={readOnly} onSaved={q.reload} />}
        </Card>
      </div>

      {r.admission && !locked && (
        <Card className="p-6 flex flex-wrap items-center justify-between gap-3">
          <p className="flex items-center gap-2 text-body-md">This patient is admitted. New prescriptions go on the nurse’s medication record; discharge the patient from the ward.</p>
          <Link href={`/discharge/${r.admission.id}`}><Button variant="secondary">Go to discharge</Button></Link>
        </Card>
      )}

      {!locked && !r.admission && staff?.role === 'doctor' && mine && (
        <Disposition r={r} onAdmit={() => setAdmit(true)} onDone={() => { toast('Visit completed'); router.push('/queue') }} />
      )}

      <HistoryDrawer open={history} onClose={() => setHistory(false)} patientId={visit.patient_id} currentVisit={visit.id} />
      <AdmitModal open={admit} onClose={() => setAdmit(false)} visitId={visit.id} defaultDiagnosis={r.diagnoses.at(-1)?.diagnosis}
        onDone={() => { setAdmit(false); toast(`${p.full_name} admitted`); router.push('/inpatient') }} />
    </>
  )
}

interface TabProps { r: Room; readOnly: boolean; onSaved: () => void }

function VitalsTab({ r, readOnly, onSaved }: TabProps) {
  const { staff } = useAuth()
  const { busy, run } = useAction()
  const empty = { temperature_c: '', pulse: '', resp_rate: '', bp_systolic: '', bp_diastolic: '', weight_kg: '' }
  const [f, setF] = useState(empty)
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF((s) => ({ ...s, [k]: e.target.value }))
  const canRecord = !readOnly || (r.visit.status === 'in_consultation' && ['nurse', 'receptionist', 'community_health'].includes(staff?.role ?? ''))
  const num = (s: string) => (s === '' ? null : Number(s))
  async function save() {
    const vals = Object.values(f).filter((x) => x !== '')
    if (vals.length === 0) throw new Error('Enter at least one measurement')
    if ((f.bp_systolic === '') !== (f.bp_diastolic === '')) throw new Error('Enter both blood pressure numbers')
    if (f.bp_systolic && Number(f.bp_systolic) <= Number(f.bp_diastolic)) throw new Error('Systolic pressure must be higher than diastolic')
    const { error } = await supabase.from('vitals').insert({
      visit_id: r.visit.id, patient_id: r.visit.patient_id, temperature_c: num(f.temperature_c), pulse: num(f.pulse), resp_rate: num(f.resp_rate),
      bp_systolic: num(f.bp_systolic), bp_diastolic: num(f.bp_diastolic), weight_kg: num(f.weight_kg),
    })
    if (error) throw error
    setF(empty)
    onSaved()
  }
  return (
    <div className="space-y-4">
      {canRecord && (
        <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
          <Field label="BP systolic (mmHg)"><Input type="number" inputMode="numeric" value={f.bp_systolic} onChange={set('bp_systolic')} /></Field>
          <Field label="BP diastolic (mmHg)"><Input type="number" inputMode="numeric" value={f.bp_diastolic} onChange={set('bp_diastolic')} /></Field>
          <Field label="Pulse (bpm)"><Input type="number" inputMode="numeric" value={f.pulse} onChange={set('pulse')} /></Field>
          <Field label="Temp (°C)"><Input type="number" step="0.1" value={f.temperature_c} onChange={set('temperature_c')} /></Field>
          <Field label="Resp. rate"><Input type="number" inputMode="numeric" value={f.resp_rate} onChange={set('resp_rate')} /></Field>
          <Field label="Weight (kg)"><Input type="number" step="0.1" value={f.weight_kg} onChange={set('weight_kg')} /></Field>
        </div>
      )}
      {canRecord && <Button busy={busy} onClick={() => void run(save, 'Vitals recorded')}>Record vitals</Button>}
      {r.vitals.length > 0 && (
        <Table head={<><Th>Time</Th><Th>BP</Th><Th>Pulse</Th><Th>Temp</Th><Th>Resp.</Th><Th>Weight</Th></>}>
          {r.vitals.map((v) => <Tr key={v.id}><Td>{fmtTime(v.recorded_at)}</Td><Td>{v.bp_systolic ? `${v.bp_systolic}/${v.bp_diastolic}` : '—'}</Td><Td>{v.pulse ?? '—'}</Td><Td>{v.temperature_c ?? '—'}</Td><Td>{v.resp_rate ?? '—'}</Td><Td>{v.weight_kg ?? '—'}</Td></Tr>)}
        </Table>
      )}
    </div>
  )
}

function NotesTab({ r, readOnly, onSaved }: TabProps) {
  const { staff } = useAuth()
  const { busy, run } = useAction()
  const [complaint, setComplaint] = useState(r.visit.complaint ?? '')
  const [notes, setNotes] = useState(r.consultation?.notes ?? '')
  const [plan, setPlan] = useState(r.consultation?.treatment ?? '')
  async function save() {
    if (!complaint.trim()) throw new Error('Enter the chief complaint')
    if (complaint !== r.visit.complaint) {
      const { error } = await supabase.from('visits').update({ complaint }).eq('id', r.visit.id)
      if (error) throw error
    }
    const { error } = await supabase.from('consultations').upsert(
      { visit_id: r.visit.id, patient_id: r.visit.patient_id, doctor_id: staff!.id, notes, treatment: plan }, { onConflict: 'visit_id' })
    if (error) throw error
    onSaved()
  }
  return (
    <div className="space-y-4">
      <Field label="Chief Complaint *"><Input value={complaint} disabled={readOnly} onChange={(e) => setComplaint(e.target.value)} /></Field>
      <Field label="Consultation Notes (history and examination)"><Textarea rows={5} value={notes} disabled={readOnly} onChange={(e) => setNotes(e.target.value)} /></Field>
      <Field label="Treatment / Plan"><Textarea rows={3} value={plan} disabled={readOnly} onChange={(e) => setPlan(e.target.value)} /></Field>
      {!readOnly && <Button busy={busy} onClick={() => void run(save, 'Notes saved')}>Save notes</Button>}
    </div>
  )
}

function DiagnosisTab({ r, readOnly, onSaved }: TabProps) {
  const { staff } = useAuth()
  const { busy, run } = useAction()
  const [text, setText] = useState('')
  async function add() {
    if (!text.trim()) throw new Error('Type a diagnosis first')
    const { error } = await supabase.from('diagnoses').insert({ visit_id: r.visit.id, patient_id: r.visit.patient_id, diagnosis: text.trim(), entered_by: staff!.id })
    if (error) throw error
    setText('')
    onSaved()
  }
  return (
    <div className="space-y-4">
      <p className="text-body-sm text-outline">Only doctors can enter a diagnosis. Entries are never deleted: to correct one, add a new entry.</p>
      {!readOnly && (
        <div className="flex gap-2">
          <div className="relative flex-1"><Icon name="search" className="absolute left-2.5 top-2 text-[18px] text-outline" /><Input className="pl-9" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void run(add) } }} placeholder="Type a diagnosis" /></div>
          <Button busy={busy} onClick={() => void run(add, 'Diagnosis added')}>Add</Button>
        </div>
      )}
      {r.diagnoses.length === 0 ? <EmptyState title="No diagnosis recorded yet" /> : (
        <ul className="space-y-2">{r.diagnoses.map((d) => <li key={d.id} className="flex items-center justify-between px-3 py-2 rounded-lg bg-surface-container-low"><span className="flex items-center gap-2"><span className="w-1.5 h-1.5 rounded-full bg-primary" />{d.diagnosis}</span><span className="text-label-xs text-outline">{fmtTime(d.created_at)}</span></li>)}</ul>
      )}
    </div>
  )
}

function PrescriptionsTab({ r, readOnly, onSaved }: TabProps) {
  const { busy, run } = useAction()
  const blank = { drug_id: '', dose: '', route: ROUTES[0], frequency: 'TDS', days: '5', quantity: '' }
  const [f, setF] = useState(blank)
  const [adding, setAdding] = useState(false)
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((s) => ({ ...s, [k]: e.target.value }))
  const perDay = FREQUENCIES.find((x) => x.code === f.frequency)?.perDay ?? 0
  const suggested = perDay && Number(f.days) > 0 ? perDay * Number(f.days) : f.frequency === 'STAT' ? 1 : null
  const drug = r.drugs.find((d) => d.id === f.drug_id)

  async function add() {
    if (!f.drug_id) throw new Error('Choose a drug')
    if (!f.dose.trim()) throw new Error('Enter the dose, for example 500mg')
    const quantity = Number(f.quantity || suggested)
    if (!quantity || quantity < 1) throw new Error('Enter the quantity to dispense')
    const { error } = await supabase.from('prescriptions').insert({
      patient_id: r.visit.patient_id, visit_id: r.visit.id, drug_id: f.drug_id, dose: f.dose.trim(), route: f.route, frequency: f.frequency,
      admission_id: r.admission?.id ?? null, // an admitted patient's drugs go on the nurse's medication record
      duration_days: f.days ? Number(f.days) : null, quantity,
    })
    if (error) throw error
    setF(blank)
    setAdding(false)
    onSaved()
  }
  const cancel = (id: string) => run(async () => {
    const { error } = await supabase.from('prescriptions').update({ status: 'cancelled' }).eq('id', id)
    if (error) throw error
    onSaved()
  }, 'Prescription cancelled')

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-headline-sm flex items-center gap-2">Medication &amp; Prescriptions</h3>
        {!readOnly && !adding && <Button small onClick={() => setAdding(true)}>Add Medication</Button>}
      </div>
      {adding && (
        <div className="rounded-lg bg-surface-container-low p-4 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Field label="Drug *"><Select value={f.drug_id} onChange={set('drug_id')}><option value="">Select a drug…</option>{r.drugs.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select></Field>
            <Field label="Dose *"><Input value={f.dose} onChange={set('dose')} placeholder="e.g. 500mg" /></Field>
            <Field label="Route"><Select value={f.route} onChange={set('route')}>{ROUTES.map((x) => <option key={x}>{x}</option>)}</Select></Field>
            <Field label="Frequency"><Select value={f.frequency} onChange={set('frequency')}>{FREQUENCIES.map((x) => <option key={x.code} value={x.code}>{x.label}</option>)}</Select></Field>
            <Field label="Duration (days)"><Input type="number" min={1} value={f.days} onChange={set('days')} /></Field>
            <Field label={`Quantity${drug ? ` (${drug.unit}s)` : ''} *`} hint={suggested ? `Suggested ${suggested}` : undefined}><Input type="number" min={1} value={f.quantity} placeholder={suggested ? String(suggested) : ''} onChange={set('quantity')} /></Field>
          </div>
          <div className="flex gap-2"><Button busy={busy} onClick={() => void run(add, 'Medication added')}>Add to prescription</Button><Button variant="ghost" onClick={() => setAdding(false)}>Cancel</Button></div>
        </div>
      )}
      {r.prescriptions.length === 0 ? <EmptyState title="No medication prescribed yet" /> : (
        <Table head={<><Th>Drug Name</Th><Th>Dosage / Route</Th><Th>Frequency</Th><Th>Duration</Th><Th>Quantity</Th><Th>Status</Th><Th /></>}>
          {r.prescriptions.map((x) => (
            <Tr key={x.id}>
              <Td className="font-medium">{x.drug?.name}</Td><Td>{x.dose} • {x.route}</Td><Td>{FREQUENCIES.find((f) => f.code === x.frequency)?.label ?? x.frequency}</Td>
              <Td>{x.duration_days ? `${x.duration_days} days` : '—'}</Td><Td>{x.quantity} {x.drug?.unit}s</Td><Td><StatusPill status={x.status} /></Td>
              <Td>{!readOnly && x.status === 'prescribed' && <Button small variant="ghost" onClick={() => void cancel(x.id)}>Cancel</Button>}</Td>
            </Tr>
          ))}
        </Table>
      )}
    </div>
  )
}

function LabsTab({ r, readOnly, onSaved }: TabProps) {
  const { staff } = useAuth()
  const { busy, run } = useAction()
  const [test, setTest] = useState('')
  async function add() {
    if (!test) throw new Error('Choose a test')
    const { error } = await supabase.from('lab_requests').insert({ patient_id: r.visit.patient_id, visit_id: r.visit.id, service_id: test, requested_by: staff!.id })
    if (error) throw error
    setTest('')
    onSaved()
  }
  return (
    <div className="space-y-4">
      <h3 className="text-headline-sm flex items-center gap-2">Laboratory Investigation</h3>
      {!readOnly && (
        <div className="flex gap-2">
          <Select value={test} onChange={(e) => setTest(e.target.value)} className="max-w-xs"><option value="">Select a test…</option>{r.tests.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select>
          <Button busy={busy} onClick={() => void run(add, 'Lab test requested')}>+ Add Test</Button>
        </div>
      )}
      {r.labs.length === 0 ? <EmptyState title="No tests requested" /> : (
        <div className="space-y-2">
          {r.labs.map((l) => {
            const res = many(l.result).find((x) => x.status === 'finalized')
            return (
              <div key={l.id} className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg bg-surface-container-low">
                <div><div className="font-medium">{l.service?.name}</div><div className="text-label-xs text-outline">Specimen: {l.service?.specimen_type ?? '—'}</div>
                  {res && <div className="text-body-sm mt-1"><span className="text-tertiary font-medium">Result:</span> {res.result} {res.reference_range && <span className="text-outline">(ref. {res.reference_range})</span>}</div>}</div>
                <StatusPill status={l.status} />
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function Disposition({ r, onAdmit, onDone }: { r: Room; onAdmit: () => void; onDone: () => void }) {
  const { busy, run } = useAction()
  const [disp, setDisp] = useState('home')
  const [plan, setPlan] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const quick = (t: string) => setPlan((p) => (p ? `${p}\n` : '') + t)

  async function complete() {
    setErr(null)
    if (disp === 'admission') return onAdmit()
    if (disp === 'follow_up' && !plan.trim()) return setErr('Describe the follow-up plan')
    if (r.diagnoses.length === 0 && !window.confirm('No diagnosis has been recorded. Complete the visit anyway?')) return
    const ok_ = await run(async () => {
      const { error } = await supabase.rpc('complete_visit', { p_visit_id: r.visit.id, p_disposition: disp, p_follow_up_plan: plan.trim() || null })
      if (error) throw error
      return true
    })
    if (ok_) onDone()
  }
  return (
    <Card className="p-6 space-y-4">
      <h2 className="text-headline-md flex items-center gap-2">Encounter Disposition</h2>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Field label="Disposition Action"><Select value={disp} onChange={(e) => setDisp(e.target.value)}>{DISPOSITIONS.map((d) => <option key={d.v} value={d.v}>{d.l}</option>)}</Select></Field>
        <div className="md:col-span-2">
          <span className="block text-label-sm font-medium mb-1.5">Follow-up Schedule</span>
          <div className="flex gap-2 flex-wrap">
            {['Review after 3 days.', 'Review in 1 week, after lab results.', 'Return immediately if symptoms worsen.'].map((t) => <button key={t} type="button" onClick={() => quick(t)} className="h-8 px-3 rounded-lg bg-surface-container-low hover:bg-surface-container-high text-label-sm">{t.replace(/\.$/, '')}</button>)}
          </div>
        </div>
      </div>
      <Field label="Follow-up Plan"><Textarea rows={2} value={plan} onChange={(e) => setPlan(e.target.value)} placeholder="E.g., Return immediately if shortness of breath occurs..." /></Field>
      {disp === 'admission' && <p className="text-body-sm text-on-surface-variant bg-surface-container-low rounded-lg px-3 py-2">Choosing Admission opens the bed picker. The visit stays open until the patient is discharged from the ward.</p>}
      {err && <p className="text-body-sm text-error" role="alert">{err}</p>}
      <div className="flex justify-end"><Button busy={busy} onClick={() => void complete()}>{disp === 'admission' ? 'Admit Patient' : 'Complete Visit'}</Button></div>
    </Card>
  )
}

function HistoryDrawer({ open, onClose, patientId, currentVisit }: { open: boolean; onClose: () => void; patientId: string; currentVisit: string }) {
  const q = useQuery(async () => {
    if (!open) return []
    return ok(await supabase.from('visits').select('id, visit_type, department, complaint, status, checked_in_at, disposition, diagnoses(diagnosis)')
      .eq('patient_id', patientId).neq('id', currentVisit).order('checked_in_at', { ascending: false }).limit(20) as never) as { id: string; visit_type: string; department: string; complaint: string | null; status: string; checked_in_at: string; disposition: string | null; diagnoses: { diagnosis: string }[] }[]
  }, [open, patientId, currentVisit])
  useEffect(() => { /* reload on open handled by deps */ }, [])
  return (
    <Drawer open={open} onClose={onClose} title="Previous Visits">
      <Async q={q} isEmpty={(q.data ?? []).length === 0} empty={<EmptyState title="No earlier visits" />}>
        <div className="space-y-3">
          {q.data?.map((v) => (
            <div key={v.id} className="rounded-lg bg-surface-container-low p-3 space-y-1">
              <div className="flex items-center justify-between"><span className="font-medium">{fmtDate(v.checked_in_at)} • {titleCaseVisit(v.visit_type)}</span><StatusPill status={v.status} /></div>
              <p className="text-body-sm text-on-surface-variant">{v.department} — {v.complaint}</p>
              {v.diagnoses.length > 0 && <p className="text-body-sm"><span className="text-outline">Diagnosis:</span> {v.diagnoses.map((d) => d.diagnosis).join('; ')}</p>}
            </div>
          ))}
        </div>
      </Async>
    </Drawer>
  )
}
