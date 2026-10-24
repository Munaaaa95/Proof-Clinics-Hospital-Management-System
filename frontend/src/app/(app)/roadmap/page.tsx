import { Card, PageHeader } from '@/components/ui'

// Demo script step 9: the modules that are not part of this demo (build plan section 3.2; spec sections 16 to 24, 30, 35).
const BUILT = [
  ['Central patient profile and duplicate check', '2'], ['Dashboard, search and reports', '3, 28, 29'], ['Staff accounts and role permissions', '4'],
  ['Registration, queue and appointments', '5 to 7'], ['Outpatient consultation, diagnosis and prescriptions', '11'], ['Laboratory', '13'],
  ['Pharmacy, stock and alerts', '14'], ['Inpatient beds, medication record and discharge', '8 to 10'], ['Billing and payments', '26'],
  ['Antenatal care', '15'], ['Reminders and in-app notifications', '12, 25'], ['Audit trail', '27'],
]

const NEXT: { title: string; note: string; items: { name: string; spec: string; detail: string }[] }[] = [
  {
    title: 'Specialty clinical modules',
    note: 'Built on the same pattern as antenatal care, each with its documentation reviewed by clinical staff first.',
    items: [
      { name: 'Labour and delivery', spec: '16', detail: 'Labour observations, delivery details, baby information.' },
      { name: 'Postnatal care', spec: '17', detail: 'Mother and baby linked, with separate records.' },
      { name: 'Family planning', spec: '18', detail: 'Method, counselling, follow-up and side effects.' },
      { name: 'Child health', spec: '19', detail: 'Growth, development and nutrition over time.' },
      { name: 'Nutrition', spec: '20', detail: 'Assessments and progress across visits.' },
      { name: 'Immunisation', spec: '21', detail: 'Schedule worked out from date of birth, set by clinical administrators.' },
    ],
  },
  {
    title: 'Care coordination',
    note: 'Work that crosses departments and facilities.',
    items: [
      { name: 'Referrals module', spec: '22', detail: 'Created, sent, accepted, completed, returned or cancelled, with outcome.' },
      { name: 'Outreach', spec: '23', detail: 'Community visits, people reached, services given, follow-up.' },
      { name: 'Inpatient progress and nursing notes', spec: '8', detail: 'Daily notes, investigations and treatment plans on the ward.' },
      { name: 'Imaging requests and results', spec: '2, 11', detail: 'Requests and reports alongside laboratory results.' },
    ],
  },
  {
    title: 'Patients and communication',
    note: 'Everything patient-facing, using the same secure backend.',
    items: [
      { name: 'Patient portal and mobile app', spec: '24', detail: 'Each patient sees only their own records, appointments and bills.' },
      { name: 'SMS and WhatsApp delivery', spec: '12, 25', detail: 'Reminders are logged for now; real channels come later.' },
      { name: 'Configurable notifications', spec: '25', detail: 'Choose which events notify which roles.' },
    ],
  },
  {
    title: 'Before real patient data',
    note: 'Required before the hospital can use the system day to day.',
    items: [
      { name: 'Security hardening', spec: '30', detail: 'Security testing, encryption, backups and disaster recovery.' },
      { name: 'Staff and role management screen', spec: '4', detail: 'Create accounts and change roles without a developer.' },
      { name: 'Clinical validation', spec: '35', detail: 'Qualified clinical staff confirm terminology and workflows.' },
      { name: 'Regulatory compliance', spec: '30, 35', detail: 'Nigerian data protection and healthcare requirements.' },
    ],
  },
]

export default function RoadmapPage() {
  return (
    <>
      <PageHeader title="Roadmap" subtitle="What is built today, and what comes after it. Section numbers refer to the Product and Functional Specification." />

      <Card className="p-6">
        <h2 className="text-headline-md mb-4">Built today</h2>
        <ul className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-x-8 gap-y-3">
          {BUILT.map(([name, spec]) => (
            <li key={name} className="flex items-baseline justify-between gap-3 border-b border-outline-variant/40 pb-2 text-body-md">
              <span>{name}</span><span className="text-label-xs text-outline shrink-0">§ {spec}</span>
            </li>
          ))}
        </ul>
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {NEXT.map((g) => (
          <Card key={g.title} className="p-6">
            <h2 className="text-headline-md">{g.title}</h2>
            <p className="text-body-sm text-on-surface-variant mt-1 mb-5">{g.note}</p>
            <ul className="space-y-4">
              {g.items.map((i) => (
                <li key={i.name} className="flex gap-4">
                  <span className="w-14 shrink-0 text-label-xs text-outline pt-0.5">§ {i.spec}</span>
                  <span><span className="block font-medium">{i.name}</span><span className="block text-body-sm text-on-surface-variant">{i.detail}</span></span>
                </li>
              ))}
            </ul>
          </Card>
        ))}
      </div>

      <p className="text-label-xs text-outline">Hospital feedback decides the order of the next phases.</p>
    </>
  )
}
