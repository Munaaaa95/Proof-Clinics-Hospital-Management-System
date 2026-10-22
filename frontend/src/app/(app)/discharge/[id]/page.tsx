'use client'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { ok, useQuery } from '@/lib/hooks'
import { ageOf, fmtDate, naira, titleCase } from '@/lib/format'
import { hasRole } from '@/lib/roles'
import { Async, Button, Card, ErrorBox, Field, Input, PageHeader, Select, StatusPill, Textarea, useAction, useToast } from '@/components/ui'
import { DischargeDocument, type DocData } from '@/components/DischargeDocument'

interface Adm {
  id: string; status: string; diagnosis: string | null; admitted_at: string; discharged_at: string | null; discharge_summary: string | null; visit_id: string
  patient: { id: string; full_name: string; patient_code: string; dob: string; sex: string; allergies: string | null } | null
  bed: { bed_number: string; ward: { name: string; daily_rate: number } | null } | null
  doctor: { full_name: string } | null
  nurse: { full_name: string } | null
}

const SOURCES = [{ v: 'hmo', l: 'HMO' }, { v: 'patient', l: 'Patient' }, { v: 'government', l: 'Government' }, { v: 'other', l: 'Other' }]
const lagosIso = (local: string) => `${local}:00+01:00`

export default function DischargePage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const { staff } = useAuth()
  const toast = useToast()
  const { busy, run } = useAction()
  const [summary, setSummary] = useState('')
  const [source, setSource] = useState('patient')
  const [followUp, setFollowUp] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const allowed = hasRole(staff?.role, 'doctor', 'hospital_admin', 'super_admin')

  const q = useQuery(async () => {
    const adm = ok(await supabase.from('admissions')
      .select('id, status, diagnosis, admitted_at, discharged_at, discharge_summary, visit_id, patient:patients(id, full_name, patient_code, dob, sex, allergies), bed:beds(bed_number, ward:wards(name, daily_rate)), doctor:staff!admissions_doctor_id_fkey(full_name), nurse:staff!admissions_nurse_id_fkey(full_name)')
      .eq('id', id).single() as never) as Adm
    const mar = ok(await supabase.from('medication_administrations').select('status').eq('admission_id', id) as never) as { status: string }[]
    const rx = ok(await supabase.from('prescriptions').select('id, dose, route, frequency, duration_days, quantity, drug:drugs(name)').eq('admission_id', id).neq('status', 'cancelled').order('prescribed_at') as never) as DocData['rx']
    const followUp = adm.status === 'discharged' && adm.patient
      ? ((await supabase.from('appointments').select('scheduled_at, reason, doctor:staff!appointments_doctor_id_fkey(full_name)').eq('patient_id', adm.patient.id).eq('appt_type', 'follow_up').gte('created_at', adm.discharged_at ?? adm.admitted_at).order('scheduled_at').limit(1)).data ?? [])[0] ?? null
      : null
    return { adm, mar, rx, followUp: followUp as DocData['followUp'] }
  }, [id], ['admissions', 'medication_administrations'])

  const a = q.data?.adm
  const mar = q.data?.mar ?? []
  const days = a ? Math.max(1, Math.ceil((Date.now() - new Date(a.admitted_at).getTime()) / 86400000)) : 0
  const rate = Number(a?.bed?.ward?.daily_rate ?? 0)
  const given = mar.filter((m) => m.status === 'given').length
  const exceptions = mar.filter((m) => ['held', 'missed', 'refused'].includes(m.status)).length
  const pending = mar.filter((m) => m.status === 'pending').length

  async function discharge() {
    setErr(null)
    if (!summary.trim()) return setErr('Write the discharge summary')
    if (followUp && new Date(lagosIso(followUp)) < new Date()) return setErr('The follow-up appointment must be in the future')
    if (pending > 0 && !window.confirm(`${pending} dose(s) are still pending on the medication record. Discharge anyway?`)) return
    const r = await run(async () => {
      const { error } = await supabase.rpc('discharge_patient', { p_admission_id: id, p_summary: summary.trim(), p_payment_source: source, p_follow_up_at: followUp ? lagosIso(followUp) : null })
      if (error) throw error
      return true
    })
    if (r) { toast(`${a?.patient?.full_name} discharged. Bed ${a?.bed?.bed_number} released.`); router.push('/inpatient') }
  }

  return (
    <>
      <PageHeader title="Discharge Patient" subtitle="Review the stay, write the summary, record the payment source."
        actions={<Link href="/inpatient"><Button variant="secondary">Back to Wards</Button></Link>} />
      <Async q={q}>
        {a && (
          <>
            <Card className="print:hidden p-6 flex flex-wrap items-center gap-x-8 gap-y-3">
              <div className="flex items-center gap-3">
                <span className="w-11 h-11 rounded-full bg-primary-fixed text-on-primary-fixed-variant flex items-center justify-center font-semibold">{a.patient?.full_name.split(' ').map((p) => p[0]).slice(0, 2).join('')}</span>
                <div><Link href={`/patients/${a.patient?.id}`} className="text-headline-sm hover:underline">{a.patient?.full_name}</Link>
                  <div className="text-body-sm text-on-surface-variant">{a.patient?.patient_code} • {titleCase(a.patient?.sex)}, {ageOf(a.patient?.dob)} yrs</div></div>
                <StatusPill status={a.status === 'active' ? 'active' : 'discharged'} />
              </div>
              <dl className="grid grid-cols-2 md:grid-cols-4 gap-x-8 gap-y-1 text-body-sm">
                <div><dt className="text-label-xs text-outline uppercase">Bed</dt><dd>{a.bed?.ward?.name}, {a.bed?.bed_number}</dd></div>
                <div><dt className="text-label-xs text-outline uppercase">Admitted</dt><dd>{fmtDate(a.admitted_at)}</dd></div>
                <div><dt className="text-label-xs text-outline uppercase">Days in ward</dt><dd>{days}</dd></div>
                <div><dt className="text-label-xs text-outline uppercase">Doctor / Nurse</dt><dd>{a.doctor?.full_name} / {a.nurse?.full_name ?? 'Unassigned'}</dd></div>
              </dl>
            </Card>

            {a.status !== 'active' ? (
              <DischargeDocument adm={a} rx={q.data?.rx ?? []} followUp={q.data?.followUp ?? null} printedBy={staff?.full_name ?? ''} />
            ) : !allowed ? (
              <ErrorBox message="Only doctors and administrators can discharge a patient." />
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
                <Card className="lg:col-span-2 p-6 space-y-4">
                  <h2 className="text-headline-md flex items-center gap-2">Discharge Summary</h2>
                  <Field label="Admission diagnosis"><Input readOnly value={a.diagnosis ?? ''} /></Field>
                  <Field label="Summary of stay and treatment given *"><Textarea rows={5} value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="Write the discharge summary" /></Field>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <Field label="Payment source *" hint="Recorded on the bill"><Select value={source} onChange={(e) => setSource(e.target.value)}>{SOURCES.map((s) => <option key={s.v} value={s.v}>{s.l}</option>)}</Select></Field>
                    <Field label="Follow-up appointment" hint="Optional"><Input type="datetime-local" value={followUp} onChange={(e) => setFollowUp(e.target.value)} /></Field>
                  </div>
                  {err && <p className="text-body-sm text-error" role="alert">{err}</p>}
                  <div className="flex justify-end gap-2"><Link href="/inpatient"><Button variant="secondary">Cancel</Button></Link><Button busy={busy} onClick={() => void discharge()}>Discharge Patient</Button></div>
                </Card>

                <div className="space-y-6">
                  <Card className="p-6 space-y-3">
                    <h2 className="text-headline-sm flex items-center gap-2">What happens when you confirm</h2>
                    <ul className="space-y-2 text-body-sm">
                      {[
                        <>Status changes from active inpatient to <strong>discharged</strong>.</>,
                        <>Bed <strong>{a.bed?.bed_number}</strong> is released and shows as available.</>,
                        <>The stay moves to history. It is <strong>not deleted</strong>, and stays searchable.</>,
                        <>The bed charge is added to the bill and billing is notified.</>,
                        <>A follow-up appointment and reminder are created if a date is set.</>,
                        <>The action is written to the audit log.</>,
                      ].map((t, i) => <li key={i} className="flex gap-2"><span>{t}</span></li>)}
                    </ul>
                  </Card>
                  <Card className="p-6 space-y-2">
                    <h2 className="text-headline-sm flex items-center gap-2">Bed Charge Preview</h2>
                    <div className="flex justify-between text-body-sm"><span>{a.bed?.ward?.name}, {days} day{days > 1 ? 's' : ''} × {naira(rate)}</span><span className="font-semibold">{naira(days * rate)}</span></div>
                    <p className="text-label-xs text-outline">Other charges (consultation, lab, drugs) are already on the bill. The final bed charge is worked out by the system when you confirm.</p>
                  </Card>
                  <Card className="p-6 space-y-2">
                    <h2 className="text-headline-sm flex items-center gap-2">Medication Record</h2>
                    <p className="text-body-md"><span className="text-headline-md font-semibold">{given}</span> of {mar.length} doses given</p>
                    {(exceptions > 0 || pending > 0) && <p className="text-body-sm text-on-surface-variant">{exceptions > 0 && `${exceptions} dose(s) held, refused or missed with a note. `}{pending > 0 && `${pending} still pending. `}</p>}
                    <Link href={`/medication-record?admission=${a.id}`} className="text-primary text-body-sm hover:underline">Open the medication record</Link>
                  </Card>
                </div>
              </div>
            )}
          </>
        )}
      </Async>
    </>
  )
}
