-- Skumbutikken · fase 1 · rettigheder, filer og realtime
-- (anvendt sammen med 0002 som én migration "logic_rls" i Supabase)
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke execute on all functions in schema public from anon, public, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon;

alter table public.employees enable row level security;
alter table public.customers enable row level security;
alter table public.orders enable row level security;
alter table public.order_parts enable row level security;
alter table public.order_versions enable row level security;
alter table public.order_confirmations enable row level security;
alter table public.tailor_tasks enable row level security;
alter table public.comments enable row level security;
alter table public.attachments enable row level security;
alter table public.notifications enable row level security;
alter table public.audit_log enable row level security;
alter table public.number_series enable row level security;

revoke all on public.employees from authenticated;
grant select (id, display_name, email, role, title, active, sort_order, has_pin, created_at, updated_at) on public.employees to authenticated;
grant update (display_name, role, title, sort_order) on public.employees to authenticated;
create policy emp_select on public.employees for select to authenticated using (public.is_active_employee());
create policy emp_update on public.employees for update to authenticated using (public.is_admin()) with check (public.is_admin());

create policy cust_all on public.customers for all to authenticated using (public.is_staff()) with check (public.is_staff());
revoke delete on public.customers from authenticated;

create policy ord_select on public.orders for select to authenticated using (public.is_staff());
create policy ord_insert on public.orders for insert to authenticated with check (public.is_staff());
create policy ord_update on public.orders for update to authenticated using (public.is_staff()) with check (public.is_staff());
create policy ord_delete on public.orders for delete to authenticated using (public.is_admin() and status = 'kladde' and confirmed_version is null);
revoke update on public.orders from authenticated;
revoke insert on public.orders from authenticated;
grant insert (title, customer_id, price_mode, discount_ore, deposit_ore, deadline, delivery_mode,
              assigned_tailor, priority, internal_notes) on public.orders to authenticated;
grant update (title, customer_id, price_mode, discount_ore, deposit_ore, deadline, delivery_mode,
              assigned_tailor, priority, internal_notes) on public.orders to authenticated;

create policy parts_all on public.order_parts for all to authenticated using (public.is_staff()) with check (public.is_staff());
revoke update on public.order_parts from authenticated;
grant update (sort, part_type, label, quantity, shape, length_cm, width_cm, thickness_cm, measure_basis,
              seam_allowance_cm, foam_type, firmness, foam_item_no, fabric, fabric_color, fabric_item_no, zipper,
              sewing, accessories, instructions, material_source, unit_price_ore) on public.order_parts to authenticated;

create policy ver_select on public.order_versions for select to authenticated using (public.is_staff());
create policy conf_select on public.order_confirmations for select to authenticated using (public.is_staff());
revoke insert, update, delete on public.order_versions, public.order_confirmations from authenticated;

create policy task_select on public.tailor_tasks for select to authenticated
  using (public.is_staff() or (tailor_id = auth.uid() and public.is_active_employee()));
revoke insert, update, delete on public.tailor_tasks from authenticated;

create policy com_select on public.comments for select to authenticated
  using (public.is_staff() or public.is_my_task_order(order_id));
create policy com_insert on public.comments for insert to authenticated
  with check (author = auth.uid() and (public.is_staff() or public.is_my_task_order(order_id)));
revoke update, delete on public.comments from authenticated;
grant update (resolved) on public.comments to authenticated;
create policy com_resolve on public.comments for update to authenticated using (public.is_staff()) with check (public.is_staff());

create policy att_select on public.attachments for select to authenticated
  using (public.is_staff() or public.is_my_task_order(order_id));
create policy att_insert on public.attachments for insert to authenticated
  with check (uploaded_by = auth.uid() and (public.is_staff() or public.is_my_task_order(order_id)));
create policy att_delete on public.attachments for delete to authenticated using (public.is_staff());
revoke update on public.attachments from authenticated;

create policy notif_select on public.notifications for select to authenticated using (user_id = auth.uid());
revoke insert, update, delete on public.notifications from authenticated;
grant update (read_at) on public.notifications to authenticated;
create policy notif_update on public.notifications for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy audit_select on public.audit_log for select to authenticated using (public.is_admin());
revoke insert, update, delete on public.audit_log from authenticated;
create policy ns_select on public.number_series for select to authenticated using (public.is_admin());
revoke insert, update, delete on public.number_series from authenticated;

grant execute on function public.my_role(), public.is_staff(), public.is_admin(), public.is_active_employee(),
  public.is_my_task_order(uuid), public.can_access_order_path(text),
  public.order_totals_checked(uuid), public.validate_order_checked(uuid),
  public.prepare_order(uuid,int), public.confirm_order(uuid,int),
  public.my_tasks(), public.task_detail(uuid), public.set_part_progress(uuid,uuid,int,text),
  public.task_action(uuid,text,text), public.mark_picked_up(uuid), public.order_to_control(uuid),
  public.set_my_pin(text), public.verify_my_pin(text)
  to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('bilag', 'bilag', false, 15728640, array['image/jpeg','image/png','image/webp','image/heic','application/pdf'])
on conflict (id) do nothing;

create policy bilag_select on storage.objects for select to authenticated
  using (bucket_id = 'bilag' and public.can_access_order_path(name));
create policy bilag_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'bilag' and public.can_access_order_path(name));
create policy bilag_delete on storage.objects for delete to authenticated
  using (bucket_id = 'bilag' and public.is_staff());

alter publication supabase_realtime add table public.customers, public.orders, public.order_parts,
  public.tailor_tasks, public.comments, public.notifications, public.attachments;
alter table public.orders replica identity full;
alter table public.order_parts replica identity full;
alter table public.tailor_tasks replica identity full;
