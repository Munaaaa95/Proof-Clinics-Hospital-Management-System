'use client'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { ok, useDebounced, useQuery } from '@/lib/hooks'
import { fmtDate, initials, lagosToday, titleCase, TZ } from '@/lib/format'
import { ROLE_LABEL, type StaffRole } from '@/lib/roles'
import { Async, Button, Card, Drawer, EmptyState, Field, Icon, Input, LiveBadge, PageHeader, Select, StatTile, Table, Td, Th, Tr, useToast } from '@/components/ui'

interface Entry {
  id: number; at: string; actor_id: string | null; actor_name: string | null; actor_role: StaffRole | null; action: 'INSERT' | 'UPDATE' | 'DELETE'
  table_name: string; record_id: string | null; patient_id: string | null; old_data: Record<string, unknown> | null; new_data: Record<string, unknown> | null
}
const PAGE = 25
const PRETTY: Record<string, string> = { INSERT: 'Created', UPDATE: 'Updated', DELETE: 'Deleted' }
const DATE_RE = /^\d{4}-\d{2}-\d{2}/

// A one-line description of what changed.
function describe(e: Entry): string {
  const n = e.new_data ?? {}, o = e.old_data ?? {}
  if (e.table_name === 'staff_sessions') return e.action === 'INSERT' ? 'Signed in' : 'Signed out'
  if (e.action === 'UPDATE') {
    const keys = Object.keys(n).filter((k) => JSON.stringify(n[k]) !== JSON.stringify(o[k]) && !['updated_at'].includes(k))
    return keys.slice(0, 3).map((k) => `${k}: ${fmtVal(o[k])} → ${fmtVal(n[k])}`).join('; ') || 'No visible change'
  }
  const pick = (n.description ?? n.full_name ?? n.diagnosis ?? n.name ?? n.result ?? n.notes ?? n.reason ?? n.message ?? n.status ?? n.amount) as unknown
  return pick != null ? String(pick).slice(0, 80) : `${titleCase(e.table_name)} record`
}
function fmtVal(v: unknown) {
  if (v == null) return '—'
  if (typeof v === 'string' && DATE_RE.test(v)) return fmtDate(v)
  return String(v).slice(0, 30)
}
const timeParts = (iso: string) => ({
  t: new Date(iso).toLocaleTimeString('en-GB', { hour12: false, timeZone: TZ }),
  d: new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: TZ }).replace(/ /g, '-'),
})

export default function AuditLogPage() {
  const toast = useToast()
  const [from, setFrom] = useState(lagosToday())
  const [to, setTo] = useState(lagosToday())
  const [staffId, setStaffId] = useState('all')
  const [role, setRole] = useState('all')
  const [action, setAction] = useState('all')
  const [text, setText] = useState('')
  const [page, setPage] = useState(0)
  const [open, setOpen] = useState<Entry | null>(null)
  const search = useDebounced(text.trim(), 350)
  useEffect(() => setPage(0), [from, to, staffId, role, action, search])

  const staff = useQuery(async () => ok(await supabase.from('staff').select('id, full_name').order('full_name') as never) as { id: string; full_name: string }[], [])

  const q = useQuery(async () => {
    let qb = supabase.from('audit_log').select('*', { count: 'exact' })
      .gte('at', `${from}T00:00:00+01:00`).lt('at', `${nextDay(to)}T00:00:00+01:00`).order('at', { ascending: false }).order('id', { ascending: false })
    if (staffId !== 'all') qb = qb.eq('actor_id', staffId)
    if (role !== 'all') qb = qb.eq('actor_role', role)
    if (action === 'create') qb = qb.eq('action', 'INSERT').neq('table_name', 'staff_sessions')
    if (action === 'update') qb = qb.eq('action', 'UPDATE').neq('table_name', 'staff_sessions')
    if (action === 'login') qb = qb.eq('table_name', 'staff_sessions').eq('action', 'INSERT')
    if (search) {
      // a Patient ID / patient name match, or a staff name match
      const { data: pts } = await supabase.from('patients').select('id').or(`patient_code.ilike.%${search}%,full_name.ilike.%${search}%`).limit(50)
      const ids = (pts ?? []).map((p) => p.id)
      qb = ids.length ? qb.or(`actor_name.ilike.%${search}%,patient_id.in.(${ids.join(',')})`) : qb.ilike('actor_name', `%${search}%`)
    }
    const res = await qb.range(page * PAGE, page * PAGE + PAGE - 1)
    const rows = ok(res as never) as Entry[]
    const pids = Array.from(new Set(rows.map((r) => r.patient_id).filter(Boolean))) as string[]
    const pats = pids.length ? ((await supabase.from('patients').select('id, full_name, patient_code').in('id', pids)).data ?? []) : []
    const todayStart = `${lagosToday()}T00:00:00+01:00`
    const [events, logins] = await Promise.all([
      supabase.from('audit_log').select('id', { count: 'exact', head: true }).gte('at', todayStart),
      supabase.from('audit_log').select('id', { count: 'exact', head: true }).gte('at', todayStart).eq('table_name', 'staff_sessions').eq('action', 'INSERT'),
    ])
    return { rows, count: res.count ?? 0, patients: Object.fromEntries(pats.map((p) => [p.id, p])) as Record<string, { full_name: string; patient_code: string }>, eventsToday: events.count ?? 0, loginsToday: logins.count ?? 0 }
  }, [from, to, staffId, role, action, search, page], ['audit_log'])

  const d = q.data
  const pages = Math.max(1, Math.ceil((d?.count ?? 0) / PAGE))
  const filtered = from !== lagosToday() || to !== lagosToday() || staffId !== 'all' || role !== 'all' || action !== 'all' || !!text
  const reset = () => { setFrom(lagosToday()); setTo(lagosToday()); setStaffId('all'); setRole('all'); setAction('all'); setText('') }

  return (
    <>
      <PageHeader title="Audit Log" badge={<LiveLabel />} subtitle="Every create and update is recorded with who did it and when." />
      <Async q={q}>
        <div className="grid grid-cols-2 gap-6 max-w-xl">
          <StatTile label="Events today" value={d?.eventsToday ?? 0} />
          <StatTile label="Staff logins today" value={d?.loginsToday ?? 0} />
        </div>

        <Card className="p-5 space-y-4">
          <div className="grid grid-cols-2 lg:grid-cols-6 gap-3 items-end">
            <Field label="From"><Input type="date" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} /></Field>
            <Field label="To"><Input type="date" value={to} min={from} onChange={(e) => e.target.value && setTo(e.target.value)} /></Field>
            <Field label="Staff"><Select value={staffId} onChange={(e) => setStaffId(e.target.value)}><option value="all">All Staff</option>{staff.data?.map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}</Select></Field>
            <Field label="Staff role"><Select value={role} onChange={(e) => setRole(e.target.value)}><option value="all">All Roles</option>{(Object.keys(ROLE_LABEL) as StaffRole[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</Select></Field>
            <Field label="Action"><Select value={action} onChange={(e) => setAction(e.target.value)}><option value="all">All Actions</option><option value="create">Create</option><option value="update">Update</option><option value="login">Login</option></Select></Field>
            <Field label="Search logs"><div className="relative"><Icon name="search" className="absolute left-2.5 top-2 text-[18px] text-outline" /><Input className="pl-9" value={text} onChange={(e) => setText(e.target.value)} placeholder="Patient ID or staff name" /></div></Field>
          </div>
          {filtered && <div className="flex items-center gap-2 text-label-sm text-on-surface-variant"><span>Window: {fmtDate(from)}{to !== from ? ` to ${fmtDate(to)}` : ''}</span><button type="button" onClick={reset} className="text-primary hover:underline">Reset all</button></div>}
        </Card>

        <Card className="overflow-hidden">
          {(d?.rows.length ?? 0) === 0 ? <EmptyState title="No audit events match these filters" hint="Try a wider date range." /> : (
            <Table head={<><Th>Timestamp</Th><Th>Operator</Th><Th>Role</Th><Th>Action</Th><Th>Patient / Record</Th><Th>Payload</Th></>}>
              {d!.rows.map((e) => {
                const p = e.patient_id ? d!.patients[e.patient_id] : null
                const tp = timeParts(e.at)
                const login = e.table_name === 'staff_sessions'
                return (
                  <Tr key={e.id}>
                    <Td className="whitespace-nowrap"><div className="font-mono text-label-sm">{tp.t}</div><div className="text-label-xs text-outline">{tp.d}</div></Td>
                    <Td><span className="inline-flex items-center gap-2"><span className="w-7 h-7 rounded-full bg-primary-fixed text-on-primary-fixed-variant flex items-center justify-center text-label-xs">{initials(e.actor_name)}</span>{e.actor_name ?? 'System'}</span></Td>
                    <Td>{e.actor_role ? ROLE_LABEL[e.actor_role] : '—'}</Td>
                    <Td>{login ? (e.action === 'INSERT' ? 'Login' : 'Logout') : `${PRETTY[e.action]} ${e.table_name}`}</Td>
                    <Td><div className="max-w-xs truncate">{describe(e)}</div>{p && <div className="text-label-xs text-outline"><Link href={`/patients/${e.patient_id}`} className="hover:underline">{p.full_name}</Link> • {p.patient_code}</div>}</Td>
                    <Td><Button small variant="secondary" onClick={() => setOpen(e)}>Inspect</Button></Td>
                  </Tr>
                )
              })}
            </Table>
          )}
          <div className="px-5 py-3.5 flex items-center justify-between text-label-sm text-outline">
            <span>Showing {d && d.count ? page * PAGE + 1 : 0}-{Math.min((page + 1) * PAGE, d?.count ?? 0)} of {d?.count ?? 0} audit events</span>
            <div className="flex items-center gap-2"><Button small variant="secondary" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</Button><span>Page {page + 1} of {pages}</span><Button small variant="secondary" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>Next</Button></div>
          </div>
        </Card>
      </Async>

      <Drawer open={!!open} onClose={() => setOpen(null)} title={`Audit Entry #${open?.id ?? ''}`}
        footer={<><Button variant="secondary" onClick={() => { void navigator.clipboard?.writeText(JSON.stringify(open, null, 2)); toast('Payload copied') }}>Copy payload</Button><Button onClick={() => setOpen(null)}>Dismiss</Button></>}>
        <p className="text-body-sm text-on-surface-variant">Audit entry (old and new data)</p>
        <pre className="rounded-lg bg-inverse-surface text-inverse-on-surface text-label-sm p-4 overflow-x-auto whitespace-pre-wrap break-all">{JSON.stringify(open, null, 2)}</pre>
      </Drawer>
    </>
  )
}

const LiveLabel = () => <span className="inline-flex items-center gap-1 ml-2 px-2 py-0.5 rounded-full bg-tertiary-fixed text-on-tertiary-fixed-variant text-label-xs">Live</span>
const nextDay = (d: string) => { const t = new Date(`${d}T12:00:00Z`); t.setUTCDate(t.getUTCDate() + 1); return t.toISOString().slice(0, 10) }
void LiveBadge
