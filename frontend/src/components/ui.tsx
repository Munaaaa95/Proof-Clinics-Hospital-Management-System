'use client'
import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react'

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ')

// Icons are kept for controls that need one (search, close, chevrons, bell). Everything else is text.
export function Icon({ name, className, filled }: { name: string; className?: string; filled?: boolean }) {
  return <span aria-hidden="true" className={cx('material-symbols-outlined', filled && 'fill', className ?? 'text-[20px]')}>{name}</span>
}

// ------------------------------------------------------------------ buttons
type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  icon?: string // only drawn on icon-only buttons (no children)
  busy?: boolean
  small?: boolean
}
export function Button({ variant = 'primary', icon, busy, small, className, children, disabled, ...rest }: BtnProps) {
  const iconOnly = !children && !!icon
  const base = 'inline-flex items-center justify-center gap-1.5 rounded-lg text-[13px] font-medium transition-colors disabled:opacity-45 disabled:cursor-not-allowed whitespace-nowrap focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary'
  const size = iconOnly ? (small ? 'h-8 w-8' : 'h-9 w-9') : small ? 'h-8 px-3' : 'h-9 px-4'
  const look = {
    primary: 'bg-primary text-on-primary hover:bg-on-primary-fixed-variant',
    secondary: 'bg-surface-container-lowest text-on-surface border border-outline-variant hover:bg-surface-container-low',
    ghost: 'text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface',
    danger: 'bg-error text-on-error hover:opacity-90',
  }[variant]
  return (
    <button type="button" {...rest} disabled={disabled || busy} className={cx(base, size, look, className)}>
      {busy ? <Spinner className="h-3.5 w-3.5" /> : iconOnly ? <Icon name={icon!} className="text-[18px]" /> : null}
      {children}
    </button>
  )
}

export function Spinner({ className }: { className?: string }) {
  return <span className={cx('inline-block animate-spin rounded-full border-2 border-current border-t-transparent', className ?? 'h-5 w-5')} />
}

// ------------------------------------------------------------------ layout pieces
export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('bg-surface-container-lowest rounded-lg border border-outline-variant/70', className)}>{children}</div>
}

export function PageHeader({ title, subtitle, badge, actions }: { title: string; subtitle?: ReactNode; badge?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="print:hidden flex flex-col md:flex-row md:items-end justify-between gap-space-md pb-6 border-b border-outline-variant/70">
      <div className="min-w-0">
        <div className="flex items-center gap-3">
          <h1 className="text-[22px] leading-7 font-semibold tracking-tight text-on-surface">{title}</h1>
          {badge}
        </div>
        {subtitle && <p className="text-body-sm text-on-surface-variant mt-1">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-space-sm flex-wrap">{actions}</div>}
    </div>
  )
}

export function LiveBadge({ text = 'Live' }: { text?: string }) {
  const t = text.toUpperCase().startsWith('LIVE') ? 'Live' : text
  return <span className="inline-flex items-center gap-1.5 text-label-xs text-tertiary"><span className="h-1.5 w-1.5 rounded-full bg-tertiary animate-pulse" />{t}</span>
}

export function StatTile({ label, value, hint, foot, onClick }: {
  icon?: string; label: string; value: ReactNode; hint?: string; foot?: ReactNode; accent?: boolean; onClick?: () => void
}) {
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag onClick={onClick} className={cx('text-left bg-surface-container-lowest rounded-lg border border-outline-variant/70 p-5 flex flex-col justify-between', onClick && 'hover:border-primary/50 transition-colors cursor-pointer')}>
      <div>
        <span className="block text-[11px] font-medium uppercase tracking-wider text-outline">{label}</span>
        <div className="mt-1.5 flex items-baseline gap-2">
          <span className="text-[28px] leading-8 font-semibold tracking-tight text-on-surface">{value}</span>
          {hint && <span className="text-body-sm text-on-surface-variant">{hint}</span>}
        </div>
      </div>
      {foot && <div className="mt-4 pt-3 border-t border-outline-variant/50 flex items-center justify-between gap-2 flex-wrap text-label-sm text-on-surface-variant">{foot}</div>}
    </Tag>
  )
}

// ------------------------------------------------------------------ status pills
const PILL = {
  neutral: 'bg-[#eceff3] text-[#454c58]',
  info: 'bg-primary-fixed text-[#13398a]',
  success: 'bg-tertiary-fixed text-on-tertiary-fixed-variant',
  warn: 'bg-warn-container text-warn',
  danger: 'bg-error-container text-on-error-container',
} as const
export type Tone = keyof typeof PILL

export function Pill({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode; dot?: boolean }) {
  return <span className={cx('inline-flex items-center px-2 py-0.5 rounded text-[11.5px] leading-4 font-medium whitespace-nowrap', PILL[tone])}>{children}</span>
}

const STATUS_TONE: Record<string, Tone> = {
  waiting: 'neutral', pending: 'neutral', requested: 'neutral', scheduled: 'neutral', prescribed: 'neutral', confirmed: 'neutral', unpaid: 'danger',
  in_consultation: 'info', collected: 'info', resulted: 'info', checked_in: 'info', entered: 'info', occupied: 'info', active: 'info',
  completed: 'success', given: 'success', finalized: 'success', paid: 'success', dispensed: 'success', available: 'neutral', ok: 'success', discharged: 'success',
  low: 'warn', held: 'warn', part_paid: 'warn', partial: 'warn', no_charges: 'neutral', expiring: 'warn', reserved: 'warn', maintenance: 'warn', rescheduled: 'warn',
  missed: 'danger', refused: 'danger', out_of_stock: 'danger', cancelled: 'danger', no_show: 'danger', overdue: 'danger',
}
const STATUS_TEXT: Record<string, string> = { finalized: 'Finalised', low: 'Low stock', ok: 'Adequate', out_of_stock: 'Out of stock', part_paid: 'Part paid', partial: 'Part paid', no_charges: 'No charges' }
export const statusText = (s: string) => STATUS_TEXT[s] ?? s.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase())

export function StatusPill({ status }: { status: string | null | undefined }) {
  if (!status) return <span className="text-outline">—</span>
  return <Pill tone={STATUS_TONE[status] ?? 'neutral'}>{statusText(status)}</Pill>
}

// ------------------------------------------------------------------ states
export function LoadingBlock({ label = 'Loading…' }: { label?: string }) {
  return <div className="flex items-center justify-center gap-2 py-10 text-outline text-body-sm"><Spinner className="h-4 w-4" />{label}</div>
}
export function EmptyState({ title, hint, action }: { icon?: string; title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1 py-14 px-4 text-center">
      <p className="text-body-md-medium text-on-surface">{title}</p>
      {hint && <p className="text-body-sm text-on-surface-variant max-w-sm">{hint}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  )
}
export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex items-start gap-3 py-2.5 px-3 rounded-lg border border-error/25 border-l-[3px] border-l-error bg-error-container text-on-error-container text-body-sm" role="alert">
      <Icon name="error" className="text-[18px] mt-px shrink-0" filled />
      <div className="flex-1">{message}</div>
      {onRetry && <button type="button" onClick={onRetry} className="underline font-medium">Retry</button>}
    </div>
  )
}
// Standard wrapper: shows loading, error, empty, or the content.
export function Async({ q, empty, isEmpty, children }: {
  q: { loading: boolean; error: string | null; data: unknown; reload: () => void }
  empty?: ReactNode
  isEmpty?: boolean
  children: ReactNode
}) {
  if (q.error && !q.data) return <div className="p-4"><ErrorBox message={q.error} onRetry={q.reload} /></div>
  if (q.loading && !q.data) return <LoadingBlock />
  if (isEmpty) return <>{empty}</>
  return <>{children}</>
}

// ------------------------------------------------------------------ tables
export function Th({ children, className }: { children?: ReactNode; className?: string }) {
  return <th className={cx('py-3 px-5 text-[11px] font-medium uppercase tracking-wider', className)}>{children}</th>
}
export function Table({ head, children, className }: { head: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cx('w-full overflow-x-auto', className)}>
      <table className="w-full text-left">
        <thead className="bg-surface-container-low text-outline border-y border-outline-variant/60"><tr>{head}</tr></thead>
        <tbody className="text-body-sm text-on-surface divide-y divide-outline-variant/40">{children}</tbody>
      </table>
    </div>
  )
}
export const Tr = ({ children, onClick, className }: { children: ReactNode; onClick?: () => void; className?: string }) => (
  <tr onClick={onClick} className={cx('hover:bg-surface-container-low/70 transition-colors', onClick && 'cursor-pointer', className)}>{children}</tr>
)
export const Td = ({ children, className, colSpan }: { children?: ReactNode; className?: string; colSpan?: number }) => (
  <td colSpan={colSpan} className={cx('py-3.5 px-5 align-middle', className)}>{children}</td>
)

export function PatientCell({ name, code, extra }: { name: string; code?: string | null; extra?: string }) {
  return (
    <div>
      <div className="font-medium">{name}</div>
      <div className="text-outline text-label-xs"><span className="font-mono">{code}</span>{extra ? ` · ${extra}` : ''}</div>
    </div>
  )
}

// ------------------------------------------------------------------ tabs (underlined)
export function Tabs<T extends string>({ tabs, value, onChange }: {
  tabs: { id: T; label: string; count?: number }[]; value: T; onChange: (v: T) => void
}) {
  return (
    <div role="tablist" className="flex items-center gap-5 flex-wrap border-b border-outline-variant/70">
      {tabs.map((t) => (
        <button key={t.id} type="button" role="tab" aria-selected={value === t.id} onClick={() => onChange(t.id)}
          className={cx('pb-2.5 pt-1 -mb-px text-[13px] border-b-2 transition-colors',
            value === t.id ? 'border-primary text-primary font-medium' : 'border-transparent text-on-surface-variant hover:text-on-surface')}>
          {t.label}
          {t.count != null && <span className={cx('ml-1.5 text-[12px] tabular-nums', value === t.id ? 'text-primary' : 'text-outline')}>{t.count}</span>}
        </button>
      ))}
    </div>
  )
}

// ------------------------------------------------------------------ form fields
export function Field({ label, hint, error, children, className }: { label: string; hint?: string; error?: string | null; children: ReactNode; className?: string }) {
  return (
    <label className={cx('block space-y-1.5', className)}>
      <span className="block text-[12px] text-on-surface-variant font-medium">{label}</span>
      {children}
      {hint && !error && <span className="block text-label-xs text-outline font-normal">{hint}</span>}
      {error && <span className="block text-label-xs text-error font-medium">{error}</span>}
    </label>
  )
}
// full width unless the caller sets its own width
const width = (c?: string) => (/(^|s)w-/.test(c ?? '') ? '' : 'w-full')
const fieldBase = 'bg-surface-container-lowest text-body-md text-on-surface placeholder:text-outline/80 rounded-lg border border-outline-variant focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors disabled:bg-surface-container-low disabled:text-outline'
export function Input({ className, ...p }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...p} className={cx(fieldBase, width(className), 'h-9 px-3', className)} />
}
export function Select({ className, children, ...p }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...p} className={cx(fieldBase, width(className), 'h-9 px-2', className)}>{children}</select>
}
export function Textarea({ className, ...p }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...p} className={cx(fieldBase, width(className), 'px-3 py-2 min-h-[80px]', className)} />
}
export function SearchBox({ value, onChange, placeholder, className }: { value: string; onChange: (v: string) => void; placeholder?: string; className?: string }) {
  return (
    <div className={cx('relative', className)}>
      <Icon name="search" className="absolute left-2.5 top-[7px] text-[18px] text-outline pointer-events-none" />
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={placeholder}
        className="h-8 w-full pl-8 pr-3 text-body-sm bg-surface-container-lowest border border-outline-variant rounded-lg text-on-surface placeholder:text-outline/80 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary" />
    </div>
  )
}

// ------------------------------------------------------------------ modal and drawer
export function Modal({ open, onClose, title, children, footer, wide }: {
  open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; wide?: boolean
}) {
  useEffect(() => {
    if (!open) return
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-inverse-surface/45" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label={title} className={cx('bg-surface-container-lowest rounded-xl shadow-2xl w-full max-h-[90vh] flex flex-col border border-outline-variant/60', wide ? 'max-w-2xl' : 'max-w-lg')}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-outline-variant/60">
          <h2 className="text-headline-sm text-on-surface">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="p-1 rounded text-on-surface-variant hover:bg-surface-container-low"><Icon name="close" className="text-[20px]" /></button>
        </div>
        <div className="p-6 overflow-y-auto space-y-5">{children}</div>
        {footer && <div className="px-5 py-3 border-t border-outline-variant/60 bg-surface-container-low/60 rounded-b-xl flex items-center justify-end gap-2">{footer}</div>}
      </div>
    </div>
  )
}

export function Drawer({ open, onClose, title, children, footer, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-[70] bg-inverse-surface/45" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside role="dialog" aria-modal="true" aria-label={title} className={cx('absolute right-0 top-0 h-full w-full bg-surface-container-lowest shadow-2xl flex flex-col border-l border-outline-variant/60', wide ? 'max-w-3xl' : 'max-w-md')}>
        <div className="flex items-center justify-between px-5 h-14 border-b border-outline-variant/60">
          <h2 className="text-headline-sm text-on-surface">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="p-1 rounded text-on-surface-variant hover:bg-surface-container-low"><Icon name="close" className="text-[20px]" /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-6 space-y-5">{children}</div>
        {footer && <div className="px-5 py-3 border-t border-outline-variant/60 bg-surface-container-low/60 flex items-center justify-end gap-2">{footer}</div>}
      </aside>
    </div>
  )
}

// ------------------------------------------------------------------ toasts
interface Toast { id: number; text: string; tone: 'ok' | 'error' }
const ToastCtx = createContext<(text: string, tone?: 'ok' | 'error') => void>(() => {})
export const useToast = () => useContext(ToastCtx)
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([])
  const push = useCallback((text: string, tone: 'ok' | 'error' = 'ok') => {
    const id = Date.now() + Math.random()
    setItems((s) => [...s, { id, text, tone }])
    setTimeout(() => setItems((s) => s.filter((t) => t.id !== id)), tone === 'error' ? 7000 : 3500)
  }, [])
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="fixed bottom-4 right-4 z-[90] space-y-2 w-80 max-w-[calc(100vw-2rem)]" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={cx('rounded-lg shadow-lg px-4 py-3 text-body-sm border-l-[3px]',
            t.tone === 'ok' ? 'bg-inverse-surface text-inverse-on-surface border-l-tertiary-fixed-dim' : 'bg-error-container text-on-error-container border-l-error')}>
            <span className="flex items-start gap-2.5"><Icon name={t.tone === 'ok' ? 'check_circle' : 'error'} className="text-[18px] shrink-0 mt-px" filled />{t.text}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  )
}

// Run an async action with a busy flag; report the database's error text in a toast.
export function useAction() {
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const run = useCallback(async <T,>(fn: () => Promise<T>, success?: string): Promise<T | undefined> => {
    setBusy(true)
    try {
      const r = await fn()
      if (success) toast(success)
      return r
    } catch (e) {
      toast(e instanceof Error ? e.message : String((e as { message?: string })?.message ?? e), 'error')
      return undefined
    } finally {
      setBusy(false)
    }
  }, [toast])
  return { busy, run }
}

export const titleCaseVisit = (s: string) => s.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase())
