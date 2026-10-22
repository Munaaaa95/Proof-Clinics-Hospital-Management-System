'use client'
import Link from 'next/link'
import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { ok, useQuery } from '@/lib/hooks'
import { ageOf, fmtDate, fmtDateTime } from '@/lib/format'
import { hasRole } from '@/lib/roles'
import { Async, Button, Card, EmptyState, Icon, LoadingBlock, PageHeader, Pill, StatusPill, Table, Td, Th, Tr } from '@/components/ui'

interface Hit {
  patient_id: string; patient_code: string; full_name: string; dob: string; sex: string; phone: string | null
  open_visit_status: string | null; is_admitted: boolean; next_appointment: string | null; score: number
}

export default function SearchPage() {
  return <Suspense fallback={<LoadingBlock />}><Inner /></Suspense>
}

// Why a row matched, worked out from the query (the function returns only a score).
function matchLabel(h: Hit, q: string): { text: string; tone: 'success' | 'info' | 'neutral' } {
  const t = q.trim().toLowerCase(), digits = q.replace(/\D/g, '')
  if (h.patient_code.toLowerCase() === t) return { text: 'Patient ID', tone: 'success' }
  if (/^\d{4}-\d{2}-\d{2}$/.test(t) && h.dob === t) return { text: 'Date of birth', tone: 'success' }
  if (digits.length >= 4 && (h.phone ?? '').replace(/\D/g, '').includes(digits)) return { text: 'Phone match', tone: 'info' }
  if (h.full_name.toLowerCase().includes(t)) return { text: 'Name match', tone: 'info' }
  return { text: 'Close name', tone: 'neutral' }
}

function Inner() {
  const router = useRouter()
  const { staff } = useAuth()
  const param = useSearchParams().get('q') ?? ''
  const [text, setText] = useState(param)
  useEffect(() => setText(param), [param])
  const term = param.trim()
  const canRegister = hasRole(staff?.role, 'receptionist', 'doctor', 'nurse', 'community_health', 'hospital_admin', 'super_admin')

  const q = useQuery<Hit[]>(async () => term.length < 2 ? [] : ok(await supabase.rpc('search_patients', { p_query: term, p_limit: 50 }) as never), [term])
  const rows = q.data ?? []

  return (
    <>
      <PageHeader title="Search Results" subtitle={term.length < 2 ? 'Type at least 2 characters.' : q.loading && !q.data ? 'Searching…' : `${rows.length} patient${rows.length === 1 ? '' : 's'} match “${term}”. Results only include what your role may see.`} />
      <Card className="p-4">
        <form className="flex flex-col md:flex-row gap-2" onSubmit={(e) => { e.preventDefault(); if (text.trim().length >= 2) router.push(`/search?q=${encodeURIComponent(text.trim())}`) }}>
          <div className="relative flex-1"><Icon name="search" className="absolute left-3 top-2 text-[20px] text-outline" />
            <input value={text} onChange={(e) => setText(e.target.value)} aria-label="Search" placeholder="Patient ID, name, phone or date of birth (YYYY-MM-DD)"
              className="w-full h-9 pl-10 pr-3 rounded-lg border border-outline-variant/60 text-body-md focus:outline-none focus:ring-2 focus:ring-primary" /></div>
          <Button type="submit" disabled={text.trim().length < 2}>Search</Button>
        </form>
        <p className="mt-2 text-label-xs text-outline">Matches Patient ID, name (small typos are fine), phone number (spaces and dashes ignored) and date of birth. Type at least 2 characters.</p>
      </Card>

      {term.length >= 2 && (
        <Async q={q}>
          <Card className="overflow-hidden">
            <div className="px-5 py-4 flex items-center justify-between"><span className="text-headline-sm">{rows.length} result{rows.length === 1 ? '' : 's'}</span><span className="text-label-sm text-outline">Best match first</span></div>
            {rows.length === 0 ? <EmptyState title="No patients found" hint="Check the spelling, or try the phone number or Patient ID."
              action={canRegister ? <Link href="/registration"><Button>Register New Patient</Button></Link> : undefined} /> : (
              <Table head={<><Th>Patient</Th><Th>Date of birth</Th><Th>Phone</Th><Th>Current status</Th><Th>Next appointment</Th><Th>Match</Th><Th /></>}>
                {rows.map((h) => {
                  const m = matchLabel(h, term)
                  return (
                    <Tr key={h.patient_id} onClick={() => router.push(`/patients/${h.patient_id}`)}>
                      <Td><div className="font-medium">{h.full_name}</div><div className="text-label-xs text-outline">{h.patient_code}</div></Td>
                      <Td>{fmtDate(h.dob)} ({ageOf(h.dob)})</Td>
                      <Td>{h.phone ?? '—'}</Td>
                      <Td>{h.is_admitted ? <Pill tone="info">Admitted</Pill> : h.open_visit_status ? <StatusPill status={h.open_visit_status} /> : <span className="text-outline">—</span>}</Td>
                      <Td>{h.next_appointment ? fmtDateTime(h.next_appointment) : <span className="text-outline">—</span>}</Td>
                      <Td><Pill tone={m.tone} dot={false}>{m.text}</Pill></Td>
                      <Td className="text-right"><Link href={`/patients/${h.patient_id}`} onClick={(e) => e.stopPropagation()}><Button small variant="secondary">Open</Button></Link></Td>
                    </Tr>
                  )
                })}
              </Table>
            )}
          </Card>
          {rows.length > 0 && canRegister && (
            <Card className="px-5 py-4 flex flex-wrap items-center justify-between gap-3">
              <div><p className="font-medium">Not the person you are looking for?</p><p className="text-body-sm text-on-surface-variant">Register them once. The duplicate check runs before anything is saved.</p></div>
              <Link href="/registration"><Button variant="secondary">Register New Patient</Button></Link>
            </Card>
          )}
        </Async>
      )}
    </>
  )
}
