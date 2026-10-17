-- Proof Clinics HMS demo: core schema (spec sections 2, 4, 5-8, 11, 13)
-- Single source of truth: every module references patients(id). No module has its own patient copy.

create extension if not exists pgcrypto;
create extension if not exists pg_trgm with schema extensions;

-- ---------------------------------------------------------------- enums
create type staff_role as enum (
  'super_admin', 'hospital_admin', 'doctor', 'nurse', 'pharmacist',
  'lab_scientist', 'receptionist', 'billing_officer', 'community_health'
);
create type sex_type as enum ('male', 'female', 'other');
create type kin_relationship as enum (
  'father', 'mother', 'brother', 'sister', 'spouse', 'son', 'daughter', 'guardian', 'other'
);
create type visit_type as enum ('outpatient', 'inpatient', 'admission', 'referral');
create type visit_status as enum ('waiting', 'in_consultation', 'completed', 'cancelled');
create type disposition_type as enum ('home', 'follow_up', 'referral', 'admission', 'other');
create type appointment_type as enum (
  'consultation', 'follow_up', 'surgery', 'procedure', 'antenatal',
  'family_planning', 'child_health', 'other'
);
create type appointment_status as enum (
  'scheduled', 'confirmed', 'checked_in', 'waiting', 'in_consultation',
  'completed', 'cancelled', 'no_show', 'rescheduled'
);
create type payment_source as enum ('hmo', 'patient', 'government', 'other');
create type feedback_rating as enum ('ok', 'good', 'great');

-- ---------------------------------------------------------------- helpers
create or replace function set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------------------------------------------------------------- staff (section 4)
create table staff (
  id          uuid primary key references auth.users (id) on delete restrict,
  staff_code  text unique not null,
  full_name   text not null,
  role        staff_role not null,
  department  text,
  position    text,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

create table staff_sessions (
  id         uuid primary key default gen_random_uuid(),
  staff_id   uuid not null references staff (id),
  login_at   timestamptz not null default now(),
  logout_at  timestamptz
);

-- Role of the logged-in user. SECURITY DEFINER so RLS policies can call it without recursion.
create or replace function app_role() returns staff_role
language sql stable security definer set search_path = public as $$
  select role from public.staff where id = auth.uid() and active
$$;

create or replace function has_role(variadic roles staff_role[]) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.app_role() = any (roles), false)
$$;

-- ---------------------------------------------------------------- patients (section 2, 32)
create sequence patient_code_seq start 1;

create table patients (
  id             uuid primary key default gen_random_uuid(),
  patient_code   text unique not null default ('PC-' || lpad(nextval('patient_code_seq')::text, 6, '0')),
  full_name      text not null,
  dob            date not null,
  sex            sex_type not null,
  phone          text,
  address        text,
  allergies      text,
  medical_history text,
  created_by     uuid default auth.uid() references staff (id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index patients_name_trgm on patients using gin (lower(full_name) extensions.gin_trgm_ops);
create index patients_phone_idx on patients (phone);
create index patients_dob_idx on patients (dob);
create trigger patients_updated_at before update on patients
  for each row execute function set_updated_at();

create table next_of_kin (
  id                  uuid primary key default gen_random_uuid(),
  patient_id          uuid not null references patients (id),
  full_name           text not null,
  phone               text not null,
  relationship        kin_relationship not null,
  relationship_other  text,
  is_emergency_contact boolean not null default true,
  created_at          timestamptz not null default now(),
  constraint kin_other_specified check (relationship <> 'other' or nullif(btrim(relationship_other), '') is not null)
);
create index next_of_kin_patient_idx on next_of_kin (patient_id);

-- Clinical fields on the patient profile may only be set by clinicians (section 2, 4).
create or replace function guard_patient_clinical_fields() returns trigger
language plpgsql as $$
begin
  if public.has_role('doctor', 'nurse', 'hospital_admin', 'super_admin', 'community_health') then
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
create trigger patients_guard_clinical before insert or update on patients
  for each row execute function guard_patient_clinical_fields();

-- ---------------------------------------------------------------- visits / queue (sections 5-7, 11)
create table visits (
  id            uuid primary key default gen_random_uuid(),
  patient_id    uuid not null references patients (id),
  visit_type    visit_type not null default 'outpatient',
  department    text not null default 'General',
  complaint     text,
  status        visit_status not null default 'waiting',
  doctor_id     uuid references staff (id),
  checked_in_at timestamptz not null default now(),
  started_at    timestamptz,
  completed_at  timestamptz,
  disposition   disposition_type,
  follow_up_plan text,
  feedback_rating feedback_rating,
  feedback_note text,
  created_by    uuid default auth.uid() references staff (id),
  updated_at    timestamptz not null default now()
);
create index visits_patient_idx on visits (patient_id);
create index visits_status_idx on visits (status);
create trigger visits_updated_at before update on visits
  for each row execute function set_updated_at();

create table appointments (
  id           uuid primary key default gen_random_uuid(),
  patient_id   uuid not null references patients (id),
  doctor_id    uuid references staff (id),
  department   text not null default 'General',
  appt_type    appointment_type not null default 'consultation',
  scheduled_at timestamptz not null,
  reason       text,
  status       appointment_status not null default 'scheduled',
  visit_id     uuid references visits (id),
  created_by   uuid default auth.uid() references staff (id),
  created_at   timestamptz not null default now()
);
create index appointments_scheduled_idx on appointments (scheduled_at);
create index appointments_patient_idx on appointments (patient_id);

create table vitals (
  id           uuid primary key default gen_random_uuid(),
  patient_id   uuid not null references patients (id),
  visit_id     uuid not null references visits (id),
  temperature_c numeric(4,1) check (temperature_c between 25 and 45),
  pulse        int check (pulse between 20 and 300),
  resp_rate    int check (resp_rate between 4 and 80),
  bp_systolic  int check (bp_systolic between 40 and 300),
  bp_diastolic int check (bp_diastolic between 20 and 200),
  weight_kg    numeric(5,1) check (weight_kg > 0),
  recorded_by  uuid default auth.uid() references staff (id),
  recorded_at  timestamptz not null default now()
);
create index vitals_visit_idx on vitals (visit_id);

create table consultations (
  id          uuid primary key default gen_random_uuid(),
  patient_id  uuid not null references patients (id),
  visit_id    uuid not null unique references visits (id),
  doctor_id   uuid not null default auth.uid() references staff (id),
  notes       text,
  treatment   text,
  created_at  timestamptz not null default now()
);

-- Diagnosis: clinicians only (enforced in RLS), never silently overwritten (audit trail keeps history).
create table diagnoses (
  id          uuid primary key default gen_random_uuid(),
  patient_id  uuid not null references patients (id),
  visit_id    uuid not null references visits (id),
  diagnosis   text not null,
  entered_by  uuid not null default auth.uid() references staff (id),
  created_at  timestamptz not null default now()
);
create index diagnoses_patient_idx on diagnoses (patient_id);

-- ---------------------------------------------------------------- services catalogue + laboratory (section 13)
create table services (
  id            uuid primary key default gen_random_uuid(),
  name          text unique not null,
  category      text not null check (category in ('consultation', 'lab', 'procedure', 'other')),
  specimen_type text,
  price         numeric(12,2) not null default 0 check (price >= 0)
);

create type lab_request_status as enum ('requested', 'collected', 'resulted', 'finalized', 'cancelled');
create type lab_result_status as enum ('entered', 'validated', 'finalized');

create table lab_requests (
  id            uuid primary key default gen_random_uuid(),
  patient_id    uuid not null references patients (id),
  visit_id      uuid not null references visits (id),
  service_id    uuid not null references services (id),
  requested_by  uuid not null default auth.uid() references staff (id),
  requested_at  timestamptz not null default now(),
  status        lab_request_status not null default 'requested',
  specimen_type text,
  collected_at  timestamptz,
  collected_by  uuid references staff (id),
  lab_source    text not null default 'Proof Clinics Laboratory'
);
create index lab_requests_patient_idx on lab_requests (patient_id);
create index lab_requests_status_idx on lab_requests (status);

create table lab_results (
  id              uuid primary key default gen_random_uuid(),
  lab_request_id  uuid not null unique references lab_requests (id),
  patient_id      uuid not null references patients (id),
  result          text not null,
  reference_range text,
  status          lab_result_status not null default 'entered',
  entered_by      uuid not null default auth.uid() references staff (id),
  entered_at      timestamptz not null default now(),
  reviewed_by     uuid references staff (id),
  finalized_at    timestamptz
);

-- Finalised results are immutable.
create or replace function lab_result_immutable() returns trigger
language plpgsql as $$
begin
  if old.status = 'finalized' then
    raise exception 'Finalised laboratory results cannot be changed' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger lab_results_immutable before update on lab_results
  for each row execute function lab_result_immutable();
