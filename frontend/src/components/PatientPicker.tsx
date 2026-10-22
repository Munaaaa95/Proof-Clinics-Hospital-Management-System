'use client'
import { useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useDebounced } from '@/lib/hooks'
import { ageSex } from '@/lib/format'
import { cx, Icon, Spinner } from './ui'

export interface PickedPatient { patient_id: string; patient_code: string; full_name: string; dob: string; sex: string; phone?: string | null }

// Type-ahead over search_patients(). The database decides what the signed-in role may find.
export function PatientPicker({ value, onChange, placeholder = 'Search by name, Patient ID or phone', autoFocus }: {
  value: PickedPatient | null; onChange: (p: PickedPatient | null) => void; placeholder?: string; autoFocus?: boolean
}) {
  const [text, setText] = useState('')
  const [rows, setRows] = useState<PickedPatient[]>([])
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const dq = useDebounced(text.trim(), 300)

  useEffect(() => {
    if (dq.length < 2) { setRows([]); return }
    let alive = true
    setBusy(true)
    supabase.rpc('search_patients', { p_query: dq, p_limit: 8 }).then(({ data }) => {
      if (!alive) return
      setRows((data as PickedPatient[]) ?? [])
      setBusy(false)
    })
    return () => { alive = false }
  }, [dq])

  useEffect(() => {
    const h = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  if (value) {
    return (
      <div className="flex items-center justify-between gap-2 h-9 px-3 rounded-lg bg-surface-container-low">
        <span className="text-body-sm"><span className="font-medium">{value.full_name}</span> <span className="text-outline">{value.patient_code} • {ageSex(value.dob, value.sex)}</span></span>
        <button type="button" onClick={() => { onChange(null); setText('') }} aria-label="Choose a different patient" className="text-outline hover:text-on-surface"><Icon name="close" className="text-[18px]" /></button>
      </div>
    )
  }
  return (
    <div ref={box} className="relative">
      <Icon name="search" className="absolute left-2.5 top-2 text-[18px] text-outline pointer-events-none" />
      <input value={text} autoFocus={autoFocus} onChange={(e) => { setText(e.target.value); setOpen(true) }} onFocus={() => setOpen(true)} placeholder={placeholder}
        className="w-full h-9 pl-9 pr-8 rounded-lg border border-outline-variant/60 bg-surface-container-lowest text-body-sm placeholder:text-outline focus:outline-none focus:ring-2 focus:ring-primary" />
      {busy && <Spinner className="absolute right-2.5 top-2.5 h-4 w-4 text-outline" />}
      {open && dq.length >= 2 && (
        <div className="absolute z-30 mt-1 w-full bg-surface-container-lowest rounded-lg shadow-lg border border-outline-variant/40 max-h-64 overflow-y-auto">
          {rows.length === 0 && !busy ? (
            <p className="px-3 py-3 text-body-sm text-outline">No patients found</p>
          ) : rows.map((r) => (
            <button key={r.patient_id} type="button" onClick={() => { onChange(r); setOpen(false) }}
              className={cx('w-full text-left px-3 py-2 hover:bg-surface-container-low flex items-center justify-between gap-2')}>
              <span className="text-body-sm font-medium">{r.full_name}</span>
              <span className="text-label-xs text-outline">{r.patient_code} • {ageSex(r.dob, r.sex)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
