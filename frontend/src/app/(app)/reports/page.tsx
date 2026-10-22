'use client'
import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { ok, useQuery } from '@/lib/hooks'
import { fmtDate, lagosToday, naira } from '@/lib/format'
import { Async, Button, Card, EmptyState, Field, Input, PageHeader, Select, StatTile, StatusPill, Table, Td, Th, Tr, titleCaseVisit } from '@/components/ui'

interface Report {
  period: { from: string; to: string }
  visits: { total: number; unique_patients: number; outpatient: number; inpatient_or_admission: number; completed: number }
  admissions: { admitted_in_period: number; discharged_in_period: number; active_now: number }
  beds: { total: number; occupied: number; available: number; occupancy_percent: number }
  appointments: { total: number; completed: number; cancelled: number; no_show: number }
  lab_workload: { test: string; requests: number; finalized: number }[]
  pharmacy_usage: { drug: string; quantity_dispensed: number; dispensings: number }[]
  revenue: { billed: number; paid: number; outstanding: number; paid_by_source: { source: string; amount: number; payments: number }[]; billed_by_source: { source: string; amount: number }[] }
  anc: { visits: number; mothers_registered: number }
  daily_visits: { date: string; visits: number }[]
}
const DEPARTMENTS = ['General', 'Internal Medicine', 'Paediatrics', 'Obstetrics & Gynaecology']
const VISIT_TYPES = ['outpatient', 'inpatient', 'admission', 'referral']
const back = (n: number) => { const t = new Date(`${lagosToday()}T12:00:00Z`); t.setUTCDate(t.getUTCDate() - n); return t.toISOString().slice(0, 10) }
const src = (s: string) => (s === 'hmo' ? 'HMO' : s === 'not recorded' ? 'Not recorded' : s.replace(/^\w/, (c) => c.toUpperCase()))

export default function ReportsPage() {
  const [draft, setDraft] = useState({ from: back(6), to: lagosToday(), department: '', doctor: '', visitType: '', service: '' })
  const [applied, setApplied] = useState(draft)
  const [err, setErr] = useState<string | null>(null)

  const lists = useQuery(async () => {
    const [doctors, services] = await Promise.all([
      supabase.from('staff').select('id, full_name').eq('role', 'doctor').order('full_name'),
      supabase.from('services').select('id, name').eq('category', 'lab').order('name'),
    ])
    return { doctors: (doctors.data ?? []) as { id: string; full_name: string }[], services: (services.data ?? []) as { id: string; name: string }[] }
  }, [])

  // Current stock is a snapshot, not a period figure. Referrals are visits of type referral in the same period and filters.
  const extra = useQuery(async () => {
    let ref = supabase.from('visits').select('id', { count: 'exact', head: true }).eq('visit_type', 'referral')
      .gte('checked_in_at', `${applied.from}T00:00:00+01:00`).lt('checked_in_at', `${applied.to}T23:59:59+01:00`)
    if (applied.department) ref = ref.eq('department', applied.department)
    if (applied.doctor) ref = ref.eq('doctor_id', applied.doctor)
    const [refs, stock] = await Promise.all([ref, supabase.from('drug_stock_status').select('*').order('name')])
    return { referrals: refs.count ?? 0, stock: (stock.data ?? []) as { drug_id: string; name: string; unit: string; quantity: number; min_stock: number; nearest_expiry: string | null; stock_status: string; expiring_soon: boolean | null }[] }
  }, [applied], ['visits', 'stock_batches'])

  const q = useQuery<Report>(async () => ok(await supabase.rpc('report_summary', {
    p_from: applied.from, p_to: applied.to, p_department: applied.department || null, p_doctor_id: applied.doctor || null,
    p_visit_type: applied.visitType || null, p_service_id: applied.service || null,
  }) as never), [applied], ['visits', 'bills', 'payments', 'lab_requests', 'dispensing', 'admissions', 'appointments'])

  function apply() {
    setErr(null)
    if (draft.to < draft.from) return setErr('The end date is before the start date')
    if ((new Date(draft.to).getTime() - new Date(draft.from).getTime()) / 86400000 > 366) return setErr('A report can cover up to 366 days')
    setApplied(draft)
  }
  const set = (k: keyof typeof draft) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setDraft((s) => ({ ...s, [k]: e.target.value }))
  const r = q.data
  const max = Math.max(1, ...(r?.daily_visits.map((d) => d.visits) ?? [1]))
  const sources = r ? Array.from(new Set([...r.revenue.billed_by_source.map((x) => x.source), ...r.revenue.paid_by_source.map((x) => x.source)])) : []
  const dayLabel = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' })
  const dense = (r?.daily_visits.length ?? 0) > 14

  return (
    <>
      <PageHeader title="Reports" subtitle="Real-time and historical figures for hospital administrators." />
      <Card className="p-5 space-y-4">
        <div className="grid grid-cols-2 lg:grid-cols-6 gap-3 items-end">
          <Field label="From"><Input type="date" value={draft.from} max={draft.to} onChange={set('from')} /></Field>
          <Field label="To"><Input type="date" value={draft.to} min={draft.from} onChange={set('to')} /></Field>
          <Field label="Department"><Select value={draft.department} onChange={set('department')}><option value="">All departments</option>{DEPARTMENTS.map((d) => <option key={d}>{d}</option>)}</Select></Field>
          <Field label="Doctor"><Select value={draft.doctor} onChange={set('doctor')}><option value="">All doctors</option>{lists.data?.doctors.map((d) => <option key={d.id} value={d.id}>{d.full_name}</option>)}</Select></Field>
          <Field label="Visit type"><Select value={draft.visitType} onChange={set('visitType')}><option value="">All types</option>{VISIT_TYPES.map((v) => <option key={v} value={v}>{titleCaseVisit(v)}</option>)}</Select></Field>
          <Field label="Service"><Select value={draft.service} onChange={set('service')}><option value="">All services</option>{lists.data?.services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
        </div>
        <div className="flex items-center gap-3"><Button onClick={apply}>Apply Filters</Button><span className="text-label-xs text-outline">A report can cover up to 366 days.</span>{err && <span className="text-body-sm text-error" role="alert">{err}</span>}</div>
      </Card>

      <Async q={q}>
        {r && (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
              <StatTile label="Visits" value={r.visits.total} foot={<><span>{r.visits.unique_patients} patients • {r.visits.completed} completed</span><span>{r.visits.outpatient} outpatient • {r.visits.inpatient_or_admission} inpatient or admission • {extra.data?.referrals ?? 0} referral{extra.data?.referrals === 1 ? '' : 's'}</span></>} />
              <StatTile label="Admissions" value={r.admissions.admitted_in_period} foot={<span>{r.admissions.discharged_in_period} discharged • {r.admissions.active_now} in wards now</span>} />
              <StatTile label="Bed Occupancy" value={`${Math.round(r.beds.occupancy_percent)}%`} foot={<span>{r.beds.occupied} of {r.beds.total} occupied • {r.beds.available} available</span>} />
              <StatTile label="Appointments" value={r.appointments.total} foot={<span>{r.appointments.completed} completed • {r.appointments.cancelled} cancelled • {r.appointments.no_show} no-show</span>} />
            </div>

            <Card className="p-6 space-y-3">
              <h2 className="text-headline-md flex items-center gap-2">Visits per Day</h2>
              {r.daily_visits.length === 0 ? <EmptyState title="No days in range" /> : (
                <div className="flex items-end gap-1.5 h-48 overflow-x-auto" role="img" aria-label={`Visits per day: ${r.daily_visits.map((d) => `${d.date} ${d.visits}`).join(', ')}`}>
                  {r.daily_visits.map((d) => (
                    <div key={d.date} className="flex-1 min-w-[1.25rem] max-w-[4rem] h-full flex flex-col items-center justify-end gap-1" title={`${d.date}: ${d.visits} visits`}>
                      <span className="text-label-xs text-on-surface-variant">{d.visits}</span>
                      <div className="w-full rounded-t bg-primary-container" style={{ height: `${Math.max(2, (d.visits / max) * 100)}%` }} />
                      <span className="text-label-xs text-outline">{dense ? d.date.slice(8) : dayLabel(d.date)}</span>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
              <Card className="p-6 space-y-3">
                <h2 className="text-headline-md flex items-center gap-2">Revenue</h2>
                <div className="grid grid-cols-3 gap-3">
                  <div><span className="block text-label-xs text-outline uppercase">Billed</span><span className="text-headline-md font-bold">{naira(r.revenue.billed)}</span></div>
                  <div><span className="block text-label-xs text-outline uppercase">Paid</span><span className="text-headline-md font-bold text-tertiary">{naira(r.revenue.paid)}</span></div>
                  <div><span className="block text-label-xs text-outline uppercase">Outstanding</span><span className="text-headline-md font-bold text-error">{naira(r.revenue.outstanding)}</span></div>
                </div>
                <Table head={<><Th>Payment source</Th><Th>Billed</Th><Th>Paid</Th></>}>
                  {sources.length === 0 ? <Tr><Td colSpan={3} className="text-outline">No billing in this period</Td></Tr> : sources.map((s) => (
                    <Tr key={s}><Td>{src(s)}</Td><Td>{naira(r.revenue.billed_by_source.find((x) => x.source === s)?.amount)}</Td><Td>{r.revenue.paid_by_source.find((x) => x.source === s) ? naira(r.revenue.paid_by_source.find((x) => x.source === s)!.amount) : '—'}</Td></Tr>
                  ))}
                </Table>
              </Card>

              <Card className="p-6 space-y-3">
                <h2 className="text-headline-md flex items-center gap-2">Laboratory Workload</h2>
                {r.lab_workload.length === 0 ? <EmptyState title="No lab requests in this period" /> : (
                  <Table head={<><Th>Test</Th><Th>Requests</Th><Th>Finalised</Th></>}>{r.lab_workload.map((x) => <Tr key={x.test}><Td>{x.test}</Td><Td>{x.requests}</Td><Td>{x.finalized}</Td></Tr>)}</Table>
                )}
              </Card>

              <Card className="p-6 space-y-3">
                <h2 className="text-headline-md flex items-center gap-2">Pharmacy Usage</h2>
                {r.pharmacy_usage.length === 0 ? <EmptyState title="Nothing dispensed in this period" /> : (
                  <Table head={<><Th>Drug</Th><Th>Qty dispensed</Th><Th>Times</Th></>}>{r.pharmacy_usage.map((x) => <Tr key={x.drug}><Td>{x.drug}</Td><Td>{x.quantity_dispensed}</Td><Td>{x.dispensings}</Td></Tr>)}</Table>
                )}
              </Card>

              <Card className="overflow-hidden lg:col-span-2">
                <div className="px-6 pt-6 pb-3"><h2 className="text-headline-md">Drug Stock</h2><p className="text-body-sm text-on-surface-variant mt-1">Current stock, as of now. It does not change with the date range.</p></div>
                {(extra.data?.stock.length ?? 0) === 0 ? <EmptyState title="No drugs recorded" /> : (
                  <Table head={<><Th>Drug</Th><Th>Quantity</Th><Th>Minimum</Th><Th>Nearest expiry</Th><Th>Status</Th></>}>
                    {extra.data!.stock.map((x) => <Tr key={x.drug_id}><Td className="font-medium">{x.name}</Td><Td>{x.quantity} {x.unit}s</Td><Td>{x.min_stock}</Td><Td>{x.nearest_expiry ? fmtDate(x.nearest_expiry) : '—'}</Td>
                      <Td><div className="flex gap-1 flex-wrap"><StatusPill status={x.stock_status} />{x.expiring_soon && <StatusPill status="expiring" />}</div></Td></Tr>)}
                  </Table>
                )}
              </Card>

              <Card className="p-6 space-y-3">
                <h2 className="text-headline-md flex items-center gap-2">Antenatal Care</h2>
                <div className="grid grid-cols-2 gap-3">
                  <div><span className="block text-label-xs text-outline uppercase">Visits</span><span className="text-headline-lg font-bold">{r.anc.visits}</span></div>
                  <div><span className="block text-label-xs text-outline uppercase">New mothers registered</span><span className="text-headline-lg font-bold">{r.anc.mothers_registered}</span></div>
                </div>
              </Card>
            </div>
          </>
        )}
      </Async>
    </>
  )
}
