export const TZ = 'Africa/Lagos'

export function ageOf(dob: string | null | undefined): number | null {
  if (!dob) return null
  const d = new Date(dob), n = new Date()
  let a = n.getFullYear() - d.getFullYear()
  if (n.getMonth() < d.getMonth() || (n.getMonth() === d.getMonth() && n.getDate() < d.getDate())) a--
  return a
}
export const sexLetter = (s?: string | null) => (s ? s[0].toUpperCase() : '')
export const ageSex = (dob?: string | null, sex?: string | null) => {
  const a = ageOf(dob)
  return `${sexLetter(sex)}${a != null ? `/${a}` : ''}`
}

export const fmtDate = (v?: string | null) =>
  v ? new Date(v).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: TZ }) : '—'
export const fmtTime = (v?: string | null) =>
  v ? new Date(v).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: TZ }) : '—'
export const fmtDateTime = (v?: string | null) => (v ? `${fmtDate(v)}, ${fmtTime(v)}` : '—')
export const todayLong = () =>
  new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric', timeZone: TZ })
// YYYY-MM-DD for "today" in Lagos
export const lagosToday = () => new Date().toLocaleDateString('en-CA', { timeZone: TZ })

export function minutesSince(v?: string | null): number {
  return v ? Math.max(0, Math.floor((Date.now() - new Date(v).getTime()) / 60000)) : 0
}
export function waitText(mins: number): string {
  if (mins < 60) return `${String(mins).padStart(2, '0')} mins`
  return `${Math.floor(mins / 60)}h ${mins % 60}m`
}
export function ago(v?: string | null): string {
  const m = minutesSince(v)
  if (m < 1) return 'just now'
  if (m < 60) return `${m} min ago`
  if (m < 1440) return `${Math.floor(m / 60)} h ago`
  return fmtDate(v)
}

export const naira = (n: number | string | null | undefined) =>
  `₦${Number(n ?? 0).toLocaleString('en-NG', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`

export const titleCase = (s?: string | null) =>
  (s ?? '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())

export const initials = (name?: string | null) =>
  (name ?? '?').replace(/^(Dr\.?|Nurse|Pharm\.?)\s+/i, '').split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('')

// PostgREST returns a one-to-one embed (for example lab_results, unique per request) as an object, and a
// one-to-many embed as an array. Treat both the same.
export const many = <T,>(v: T | T[] | null | undefined): T[] => (v == null ? [] : Array.isArray(v) ? v : [v])
