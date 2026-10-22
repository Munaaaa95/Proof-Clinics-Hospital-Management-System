'use client'
import Link from 'next/link'
import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { ok, useQuery } from '@/lib/hooks'
import { ageOf } from '@/lib/format'
import { hasRole } from '@/lib/roles'
import { AdmitModal } from '@/components/AdmitModal'
import { Async, Button, Card, EmptyState, PageHeader, StatTile, StatusPill, Tabs, cx, useAction } from '@/components/ui'

interface Bed { id: string; bed_number: string; status: string; ward: { id: string; name: string } | null }
interface Adm {
  id: string; bed_id: string; diagnosis: string | null; admitted_at: string
  patient: { id: string; full_name: string; patient_code: string; dob: string; sex: string } | null
  doctor: { full_name: string } | null
}
const dayOf = (iso: string) => Math.max(1, Math.ceil((Date.now() - new Date(iso).getTime()) / 86400000))

export default function InpatientPage() {
  const { staff } = useAuth()
  const { busy, run } = useAction()
  const [ward, setWard] = useState('all')
  const [admit, setAdmit] = useState<{ bedId?: string } | null>(null)
  const canAdmit = hasRole(staff?.role, 'doctor', 'hospital_admin', 'super_admin')
  const isAdminRole = hasRole(staff?.role, 'hospital_admin', 'super_admin')

  const q = useQuery(async () => {
    const [beds, adms] = await Promise.all([
      supabase.from('beds').select('id, bed_number, status, ward:wards(id, name)').order('bed_number'),
      supabase.from('admissions').select('id, bed_id, diagnosis, admitted_at, patient:patients(id, full_name, patient_code, dob, sex), doctor:staff!admissions_doctor_id_fkey(full_name)').eq('status', 'active'),
    ])
    return { beds: ok(beds as never) as Bed[], adms: ok(adms as never) as Adm[] }
  }, [], ['beds', 'admissions'])

  const beds = [...(q.data?.beds ?? [])].sort((a, b) => (a.ward?.name ?? '').localeCompare(b.ward?.name ?? '') || a.bed_number.localeCompare(b.bed_number, undefined, { numeric: true }))
  const wards = Array.from(new Set(beds.map((b) => b.ward?.name ?? ''))).filter(Boolean)
  const shown = beds.filter((b) => ward === 'all' || b.ward?.name === ward)
  const occ = beds.filter((b) => b.status === 'occupied').length
  const count = (n: string, s?: string) => beds.filter((b) => b.ward?.name === n && (!s || b.status === s)).length
  const admOf = (bedId: string) => q.data?.adms.find((a) => a.bed_id === bedId)

  const setBed = (b: Bed, status: 'available' | 'maintenance' | 'reserved') => run(async () => {
    const { error } = await supabase.from('beds').update({ status }).eq('id', b.id)
    if (error) throw error
  }, `Bed ${b.bed_number} marked ${status}`)

  return (
    <>
      <PageHeader title="Wards and Beds" actions={canAdmit ? <Button onClick={() => setAdmit({})}>Admit Patient</Button> : undefined} />
      <Async q={q}>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
          <StatTile label="Total Capacity" value={beds.length} hint="Beds" foot={<span>Across {wards.length} wards</span>} />
          <StatTile label="Occupied" value={occ} hint="Beds" foot={<span>{beds.length ? Math.round((occ / beds.length) * 100) : 0}% occupancy</span>} />
          <StatTile label="Available" value={beds.filter((b) => b.status === 'available').length} hint="Ready" />
          <StatTile label="Maintenance" value={beds.filter((b) => b.status === 'maintenance').length} hint="Bed" />
        </div>

        <Tabs value={ward} onChange={setWard} tabs={[{ id: 'all', label: `All Wards (${occ}/${beds.length})` }, ...wards.map((w) => ({ id: w, label: `${w} (${count(w, 'occupied')}/${count(w)})` }))]} />

        {shown.length === 0 ? <Card><EmptyState title="No beds to show" /></Card> : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
            {shown.map((b) => {
              const a = b.status === 'occupied' ? admOf(b.id) : undefined
              const edge = b.status === 'occupied' ? 'border-l-primary' : b.status === 'available' ? 'border-l-outline-variant' : 'border-l-warn'
              return (
                <Card key={b.id} className={cx('p-5 flex flex-col gap-4 border-l-[3px]', edge)}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      
                      <div><p className="font-semibold">Bed {b.bed_number}</p><p className="text-label-xs text-outline">{b.ward?.name}</p></div>
                    </div>
                    <StatusPill status={b.status} />
                  </div>
                  {a ? (
                    <>
                      <div>
                        <h4 className="font-semibold">{a.patient?.full_name}</h4>
                        <p className="text-body-sm text-on-surface-variant">{ageOf(a.patient?.dob)}y / {a.patient?.sex && a.patient.sex[0].toUpperCase() + a.patient.sex.slice(1)} • ID: {a.patient?.patient_code}</p>
                      </div>
                      <div className="text-body-sm space-y-1">
                        <p className="flex items-center gap-1.5">{a.diagnosis}</p>
                        <p className="flex items-center gap-1.5 text-on-surface-variant">{a.doctor?.full_name} (Day {dayOf(a.admitted_at)})</p>
                      </div>
                      <div className="flex gap-2 mt-auto">
                        <Link href={`/inpatient/${a.id}`} className="flex-1"><Button variant="secondary" small className="w-full">Chart</Button></Link>
                        <Link href={`/medication-record?admission=${a.id}`}><Button variant="secondary" small>Doses</Button></Link>
                        {canAdmit && <Link href={`/discharge/${a.id}`} className="flex-1"><Button small className="w-full">Discharge</Button></Link>}
                      </div>
                    </>
                  ) : b.status === 'available' ? (
                    <div className="flex flex-col items-center gap-2 py-3 text-center">
<p className="text-body-sm text-on-surface-variant">Bed available</p>
                      <div className="flex gap-2">
                        {canAdmit && <Button small variant="secondary" onClick={() => setAdmit({ bedId: b.id })}>Assign Bed</Button>}
                        {isAdminRole && <Button small variant="ghost" busy={busy} onClick={() => void setBed(b, 'maintenance')}>Under maintenance</Button>}
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center gap-2 py-3 text-center">
<p className="text-body-sm text-on-surface-variant">{b.status === 'reserved' ? 'Reserved' : 'Under maintenance'}</p><p className="text-label-xs text-outline">Not available for admission</p>
                      {isAdminRole && <Button small variant="secondary" busy={busy} onClick={() => void setBed(b, 'available')}>Mark Available</Button>}
                    </div>
                  )}
                </Card>
              )
            })}
          </div>
        )}
      </Async>
      <AdmitModal open={!!admit} bedId={admit?.bedId} onClose={() => setAdmit(null)} onDone={() => { setAdmit(null); q.reload() }} />
    </>
  )
}
