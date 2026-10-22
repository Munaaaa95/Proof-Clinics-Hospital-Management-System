-- Permission review (scripts/permission-check.mjs). Row-level security says WHO may write a table, but not WHICH
-- values. Three direct-insert/update paths let a role skip a workflow step. The guards below apply to signed-in
-- staff only (auth.uid() is not null); the seed and reset scripts run with the service key and are not affected.

-- 1. A doctor could insert a prescription that was already 'dispensed' (skipping pharmacy and stock reduction).
create or replace function prescriptions_guard() returns trigger
language plpgsql as $$
begin
  if auth.uid() is null or not public.has_role('doctor') then return new; end if;
  if tg_op = 'INSERT' then
    if new.status <> 'prescribed' then
      raise exception 'A new prescription must have status prescribed' using errcode = '42501';
    end if;
  elsif new.status is distinct from old.status and not (old.status = 'prescribed' and new.status = 'cancelled') then
    raise exception 'A doctor can only cancel a prescription; the pharmacy dispenses it' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger prescriptions_guard_status before insert or update on prescriptions
  for each row execute function prescriptions_guard();

-- 2. A doctor could insert a lab request already 'finalized'. New requests always start as requested.
create or replace function lab_requests_before_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  select specimen_type into new.specimen_type from public.services where id = new.service_id;
  if auth.uid() is not null then
    new.status := 'requested';
    new.collected_at := null;
    new.collected_by := null;
  end if;
  return new;
end $$;

-- 3. Receptionists and nurses can update the queue, but they could set a disposition, or mark a visit completed
--    (skipping the consultation and its fee). They may only cancel a visit; the doctor's functions do the rest.
create or replace function visits_guard() returns trigger
language plpgsql as $$
begin
  if auth.uid() is null or not public.has_role('receptionist', 'nurse') then return new; end if;
  if tg_op = 'INSERT' then
    if new.status <> 'waiting' or new.disposition is not null or new.follow_up_plan is not null
       or new.started_at is not null or new.completed_at is not null then
      raise exception 'A new visit must start in the waiting queue' using errcode = '42501';
    end if;
  else
    if new.disposition is distinct from old.disposition or new.follow_up_plan is distinct from old.follow_up_plan
       or new.started_at is distinct from old.started_at or new.completed_at is distinct from old.completed_at
       or (new.status is distinct from old.status and new.status <> 'cancelled') then
      raise exception 'Only the doctor can start, complete or set the outcome of a visit' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
create trigger visits_guard_workflow before insert or update on visits
  for each row execute function visits_guard();
