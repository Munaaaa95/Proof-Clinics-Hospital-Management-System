'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { Button, Field, Input, Modal, useAction } from './ui'

// Vital signs (spec 5, 11). Used at registration and from the queue, so a receptionist or nurse can record them
// without opening the doctor's consultation screen.
export const EMPTY_VITALS = { bp_systolic: '', bp_diastolic: '', pulse: '', temperature_c: '', resp_rate: '', weight_kg: '' }
export type VitalsValues = typeof EMPTY_VITALS

const num = (s: string) => (s === '' ? null : Number(s))
export const hasVitals = (v: VitalsValues) => Object.values(v).some((x) => x !== '')

// null when valid, otherwise a message to show the user
export function vitalsError(v: VitalsValues): string | null {
  if ((v.bp_systolic === '') !== (v.bp_diastolic === '')) return 'Enter both blood pressure numbers'
  if (v.bp_systolic && Number(v.bp_systolic) <= Number(v.bp_diastolic)) return 'Systolic pressure must be higher than diastolic'
  const range = (label: string, x: string, lo: number, hi: number) => (x !== '' && (Number(x) < lo || Number(x) > hi) ? `${label} should be between ${lo} and ${hi}` : null)
  return range('Temperature', v.temperature_c, 25, 45) ?? range('Pulse', v.pulse, 20, 300) ?? range('Respiratory rate', v.resp_rate, 4, 80) ?? range('Weight', v.weight_kg, 1, 400) ?? null
}

export async function saveVitals(visitId: string, patientId: string, v: VitalsValues) {
  const { error } = await supabase.from('vitals').insert({
    visit_id: visitId, patient_id: patientId, temperature_c: num(v.temperature_c), pulse: num(v.pulse), resp_rate: num(v.resp_rate),
    bp_systolic: num(v.bp_systolic), bp_diastolic: num(v.bp_diastolic), weight_kg: num(v.weight_kg),
  })
  if (error) throw error
}

export function VitalsFields({ value, onChange }: { value: VitalsValues; onChange: (v: VitalsValues) => void }) {
  const set = (k: keyof VitalsValues) => (e: React.ChangeEvent<HTMLInputElement>) => onChange({ ...value, [k]: e.target.value })
  return (
    <div className="grid grid-cols-2 md:grid-cols-6 gap-x-6 gap-y-4">
      <Field label="BP systolic (mmHg)"><Input type="number" inputMode="numeric" value={value.bp_systolic} onChange={set('bp_systolic')} /></Field>
      <Field label="BP diastolic (mmHg)"><Input type="number" inputMode="numeric" value={value.bp_diastolic} onChange={set('bp_diastolic')} /></Field>
      <Field label="Pulse (bpm)"><Input type="number" inputMode="numeric" value={value.pulse} onChange={set('pulse')} /></Field>
      <Field label="Temperature (°C)"><Input type="number" step="0.1" value={value.temperature_c} onChange={set('temperature_c')} /></Field>
      <Field label="Respiratory rate"><Input type="number" inputMode="numeric" value={value.resp_rate} onChange={set('resp_rate')} /></Field>
      <Field label="Weight (kg)"><Input type="number" step="0.1" value={value.weight_kg} onChange={set('weight_kg')} /></Field>
    </div>
  )
}

// Record vitals for an open visit.
export function VitalsModal({ visit, onClose, onSaved }: {
  visit: { id: string; patientId: string; patientName: string } | null; onClose: () => void; onSaved: () => void
}) {
  const { busy, run } = useAction()
  const [v, setV] = useState<VitalsValues>(EMPTY_VITALS)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => { setV(EMPTY_VITALS); setErr(null) }, [visit?.id])

  async function save() {
    if (!visit) return
    if (!hasVitals(v)) return setErr('Enter at least one measurement')
    const e = vitalsError(v)
    if (e) return setErr(e)
    setErr(null)
    const r = await run(async () => { await saveVitals(visit.id, visit.patientId, v); return true }, 'Vitals recorded')
    if (r) onSaved()
  }
  return (
    <Modal open={!!visit} onClose={onClose} wide title="Record Vital Signs"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button busy={busy} onClick={() => void save()}>Save vitals</Button></>}>
      <p className="text-body-sm text-on-surface-variant">{visit?.patientName}. The doctor sees these on the consultation screen.</p>
      <VitalsFields value={v} onChange={setV} />
      {err && <p className="text-body-sm text-error" role="alert">{err}</p>}
    </Modal>
  )
}
