-- Inpatient notes (spec 8): progress notes, nursing notes and treatment plans for an admitted patient.
-- Append-only like the rest of the clinical record: there is no UPDATE or DELETE policy, so a correction is a new note,
-- and every note is written to the audit log with its author.

create table progress_notes (
  id           uuid primary key default gen_random_uuid(),
  admission_id uuid not null references admissions (id),
  patient_id   uuid not null references patients (id),
  note_type    text not null check (note_type in ('progress', 'nursing', 'treatment_plan')),
  body         text not null check (length(btrim(body)) > 0),
  author_id    uuid not null default auth.uid() references staff (id),
  created_at   timestamptz not null default now()
);
create index progress_notes_admission_idx on progress_notes (admission_id, created_at desc);
create index progress_notes_patient_idx on progress_notes (patient_id);

-- The patient always comes from the admission (the client cannot name a different one), and notes are only for
-- patients who are currently admitted.
create or replace function progress_notes_before_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare a public.admissions;
begin
  select * into a from public.admissions where id = new.admission_id;
  if not found then raise exception 'Admission not found'; end if;
  if a.status <> 'active' then raise exception 'Notes can only be added while the patient is admitted'; end if;
  new.patient_id := a.patient_id;
  new.body := btrim(new.body);
  return new;
end $$;
create trigger progress_notes_guard before insert on progress_notes
  for each row execute function progress_notes_before_insert();

alter table progress_notes enable row level security;
create policy progress_notes_read on progress_notes for select to authenticated
  using (has_role('doctor', 'nurse', 'hospital_admin', 'super_admin'));
-- Doctors write any type. Nurses write nursing and progress notes; a treatment plan is the doctor's.
create policy progress_notes_insert on progress_notes for insert to authenticated
  with check (
    author_id = auth.uid()
    and (has_role('doctor') or (has_role('nurse') and note_type in ('nursing', 'progress')))
  );

revoke all on progress_notes from anon;
create trigger audit_progress_notes after insert or update or delete on progress_notes
  for each row execute function audit_row();
alter publication supabase_realtime add table public.progress_notes;
