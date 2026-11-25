create or replace function public.schedule_saved_lead_follow_up(
  p_user_id uuid,
  p_lead_id text,
  p_follow_up_date date,
  p_next_action text
)
returns table (
  lead_id text,
  next_follow_up date,
  next_action text,
  changed boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_current_date date;
  v_current_action text;
  v_next_action text;
  v_changed boolean := false;
begin
  select l.status, l.next_follow_up, l.next_action
  into v_status, v_current_date, v_current_action
  from public.saved_leads l
  where l.user_id = p_user_id and l.lead_id = p_lead_id
  for update;

  if not found then
    raise exception 'saved_lead_not_found';
  end if;

  if p_follow_up_date is not null and v_status in ('Ganhou', 'Perdeu') then
    raise exception 'terminal_lead_cannot_be_scheduled';
  end if;

  if p_follow_up_date is not null
    and p_follow_up_date < (now() at time zone 'America/Sao_Paulo')::date then
    raise exception 'follow_up_date_in_the_past';
  end if;

  v_next_action := case
    when p_follow_up_date is null then null
    else nullif(trim(p_next_action), '')
  end;

  if p_follow_up_date is not null and v_next_action is null then
    raise exception 'follow_up_action_required';
  end if;

  if v_current_date is distinct from p_follow_up_date
    or v_current_action is distinct from v_next_action then
    update public.saved_leads l
    set next_follow_up = p_follow_up_date,
        next_action = v_next_action,
        updated_at = now()
    where l.user_id = p_user_id and l.lead_id = p_lead_id;
    v_changed := true;
  end if;

  return query
  select p_lead_id, p_follow_up_date, v_next_action, v_changed;
end;
$$;

revoke all on function public.schedule_saved_lead_follow_up(uuid, text, date, text) from public, anon, authenticated;
grant execute on function public.schedule_saved_lead_follow_up(uuid, text, date, text) to service_role;
