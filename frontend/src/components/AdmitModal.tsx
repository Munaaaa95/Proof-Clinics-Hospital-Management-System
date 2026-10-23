'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { ok, useQuery } from '@/lib/hooks'
import { ageSex } from '@/lib/format'
import { Button, Field, Input, Modal, Select, useAction } from './ui'

interface OpenVisit { id: string; status: string; department: string; patient: { full_name: string; patient_code: string; dob: string; sex: string } | null }
interface BedRow { id: string; bed_number: string; ward: { name: string } | null }
interface Nurse { id: string; full_name: string }

// Admit a patient to a bed with admit_patient(). Give visitId when the visit is already known (consultation screen);
// otherwise the doctor picks one of the open visits. Give bedId to pre-select the bed (clicked on the bed board).
export function AdmitModal({ open, onClose, visitId, bedId, defaultDiagnosis, onDone }: {
  open: boolean; onClose: () => void; visitId?: string; bedId?: string; defaultDiagnosis?: string; onDone: (admissionId: string) => void
}) {
  const { busy, run } = useAction()
  const [visit, setVisit] = useState('')
  const [bed, setBed] = useState('')
  const [nurse, setNurse] = useState('')
  const [diagnosis, setDiagnosis] = useState('')
  const [err, setErr] = useState<string | null>(null)

  const visits = useQuery<OpenVisit[]>(async () => {
    if (!open || visitId) return []
    return ok(await supabase.from('visits').select('id, status, department, patient:patients(full_name, patient_code, dob, sex)')
      .in('status', ['waiting', 'in_consultation']).neq('visit_type', 'admission').order('checked_in_at') as never)
  }, [open, visitId])
  const beds = useQuery<BedRow[]>(async () => {
    if (!open) return []
    return ok(await supabase.from('beds').select('id, bed_number, ward:wards(name)').eq('status', 'available').order('bed_number') as never)
  }, [open], ['beds'])
  const nurses = useQuery<Nurse[]>(async () => {
    if (!open) return []
    return ok(await supabase.from('staff').select('id, full_name').eq('role', 'nurse').eq('active', true).order('full_name') as never)
  }, [open])

  useEffect(() => { if (open) { setVisit(visitId ?? ''); setBed(bedId ?? ''); setNurse(''); setDiagnosis(defaultDiagnosis ?? ''); setErr(null) } }, [open, visitId, bedId, defaultDiagnosis])

  const sortedBeds = [...(beds.data ?? [])].sort((a, b) => (a.ward?.name ?? '').localeCompare(b.ward?.name ?? '') || a.bed_number.localeCompare(b.bed_number, undefined, { numeric: true }))

  async function save() {
    if (!visit) return setErr('Choose the patient’s visit')
    if (!bed) return setErr('Choose a bed')
    if (!diagnosis.trim()) return setErr('Enter the admitting diagnosis')
    setErr(null)
    const id = await run(async () => {
      const { data, error } = await supabase.rpc('admit_patient', { p_visit_id: visit, p_bed_id: bed, p_diagnosis: diagnosis.trim(), p_nurse_id: nurse || null })
      if (error) throw error
      return data as string
    }, 'Patient admitted')
    if (id) onDone(id)
  }

  return (
    <Modal open={open} onClose={onClose} title="Admit Patient"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button busy={busy} onClick={() => void save()}>Confirm Admission</Button></>}>
      {!visitId && (
        <Field label="Patient (open visit) *" hint="Only patients who are checked in and not yet admitted are listed.">
          <Select value={visit} onChange={(e) => setVisit(e.target.value)}>
            <option value="">Select a patient…</option>
            {visits.data?.map((v) => <option key={v.id} value={v.id}>{v.patient?.full_name} — {v.patient?.patient_code} ({ageSex(v.patient?.dob, v.patient?.sex)}), {v.department}</option>)}
          </Select>
        </Field>
      )}
      <Field label="Bed *" hint={sortedBeds.length === 0 && !beds.loading ? 'No beds are available right now.' : undefined}>
        <Select value={bed} onChange={(e) => setBed(e.target.value)}>
          <option value="">Select an available bed…</option>
          {sortedBeds.map((b) => <option key={b.id} value={b.id}>{b.ward?.name} — Bed {b.bed_number}</option>)}
        </Select>
      </Field>
      <Field label="Assigned nurse"><Select value={nurse} onChange={(e) => setNurse(e.target.value)}><option value="">All nurses will be notified</option>{nurses.data?.map((n) => <option key={n.id} value={n.id}>{n.full_name}</option>)}</Select></Field>
      <Field label="Admitting diagnosis *"><Input value={diagnosis} onChange={(e) => setDiagnosis(e.target.value)} placeholder="e.g. Severe malaria" /></Field>
      {err && <p className="text-body-sm text-error" role="alert">{err}</p>}
    </Modal>
  )
}
