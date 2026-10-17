-- Business logic: the "enter once, flows everywhere" automation (spec sections 25, 31, 33).
-- Anything that must be atomic or must not be spoofable runs in the database, not in the browser.

-- ---------------------------------------------------------------- internal helpers
create or replace function notify_roles(
  p_roles staff_role[], p_type text, p_title text, p_body text default null,
  p_patient_id uuid default null, p_link text default null
) returns void language sql security definer set search_path = public as $$
  insert into public.notifications (recipient_staff_id, type, title, body, patient_id, link)
  select s.id, p_type, p_title, p_body, p_patient_id, p_link
  from public.staff s where s.active and s.role = any (p_roles);
$$;

create or replace function notify_staff(
  p_staff_id uuid, p_type text, p_title text, p_body text default null,
  p_patient_id uuid default null, p_link text default null
) returns void language sql security definer set search_path = public as $$
  insert into public.notifications (recipient_staff_id, type, title, body, patient_id, link)
  values (p_staff_id, p_type, p_title, p_body, p_patient_id, p_link);
$$;

-- Adds a charge to the visit's bill, creating the bill on first use.
create or replace function add_bill_item(
  p_patient_id uuid, p_visit_id uuid, p_category text, p_description text,
  p_quantity numeric, p_unit_price numeric
) returns void language plpgsql security definer set search_path = public as $$
declare v_bill uuid;
begin
  insert into public.bills (patient_id, visit_id) values (p_patient_id, p_visit_id)
    on conflict (visit_id) do nothing;
  select id into v_bill from public.bills where visit_id = p_visit_id;
  insert into public.bill_items (bill_id, patient_id, category, description, quantity, unit_price)
  values (v_bill, p_patient_id, p_category, p_description, p_quantity, p_unit_price);
end $$;

create or replace function patient_label(p_patient_id uuid) returns text
language sql stable security definer set search_path = public as $$
  select full_name || ' (' || patient_code || ')' from public.patients where id = p_patient_id
$$;

-- ---------------------------------------------------------------- sessions (section 4)
create or replace function record_login() returns uuid
language sql security definer set search_path = public as $$
  insert into public.staff_sessions (staff_id) select id from public.staff where id = auth.uid() and active
  returning id
$$;

create or replace function record_logout() returns void
language sql security definer set search_path = public as $$
  update public.staff_sessions set logout_at = now() where staff_id = auth.uid() and logout_at is null
$$;

-- ---------------------------------------------------------------- registration + duplicate check (sections 2, 5)
create or replace function normalise_name(p text) returns text
language sql immutable as $$ select lower(btrim(regexp_replace(coalesce(p, ''), '\s+', ' ', 'g'))) $$;

create or replace function check_duplicate_patients(p_full_name text, p_dob date, p_phone text default null)
returns table (patient_id uuid, patient_code text, full_name text, dob date, phone text, match_reason text)
language sql stable as $$
  select * from (
    select p.id, p.patient_code, p.full_name, p.dob, p.phone,
      case
        when normalise_name(p.full_name) = normalise_name(p_full_name) and p.dob = p_dob
          then 'Same name and date of birth'
        when length(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g')) >= 7
         and regexp_replace(coalesce(p.phone, ''), '\D', '', 'g') = regexp_replace(p_phone, '\D', '', 'g')
          then 'Same phone number'
        when p.dob = p_dob and extensions.similarity(lower(p.full_name), normalise_name(p_full_name)) >= 0.6
          then 'Similar name and same date of birth'
      end as reason
    from public.patients p
  ) m
  where m.reason is not null
$$;

create or replace function register_patient(
  p_full_name text, p_dob date, p_sex sex_type, p_phone text, p_address text,
  p_kin_name text, p_kin_phone text, p_kin_relationship kin_relationship,
  p_kin_relationship_other text default null,
  p_force boolean default false
) returns jsonb language plpgsql as $$
declare v_matches jsonb; v_id uuid; v_code text;
begin
  if not has_role('receptionist', 'doctor', 'nurse', 'community_health', 'hospital_admin', 'super_admin') then
    raise exception 'Not allowed to register patients' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(to_jsonb(d)), '[]'::jsonb) into v_matches
  from check_duplicate_patients(p_full_name, p_dob, p_phone) d;

  if jsonb_array_length(v_matches) > 0 and not p_force then
    return jsonb_build_object('status', 'duplicate', 'matches', v_matches);
  end if;

  insert into patients (full_name, dob, sex, phone, address)
  values (btrim(p_full_name), p_dob, p_sex, nullif(btrim(p_phone), ''), nullif(btrim(p_address), ''))
  returning id, patient_code into v_id, v_code;

  insert into next_of_kin (patient_id, full_name, phone, relationship, relationship_other)
  values (v_id, p_kin_name, p_kin_phone, p_kin_relationship, p_kin_relationship_other);

  return jsonb_build_object('status', 'created', 'patient_id', v_id, 'patient_code', v_code);
end $$;

-- ---------------------------------------------------------------- queue / visits (sections 6, 7, 11)
create or replace function check_in_patient(
  p_patient_id uuid, p_visit_type visit_type default 'outpatient',
  p_department text default 'General', p_complaint text default null
) returns uuid language plpgsql as $$
declare v_id uuid;
begin
  if exists (select 1 from visits where patient_id = p_patient_id and status in ('waiting', 'in_consultation')) then
    raise exception 'This patient already has an open visit' using errcode = '23505';
  end if;
  insert into visits (patient_id, visit_type, department, complaint)
  values (p_patient_id, p_visit_type, coalesce(p_department, 'General'), p_complaint)
  returning id into v_id;
  return v_id;
end $$;

create or replace function start_consultation(p_visit_id uuid) returns void
language plpgsql as $$
begin
  if not has_role('doctor') then
    raise exception 'Only doctors start consultations' using errcode = '42501';
  end if;
  update visits set status = 'in_consultation', doctor_id = auth.uid(), started_at = now()
  where id = p_visit_id and status = 'waiting';
  if not found then raise exception 'Visit is not waiting'; end if;
end $$;

create or replace function complete_visit(
  p_visit_id uuid, p_disposition disposition_type, p_follow_up_plan text default null
) returns void language plpgsql as $$
begin
  if not has_role('doctor') then
    raise exception 'Only doctors complete visits' using errcode = '42501';
  end if;
  update visits set status = 'completed', completed_at = now(), disposition = p_disposition,
         follow_up_plan = p_follow_up_plan
  where id = p_visit_id and status = 'in_consultation';
  if not found then raise exception 'Visit is not in consultation'; end if;
end $$;

-- Queue notification and consultation fee
create or replace function visits_after_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'waiting' then
    perform public.notify_roles(array['doctor']::staff_role[], 'queue',
      'New patient waiting for consultation', public.patient_label(new.patient_id) || ' - ' || coalesce(new.complaint, 'no complaint recorded'),
      new.patient_id, '/queue');
  end if;
  return new;
end $$;
create trigger visits_notify_new after insert on visits
  for each row execute function visits_after_insert();

create or replace function visits_after_complete() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_fee record;
begin
  if new.status = 'completed' and old.status <> 'completed' and new.visit_type = 'outpatient' then
    select * into v_fee from public.services where category = 'consultation' order by name limit 1;
    if found then
      perform public.add_bill_item(new.patient_id, new.id, 'consultation', v_fee.name, 1, v_fee.price);
    end if;
  end if;
  return new;
end $$;
create trigger visits_bill_consultation after update on visits
  for each row execute function visits_after_complete();

-- ---------------------------------------------------------------- laboratory (section 13)
create or replace function lab_requests_before_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  select specimen_type into new.specimen_type from public.services where id = new.service_id;
  return new;
end $$;
create trigger lab_requests_defaults before insert on lab_requests
  for each row execute function lab_requests_before_insert();

create or replace function lab_requests_after_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_svc record;
begin
  select * into v_svc from public.services where id = new.service_id;
  perform public.notify_roles(array['lab_scientist']::staff_role[], 'lab_request',
    'New laboratory request', v_svc.name || ' - ' || public.patient_label(new.patient_id), new.patient_id, '/lab');
  perform public.add_bill_item(new.patient_id, new.visit_id, 'lab', v_svc.name, 1, v_svc.price);
  return new;
end $$;
create trigger lab_requests_notify_bill after insert on lab_requests
  for each row execute function lab_requests_after_insert();

create or replace function collect_specimen(p_request_id uuid, p_specimen_type text default null) returns void
language plpgsql as $$
begin
  if not has_role('lab_scientist') then
    raise exception 'Only laboratory staff record specimens' using errcode = '42501';
  end if;
  update lab_requests
     set status = 'collected', collected_at = now(), collected_by = auth.uid(),
         specimen_type = coalesce(nullif(btrim(p_specimen_type), ''), specimen_type)
   where id = p_request_id and status = 'requested';
  if not found then raise exception 'Request is not awaiting collection'; end if;
end $$;

create or replace function enter_lab_result(p_request_id uuid, p_result text, p_reference_range text default null)
returns void language plpgsql as $$
declare v_req lab_requests;
begin
  if not has_role('lab_scientist') then
    raise exception 'Only laboratory staff enter results' using errcode = '42501';
  end if;
  select * into v_req from lab_requests where id = p_request_id for update;
  if not found or v_req.status not in ('collected', 'resulted') then
    raise exception 'Record the specimen before entering a result';
  end if;
  insert into lab_results (lab_request_id, patient_id, result, reference_range)
  values (p_request_id, v_req.patient_id, p_result, p_reference_range)
  on conflict (lab_request_id) do update
    set result = excluded.result, reference_range = excluded.reference_range,
        entered_by = auth.uid(), entered_at = now();
  update lab_requests set status = 'resulted' where id = p_request_id;
end $$;

create or replace function finalize_lab_result(p_request_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_req public.lab_requests; v_name text;
begin
  if not public.has_role('lab_scientist') then
    raise exception 'Only laboratory staff finalise results' using errcode = '42501';
  end if;
  select * into v_req from public.lab_requests where id = p_request_id for update;
  if not found or v_req.status <> 'resulted' then
    raise exception 'No result entered for this request';
  end if;
  update public.lab_results
     set status = 'finalized', reviewed_by = auth.uid(), finalized_at = now()
   where lab_request_id = p_request_id;
  update public.lab_requests set status = 'finalized' where id = p_request_id;
  select name into v_name from public.services where id = v_req.service_id;
  perform public.notify_staff(v_req.requested_by, 'lab_result', 'Laboratory result finalized',
    v_name || ' - ' || public.patient_label(v_req.patient_id), v_req.patient_id, '/patients/' || v_req.patient_id);
end $$;

-- ---------------------------------------------------------------- prescriptions and MAR (sections 9, 14)
create or replace function prescriptions_after_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_drug text;
begin
  select name into v_drug from public.drugs where id = new.drug_id;
  perform public.notify_roles(array['pharmacist']::staff_role[], 'prescription',
    'Prescription ready for dispensing', v_drug || ' - ' || public.patient_label(new.patient_id), new.patient_id, '/pharmacy');
  if new.admission_id is not null then
    insert into public.medication_administrations (admission_id, prescription_id, patient_id)
    values (new.admission_id, new.id, new.patient_id);
    perform public.notify_roles(array['nurse']::staff_role[], 'medication_due',
      'Patient medication due', v_drug || ' - ' || public.patient_label(new.patient_id), new.patient_id, '/inpatients');
  end if;
  return new;
end $$;
create trigger prescriptions_notify_mar after insert on prescriptions
  for each row execute function prescriptions_after_insert();

-- GIVE / missed / refused / held. The acting user and time come from the server, not the client.
create or replace function record_medication(p_mar_id uuid, p_status mar_status, p_notes text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.has_role('nurse') then
    raise exception 'Only nurses record medication administration' using errcode = '42501';
  end if;
  if p_status = 'pending' then raise exception 'Choose given, missed, refused or held'; end if;
  if p_status <> 'given' and nullif(btrim(coalesce(p_notes, '')), '') is null then
    raise exception 'Add a note explaining why the dose was %', p_status;
  end if;
  update public.medication_administrations
     set status = p_status, administered_by = auth.uid(), administered_at = now(), notes = p_notes
   where id = p_mar_id and status = 'pending';
  if not found then raise exception 'This dose was already recorded'; end if;
end $$;

-- Receive stock (section 14)
create or replace function receive_stock(
  p_drug_id uuid, p_batch_number text, p_expiry date, p_quantity int, p_supplier text default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_batch uuid;
begin
  if not public.has_role('pharmacist', 'hospital_admin', 'super_admin') then
    raise exception 'Not allowed to receive stock' using errcode = '42501';
  end if;
  if p_quantity <= 0 then raise exception 'Quantity must be positive'; end if;
  insert into public.stock_batches (drug_id, batch_number, expiry_date, quantity, supplier)
  values (p_drug_id, p_batch_number, p_expiry, p_quantity, p_supplier) returning id into v_batch;
  insert into public.stock_movements (drug_id, batch_id, change, reason, reference)
  values (p_drug_id, v_batch, p_quantity, 'received', v_batch);
  return v_batch;
end $$;

-- Dispense: takes stock from the earliest-expiring unexpired batches, atomically.
-- Rows are locked (FOR UPDATE) so two pharmacists dispensing at once cannot oversell or double-dispense.
create or replace function dispense_prescription(p_prescription_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  rx public.prescriptions; b record; v_take int; v_left int; v_total int; v_min int; v_name text;
begin
  if not public.has_role('pharmacist') then
    raise exception 'Only pharmacists dispense medication' using errcode = '42501';
  end if;

  select * into rx from public.prescriptions where id = p_prescription_id for update;
  if not found then raise exception 'Prescription not found'; end if;
  if rx.status <> 'prescribed' then raise exception 'Prescription is already % ', rx.status; end if;

  v_left := rx.quantity;
  for b in
    select * from public.stock_batches
    where drug_id = rx.drug_id and quantity > 0 and expiry_date > current_date
    order by expiry_date, received_at
    for update
  loop
    v_take := least(b.quantity, v_left);
    update public.stock_batches set quantity = quantity - v_take where id = b.id;
    insert into public.dispensing (prescription_id, patient_id, drug_id, batch_id, quantity)
    values (rx.id, rx.patient_id, rx.drug_id, b.id, v_take);
    insert into public.stock_movements (drug_id, batch_id, change, reason, reference)
    values (rx.drug_id, b.id, -v_take, 'dispensed', rx.id);
    v_left := v_left - v_take;
    exit when v_left = 0;
  end loop;

  if v_left > 0 then
    raise exception 'Insufficient unexpired stock (short by %)', v_left;   -- rolls back everything above
  end if;

  update public.prescriptions set status = 'dispensed' where id = rx.id;

  select name, min_stock into v_name, v_min from public.drugs where id = rx.drug_id;
  perform public.add_bill_item(rx.patient_id, rx.visit_id, 'pharmacy', v_name || ' x' || rx.quantity, rx.quantity,
          (select unit_price from public.drugs where id = rx.drug_id));

  select coalesce(sum(quantity), 0) into v_total from public.stock_batches
   where drug_id = rx.drug_id and expiry_date > current_date;
  if v_total <= v_min then
    perform public.notify_roles(array['hospital_admin', 'super_admin', 'pharmacist']::staff_role[], 'low_stock',
      'Drug stock below minimum level', v_name || ': ' || v_total || ' left (minimum ' || v_min || ')', null, '/pharmacy');
  end if;
end $$;

-- Run daily (scheduler / manual in the demo). Notifies admins about batches expiring within p_days.
create or replace function generate_expiry_alerts(p_days int default 90) returns int
language plpgsql security definer set search_path = public as $$
declare n int := 0; r record;
begin
  for r in
    select d.name, sb.batch_number, sb.expiry_date, sb.quantity
    from public.stock_batches sb join public.drugs d on d.id = sb.drug_id
    where sb.quantity > 0 and sb.expiry_date between current_date and current_date + p_days
  loop
    perform public.notify_roles(array['hospital_admin', 'super_admin', 'pharmacist']::staff_role[], 'expiry',
      'Drug approaching expiry', r.name || ' batch ' || coalesce(r.batch_number, '-') || ' expires ' || r.expiry_date, null, '/pharmacy');
    n := n + 1;
  end loop;
  return n;
end $$;

create view drug_stock_status with (security_invoker = true) as
select d.id as drug_id, d.name, d.unit, d.min_stock,
       coalesce(sum(sb.quantity) filter (where sb.expiry_date > current_date), 0)::int as quantity,
       min(sb.expiry_date) filter (where sb.quantity > 0 and sb.expiry_date > current_date) as nearest_expiry,
       case
         when coalesce(sum(sb.quantity) filter (where sb.expiry_date > current_date), 0) = 0 then 'out_of_stock'
         when coalesce(sum(sb.quantity) filter (where sb.expiry_date > current_date), 0) <= d.min_stock then 'low'
         else 'ok'
       end as stock_status,
       bool_or(sb.quantity > 0 and sb.expiry_date between current_date and current_date + 90) as expiring_soon
from drugs d left join stock_batches sb on sb.drug_id = d.id
group by d.id;

-- ---------------------------------------------------------------- admission, beds, discharge (sections 8, 10, 31)
create or replace function admit_patient(
  p_visit_id uuid, p_bed_id uuid, p_diagnosis text, p_nurse_id uuid default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_visit public.visits; v_bed public.beds; v_adm uuid; v_ward text;
begin
  if not public.has_role('doctor', 'hospital_admin', 'super_admin') then
    raise exception 'Only a doctor can admit a patient' using errcode = '42501';
  end if;

  select * into v_visit from public.visits where id = p_visit_id for update;
  if not found or v_visit.status not in ('waiting', 'in_consultation') then
    raise exception 'Visit is not open';
  end if;

  select * into v_bed from public.beds where id = p_bed_id for update;   -- serialises competing admissions
  if not found or v_bed.status <> 'available' then
    raise exception 'Bed is not available' using errcode = '23505';
  end if;

  insert into public.admissions (patient_id, visit_id, bed_id, doctor_id, nurse_id, diagnosis)
  values (v_visit.patient_id, v_visit.id, v_bed.id, auth.uid(), p_nurse_id, p_diagnosis)
  returning id into v_adm;

  update public.beds set status = 'occupied' where id = v_bed.id;
  update public.visits set visit_type = 'admission', disposition = 'admission',
         status = 'in_consultation', doctor_id = coalesce(doctor_id, auth.uid()),
         started_at = coalesce(started_at, now())
   where id = v_visit.id;

  select name into v_ward from public.wards where id = v_bed.ward_id;
  perform public.notify_roles(array['nurse']::staff_role[], 'admission', 'New admission',
    public.patient_label(v_visit.patient_id) || ' - ' || v_ward || ' bed ' || v_bed.bed_number,
    v_visit.patient_id, '/inpatients');
  if p_nurse_id is not null then
    perform public.notify_staff(p_nurse_id, 'admission', 'Patient assigned to you',
      public.patient_label(v_visit.patient_id), v_visit.patient_id, '/inpatients');
  end if;
  return v_adm;
end $$;

create or replace function discharge_patient(
  p_admission_id uuid, p_summary text, p_payment_source payment_source default null,
  p_follow_up_at timestamptz default null
) returns void language plpgsql security definer set search_path = public as $$
declare
  a public.admissions; v_rate numeric; v_days int; v_ward text;
begin
  if not public.has_role('doctor', 'hospital_admin', 'super_admin') then
    raise exception 'Only authorised clinicians discharge patients' using errcode = '42501';
  end if;

  select * into a from public.admissions where id = p_admission_id for update;
  if not found or a.status <> 'active' then raise exception 'Admission is not active'; end if;

  update public.admissions
     set status = 'discharged', discharged_at = now(), discharge_summary = p_summary, discharged_by = auth.uid()
   where id = a.id;
  update public.beds set status = 'available' where id = a.bed_id;
  update public.visits
     set status = 'completed', completed_at = now(),
         disposition = case when p_follow_up_at is null then 'home'::disposition_type else 'follow_up' end
   where id = a.visit_id;

  select w.daily_rate, w.name into v_rate, v_ward
    from public.beds b join public.wards w on w.id = b.ward_id where b.id = a.bed_id;
  v_days := greatest(1, ceil(extract(epoch from (now() - a.admitted_at)) / 86400)::int);
  perform public.add_bill_item(a.patient_id, a.visit_id, 'bed', v_ward || ' bed, ' || v_days || ' day(s)', v_days, v_rate);
  if p_payment_source is not null then
    update public.bills set payment_source = p_payment_source where visit_id = a.visit_id;
  end if;

  if p_follow_up_at is not null then
    insert into public.appointments (patient_id, doctor_id, appt_type, scheduled_at, reason)
    values (a.patient_id, a.doctor_id, 'follow_up', p_follow_up_at, 'Post-discharge follow-up');
  end if;

  perform public.notify_roles(array['billing_officer']::staff_role[], 'discharge',
    'Patient discharged - bill ready', public.patient_label(a.patient_id), a.patient_id, '/billing');
end $$;

-- ---------------------------------------------------------------- realtime (section 31)
do $$
declare t text;
begin
  foreach t in array array[
    'visits', 'appointments', 'beds', 'admissions', 'lab_requests', 'lab_results', 'prescriptions',
    'medication_administrations', 'notifications', 'stock_batches', 'bills', 'bill_items', 'payments'
  ] loop
    execute format('alter publication supabase_realtime add table public.%I', t);
  end loop;
end $$;

-- ---------------------------------------------------------------- function privileges
-- Postgres grants EXECUTE to PUBLIC by default and Supabase also grants it to anon/authenticated;
-- close all of that, then open only what the app calls.
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function
  app_role(), has_role(staff_role[]), normalise_name(text),
  record_login(), record_logout(),
  check_duplicate_patients(text, date, text),
  register_patient(text, date, sex_type, text, text, text, text, kin_relationship, text, boolean),
  check_in_patient(uuid, visit_type, text, text),
  start_consultation(uuid), complete_visit(uuid, disposition_type, text),
  collect_specimen(uuid, text), enter_lab_result(uuid, text, text), finalize_lab_result(uuid),
  record_medication(uuid, mar_status, text),
  receive_stock(uuid, text, date, int, text), dispense_prescription(uuid), generate_expiry_alerts(int),
  admit_patient(uuid, uuid, text, uuid),
  discharge_patient(uuid, text, payment_source, timestamptz)
to authenticated;
-- notify_*, add_bill_item, patient_label and the trigger functions stay internal.
grant select on bill_summary, drug_stock_status to authenticated;
