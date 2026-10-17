-- Reference data for the demo (all fake). Staff users are created by scripts/create-demo-users.mjs
-- because they must exist in Supabase Auth first. Fake patients/visits come from the reset script.

insert into services (name, category, specimen_type, price) values
  ('General Consultation', 'consultation', null, 5000),
  ('Malaria Parasite (MP) Test', 'lab', 'Blood', 2500),
  ('Full Blood Count (FBC)', 'lab', 'Blood', 6000),
  ('Fasting Blood Sugar', 'lab', 'Blood', 2000),
  ('Urinalysis', 'lab', 'Urine', 3000),
  ('Wound Dressing', 'procedure', null, 4000)
on conflict (name) do nothing;

insert into wards (name, daily_rate) values
  ('Male Ward', 15000),
  ('Female Ward', 15000),
  ('Maternity Ward', 20000)
on conflict (name) do nothing;

insert into beds (ward_id, bed_number)
select w.id, 'B' || n
from wards w, generate_series(1, 6) n
on conflict do nothing;

insert into drugs (name, unit, min_stock, unit_price) values
  ('Paracetamol 500mg', 'tablet', 30, 20),
  ('Amoxicillin 500mg', 'capsule', 30, 60),
  ('Artemether/Lumefantrine', 'tablet', 24, 250),
  ('Ibuprofen 400mg', 'tablet', 30, 30),
  ('ORS Sachet', 'sachet', 20, 100)
on conflict (name) do nothing;

-- One batch per drug. Paracetamol starts at exactly 100 so the demo shows 100 -> 90.
insert into stock_batches (drug_id, batch_number, expiry_date, quantity, supplier)
select d.id, 'B-' || upper(left(md5(d.name), 5)),
       case when d.name like 'ORS%' then current_date + 45 else current_date + 540 end,
       case d.name when 'Paracetamol 500mg' then 100 when 'ORS Sachet' then 25 else 150 end,
       'Demo Supplier Ltd'
from drugs d
where not exists (select 1 from stock_batches sb where sb.drug_id = d.id);
