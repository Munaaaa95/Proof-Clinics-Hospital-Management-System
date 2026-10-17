-- Row-level security (spec sections 4, 30). Default deny: a table with RLS on and no policy is closed.
-- Nothing is ever deletable through the API (no DELETE policies): records are history (section 27).
-- Sensitive state changes (dispense, admit, discharge, give medication, finalise lab) go through
-- SECURITY DEFINER functions in the next migration, so most tables have no direct UPDATE policy.

do $$
declare t text;
begin
  foreach t in array array[
    'staff', 'staff_sessions', 'patients', 'next_of_kin', 'visits', 'appointments', 'vitals', 'consultations',
    'diagnoses', 'services', 'lab_requests', 'lab_results', 'drugs', 'stock_batches', 'stock_movements',
    'wards', 'beds', 'admissions', 'prescriptions', 'dispensing', 'medication_administrations',
    'bills', 'bill_items', 'payments', 'anc_records', 'anc_visits', 'notifications', 'audit_log'
  ] loop
    execute format('alter table %I enable row level security', t);
  end loop;
end $$;

-- Role shorthands used below:
--   admin      = super_admin, hospital_admin
--   clinical   = doctor, nurse, community_health
-- (written out in each policy so each policy reads on its own)

-- ------------------------------------------------------------ staff
create policy staff_read on staff for select to authenticated
  using (app_role() is not null);
create policy staff_admin_write on staff for insert to authenticated
  with check (has_role('super_admin', 'hospital_admin'));
create policy staff_admin_update on staff for update to authenticated
  using (has_role('super_admin', 'hospital_admin'))
  with check (has_role('super_admin', 'hospital_admin'));

create policy sessions_own_read on staff_sessions for select to authenticated
  using (staff_id = auth.uid() or has_role('super_admin', 'hospital_admin'));
-- inserts/updates happen via record_login()/record_logout()

-- ------------------------------------------------------------ patients and next of kin
create policy patients_read on patients for select to authenticated
  using (app_role() is not null);
create policy patients_insert on patients for insert to authenticated
  with check (has_role('receptionist', 'doctor', 'nurse', 'community_health', 'hospital_admin', 'super_admin'));
create policy patients_update on patients for update to authenticated
  using (has_role('receptionist', 'doctor', 'nurse', 'community_health', 'hospital_admin', 'super_admin'))
  with check (has_role('receptionist', 'doctor', 'nurse', 'community_health', 'hospital_admin', 'super_admin'));

create policy kin_read on next_of_kin for select to authenticated
  using (app_role() is not null);
create policy kin_write on next_of_kin for insert to authenticated
  with check (has_role('receptionist', 'doctor', 'nurse', 'community_health', 'hospital_admin', 'super_admin'));
create policy kin_update on next_of_kin for update to authenticated
  using (has_role('receptionist', 'doctor', 'nurse', 'community_health', 'hospital_admin', 'super_admin'));

-- ------------------------------------------------------------ visits, queue, appointments
create policy visits_read on visits for select to authenticated
  using (app_role() is not null);
create policy visits_insert on visits for insert to authenticated
  with check (has_role('receptionist', 'doctor', 'nurse', 'hospital_admin', 'super_admin'));
create policy visits_update on visits for update to authenticated
  using (has_role('receptionist', 'doctor', 'nurse', 'hospital_admin', 'super_admin'))
  with check (has_role('receptionist', 'doctor', 'nurse', 'hospital_admin', 'super_admin'));

create policy appointments_read on appointments for select to authenticated
  using (app_role() is not null);
create policy appointments_insert on appointments for insert to authenticated
  with check (has_role('receptionist', 'doctor', 'hospital_admin', 'super_admin'));
create policy appointments_update on appointments for update to authenticated
  using (has_role('receptionist', 'doctor', 'nurse', 'hospital_admin', 'super_admin'))
  with check (has_role('receptionist', 'doctor', 'nurse', 'hospital_admin', 'super_admin'));

-- ------------------------------------------------------------ clinical notes
create policy vitals_read on vitals for select to authenticated
  using (has_role('doctor', 'nurse', 'community_health', 'hospital_admin', 'super_admin'));
create policy vitals_insert on vitals for insert to authenticated
  with check (has_role('doctor', 'nurse', 'receptionist', 'community_health'));

create policy consultations_read on consultations for select to authenticated
  using (has_role('doctor', 'nurse', 'community_health', 'hospital_admin', 'super_admin'));
create policy consultations_insert on consultations for insert to authenticated
  with check (has_role('doctor') and doctor_id = auth.uid());
create policy consultations_update on consultations for update to authenticated
  using (has_role('doctor') and doctor_id = auth.uid())
  with check (has_role('doctor') and doctor_id = auth.uid());

-- Diagnosis: ONLY doctors can create (section 5). Corrections are new rows; history stays.
create policy diagnoses_read on diagnoses for select to authenticated
  using (has_role('doctor', 'nurse', 'community_health', 'hospital_admin', 'super_admin'));
create policy diagnoses_insert on diagnoses for insert to authenticated
  with check (has_role('doctor') and entered_by = auth.uid());

-- ------------------------------------------------------------ laboratory
create policy services_read on services for select to authenticated
  using (app_role() is not null);
create policy services_admin_write on services for all to authenticated
  using (has_role('super_admin', 'hospital_admin'))
  with check (has_role('super_admin', 'hospital_admin'));

create policy lab_requests_read on lab_requests for select to authenticated
  using (has_role('doctor', 'nurse', 'lab_scientist', 'hospital_admin', 'super_admin'));
create policy lab_requests_insert on lab_requests for insert to authenticated
  with check (has_role('doctor') and requested_by = auth.uid());
create policy lab_requests_update on lab_requests for update to authenticated
  using (has_role('lab_scientist', 'hospital_admin', 'super_admin'))
  with check (has_role('lab_scientist', 'hospital_admin', 'super_admin'));

-- Lab sees every result; clinicians see a result only once it is finalised (section 13).
create policy lab_results_read on lab_results for select to authenticated
  using (
    has_role('lab_scientist', 'hospital_admin', 'super_admin')
    or (has_role('doctor', 'nurse') and status = 'finalized')
  );
create policy lab_results_insert on lab_results for insert to authenticated
  with check (has_role('lab_scientist') and entered_by = auth.uid());
create policy lab_results_update on lab_results for update to authenticated
  using (has_role('lab_scientist') and status <> 'finalized')
  with check (has_role('lab_scientist'));

-- ------------------------------------------------------------ pharmacy
create policy drugs_read on drugs for select to authenticated
  using (has_role('doctor', 'nurse', 'pharmacist', 'billing_officer', 'hospital_admin', 'super_admin'));
create policy drugs_write on drugs for insert to authenticated
  with check (has_role('pharmacist', 'hospital_admin', 'super_admin'));
create policy drugs_update on drugs for update to authenticated
  using (has_role('pharmacist', 'hospital_admin', 'super_admin'))
  with check (has_role('pharmacist', 'hospital_admin', 'super_admin'));

create policy stock_batches_read on stock_batches for select to authenticated
  using (has_role('pharmacist', 'hospital_admin', 'super_admin'));
-- Receiving stock goes through receive_stock(); dispensing through dispense_prescription().
create policy stock_movements_read on stock_movements for select to authenticated
  using (has_role('pharmacist', 'hospital_admin', 'super_admin'));

create policy prescriptions_read on prescriptions for select to authenticated
  using (has_role('doctor', 'nurse', 'pharmacist', 'hospital_admin', 'super_admin'));
create policy prescriptions_insert on prescriptions for insert to authenticated
  with check (has_role('doctor') and prescribed_by = auth.uid());
create policy prescriptions_update on prescriptions for update to authenticated
  using (has_role('doctor') and prescribed_by = auth.uid() and status = 'prescribed')
  with check (has_role('doctor') and status in ('prescribed', 'cancelled'));

create policy dispensing_read on dispensing for select to authenticated
  using (has_role('pharmacist', 'doctor', 'hospital_admin', 'super_admin'));

-- ------------------------------------------------------------ wards, beds, admissions, MAR
create policy wards_read on wards for select to authenticated
  using (app_role() is not null);
create policy wards_admin_write on wards for all to authenticated
  using (has_role('super_admin', 'hospital_admin'))
  with check (has_role('super_admin', 'hospital_admin'));

create policy beds_read on beds for select to authenticated
  using (app_role() is not null);
-- Admins can mark a bed under maintenance/reserved; occupied/available flips only via admit/discharge.
create policy beds_admin_update on beds for update to authenticated
  using (has_role('super_admin', 'hospital_admin') and status in ('available', 'reserved', 'maintenance'))
  with check (has_role('super_admin', 'hospital_admin') and status in ('available', 'reserved', 'maintenance'));
create policy beds_admin_insert on beds for insert to authenticated
  with check (has_role('super_admin', 'hospital_admin'));

create policy admissions_read on admissions for select to authenticated
  using (has_role('doctor', 'nurse', 'receptionist', 'billing_officer', 'hospital_admin', 'super_admin'));
-- Admit/discharge only through admit_patient()/discharge_patient().

create policy mar_read on medication_administrations for select to authenticated
  using (has_role('doctor', 'nurse', 'hospital_admin', 'super_admin'));
create policy mar_schedule on medication_administrations for insert to authenticated
  with check (has_role('doctor', 'nurse') and status = 'pending');
-- Giving/missing/refusing/holding a dose only through record_medication().

-- ------------------------------------------------------------ billing (restricted, section 26)
create policy bills_read on bills for select to authenticated
  using (has_role('billing_officer', 'hospital_admin', 'super_admin'));
create policy bills_update on bills for update to authenticated
  using (has_role('billing_officer', 'hospital_admin', 'super_admin'))
  with check (has_role('billing_officer', 'hospital_admin', 'super_admin'));
create policy bill_items_read on bill_items for select to authenticated
  using (has_role('billing_officer', 'hospital_admin', 'super_admin'));
create policy bill_items_insert on bill_items for insert to authenticated
  with check (has_role('billing_officer', 'hospital_admin', 'super_admin'));
create policy payments_read on payments for select to authenticated
  using (has_role('billing_officer', 'hospital_admin', 'super_admin'));
create policy payments_insert on payments for insert to authenticated
  with check (has_role('billing_officer', 'hospital_admin', 'super_admin') and recorded_by = auth.uid());

-- ------------------------------------------------------------ ANC
create policy anc_records_read on anc_records for select to authenticated
  using (has_role('doctor', 'nurse', 'community_health', 'hospital_admin', 'super_admin'));
create policy anc_records_write on anc_records for insert to authenticated
  with check (has_role('doctor', 'nurse', 'community_health'));
create policy anc_records_update on anc_records for update to authenticated
  using (has_role('doctor', 'nurse', 'community_health'))
  with check (has_role('doctor', 'nurse', 'community_health'));
create policy anc_visits_read on anc_visits for select to authenticated
  using (has_role('doctor', 'nurse', 'community_health', 'hospital_admin', 'super_admin'));
create policy anc_visits_write on anc_visits for insert to authenticated
  with check (has_role('doctor', 'nurse', 'community_health'));

-- ------------------------------------------------------------ notifications (own only)
create policy notifications_own_read on notifications for select to authenticated
  using (recipient_staff_id = auth.uid());
create policy notifications_own_update on notifications for update to authenticated
  using (recipient_staff_id = auth.uid())
  with check (recipient_staff_id = auth.uid());

-- ------------------------------------------------------------ audit (admins read only)
create policy audit_admin_read on audit_log for select to authenticated
  using (has_role('super_admin', 'hospital_admin'));

-- Defence in depth: the anonymous role gets nothing.
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke execute on all functions in schema public from anon;
