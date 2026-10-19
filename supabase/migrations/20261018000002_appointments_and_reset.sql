-- Appointment automation (spec 7, 25) and demo reset helpers (build plan: junior backend scope).

-- ---------------------------------------------------------------- server-side jobs may set clinical fields
-- auth.uid() is null only for the service role / database owner (seed and reset scripts), never for a logged-in user.
create or replace function guard_patient_clinical_fields() returns trigger
language plpgsql as $$
begin
  if auth.uid() is null or public.has_role('doctor', 'nurse', 'hospital_admin', 'super_admin', 'community_health') then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.allergies is not null or new.medical_history is not null then
      raise exception 'Only clinical staff can record allergies or medical history' using errcode = '42501';
    end if;
  elsif new.allergies is distinct from old.allergies
     or new.medical_history is distinct from old.medical_history then
    raise exception 'Only clinical staff can edit allergies or medical history' using errcode = '42501';
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------- appointments
-- The assigned doctor is told about a new appointment.
create or replace function appointments_after_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.doctor_id is not null then
    perform public.notify_staff(new.doctor_id, 'appointment', 'New appointment',
      public.patient_label(new.patient_id) || ' - ' ||
      to_char(new.scheduled_at at time zone 'Africa/Lagos', 'DD Mon HH24:MI') ||
      coalesce(' - ' || new.reason, ''),
      new.patient_id, '/appointments');
  end if;
  return new;
end $$;
create trigger appointments_notify_doctor after insert on appointments
  for each row execute function appointments_after_insert();

-- Patient arrives for a booked appointment: creates the visit (queue entry), links it, notifies the doctor.
create or replace function check_in_appointment(p_appointment_id uuid) returns uuid
language plpgsql as $$
declare a appointments; v_visit uuid;
begin
  if not has_role('receptionist', 'nurse', 'doctor', 'hospital_admin', 'super_admin') then
    raise exception 'Not allowed to check patients in' using errcode = '42501';
  end if;
  select * into a from appointments where id = p_appointment_id for update;
  if not found or a.status not in ('scheduled', 'confirmed') then
    raise exception 'Appointment cannot be checked in (status: %)', coalesce(a.status::text, 'not found');
  end if;
  v_visit := check_in_patient(a.patient_id, 'outpatient', a.department, a.reason);
  update appointments set status = 'waiting', visit_id = v_visit where id = a.id;
  return v_visit;
end $$;

-- Keep the appointment status in step with the visit it belongs to.
create or replace function visits_sync_appointment() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status is distinct from old.status and new.status <> 'waiting' then
    update public.appointments
       set status = case new.status
                      when 'in_consultation' then 'in_consultation'::appointment_status
                      when 'completed' then 'completed'::appointment_status
                      when 'cancelled' then 'cancelled'::appointment_status
                    end
     where visit_id = new.id and status not in ('cancelled', 'no_show', 'rescheduled');
  end if;
  return new;
end $$;
create trigger visits_sync_appointment_status after update on visits
  for each row execute function visits_sync_appointment();

revoke execute on function check_in_appointment(uuid) from public, anon;
grant execute on function check_in_appointment(uuid) to authenticated;

-- ---------------------------------------------------------------- demo reset (service role only)
-- Empties all activity and puts reference data back to its starting state. Staff, services, drugs, wards
-- and beds are kept. Patients are removed too: scripts/reset-demo-data.mjs re-seeds fake ones.
-- TRUNCATE is used because rows are deliberately not deletable through the API.
create or replace function reset_demo_data() returns void
language plpgsql security definer set search_path = public as $$
begin
  truncate table
    dispensing, stock_movements, medication_administrations, prescriptions, lab_results, lab_requests,
    diagnoses, consultations, vitals, payments, bill_items, bills, admissions, appointments, visits,
    anc_visits, anc_records, next_of_kin, patients, stock_batches
  restart identity cascade;

  perform setval('patient_code_seq', 1, false);
  update beds set status = 'available';

  -- Same starting stock as supabase/seed.sql (Paracetamol exactly 100 so the demo shows 100 -> 90).
  insert into stock_batches (drug_id, batch_number, expiry_date, quantity, supplier)
  select d.id, 'B-' || upper(left(md5(d.name), 5)),
         case when d.name like 'ORS%' then current_date + 45 else current_date + 540 end,
         case d.name when 'Paracetamol 500mg' then 100 when 'ORS Sachet' then 25 else 150 end,
         'Demo Supplier Ltd'
  from drugs d;
end $$;

-- Call after seeding so the audit log, notifications and sessions start clean for the demo.
create or replace function clear_activity_logs() returns void
language plpgsql security definer set search_path = public as $$
begin
  truncate table audit_log, notifications, staff_sessions restart identity;
end $$;

revoke all on function reset_demo_data(), clear_activity_logs() from public, anon, authenticated;
grant execute on function reset_demo_data(), clear_activity_logs() to service_role;
