-- Automatic expiry alerts (spec 14). generate_expiry_alerts() used to notify again on every run, so it could not be
-- scheduled. It now remembers which batch it has already reported (once when the batch comes within p_days of expiry,
-- once more if it actually expires with stock left), is limited to admins and pharmacists, and runs daily via pg_cron.

create table expiry_alerts_sent (
  batch_id   uuid not null references stock_batches (id),
  stage      text not null check (stage in ('approaching', 'expired')),
  alerted_at timestamptz not null default now(),
  primary key (batch_id, stage)
);
-- Internal bookkeeping: row-level security on with no policy, so only the SECURITY DEFINER function can touch it.
alter table expiry_alerts_sent enable row level security;

-- Same signature as before, so the existing grant to authenticated still applies. Returns how many NEW alerts were raised.
create or replace function generate_expiry_alerts(p_days int default 90) returns int
language plpgsql security definer set search_path = public as $$
declare n int := 0; r record; v_days int := least(greatest(coalesce(p_days, 90), 0), 730);
begin
  -- auth.uid() is null for pg_cron and the service role
  if auth.uid() is not null and not public.has_role('hospital_admin', 'super_admin', 'pharmacist') then
    raise exception 'Not allowed to run expiry alerts' using errcode = '42501';
  end if;

  for r in
    select sb.id, d.name, sb.batch_number, sb.expiry_date, sb.quantity, (sb.expiry_date < current_date) as is_expired
    from public.stock_batches sb join public.drugs d on d.id = sb.drug_id
    where sb.quantity > 0 and sb.expiry_date <= current_date + v_days
    order by sb.expiry_date
  loop
    insert into public.expiry_alerts_sent (batch_id, stage)
    values (r.id, case when r.is_expired then 'expired' else 'approaching' end)
    on conflict do nothing;
    if found then
      perform public.notify_roles(array['hospital_admin', 'super_admin', 'pharmacist']::staff_role[], 'expiry',
        case when r.is_expired then 'Drug batch expired' else 'Drug approaching expiry' end,
        r.name || ' batch ' || coalesce(r.batch_number, '-') || (case when r.is_expired then ' expired ' else ' expires ' end) ||
          r.expiry_date || ' (' || r.quantity || ' left)',
        null, '/pharmacy');
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;

-- Daily at 05:00 UTC (06:00 in Lagos). If pg_cron is missing the migration still succeeds; call the function by hand.
do $$
begin
  create extension if not exists pg_cron;
  perform cron.schedule('expiry-alerts', '0 5 * * *', 'select public.generate_expiry_alerts()');
exception when others then
  raise notice 'pg_cron not available (%); call generate_expiry_alerts() by hand', sqlerrm;
end $$;
