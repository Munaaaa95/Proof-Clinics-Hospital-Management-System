'use client'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { ok, useQuery } from '@/lib/hooks'
import { ageOf, fmtDate, fmtDateTime, fmtTime, many, titleCase } from '@/lib/format'
import { hasRole } from '@/lib/roles'
import { Async, Button, Card, EmptyState, Field, PageHeader, Pill, Select, StatusPill, Tabs, Textarea, useAction, type Tone } from '@/components/ui'

interface Chart {
  adm: {
    id: string; status: string; diagnosis: string | null; admitted_at: string; discharged_at: string | null; visit_id: string
    patient: { id: string; full_name: string; patient_code: string; dob: string; sex: string; allergies: string | null } | null
    bed: { bed_number: string; ward: { name: string } | null } | null
    doctor: { full_name: string } | null
    nurse: { full_name: string } | null
  }
  notes: { id: string; note_type: string; body: string; created_at: string; author: { full_name: string; role: string } | null }[]
  mar: { id: string; status: string; scheduled_for: string; notes: string | null; rx: { dose: string; route: string; frequency: string; drug: { name: string } | null } | null }[]
  labs: { id: string; status: string; requested_at: string; service: { name: string } | null; result: { result: string; reference_range: string | null; status: string } | { result: string; reference_range: string | null; status: string }[] | null }[]
  vitals: { id: string; temperature_c: number | null; pulse: number | null; resp_rate: number | null; bp_systolic: number | null; bp_diastolic: number | null; weight_kg: number | null; recorded_at: string } | null
}

const NOTE: Record<string, { label: string; tone: Tone }> = {
  progress: { label: 'Progress note', tone: 'info' },
  nursing: { label: 'Nursing note', tone: 'neutral' },
  treatment_plan: { label: 'Treatment plan', tone: 'warn' },
}
type NoteFilter = 'all' | 'progress' | 'nursing' | 'treatment_plan'

// Spec 8: the admitted patient's chart. Diagnosis, ward and bed, nursing information, current medication,
// investigations, treatment plans and progress notes in one place.
export default function InpatientChartPage() {
  const { id } = useParams<{ id: string }>()
  const { staff } = useAuth()
  const { busy, run } = useAction()
  const [filter, setFilter] = useState<NoteFilter>('all')
  const [type, setType] = useState('progress')
  const [body, setBody] = useState('')
  const [err, setErr] = useState<string | null>(null)

  const q = useQuery<Chart>(async () => {
    const adm = ok(await supabase.from('admissions')
      .select('id, status, diagnosis, admitted_at, discharged_at, visit_id, patient:patients(id, full_name, patient_code, dob, sex, allergies), bed:beds(bed_number, ward:wards(name)), doctor:staff!admissions_doctor_id_fkey(full_name), nurse:staff!admissions_nurse_id_fkey(full_name)')
      .eq('id', id).single() as never) as Chart['adm']
    const [notes, mar, labs, vitals] = await Promise.all([
      supabase.from('progress_notes').select('id, note_type, body, created_at, author:staff!progress_notes_author_id_fkey(full_name, role)').eq('admission_id', id).order('created_at', { ascending: false }),
      supabase.from('medication_administrations').select('id, status, scheduled_for, notes, rx:prescriptions(dose, route, frequency, drug:drugs(name))').eq('admission_id', id).order('scheduled_for'),
      supabase.from('lab_requests').select('id, status, requested_at, service:services(name), result:lab_results(result, reference_range, status)').eq('visit_id', adm.visit_id).order('requested_at', { ascending: false }),
      supabase.from('vitals').select('id, temperature_c, pulse, resp_rate, bp_systolic, bp_diastolic, weight_kg, recorded_at').eq('visit_id', adm.visit_id).order('recorded_at', { ascending: false }).limit(1),
    ])
    return { adm, notes: ok(notes as never), mar: ok(mar as never), labs: ok(labs as never), vitals: (ok(vitals as never) as Chart['vitals'][])[0] ?? null }
  }, [id], ['progress_notes', 'medication_administrations', 'lab_requests', 'lab_results', 'vitals', 'admissions'])

  const c = q.data
  const active = c?.adm.status === 'active'
  const isDoctor = hasRole(staff?.role, 'doctor')
  const canWrite = active && hasRole(staff?.role, 'doctor', 'nurse')
  const types = isDoctor ? ['progress', 'nursing', 'treatment_plan'] : ['nursing', 'progress']
  const notes = (c?.notes ?? []).filter((n) => filter === 'all' || n.note_type === filter)
  const day = c ? Math.max(1, Math.ceil((Date.now() - new Date(c.adm.admitted_at).getTime()) / 86400000)) : 0

  async function add() {
    if (!body.trim()) return setErr('Write the note first')
    setErr(null)
    const r = await run(async () => {
      const { error } = await supabase.from('progress_notes').insert({ admission_id: id, note_type: type, body: body.trim(), author_id: staff!.id })
      if (error) throw error
      return true
    }, 'Note added')
    if (r) { setBody(''); q.reload() }
  }

  return (
    <Async q={q}>
      {c && (
        <>
          <PageHeader title={c.adm.patient?.full_name ?? 'Inpatient chart'} badge={<StatusPill status={active ? 'active' : 'discharged'} />}
            subtitle={<>{c.adm.patient?.patient_code} · {titleCase(c.adm.patient?.sex)}, {ageOf(c.adm.patient?.dob)} yrs{c.adm.patient?.allergies ? <> · <span className="text-error font-medium">Allergy: {c.adm.patient.allergies}</span></> : ''}</>}
            actions={<>
              <Link href="/inpatient"><Button variant="secondary">Back to wards</Button></Link>
              <Link href={`/medication-record?admission=${c.adm.id}`}><Button variant="secondary">Medication record</Button></Link>
              <Link href={`/patients/${c.adm.patient?.id}`}><Button variant="secondary">Patient profile</Button></Link>
              {active && hasRole(staff?.role, 'doctor', 'hospital_admin', 'super_admin') && <Link href={`/discharge/${c.adm.id}`}><Button>Discharge</Button></Link>}
            </>} />

          <Card className="p-6">
            <dl className="grid grid-cols-2 md:grid-cols-5 gap-x-8 gap-y-4 text-body-sm">
              {[['Ward and bed', `${c.adm.bed?.ward?.name ?? ''}, bed ${c.adm.bed?.bed_number ?? ''}`], ['Admitted', fmtDateTime(c.adm.admitted_at)], [active ? 'Day' : 'Discharged', active ? `Day ${day}` : fmtDate(c.adm.discharged_at)],
                ['Doctor', c.adm.doctor?.full_name ?? '—'], ['Nurse', c.adm.nurse?.full_name ?? 'Not assigned']].map(([k, v]) => (
                <div key={k}><dt className="text-[11px] font-medium uppercase tracking-wider text-outline">{k}</dt><dd className="mt-1 font-medium">{v}</dd></div>
              ))}
              <div className="col-span-2 md:col-span-5"><dt className="text-[11px] font-medium uppercase tracking-wider text-outline">Diagnosis</dt><dd className="mt-1 font-medium">{c.adm.diagnosis}</dd></div>
            </dl>
          </Card>

          <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 items-start">
            <div className="xl:col-span-2 space-y-6">
              {canWrite && (
                <Card className="p-6 space-y-4">
                  <h2 className="text-headline-md">Add a note</h2>
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <Field label="Type"><Select value={type} onChange={(e) => setType(e.target.value)}>{types.map((t) => <option key={t} value={t}>{NOTE[t].label}</option>)}</Select></Field>
                    <Field label="Note" className="md:col-span-3"><Textarea rows={3} value={body} onChange={(e) => setBody(e.target.value)} placeholder={type === 'treatment_plan' ? 'The plan of treatment for this admission' : type === 'nursing' ? 'Observations and care given' : 'How the patient is progressing'} /></Field>
                  </div>
                  {err && <p className="text-body-sm text-error" role="alert">{err}</p>}
                  <div className="flex items-center justify-between"><span className="text-label-xs text-outline">Notes are never edited or deleted. To correct one, add a new note.</span><Button busy={busy} onClick={() => void add()}>Add note</Button></div>
                </Card>
              )}
              {!active && <Card className="p-5 text-body-sm text-on-surface-variant">This patient has been discharged, so the chart is read-only.</Card>}

              <Card className="overflow-hidden">
                <div className="px-6 pt-5 space-y-4">
                  <h2 className="text-headline-md">Notes</h2>
                  <Tabs value={filter} onChange={setFilter} tabs={[{ id: 'all', label: 'All', count: c.notes.length }, { id: 'progress', label: 'Progress', count: c.notes.filter((n) => n.note_type === 'progress').length },
                    { id: 'nursing', label: 'Nursing', count: c.notes.filter((n) => n.note_type === 'nursing').length }, { id: 'treatment_plan', label: 'Treatment plans', count: c.notes.filter((n) => n.note_type === 'treatment_plan').length }]} />
                </div>
                {notes.length === 0 ? <EmptyState title="No notes yet" hint={canWrite ? 'Add the first note above.' : undefined} /> : (
                  <ul className="divide-y divide-outline-variant/40">
                    {notes.map((n) => (
                      <li key={n.id} className="px-6 py-4 space-y-1.5">
                        <div className="flex items-center justify-between gap-3">
                          <span className="flex items-center gap-2"><Pill tone={NOTE[n.note_type]?.tone ?? 'neutral'}>{NOTE[n.note_type]?.label ?? n.note_type}</Pill><span className="text-body-sm font-medium">{n.author?.full_name}</span></span>
                          <span className="text-label-xs text-outline">{fmtDateTime(n.created_at)}</span>
                        </div>
                        <p className="text-body-md whitespace-pre-wrap">{n.body}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </div>

            <div className="space-y-6">
              <Card className="p-6 space-y-3">
                <h2 className="text-headline-md">Latest vital signs</h2>
                {!c.vitals ? <p className="text-body-sm text-outline">None recorded.</p> : (
                  <dl className="grid grid-cols-2 gap-3 text-body-sm">
                    {[['Blood pressure', c.vitals.bp_systolic ? `${c.vitals.bp_systolic}/${c.vitals.bp_diastolic}` : '—'], ['Pulse', c.vitals.pulse ?? '—'], ['Temperature', c.vitals.temperature_c ? `${c.vitals.temperature_c} °C` : '—'], ['Resp. rate', c.vitals.resp_rate ?? '—'], ['Weight', c.vitals.weight_kg ? `${c.vitals.weight_kg} kg` : '—']].map(([k, v]) => (
                      <div key={k as string}><dt className="text-label-xs text-outline">{k}</dt><dd className="font-medium">{v}</dd></div>
                    ))}
                    <div className="col-span-2 text-label-xs text-outline">Recorded {fmtTime(c.vitals.recorded_at)}</div>
                  </dl>
                )}
              </Card>

              <Card className="p-6 space-y-3">
                <h2 className="text-headline-md">Current medication</h2>
                {c.mar.length === 0 ? <p className="text-body-sm text-outline">No medication prescribed for this admission.</p> : (
                  <ul className="space-y-2.5">
                    {c.mar.map((m) => (
                      <li key={m.id} className="flex items-start justify-between gap-3 text-body-sm">
                        <span><span className="block font-medium">{m.rx?.drug?.name}</span><span className="block text-label-xs text-outline">{m.rx?.dose} · {m.rx?.frequency} · {m.rx?.route}</span>{m.notes && m.status !== 'given' && <span className="block text-label-xs text-on-surface-variant">Note: {m.notes}</span>}</span>
                        <StatusPill status={m.status} />
                      </li>
                    ))}
                  </ul>
                )}
              </Card>

              <Card className="p-6 space-y-3">
                <h2 className="text-headline-md">Investigations</h2>
                {c.labs.length === 0 ? <p className="text-body-sm text-outline">No tests requested.</p> : (
                  <ul className="space-y-2.5">
                    {c.labs.map((l) => {
                      const res = many(l.result).find((r) => r.status === 'finalized')
                      return (
                        <li key={l.id} className="flex items-start justify-between gap-3 text-body-sm">
                          <span><span className="block font-medium">{l.service?.name}</span>{res ? <span className="block text-label-xs text-on-surface-variant">{res.result}{res.reference_range ? ` (ref. ${res.reference_range})` : ''}</span> : <span className="block text-label-xs text-outline">Requested {fmtDate(l.requested_at)}</span>}</span>
                          <StatusPill status={l.status} />
                        </li>
                      )
                    })}
                  </ul>
                )}
              </Card>
            </div>
          </div>
        </>
      )}
    </Async>
  )
}
