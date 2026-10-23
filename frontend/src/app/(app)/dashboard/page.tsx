'use client'
import Link from 'next/link'
import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { ok, useQuery } from '@/lib/hooks'
import { ageSex, fmtDate, fmtDateTime, fmtTime, lagosToday, minutesSince, titleCase, todayLong, TZ, waitText } from '@/lib/format'
import { ratingLabel } from '@/components/FeedbackModal'
import { noteIcon, noteLink } from '@/lib/notify'
import { Async, Button, Icon, Card, Drawer, EmptyState, LiveBadge, PageHeader, PatientCell, SearchBox, StatTile, StatusPill, Table, Td, Th, Tr } from '@/components/ui'
import { hasRole } from '@/lib/roles'

const isToday = (v?: string | null) => !!v && new Date(v).toLocaleDateString('en-CA', { timeZone: TZ }) === lagosToday()

type Row = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

interface Data {
  summary: Row | null
  inpatients: Row[]; discharged: Row[]; waiting: Row[]; admissions: Row[]; lab: Row[]; appts: Row[]
  queue: Row[]; notes: Row[]; beds: Row[]; stock: Row[]
}

export default function DashboardPage() {
  const { staff } = useAuth()
  const [open, setOpen] = useState<null | 'A' | 'B' | 'C' | 'D' | 'E' | 'F'>(null)
  const [filter, setFilter] = useState('')
  const canStock = hasRole(staff?.role, 'pharmacist', 'hospital_admin', 'super_admin')
  const canLab = hasRole(staff?.role, 'doctor', 'nurse', 'lab_scientist', 'hospital_admin', 'super_admin')

  const q = useQuery<Data>(async () => {
    const [summary, inpatients, discharged, waiting, admissions, lab, appts, queue, notes, beds, stock] = await Promise.all([
      supabase.from('dash_summary').select('*').maybeSingle(),
      supabase.from('dash_inpatients').select('*').order('admitted_at', { ascending: false }),
      supabase.from('dash_discharged').select('*').order('discharged_at', { ascending: false }).limit(200),
      supabase.from('dash_waiting').select('*').order('checked_in_at'),
      supabase.from('dash_admissions').select('*').order('admitted_at', { ascending: false }).limit(200),
      canLab ? supabase.from('dash_lab').select('*').order('requested_at', { ascending: false }).limit(200) : Promise.resolve({ data: [], error: null }),
      supabase.from('dash_appointments_today').select('*').order('scheduled_at'),
      supabase.from('visits')
        .select('id, department, status, checked_in_at, patient:patients(full_name, patient_code, dob, sex), doctor:staff!visits_doctor_id_fkey(full_name)')
        .in('status', ['waiting', 'in_consultation']).order('checked_in_at'),
      supabase.from('notifications').select('id, type, title, body, link, read_at, created_at')
        .eq('recipient_staff_id', staff!.id).order('created_at', { ascending: false }).limit(4),
      supabase.from('dash_bed_summary').select('*'),
      // stock rows are only readable by pharmacy and administrators; for other roles the view would show zeros
      canStock ? supabase.from('drug_stock_status').select('*').order('name') : Promise.resolve({ data: [], error: null }),
    ])
    return {
      summary: ok(summary as never), inpatients: ok(inpatients as never) ?? [], discharged: ok(discharged as never) ?? [],
      waiting: ok(waiting as never) ?? [], admissions: ok(admissions as never) ?? [], lab: (ok(lab as never) ?? []) as Row[],
      appts: ok(appts as never) ?? [], queue: ok(queue as never) ?? [], notes: ok(notes as never) ?? [],
      beds: ok(beds as never) ?? [], stock: (ok(stock as never) ?? []) as Row[],
    }
  }, [staff?.id], ['visits', 'admissions', 'appointments', 'lab_requests', 'lab_results', 'beds', 'bills', 'payments', 'notifications', 'stock_batches'])

  const d = q.data
  const s = d?.summary
  const admittedToday = d?.admissions.filter((a) => isToday(a.admitted_at)) ?? []
  const seenToday = d?.discharged.filter((v) => isToday(v.discharged_at)) ?? []
  const fromWard = seenToday.filter((v) => v.discharge_status === 'Discharged from ward').length
  const labToday = d?.lab.filter((l) => isToday(l.requested_at)) ?? []
  const labFinal = labToday.filter((l) => l.result_status === 'finalized').length
  const avgWait = d && d.waiting.length ? Math.round(d.waiting.reduce((n, w) => n + (w.waiting_minutes ?? 0), 0) / d.waiting.length) : 0
  const byDept = (rows: Row[], key: string) => Object.entries(rows.reduce<Record<string, number>>((m, r) => ({ ...m, [r[key]]: (m[r[key]] ?? 0) + 1 }), {}))
  const apptDone = (d?.appts ?? []).filter((a) => ['checked_in', 'waiting', 'in_consultation', 'completed'].includes(a.appointment_status)).length
  const apptRes = (d?.appts ?? []).filter((a) => a.appointment_status === 'rescheduled').length
  const apptPending = (d?.appts ?? []).filter((a) => ['scheduled', 'confirmed'].includes(a.appointment_status)).length

  const queue = (d?.queue ?? []).filter((r) => !filter || r.patient?.full_name?.toLowerCase().includes(filter.toLowerCase()) || r.patient?.patient_code?.toLowerCase().includes(filter.toLowerCase()))

  return (
    <>
      <PageHeader title="Clinical Operations Dashboard" badge={<LiveBadge />} subtitle={`Today, ${todayLong()}`}
        actions={<Link href="/registration"><Button>Quick Register Patient</Button></Link>} />

      <Async q={q}>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          <StatTile accent label="Inpatients" value={s?.active_inpatients ?? 0} hint="Currently admitted" onClick={() => setOpen('A')}
            foot={<><span className="flex items-center gap-1 text-on-surface font-medium">{admittedToday.length} admitted today</span><span>{s?.beds_total ?? 0} beds total</span></>} />
          <StatTile label="Outpatients & Discharged" value={seenToday.length} hint="Seen today" onClick={() => setOpen('B')}
            foot={<><span className="text-on-surface font-medium">{seenToday.length - fromWard} completed consultations</span><span>{fromWard} discharged</span></>} />
          <StatTile label="Waiting Patients" value={d?.waiting.length ?? 0} hint="Current clinic queue" onClick={() => setOpen('C')}
            foot={d?.waiting.length ? <>{byDept(d.waiting, 'department').slice(0, 3).map(([k, n], i) => <span key={k} className="text-on-surface font-medium">{i > 0 && <span className="text-outline mr-2">•</span>}{n} {k}</span>)}<span>Avg wait {avgWait} mins</span></> : <span>Nobody waiting</span>} />
          <StatTile label="Admissions" value={admittedToday.length} hint="Admitted today" onClick={() => setOpen('D')}
            foot={admittedToday.length ? <>{byDept(admittedToday, 'ward').map(([k, n], i) => <span key={k} className="text-on-surface font-medium">{i > 0 && <span className="text-outline mr-2">•</span>}{n} {k}</span>)}</> : <span>No admissions yet today</span>} />
          <StatTile label="Laboratory Results" value={canLab ? labToday.length : '—'} hint={canLab ? 'Lab requests today' : 'Not available for your role'} onClick={canLab ? () => setOpen('E') : undefined}
            foot={canLab ? <><span className="text-on-surface font-medium">{labFinal} finalised</span><span className="text-on-surface font-medium">{labToday.length - labFinal} awaiting result</span></> : undefined} />
          <StatTile label="Today's Appointments" value={d?.appts.length ?? 0} hint="Scheduled consultations" onClick={() => setOpen('F')}
            foot={<><span className="text-on-surface font-medium">{apptDone} checked in</span><span>{apptPending} pending</span><span>{apptRes} rescheduled</span></>} />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
          <Card className="lg:col-span-2 flex flex-col overflow-hidden">
            <div className="px-5 py-4 flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2">
                <h2 className="text-headline-md text-on-surface font-semibold">Live Clinic Queue Snapshot</h2>
                <span className="px-2 py-0.5 text-label-xs rounded-full bg-surface-container-low text-primary font-medium">Live</span>
              </div>
              <div className="flex items-center gap-2">
                <SearchBox value={filter} onChange={setFilter} placeholder="Filter patient ..." className="w-48" />
                <Button variant="ghost" small onClick={q.reload}>Sync</Button>
              </div>
            </div>
            {queue.length === 0 ? <EmptyState title="Nobody in the queue" hint="Patients appear here as soon as they are checked in." /> : (
              <Table head={<><Th>Patient Name</Th><Th>Department</Th><Th>Assigned Doctor</Th><Th>Wait Time</Th><Th>Status</Th></>}>
                {queue.slice(0, 8).map((r) => (
                  <Tr key={r.id}>
                    <Td><PatientCell name={r.patient?.full_name} code={r.patient?.patient_code} extra={ageSex(r.patient?.dob, r.patient?.sex)} /></Td>
                    <Td>{r.department}</Td>
                    <Td className="text-on-surface-variant">{r.doctor?.full_name ?? '—'}</Td>
                    <Td className="font-medium">{waitText(minutesSince(r.checked_in_at))}</Td>
                    <Td><StatusPill status={r.status} /></Td>
                  </Tr>
                ))}
              </Table>
            )}
            <div className="px-5 py-3.5 flex items-center justify-between text-label-sm text-outline">
              <span>Showing {Math.min(queue.length, 8)} of {queue.length} queue entries</span>
              <Link href="/queue" className="text-primary hover:underline">Open the queue</Link>
            </div>
          </Card>

          <Card className="p-6 flex flex-col gap-space-md">
            <div className="flex items-center justify-between">
              <h2 className="text-headline-md text-on-surface font-semibold flex items-center gap-2"><span>Recent Notifications</span><span className="flex h-2 w-2 rounded-full bg-secondary" /></h2>
              <span className="text-label-xs text-outline">Live</span>
            </div>
            {(d?.notes.length ?? 0) === 0 ? <EmptyState title="No notifications yet" /> : (
              <div className="space-y-3">
                {d!.notes.map((n) => {
                  const href = noteLink(n.link)
                  const inner = (
                    <div className={`p-3.5 rounded-lg flex flex-col gap-1.5 ${n.read_at ? 'bg-surface-container-low' : 'bg-surface-container-high/60'}`}>
                      <div className="flex items-center justify-between gap-2">
                        <span className="inline-flex items-center gap-1.5 text-label-sm font-semibold text-on-surface"><Icon name={noteIcon(n.type)} className="text-[16px] text-primary" />{n.title}</span>
                        <span className="text-label-xs text-outline font-mono shrink-0">{fmtTime(n.created_at)}</span>
                      </div>
                      <p className="text-body-sm text-on-surface-variant leading-snug">{n.body}</p>
                    </div>
                  )
                  return href ? <Link key={n.id} href={href} className="block">{inner}</Link> : <div key={n.id}>{inner}</div>
                })}
              </div>
            )}
            <Link href="/notifications" className="w-full h-8 rounded-lg bg-surface-container-low hover:bg-surface-container-high text-on-surface text-label-sm flex items-center justify-center gap-1 transition-colors">
              <span>View all notifications</span>
            </Link>
          </Card>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
          <Card className="overflow-hidden">
            <div className="px-5 py-4 flex items-center justify-between"><h2 className="text-headline-md font-semibold">Available Beds</h2><Link href="/inpatient" className="text-label-sm text-primary hover:underline">Open ward board</Link></div>
            <Table head={<><Th>Ward</Th><Th>Total</Th><Th>Occupied</Th><Th>Available</Th><Th>Reserved</Th><Th>Maintenance</Th></>}>
              {[...(d?.beds ?? [])].sort((a, b) => (a.ward === 'All wards' ? -1 : b.ward === 'All wards' ? 1 : a.ward.localeCompare(b.ward))).map((b) => (
                <Tr key={b.ward} className={b.ward === 'All wards' ? 'bg-surface-container-low/60 font-medium' : ''}>
                  <Td>{b.ward}</Td><Td>{b.total_beds}</Td><Td>{b.occupied}</Td><Td className="font-medium">{b.available}</Td><Td>{b.reserved}</Td><Td>{b.maintenance}</Td>
                </Tr>
              ))}
            </Table>
          </Card>
          {canStock && (
            <Card className="overflow-hidden">
              <div className="px-5 py-4 flex items-center justify-between"><h2 className="text-headline-md font-semibold">Drug Stock</h2><Link href="/pharmacy" className="text-label-sm text-primary hover:underline">Open pharmacy</Link></div>
              {(d?.stock.length ?? 0) === 0 ? <EmptyState title="No drugs recorded" /> : (
                <Table head={<><Th>Drug</Th><Th>Quantity</Th><Th>Minimum</Th><Th>Nearest expiry</Th><Th>Status</Th></>}>
                  {d!.stock.map((x) => (
                    <Tr key={x.drug_id}><Td className="font-medium">{x.name}</Td><Td>{x.quantity} {x.unit}s</Td><Td>{x.min_stock}</Td><Td>{x.nearest_expiry ? fmtDate(x.nearest_expiry) : '—'}</Td>
                      <Td><div className="flex gap-1 flex-wrap"><StatusPill status={x.stock_status} />{x.expiring_soon && <StatusPill status="expiring" />}</div></Td></Tr>
                  ))}
                </Table>
              )}
            </Card>
          )}
        </div>
      </Async>

      <SectionDrawer open={open} onClose={() => setOpen(null)} d={d} seenToday={seenToday} admittedToday={admittedToday} labToday={labToday} />
    </>
  )
}

// Spec section 3 asks for lists; each tile opens its list here.
function SectionDrawer({ open, onClose, d, seenToday, admittedToday, labToday }: {
  open: null | 'A' | 'B' | 'C' | 'D' | 'E' | 'F'; onClose: () => void; d: Data | null; seenToday: Row[]; admittedToday: Row[]; labToday: Row[]
}) {
  const titles = { A: 'A. Active inpatients', B: 'B. Outpatients and discharged today', C: 'C. Waiting patients', D: 'D. Admissions today', E: 'E. Laboratory today', F: "F. Today's appointments" }
  const patient = (r: Row) => <Link href={`/patients/${r.patient_id}`} className="block hover:underline"><PatientCell name={r.patient_name} code={r.patient_code} /></Link>
  const sub = (t?: string | null) => <div className="text-outline text-label-xs">{t}</div>
  return (
    <Drawer open={!!open} onClose={onClose} title={open ? titles[open] : ''} wide>
      {!d || !open ? null : (
        <div className="-mx-6 -my-6">
          {open === 'A' && (d.inpatients.length === 0 ? <EmptyState title="No active inpatients" /> :
            <Table head={<><Th>Patient</Th><Th>Ward and bed</Th><Th>Diagnosis</Th><Th>Doctor / nurse</Th><Th>Admitted</Th><Th>Status</Th></>}>
              {d.inpatients.map((r) => <Tr key={r.admission_id}><Td>{patient(r)}</Td><Td>{r.ward}{sub(`Bed ${r.bed_number}`)}</Td><Td>{r.diagnosis}</Td><Td>{r.doctor_name}{sub(r.nurse_name ?? 'No nurse assigned')}</Td><Td>{fmtDateTime(r.admitted_at)}</Td><Td>{r.current_status}</Td></Tr>)}
            </Table>)}
          {open === 'B' && (seenToday.length === 0 ? <EmptyState title="Nobody seen yet today" /> :
            <Table head={<><Th>Patient</Th><Th>Discharged</Th><Th>Doctor</Th><Th>Outcome</Th><Th>Payment</Th><Th>Feedback</Th></>}>
              {seenToday.map((r) => <Tr key={r.visit_id}><Td>{patient(r)}</Td><Td>{fmtTime(r.discharged_at)}</Td><Td>{r.doctor_name ?? '—'}</Td><Td>{r.discharge_status}</Td>
                <Td>{r.payment_status ? <div><StatusPill status={r.payment_status} />{sub(r.payment_source ? (r.payment_source === 'hmo' ? 'HMO' : titleCase(r.payment_source)) : null)}</div> : <span className="text-outline">—</span>}</Td>
                <Td>{r.feedback_rating || r.feedback_note ? <div><span className="font-medium">{ratingLabel(r.feedback_rating)}</span>{sub(r.feedback_note)}</div> : <span className="text-outline">—</span>}</Td></Tr>)}
            </Table>)}
          {open === 'C' && (d.waiting.length === 0 ? <EmptyState title="Nobody is waiting" /> :
            <Table head={<><Th>Patient</Th><Th>Complaint</Th><Th>Department</Th><Th>Checked in</Th><Th>Appointment</Th><Th>Waiting</Th></>}>
              {d.waiting.map((r) => <Tr key={r.visit_id}><Td>{patient(r)}</Td><Td>{r.complaint}</Td><Td>{r.department}</Td><Td>{fmtTime(r.checked_in_at)}</Td><Td>{titleCase(r.appointment_status)}</Td><Td className="font-medium">{waitText(r.waiting_minutes)}</Td></Tr>)}
            </Table>)}
          {open === 'D' && (admittedToday.length === 0 ? <EmptyState title="No admissions yet today" /> :
            <Table head={<><Th>Patient</Th><Th>Diagnosis</Th><Th>Ward and bed</Th><Th>Doctor</Th><Th>Admitted</Th><Th>Status</Th></>}>
              {admittedToday.map((r) => <Tr key={r.admission_id}><Td>{patient(r)}</Td><Td>{r.diagnosis}</Td><Td>{r.ward}{sub(`Bed ${r.bed_number}`)}</Td><Td>{r.doctor_name}</Td><Td>{fmtDateTime(r.admitted_at)}</Td><Td><StatusPill status={r.admission_status === 'active' ? 'active' : 'discharged'} /></Td></Tr>)}
            </Table>)}
          {open === 'E' && (labToday.length === 0 ? <EmptyState title="No lab requests today" /> :
            <Table head={<><Th>Patient</Th><Th>Test</Th><Th>Specimen</Th><Th>Collected</Th><Th>Source</Th><Th>Status</Th><Th>Result</Th></>}>
              {labToday.map((r) => <Tr key={r.lab_request_id}><Td>{patient(r)}</Td><Td>{r.test}</Td><Td>{r.specimen_type ?? '—'}</Td><Td>{r.collected_at ? fmtDateTime(r.collected_at) : '—'}</Td><Td>{r.lab_source}</Td><Td><StatusPill status={r.result_status} /></Td>
                <Td>{r.result ?? <span className="text-outline">—</span>}{r.reviewed_by && sub(`Reviewed by ${r.reviewed_by}`)}</Td></Tr>)}
            </Table>)}
          {open === 'F' && (d.appts.length === 0 ? <EmptyState title="No appointments today" /> :
            <Table head={<><Th>Time</Th><Th>Patient</Th><Th>Doctor</Th><Th>Department</Th><Th>Type</Th><Th>Reason</Th><Th>Status</Th></>}>
              {d.appts.map((r) => <Tr key={r.appointment_id}><Td className="font-medium">{fmtTime(r.scheduled_at)}</Td><Td>{patient(r)}</Td><Td>{r.doctor_name ?? '—'}</Td><Td>{r.department}</Td><Td>{titleCase(r.appointment_type)}</Td><Td>{r.reason ?? '—'}</Td><Td><StatusPill status={r.appointment_status} /></Td></Tr>)}
            </Table>)}
          <p className="px-6 py-4 text-label-xs text-outline">Updated {fmtDateTime(new Date().toISOString())}</p>
        </div>
      )}
    </Drawer>
  )
}
