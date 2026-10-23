'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { ok, useQuery } from '@/lib/hooks'
import { ageSex, fmtDate, fmtDateTime, naira, titleCase } from '@/lib/format'
import { Async, Button, Card, Drawer, EmptyState, Field, Input, Modal, PageHeader, SearchBox, Select, StatTile, StatusPill, Table, Td, Th, Tr, useAction, useToast } from '@/components/ui'

interface Stock { drug_id: string; name: string; unit: string; min_stock: number; quantity: number; nearest_expiry: string | null; stock_status: string; expiring_soon: boolean | null }
interface Batch { id: string; drug_id: string; batch_number: string | null; expiry_date: string; quantity: number }
interface Rx {
  id: string; dose: string; route: string; frequency: string; duration_days: number | null; quantity: number; prescribed_at: string; admission_id: string | null
  drug: { id: string; name: string; unit: string; unit_price: number } | null
  patient: { full_name: string; patient_code: string; dob: string; sex: string } | null
  doctor: { full_name: string } | null
}

export default function PharmacyPage() {
  const { staff } = useAuth()
  const canAct = staff?.role === 'pharmacist'
  const [filter, setFilter] = useState('')
  const [receive, setReceive] = useState<string | null | undefined>(undefined) // undefined = closed, null = open with no drug chosen
  const [dispense, setDispense] = useState<Rx | null>(null)
  const [history, setHistory] = useState<Stock | null>(null)

  const q = useQuery(async () => {
    const [stock, batches, rx] = await Promise.all([
      supabase.from('drug_stock_status').select('*').order('name'),
      supabase.from('stock_batches').select('id, drug_id, batch_number, expiry_date, quantity').gt('quantity', 0).order('expiry_date'),
      supabase.from('prescriptions')
        .select('id, dose, route, frequency, duration_days, quantity, prescribed_at, admission_id, drug:drugs(id, name, unit, unit_price), patient:patients(full_name, patient_code, dob, sex), doctor:staff!prescriptions_prescribed_by_fkey(full_name)')
        .eq('status', 'prescribed').order('prescribed_at'),
    ])
    return { stock: ok(stock as never) as Stock[], batches: ok(batches as never) as Batch[], rx: ok(rx as never) as Rx[] }
  }, [], ['stock_batches', 'prescriptions'])

  const d = q.data
  const today = new Date().toISOString().slice(0, 10)
  const nearestBatch = (id: string) => d?.batches.filter((b) => b.drug_id === id && b.expiry_date > today)[0]
  const stock = (d?.stock ?? []).filter((s) => {
    const t = filter.trim().toLowerCase()
    return !t || s.name.toLowerCase().includes(t) || d?.batches.some((b) => b.drug_id === s.drug_id && (b.batch_number ?? '').toLowerCase().includes(t))
  })
  const low = (d?.stock ?? []).filter((s) => s.stock_status !== 'ok').length
  const expiring = (d?.stock ?? []).filter((s) => s.expiring_soon).length

  return (
    <>
      <PageHeader title="Pharmacy & Drug Inventory" subtitle="Stock levels, batches and prescriptions waiting to be dispensed"
        actions={<><SearchBox value={filter} onChange={setFilter} placeholder="Search drug or batch..." className="w-64" />
          {canAct && <Button onClick={() => setReceive(null)}>Receive Stock</Button>}</>} />
      <Async q={q}>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <StatTile icon="inventory_2" label="Drugs" value={d?.stock.length ?? 0} />
          <StatTile label="Low Stock" value={low} hint="At or below minimum stock" />
          <StatTile label="Expiring in 90 Days" value={expiring} hint="Earliest expiry is dispensed first" />
        </div>

        <Card className="overflow-hidden">
          <div className="px-5 py-4 flex items-center gap-2"><h2 className="text-headline-md">Stock</h2><span className="px-2 py-0.5 text-label-xs rounded-full bg-surface-container-low text-primary font-medium">Live</span></div>
          {stock.length === 0 ? <EmptyState icon="inventory_2" title="No drugs match" /> : (
            <Table head={<><Th>Drug</Th><Th>Batch</Th><Th>Quantity</Th><Th>Nearest Expiry</Th><Th>Status</Th><Th>Action</Th></>}>
              {stock.map((s) => {
                const b = nearestBatch(s.drug_id)
                const n = d!.batches.filter((x) => x.drug_id === s.drug_id && x.expiry_date > today).length
                return (
                  <Tr key={s.drug_id}>
                    <Td><div className="font-medium">{s.name}</div><div className="text-outline text-label-xs">{s.unit}</div></Td>
                    <Td>{b?.batch_number ?? '—'}{n > 1 && <span className="text-outline text-label-xs"> +{n - 1} more</span>}</Td>
                    <Td className="font-medium">{s.quantity} {s.unit}s</Td>
                    <Td>{s.nearest_expiry ? <span className={s.expiring_soon ? 'text-warn font-medium' : ''}>{fmtDate(s.nearest_expiry)}</span> : '—'}</Td>
                    <Td><div className="flex gap-1 flex-wrap"><StatusPill status={s.stock_status} />{s.expiring_soon && <StatusPill status="expiring" />}</div></Td>
                    <Td><div className="flex gap-2"><Button small variant="ghost" onClick={() => setHistory(s)}>History</Button>{canAct && s.stock_status !== 'ok' && <Button small variant="secondary" onClick={() => setReceive(s.drug_id)}>Receive Stock</Button>}</div></Td>
                  </Tr>
                )
              })}
            </Table>
          )}
          <div className="px-5 py-3.5 text-label-sm text-outline">Showing {stock.length} of {d?.stock.length ?? 0} drugs. Minimum levels come from the drug record; expired batches never count as stock.</div>
        </Card>

        <Card className="overflow-hidden">
          <div className="px-5 py-4 flex items-center gap-2"><h2 className="text-headline-md">Prescriptions to dispense: {d?.rx.length ?? 0}</h2></div>
          {(d?.rx.length ?? 0) === 0 ? <EmptyState title="Nothing waiting" hint="New prescriptions from doctors appear here live." /> : (
            <Table head={<><Th>Patient</Th><Th>Medication</Th><Th>Regimen</Th><Th>Prescribed by</Th><Th>Type</Th><Th /></>}>
              {d!.rx.map((r) => (
                <Tr key={r.id}>
                  <Td><div className="font-medium">{r.patient?.full_name}</div><div className="text-outline text-label-xs">{r.patient?.patient_code} • {ageSex(r.patient?.dob, r.patient?.sex)}</div></Td>
                  <Td className="font-medium">{r.drug?.name} <span className="text-outline font-normal">× {r.quantity}</span></Td>
                  <Td>{r.dose} {r.frequency}{r.duration_days ? ` × ${r.duration_days} days` : ''}</Td>
                  <Td>{r.doctor?.full_name}<div className="text-outline text-label-xs">{fmtDateTime(r.prescribed_at)}</div></Td>
                  <Td>{r.admission_id ? 'Inpatient' : 'Outpatient'}</Td>
                  <Td className="text-right">{canAct ? <Button small onClick={() => setDispense(r)}>Open Prescription</Button> : <span className="text-outline text-label-xs">Pharmacists dispense</span>}</Td>
                </Tr>
              ))}
            </Table>
          )}
        </Card>
      </Async>

      <HistoryDrawer drug={history} onClose={() => setHistory(null)} />
      <ReceiveModal open={receive !== undefined} drugId={receive ?? ''} drugs={d?.stock ?? []} onClose={() => setReceive(undefined)} onDone={() => { setReceive(undefined); q.reload() }} />
      <DispenseModal rx={dispense} stock={d?.stock ?? []} batch={dispense?.drug ? nearestBatch(dispense.drug.id) : undefined} onClose={() => setDispense(null)} onDone={() => { setDispense(null); q.reload() }} />
    </>
  )
}

function ReceiveModal({ open, drugId, drugs, onClose, onDone }: { open: boolean; drugId: string; drugs: Stock[]; onClose: () => void; onDone: () => void }) {
  const { busy, run } = useAction()
  const [f, setF] = useState({ drug_id: '', batch: '', expiry: '', qty: '', supplier: '' })
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => { if (open) { setF({ drug_id: drugId, batch: '', expiry: '', qty: '', supplier: '' }); setErr(null) } }, [open, drugId])
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((s) => ({ ...s, [k]: e.target.value }))
  async function save() {
    if (!f.drug_id) return setErr('Choose the drug')
    if (!f.batch.trim()) return setErr('Enter the batch number')
    if (!f.expiry) return setErr('Enter the expiry date')
    if (f.expiry <= new Date().toISOString().slice(0, 10)) return setErr('This batch is already expired')
    if (!Number(f.qty) || Number(f.qty) < 1) return setErr('Enter the quantity received')
    setErr(null)
    const r = await run(async () => {
      const { error } = await supabase.rpc('receive_stock', { p_drug_id: f.drug_id, p_batch_number: f.batch.trim(), p_expiry: f.expiry, p_quantity: Number(f.qty), p_supplier: f.supplier.trim() || null })
      if (error) throw error
      return true
    }, 'Stock received')
    if (r) onDone()
  }
  return (
    <Modal open={open} onClose={onClose} title="Receive Stock"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button busy={busy} onClick={() => void save()}>Receive</Button></>}>
      <Field label="Drug *"><Select value={f.drug_id} onChange={set('drug_id')}><option value="">Select a drug…</option>{drugs.map((d) => <option key={d.drug_id} value={d.drug_id}>{d.name}</option>)}</Select></Field>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Batch number *"><Input value={f.batch} onChange={set('batch')} placeholder="e.g. B-12345" /></Field>
        <Field label="Expiry date *"><Input type="date" value={f.expiry} onChange={set('expiry')} /></Field>
        <Field label="Quantity *"><Input type="number" min={1} value={f.qty} onChange={set('qty')} /></Field>
        <Field label="Supplier"><Input value={f.supplier} onChange={set('supplier')} /></Field>
      </div>
      {err && <p className="text-body-sm text-error" role="alert">{err}</p>}
    </Modal>
  )
}

function DispenseModal({ rx, stock, batch, onClose, onDone }: { rx: Rx | null; stock: Stock[]; batch?: Batch; onClose: () => void; onDone: () => void }) {
  const { busy, run } = useAction()
  const toast = useToast()
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => setErr(null), [rx?.id])
  const st = stock.find((s) => s.drug_id === rx?.drug?.id)
  const short = !!rx && !!st && st.quantity < rx.quantity

  async function go() {
    if (!rx?.drug) return
    setErr(null)
    try {
      const { error } = await supabase.rpc('dispense_prescription', { p_prescription_id: rx.id })
      if (error) throw error
      const { data } = await supabase.from('drug_stock_status').select('quantity, unit').eq('drug_id', rx.drug.id).single()
      toast(`Dispensed ${rx.quantity} × ${rx.drug.name}. Stock now ${data?.quantity ?? '?'} ${data?.unit ?? ''}s.`)
      onDone()
    } catch (e) {
      // show the database's own message (for example "Insufficient unexpired stock")
      setErr(e instanceof Error ? e.message : String((e as { message?: string })?.message ?? e))
    }
  }
  return (
    <Modal open={!!rx} onClose={onClose} title="Dispense Prescription"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button busy={busy} disabled={short} onClick={() => void run(go)}>Dispense</Button></>}>
      {rx && <>
        <p className="text-body-sm text-outline -mt-2">{rx.admission_id ? 'Inpatient' : 'Outpatient'} prescription</p>
        <div className="grid grid-cols-2 gap-4">
          <div><span className="block text-label-xs text-outline uppercase">Patient</span><span className="font-medium">{rx.patient?.full_name}</span><div className="text-label-xs text-outline">{rx.patient?.patient_code} • {ageSex(rx.patient?.dob, rx.patient?.sex)}</div></div>
          <div><span className="block text-label-xs text-outline uppercase">Prescribed by</span><span className="font-medium">{rx.doctor?.full_name}</span><div className="text-label-xs text-outline">{fmtDateTime(rx.prescribed_at)}</div></div>
        </div>
        <div className="rounded-lg bg-surface-container-low p-4 space-y-1">
          <span className="block text-label-xs text-outline uppercase">Prescription order</span>
          <div className="font-medium">{rx.drug?.name}</div>
          <div className="text-body-sm text-on-surface-variant">Regimen: {rx.dose} {rx.frequency}{rx.duration_days ? ` × ${rx.duration_days} days` : ''} ({rx.route})</div>
          <div className="text-body-md pt-1">Quantity: <strong>{rx.quantity} {rx.drug?.unit}s</strong></div>
        </div>
        <div className="space-y-1">
          <div className="flex items-center justify-between text-label-sm"><span className="font-medium">Stock source</span><span className="text-outline">Earliest expiry first</span></div>
          <div className="rounded-lg bg-surface-container-low px-3 py-2 text-body-sm">
            {batch ? <>Taken automatically from the batch that expires first: <strong>{batch.batch_number}</strong> ({fmtDate(batch.expiry_date)}), {batch.quantity} in stock. Total in stock: <strong>{st?.quantity ?? 0}</strong>.</> : 'No unexpired stock for this drug.'}
          </div>
          {short && <p className="text-body-sm text-error">Not enough stock: {rx.quantity} needed, {st?.quantity ?? 0} available. Receive stock first.</p>}
        </div>
        <div className="flex items-center justify-between pt-2"><span className="text-label-md">Total prescription cost</span><span className="text-headline-md">{naira(Number(rx.drug?.unit_price ?? 0) * rx.quantity)}</span></div>
        {err && <div role="alert" className="flex items-start gap-2 p-3 rounded-lg bg-error-container text-on-error-container text-body-sm">{err}</div>}
      </>}
    </Modal>
  )
}

interface Movement { id: string; change: number; reason: string; created_at: string; by: { full_name: string } | null; batch: { batch_number: string | null } | null }
interface BatchRow { id: string; batch_number: string | null; expiry_date: string; quantity: number; supplier: string | null; received_at: string }

// Spec 14: stock received, stock dispensed and the current balance, with the audit trail behind each change.
function HistoryDrawer({ drug, onClose }: { drug: Stock | null; onClose: () => void }) {
  const q = useQuery(async () => {
    if (!drug) return null
    const [mv, bt] = await Promise.all([
      supabase.from('stock_movements').select('id, change, reason, created_at, by:staff!stock_movements_created_by_fkey(full_name), batch:stock_batches(batch_number)').eq('drug_id', drug.drug_id).order('created_at', { ascending: false }).limit(200),
      supabase.from('stock_batches').select('id, batch_number, expiry_date, quantity, supplier, received_at').eq('drug_id', drug.drug_id).order('expiry_date'),
    ])
    return { movements: ok(mv as never) as Movement[], batches: ok(bt as never) as BatchRow[] }
  }, [drug?.drug_id], ['stock_batches'])
  const d = q.data
  const received = d?.movements.filter((m) => m.change > 0).reduce((n, m) => n + m.change, 0) ?? 0
  const dispensed = d?.movements.filter((m) => m.reason === 'dispensed').reduce((n, m) => n - m.change, 0) ?? 0
  // stock that was on the shelf before the ledger started (for example the demo's starting stock)
  const opening = drug ? Math.max(0, drug.quantity - received + dispensed) : 0
  const today = new Date().toISOString().slice(0, 10)
  return (
    <Drawer open={!!drug} onClose={onClose} wide title={drug ? drug.name + ': stock history' : ''}>
      <Async q={q}>
        {d && drug && (
          <div className="space-y-6">
            <div className={`grid ${opening > 0 ? 'grid-cols-4' : 'grid-cols-3'} gap-4`}>
              {[...(opening > 0 ? [['Opening stock', opening]] : []), ['Received', received], ['Dispensed', dispensed], ['Current balance', drug.quantity]].map(([l, v]) => (
                <div key={l as string} className="rounded-lg border border-outline-variant/70 p-4"><div className="text-[11px] font-medium uppercase tracking-wider text-outline">{l}</div><div className="text-[24px] font-semibold mt-1">{v} <span className="text-body-sm font-normal text-on-surface-variant">{drug.unit}s</span></div></div>
              ))}
            </div>
            <div>
              <h3 className="text-headline-sm mb-2">Batches</h3>
              <div className="-mx-6">
                <Table head={<><Th>Batch</Th><Th>Supplier</Th><Th>Received</Th><Th>Expiry</Th><Th>In stock</Th></>}>
                  {d.batches.map((b) => <Tr key={b.id}><Td className="font-medium">{b.batch_number ?? '—'}</Td><Td>{b.supplier ?? '—'}</Td><Td>{fmtDate(b.received_at)}</Td>
                    <Td>{fmtDate(b.expiry_date)}{b.expiry_date <= today && <span className="ml-2 text-error text-label-xs">Expired</span>}</Td><Td>{b.quantity}</Td></Tr>)}
                </Table>
              </div>
            </div>
            <div>
              <h3 className="text-headline-sm mb-2">Movements</h3>
              {d.movements.length === 0 ? <EmptyState title="No movements yet" /> : (
                <div className="-mx-6">
                  <Table head={<><Th>When</Th><Th>Change</Th><Th>Reason</Th><Th>Batch</Th><Th>By</Th></>}>
                    {d.movements.map((m) => <Tr key={m.id}><Td className="whitespace-nowrap">{fmtDateTime(m.created_at)}</Td><Td className={m.change > 0 ? 'font-medium text-tertiary' : 'font-medium'}>{m.change > 0 ? '+' : ''}{m.change}</Td><Td>{titleCase(m.reason)}</Td><Td>{m.batch?.batch_number ?? '—'}</Td><Td>{m.by?.full_name ?? 'System'}</Td></Tr>)}
                  </Table>
                </div>
              )}
            </div>
          </div>
        )}
      </Async>
    </Drawer>
  )
}
