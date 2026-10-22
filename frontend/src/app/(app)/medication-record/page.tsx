'use client'
import Link from 'next/link'
import { Suspense, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { ok, useQuery } from '@/lib/hooks'
import { ageOf, fmtTime, lagosToday, titleCase } from '@/lib/format'
import { Async, Button, Card, EmptyState, Field, LiveBadge, LoadingBlock, Modal, PageHeader, SearchBox, StatTile, StatusPill, Table, Tabs, Td, Textarea, Th, Tr, useAction } from '@/components/ui'

interface Mar {
  id: string; status: string; scheduled_for: string; administered_at: string | null; notes: string | null; admission_id: string
  patient: { id: string; full_name: string; patient_code: string; dob: string; sex: string } | null
  rx: { dose: string; route: string; frequency: string; drug: { name: string; unit: string } | null; doctor: { full_name: string } | null } | null
  admission: { bed: { bed_number: string; ward: { name: string } | null } | null } | null
  nurse: { full_name: string } | null
}

export default function MedicationRecordPage() {
  return <Suspense fallback={<LoadingBlock />}><Inner /></Suspense>
}

function Inner() {
  const { staff } = useAuth()
  const only = useSearchParams().get('admission')
  const [day, setDay] = useState(lagosToday())
  const [ward, setWard] = useState('all')
  const [tab, setTab] = useState<'all' | 'pending' | 'given' | 'exceptions'>('all')
  const [filter, setFilter] = useState('')
  const [note, setNote] = useState<{ mar: Mar; status: 'held' | 'refused' | 'missed' } | null>(null)
  const { busy, run } = useAction()
  const isNurse = staff?.role === 'nurse'

  const q = useQuery<Mar[]>(async () => {
    let qb = supabase.from('medication_administrations')
      .select('id, status, scheduled_for, administered_at, notes, admission_id, patient:patients(id, full_name, patient_code, dob, sex), rx:prescriptions(dose, route, frequency, drug:drugs(name, unit), doctor:staff!prescriptions_prescribed_by_fkey(full_name)), admission:admissions(bed:beds(bed_number, ward:wards(name))), nurse:staff!medication_administrations_administered_by_fkey(full_name)')
      .order('scheduled_for')
    if (only) qb = qb.eq('admission_id', only)
    else qb = qb.gte('scheduled_for', `${day}T00:00:00+01:00`).lt('scheduled_for', `${nextDay(day)}T00:00:00+01:00`)
    return ok(await qb as never)
  }, [day, only], ['medication_administrations', 'prescriptions'])

  const all = q.data ?? []
  const wards = Array.from(new Set(all.map((m) => m.admission?.bed?.ward?.name).filter(Boolean))) as string[]
  const inWard = all.filter((m) => ward === 'all' || m.admission?.bed?.ward?.name === ward)
  const given = inWard.filter((m) => m.status === 'given').length
  const pending = inWard.filter((m) => m.status === 'pending').length
  const exceptions = inWard.filter((m) => ['missed', 'refused', 'held'].includes(m.status)).length
  const rows = inWard.filter((m) => {
    if (tab === 'pending' && m.status !== 'pending') return false
    if (tab === 'given' && m.status !== 'given') return false
    if (tab === 'exceptions' && !['missed', 'refused', 'held'].includes(m.status)) return false
    const t = filter.trim().toLowerCase()
    return !t || m.patient?.full_name.toLowerCase().includes(t) || (m.rx?.drug?.name ?? '').toLowerCase().includes(t)
  })

  const record = (m: Mar, status: string, notes: string | null) => run(async () => {
    const { error } = await supabase.rpc('record_medication', { p_mar_id: m.id, p_status: status, p_notes: notes })
    if (error) throw error
    q.reload()
  }, `Dose recorded as ${status}`)

  return (
    <>
      <PageHeader title="Medication Administration Record (MAR)" badge={<LiveBadge text="LIVE" />}
        subtitle={only ? 'Showing one admission.' : undefined}
        actions={<>
          {only ? <Link href="/medication-record"><Button variant="secondary">Show all patients</Button></Link> : (
            <div className="flex items-center gap-1 h-9 px-2 rounded-lg bg-surface-container-lowest shadow-sm">

              <input type="date" value={day} onChange={(e) => e.target.value && setDay(e.target.value)} aria-label="Date" className="text-body-sm bg-transparent focus:outline-none" />
            </div>
          )}
          <div className="flex items-center gap-1 h-9 px-2 rounded-lg bg-surface-container-lowest shadow-sm">

            <select value={ward} onChange={(e) => setWard(e.target.value)} aria-label="Ward" className="text-body-sm bg-transparent focus:outline-none">
              <option value="all">All wards</option>{wards.map((w) => <option key={w}>{w}</option>)}
            </select>
          </div>
        </>} />

      <Async q={q}>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
          <StatTile label="Scheduled Doses" value={inWard.length} hint="doses" />
          <StatTile label="Administered / Given" value={given} hint={`/ ${inWard.length}`} />
          <StatTile label="Pending" value={pending} hint="still pending" />
          <StatTile label="Missed / Refused / Held" value={exceptions} hint="have a note" />
        </div>

        <Card className="overflow-hidden">
          <div className="px-5 py-4 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
            <Tabs value={tab} onChange={setTab} tabs={[{ id: 'all', label: `All Doses (${inWard.length})` }, { id: 'pending', label: `Pending (${pending})` }, { id: 'given', label: `Given (${given})` }, { id: 'exceptions', label: `Exceptions (${exceptions})` }]} />
            <SearchBox value={filter} onChange={setFilter} placeholder="Filter patient or drug name..." className="w-64" />
          </div>
          {rows.length === 0 ? <EmptyState title="No doses to show" hint="Doses appear when a doctor prescribes medication for an admitted patient." /> : (
            <Table head={<><Th>Bed &amp; Patient Record</Th><Th>Medication &amp; Regimen</Th><Th>Scheduled</Th><Th>Prescriber</Th><Th>Administration Status</Th><Th>Action</Th></>}>
              {rows.map((m) => (
                <Tr key={m.id}>
                  <Td>
                    <div className="flex items-center gap-3">
                      <span className="w-9 h-9 rounded-lg bg-primary-fixed text-on-primary-fixed-variant flex items-center justify-center text-label-sm font-semibold">{m.admission?.bed?.bed_number}</span>
                      <div><Link href={`/patients/${m.patient?.id}`} className="font-medium hover:underline">{m.patient?.full_name}</Link>
                        <div className="text-label-xs text-outline">{ageOf(m.patient?.dob)} yrs • {titleCase(m.patient?.sex)} • {m.patient?.patient_code}</div></div>
                    </div>
                  </Td>
                  <Td><div className="font-medium">{m.rx?.drug?.name}</div><div className="text-label-xs text-outline">{m.rx?.dose} • {m.rx?.frequency} • {m.rx?.route}</div></Td>
                  <Td><div className="font-medium">{fmtTime(m.scheduled_for)}</div>{m.administered_at && <div className="text-label-xs text-outline">Recorded {fmtTime(m.administered_at)}</div>}</Td>
                  <Td>{m.rx?.doctor?.full_name}</Td>
                  <Td>
                    <StatusPill status={m.status} />
                    {m.status === 'given' && m.nurse && <div className="text-label-xs text-outline mt-1">By {m.nurse.full_name}</div>}
                    {m.notes && m.status !== 'given' && <div className="text-label-xs text-on-surface-variant mt-1">Note: {m.notes}</div>}
                  </Td>
                  <Td>
                    {m.status === 'pending' ? (isNurse ? (
                      <div className="flex flex-wrap gap-1.5">
                        <Button small busy={busy} onClick={() => void record(m, 'given', null)}>Given</Button>
                        <Button small variant="secondary" onClick={() => setNote({ mar: m, status: 'held' })}>Held</Button>
                        <Button small variant="secondary" onClick={() => setNote({ mar: m, status: 'refused' })}>Refused</Button>
                        <Button small variant="secondary" onClick={() => setNote({ mar: m, status: 'missed' })}>Missed</Button>
                      </div>
                    ) : <span className="text-outline text-label-xs">Nurses record doses</span>) : <span className="inline-flex items-center gap-1 text-tertiary text-label-sm">Recorded</span>}
                  </Td>
                </Tr>
              ))}
            </Table>
          )}
          <div className="px-5 py-3.5 text-label-sm text-outline">Showing {rows.length} of {inWard.length} scheduled medications{ward !== 'all' ? ` for ${ward}` : ''}</div>
        </Card>
      </Async>

      <NoteModal ctx={note} busy={busy} onClose={() => setNote(null)} onSave={async (n) => { if (note) { await record(note.mar, note.status, n); setNote(null) } }} />
    </>
  )
}

const nextDay = (d: string) => { const t = new Date(`${d}T12:00:00Z`); t.setUTCDate(t.getUTCDate() + 1); return t.toISOString().slice(0, 10) }

// A note is required for every status except Given (record_medication enforces it too).
function NoteModal({ ctx, busy, onClose, onSave }: { ctx: { mar: Mar; status: string } | null; busy: boolean; onClose: () => void; onSave: (note: string) => Promise<void> }) {
  const [text, setText] = useState('')
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => { setText(''); setErr(null) }, [ctx?.mar.id, ctx?.status])
  return (
    <Modal open={!!ctx} onClose={onClose} title={`Mark dose as ${ctx?.status}`}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button busy={busy} onClick={() => { if (!text.trim()) return setErr('A note is required'); void onSave(text.trim()) }}>Save</Button></>}>
      <p className="text-body-sm text-on-surface-variant">{ctx?.mar.patient?.full_name} — {ctx?.mar.rx?.drug?.name}, {ctx?.mar.rx?.dose}</p>
      <Field label="Note *" error={err}><Textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder={ctx?.status === 'held' ? 'Why was the dose held?' : ctx?.status === 'refused' ? 'Why did the patient refuse?' : 'Why was the dose missed?'} /></Field>
    </Modal>
  )
}
