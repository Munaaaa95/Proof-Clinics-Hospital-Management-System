'use client'
import Link from 'next/link'
import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { ok, useQuery } from '@/lib/hooks'
import { fmtDateTime, lagosToday, TZ } from '@/lib/format'
import { isAdmin } from '@/lib/roles'
import { Async, Button, Card, EmptyState, LiveBadge, PageHeader, Pill, StatTile, Table, Tabs, Td, Th, Tr, useAction, useToast, type Tone } from '@/components/ui'

interface Reminder {
  id: string; kind: 'appointment' | 'medication' | 'anc_follow_up'; patient_id: string; due_at: string; message: string; channel: string; sent_at: string
  patient: { full_name: string; patient_code: string } | null
}
const KIND: Record<Reminder['kind'], { label: string; tone: Tone }> = {
  appointment: { label: 'Appointment', tone: 'info' },
  medication: { label: 'Medication', tone: 'warn' },
  anc_follow_up: { label: 'ANC follow-up', tone: 'success' },
}
const isToday = (v: string) => new Date(v).toLocaleDateString('en-CA', { timeZone: TZ }) === lagosToday()

// Spec 12 and 25: reminders for appointments, home medication and antenatal follow-ups. For the demo they are delivered
// to this log (and as in-app notifications); real SMS or WhatsApp is on the roadmap. Only instructions a clinician
// already prescribed or booked are sent.
export default function RemindersPage() {
  const { staff } = useAuth()
  const toast = useToast()
  const { busy, run } = useAction()
  const [tab, setTab] = useState<'all' | Reminder['kind']>('all')

  const q = useQuery<Reminder[]>(async () => ok(await supabase.from('reminders')
    .select('id, kind, patient_id, due_at, message, channel, sent_at, patient:patients(full_name, patient_code)')
    .order('sent_at', { ascending: false }).limit(300) as never), [], ['reminders'])

  const all = q.data ?? []
  const today = all.filter((r) => isToday(r.sent_at))
  const count = (k: Reminder['kind']) => all.filter((r) => r.kind === k).length
  const rows = all.filter((r) => tab === 'all' || r.kind === tab)

  const runNow = () => run(async () => {
    const { data, error } = await supabase.rpc('run_reminders')
    if (error) throw error
    const r = data as { appointments: number; medication: number; anc_follow_ups: number }
    const n = r.appointments + r.medication + r.anc_follow_ups
    toast(n === 0 ? 'Nothing was due, so no new reminders were sent.' : `${n} new reminder${n === 1 ? '' : 's'} sent (${r.appointments} appointment, ${r.medication} medication, ${r.anc_follow_ups} antenatal).`)
    q.reload()
  })

  return (
    <>
      <PageHeader title="Reminders" badge={<LiveBadge />} subtitle="Reminders sent for appointments, home medication and antenatal follow-ups. The scheduler runs every five minutes."
        actions={isAdmin(staff?.role) ? <Button busy={busy} onClick={() => void runNow()}>Run scheduler now</Button> : undefined} />
      <Async q={q}>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
          <StatTile label="Sent today" value={today.length} />
          <StatTile label="Appointment" value={count('appointment')} hint="all time" />
          <StatTile label="Medication" value={count('medication')} hint="all time" />
          <StatTile label="ANC follow-up" value={count('anc_follow_up')} hint="all time" />
        </div>

        <Card className="overflow-hidden">
          <div className="px-5 pt-4">
            <Tabs value={tab} onChange={setTab} tabs={[{ id: 'all', label: 'All', count: all.length }, { id: 'appointment', label: 'Appointments', count: count('appointment') },
              { id: 'medication', label: 'Medication', count: count('medication') }, { id: 'anc_follow_up', label: 'Antenatal', count: count('anc_follow_up') }]} />
          </div>
          {rows.length === 0 ? <EmptyState title="No reminders yet" hint="Reminders appear when an appointment is booked for the next 24 hours, a home prescription has been dispensed, or an antenatal follow-up is due tomorrow." /> : (
            <Table head={<><Th>Sent</Th><Th>Patient</Th><Th>Type</Th><Th>Message</Th><Th>Due</Th><Th>Channel</Th></>}>
              {rows.map((r) => (
                <Tr key={r.id}>
                  <Td className="whitespace-nowrap">{fmtDateTime(r.sent_at)}</Td>
                  <Td><Link href={`/patients/${r.patient_id}`} className="font-medium hover:underline">{r.patient?.full_name}</Link><div className="text-label-xs text-outline font-mono">{r.patient?.patient_code}</div></Td>
                  <Td><Pill tone={KIND[r.kind].tone}>{KIND[r.kind].label}</Pill></Td>
                  <Td className="max-w-md">{r.message}</Td>
                  <Td className="whitespace-nowrap">{fmtDateTime(r.due_at)}</Td>
                  <Td>{r.channel === 'log' ? 'Log' : r.channel}</Td>
                </Tr>
              ))}
            </Table>
          )}
          <p className="px-5 py-4 text-label-xs text-outline">Reminders only repeat instructions a clinician has already prescribed or booked. Real SMS and WhatsApp delivery is planned for a later phase.</p>
        </Card>
      </Async>
    </>
  )
}
