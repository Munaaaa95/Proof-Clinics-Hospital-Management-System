'use client'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { ok, useQuery } from '@/lib/hooks'
import { fmtDate, fmtTime, lagosToday, TZ } from '@/lib/format'
import { NOTE_TYPES, noteIcon, noteLabel, noteLink } from '@/lib/notify'
import { Async, Button, Icon, Card, EmptyState, LiveBadge, PageHeader, Select, Tabs, cx, useAction } from '@/components/ui'

interface Note { id: string; type: string; title: string; body: string | null; patient_id: string | null; link: string | null; read_at: string | null; created_at: string }
const isToday = (v: string) => new Date(v).toLocaleDateString('en-CA', { timeZone: TZ }) === lagosToday()

export default function NotificationsPage() {
  const { staff } = useAuth()
  const router = useRouter()
  const { busy, run } = useAction()
  const [tab, setTab] = useState<'all' | 'unread'>('all')
  const [type, setType] = useState('all')

  const q = useQuery<Note[]>(async () => ok(await supabase.from('notifications').select('id, type, title, body, patient_id, link, read_at, created_at')
    .eq('recipient_staff_id', staff!.id).order('created_at', { ascending: false }).limit(200) as never), [staff?.id], ['notifications'])

  const all = q.data ?? []
  const unread = all.filter((n) => !n.read_at).length
  const types = Array.from(new Set(all.map((n) => n.type)))
  const rows = all.filter((n) => (tab === 'all' || !n.read_at) && (type === 'all' || n.type === type))
  const today = rows.filter((n) => isToday(n.created_at))
  const earlier = rows.filter((n) => !isToday(n.created_at))

  const markAll = () => run(async () => {
    const { error } = await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('recipient_staff_id', staff!.id).is('read_at', null)
    if (error) throw error
    q.reload()
  }, 'All notifications marked as read')

  async function open(n: Note) {
    if (!n.read_at) await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', n.id)
    const href = noteLink(n.link) ?? (n.patient_id ? `/patients/${n.patient_id}` : null)
    if (href) router.push(href)
    else q.reload()
  }

  const group = (title: string, list: Note[]) => list.length > 0 && (
    <div className="space-y-2">
      <h2 className="text-label-sm text-outline uppercase">{title}</h2>
      {list.map((n) => (
        <Card key={n.id} className={cx('p-4 flex gap-3 cursor-pointer hover:shadow-md transition-shadow', !n.read_at && 'ring-1 ring-primary/30')}>
          <button type="button" onClick={() => void open(n)} className="flex gap-3 w-full text-left">
            <span className={cx('w-10 h-10 rounded-lg flex items-center justify-center shrink-0', n.read_at ? 'bg-surface-container-high text-on-surface-variant' : 'bg-primary-fixed text-primary')}><Icon name={noteIcon(n.type)} className="text-[20px]" /></span>
            <span className="flex-1 min-w-0">
              <span className="flex items-center justify-between gap-2">
                <span className="flex flex-col"><span className="text-[10.5px] font-medium uppercase tracking-wider text-outline">{noteLabel(n.type)}{!n.read_at && <span className="ml-2 text-primary">New</span>}</span><span className="font-medium">{n.title}</span></span>
                <span className="text-label-xs text-outline shrink-0">{isToday(n.created_at) ? fmtTime(n.created_at) : `${fmtDate(n.created_at)}, ${fmtTime(n.created_at)}`}</span>
              </span>
              <span className="block text-body-sm text-on-surface-variant">{n.body}</span>
              {(noteLink(n.link) || n.patient_id) && <span className="text-label-sm text-primary mt-1 inline-block">Open</span>}
            </span>
          </button>
        </Card>
      ))}
    </div>
  )

  return (
    <>
      <PageHeader title="Notifications" badge={<LiveBadge text="LIVE" />} subtitle="Updates for your role, live as they happen."
        actions={<Button variant="secondary" busy={busy} disabled={unread === 0} onClick={() => void markAll()}>Mark All as Read</Button>} />
      <Async q={q}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Tabs value={tab} onChange={setTab} tabs={[{ id: 'all', label: 'All' }, { id: 'unread', label: `Unread (${unread})` }]} />
          <Select value={type} onChange={(e) => setType(e.target.value)} aria-label="Type" className="w-48"><option value="all">All types</option>{types.map((t) => <option key={t} value={t}>{NOTE_TYPES[t]?.label ?? t}</option>)}</Select>
        </div>
        {rows.length === 0 ? <Card><EmptyState title={tab === 'unread' ? 'Nothing unread' : 'No notifications yet'} hint="New patients, lab results, prescriptions and stock alerts for your role show up here." /></Card> : (
          <div className="space-y-6">{group('Today', today)}{group('Earlier', earlier)}</div>
        )}
        <p className="text-label-xs text-outline">Each role only receives its own notifications: doctors get new patients and finalised results, the lab gets new requests, pharmacy gets prescriptions to dispense, nurses get medication due and admissions, admins and pharmacists get low stock and expiry. <Link href="/dashboard" className="text-primary hover:underline">Back to the dashboard</Link></p>
      </Async>
    </>
  )
}
