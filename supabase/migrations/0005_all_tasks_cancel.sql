-- se Supabase-migration "all_tasks_cancel" (staff-oversigt over skrædderopgaver, annullering, realtime for medarbejdere)
create or replace function public.all_tasks() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_staff() then raise exception 'Ingen adgang' using errcode = '42501'; end if;
  return (select coalesce(jsonb_agg(public.task_payload(t) order by
     (t.status = 'godkendt'), (o.priority = 'hoj') desc, o.deadline nulls last), '[]'::jsonb)
  from public.tailor_tasks t join public.orders o on o.id = t.order_id
  where t.status <> 'godkendt' or t.approved_at > now() - interval '14 days');
end $$;

create or replace function public.cancel_order(p_order_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare o public.orders; t public.tailor_tasks;
begin
  if not public.is_staff() then raise exception 'Ingen adgang' using errcode = '42501'; end if;
  if coalesce(trim(p_reason),'') = '' then raise exception 'Angiv en årsag'; end if;
  select * into o from public.orders where id = p_order_id for update;
  if o.status in ('afhentet','annulleret') then raise exception 'Ordren er allerede afsluttet'; end if;
  update public.orders set status = 'annulleret', prepared_version = null where id = p_order_id;
  insert into public.comments(order_id, author, body) values (p_order_id, auth.uid(), 'Annulleret: ' || p_reason);
  select * into t from public.tailor_tasks where order_id = p_order_id;
  if t.id is not null and t.status <> 'godkendt' then
    insert into public.notifications(user_id, kind, title, body, order_id)
    values (t.tailor_id, 'annulleret', 'Ordre ' || o.order_no || ' er annulleret', p_reason, p_order_id);
  end if;
end $$;

revoke execute on function public.all_tasks(), public.cancel_order(uuid, text) from public, anon;
grant execute on function public.all_tasks(), public.cancel_order(uuid, text) to authenticated;
alter publication supabase_realtime add table public.employees;
