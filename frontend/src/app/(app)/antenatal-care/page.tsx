'use client'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { ok, useQuery } from '@/lib/hooks'
import { ageOf, fmtDate, lagosToday } from '@/lib/format'
import { hasRole } from '@/lib/roles'
import { PatientPicker, type PickedPatient } from '@/components/PatientPicker'
import { Async, Icon, Button, Card, EmptyState, ErrorBox, Field, Input, PageHeader, Pill, Textarea, Table, Td, Th, Tr, cx, useAction, useToast } from '@/components/ui'

interface Mother {
  anc_record_id: string; patient_id: string; patient_code: string; full_name: string; dob: string; lmp: string; edd: string
  gravida: number | null; parity: number | null; risk_factors: string | null; weeks_now: number | null; days_to_edd: number | null
  visit_count: number; next_follow_up: string | null; follow_up_overdue: boolean
}
interface Visit { id: string; visit_date: string; gestational_weeks: number | null; bp_systolic: number | null; bp_diastolic: number | null; weight_kg: number | null; fundal_height_cm: number | null; complaints: string | null; findings: string | null; investigations: string | null; supplements: string | null; follow_up_date: string | null; recorder: { full_name: string } | null }

const dayDiff = (iso: string) => Math.round((new Date(`${iso}T12:00:00Z`).getTime() - new Date(`${lagosToday()}T12:00:00Z`).getTime()) / 86400000)
function followTag(m: Mother) {
  if (!m.next_follow_up) return null
  if (m.follow_up_overdue) return <Pill tone="danger" dot={false}>Overdue</Pill>
  const d = dayDiff(m.next_follow_up)
  if (d === 0) return <Pill tone="warn" dot={false}>Due today</Pill>
  if (d === 1) return <Pill tone="warn" dot={false}>Due tomorrow</Pill>
  if (d <= 7) return <Pill tone="info" dot={false}>Due in {d} days</Pill>
  return null
}

export default function AntenatalPage() {
  const { staff } = useAuth()
  const [sel, setSel] = useState<string | null>(null) // patient_id, or 'new'
  const canRecord = hasRole(staff?.role, 'doctor', 'nurse', 'community_health')

  const q = useQuery<Mother[]>(async () => ok(await supabase.from('anc_summary').select('*').order('full_name') as never), [], ['anc_records', 'anc_visits'])
  const mothers = q.data ?? []
  const current = mothers.find((m) => m.patient_id === sel) ?? (sel === 'new' ? null : mothers[0] ?? null)

  return (
    <>
      <PageHeader title="Antenatal Care" subtitle="One record per mother, kept across every visit."
        actions={!canRecord ? <Pill tone="neutral" dot={false}>Read only for your role</Pill> : undefined} />
      <Async q={q}>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
          <Card className="overflow-hidden lg:col-span-1">
            <div className="px-5 py-4 flex items-center justify-between"><h2 className="text-headline-sm">Mothers ({mothers.length})</h2>
              {canRecord && <Button small onClick={() => setSel('new')}>New</Button>}</div>
            {mothers.length === 0 ? <EmptyState title="No antenatal records yet" hint={canRecord ? 'Use New to open a record on the first visit.' : undefined} /> : (
              <ul className="divide-y divide-outline-variant/20">
                {mothers.map((m) => (
                  <li key={m.patient_id}>
                    <button type="button" onClick={() => setSel(m.patient_id)} className={cx('w-full text-left px-4 py-3 hover:bg-surface-container-low', current?.patient_id === m.patient_id && sel !== 'new' && 'bg-primary-fixed/40')}>
                      <span className="flex items-center justify-between gap-2"><span className="font-medium">{m.full_name}</span>{followTag(m)}</span>
                      <span className="block text-label-xs text-outline">{m.patient_code} • {m.weeks_now ?? '?'} weeks{m.next_follow_up ? ` • next visit ${fmtDate(m.next_follow_up)}` : ''}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <div className="lg:col-span-2 space-y-6">
            {sel === 'new' ? <NewMother onDone={(pid) => { setSel(pid); q.reload() }} onCancel={() => setSel(null)} />
              : current ? <MotherView key={current.patient_id} m={current} canRecord={canRecord} onSaved={q.reload} />
                : <Card><EmptyState title="Select a mother" /></Card>}
          </div>
        </div>
      </Async>
    </>
  )
}

function MotherView({ m, canRecord, onSaved }: { m: Mother; canRecord: boolean; onSaved: () => void }) {
  const visits = useQuery<Visit[]>(async () => ok(await supabase.from('anc_visits').select('id, visit_date, gestational_weeks, bp_systolic, bp_diastolic, weight_kg, fundal_height_cm, complaints, findings, investigations, supplements, follow_up_date, recorder:staff!anc_visits_recorded_by_fkey(full_name)').eq('anc_record_id', m.anc_record_id).order('visit_date', { ascending: false }) as never), [m.anc_record_id, m.visit_count], ['anc_visits'])
  return (
    <>
      <Card className="p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3"><span className="w-11 h-11 rounded-full bg-primary-fixed text-on-primary-fixed-variant flex items-center justify-center font-semibold">{m.full_name.split(' ').map((x) => x[0]).slice(0, 2).join('')}</span>
            <div><div className="flex items-center gap-2"><h2 className="text-headline-md">{m.full_name}</h2>{followTag(m)}</div><p className="text-body-sm text-on-surface-variant">{m.patient_code} • Female, {ageOf(m.dob)} yrs</p></div></div>
          <Link href={`/patients/${m.patient_id}`}><Button variant="secondary">Open Patient Profile</Button></Link>
        </div>
        <dl className="grid grid-cols-2 md:grid-cols-5 gap-4">
          {[['LMP', fmtDate(m.lmp)], ['Due date', fmtDate(m.edd)], ['Gestation', `${m.weeks_now ?? '?'} weeks`], ['Gravida / Parity', `${m.gravida ?? '—'} / ${m.parity ?? '—'}`], ['Visits', String(m.visit_count)]].map(([k, v]) => (
            <div key={k}><dt className="text-label-xs text-outline uppercase">{k}</dt><dd className="font-semibold">{v}</dd></div>
          ))}
        </dl>
        {m.risk_factors && <div className="flex items-start gap-2 p-3 rounded-lg bg-warn-container text-warn text-body-sm"><Icon name="warning" className="text-[18px] mt-px shrink-0" filled /><span><strong>Risk factors:</strong> {m.risk_factors}</span></div>}
      </Card>

      <Card className="overflow-hidden">
        <h2 className="px-5 py-4 text-headline-md flex items-center gap-2">Visit History</h2>
        <Async q={visits} isEmpty={(visits.data ?? []).length === 0} empty={<EmptyState title="No visits yet" />}>
          <Table head={<><Th>Visit date</Th><Th>Weeks</Th><Th>Blood pressure</Th><Th>Weight</Th><Th>Fundal height</Th><Th>Complaints</Th><Th>Findings</Th><Th>Investigations</Th><Th>Supplements</Th><Th>Follow-up</Th><Th>Recorded by</Th></>}>
            {visits.data?.map((v) => <Tr key={v.id}><Td>{fmtDate(v.visit_date)}</Td><Td>{v.gestational_weeks ?? '—'}</Td><Td>{v.bp_systolic ? `${v.bp_systolic}/${v.bp_diastolic}` : '—'}</Td><Td>{v.weight_kg ? `${v.weight_kg} kg` : '—'}</Td><Td>{v.fundal_height_cm ? `${v.fundal_height_cm} cm` : '—'}</Td><Td className="max-w-[14rem]">{v.complaints ?? '—'}</Td><Td className="max-w-[14rem]">{v.findings ?? '—'}</Td><Td className="max-w-[12rem]">{v.investigations ?? '—'}</Td><Td className="max-w-[12rem]">{v.supplements ?? '—'}</Td><Td className="whitespace-nowrap">{v.follow_up_date ? fmtDate(v.follow_up_date) : '—'}</Td><Td className="whitespace-nowrap">{v.recorder?.full_name ?? '—'}</Td></Tr>)}
          </Table>
        </Async>
      </Card>

      {canRecord && <VisitForm patientId={m.patient_id} lmp={m.lmp} existing onSaved={onSaved} />}
    </>
  )
}

function NewMother({ onDone, onCancel }: { onDone: (patientId: string) => void; onCancel: () => void }) {
  const [patient, setPatient] = useState<PickedPatient | null>(null)
  return (
    <Card className="p-6 space-y-4">
      <div className="flex items-center justify-between"><h2 className="text-headline-md">Open an antenatal record</h2><Button variant="ghost" small onClick={onCancel}>Cancel</Button></div>
      <Field label="Patient *" hint="The mother must already be registered. Antenatal care is for female patients."><PatientPicker value={patient} onChange={setPatient} autoFocus /></Field>
      {patient && patient.sex === 'male' && <ErrorBox message="Antenatal care is for female patients." />}
      {patient && patient.sex !== 'male' && <VisitForm patientId={patient.patient_id} lmp={null} existing={false} onSaved={() => onDone(patient.patient_id)} />}
    </Card>
  )
}

function VisitForm({ patientId, lmp, existing, onSaved }: { patientId: string; lmp: string | null; existing: boolean; onSaved: () => void }) {
  const toast = useToast()
  const { busy, run } = useAction()
  const blank = { visit_date: lagosToday(), weeks: '', follow_up: '', sys: '', dia: '', weight: '', fundal: '', complaints: '', findings: '', investigations: '', supplements: '', lmp: '', gravida: '', parity: '', risk: '' }
  const [f, setF] = useState(blank)
  const [err, setErr] = useState<string | null>(null)
  const [first, setFirst] = useState(!existing)
  useEffect(() => { setF(blank); setErr(null); setFirst(!existing) }, [patientId]) // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF((s) => ({ ...s, [k]: e.target.value }))
  const n = (s: string) => (s === '' ? null : Number(s))

  function check(): string | null {
    const lmpUsed = f.lmp || lmp
    if (!existing && !f.lmp) return 'The last menstrual period is required to open a record'
    if (f.visit_date > lagosToday()) return 'The visit date cannot be in the future'
    if (lmpUsed && f.visit_date < lmpUsed) return 'The visit date is before the last menstrual period'
    if ((f.sys === '') !== (f.dia === '')) return 'Enter both blood pressure values'
    if (f.sys && Number(f.sys) <= Number(f.dia)) return 'Systolic pressure must be higher than diastolic'
    if (f.gravida && f.parity && Number(f.parity) >= Number(f.gravida)) return 'Parity must be lower than gravida (gravida includes the current pregnancy)'
    if (f.follow_up && f.follow_up <= f.visit_date) return 'The follow-up date must be after the visit date'
    return null
  }
  async function save() {
    const e = check()
    setErr(e)
    if (e) return
    const r = await run(async () => {
      const { data, error } = await supabase.rpc('record_anc_visit', {
        p_patient_id: patientId, p_visit_date: f.visit_date, p_lmp: f.lmp || null, p_gravida: n(f.gravida), p_parity: n(f.parity), p_risk_factors: f.risk || null,
        p_gestational_weeks: n(f.weeks), p_complaints: f.complaints || null, p_bp_systolic: n(f.sys), p_bp_diastolic: n(f.dia), p_weight_kg: n(f.weight),
        p_fundal_height_cm: n(f.fundal), p_findings: f.findings || null, p_investigations: f.investigations || null, p_supplements: f.supplements || null, p_follow_up_date: f.follow_up || null,
      })
      if (error) throw error
      return data as { record_created: boolean; edd: string; gestational_weeks: number | null }
    })
    if (r) { toast(r.record_created ? `Antenatal record opened. Due date ${fmtDate(r.edd)}.` : 'Visit saved'); setF(blank); onSaved() }
  }

  return (
    <Card className="p-6 space-y-4">
      {existing && <h2 className="text-headline-md flex items-center gap-2">Record a Visit</h2>}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <Field label="Visit date"><Input type="date" value={f.visit_date} max={lagosToday()} onChange={set('visit_date')} /></Field>
        <Field label="Gestation (weeks)" hint="Worked out from the LMP if empty"><Input type="number" min={0} max={45} value={f.weeks} onChange={set('weeks')} /></Field>
        <Field label="Follow-up date"><Input type="date" value={f.follow_up} min={f.visit_date} onChange={set('follow_up')} /></Field>
        <Field label="Blood pressure (systolic)"><Input type="number" placeholder="mmHg" value={f.sys} onChange={set('sys')} /></Field>
        <Field label="Blood pressure (diastolic)"><Input type="number" placeholder="mmHg" value={f.dia} onChange={set('dia')} /></Field>
        <Field label="Weight (kg)"><Input type="number" step="0.1" value={f.weight} onChange={set('weight')} /></Field>
        <Field label="Fundal height (cm)"><Input type="number" step="0.1" value={f.fundal} onChange={set('fundal')} /></Field>
        <Field label="Complaints" className="md:col-span-2"><Input value={f.complaints} placeholder="Presenting complaints" onChange={set('complaints')} /></Field>
      </div>
      <Field label="Examination findings"><Textarea rows={2} value={f.findings} placeholder="Relevant findings" onChange={set('findings')} /></Field>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field label="Investigations"><Input value={f.investigations} placeholder="Laboratory tests done or requested" onChange={set('investigations')} /></Field>
        <Field label="Supplements"><Input value={f.supplements} placeholder="e.g. iron, folic acid" onChange={set('supplements')} /></Field>
      </div>
      <details open={first} onToggle={(e) => setFirst((e.target as HTMLDetailsElement).open)} className="rounded-lg bg-surface-container-low p-4">
        <summary className="cursor-pointer text-label-md font-medium">{existing ? 'Correct the pregnancy details (optional)' : 'First visit only: pregnancy details'}</summary>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-3">
          <Field label={`Last menstrual period (LMP)${existing ? '' : ' *'}`} hint="The due date is worked out from this"><Input type="date" value={f.lmp} max={lagosToday()} onChange={set('lmp')} /></Field>
          <Field label="Gravida"><Input type="number" min={1} value={f.gravida} onChange={set('gravida')} /></Field>
          <Field label="Parity" hint="Must be lower than gravida"><Input type="number" min={0} value={f.parity} onChange={set('parity')} /></Field>
          <Field label="Risk factors" className="md:col-span-3"><Input value={f.risk} placeholder="Anything the next clinician should know" onChange={set('risk')} /></Field>
        </div>
      </details>
      {err && <p className="text-body-sm text-error" role="alert">{err}</p>}
      <div className="flex justify-end"><Button busy={busy} onClick={() => void save()}>Save Visit</Button></div>
    </Card>
  )
}
