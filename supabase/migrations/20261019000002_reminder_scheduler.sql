-- Reminder scheduler (spec 12, 25). Demo scope: delivery is the `reminders` log plus in-app notifications to
-- staff; no SMS or WhatsApp. Only instructions a clinician already recorded are used: a dispensed prescription
-- (dose, frequency, duration), a booked appointment, or a follow-up date on an ANC visit.
-- run_reminders() is idempotent: each reminder has a unique key, so running it twice never repeats one.

create table reminders (
  id              uuid primary key default gen_random_uuid(),
  kind            text not null check (kind in ('appointment', 'medication', 'anc_follow_up')),
  patient_id      uuid not null references patients (id),
  appointment_id  uuid references appointments (id) unique,        -- one reminder per appointment
  prescription_id uuid references prescriptions (id),
  anc_visit_id    uuid references anc_visits (id) unique,          -- one reminder per follow-up date
  due_at          timestamptz not null,                            -- the appointment, dose or follow-up the reminder is about
  message         text not null,
  channel         text not null default 'log' check (channel in ('log')),
  sent_at         timestamptz not null default now(),
  unique (prescription_id, due_at),                                -- one reminder per dose
  check (num_nonnulls(appointment_id, prescription_id, anc_visit_id) = 1)
);
create index reminders_patient_idx on reminders (patient_id, sent_at desc);
create index reminders_sent_idx on reminders (sent_at desc);

alter table reminders enable row level security;
-- Read-only through the API: only run_reminders() writes.
create policy reminders_read on reminders for select to authenticated
  using (has_role('receptionist', 'doctor', 'nurse', 'community_health', 'hospital_admin', 'super_admin'));

alter publication supabase_realtime add table public.reminders;

-- Prescription frequency -> times of day (Lagos) for the reminders. Unknown wording returns null, so no
-- reminder is invented for it (PRN, STAT, free text).
create or replace function reminder_times(p_frequency text) returns time[]
language sql immutable as $$
  select case regexp_replace(lower(btrim(coalesce(p_frequency, ''))), '[\s.]', '', 'g')
    when 'od' then array['08:00']::time[]
    when 'qd' then array['08:00']::time[]
    when 'daily' then array['08:00']::time[]
    when 'oncedaily' then array['08:00']::time[]
    when 'bd' then array['08:00', '20:00']::time[]
    when 'bid' then array['08:00', '20:00']::time[]
    when 'twicedaily' then array['08:00', '20:00']::time[]
    when 'tds' then array['08:00', '14:00', '20:00']::time[]
    when 'tid' then array['08:00', '14:00', '20:00']::time[]
    when 'threetimesdaily' then array['08:00', '14:00', '20:00']::time[]
    when 'qds' then array['06:00', '12:00', '18:00', '22:00']::time[]
    when 'qid' then array['06:00', '12:00', '18:00', '22:00']::time[]
    when 'fourtimesdaily' then array['06:00', '12:00', '18:00', '22:00']::time[]
  end
$$;

-- Called every 5 minutes by pg_cron (below), or by an admin / scripts/run-reminders.mjs.
--  * appointments: booked (scheduled/confirmed) and starting within the next 24 hours
--  * medication: home (non-inpatient) prescriptions already dispensed, one reminder per dose time between the
--    dispensing time and the end of the course. Doses missed by more than 2 hours (scheduler was off) are skipped.
--  * ANC: tomorrow is the follow-up date on the mother's latest visit
-- p_now is honoured only for the service role (tests / rehearsal); a logged-in admin always gets the real clock.
create or replace function run_reminders(p_now timestamptz default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_now   timestamptz := case when auth.uid() is null then coalesce(p_now, now()) else now() end;
  v_today date := (v_now at time zone 'Africa/Lagos')::date;
  r       record;
  n_appt  int := 0;
  n_med   int := 0;
  n_anc   int := 0;
begin
  if auth.uid() is not null and not public.has_role('hospital_admin', 'super_admin') then
    raise exception 'Only administrators can run the reminder scheduler' using errcode = '42501';
  end if;

  -- ---- appointments
  for r in
    select a.id, a.patient_id, a.doctor_id, a.scheduled_at, a.department, p.full_name
    from public.appointments a join public.patients p on p.id = a.patient_id
    where a.status in ('scheduled', 'confirmed')
      and a.scheduled_at > v_now and a.scheduled_at <= v_now + interval '24 hours'
  loop
    insert into public.reminders (kind, patient_id, appointment_id, due_at, message)
    values ('appointment', r.patient_id, r.id, r.scheduled_at,
      'Dear ' || r.full_name || ', reminder: you have an appointment at Proof Clinics on ' ||
      to_char(r.scheduled_at at time zone 'Africa/Lagos', 'DD Mon YYYY "at" HH24:MI') ||
      coalesce(' (' || r.department || ')', '') || '.')
    on conflict (appointment_id) do nothing;
    if found then
      n_appt := n_appt + 1;
      if r.doctor_id is not null then
        perform public.notify_staff(r.doctor_id, 'appointment_reminder', 'Upcoming appointment',
          public.patient_label(r.patient_id) || ' - ' ||
          to_char(r.scheduled_at at time zone 'Africa/Lagos', 'DD Mon HH24:MI'),
          r.patient_id, '/appointments');
      end if;
    end if;
  end loop;

  -- ---- home medication
  for r in
    select rx.id as prescription_id, rx.patient_id, pt.full_name, dr.name as drug, rx.dose, rx.route,
           rx.frequency, s.due_at
    from public.prescriptions rx
    join public.patients pt on pt.id = rx.patient_id
    join public.drugs dr on dr.id = rx.drug_id
    cross join lateral (select min(d.dispensed_at) as first_at from public.dispensing d where d.prescription_id = rx.id) ds
    cross join lateral generate_series(0, rx.duration_days) n
    cross join lateral unnest(public.reminder_times(rx.frequency)) t
    cross join lateral (
      select (((ds.first_at at time zone 'Africa/Lagos')::date + n) + t) at time zone 'Africa/Lagos' as due_at
    ) s
    where rx.admission_id is null and rx.status = 'dispensed'
      and rx.duration_days is not null and ds.first_at is not null
      and s.due_at > ds.first_at and s.due_at <= ds.first_at + rx.duration_days * interval '1 day'
      and s.due_at <= v_now and s.due_at > v_now - interval '2 hours'
  loop
    insert into public.reminders (kind, patient_id, prescription_id, due_at, message)
    values ('medication', r.patient_id, r.prescription_id, r.due_at,
      'Dear ' || r.full_name || ', time to take ' || r.drug || ' (' || r.dose || ', ' || r.route ||
      '). Prescribed: ' || r.frequency || '.')
    on conflict (prescription_id, due_at) do nothing;
    if found then n_med := n_med + 1; end if;
  end loop;

  -- ---- ANC follow-up (latest visit of each mother, follow-up tomorrow)
  for r in
    select v.id, v.patient_id, v.follow_up_date, v.recorded_by, p.full_name
    from public.anc_visits v join public.patients p on p.id = v.patient_id
    where v.follow_up_date = v_today + 1
      and not exists (select 1 from public.anc_visits v2
                       where v2.anc_record_id = v.anc_record_id and v2.visit_date > v.visit_date)
  loop
    insert into public.reminders (kind, patient_id, anc_visit_id, due_at, message)
    values ('anc_follow_up', r.patient_id, r.id, (r.follow_up_date + time '09:00') at time zone 'Africa/Lagos',
      'Dear ' || r.full_name || ', reminder: your antenatal clinic visit is due on ' ||
      to_char(r.follow_up_date, 'DD Mon YYYY') || '.')
    on conflict (anc_visit_id) do nothing;
    if found then
      n_anc := n_anc + 1;
      if r.recorded_by is not null then
        perform public.notify_staff(r.recorded_by, 'anc_follow_up', 'Antenatal follow-up tomorrow',
          public.patient_label(r.patient_id) || ' - ' || to_char(r.follow_up_date, 'DD Mon YYYY'),
          r.patient_id, '/patients/' || r.patient_id);
      end if;
    end if;
  end loop;

  return jsonb_build_object('appointments', n_appt, 'medication', n_med, 'anc_follow_ups', n_anc);
end $$;

revoke execute on function reminder_times(text), run_reminders(timestamptz) from public, anon, authenticated;
grant execute on function run_reminders(timestamptz) to authenticated, service_role;

-- Schedule it every 5 minutes where pg_cron exists (Supabase cloud / local stack). If not, the migration still
-- succeeds and `node --env-file=.env scripts/run-reminders.mjs --loop` does the same job.
do $$
begin
  create extension if not exists pg_cron;
  perform cron.schedule('run-reminders', '*/5 * * * *', 'select public.run_reminders()');
exception when others then
  raise notice 'pg_cron not available (%); use scripts/run-reminders.mjs instead', sqlerrm;
end $$;
