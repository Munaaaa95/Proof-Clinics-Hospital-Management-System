'use client'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { ok, useQuery } from '@/lib/hooks'
import { ageSex, fmtTime, lagosToday, minutesSince, waitText } from '@/lib/format'
import { hasRole } from '@/lib/roles'
import { FeedbackModal, ratingLabel } from '@/components/FeedbackModal'
import { VitalsModal } from '@/components/VitalsForm'
import { Async, Button, Card, EmptyState, Icon, LiveBadge, PageHeader, SearchBox, StatTile, StatusPill, Table, Tabs, Td, Th, Tr, useAction, titleCaseVisit } from '@/components/ui'

interface Visit {
  id: string; patient_id: string; visit_type: string; department: string; complaint: string | null; status: string
  checked_in_at: string; completed_at: string | null; feedback_rating: string | null; feedback_note: string | null
  patient: { full_name: string; patient_code: string; dob: string; sex: string } | null
  doctor: { full_name: string } | null
}

export default function QueuePage() {
  const router = useRouter()
  const { staff } = useAuth()
  const { busy, run } = useAction()
  const [dept, setDept] = useState('all')
  const [status, setStatus] = useState<'active' | 'waiting' | 'in_consultation' | 'completed'>('active')
  const [filter, setFilter] = useState('')
  const [vitalsFor, setVitalsFor] = useState<Visit | null>(null)
  const [feedbackFor, setFeedbackFor] = useState<Visit | null>(null)
  const isDoctor = hasRole(staff?.role, 'doctor')
  const canVitals = hasRole(staff?.role, 'receptionist', 'nurse')
  const canFeedback = hasRole(staff?.role, 'receptionist', 'nurse', 'doctor', 'hospital_admin', 'super_admin')
  const canCancel = hasRole(staff?.role, 'receptionist', 'nurse', 'hospital_admin', 'super_admin')

  const q = useQuery<Visit[]>(async () => {
    const since = `${lagosToday()}T00:00:00+01:00`
    return ok(await supabase.from('visits')
      .select('id, patient_id, visit_type, department, complaint, status, checked_in_at, completed_at, feedback_rating, feedback_note, patient:patients(full_name, patient_code, dob, sex), doctor:staff!visits_doctor_id_fkey(full_name)')
      .or(`status.in.(waiting,in_consultation),and(status.eq.completed,completed_at.gte.${since})`)
      .order('checked_in_at') as never) as Visit[]
  }, [], ['visits'])

  const all = q.data ?? []
  const waiting = all.filter((v) => v.status === 'waiting')
  const inConsult = all.filter((v) => v.status === 'in_consultation')
  const completed = all.filter((v) => v.status === 'completed')
  const avgWait = waiting.length ? Math.round(waiting.reduce((n, v) => n + minutesSince(v.checked_in_at), 0) / waiting.length) : 0
  const depts = useMemo(() => Array.from(new Set(all.filter((v) => v.status !== 'completed').map((v) => v.department))).sort(), [all])

  const rows = all.filter((v) => {
    if (status === 'active' ? v.status === 'completed' : v.status !== status) return false
    if (dept !== 'all' && v.department !== dept) return false
    const t = filter.trim().toLowerCase()
    return !t || v.patient?.full_name.toLowerCase().includes(t) || v.patient?.patient_code.toLowerCase().includes(t) || (v.complaint ?? '').toLowerCase().includes(t)
  })

  const start = (v: Visit) => run(async () => {
    const { error } = await supabase.rpc('start_consultation', { p_visit_id: v.id })
    if (error) throw error
    router.push(`/consultation?visit=${v.id}`)
  })
  const cancel = (v: Visit) => {
    if (!window.confirm(`Remove ${v.patient?.full_name} from the queue?`)) return
    void run(async () => {
      const { error } = await supabase.from('visits').update({ status: 'cancelled' }).eq('id', v.id)
      if (error) throw error
      q.reload()
    }, 'Visit cancelled')
  }

  return (
    <>
      <PageHeader title="Waiting Queue" badge={<LiveBadge text="LIVE" />} subtitle="Patients waiting for a doctor, updated live."
        actions={hasRole(staff?.role, 'receptionist', 'doctor', 'nurse', 'hospital_admin', 'super_admin') ? <Link href="/registration"><Button>New Patient</Button></Link> : undefined} />

      <Async q={q}>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
          <StatTile label="Waiting" value={waiting.length} hint="patients in queue" foot={<span>waiting for a doctor</span>} />
          <StatTile label="In consultation" value={inConsult.length} hint="with a doctor" />
          <StatTile label="Completed Today" value={completed.length} hint="completed visits" />
          <StatTile label="Average Wait Time" value={`${avgWait} mins`} hint="average wait" />
        </div>

        <Card className="overflow-hidden">
          <div className="px-5 py-4 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
            <Tabs value={dept} onChange={setDept}
              tabs={[{ id: 'all', label: 'All Departments', count: all.filter((v) => v.status !== 'completed').length },
                ...depts.map((d) => ({ id: d, label: d, count: all.filter((v) => v.status !== 'completed' && v.department === d).length }))]} />
            <div className="flex items-center gap-2">
              <select value={status} onChange={(e) => setStatus(e.target.value as typeof status)} aria-label="Status filter"
                className="h-8 rounded-md bg-surface-container-low text-body-sm px-2 focus:outline-none focus:ring-2 focus:ring-primary">
                <option value="active">Waiting and in consultation</option>
                <option value="waiting">Waiting only</option>
                <option value="in_consultation">In consultation only</option>
                <option value="completed">Completed today</option>
              </select>
              <SearchBox value={filter} onChange={setFilter} placeholder="Filter current list..." className="w-52" />
              <Button variant="ghost" small icon="refresh" onClick={q.reload} aria-label="Refresh queue" />
            </div>
          </div>
          {rows.length === 0 ? (
            <EmptyState title="No patients in this list" hint="New check-ins appear here live." />
          ) : (
            <Table head={<><Th>Patient</Th><Th>Patient ID</Th><Th>Age &amp; Sex</Th><Th>Visit Type</Th><Th>Department</Th><Th>Arrival</Th><Th>Wait Time</Th><Th>Status</Th><Th>Action</Th></>}>
              {rows.map((v) => (
                <Tr key={v.id}>
                  <Td>
                    <Link href={`/patients/${v.patient_id}`} className="hover:underline font-medium block">{v.patient?.full_name}</Link>
                    <span className="text-outline text-label-xs">{v.complaint}</span>
                  </Td>
                  <Td className="text-on-surface-variant">{v.patient?.patient_code}</Td>
                  <Td>{ageSex(v.patient?.dob, v.patient?.sex)}</Td>
                  <Td><span className="inline-flex px-2 py-0.5 rounded bg-surface-container-high text-on-surface-variant text-label-xs">{titleCaseVisit(v.visit_type)}</span></Td>
                  <Td>{v.department}</Td>
                  <Td>{fmtTime(v.checked_in_at)}</Td>
                  <Td className="font-medium">{v.status === 'completed' ? '—' : waitText(minutesSince(v.checked_in_at))}</Td>
                  <Td><StatusPill status={v.status} /></Td>
                  <Td>
                    <div className="flex items-center gap-1.5">
                      {canVitals && v.status !== 'completed' && <Button small variant="secondary" onClick={() => setVitalsFor(v)}>Vitals</Button>}
                      {canFeedback && v.status === 'completed' && <Button small variant="secondary" onClick={() => setFeedbackFor(v)}>{v.feedback_rating || v.feedback_note ? `Feedback: ${ratingLabel(v.feedback_rating)}` : 'Add feedback'}</Button>}
                      {isDoctor && v.status === 'waiting' && <Button small busy={busy} onClick={() => void start(v)}>Start Consultation</Button>}
                      {isDoctor && v.status === 'in_consultation' && <Button small variant="secondary" onClick={() => router.push(`/consultation?visit=${v.id}`)}>Resume</Button>}
                      {!(isDoctor && v.status !== 'completed') && <Button small variant="ghost" onClick={() => router.push(`/patients/${v.patient_id}`)}>View</Button>}
                      {canCancel && v.status === 'waiting' && <button type="button" onClick={() => cancel(v)} aria-label="Remove from queue" title="Remove from queue" className="p-1 rounded text-outline hover:text-error hover:bg-error-container"><Icon name="close" className="text-[18px]" /></button>}
                    </div>
                  </Td>
                </Tr>
              ))}
            </Table>
          )}
          <div className="px-5 py-3.5 text-label-sm text-outline">Showing {rows.length} of {all.length} entries</div>
        </Card>
      </Async>

      <VitalsModal visit={vitalsFor ? { id: vitalsFor.id, patientId: vitalsFor.patient_id, patientName: vitalsFor.patient?.full_name ?? '' } : null} onClose={() => setVitalsFor(null)} onSaved={() => setVitalsFor(null)} />
      <FeedbackModal visit={feedbackFor ? { id: feedbackFor.id, patientName: feedbackFor.patient?.full_name ?? '', rating: feedbackFor.feedback_rating, note: feedbackFor.feedback_note } : null} onClose={() => setFeedbackFor(null)} onSaved={() => { setFeedbackFor(null); q.reload() }} />
    </>
  )
}
