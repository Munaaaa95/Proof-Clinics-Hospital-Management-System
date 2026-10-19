-- Dashboard (spec 3), patient search (28) and reports (29).
--
-- Dashboard views run with the owner's rights so they can join across tables (for example payment status,
-- which doctors cannot read directly), but each view only returns rows to the roles named in its WHERE clause
-- and masks columns the caller should not see. All hospital dates use Lagos time (UTC+1, no daylight saving).

-- ---------------------------------------------------------------- A. inpatients (active only)
create view dash_inpatients as
select a.id as admission_id, p.id as patient_id, p.patient_code, p.full_name as patient_name,
       w.name as ward, b.bed_number, a.diagnosis,
       d.full_name as doctor_name, n.full_name as nurse_name,
       a.admitted_at, 'Admitted'::text as current_status
from admissions a
join patients p on p.id = a.patient_id
join beds b on b.id = a.bed_id
join wards w on w.id = b.ward_id
join staff d on d.id = a.doctor_id
left join staff n on n.id = a.nurse_id
where a.status = 'active' and public.app_role() is not null;

-- ---------------------------------------------------------------- B. outpatients / discharged
-- Payment columns are only filled in for roles that handle money.
create view dash_discharged as
select v.id as visit_id, p.id as patient_id, p.patient_code, p.full_name as patient_name,
       v.completed_at as discharged_at, d.full_name as doctor_name, v.visit_type,
       case when public.has_role('billing_officer', 'receptionist', 'hospital_admin', 'super_admin')
            then bs.payment_source::text end as payment_source,
       case when public.has_role('billing_officer', 'receptionist', 'hospital_admin', 'super_admin')
            then bs.payment_status end as payment_status,
       case when v.visit_type = 'admission' then 'Discharged from ward'
            when v.disposition = 'follow_up' then 'Seen - follow-up needed'
            when v.disposition = 'referral' then 'Seen - referred'
            else 'Seen - discharged home' end as discharge_status,
       v.feedback_rating::text as feedback_rating, v.feedback_note
from visits v
join patients p on p.id = v.patient_id
left join staff d on d.id = v.doctor_id
left join bill_summary bs on bs.visit_id = v.id
where v.status = 'completed' and public.app_role() is not null;

-- ---------------------------------------------------------------- C. waiting patients
create view dash_waiting as
select v.id as visit_id, p.id as patient_id, p.patient_code, p.full_name as patient_name,
       v.complaint, v.checked_in_at, v.department,
       coalesce(ap.status::text, 'walk-in') as appointment_status,
       floor(extract(epoch from (now() - v.checked_in_at)) / 60)::int as waiting_minutes
from visits v
join patients p on p.id = v.patient_id
left join lateral (select a.status from appointments a where a.visit_id = v.id order by a.created_at desc limit 1) ap on true
where v.status = 'waiting' and public.app_role() is not null;

-- ---------------------------------------------------------------- D. admissions (all, active and past)
create view dash_admissions as
select a.id as admission_id, p.id as patient_id, p.patient_code, p.full_name as patient_name,
       a.diagnosis, w.name as ward, b.bed_number, d.full_name as doctor_name,
       a.admitted_at, a.discharged_at, a.status::text as admission_status
from admissions a
join patients p on p.id = a.patient_id
join beds b on b.id = a.bed_id
join wards w on w.id = b.ward_id
join staff d on d.id = a.doctor_id
where public.app_role() is not null;

-- ---------------------------------------------------------------- E. laboratory (result shown only once finalised)
create view dash_lab as
select lr.id as lab_request_id, p.id as patient_id, p.patient_code, p.full_name as patient_name,
       s.name as test, lr.specimen_type, lr.collected_at, lr.lab_source, lr.requested_at,
       lr.status::text as result_status,
       case when r.status = 'finalized' then r.result end as result,
       case when r.status = 'finalized' then rv.full_name end as reviewed_by
from lab_requests lr
join patients p on p.id = lr.patient_id
join services s on s.id = lr.service_id
left join lab_results r on r.lab_request_id = lr.id
left join staff rv on rv.id = r.reviewed_by
where public.has_role('doctor', 'nurse', 'lab_scientist', 'hospital_admin', 'super_admin');

-- ---------------------------------------------------------------- F. appointments today
create view dash_appointments_today as
select a.id as appointment_id, p.id as patient_id, p.patient_code, p.full_name as patient_name,
       a.scheduled_at, d.full_name as doctor_name, a.department, a.appt_type::text as appointment_type,
       a.reason, a.status::text as appointment_status
from appointments a
join patients p on p.id = a.patient_id
left join staff d on d.id = a.doctor_id
where (a.scheduled_at at time zone 'Africa/Lagos')::date = (now() at time zone 'Africa/Lagos')::date
  and public.app_role() is not null;

-- ---------------------------------------------------------------- G. beds (per ward + an "All wards" total row)
create view dash_bed_summary as
select coalesce(w.name, 'All wards') as ward,
       count(*)::int as total_beds,
       count(*) filter (where b.status = 'occupied')::int as occupied,
       count(*) filter (where b.status = 'available')::int as available,
       count(*) filter (where b.status = 'reserved')::int as reserved,
       count(*) filter (where b.status = 'maintenance')::int as maintenance
from beds b join wards w on w.id = b.ward_id
where public.app_role() is not null
group by rollup (w.name);

-- ---------------------------------------------------------------- H. drug stock: use drug_stock_status (pharmacy/admin/clinicians)

-- ---------------------------------------------------------------- headline tiles
create view dash_summary as
select
  (select count(*) from admissions where status = 'active')::int as active_inpatients,
  (select count(*) from visits where status = 'waiting')::int as waiting_patients,
  (select count(*) from visits where status = 'in_consultation' and visit_type <> 'admission')::int as in_consultation,
  (select count(*) from appointments
     where (scheduled_at at time zone 'Africa/Lagos')::date = (now() at time zone 'Africa/Lagos')::date)::int as appointments_today,
  (select count(*) from lab_requests where status in ('requested', 'collected', 'resulted'))::int as labs_pending,
  (select count(*) from beds where status = 'available')::int as beds_available,
  (select count(*) from beds)::int as beds_total,
  (select count(*) from visits
     where status = 'completed' and (completed_at at time zone 'Africa/Lagos')::date = (now() at time zone 'Africa/Lagos')::date)::int as discharged_today
where public.app_role() is not null;

-- ---------------------------------------------------------------- patient search (section 28)
-- SECURITY INVOKER (default): RLS decides what each role can see, so results respect permissions.
create or replace function search_patients(p_query text, p_limit int default 25)
returns table (
  patient_id uuid, patient_code text, full_name text, dob date, sex sex_type, phone text,
  open_visit_status visit_status, is_admitted boolean, next_appointment timestamptz, score real
)
language plpgsql stable as $$
declare
  q text := btrim(coalesce(p_query, ''));
  digits text := regexp_replace(coalesce(p_query, ''), '\D', '', 'g');
  d date;
begin
  if length(q) < 2 then return; end if;
  begin
    if q ~ '^\d{4}-\d{2}-\d{2}$' then d := q::date; end if;
  exception when others then d := null;
  end;

  return query
  select p.id, p.patient_code, p.full_name, p.dob, p.sex, p.phone,
         (select v.status from visits v where v.patient_id = p.id and v.status in ('waiting', 'in_consultation')
            order by v.checked_in_at desc limit 1),
         exists (select 1 from admissions a where a.patient_id = p.id and a.status = 'active'),
         (select min(ap.scheduled_at) from appointments ap
            where ap.patient_id = p.id and ap.scheduled_at >= now()
              and ap.status in ('scheduled', 'confirmed')),
         greatest(
           case when upper(p.patient_code) = upper(q) then 1.0 else 0 end,
           extensions.similarity(lower(p.full_name), lower(q)),
           case when p.full_name ilike '%' || q || '%' then 0.8 else 0 end,
           case when p.dob = d then 0.9 else 0 end,
           case when length(digits) >= 4 and regexp_replace(coalesce(p.phone, ''), '\D', '', 'g') like '%' || digits || '%'
                then 0.85 else 0 end
         )::real as score
  from patients p
  where p.patient_code ilike '%' || q || '%'
     or p.full_name ilike '%' || q || '%'
     or extensions.similarity(lower(p.full_name), lower(q)) > 0.3
     or p.dob = d
     or (length(digits) >= 4 and regexp_replace(coalesce(p.phone, ''), '\D', '', 'g') like '%' || digits || '%')
  order by score desc, p.full_name
  limit least(greatest(p_limit, 1), 100);
end $$;

-- ---------------------------------------------------------------- reports (section 29), admins only
-- Filters: date range (required), department, doctor, patient category (visit type), lab service.
create or replace function report_summary(
  p_from date, p_to date,
  p_department text default null, p_doctor_id uuid default null,
  p_visit_type visit_type default null, p_service_id uuid default null
) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  if not public.has_role('hospital_admin', 'super_admin') then
    raise exception 'Reports are restricted to administrators' using errcode = '42501';
  end if;
  if p_to < p_from then raise exception 'End date is before start date'; end if;
  if p_to - p_from > 366 then raise exception 'Choose a range of one year or less'; end if;

  with
  vs as (
    select v.* from visits v
    where (v.checked_in_at at time zone 'Africa/Lagos')::date between p_from and p_to
      and (p_department is null or v.department = p_department)
      and (p_doctor_id is null or v.doctor_id = p_doctor_id)
      and (p_visit_type is null or v.visit_type = p_visit_type)
  ),
  ad as (
    select a.*, v.department from admissions a join visits v on v.id = a.visit_id
    where (p_department is null or v.department = p_department)
      and (p_doctor_id is null or a.doctor_id = p_doctor_id)
      and (p_visit_type is null or v.visit_type = p_visit_type)
  ),
  ap as (
    select a.* from appointments a
    where (a.scheduled_at at time zone 'Africa/Lagos')::date between p_from and p_to
      and (p_department is null or a.department = p_department)
      and (p_doctor_id is null or a.doctor_id = p_doctor_id)
  ),
  lab as (
    select lr.*, s.name as test_name from lab_requests lr
    join services s on s.id = lr.service_id
    join visits v on v.id = lr.visit_id
    where (lr.requested_at at time zone 'Africa/Lagos')::date between p_from and p_to
      and (p_service_id is null or lr.service_id = p_service_id)
      and (p_department is null or v.department = p_department)
      and (p_doctor_id is null or lr.requested_by = p_doctor_id)
      and (p_visit_type is null or v.visit_type = p_visit_type)
  ),
  rx as (
    select ds.*, d.name as drug_name from dispensing ds
    join drugs d on d.id = ds.drug_id
    join prescriptions pr on pr.id = ds.prescription_id
    join visits v on v.id = pr.visit_id
    where (ds.dispensed_at at time zone 'Africa/Lagos')::date between p_from and p_to
      and (p_department is null or v.department = p_department)
      and (p_doctor_id is null or pr.prescribed_by = p_doctor_id)
      and (p_visit_type is null or v.visit_type = p_visit_type)
  ),
  bl as (
    select b.id, b.payment_source, coalesce(i.total, 0) as billed
    from bills b join vs on vs.id = b.visit_id
    left join (select bill_id, sum(quantity * unit_price) as total from bill_items group by bill_id) i on i.bill_id = b.id
  ),
  pay as (
    select p.* from payments p join bl on bl.id = p.bill_id
  )
  select jsonb_build_object(
    'period', jsonb_build_object('from', p_from, 'to', p_to),
    'visits', jsonb_build_object(
      'total', (select count(*) from vs),
      'unique_patients', (select count(distinct patient_id) from vs),
      'outpatient', (select count(*) from vs where visit_type = 'outpatient'),
      'inpatient_or_admission', (select count(*) from vs where visit_type in ('inpatient', 'admission')),
      'completed', (select count(*) from vs where status = 'completed')),
    'admissions', jsonb_build_object(
      'admitted_in_period', (select count(*) from ad where (admitted_at at time zone 'Africa/Lagos')::date between p_from and p_to),
      'discharged_in_period', (select count(*) from ad where (discharged_at at time zone 'Africa/Lagos')::date between p_from and p_to),
      'active_now', (select count(*) from ad where status = 'active')),
    'beds', (select jsonb_build_object('total', count(*),
                'occupied', count(*) filter (where status = 'occupied'),
                'available', count(*) filter (where status = 'available'),
                'occupancy_percent', case when count(*) = 0 then 0
                    else round(100.0 * count(*) filter (where status = 'occupied') / count(*), 1) end)
             from beds),
    'appointments', jsonb_build_object(
      'total', (select count(*) from ap),
      'completed', (select count(*) from ap where status = 'completed'),
      'cancelled', (select count(*) from ap where status = 'cancelled'),
      'no_show', (select count(*) from ap where status = 'no_show')),
    'lab_workload', (select coalesce(jsonb_agg(x order by x.requests desc), '[]'::jsonb) from (
        select test_name as test, count(*) as requests,
               count(*) filter (where status = 'finalized') as finalized
        from lab group by test_name) x),
    'pharmacy_usage', (select coalesce(jsonb_agg(x order by x.quantity_dispensed desc), '[]'::jsonb) from (
        select drug_name as drug, sum(quantity)::int as quantity_dispensed, count(*) as dispensings
        from rx group by drug_name) x),
    'revenue', jsonb_build_object(
      'billed', (select coalesce(sum(billed), 0) from bl),
      'paid', (select coalesce(sum(amount), 0) from pay),
      'outstanding', (select coalesce(sum(billed), 0) from bl) - (select coalesce(sum(amount), 0) from pay),
      'paid_by_source', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
          select source::text as source, sum(amount) as amount, count(*) as payments from pay group by source) x),
      'billed_by_source', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
          select coalesce(payment_source::text, 'not recorded') as source, sum(billed) as amount from bl group by payment_source) x)),
    'anc', jsonb_build_object(
      'visits', (select count(*) from anc_visits where visit_date between p_from and p_to),
      'mothers_registered', (select count(*) from anc_records where (created_at at time zone 'Africa/Lagos')::date between p_from and p_to)),
    'daily_visits', (select coalesce(jsonb_agg(jsonb_build_object('date', d::date, 'visits',
          (select count(*) from vs where (vs.checked_in_at at time zone 'Africa/Lagos')::date = d::date)) order by d), '[]'::jsonb)
        from generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') d)
  ) into r;
  return r;
end $$;

-- ---------------------------------------------------------------- privileges
revoke all on dash_inpatients, dash_discharged, dash_waiting, dash_admissions, dash_lab,
              dash_appointments_today, dash_bed_summary, dash_summary, drug_stock_status from anon;
grant select on dash_inpatients, dash_discharged, dash_waiting, dash_admissions, dash_lab,
                dash_appointments_today, dash_bed_summary, dash_summary to authenticated;

revoke execute on function search_patients(text, int), report_summary(date, date, text, uuid, visit_type, uuid)
  from public, anon;
grant execute on function search_patients(text, int), report_summary(date, date, text, uuid, visit_type, uuid)
  to authenticated;

-- Realtime does not stream views; the dashboard should subscribe to the underlying tables
-- (visits, admissions, beds, lab_requests, appointments) and re-query these views on each event.
