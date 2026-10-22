'use client'
import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { ok, useQuery } from '@/lib/hooks'
import { ageSex, fmtTime, initials, lagosToday } from '@/lib/format'
import { hasRole } from '@/lib/roles'
import { BookAppointmentModal, DEPARTMENTS, type Doctor } from '@/components/BookAppointmentModal'
import { Async, Button, Card, EmptyState, Field, Icon, Input, Modal, PageHeader, SearchBox, Select, StatTile, StatusPill, Table, Td, Th, Tr, useAction, titleCaseVisit } from '@/components/ui'


interface Appt {
  id: string; patient_id: string; doctor_id: string | null; department: string; appt_type: string; scheduled_at: string
  reason: string | null; status: string
  patient: { full_name: string; patient_code: string; dob: string; sex: string } | null
  doctor: { full_name: string } | null
}

const shiftDay = (d: string, n: number) => {
  const t = new Date(`${d}T12:00:00Z`)
  t.setUTCDate(t.getUTCDate() + n)
  return t.toISOString().slice(0, 10)
}
// datetime-local value (Lagos wall time) -> ISO with the +01:00 offset
const lagosIso = (local: string) => `${local}:00+01:00`

export default function AppointmentsPage() {
  const { staff } = useAuth()
  const { busy, run } = useAction()
  const [day, setDay] = useState(lagosToday())
  const [dept, setDept] = useState('all')
  const [doctor, setDoctor] = useState('all')
  const [filter, setFilter] = useState('')
  const [booking, setBooking] = useState(false)
  const [resched, setResched] = useState<Appt | null>(null)
  const [menu, setMenu] = useState<string | null>(null)
  const canBook = hasRole(staff?.role, 'receptionist', 'doctor', 'hospital_admin', 'super_admin')

  const doctors = useQuery<Doctor[]>(async () => ok(await supabase.from('staff').select('id, full_name').eq('role', 'doctor').eq('active', true).order('full_name') as never), [])
  const q = useQuery<Appt[]>(async () => ok(await supabase.from('appointments')
    .select('id, patient_id, doctor_id, department, appt_type, scheduled_at, reason, status, patient:patients(full_name, patient_code, dob, sex), doctor:staff!appointments_doctor_id_fkey(full_name)')
    .gte('scheduled_at', `${day}T00:00:00+01:00`).lt('scheduled_at', `${shiftDay(day, 1)}T00:00:00+01:00`)
    .order('scheduled_at') as never), [day], ['appointments'])

  const menuRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const h = (e: MouseEvent) => { if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenu(null) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  const all = q.data ?? []
  const rows = all.filter((a) => {
    if (dept !== 'all' && a.department !== dept) return false
    if (doctor !== 'all' && a.doctor_id !== doctor) return false
    const t = filter.trim().toLowerCase()
    return !t || a.patient?.full_name.toLowerCase().includes(t) || a.patient?.patient_code.toLowerCase().includes(t)
  })
  const checkedIn = all.filter((a) => ['checked_in', 'waiting', 'in_consultation', 'completed'].includes(a.status)).length
  const completed = all.filter((a) => a.status === 'completed').length
  const lost = all.filter((a) => ['cancelled', 'no_show'].includes(a.status)).length

  const setStatus = (a: Appt, status: string, msg: string) => run(async () => {
    setMenu(null)
    const { error } = await supabase.from('appointments').update({ status }).eq('id', a.id)
    if (error) throw error
    q.reload()
  }, msg)
  const checkIn = (a: Appt) => run(async () => {
    setMenu(null)
    const { error } = await supabase.rpc('check_in_appointment', { p_appointment_id: a.id })
    if (error) throw error
    q.reload()
  }, `${a.patient?.full_name} checked in and added to the queue`)

  const isToday = day === lagosToday()
  return (
    <>
      <PageHeader title="Appointments Schedule"
        actions={<>
          <div className="flex items-center gap-1 h-9 px-1 rounded-lg bg-surface-container-lowest shadow-sm">
            <button type="button" aria-label="Previous day" onClick={() => setDay(shiftDay(day, -1))} className="p-1 rounded hover:bg-surface-container-low"><Icon name="chevron_left" className="text-[20px]" /></button>
            <input type="date" value={day} onChange={(e) => e.target.value && setDay(e.target.value)} className="text-body-sm bg-transparent focus:outline-none" aria-label="Day" />
            <button type="button" aria-label="Next day" onClick={() => setDay(shiftDay(day, 1))} className="p-1 rounded hover:bg-surface-container-low"><Icon name="chevron_right" className="text-[20px]" /></button>
          </div>
          {!isToday && <Button variant="ghost" small onClick={() => setDay(lagosToday())}>Today</Button>}
          <Select value={dept} onChange={(e) => setDept(e.target.value)} aria-label="Department" className="w-44"><option value="all">All Departments</option>{DEPARTMENTS.map((d) => <option key={d}>{d}</option>)}</Select>
          <Select value={doctor} onChange={(e) => setDoctor(e.target.value)} aria-label="Doctor" className="w-44"><option value="all">All Clinicians</option>{doctors.data?.map((d) => <option key={d.id} value={d.id}>{d.full_name}</option>)}</Select>
          {canBook && <Button onClick={() => setBooking(true)}>Book Appointment</Button>}
        </>} />

      <Async q={q}>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
          <StatTile label="Total Booked" value={all.length} />
          <StatTile label="Checked In" value={checkedIn} />
          <StatTile label="Completed" value={completed} />
          <StatTile label="Cancelled / No Show" value={lost} />
        </div>

        <Card>
          <div className="px-5 py-4 flex items-center justify-between gap-3">
            <span className="text-label-md text-primary font-medium">All Appointments ({rows.length})</span>
            <div className="flex items-center gap-2">
              <SearchBox value={filter} onChange={setFilter} placeholder="Quick filter..." className="w-48" />
              <Button variant="ghost" small icon="sync" onClick={q.reload} aria-label="Refresh schedule" />
            </div>
          </div>
          {rows.length === 0 ? (
            <EmptyState title="No appointments for this day" hint={canBook ? 'Use Book Appointment to add one.' : undefined} />
          ) : (
            <div ref={menuRef}>
              <Table head={<><Th>Time</Th><Th>Patient</Th><Th>Clinician</Th><Th>Department</Th><Th>Type</Th><Th>Status</Th><Th className="text-right">Actions</Th></>}>
                {rows.map((a) => {
                  const open = ['scheduled', 'confirmed'].includes(a.status)
                  return (
                    <Tr key={a.id}>
                      <Td><span className="inline-flex items-center gap-1.5 font-medium">{fmtTime(a.scheduled_at)}</span></Td>
                      <Td>
                        <Link href={`/patients/${a.patient_id}`} className="flex items-center gap-2 hover:underline">
                          <span className="w-8 h-8 rounded-full bg-primary-fixed text-on-primary-fixed-variant flex items-center justify-center text-label-xs">{initials(a.patient?.full_name)}</span>
                          <span><span className="block font-medium">{a.patient?.full_name}</span><span className="block text-outline text-label-xs">{a.patient?.patient_code} • {ageSex(a.patient?.dob, a.patient?.sex)}</span></span>
                        </Link>
                      </Td>
                      <Td>{a.doctor?.full_name ?? '—'}</Td>
                      <Td>{a.department}</Td>
                      <Td>{titleCaseVisit(a.appt_type)}</Td>
                      <Td><StatusPill status={a.status} /></Td>
                      <Td className="text-right">
                        {open && hasRole(staff?.role, 'receptionist', 'nurse', 'doctor', 'hospital_admin', 'super_admin') && (
                          <div className="relative inline-block text-left">
                            <button type="button" aria-label="Actions" onClick={() => setMenu(menu === a.id ? null : a.id)} className="p-1 rounded hover:bg-surface-container-high"><Icon name="more_vert" /></button>
                            {menu === a.id && (
                              <div className="absolute right-0 z-20 mt-1 w-40 bg-surface-container-lowest rounded-lg shadow-lg border border-outline-variant/40 py-1 text-body-sm">
                                <button type="button" className="w-full text-left px-3 py-2 hover:bg-surface-container-low" onClick={() => void checkIn(a)}>Check-in</button>
                                {a.status === 'scheduled' && <button type="button" className="w-full text-left px-3 py-2 hover:bg-surface-container-low" onClick={() => void setStatus(a, 'confirmed', 'Appointment confirmed')}>Confirm</button>}
                                {canBook && <button type="button" className="w-full text-left px-3 py-2 hover:bg-surface-container-low" onClick={() => { setMenu(null); setResched(a) }}>Reschedule</button>}
                                <button type="button" className="w-full text-left px-3 py-2 hover:bg-surface-container-low" onClick={() => void setStatus(a, 'no_show', 'Marked as no-show')}>No-show</button>
                                <button type="button" className="w-full text-left px-3 py-2 text-error hover:bg-error-container" onClick={() => void setStatus(a, 'cancelled', 'Appointment cancelled')}>Cancel</button>
                              </div>
                            )}
                          </div>
                        )}
                      </Td>
                    </Tr>
                  )
                })}
              </Table>
            </div>
          )}
        </Card>
      </Async>

      <BookAppointmentModal open={booking} onClose={() => setBooking(false)} defaultDay={day} onDone={() => { setBooking(false); q.reload() }} />
      <RescheduleModal appt={resched} onClose={() => setResched(null)} busy={busy} onDone={() => { setResched(null); q.reload() }} />
    </>
  )
}

// The old appointment is kept as "rescheduled" (history); a new one is booked at the new time.
function RescheduleModal({ appt, onClose, busy, onDone }: { appt: Appt | null; onClose: () => void; busy: boolean; onDone: () => void }) {
  const { run, busy: b2 } = useAction()
  const [when, setWhen] = useState('')
  useEffect(() => { if (appt) setWhen(`${lagosToday()}T09:00`) }, [appt])
  async function save() {
    if (!appt || !when) return
    const r = await run(async () => {
      const { error: e1 } = await supabase.from('appointments').insert({
        patient_id: appt.patient_id, doctor_id: appt.doctor_id, department: appt.department, appt_type: appt.appt_type,
        scheduled_at: lagosIso(when), reason: appt.reason,
      })
      if (e1) throw e1
      const { error: e2 } = await supabase.from('appointments').update({ status: 'rescheduled' }).eq('id', appt.id)
      if (e2) throw e2
      return true
    }, 'Appointment rescheduled')
    if (r) onDone()
  }
  return (
    <Modal open={!!appt} onClose={onClose} title="Reschedule Appointment"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button busy={busy || b2} onClick={() => void save()}>Reschedule</Button></>}>
      <p className="text-body-sm text-on-surface-variant">{appt?.patient?.full_name} — currently {appt && fmtTime(appt.scheduled_at)}. The current booking is kept in history as rescheduled.</p>
      <Field label="New date and time *"><Input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} /></Field>
    </Modal>
  )
}
