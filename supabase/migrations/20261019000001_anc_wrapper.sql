-- ANC wrapper (spec 15): the pattern for the specialty modules.
-- One call opens the mother's record on the first visit and adds each visit after it, with the checks the
-- tables alone cannot make. SECURITY INVOKER, so the existing ANC row-level security still decides who may write.

create or replace function record_anc_visit(
  p_patient_id        uuid,
  p_visit_date        date default null,          -- default: today (Lagos)
  p_lmp               date default null,          -- required on the first visit; EDD is calculated from it
  p_gravida           int default null,
  p_parity            int default null,
  p_risk_factors      text default null,
  p_gestational_weeks int default null,           -- default: calculated from the LMP
  p_complaints        text default null,
  p_bp_systolic       int default null,
  p_bp_diastolic      int default null,
  p_weight_kg         numeric default null,
  p_fundal_height_cm  numeric default null,
  p_findings          text default null,
  p_investigations    text default null,
  p_supplements       text default null,
  p_follow_up_date    date default null
) returns jsonb language plpgsql as $$
declare
  v_today   date := (now() at time zone 'Africa/Lagos')::date;
  v_date    date := coalesce(p_visit_date, (now() at time zone 'Africa/Lagos')::date);
  v_sex     sex_type;
  rec       anc_records;
  v_created boolean := false;
  v_weeks   int;
  v_visit   uuid;
begin
  if not has_role('doctor', 'nurse', 'community_health') then
    raise exception 'Not allowed to record antenatal care' using errcode = '42501';
  end if;

  select sex into v_sex from patients where id = p_patient_id;
  if not found then raise exception 'Patient not found'; end if;
  if v_sex = 'male' then raise exception 'Antenatal care is for female patients'; end if;

  if v_date > v_today then raise exception 'Visit date cannot be in the future'; end if;
  if p_follow_up_date is not null and p_follow_up_date <= v_date then
    raise exception 'Follow-up date must be after the visit date';
  end if;
  if (p_bp_systolic is null) <> (p_bp_diastolic is null) then
    raise exception 'Enter both blood pressure values';
  end if;
  if p_bp_systolic <= p_bp_diastolic then
    raise exception 'Systolic pressure must be higher than diastolic';
  end if;
  if p_lmp is not null and (p_lmp > v_date or p_lmp < v_date - 300) then
    raise exception 'Last menstrual period must fall in the 300 days before the visit';
  end if;

  select * into rec from anc_records where patient_id = p_patient_id for update;
  if not found then
    if p_lmp is null then
      raise exception 'Last menstrual period is required to open an antenatal record';
    end if;
    insert into anc_records (patient_id, lmp, edd, gravida, parity, risk_factors)
    values (p_patient_id, p_lmp, p_lmp + 280, p_gravida, p_parity, nullif(btrim(p_risk_factors), ''))
    returning * into rec;
    v_created := true;
  elsif p_lmp is not null or p_gravida is not null or p_parity is not null or nullif(btrim(p_risk_factors), '') is not null then
    -- Later visits may correct or add to the record; fields left out keep their value.
    update anc_records
       set lmp = coalesce(p_lmp, lmp),
           edd = coalesce(p_lmp + 280, edd),
           gravida = coalesce(p_gravida, gravida),
           parity = coalesce(p_parity, parity),
           risk_factors = coalesce(nullif(btrim(p_risk_factors), ''), risk_factors)
     where id = rec.id
    returning * into rec;
  end if;

  -- Gravida counts the current pregnancy, so parity is always lower.
  if rec.gravida is not null and rec.gravida < 1 then raise exception 'Gravida must be at least 1'; end if;
  if rec.parity is not null and rec.parity < 0 then raise exception 'Parity cannot be negative'; end if;
  if rec.gravida is not null and rec.parity is not null and rec.parity >= rec.gravida then
    raise exception 'Parity must be lower than gravida (gravida includes the current pregnancy)';
  end if;

  if rec.lmp is not null and v_date < rec.lmp then
    raise exception 'Visit date is before the last menstrual period';
  end if;
  v_weeks := coalesce(p_gestational_weeks, case when rec.lmp is not null then ((v_date - rec.lmp) / 7) end);
  if v_weeks is not null and v_weeks not between 0 and 45 then
    raise exception 'Gestational age must be between 0 and 45 weeks (got %)', v_weeks;
  end if;

  insert into anc_visits (
    anc_record_id, patient_id, visit_date, gestational_weeks, complaints, bp_systolic, bp_diastolic,
    weight_kg, fundal_height_cm, findings, investigations, supplements, follow_up_date
  ) values (
    rec.id, p_patient_id, v_date, v_weeks, p_complaints, p_bp_systolic, p_bp_diastolic,
    p_weight_kg, p_fundal_height_cm, p_findings, p_investigations, p_supplements, p_follow_up_date
  ) returning id into v_visit;

  return jsonb_build_object(
    'anc_record_id', rec.id, 'anc_visit_id', v_visit, 'record_created', v_created,
    'edd', rec.edd, 'gestational_weeks', v_weeks);
end $$;

-- One row per mother for the ANC screen: record, latest visit, weeks now, next follow-up.
-- SECURITY INVOKER, so only roles that can read ANC rows get any.
create view anc_summary with (security_invoker = true) as
select r.id as anc_record_id, r.patient_id, p.patient_code, p.full_name, p.dob,
       r.lmp, r.edd, r.gravida, r.parity, r.risk_factors,
       case when r.lmp is not null then (((now() at time zone 'Africa/Lagos')::date - r.lmp) / 7) end as weeks_now,
       (r.edd - (now() at time zone 'Africa/Lagos')::date) as days_to_edd,
       vc.visit_count,
       lv.visit_date as last_visit_date, lv.gestational_weeks as last_gestational_weeks,
       lv.bp_systolic, lv.bp_diastolic, lv.weight_kg, lv.fundal_height_cm, lv.findings,
       lv.follow_up_date as next_follow_up,
       coalesce(lv.follow_up_date < (now() at time zone 'Africa/Lagos')::date, false) as follow_up_overdue
from anc_records r
join patients p on p.id = r.patient_id
left join lateral (
  select * from anc_visits v where v.anc_record_id = r.id order by v.visit_date desc, v.created_at desc limit 1
) lv on true
left join lateral (
  select count(*)::int as visit_count from anc_visits v where v.anc_record_id = r.id
) vc on true;

revoke execute on function record_anc_visit(uuid, date, date, int, int, text, int, text, int, int, numeric, numeric, text, text, text, date)
  from public, anon;
grant execute on function record_anc_visit(uuid, date, date, int, int, text, int, text, int, int, numeric, numeric, text, text, text, date)
  to authenticated;
revoke all on anc_summary from public, anon;
grant select on anc_summary to authenticated;
