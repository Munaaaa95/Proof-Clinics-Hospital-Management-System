'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth'
import { Spinner } from '@/components/ui'

export default function LoginPage() {
  const router = useRouter()
  const { signIn, staff, loading } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => { if (!loading && staff) router.replace('/dashboard') }, [loading, staff, router])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const err = await signIn(email.trim(), password)
    setBusy(false)
    if (err) setError(err)
    else router.replace('/dashboard')
  }

  return (
    <main className="min-h-screen grid lg:grid-cols-[minmax(0,5fr)_minmax(0,4fr)] bg-background">
      <section className="hidden lg:flex flex-col justify-between bg-primary text-on-primary px-14 py-12">
        <div>
          <div className="text-[22px] font-semibold tracking-tight">Proof Clinics</div>
          <div className="text-[11px] uppercase tracking-[0.16em] text-on-primary/70 mt-1">Hospital Management System</div>
        </div>
        <div className="max-w-md space-y-8">
          <h1 className="text-[34px] leading-[1.15] font-semibold tracking-tight">One patient record, in every department that needs it.</h1>
          <dl className="space-y-5 text-[14px] leading-relaxed text-on-primary/85">
            <div><dt className="font-medium text-on-primary">Register once</dt><dd>A patient is entered a single time. Reception, the clinic, the laboratory, the pharmacy and the wards all work from the same record.</dd></div>
            <div><dt className="font-medium text-on-primary">Every step is accounted for</dt><dd>Each change is written to an audit trail with who made it and when.</dd></div>
          </dl>
        </div>
        <div aria-hidden="true" />
      </section>

      <section className="flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">
          <div className="lg:hidden mb-8">
            <div className="text-[20px] font-semibold tracking-tight">Proof Clinics</div>
            <div className="text-[10.5px] uppercase tracking-[0.14em] text-outline mt-0.5">Hospital Management System</div>
          </div>
          <h2 className="text-[22px] font-semibold tracking-tight">Staff sign in</h2>
          <p className="text-body-sm text-on-surface-variant mt-1">Use your individual staff account.</p>

          <form className="mt-7 space-y-4" onSubmit={submit}>
            <div className="space-y-1.5">
              <label className="block text-[12px] font-medium text-on-surface-variant" htmlFor="staff-email">Email address</label>
              <input id="staff-email" type="email" required autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)}
                placeholder="name@proofclinics.test"
                className="w-full h-10 px-3 bg-surface-container-lowest text-body-md text-on-surface placeholder:text-outline/80 rounded-lg border border-outline-variant focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary" />
            </div>
            <div className="space-y-1.5">
              <label className="block text-[12px] font-medium text-on-surface-variant" htmlFor="staff-password">Password</label>
              <div className="relative">
                <input id="staff-password" type={show ? 'text' : 'password'} required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)}
                  className="w-full h-10 pl-3 pr-14 bg-surface-container-lowest text-body-md text-on-surface rounded-lg border border-outline-variant focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary" />
                <button type="button" aria-label={show ? 'Hide password' : 'Show password'} onClick={() => setShow((s) => !s)}
                  className="absolute right-3 top-2.5 text-[12px] font-medium text-primary hover:underline">{show ? 'Hide' : 'Show'}</button>
              </div>
            </div>
            {error && <div role="alert" className="py-2.5 px-3 rounded-lg border border-error/25 border-l-[3px] border-l-error bg-error-container text-on-error-container text-body-sm">{error}</div>}
            <button type="submit" disabled={busy}
              className="w-full h-10 bg-primary hover:bg-on-primary-fixed-variant text-on-primary text-[14px] font-medium rounded-lg flex items-center justify-center transition-colors disabled:opacity-60">
              {busy ? <Spinner className="h-4 w-4" /> : 'Sign in'}
            </button>
          </form>
        </div>
      </section>
    </main>
  )
}
