'use client'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { ok, useQuery } from '@/lib/hooks'
import { fmtDate, fmtDateTime, fmtTime, naira, titleCase } from '@/lib/format'
import { Async, Button, Card, EmptyState, Field, Icon, Input, LiveBadge, PageHeader, SearchBox, StatusPill, Table, Tabs, Td, Th, Tr, cx, titleCaseVisit, useAction } from '@/components/ui'

interface Bill {
  id: string; patient_id: string; visit_id: string; payment_source: string | null; created_at: string
  patient: { full_name: string; patient_code: string } | null
  visit: { visit_type: string; department: string; doctor: { full_name: string } | null } | null
  items: { id: string; category: string; description: string; quantity: number; unit_price: number }[]
  payments: { id: string; amount: number; source: string; reference: string | null; paid_at: string }[]
}
const totals = (b: Bill) => {
  const billed = b.items.reduce((n, i) => n + Number(i.quantity) * Number(i.unit_price), 0)
  const paid = b.payments.reduce((n, p) => n + Number(p.amount), 0)
  const status = billed === 0 ? 'no_charges' : paid === 0 ? 'unpaid' : paid < billed ? 'partial' : 'paid'
  return { billed, paid, balance: billed - paid, status }
}
const invoiceNo = (id: string) => `INV-${id.slice(0, 5).toUpperCase()}`
const SOURCES = [{ v: 'patient', l: 'Patient', i: 'person' }, { v: 'hmo', l: 'HMO', i: 'assignment_turned_in' }, { v: 'government', l: 'Government', i: 'account_balance' }, { v: 'other', l: 'Other', i: 'more_horiz' }]

export default function BillingPage() {
  const { staff } = useAuth()
  // Row-level security closes the bills tables to receptionists; they only see payment status on discharged patients.
  if (staff?.role === 'receptionist') return <ReceptionView />
  return <Invoices />
}

function Invoices() {
  const [tab, setTab] = useState<'all' | 'unpaid' | 'partial' | 'paid'>('all')
  const [filter, setFilter] = useState('')
  const [sel, setSel] = useState<string | null>(null)

  const q = useQuery<Bill[]>(async () => ok(await supabase.from('bills')
    .select('id, patient_id, visit_id, payment_source, created_at, patient:patients(full_name, patient_code), visit:visits(visit_type, department, doctor:staff!visits_doctor_id_fkey(full_name)), items:bill_items(id, category, description, quantity, unit_price), payments(id, amount, source, reference, paid_at)')
    .order('created_at', { ascending: false }).limit(300) as never), [], ['bills', 'bill_items', 'payments'])

  const all = q.data ?? []
  const withT = all.map((b) => ({ b, t: totals(b) }))
  const n = (s: string) => withT.filter((x) => x.t.status === s).length
  const rows = withT.filter(({ b, t }) => {
    if (tab !== 'all' && t.status !== tab) return false
    const f = filter.trim().toLowerCase()
    return !f || b.patient?.patient_code.toLowerCase().includes(f) || b.patient?.full_name.toLowerCase().includes(f) || invoiceNo(b.id).toLowerCase().includes(f)
  })
  const current = withT.find((x) => x.b.id === sel) ?? rows[0] ?? null

  return (
    <>
      <PageHeader title="Billing" badge={<LiveBadge text="LIVE" />} subtitle="Invoices are created automatically from consultations, lab tests, drugs and bed stays."
        actions={<SearchBox value={filter} onChange={setFilter} placeholder="Filter invoice or Patient ID..." className="w-64" />} />
      <Async q={q}>
        <Tabs value={tab} onChange={setTab} tabs={[{ id: 'all', label: 'All Invoices', count: all.length }, { id: 'unpaid', label: 'Unpaid', count: n('unpaid') }, { id: 'partial', label: 'Part paid', count: n('partial') }, { id: 'paid', label: 'Paid', count: n('paid') }]} />
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 items-start">
          <Card className="overflow-hidden xl:col-span-1">
            {rows.length === 0 ? <EmptyState title="No invoices here" /> : (
              <ul className="divide-y divide-outline-variant/20 max-h-[70vh] overflow-y-auto">
                {rows.map(({ b, t }) => (
                  <li key={b.id}>
                    <button type="button" onClick={() => setSel(b.id)} className={cx('w-full text-left px-4 py-3 hover:bg-surface-container-low flex items-center justify-between gap-2', current?.b.id === b.id && 'bg-primary-fixed/40')}>
                      <span><span className="block font-medium">{b.patient?.full_name}</span><span className="block text-label-xs text-outline">{invoiceNo(b.id)} • {b.patient?.patient_code} • {fmtDate(b.created_at)}</span></span>
                      <span className="text-right"><span className="block font-medium">{naira(t.billed)}</span><StatusPill status={t.status} /></span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <div className="xl:col-span-2 space-y-6">
            {current ? <InvoiceDetail key={current.b.id} b={current.b} onChange={q.reload} /> : <Card><EmptyState title="Select an invoice" /></Card>}
          </div>
        </div>
      </Async>
    </>
  )
}

function InvoiceDetail({ b, onChange }: { b: Bill; onChange: () => void }) {
  const { staff } = useAuth()
  const { busy, run } = useAction()
  const t = totals(b)
  const [paying, setPaying] = useState(false)
  const [source, setSource] = useState(b.payment_source ?? 'patient')
  const [reference, setReference] = useState('')
  const [amount, setAmount] = useState('')
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => { setAmount(t.balance > 0 ? String(t.balance) : '') }, [t.balance])

  async function pay() {
    const amt = Number(amount)
    if (!amt || amt <= 0) return setErr('Enter an amount above zero')
    if (amt > t.balance + 0.001) return setErr(`The amount is more than the balance (${naira(t.balance)})`)
    setErr(null)
    const r = await run(async () => {
      const { error } = await supabase.from('payments').insert({ bill_id: b.id, patient_id: b.patient_id, amount: amt, source, reference: reference.trim() || null, recorded_by: staff!.id })
      if (error) throw error
      if (!b.payment_source) await supabase.from('bills').update({ payment_source: source }).eq('id', b.id)
      return true
    }, `Payment of ${naira(amt)} recorded`)
    if (r) { setPaying(false); setReference(''); onChange() }
  }

  return (
    <>
      <Card className="p-6 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3"><h2 className="text-headline-md">{invoiceNo(b.id)}</h2><StatusPill status={t.status} /></div>
          <div className="flex items-center gap-2"><span className="text-label-xs text-outline">Created {fmtDateTime(b.created_at)}</span>
            {t.balance > 0 && <Button onClick={() => setPaying(true)}>Record Payment</Button>}</div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-body-sm">
          <div><span className="block text-label-xs text-outline uppercase">Patient</span><Link href={`/patients/${b.patient_id}`} className="font-medium hover:underline">{b.patient?.full_name}</Link><div className="text-outline">{b.patient?.patient_code}</div></div>
          <div><span className="block text-label-xs text-outline uppercase">Encounter</span><span className="font-medium">{titleCaseVisit(b.visit?.visit_type ?? '')} visit</span><div className="text-outline">{b.visit?.department}</div></div>
          <div><span className="block text-label-xs text-outline uppercase">Attending clinician</span><span className="font-medium">{b.visit?.doctor?.full_name ?? '—'}</span></div>
        </div>
        <div>
          <div className="flex items-center justify-between mb-2"><h3 className="text-headline-sm">Billable Service Items</h3><span className="text-label-sm text-outline">{b.items.length} item{b.items.length === 1 ? '' : 's'}</span></div>
          {b.items.length === 0 ? <EmptyState title="No charges yet" /> : (
            <Table head={<><Th>Item</Th><Th>Qty</Th><Th>Unit Price</Th><Th className="text-right">Net Total</Th></>}>
              {b.items.map((i) => <Tr key={i.id}><Td><div className="font-medium">{i.description}</div><div className="text-label-xs text-outline">{titleCase(i.category)}</div></Td><Td>{Number(i.quantity)}</Td><Td>{naira(i.unit_price)}</Td><Td className="text-right font-medium">{naira(Number(i.quantity) * Number(i.unit_price))}</Td></Tr>)}
            </Table>
          )}
        </div>
        <dl className="ml-auto max-w-xs space-y-1 text-body-md">
          <div className="flex justify-between"><dt className="text-on-surface-variant">Total Billed</dt><dd className="font-semibold">{naira(t.billed)}</dd></div>
          <div className="flex justify-between"><dt className="text-on-surface-variant">Total Paid</dt><dd className="font-semibold text-tertiary">{naira(t.paid)}</dd></div>
          <div className="flex justify-between border-t border-outline-variant/30 pt-1"><dt className="font-medium">Balance</dt><dd className={cx('font-bold', t.balance > 0 && 'text-error')}>{naira(t.balance)}</dd></div>
          <div className="flex justify-between text-body-sm"><dt className="text-on-surface-variant">Payment source</dt><dd>{b.payment_source ? titleCase(b.payment_source).replace('Hmo', 'HMO') : '—'}</dd></div>
        </dl>
        {b.payments.length > 0 && (
          <div><h3 className="text-headline-sm mb-2">Payments</h3>
            <ul className="space-y-1 text-body-sm">{b.payments.map((p) => <li key={p.id} className="flex justify-between rounded-lg bg-surface-container-low px-3 py-2"><span>{fmtDate(p.paid_at)} {fmtTime(p.paid_at)} • {p.source === 'hmo' ? 'HMO' : titleCase(p.source)}{p.reference ? ` • ${p.reference}` : ''}</span><span className="font-medium">{naira(p.amount)}</span></li>)}</ul></div>
        )}
      </Card>

      {paying && (
        <Card className="p-6 space-y-4">
          <div className="flex items-center justify-between"><h2 className="text-headline-md flex items-center gap-2">Record Payment</h2><button type="button" onClick={() => setPaying(false)} aria-label="Close" className="p-1 rounded hover:bg-surface-container-low"><Icon name="close" /></button></div>
          <div className="rounded-lg bg-surface-container-low p-3 flex justify-between"><span className="text-on-surface-variant">Balance Outstanding</span><span className="text-headline-sm font-bold">{naira(t.balance)}</span></div>
          <div><span className="block text-label-sm font-medium mb-1.5">Payment Source</span>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {SOURCES.map((s) => <button key={s.v} type="button" onClick={() => setSource(s.v)} className={cx('h-10 rounded-lg text-body-sm border', source === s.v ? 'border-primary bg-primary-fixed/40 text-primary font-medium' : 'border-outline-variant/50 hover:bg-surface-container-low')}>{s.l}</button>)}
            </div></div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Reference (optional)"><Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="e.g. REF-0001" /></Field>
            <Field label="Amount (₦)"><Input type="number" min={0} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
          </div>
          {err && <p className="text-body-sm text-error" role="alert">{err}</p>}
          <div className="flex items-center justify-between"><span className="text-label-xs text-outline flex items-center gap-1">Every payment is written to the audit log</span>
            <div className="flex gap-2"><Button variant="secondary" onClick={() => setPaying(false)}>Cancel</Button><Button busy={busy} onClick={() => void pay()}>Record Payment</Button></div></div>
        </Card>
      )}
    </>
  )
}

function ReceptionView() {
  const q = useQuery(async () => ok(await supabase.from('dash_discharged').select('visit_id, patient_id, patient_code, patient_name, discharged_at, payment_source, payment_status').order('discharged_at', { ascending: false }).limit(100) as never) as {
    visit_id: string; patient_id: string; patient_code: string; patient_name: string; discharged_at: string; payment_source: string | null; payment_status: string | null }[], [], ['bills', 'payments', 'visits'])
  return (
    <>
      <PageHeader title="Billing" subtitle="Payment status of completed visits. Invoices and payments are handled by the billing officer." />
      <Async q={q} isEmpty={(q.data ?? []).length === 0} empty={<Card><EmptyState title="No completed visits yet" /></Card>}>
        <Card className="overflow-hidden">
          <Table head={<><Th>Patient</Th><Th>Completed</Th><Th>Payment source</Th><Th>Payment status</Th></>}>
            {q.data?.map((r) => <Tr key={r.visit_id}><Td><Link href={`/patients/${r.patient_id}`} className="font-medium hover:underline">{r.patient_name}</Link><div className="text-label-xs text-outline">{r.patient_code}</div></Td><Td>{fmtDateTime(r.discharged_at)}</Td><Td>{r.payment_source ? (r.payment_source === 'hmo' ? 'HMO' : titleCase(r.payment_source)) : '—'}</Td><Td>{r.payment_status ? <StatusPill status={r.payment_status} /> : '—'}</Td></Tr>)}
          </Table>
        </Card>
      </Async>
    </>
  )
}
