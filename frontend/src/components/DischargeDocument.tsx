'use client'
import Link from 'next/link'
import { ageOf, fmtDate, fmtDateTime, titleCase } from '@/lib/format'
import { Button } from './ui'

export interface DocData {
  adm: {
    id: string; diagnosis: string | null; admitted_at: string; discharged_at: string | null; discharge_summary: string | null
    patient: { full_name: string; patient_code: string; dob: string; sex: string; allergies?: string | null } | null
    bed: { bed_number: string; ward: { name: string } | null } | null
    doctor: { full_name: string } | null
    nurse: { full_name: string } | null
  }
  rx: { id: string; dose: string; route: string; frequency: string; duration_days: number | null; quantity: number; drug: { name: string } | null }[]
  followUp: { scheduled_at: string; reason: string | null; doctor: { full_name: string } | null } | null
}

// Spec 10: discharge documentation is generated and stored. This is the printable version of what was recorded at
// discharge: the stay, the summary, the treatment given and any follow-up. Nothing here is typed again.
export function DischargeDocument({ adm, rx, followUp, printedBy }: DocData & { printedBy: string }) {
  const days = Math.max(1, Math.ceil((new Date(adm.discharged_at ?? Date.now()).getTime() - new Date(adm.admitted_at).getTime()) / 86400000))
  const row = (k: string, v: React.ReactNode) => (
    <div className="grid grid-cols-[9rem_1fr] gap-3 py-1.5 border-b border-outline-variant/40 print:border-black/20 text-body-md"><dt className="text-on-surface-variant">{k}</dt><dd className="font-medium">{v}</dd></div>
  )
  return (
    <div className="space-y-5">
      <div className="no-print flex items-center justify-between gap-3 flex-wrap">
        <p className="text-body-sm text-on-surface-variant">This patient has been discharged. The stay stays in history and is not deleted.</p>
        <div className="flex gap-2">
          <Link href={`/inpatient/${adm.id}`}><Button variant="secondary">View chart</Button></Link>
          <Button onClick={() => window.print()}>Print discharge summary</Button>
        </div>
      </div>

      <article className="bg-surface-container-lowest border border-outline-variant/70 rounded-lg p-10 print:border-0 print:p-0 print:rounded-none max-w-3xl">
        <header className="flex items-start justify-between gap-6 pb-5 border-b-2 border-on-surface">
          <div>
            <div className="text-[20px] font-semibold tracking-tight">Proof Clinics</div>
            <div className="text-[10.5px] uppercase tracking-[0.14em] text-outline mt-0.5">Hospital Management System</div>
          </div>
          <div className="text-right">
            <h1 className="text-[18px] font-semibold tracking-tight">Discharge Summary</h1>
            <div className="text-label-xs text-outline mt-1">Student prototype. Fake patient data.</div>
          </div>
        </header>

        <section className="mt-6">
          <h2 className="text-[11px] font-medium uppercase tracking-wider text-outline mb-1">Patient</h2>
          <dl>
            {row('Name', adm.patient?.full_name)}
            {row('Patient ID', <span className="font-mono">{adm.patient?.patient_code}</span>)}
            {row('Sex and age', `${titleCase(adm.patient?.sex)}, ${ageOf(adm.patient?.dob)} years (born ${fmtDate(adm.patient?.dob)})`)}
            {row('Allergies', adm.patient?.allergies || 'None recorded')}
          </dl>
        </section>

        <section className="mt-6">
          <h2 className="text-[11px] font-medium uppercase tracking-wider text-outline mb-1">Admission</h2>
          <dl>
            {row('Ward and bed', `${adm.bed?.ward?.name ?? ''}, bed ${adm.bed?.bed_number ?? ''}`)}
            {row('Admitted', fmtDateTime(adm.admitted_at))}
            {row('Discharged', `${fmtDateTime(adm.discharged_at)} (${days} day${days > 1 ? 's' : ''})`)}
            {row('Doctor', adm.doctor?.full_name ?? '—')}
            {row('Nurse', adm.nurse?.full_name ?? 'Not assigned')}
            {row('Diagnosis', adm.diagnosis)}
          </dl>
        </section>

        <section className="mt-6">
          <h2 className="text-[11px] font-medium uppercase tracking-wider text-outline mb-2">Summary of stay and treatment</h2>
          <p className="text-body-md whitespace-pre-wrap leading-relaxed">{adm.discharge_summary || 'No summary was recorded.'}</p>
        </section>

        <section className="mt-6">
          <h2 className="text-[11px] font-medium uppercase tracking-wider text-outline mb-2">Medication prescribed during the stay</h2>
          {rx.length === 0 ? <p className="text-body-md text-on-surface-variant">None.</p> : (
            <table className="w-full text-left text-body-sm">
              <thead><tr className="border-b border-outline-variant/60 print:border-black/30"><th className="py-1.5 pr-3 font-medium">Drug</th><th className="py-1.5 pr-3 font-medium">Dose and route</th><th className="py-1.5 pr-3 font-medium">Frequency</th><th className="py-1.5 font-medium">Duration</th></tr></thead>
              <tbody>{rx.map((r) => <tr key={r.id} className="border-b border-outline-variant/30 print:border-black/15"><td className="py-1.5 pr-3">{r.drug?.name}</td><td className="py-1.5 pr-3">{r.dose}, {r.route}</td><td className="py-1.5 pr-3">{r.frequency}</td><td className="py-1.5">{r.duration_days ? `${r.duration_days} days` : '—'}</td></tr>)}</tbody>
            </table>
          )}
        </section>

        <section className="mt-6">
          <h2 className="text-[11px] font-medium uppercase tracking-wider text-outline mb-2">Follow-up</h2>
          <p className="text-body-md">{followUp ? `${fmtDateTime(followUp.scheduled_at)}${followUp.doctor ? ` with ${followUp.doctor.full_name}` : ''}${followUp.reason ? `. ${followUp.reason}.` : ''}` : 'No follow-up appointment was booked.'}</p>
        </section>

        <footer className="mt-12 grid grid-cols-2 gap-10 text-body-sm">
          <div><div className="border-t border-on-surface pt-1.5">Discharging doctor: {adm.doctor?.full_name}</div></div>
          <div><div className="border-t border-on-surface pt-1.5">Date</div></div>
          <p className="col-span-2 text-label-xs text-outline">Printed {fmtDateTime(new Date().toISOString())} by {printedBy}.</p>
        </footer>
      </article>
    </div>
  )
}
