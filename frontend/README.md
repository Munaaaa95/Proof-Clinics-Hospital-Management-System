# Proof Clinics HMS: frontend

Next.js 15 (App Router) + Tailwind + `@supabase/supabase-js`. It talks straight to the Supabase backend in `../supabase`;
there is no server code of its own. Every query runs as the signed-in staff member, so the database's row-level
security decides what each role sees and may do. The menu only hides links a role cannot use.

Student prototype. Fake patient data only.

## Run it

```
cd frontend
npm install
```

Create `frontend/.env.local` (git-ignored) with the two public values from the Supabase project:

```
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=<publishable / anon key>
```

For the local stack run `npx supabase start` in the repo root, then `npx supabase status` shows both values. For the
cloud project use its URL and anon key. Then:

```
npm run dev
```

and open http://localhost:3000. Demo accounts are created by `scripts/create-demo-users.mjs`
(`admin@`, `reception@`, `doctor@`, `nurse@`, `lab@`, `pharmacy@`, `billing@`, `community@proofclinics.test`, all with
`DEMO_PASSWORD`). Run `node --env-file=.env scripts/reset-demo-data.mjs` from the repo root before every rehearsal.

`npm run build` makes the production build, `npm run typecheck` checks the types.

## Screens

All 18 screens from `design-system-and-checklist.txt` are built: login, dashboard (tiles A to F open their lists),
registration with the duplicate alert, queue, appointments, consultation, laboratory, pharmacy, inpatient beds,
medication record, discharge, billing, audit log, patient profile, notifications, search, reports and antenatal care.
Also built from the spec: the reminder log (spec 12, 25), patient feedback on completed visits (3B), vital signs at registration or
from the queue by a nurse or receptionist (5, 11), Available Beds and Drug Stock sections on the dashboard (3G, 3H), stock
history per drug in the pharmacy (14).

| Route | Who sees it in the menu |
|---|---|
| `/dashboard` | everyone |
| `/registration`, `/queue`, `/appointments` | receptionist, doctor, nurse, admin |
| `/reminders` | receptionist, doctor, nurse, community health, admin (only admins can run the scheduler) |
| `/consultation` | doctor, admin |
| `/laboratory` | lab, doctor, nurse, admin |
| `/pharmacy` | pharmacist, admin |
| `/inpatient`, `/medication-record` | doctor, nurse, admin (medication record also nurse) |
| `/antenatal-care` | doctor, nurse, community health, admin |
| `/billing` | billing, receptionist (payment status only), admin |
| `/reports`, `/audit-log` | admin |
| `/patients/[id]`, `/discharge/[id]`, `/search`, `/notifications` | reached from the app, open to all staff |

## How it is put together

- `src/lib/supabase.ts` the one browser client. `src/lib/auth.tsx` sign-in, `record_login()` / `record_logout()`, current staff row.
- `src/lib/hooks.ts` `useQuery(loader, deps, tables)` loads data and quietly reloads it when Supabase Realtime reports a
  change on any of the listed tables (this is how the queue, dashboard, bed board and bell stay live).
- `src/lib/roles.ts` role names and the menu rules. `src/lib/notify.ts` notification types and links.
- `src/components/ui.tsx` the design-system pieces (buttons, pills, tables, tabs, modal, drawer, toasts, loading/empty/error states).
  Colours, type scale, spacing and radius are in `tailwind.config.ts`, copied from the mockups' Tailwind config.
- Writes that matter call the database functions (`register_patient`, `check_in_patient`, `start_consultation`,
  `complete_visit`, `enter_lab_result`, `finalize_lab_result`, `dispense_prescription`, `receive_stock`, `admit_patient`,
  `record_medication`, `discharge_patient`, `record_anc_visit`, `search_patients`, `report_summary`). Their error
  messages are shown to the user as they come from the database.
- Times are shown in Lagos time. Appointment and report dates are sent with the `+01:00` offset.

## Things worth knowing

- Diagnoses, lab requests and prescriptions are never deleted (the database has no delete). A prescription can be cancelled
  before it is dispensed; a diagnosis is corrected by adding a new entry.
- Prescription frequency is stored as `OD`, `BD`, `TDS`, `QDS`, `PRN` or `STAT`. The reminder scheduler only understands
  the first four.
- Rescheduling an appointment keeps the old one as `rescheduled` and books a new one.
- Receptionists cannot read bills (row-level security), so their Billing page shows payment status of completed visits only.
- The desktop layout is the target (fixed 240px sidebar). It is not designed for phones.
