'use client'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { ok, useQuery } from '@/lib/hooks'
import { ageSex, fmtDateTime, fmtTime, many } from '@/lib/format'
import { Async, Button, Card, EmptyState, Field, Icon, Input, PageHeader, SearchBox, Select, StatusPill, Table, Tabs, Td, Th, Tr, Textarea, cx, useAction } from '@/components/ui'

type Status = 'requested' | 'collected' | 'resulted' | 'finalized'
const SPECIMENS = ['Blood', 'Urine', 'Stool', 'Swab', 'Sputum', 'Other']

interface LabResult { result: string; reference_range: string | null; status: string; finalized_at: string | null }
interface Req {
  id: string; status: Status; requested_at: string; specimen_type: string | null; collected_at: string | null; patient_id: string
  patient: { full_name: string; patient_code: string; dob: string; sex: string } | null
  service: { name: string; specimen_type: string | null } | null
  requester: { full_name: string } | null
  result: LabResult | LabResult[] | null
}
const orderId = (id: string) => `LAB-${id.slice(0, 4).toUpperCase()}`

export default function LaboratoryPage() {
  const { staff } = useAuth()
  const [tab, setTab] = useState<Status>('requested')
  const [filter, setFilter] = useState('')
  const [sel, setSel] = useState<string | null>(null)
  const isLab = staff?.role === 'lab_scientist'

  const q = useQuery<Req[]>(async () => ok(await supabase.from('lab_requests')
    .select('id, status, requested_at, specimen_type, collected_at, patient_id, patient:patients(full_name, patient_code, dob, sex), service:services(name, specimen_type), requester:staff!lab_requests_requested_by_fkey(full_name), result:lab_results(result, reference_range, status, finalized_at)')
    .neq('status', 'cancelled').order('requested_at', { ascending: false }).limit(300) as never), [], ['lab_requests', 'lab_results'])

  const all = q.data ?? []
  const count = (s: Status) => all.filter((r) => r.status === s).length
  const rows = all.filter((r) => {
    if (r.status !== tab) return false
    const t = filter.trim().toLowerCase()
    return !t || r.patient?.full_name.toLowerCase().includes(t) || r.patient?.patient_code.toLowerCase().includes(t) || r.service?.name.toLowerCase().includes(t) || orderId(r.id).toLowerCase().includes(t)
  })
  // oldest first for the work still to do, newest first for finished work
  if (tab !== 'finalized') rows.reverse()
  const selected = all.find((r) => r.id === sel) ?? null

  return (
    <>
      <PageHeader title="Laboratory" />
      <Async q={q}>
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <Tabs value={tab} onChange={(t) => { setTab(t); setSel(null) }}
            tabs={[{ id: 'requested', label: 'Requested', count: count('requested') }, { id: 'collected', label: 'Collected', count: count('collected') },
              { id: 'resulted', label: 'Resulted', count: count('resulted') }, { id: 'finalized', label: 'Finalised', count: count('finalized') }]} />
          <div className="flex items-center gap-2"><SearchBox value={filter} onChange={setFilter} placeholder="Filter lab queue..." className="w-56" /><Button variant="ghost" small icon="sync" onClick={q.reload} aria-label="Refresh" /></div>
        </div>

        <Card className="overflow-hidden">
          <div className="px-5 py-4 flex items-center gap-2"><h2 className="text-headline-md">{tab === 'finalized' ? 'Finalised Results' : 'Active Specimen Worklist'}</h2></div>
          {rows.length === 0 ? <EmptyState title={`No ${tab === 'finalized' ? 'finalised' : tab} requests`} hint="New requests from doctors appear here live." /> : (
            <Table head={<><Th>Order ID</Th><Th>Patient</Th><Th>Test requested</Th><Th>Specimen</Th><Th>Status</Th><Th /></>}>
              {rows.map((r) => (
                <Tr key={r.id} onClick={() => setSel(r.id)} className={cx(sel === r.id && 'bg-primary-fixed/40')}>
                  <Td className="font-medium">{orderId(r.id)}<div className="text-outline text-label-xs">{fmtTime(r.requested_at)}</div></Td>
                  <Td><div className="font-medium">{r.patient?.full_name}</div><div className="text-outline text-label-xs">{r.patient?.patient_code} • {ageSex(r.patient?.dob, r.patient?.sex)}</div></Td>
                  <Td>{r.service?.name}</Td>
                  <Td><span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-surface-container-high text-label-xs">{r.specimen_type ?? r.service?.specimen_type ?? '—'}</span></Td>
                  <Td><StatusPill status={r.status} /></Td>
                  <Td className="text-right text-label-sm text-primary">Open</Td>
                </Tr>
              ))}
            </Table>
          )}
          <div className="px-5 py-3.5 text-label-sm text-outline">Showing {rows.length} of {all.length} requests</div>
        </Card>

        {selected && <Detail key={selected.id} r={selected} canWork={isLab} onDone={q.reload} onClose={() => setSel(null)} />}
      </Async>
    </>
  )
}

function Detail({ r, canWork, onDone, onClose }: { r: Req; canWork: boolean; onDone: () => void; onClose: () => void }) {
  const { busy, run } = useAction()
  const res = many(r.result)[0]
  const [specimen, setSpecimen] = useState(r.specimen_type ?? r.service?.specimen_type ?? 'Blood')
  const [result, setResult] = useState(res?.result ?? '')
  const [range, setRange] = useState(res?.reference_range ?? '')
  useEffect(() => { setResult(res?.result ?? ''); setRange(res?.reference_range ?? '') }, [res?.result, res?.reference_range])

  const collect = () => run(async () => {
    const { error } = await supabase.rpc('collect_specimen', { p_request_id: r.id, p_specimen_type: specimen })
    if (error) throw error
    onDone()
  }, 'Specimen recorded')
  const save = () => run(async () => {
    if (!result.trim()) throw new Error('Enter the result first')
    const { error } = await supabase.rpc('enter_lab_result', { p_request_id: r.id, p_result: result.trim(), p_reference_range: range.trim() || null })
    if (error) throw error
    onDone()
  }, 'Result saved')
  const finalise = () => run(async () => {
    if (!result.trim()) throw new Error('Enter the result first')
    // save any edit first so the finalised value is what is on screen
    if (r.status === 'collected' || result !== res?.result || range !== (res?.reference_range ?? '')) {
      const { error: e0 } = await supabase.rpc('enter_lab_result', { p_request_id: r.id, p_result: result.trim(), p_reference_range: range.trim() || null })
      if (e0) throw e0
    }
    const { error } = await supabase.rpc('finalize_lab_result', { p_request_id: r.id })
    if (error) throw error
    onDone()
  }, 'Result finalised and sent to the doctor')

  return (
    <Card className="p-6 space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-headline-md">{r.service?.name}</h2>
          <p className="text-body-sm text-on-surface-variant flex items-center gap-2 flex-wrap">
            <Link href={`/patients/${r.patient_id}`} className="font-medium text-on-surface hover:underline">{r.patient?.full_name}</Link><span>•</span><span>{r.patient?.patient_code}</span>
            <span>•</span><span>{orderId(r.id)}</span><span>•</span><span>Requested by {r.requester?.full_name ?? '—'}</span>
          </p>
        </div>
        <div className="flex items-center gap-2"><StatusPill status={r.status} /><button type="button" onClick={onClose} aria-label="Close details" className="p-1 rounded hover:bg-surface-container-low"><Icon name="close" /></button></div>
      </div>

      <div className="grid grid-cols-2 gap-4 max-w-md">
        <div><span className="block text-label-xs text-outline uppercase">Specimen type</span><span className="inline-flex items-center gap-1.5 text-body-md">{r.specimen_type ?? r.service?.specimen_type ?? '—'}</span></div>
        <div><span className="block text-label-xs text-outline uppercase">Collected at</span><span className="text-body-md">{r.collected_at ? fmtDateTime(r.collected_at) : 'Not collected yet'}</span></div>
      </div>

      {r.status === 'requested' && (
        canWork ? (
          <div className="rounded-lg bg-surface-container-low p-4 space-y-3 max-w-md">
            <Field label="Specimen collected"><Select value={specimen} onChange={(e) => setSpecimen(e.target.value)}>{Array.from(new Set([specimen, ...SPECIMENS])).map((s) => <option key={s}>{s}</option>)}</Select></Field>
            <Button busy={busy} onClick={() => void collect()}>Collect specimen</Button>
          </div>
        ) : <p className="text-body-sm text-outline">Waiting for the laboratory to collect the specimen.</p>
      )}

      {r.status !== 'requested' && (
        <div className="space-y-3">
          <h3 className="text-label-sm text-outline uppercase">Result</h3>
          {canWork && r.status !== 'finalized' ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="Result"><Textarea rows={2} value={result} onChange={(e) => setResult(e.target.value)} placeholder="e.g. Hb 9.4 g/dL, WBC 14.2 x10⁹/L" /></Field>
              <Field label="Reference range"><Input value={range} onChange={(e) => setRange(e.target.value)} placeholder="e.g. Hb 12.0 - 15.5 g/dL" /></Field>
            </div>
          ) : res ? (
            <div className="rounded-lg bg-surface-container-low p-4 space-y-1">
              <p><span className="text-outline text-label-sm">Result: </span><span className="font-medium">{res.result}</span></p>
              {res.reference_range && <p className="text-body-sm text-on-surface-variant">Reference range: {res.reference_range}</p>}
              {res.finalized_at && <p className="text-label-xs text-outline">Finalised {fmtDateTime(res.finalized_at)}</p>}
            </div>
          ) : <p className="text-body-sm text-outline">The result has not been finalised yet, so it is not visible to your role.</p>}
          {canWork && r.status !== 'finalized' && (
            <div className="flex gap-2 flex-wrap">
              <Button variant="secondary" busy={busy} onClick={() => void save()}>Save Result</Button>
              <Button busy={busy} onClick={() => void finalise()}>Finalise and Send to Doctor</Button>
            </div>
          )}
        </div>
      )}
    </Card>
  )
}
