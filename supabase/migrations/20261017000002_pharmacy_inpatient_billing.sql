-- Pharmacy (14), inpatient/beds (8, 9, 10), billing (26), ANC (15), notifications (25), audit (27)

-- ---------------------------------------------------------------- pharmacy
create table drugs (
  id         uuid primary key default gen_random_uuid(),
  name       text unique not null,
  unit       text not null default 'tablet',
  min_stock  int not null default 20 check (min_stock >= 0),
  unit_price numeric(12,2) not null default 0 check (unit_price >= 0)
);

create table stock_batches (
  id           uuid primary key default gen_random_uuid(),
  drug_id      uuid not null references drugs (id),
  batch_number text,
  expiry_date  date not null,
  quantity     int not null check (quantity >= 0),
  supplier     text,
  received_at  timestamptz not null default now()
);
create index stock_batches_drug_idx on stock_batches (drug_id, expiry_date);

-- Ledger of every stock change (received, dispensed, adjusted).
create table stock_movements (
  id         uuid primary key default gen_random_uuid(),
  drug_id    uuid not null references drugs (id),
  batch_id   uuid references stock_batches (id),
  change     int not null,
  reason     text not null check (reason in ('received', 'dispensed', 'adjustment')),
  reference  uuid,
  created_by uuid default auth.uid() references staff (id),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- wards, beds, admissions
create table wards (
  id         uuid primary key default gen_random_uuid(),
  name       text unique not null,
  daily_rate numeric(12,2) not null default 0
);

create type bed_status as enum ('available', 'occupied', 'reserved', 'maintenance');

create table beds (
  id         uuid primary key default gen_random_uuid(),
  ward_id    uuid not null references wards (id),
  bed_number text not null,
  status     bed_status not null default 'available',
  unique (ward_id, bed_number)
);

create type admission_status as enum ('active', 'discharged');

create table admissions (
  id            uuid primary key default gen_random_uuid(),
  patient_id    uuid not null references patients (id),
  visit_id      uuid not null references visits (id),
  bed_id        uuid not null references beds (id),
  doctor_id     uuid not null references staff (id),
  nurse_id      uuid references staff (id),
  diagnosis     text,
  status        admission_status not null default 'active',
  admitted_at   timestamptz not null default now(),
  discharged_at timestamptz,
  discharge_summary text,
  discharged_by uuid references staff (id)
);
-- A bed can have only one active admission, enforced by the database itself (section 3G).
create unique index admissions_one_active_per_bed on admissions (bed_id) where status = 'active';
-- A patient can have only one active admission.
create unique index admissions_one_active_per_patient on admissions (patient_id) where status = 'active';
create index admissions_patient_idx on admissions (patient_id);

-- ---------------------------------------------------------------- prescriptions
create type prescription_status as enum ('prescribed', 'dispensed', 'cancelled');

create table prescriptions (
  id            uuid primary key default gen_random_uuid(),
  patient_id    uuid not null references patients (id),
  visit_id      uuid not null references visits (id),
  admission_id  uuid references admissions (id),
  drug_id       uuid not null references drugs (id),
  dose          text not null,
  route         text not null default 'oral',
  frequency     text not null,
  duration_days int check (duration_days > 0),
  quantity      int not null check (quantity > 0),
  status        prescription_status not null default 'prescribed',
  prescribed_by uuid not null default auth.uid() references staff (id),
  prescribed_at timestamptz not null default now()
);
create index prescriptions_patient_idx on prescriptions (patient_id);
create index prescriptions_status_idx on prescriptions (status);

create table dispensing (
  id              uuid primary key default gen_random_uuid(),
  prescription_id uuid not null references prescriptions (id),
  patient_id      uuid not null references patients (id),
  drug_id         uuid not null references drugs (id),
  batch_id        uuid not null references stock_batches (id),
  quantity        int not null check (quantity > 0),
  dispensed_by    uuid not null default auth.uid() references staff (id),
  dispensed_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------- medication administration record (section 9)
create type mar_status as enum ('pending', 'given', 'missed', 'refused', 'held');

create table medication_administrations (
  id              uuid primary key default gen_random_uuid(),
  admission_id    uuid not null references admissions (id),
  prescription_id uuid not null references prescriptions (id),
  patient_id      uuid not null references patients (id),
  scheduled_for   timestamptz not null default now(),
  status          mar_status not null default 'pending',
  administered_by uuid references staff (id),
  administered_at timestamptz,
  notes           text,
  -- "given" cannot exist without a person and a time (section 9).
  constraint mar_given_has_actor check (
    status = 'pending' or (administered_by is not null and administered_at is not null)
  )
);
create index mar_admission_idx on medication_administrations (admission_id);

-- ---------------------------------------------------------------- billing (section 26)
create table bills (
  id             uuid primary key default gen_random_uuid(),
  patient_id     uuid not null references patients (id),
  visit_id       uuid not null unique references visits (id),
  payment_source payment_source,
  created_at     timestamptz not null default now()
);

create table bill_items (
  id          uuid primary key default gen_random_uuid(),
  bill_id     uuid not null references bills (id),
  patient_id  uuid not null references patients (id),
  category    text not null check (category in ('consultation', 'lab', 'pharmacy', 'procedure', 'bed', 'other')),
  description text not null,
  quantity    numeric(10,2) not null default 1 check (quantity > 0),
  unit_price  numeric(12,2) not null check (unit_price >= 0),
  created_at  timestamptz not null default now()
);
create index bill_items_bill_idx on bill_items (bill_id);

create table payments (
  id          uuid primary key default gen_random_uuid(),
  bill_id     uuid not null references bills (id),
  patient_id  uuid not null references patients (id),
  amount      numeric(12,2) not null check (amount > 0),
  source      payment_source not null,
  reference   text,
  recorded_by uuid not null default auth.uid() references staff (id),
  paid_at     timestamptz not null default now()
);
create index payments_bill_idx on payments (bill_id);

create view bill_summary with (security_invoker = true) as
select b.id as bill_id, b.patient_id, b.visit_id, b.payment_source,
       coalesce(i.total, 0)  as total_billed,
       coalesce(p.total, 0)  as total_paid,
       coalesce(i.total, 0) - coalesce(p.total, 0) as balance,
       case
         when coalesce(i.total, 0) = 0 then 'no_charges'
         when coalesce(p.total, 0) = 0 then 'unpaid'
         when coalesce(p.total, 0) < coalesce(i.total, 0) then 'partial'
         else 'paid'
       end as payment_status
from bills b
left join (select bill_id, sum(quantity * unit_price) as total from bill_items group by bill_id) i on i.bill_id = b.id
left join (select bill_id, sum(amount) as total from payments group by bill_id) p on p.bill_id = b.id;

-- ---------------------------------------------------------------- ANC (section 15), pattern for specialty modules
create table anc_records (
  id            uuid primary key default gen_random_uuid(),
  patient_id    uuid not null unique references patients (id),   -- one ANC record per mother, visits accumulate
  lmp           date,
  edd           date,
  gravida       int,
  parity        int,
  risk_factors  text,
  created_by    uuid default auth.uid() references staff (id),
  created_at    timestamptz not null default now()
);

create table anc_visits (
  id              uuid primary key default gen_random_uuid(),
  anc_record_id   uuid not null references anc_records (id),
  patient_id      uuid not null references patients (id),
  visit_date      date not null default current_date,
  gestational_weeks int check (gestational_weeks between 0 and 45),
  complaints      text,
  bp_systolic     int,
  bp_diastolic    int,
  weight_kg       numeric(5,1),
  fundal_height_cm numeric(4,1),
  findings        text,
  investigations  text,
  supplements     text,
  follow_up_date  date,
  recorded_by     uuid default auth.uid() references staff (id),
  created_at      timestamptz not null default now()
);
create index anc_visits_record_idx on anc_visits (anc_record_id, visit_date);

-- ---------------------------------------------------------------- notifications (section 25)
create table notifications (
  id                 uuid primary key default gen_random_uuid(),
  recipient_staff_id uuid not null references staff (id),
  type               text not null,
  title              text not null,
  body               text,
  patient_id         uuid references patients (id),
  link               text,
  read_at            timestamptz,
  created_at         timestamptz not null default now()
);
create index notifications_recipient_idx on notifications (recipient_staff_id, read_at, created_at desc);

-- ---------------------------------------------------------------- audit log (section 27): append-only
create table audit_log (
  id          bigint generated always as identity primary key,
  at          timestamptz not null default now(),
  actor_id    uuid,
  actor_name  text,
  actor_role  staff_role,
  action      text not null,          -- INSERT / UPDATE / DELETE
  table_name  text not null,
  record_id   text,
  patient_id  uuid,
  old_data    jsonb,
  new_data    jsonb
);
create index audit_log_at_idx on audit_log (at desc);
create index audit_log_patient_idx on audit_log (patient_id);
create index audit_log_table_idx on audit_log (table_name);

create or replace function audit_row() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_new jsonb; v_old jsonb; v_row jsonb; v_pid uuid; v_name text; v_role staff_role;
begin
  if tg_op <> 'DELETE' then v_new := to_jsonb(new); end if;
  if tg_op <> 'INSERT' then v_old := to_jsonb(old); end if;
  if tg_op = 'UPDATE' and v_new = v_old then return new; end if;
  v_row := coalesce(v_new, v_old);
  v_pid := case when tg_table_name = 'patients' then (v_row ->> 'id')::uuid
                else nullif(v_row ->> 'patient_id', '')::uuid end;
  select full_name, role into v_name, v_role from public.staff where id = auth.uid();
  insert into public.audit_log (actor_id, actor_name, actor_role, action, table_name, record_id, patient_id, old_data, new_data)
  values (auth.uid(), coalesce(v_name, 'system'), v_role, tg_op, tg_table_name, v_row ->> 'id', v_pid, v_old, v_new);
  return coalesce(new, old);
end $$;

do $$
declare t text;
begin
  foreach t in array array[
    'staff', 'patients', 'next_of_kin', 'visits', 'appointments', 'vitals', 'consultations', 'diagnoses',
    'lab_requests', 'lab_results', 'drugs', 'stock_batches', 'stock_movements', 'prescriptions', 'dispensing',
    'beds', 'admissions', 'medication_administrations', 'bills', 'bill_items', 'payments',
    'anc_records', 'anc_visits'
  ] loop
    execute format('create trigger audit_%1$s after insert or update or delete on %1$I for each row execute function audit_row()', t);
  end loop;
end $$;

-- Nobody (not even a logged-in admin) can alter or delete audit rows through the API.
create or replace function audit_log_append_only() returns trigger
language plpgsql as $$
begin
  raise exception 'audit_log is append-only' using errcode = '42501';
end $$;
create trigger audit_log_no_change before update or delete on audit_log
  for each row execute function audit_log_append_only();
