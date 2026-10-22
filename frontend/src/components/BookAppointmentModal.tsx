'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { ok, useQuery } from '@/lib/hooks'
import { PatientPicker, type PickedPatient } from './PatientPicker'
import { Button, Field, Input, Modal, Select, titleCaseVisit, useAction } from './ui'

export const DEPARTMENTS = ['General', 'Internal Medicine', 'Paediatrics', 'Obstetrics & Gynaecology']
export interface Doctor { id: string; full_name: string }
const TYPES = ['consultation', 'follow_up', 'surgery', 'procedure', 'antenatal', 'family_planning', 'child_health', 'other']
// datetime-local value (Lagos wall time) -> ISO with the +01:00 offset
const lagosIso = (local: string) => `${local}:00+01:00`

// Book an appointment (spec 7). Give presetPatient when opened from a patient profile.
export function BookAppointmentModal({ open, onClose, defaultDay, presetPatient, onDone }: { open: boolean; onClose: () => void; defaultDay: string; presetPatient?: PickedPatient | null; onDone: () => void }) {
  const doctorsQ = useQuery<Doctor[]>(async () => (open ? ok(await supabase.from('staff').select('id, full_name').eq('role', 'doctor').eq('active', true).order('full_name') as never) : []), [open])
  const doctors = doctorsQ.data ?? []
  const { busy, run } = useAction()
  const [patient, setPatient] = useState<PickedPatient | null>(null)
  const [f, setF] = useState({ doctor_id: '', department: 'General', appt_type: 'consultation', when: '', reason: '' })
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => { if (open) { setPatient(presetPatient ?? null); setErr(null); setF({ doctor_id: '', department: 'General', appt_type: 'consultation', when: `${defaultDay}T09:00`, reason: '' }) } }, [open, defaultDay, presetPatient])
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((s) => ({ ...s, [k]: e.target.value }))

  async function save() {
    if (!patient) return setErr('Choose a patient')
    if (!f.when) return setErr('Choose the date and time')
    setErr(null)
    const r = await run(async () => {
      const { error } = await supabase.from('appointments').insert({
        patient_id: patient.patient_id, doctor_id: f.doctor_id || null, department: f.department,
        appt_type: f.appt_type, scheduled_at: lagosIso(f.when), reason: f.reason || null,
      })
      if (error) throw error
      return true
    }, 'Appointment booked')
    if (r) onDone()
  }
  return (
    <Modal open={open} onClose={onClose} title="Book Appointment"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button busy={busy} onClick={() => void save()}>Book Appointment</Button></>}>
      <Field label="Patient *"><PatientPicker value={patient} onChange={setPatient} autoFocus /></Field>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Clinician"><Select value={f.doctor_id} onChange={set('doctor_id')}><option value="">Any available doctor</option>{doctors.map((d) => <option key={d.id} value={d.id}>{d.full_name}</option>)}</Select></Field>
        <Field label="Department"><Select value={f.department} onChange={set('department')}>{DEPARTMENTS.map((d) => <option key={d}>{d}</option>)}</Select></Field>
        <Field label="Type"><Select value={f.appt_type} onChange={set('appt_type')}>{TYPES.map((t) => <option key={t} value={t}>{titleCaseVisit(t)}</option>)}</Select></Field>
        <Field label="Date and time *"><Input type="datetime-local" value={f.when} onChange={set('when')} /></Field>
      </div>
      <Field label="Reason"><Input value={f.reason} onChange={set('reason')} placeholder="Reason for the appointment" /></Field>
      {err && <p className="text-body-sm text-error" role="alert">{err}</p>}
    </Modal>
  )
}

