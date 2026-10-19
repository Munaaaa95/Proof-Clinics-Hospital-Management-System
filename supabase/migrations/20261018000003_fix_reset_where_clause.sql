-- Supabase blocks UPDATE without WHERE (pg-safeupdate). Give the bed reset an explicit condition.
create or replace function reset_demo_data() returns void
language plpgsql security definer set search_path = public as $$
begin
  truncate table
    dispensing, stock_movements, medication_administrations, prescriptions, lab_results, lab_requests,
    diagnoses, consultations, vitals, payments, bill_items, bills, admissions, appointments, visits,
    anc_visits, anc_records, next_of_kin, patients, stock_batches
  restart identity cascade;

  perform setval('patient_code_seq', 1, false);
  update beds set status = 'available' where status <> 'available';

  -- Same starting stock as supabase/seed.sql (Paracetamol exactly 100 so the demo shows 100 -> 90).
  insert into stock_batches (drug_id, batch_number, expiry_date, quantity, supplier)
  select d.id, 'B-' || upper(left(md5(d.name), 5)),
         case when d.name like 'ORS%' then current_date + 45 else current_date + 540 end,
         case d.name when 'Paracetamol 500mg' then 100 when 'ORS Sachet' then 25 else 150 end,
         'Demo Supplier Ltd'
  from drugs d;
end $$;

revoke all on function reset_demo_data() from public, anon, authenticated;
grant execute on function reset_demo_data() to service_role;
