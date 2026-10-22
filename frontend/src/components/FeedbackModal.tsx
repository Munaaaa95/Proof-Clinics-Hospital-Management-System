'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { Button, Field, Modal, Textarea, cx, useAction } from './ui'

export const RATINGS = [{ v: 'ok', l: 'OK' }, { v: 'good', l: 'Good' }, { v: 'great', l: 'Great' }] as const
export const ratingLabel = (r?: string | null) => RATINGS.find((x) => x.v === r)?.l ?? '—'

// Patient feedback after a visit (spec 3B): OK, Good or Great, plus an optional complaint or comment.
export function FeedbackModal({ visit, onClose, onSaved }: {
  visit: { id: string; patientName: string; rating?: string | null; note?: string | null } | null
  onClose: () => void; onSaved: () => void
}) {
  const { busy, run } = useAction()
  const [rating, setRating] = useState<string>('')
  const [note, setNote] = useState('')
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => { setRating(visit?.rating ?? ''); setNote(visit?.note ?? ''); setErr(null) }, [visit?.id, visit?.rating, visit?.note])

  async function save() {
    if (!visit) return
    if (!rating && !note.trim()) return setErr('Choose a rating or write a comment')
    setErr(null)
    const r = await run(async () => {
      const { error } = await supabase.from('visits').update({ feedback_rating: rating || null, feedback_note: note.trim() || null }).eq('id', visit.id)
      if (error) throw error
      return true
    }, 'Feedback saved')
    if (r) onSaved()
  }

  return (
    <Modal open={!!visit} onClose={onClose} title="Patient Feedback"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button busy={busy} onClick={() => void save()}>Save feedback</Button></>}>
      <p className="text-body-sm text-on-surface-variant">How was the visit for <span className="font-medium text-on-surface">{visit?.patientName}</span>?</p>
      <div className="grid grid-cols-3 gap-3" role="radiogroup" aria-label="Rating">
        {RATINGS.map((x) => (
          <button key={x.v} type="button" role="radio" aria-checked={rating === x.v} onClick={() => setRating(rating === x.v ? '' : x.v)}
            className={cx('h-11 rounded-lg border text-body-md transition-colors', rating === x.v ? 'border-primary bg-primary-fixed/50 text-primary font-medium' : 'border-outline-variant hover:bg-surface-container-low')}>
            {x.l}
          </button>
        ))}
      </div>
      <Field label="Complaint or comment (optional)"><Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Anything the patient wants to tell the hospital" /></Field>
      {err && <p className="text-body-sm text-error" role="alert">{err}</p>}
    </Modal>
  )
}
