# Data model and API contract (draft for team review)

Source of truth: `supabase/migrations/`. This file explains it for the frontend team.
Spec section numbers are in brackets. Demo only, fake data only.

## 1. Principles
- **One patient record.** Every table references `patients.id`. Nobody stores a second copy of name/DOB/phone [32].
- **The database enforces the rules** (permissions, bed uniqueness, stock, audit). The UI hides buttons for convenience, but never relies on that for safety.
- **Nothing is deleted.** No DELETE policy exists on any table. Corrections are new rows or updates, and every change lands in `audit_log` [27].
- **Writes that matter go through functions** (`supabase.rpc(...)`), reads use normal `supabase.from(...).select()`.
- **Real time:** subscribe with Supabase Realtime `postgres_changes`. RLS is applied to realtime, so users only receive rows they may read.

## 2. Roles [4]
`super_admin`, `hospital_admin`, `doctor`, `nurse`, `pharmacist`, `lab_scientist`, `receptionist`, `billing_officer`, `community_health`.
Get the current user's role: `select role, full_name from staff where id = auth.uid()`.

| Area | Read | Write |
|---|---|---|
| Patients, next of kin, visits, appointments | all staff | receptionist, doctor, nurse, admins (patients also community_health) |
| Allergies / medical history fields | all staff | doctor, nurse, community_health, admins only (DB trigger) |
| Vitals | doctor, nurse, community_health, admins | doctor, nurse, receptionist, community_health |
| Consultation, **diagnosis** | doctor, nurse, community_health, admins | **doctor only** |
| Lab requests | doctor, nurse, lab, admins | request: doctor; collect/result/finalise: lab_scientist |
| Lab results | lab/admins always; doctor/nurse **only when finalized** | lab_scientist |
| Drugs, prescriptions | doctor, nurse, pharmacist, admins | prescribe: doctor; dispense: pharmacist |
| Stock batches/movements | pharmacist, admins | via `receive_stock` / `dispense_prescription` |
| Admissions, beds | all staff read beds; admissions: doctor, nurse, receptionist, billing, admins | via `admit_patient` / `discharge_patient` |
| Medication record (MAR) | doctor, nurse, admins | nurse, via `record_medication` |
| Bills, payments | billing_officer, admins | billing_officer, admins |
| ANC | doctor, nurse, community_health, admins | same clinical roles |
| Notifications | own only | system |
| Audit log | admins | nobody (append-only) |

## 3. Tables (column names are final unless the team agrees a change by Day 3)
- **staff**(id, staff_code, full_name, role, department, position, active) · **staff_sessions**(staff_id, login_at, logout_at)
- **patients**(id, patient_code `PC-000001`, full_name, dob, sex, phone, address, allergies, medical_history)
- **next_of_kin**(patient_id, full_name, phone, relationship, relationship_other, is_emergency_contact)
- **visits**(id, patient_id, visit_type, department, complaint, status, doctor_id, checked_in_at, started_at, completed_at, disposition, follow_up_plan, feedback_rating, feedback_note) — the **waiting queue is `visits where status = 'waiting'`**
- **appointments**(id, patient_id, doctor_id, department, appt_type, scheduled_at, reason, status, visit_id)
- **vitals**(visit_id, patient_id, temperature_c, pulse, resp_rate, bp_systolic, bp_diastolic, weight_kg)
- **consultations**(visit_id, patient_id, doctor_id, notes, treatment) · **diagnoses**(visit_id, patient_id, diagnosis, entered_by)
- **services**(id, name, category, specimen_type, price) — consultation fee and lab test catalogue
- **lab_requests**(id, patient_id, visit_id, service_id, requested_by, status, specimen_type, collected_at, lab_source) · **lab_results**(lab_request_id, patient_id, result, reference_range, status, reviewed_by, finalized_at)
- **drugs**(id, name, unit, min_stock, unit_price) · **stock_batches**(drug_id, batch_number, expiry_date, quantity, supplier) · **stock_movements** (ledger)
- **prescriptions**(id, patient_id, visit_id, admission_id?, drug_id, dose, route, frequency, duration_days, quantity, status) · **dispensing**
- **wards**(name, daily_rate) · **beds**(ward_id, bed_number, status) · **admissions**(patient_id, visit_id, bed_id, doctor_id, nurse_id, diagnosis, status, admitted_at, discharged_at, discharge_summary)
- **medication_administrations**(admission_id, prescription_id, patient_id, scheduled_for, status `pending|given|missed|refused|held`, administered_by, administered_at, notes)
- **bills**(visit_id, payment_source) · **bill_items** · **payments**
- **anc_records**(patient_id unique, lmp, edd, gravida, parity, risk_factors) · **anc_visits**(anc_record_id, visit_date, gestational_weeks, bp, weight, fundal_height_cm, findings, follow_up_date)
- **notifications**(recipient_staff_id, type, title, body, patient_id, link, read_at)
- **audit_log**(at, actor_id, actor_name, actor_role, action, table_name, record_id, patient_id, old_data, new_data)

Views: `bill_summary` (total_billed, total_paid, balance, payment_status), `drug_stock_status` (quantity, stock_status `ok|low|out_of_stock`, nearest_expiry, expiring_soon).

## 4. Functions to call with `supabase.rpc(name, params)`
| Function | Who | Returns / behaviour |
|---|---|---|
| `record_login()` / `record_logout()` | any staff | session row [4] |
| `check_duplicate_patients(p_full_name, p_dob, p_phone)` | staff | rows of possible matches with `match_reason` |
| `register_patient(p_full_name, p_dob, p_sex, p_phone, p_address, p_kin_name, p_kin_phone, p_kin_relationship, p_kin_relationship_other, p_force)` | receptionist, clinical, admins | `{status:'created', patient_id, patient_code}` or `{status:'duplicate', matches:[...]}`. Show the alert; resend with `p_force:true` to create anyway |
| `check_in_patient(p_patient_id, p_visit_type, p_department, p_complaint)` | receptionist etc. | visit id; patient joins queue; **doctors are notified**. Errors if the patient already has an open visit |
| `start_consultation(p_visit_id)` | doctor | queue -> in_consultation |
| `complete_visit(p_visit_id, p_disposition, p_follow_up_plan)` | doctor | visit completed; consultation fee billed |
| `collect_specimen(p_request_id, p_specimen_type)` | lab | request -> collected |
| `enter_lab_result(p_request_id, p_result, p_reference_range)` | lab | request -> resulted |
| `finalize_lab_result(p_request_id)` | lab | result becomes visible to doctor/nurse; **requesting doctor notified** |
| `dispense_prescription(p_prescription_id)` | pharmacist | stock down (earliest expiry first), bill item added, low-stock alert if at/below minimum. Fails whole if stock is short |
| `receive_stock(p_drug_id, p_batch_number, p_expiry, p_quantity, p_supplier)` | pharmacist, admins | new batch |
| `generate_expiry_alerts(p_days)` | hospital_admin, super_admin, pharmacist (and pg_cron) | Runs daily at 06:00 Lagos via pg_cron. Notifies admins and pharmacists once per batch when it comes within `p_days` (default 90) of expiry, and once more if it expires with stock left. Returns the number of NEW alerts, so running it again returns 0 |
| `admit_patient(p_visit_id, p_bed_id, p_diagnosis, p_nurse_id)` | doctor, admins | admission id; bed -> occupied; nurses notified. Fails if bed taken |
| `record_medication(p_mar_id, p_status, p_notes)` | nurse | given/missed/refused/held with server-side user + time; note required unless given |
| `discharge_patient(p_admission_id, p_summary, p_payment_source, p_follow_up_at)` | doctor, admins | admission discharged, **bed released**, bed charge billed, optional follow-up appointment, billing notified |

Direct inserts the frontend still does with `.insert()`: `vitals`, `consultations`, `diagnoses` (doctor), `lab_requests` (doctor), `prescriptions` (doctor, set `admission_id` for inpatients so the nurse sees it on the MAR), `appointments`, `anc_records`, `anc_visits`, `payments` (billing).
Free-text status updates on queue/appointments are plain `.update()`.

## 5. Real-time channels to subscribe to
`visits` (queue, dashboard) · `beds` + `admissions` (bed board) · `lab_requests` + `lab_results` · `prescriptions` · `medication_administrations` · `notifications` (filter `recipient_staff_id=eq.<me>`) · `stock_batches` · `bills`/`payments`.

## 6. Open questions for the hospital/clinical reviewer
1. Should the same person be allowed to enter and finalise a lab result? (Demo: yes.)
2. Is a doctor's diagnosis final, or is a "provisional" state needed? (Demo: append-only entries.)
3. Which payment sources/prices should appear? (Demo values are placeholders in `supabase/seed.sql`.)
4. Can receptionists record vitals at registration, or only nurses? (Demo: both.)

## 7. Added in the second backend pass

### Dashboard views (read with `.from('<view>').select('*')`)
Re-query a view whenever the underlying table fires a real-time event (views themselves do not stream).
| View | Dashboard section | Re-query on events from |
|---|---|---|
| `dash_summary` (one row of tiles) | header tiles | visits, admissions, appointments, lab_requests, beds |
| `dash_inpatients` | A. active inpatients: ward, bed, diagnosis, doctor, nurse, admitted_at | admissions, beds |
| `dash_discharged` | B. completed visits/discharges. `payment_source` / `payment_status` are **null** unless the viewer is billing, receptionist or admin. Includes `feedback_rating` | visits, bills, payments |
| `dash_waiting` | C. queue with `waiting_minutes` and `appointment_status` | visits |
| `dash_admissions` | D. all admissions, active and past (`admission_status`) | admissions |
| `dash_lab` | E. doctor/nurse/lab/admin only. `result` filled only once finalised | lab_requests, lab_results |
| `dash_appointments_today` | F. today (Lagos time) | appointments |
| `dash_bed_summary` | G. per ward plus an `All wards` row: total, occupied, available, reserved, maintenance | beds |
| `drug_stock_status` | H. quantity, `stock_status` (`ok|low|out_of_stock`), nearest_expiry, expiring_soon | stock_batches |

### New functions
| Function | Who | Behaviour |
|---|---|---|
| `search_patients(p_query, p_limit)` | any staff | Matches Patient ID, name (typo-tolerant), phone (spaces/dashes ignored) and date of birth (`YYYY-MM-DD`). Returns `open_visit_status`, `is_admitted`, `next_appointment`, `score`. Needs 2+ characters |
| `check_in_appointment(p_appointment_id)` | receptionist, nurse, doctor, admins | Creates the queue visit, links it, notifies the doctor. Appointment status then follows the visit automatically (`waiting` -> `in_consultation` -> `completed`) |
| `report_summary(p_from, p_to, p_department, p_doctor_id, p_visit_type, p_service_id)` | hospital_admin, super_admin | One JSON object: visits, admissions, bed occupancy, appointments (completed/cancelled/no-show), lab workload, pharmacy usage, revenue (billed/paid/outstanding and by source), ANC, `daily_visits` series. Range limited to 366 days |
| `server_time()` | any | Database clock. Use this, not the browser/PC clock, when computing "today" for seed data or tests |

New booking: when an appointment is inserted with a `doctor_id`, that doctor gets an in-app notification.

### Scripts
- `node --env-file=.env scripts/reset-demo-data.mjs`: wipes activity, restocks drugs (Paracetamol = 100), frees beds, seeds 12 fake patients across every dashboard state (Michael Nelson is deliberately not seeded). Run before every rehearsal.
- `node --env-file=.env scripts/e2e-demo-flow.mjs`: 144 end-to-end checks. Run after a reset.
- `node --env-file=.env scripts/realtime-check.mjs`: 11 live cross-session checks.
- `node --env-file=.env scripts/permission-check.mjs`: 96 role-boundary checks (see Permission review below).

## 8. Added in the third backend pass (ANC wrapper and reminder scheduler)

### Antenatal care (spec 15), the pattern for the specialty modules
| Function / view | Who | Behaviour |
|---|---|---|
| `record_anc_visit(p_patient_id, p_visit_date, p_lmp, p_gravida, p_parity, p_risk_factors, p_gestational_weeks, p_complaints, p_bp_systolic, p_bp_diastolic, p_weight_kg, p_fundal_height_cm, p_findings, p_investigations, p_supplements, p_follow_up_date)` | doctor, nurse, community_health | Only `p_patient_id` is required. **First visit** opens the mother's ANC record and needs `p_lmp`; the EDD is calculated (LMP + 280 days). **Later visits** add to the same record; send `p_lmp`, `p_gravida`, `p_parity` or `p_risk_factors` only to correct them. Weeks are calculated from the LMP unless `p_gestational_weeks` is sent. Returns `{anc_record_id, anc_visit_id, record_created, edd, gestational_weeks}`. |
| `anc_summary` | same roles (admins read) | One row per mother: LMP, EDD, `weeks_now`, `days_to_edd`, gravida/parity, `visit_count`, latest visit (BP, weight, fundal height, findings), `next_follow_up`, `follow_up_overdue`. Re-query on events from `anc_visits` / `anc_records`. |

Rejected with a readable message: male patients, a visit date in the future or before the LMP, an LMP more than 300 days before the visit, a follow-up on or before the visit date, only one of the two BP values, systolic not above diastolic, parity not lower than gravida, weeks outside 0-45. The whole call is atomic, so a failed first visit leaves no half-created record. `anc_records` / `anc_visits` stay readable and writable directly, but use the function so these checks run.

### Reminder scheduler (spec 12, 25)
Demo delivery is the `reminders` table (a log, `channel = 'log'`) plus in-app notifications to staff. No SMS or WhatsApp. Only instructions a clinician already recorded are used.

`reminders`(id, kind `appointment|medication|anc_follow_up`, patient_id, appointment_id, prescription_id, anc_visit_id, due_at, message, channel, sent_at). Read-only through the API for receptionist, doctor, nurse, community_health and admins; subscribe to `reminders` for a live log screen.

| Kind | Sent when | Staff notification |
|---|---|---|
| `appointment` | Appointment is `scheduled`/`confirmed` and starts within 24 hours. One per appointment. | Assigned doctor: "Upcoming appointment" |
| `medication` | Home (non-inpatient) prescription that is **dispensed**, for each dose time from dispensing to the end of the course. Needs `duration_days` and a known frequency: OD (08:00), BD (08:00, 20:00), TDS (08:00, 14:00, 20:00), QDS (06:00, 12:00, 18:00, 22:00), Lagos time. Other wording (PRN, free text) gets none. A dose more than 2 hours late is skipped. | none |
| `anc_follow_up` | The latest ANC visit has a follow-up date of tomorrow. | Clinician who recorded that visit: "Antenatal follow-up tomorrow" |

| Function | Who | Behaviour |
|---|---|---|
| `run_reminders()` | hospital_admin, super_admin (and pg_cron / service role) | Creates whatever is due and returns `{appointments, medication, anc_follow_ups}` counts. Safe to run repeatedly: nothing is sent twice. Only the service role may pass `p_now` to set the clock (rehearsal and tests). |

pg_cron runs it every 5 minutes when the extension exists. Otherwise: `node --env-file=.env scripts/run-reminders.mjs --loop` (or without `--loop` for one run before a rehearsal).

`scripts/e2e-demo-flow.mjs` now has sections 14 (ANC) and 15 (reminders). The medication checks need `SUPABASE_SERVICE_ROLE_KEY` in `.env` and are skipped without it.

### Concurrent dispensing
`node --env-file=.env scripts/concurrency-dispense.mjs` (22 checks) fires real parallel `dispense_prescription` calls from separate pharmacist sessions: the same prescription dispensed by three at once, two prescriptions competing for stock that covers one, a fill split across two batches, and six prescriptions against 20 tablets. It uses its own test drug, so the Paracetamol 100 -> 90 demo number is untouched. Run `reset-demo-data.mjs` first. It was checked by temporarily removing the row locks: three simultaneous dispenses of one prescription then took stock from 100 to 70, so the test does detect the race it guards against.

### Automatic expiry alerts (spec 14)
`generate_expiry_alerts()` is scheduled daily (pg_cron job `expiry-alerts`). `expiry_alerts_sent` remembers which batch was reported at which stage (`approaching` / `expired`), so scheduling it never repeats a notice. Notification types: `expiry`, titled "Drug approaching expiry" or "Drug batch expired". Expired batches are already excluded from `drug_stock_status.quantity` and from dispensing. e2e section 16 covers it; the expired-batch checks need `SUPABASE_SERVICE_ROLE_KEY`.

### Audit coverage (spec 27)
Every table that holds patient, clinical, stock, billing or staff data writes to `audit_log`, including `wards`, `services` (price changes), `staff_sessions` (logins and logouts) and `reminders`. `notifications` and `expiry_alerts_sent` are not audited on purpose: they are by-products of events that already are. e2e section 18 covers it.

### Permission review
`node --env-file=.env scripts/permission-check.mjs` (96 checks, run after a reset) logs in as each role and tries what that role must not be able to do: write a diagnosis, prescribe, dispense, skip the lab or queue steps, read billing or the audit log, delete anything, promote itself, or act while signed out. It found three holes that row-level security alone cannot close (it controls who may write, not which values), now fixed by guard triggers:
- A doctor could insert a prescription already `dispensed`. New prescriptions must be `prescribed`, and a doctor can only change that to `cancelled`.
- A doctor could insert a lab request already `finalized`. New lab requests always start as `requested`.
- A receptionist or nurse could set a visit's disposition or mark it `completed` (skipping the consultation fee). They can now only cancel a visit; start and complete go through the doctor's functions.

Known and accepted for the demo: a doctor may edit a prescription's dose or quantity before it is dispensed (audited); admins can edit any staff role.

### Review of `dispense_prescription`
Reviewed by the project owner (no second backend developer available). Row locks are taken in a fixed order (prescription, then batches by expiry) so concurrent dispenses queue instead of deadlocking; a short fill rolls the whole call back; expired batches are skipped; stock, ledger, dispensing rows, bill item and low-stock alert are written in one transaction. `concurrency-dispense.mjs` (22 checks) exercises the race. Limits left as they are: expiry is compared with the database date (UTC, so up to an hour off Lagos midnight), and the low-stock alert repeats on every dispense while stock stays at or below the minimum.
