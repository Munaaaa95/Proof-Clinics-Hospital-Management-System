'use client'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useDebounced } from '@/lib/hooks'
import { ageOf, fmtDate } from '@/lib/format'
import { EMPTY_VITALS, VitalsFields, hasVitals, saveVitals, vitalsError, type VitalsValues } from '@/components/VitalsForm'
import { Icon, Button, Card, ErrorBox, Field, Input, Modal, PageHeader, Select, Table, Td, Th, Tr, useToast } from '@/components/ui'

const RELATIONSHIPS = ['spouse', 'father', 'mother', 'brother', 'sister', 'son', 'daughter', 'guardian', 'other']
const VISIT_TYPES = ['outpatient', 'inpatient', 'admission', 'referral']
const DEPARTMENTS = ['General', 'Internal Medicine', 'Paediatrics', 'Obstetrics & Gynaecology']
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

interface Match { patient_id: string; patient_code: string; full_name: string; dob: string; phone: string | null; match_reason: string }

function Section({ n, tone, title, sub, children }: { n: string; tone: string; title: string; sub: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-surface-container-lowest shadow-sm overflow-hidden">
      <div className="px-space-lg py-4 bg-surface-container-low/40 flex items-center gap-3">
        <div className={`w-7 h-7 rounded-lg ${tone} flex items-center justify-center text-headline-sm text-[13px]`}>{n}</div>
        <div>
          <h2 className="text-headline-md text-on-surface">{title}</h2>
          <p className="text-body-sm text-on-surface-variant">{sub}</p>
        </div>
      </div>
      <div className="p-space-lg">{children}</div>
    </div>
  )
}
const Req = () => <span className="text-error">*</span>

export default function RegistrationPage() {
  const router = useRouter()
  const toast = useToast()
  const [f, setF] = useState({
    full_name: '', sex: 'male', dob: '', phone: '', address: '',
    kin_name: '', kin_relationship: 'spouse', kin_phone: '', kin_other: '',
    visit_type: 'outpatient', department: 'General', complaint: '',
  })
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((s) => ({ ...s, [k]: e.target.value }))
  const [vitals, setVitals] = useState<VitalsValues>(EMPTY_VITALS)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [matches, setMatches] = useState<Match[] | null>(null)
  const [hint, setHint] = useState<Match[]>([])

  // Quiet early warning while typing (the modal on submit is the real alert).
  const dName = useDebounced(f.full_name, 500), dDob = useDebounced(f.dob, 500), dPhone = useDebounced(f.phone, 500)
  useEffect(() => {
    if (dName.trim().length < 3 || !dDob) { setHint([]); return }
    supabase.rpc('check_duplicate_patients', { p_full_name: dName, p_dob: dDob, p_phone: dPhone || null })
      .then(({ data }) => setHint((data as Match[]) ?? []))
  }, [dName, dDob, dPhone])

  function validate() {
    const e: Record<string, string> = {}
    if (!f.full_name.trim()) e.full_name = 'Enter the patient’s full name'
    if (!f.dob) e.dob = 'Enter the date of birth'
    else if (new Date(f.dob) > new Date()) e.dob = 'Date of birth cannot be in the future'
    if (!f.phone.trim()) e.phone = 'Enter a phone number'
    if (!f.address.trim()) e.address = 'Enter the address'
    if (!f.kin_name.trim()) e.kin_name = 'Enter the next of kin’s name'
    if (!f.kin_phone.trim()) e.kin_phone = 'Enter the next of kin’s phone'
    if (f.kin_relationship === 'other' && !f.kin_other.trim()) e.kin_other = 'Describe the relationship'
    if (!f.complaint.trim()) e.complaint = 'Enter the reason for the visit'
    const ve = vitalsError(vitals)
    if (ve) e.vitals = ve
    setErrors(e)
    return Object.keys(e).length === 0
  }

  async function submit(force: boolean) {
    if (!validate()) return
    setBusy(true)
    setError(null)
    const { data, error: err } = await supabase.rpc('register_patient', {
      p_full_name: f.full_name, p_dob: f.dob, p_sex: f.sex, p_phone: f.phone, p_address: f.address,
      p_kin_name: f.kin_name, p_kin_phone: f.kin_phone, p_kin_relationship: f.kin_relationship,
      p_kin_relationship_other: f.kin_relationship === 'other' ? f.kin_other : null, p_force: force,
    })
    if (err) { setBusy(false); setError(err.message); return }
    if (data.status === 'duplicate') { setBusy(false); setMatches(data.matches); return }

    setMatches(null)
    const { data: visitId, error: visitErr } = await supabase.rpc('check_in_patient', {
      p_patient_id: data.patient_id, p_visit_type: f.visit_type, p_department: f.department, p_complaint: f.complaint,
    })
    setBusy(false)
    if (visitErr) {
      // The patient exists now; only the check-in failed (for example an open visit already exists).
      setError(`${f.full_name} was registered as ${data.patient_code}, but check-in failed: ${visitErr.message}`)
      return
    }
    if (hasVitals(vitals)) {
      try { await saveVitals(visitId as string, data.patient_id, vitals) }
      catch (e) { toast(`Registered, but the vital signs were not saved: ${e instanceof Error ? e.message : (e as { message?: string }).message}`, 'error') }
    }
    toast(`${f.full_name} registered as ${data.patient_code} and added to the queue`)
    router.push('/queue')
  }

  const age = f.dob ? ageOf(f.dob) : null
  const showOther = f.kin_relationship === 'other'

  return (
    <div className="max-w-7xl mx-auto w-full space-y-space-lg">
      <PageHeader title="New Patient Registration" subtitle="Register a patient once. They appear in every department that needs them." />

      <form className="space-y-space-lg" onSubmit={(e) => { e.preventDefault(); void submit(false) }} noValidate>
        <Section n="01" tone="bg-primary text-on-primary" title="Personal Details" sub="Basic details">
          <div className="space-y-space-lg">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-x-space-lg gap-y-4">
              <Field label="Full Name *" error={errors.full_name}><Input value={f.full_name} onChange={set('full_name')} placeholder="Enter full name" /></Field>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-x-space-lg gap-y-4">
              <Field label="Sex *">
                <Select value={f.sex} onChange={set('sex')}><option value="male">Male</option><option value="female">Female</option><option value="other">Other</option></Select>
              </Field>
              <Field label={`Date of Birth *${age != null && age >= 0 ? `  (${age} yrs)` : ''}`} error={errors.dob}><Input type="date" value={f.dob} max={new Date().toISOString().slice(0, 10)} onChange={set('dob')} /></Field>
              <Field label="Phone *" error={errors.phone}><Input type="tel" value={f.phone} onChange={set('phone')} placeholder="+234 ..." /></Field>
            </div>
            <Field label="Address *" error={errors.address}><Input value={f.address} onChange={set('address')} placeholder="Street address" /></Field>
            {hint.length > 0 && (
              <div className="flex items-start gap-2 p-3 rounded-lg bg-warn-container text-warn text-body-sm">
                <Icon name="warning" className="text-[18px] mt-px shrink-0" filled />
                <span>{hint.length === 1 ? 'A patient' : `${hint.length} patients`} already on file may match: {hint.map((m) => `${m.patient_code} (${m.match_reason.toLowerCase()})`).join(', ')}. You will be asked to confirm before saving.</span>
              </div>
            )}
          </div>
        </Section>

        <Section n="02" tone="bg-secondary text-on-secondary" title="Next of Kin" sub="Emergency contact">
          <div className={`grid grid-cols-1 ${showOther ? 'md:grid-cols-4' : 'md:grid-cols-3'} gap-x-space-lg gap-y-4`}>
            <Field label="Full Name *" error={errors.kin_name}><Input value={f.kin_name} onChange={set('kin_name')} placeholder="Next of kin full name" /></Field>
            <Field label="Relationship *"><Select value={f.kin_relationship} onChange={set('kin_relationship')}>{RELATIONSHIPS.map((r) => <option key={r} value={r}>{cap(r)}</option>)}</Select></Field>
            <Field label="Phone *" error={errors.kin_phone}><Input type="tel" value={f.kin_phone} onChange={set('kin_phone')} placeholder="+234 ..." /></Field>
            {showOther && <Field label="If Other, specify *" error={errors.kin_other}><Input value={f.kin_other} onChange={set('kin_other')} placeholder="e.g. Neighbour" /></Field>}
          </div>
        </Section>

        <Section n="03" tone="bg-tertiary-container text-on-tertiary" title="Visit" sub="Where the patient is going today">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-x-space-lg gap-y-4">
            <Field label="Visit Type *"><Select value={f.visit_type} onChange={set('visit_type')}>{VISIT_TYPES.map((v) => <option key={v} value={v}>{cap(v)}</option>)}</Select></Field>
            <Field label="Department *"><Select value={f.department} onChange={set('department')}>{DEPARTMENTS.map((d) => <option key={d}>{d}</option>)}</Select></Field>
            <Field label="Complaint *" error={errors.complaint}><Input value={f.complaint} onChange={set('complaint')} placeholder="Reason for the visit" /></Field>
          </div>
        </Section>

        <Section n="04" tone="bg-surface-container-high text-on-surface" title="Vital Signs" sub="Optional. The doctor sees these when the consultation starts.">
          <VitalsFields value={vitals} onChange={setVitals} />
          {errors.vitals && <p className="mt-3 text-body-sm text-error" role="alert">{errors.vitals}</p>}
        </Section>

        {error && <ErrorBox message={error} />}

        <div className="flex items-center justify-between gap-4 py-2">
          <Link href="/dashboard" className="text-body-sm text-on-surface-variant hover:underline">Cancel</Link>
          <Button busy={busy} type="submit" className="px-5">Register and Check In</Button>
        </div>
      </form>

      <Modal open={!!matches} onClose={() => setMatches(null)} wide title="Possible Duplicate Record Found"
        footer={<>
          <Button variant="secondary" onClick={() => setMatches(null)}>Cancel</Button>
          <Button variant="secondary" busy={busy} onClick={() => void submit(true)}>Register As New Patient Anyway</Button>
          {matches && matches.length > 0 && (
            <Button onClick={() => router.push(`/patients/${matches[0].patient_id}`)}>Open Existing Record</Button>
          )}
        </>}>
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-full bg-error-container text-on-error-container flex items-center justify-center shrink-0"><Icon name="warning" className="text-[22px]" filled /></div>
          <p className="text-body-md text-on-surface-variant">
            {matches?.length === 1 ? '1 existing patient matches' : `${matches?.length} existing patients match`} the details you entered for <span className="font-medium text-on-surface">{f.full_name}</span>. Check before creating another record.
          </p>
        </div>
        <span className="block text-label-sm text-on-surface-variant uppercase tracking-wider">Possible matches</span>
        <Card className="overflow-hidden">
          <Table head={<><Th>Patient ID</Th><Th>Patient Name</Th><Th>DOB</Th><Th>Matched On</Th><Th className="text-right">Action</Th></>}>
            {(matches ?? []).map((m) => (
              <Tr key={m.patient_id}>
                <Td className="font-medium text-primary"><span className="inline-flex items-center gap-1.5">{m.patient_code}</span></Td>
                <Td className="font-medium">{m.full_name}</Td>
                <Td className="text-on-surface-variant">{fmtDate(m.dob)}</Td>
                <Td><span className="inline-flex px-2 py-0.5 rounded bg-surface-container-high text-on-surface-variant text-label-xs">{m.match_reason}</span></Td>
                <Td className="text-right">
                  <Link href={`/patients/${m.patient_id}`} target="_blank" className="h-8 px-2.5 rounded bg-surface-container-low text-primary hover:bg-primary hover:text-on-primary transition-colors text-label-sm inline-flex items-center gap-1">
                    Inspect
                  </Link>
                </Td>
              </Tr>
            ))}
          </Table>
        </Card>
        <div className="p-3 rounded-lg bg-surface-container-low text-on-surface-variant text-label-xs flex items-center gap-2">

          <span>Creating multiple folders for one patient splits their medical history, prescriptions and allergy information.</span>
        </div>
        {error && <ErrorBox message={error} />}
      </Modal>
    </div>
  )
}
