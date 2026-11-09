-- Skumbutikken · fase 1 · forretningslogik, adgangsregler og realtime

alter table public.tailor_tasks add column progress int not null default 0 check (progress between 0 and 100);
alter table public.employees add column has_pin boolean generated always as (pin_hash is not null) stored;

-- =====================================================================
-- Beløb: heltal i øre. Moms 25 %. Afrunding: halvt op (numeric round).
--  ekskl.: grundlag = linjer - rabat; moms = round(grundlag * 0,25); total = grundlag + moms
--  inkl.:  total = linjer - rabat; grundlag = round(total / 1,25); moms = total - grundlag
-- =====================================================================
create or replace function public.order_totals(p_order_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare o public.orders; lines bigint; net bigint; base bigint; vat bigint; total bigint;
begin
  select * into o from public.orders where id = p_order_id;
  select coalesce(sum(quantity * unit_price_ore), 0) into lines from public.order_parts where order_id = p_order_id;
  net := greatest(lines - o.discount_ore, 0);
  if o.price_mode = 'ekskl' then
    base := net; vat := round(base * 0.25); total := base + vat;
  else
    total := net; base := round(total / 1.25); vat := total - base;
  end if;
  return jsonb_build_object('lines_ore', lines, 'discount_ore', o.discount_ore, 'base_ore', base,
    'vat_ore', vat, 'total_ore', total, 'deposit_ore', o.deposit_ore,
    'rest_ore', greatest(total - o.deposit_ore, 0), 'price_mode', o.price_mode, 'vat_rate', 25);
end $$;

-- ---------- Validering før kundens bekræftelse ----------
create or replace function public.validate_order(p_order_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare o public.orders; c public.customers; p record; errs jsonb := '[]'::jsonb; n int;
  procedure_add text;
begin
  select * into o from public.orders where id = p_order_id;
  if o.customer_id is null then
    errs := errs || jsonb_build_object('field','customer','msg','Vælg eller opret en kunde');
  else
    select * into c from public.customers where id = o.customer_id;
    if coalesce(trim(c.name),'') = '' then errs := errs || jsonb_build_object('field','customer.name','msg','Kundens navn mangler'); end if;
    if coalesce(trim(c.phone),'') = '' and coalesce(trim(c.email),'') = '' then
      errs := errs || jsonb_build_object('field','customer.phone','msg','Telefon eller e-mail mangler'); end if;
    if c.preferred_contact = 'email' and coalesce(trim(c.email),'') = '' then
      errs := errs || jsonb_build_object('field','customer.email','msg','Kunden ønsker e-mail, men e-mail mangler'); end if;
    if c.preferred_contact in ('sms','telefon') and coalesce(trim(c.phone),'') = '' then
      errs := errs || jsonb_build_object('field','customer.phone','msg','Kunden ønsker SMS/telefon, men telefon mangler'); end if;
    if c.kind = 'erhverv' and coalesce(trim(c.company),'') = '' then
      errs := errs || jsonb_build_object('field','customer.company','msg','Virksomhedsnavn mangler'); end if;
    if o.delivery_mode = 'levering' and coalesce(trim(c.delivery_address), trim(c.billing_address), '') = '' then
      errs := errs || jsonb_build_object('field','customer.delivery_address','msg','Leveringsadresse mangler'); end if;
  end if;
  if o.deadline is null then errs := errs || jsonb_build_object('field','deadline','msg','Aftalt færdigdato mangler'); end if;

  select count(*) into n from public.order_parts where order_id = p_order_id;
  if n = 0 then errs := errs || jsonb_build_object('field','parts','msg','Ordren har ingen dele'); end if;

  for p in select * from public.order_parts where order_id = p_order_id order by sort loop
    if coalesce(trim(p.label),'') = '' then
      errs := errs || jsonb_build_object('part_id', p.id, 'field','label','msg','Betegnelse mangler'); end if;
    if p.part_type in ('skum','hynde_betraek','betraek') then
      if coalesce(p.length_cm,0) <= 0 then errs := errs || jsonb_build_object('part_id', p.id, 'field','length_cm','msg','Længde mangler'); end if;
      if coalesce(p.width_cm,0) <= 0 then errs := errs || jsonb_build_object('part_id', p.id, 'field','width_cm','msg','Bredde mangler'); end if;
      if coalesce(p.thickness_cm,0) <= 0 then errs := errs || jsonb_build_object('part_id', p.id, 'field','thickness_cm','msg','Tykkelse mangler'); end if;
    end if;
    if p.part_type in ('skum','hynde_betraek') and coalesce(trim(p.foam_type),'') = '' then
      errs := errs || jsonb_build_object('part_id', p.id, 'field','foam_type','msg','Skumtype mangler'); end if;
    if p.part_type in ('hynde_betraek','betraek') and coalesce(trim(p.fabric),'') = '' then
      errs := errs || jsonb_build_object('part_id', p.id, 'field','fabric','msg','Stof mangler'); end if;
    if p.part_type = 'andet' and coalesce(trim(p.instructions),'') = '' then
      errs := errs || jsonb_build_object('part_id', p.id, 'field','instructions','msg','Beskriv opgaven'); end if;
  end loop;
  return errs;
end $$;

-- ---------- Snapshot af den version kunden ser ----------
create or replace function public.build_snapshot(p_order_id uuid, p_version int) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'version', p_version,
    'order', jsonb_build_object('id', o.id, 'order_no', o.order_no, 'title', o.title, 'deadline', o.deadline,
       'delivery_mode', o.delivery_mode, 'price_mode', o.price_mode),
    'customer', jsonb_build_object('name', c.name, 'kind', c.kind, 'company', c.company, 'cvr', c.cvr,
       'phone', c.phone, 'email', c.email, 'billing_address', c.billing_address,
       'delivery_address', c.delivery_address, 'preferred_contact', c.preferred_contact),
    'parts', coalesce((select jsonb_agg(jsonb_build_object(
        'id', p.id, 'label', p.label, 'part_type', p.part_type, 'quantity', p.quantity, 'shape', p.shape,
        'length_cm', p.length_cm, 'width_cm', p.width_cm, 'thickness_cm', p.thickness_cm,
        'measure_basis', p.measure_basis, 'seam_allowance_cm', p.seam_allowance_cm,
        'foam_type', p.foam_type, 'firmness', p.firmness, 'fabric', p.fabric, 'fabric_color', p.fabric_color,
        'zipper', p.zipper, 'sewing', p.sewing, 'accessories', p.accessories, 'instructions', p.instructions,
        'unit_price_ore', p.unit_price_ore, 'line_ore', p.quantity * p.unit_price_ore,
        'sketches', coalesce((select jsonb_agg(a.path) from public.attachments a
                               where a.part_id = p.id and a.kind in ('skitse','skabelon')), '[]'::jsonb)
      ) order by p.sort) from public.order_parts p where p.order_id = o.id), '[]'::jsonb),
    'totals', public.order_totals(o.id))
  from public.orders o left join public.customers c on c.id = o.customer_id
  where o.id = p_order_id
$$;

-- ---------- Ændringer efter gennemgang ugyldiggør godkendelsen ----------
create or replace function public.invalidate_order(p_order_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare o public.orders;
begin
  select * into o from public.orders where id = p_order_id;
  if o.id is null or o.prepared_version is null then return; end if;
  if o.confirmed_version is not null and o.status not in ('kladde','klar_til_bekraeftelse') then
    update public.orders set prepared_version = null, prepared_by = null, prepared_at = null, needs_reconfirm = true
     where id = p_order_id;
  else
    update public.orders set prepared_version = null, prepared_by = null, prepared_at = null,
           status = 'kladde' where id = p_order_id;
  end if;
end $$;

create or replace function public.parts_changed_trg() returns trigger
language plpgsql security definer set search_path = public as $$
declare oid uuid := coalesce(new.order_id, old.order_id);
  a jsonb; b jsonb;
begin
  if tg_op = 'UPDATE' then
    a := to_jsonb(new) - array['progress','stage','row_version','updated_at','updated_by','sort'];
    b := to_jsonb(old) - array['progress','stage','row_version','updated_at','updated_by','sort'];
    if a = b then return null; end if;
  end if;
  perform public.invalidate_order(oid);
  return null;
end $$;
create trigger parts_changed after insert or update or delete on public.order_parts
  for each row execute function public.parts_changed_trg();

create or replace function public.orders_changed_trg() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (new.customer_id, new.price_mode, new.discount_ore, new.deposit_ore, new.deadline, new.delivery_mode, new.title)
     is distinct from
     (old.customer_id, old.price_mode, old.discount_ore, old.deposit_ore, old.deadline, old.delivery_mode, old.title)
     and new.prepared_version is not null and new.prepared_version = old.prepared_version then
    if new.confirmed_version is not null and new.status not in ('kladde','klar_til_bekraeftelse') then
      new.prepared_version := null; new.prepared_by := null; new.prepared_at := null; new.needs_reconfirm := true;
    else
      new.prepared_version := null; new.prepared_by := null; new.prepared_at := null; new.status := 'kladde';
    end if;
  end if;
  -- skift af skrædder på en frigivet ordre flytter opgaven
  if new.assigned_tailor is distinct from old.assigned_tailor and new.assigned_tailor is not null
     and exists (select 1 from public.tailor_tasks t where t.order_id = new.id) then
    update public.tailor_tasks set tailor_id = new.assigned_tailor where order_id = new.id;
    insert into public.notifications(user_id, kind, title, body, order_id)
    values (new.assigned_tailor, 'tildeling', 'Ny opgave: ordre ' || new.order_no, new.title, new.id);
  end if;
  return new;
end $$;
create trigger orders_changed before update on public.orders for each row execute function public.orders_changed_trg();

create or replace function public.customers_changed_trg() returns trigger
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if (new.name, new.phone, new.email, new.billing_address, new.delivery_address, new.company, new.cvr, new.kind)
     is not distinct from
     (old.name, old.phone, old.email, old.billing_address, old.delivery_address, old.company, old.cvr, old.kind) then
    return null;
  end if;
  for r in select id from public.orders where customer_id = new.id and prepared_version is not null
           and status not in ('afhentet','annulleret') loop
    perform public.invalidate_order(r.id);
  end loop;
  return null;
end $$;
create trigger customers_changed after update on public.customers for each row execute function public.customers_changed_trg();

-- ---------- Klar til kundens bekræftelse ----------
create or replace function public.prepare_order(p_order_id uuid, p_row_version int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare o public.orders; errs jsonb; v int; snap jsonb;
begin
  if not public.is_staff() then raise exception 'Ingen adgang' using errcode = '42501'; end if;
  select * into o from public.orders where id = p_order_id for update;
  if o.id is null then raise exception 'Ordren findes ikke'; end if;
  if o.row_version <> p_row_version then
    return jsonb_build_object('ok', false, 'reason', 'konflikt', 'msg', 'Ordren er ændret på en anden enhed. Gennemse ændringerne.');
  end if;
  if o.status in ('afhentet','annulleret') then
    return jsonb_build_object('ok', false, 'reason', 'status', 'msg', 'Ordren er afsluttet');
  end if;
  errs := public.validate_order(p_order_id);
  if jsonb_array_length(errs) > 0 then
    return jsonb_build_object('ok', false, 'reason', 'mangler', 'errors', errs);
  end if;
  select coalesce(max(version), 0) + 1 into v from public.order_versions where order_id = p_order_id;
  snap := public.build_snapshot(p_order_id, v);
  insert into public.order_versions(order_id, version, snapshot, prepared_by) values (p_order_id, v, snap, auth.uid());
  update public.orders set prepared_version = v, prepared_by = auth.uid(), prepared_at = now(),
         status = case when status = 'kladde' then 'klar_til_bekraeftelse'::public.order_status else status end
   where id = p_order_id;
  return jsonb_build_object('ok', true, 'version', v, 'snapshot', snap);
end $$;

-- ---------- Kundens bekræftelse (idempotent, versionsbundet) ----------
create or replace function public.confirm_order(p_order_id uuid, p_version int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare o public.orders; c public.order_confirmations; t public.tailor_tasks;
begin
  if not public.is_staff() then raise exception 'Ingen adgang' using errcode = '42501'; end if;
  select * into o from public.orders where id = p_order_id for update;
  select * into c from public.order_confirmations where order_id = p_order_id and version = p_version;
  if c.id is not null then
    return jsonb_build_object('ok', true, 'already', true, 'order_no', o.order_no, 'version', c.version, 'confirmed_at', c.confirmed_at);
  end if;
  if o.prepared_version is distinct from p_version then
    return jsonb_build_object('ok', false, 'reason', 'ny_version',
      'msg', 'Ordren er blevet ændret. Kunden skal gennemse den nye version.');
  end if;
  insert into public.order_confirmations(order_id, version, device_user) values (p_order_id, p_version, auth.uid())
    returning * into c;
  update public.orders set confirmed_version = p_version, needs_reconfirm = false, kind = 'ordre',
         status = case when status in ('kladde','klar_til_bekraeftelse') then 'bekraeftet'::public.order_status else status end
   where id = p_order_id;
  -- frigiv til skrædder
  if o.assigned_tailor is not null then
    select * into t from public.tailor_tasks where order_id = p_order_id;
    if t.id is null then
      insert into public.tailor_tasks(order_id, tailor_id, released_version)
      values (p_order_id, o.assigned_tailor, p_version);
      insert into public.notifications(user_id, kind, title, body, order_id)
      values (o.assigned_tailor, 'tildeling', 'Ny opgave: ordre ' || o.order_no, o.title, p_order_id);
    else
      update public.tailor_tasks set released_version = p_version, tailor_id = o.assigned_tailor where id = t.id;
      insert into public.notifications(user_id, kind, title, body, order_id)
      values (o.assigned_tailor, 'aendring', 'Ordre ' || o.order_no || ' er ændret – se nye mål/materialer', o.title, p_order_id);
    end if;
  end if;
  return jsonb_build_object('ok', true, 'order_no', o.order_no, 'version', p_version, 'confirmed_at', c.confirmed_at);
end $$;

-- ---------- Skrædderen ----------
create or replace function public.is_my_task_order(p_order_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.tailor_tasks t join public.employees e on e.id = t.tailor_id and e.active
                 where t.order_id = p_order_id and t.tailor_id = auth.uid())
$$;

create or replace function public.task_payload(t public.tailor_tasks) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', t.id, 'status', t.status, 'progress', t.progress, 'pause_reason', t.pause_reason,
    'released_version', t.released_version, 'tailor_id', t.tailor_id, 'updated_at', t.updated_at,
    'order', jsonb_build_object('id', o.id, 'order_no', o.order_no, 'title', o.title, 'deadline', o.deadline,
       'priority', o.priority, 'status', o.status, 'needs_reconfirm', o.needs_reconfirm,
       'customer_first_name', split_part(coalesce(c.name,''), ' ', 1)),
    'parts', coalesce((select jsonb_agg(jsonb_build_object(
        'id', p.id, 'label', p.label, 'part_type', p.part_type, 'quantity', p.quantity, 'shape', p.shape,
        'length_cm', p.length_cm, 'width_cm', p.width_cm, 'thickness_cm', p.thickness_cm,
        'measure_basis', p.measure_basis, 'seam_allowance_cm', p.seam_allowance_cm,
        'foam_type', p.foam_type, 'firmness', p.firmness, 'fabric', p.fabric, 'fabric_color', p.fabric_color,
        'fabric_item_no', p.fabric_item_no, 'zipper', p.zipper, 'sewing', p.sewing, 'accessories', p.accessories,
        'instructions', p.instructions, 'material_source', p.material_source,
        'progress', p.progress, 'stage', p.stage) order by p.sort)
      from public.order_parts p where p.order_id = o.id), '[]'::jsonb),
    'open_questions', (select count(*) from public.comments cm where cm.order_id = o.id and cm.is_question and not cm.resolved))
  from public.orders o left join public.customers c on c.id = o.customer_id where o.id = t.order_id
$$;

create or replace function public.my_tasks() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(public.task_payload(t) order by
     (t.status = 'godkendt'), (o.priority = 'hoj') desc, o.deadline nulls last), '[]'::jsonb)
  from public.tailor_tasks t join public.orders o on o.id = t.order_id
  where t.tailor_id = auth.uid() and public.is_active_employee()
    and (t.status <> 'godkendt' or t.approved_at > now() - interval '14 days')
$$;

create or replace function public.task_detail(p_task_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare t public.tailor_tasks;
begin
  select * into t from public.tailor_tasks where id = p_task_id;
  if t.id is null or not (t.tailor_id = auth.uid() or public.is_staff()) or not public.is_active_employee() then
    raise exception 'Ingen adgang' using errcode = '42501';
  end if;
  return public.task_payload(t);
end $$;

create or replace function public.recalc_task(p_order_id uuid) returns int
language plpgsql security definer set search_path = public as $$
declare pr int;
begin
  -- Samlet fremdrift = antalsvægtet gennemsnit af ordredelenes fremdrift, afrundet ned til nærmeste 10 %
  select coalesce(floor(sum(progress * quantity)::numeric / nullif(sum(quantity),0) / 10) * 10, 0)::int
    into pr from public.order_parts where order_id = p_order_id;
  update public.tailor_tasks set progress = pr where order_id = p_order_id;
  return pr;
end $$;

create or replace function public.finish_task_internal(t public.tailor_tasks) returns void
language plpgsql security definer set search_path = public as $$
declare o public.orders; r record;
begin
  update public.tailor_tasks set status = 'faerdig', done_at = now(), progress = 100, pause_reason = null where id = t.id;
  update public.orders set status = 'til_kontrol' where id = t.order_id and status in ('bekraeftet','i_arbejde');
  select * into o from public.orders where id = t.order_id;
  for r in select id from public.employees where active and role in ('admin','butik') loop
    insert into public.notifications(user_id, kind, title, body, order_id)
    values (r.id, 'kontrol', 'Til kontrol: ordre ' || o.order_no, o.title, o.id);
  end loop;
end $$;

create or replace function public.set_part_progress(p_task_id uuid, p_part_id uuid, p_progress int, p_stage text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare t public.tailor_tasks; pr int;
begin
  select * into t from public.tailor_tasks where id = p_task_id for update;
  if t.id is null or not (t.tailor_id = auth.uid() or public.is_staff()) or not public.is_active_employee() then
    raise exception 'Ingen adgang' using errcode = '42501'; end if;
  if t.status in ('faerdig','godkendt') then raise exception 'Opgaven er meldt færdig'; end if;
  if p_progress < 0 or p_progress > 100 or p_progress % 10 <> 0 then raise exception 'Fremdrift skal være 0–100 i trin af 10'; end if;
  update public.order_parts set progress = p_progress, stage = coalesce(p_stage, stage)
   where id = p_part_id and order_id = t.order_id;
  if not found then raise exception 'Ordredelen hører ikke til opgaven'; end if;
  pr := public.recalc_task(t.order_id);
  update public.tailor_tasks set status = 'i_gang', pause_reason = null,
         started_at = coalesce(started_at, now()), received_at = coalesce(received_at, now())
   where id = t.id and status in ('tildelt','modtaget','pause');
  update public.orders set status = 'i_arbejde' where id = t.order_id and status = 'bekraeftet';
  if pr = 100 then
    select * into t from public.tailor_tasks where id = p_task_id;
    perform public.finish_task_internal(t);
  end if;
  select * into t from public.tailor_tasks where id = p_task_id;
  return public.task_payload(t);
end $$;

create or replace function public.task_action(p_task_id uuid, p_action text, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare t public.tailor_tasks; o public.orders; r record;
begin
  select * into t from public.tailor_tasks where id = p_task_id for update;
  if t.id is null or not (t.tailor_id = auth.uid() or public.is_staff()) or not public.is_active_employee() then
    raise exception 'Ingen adgang' using errcode = '42501'; end if;
  select * into o from public.orders where id = t.order_id;
  if p_action = 'modtag' then
    update public.tailor_tasks set status = 'modtaget', received_at = coalesce(received_at, now())
     where id = t.id and status = 'tildelt';
  elsif p_action = 'start' then
    if t.status in ('faerdig','godkendt') then raise exception 'Opgaven er meldt færdig'; end if;
    update public.tailor_tasks set status = 'i_gang', pause_reason = null,
           received_at = coalesce(received_at, now()), started_at = coalesce(started_at, now()) where id = t.id;
    update public.orders set status = 'i_arbejde' where id = t.order_id and status = 'bekraeftet';
  elsif p_action = 'pause' then
    if coalesce(trim(p_reason),'') = '' then raise exception 'Angiv en årsag til pausen'; end if;
    update public.tailor_tasks set status = 'pause', pause_reason = p_reason where id = t.id and status in ('modtaget','i_gang','tildelt');
    for r in select id from public.employees where active and role in ('admin','butik') loop
      insert into public.notifications(user_id, kind, title, body, order_id)
      values (r.id, 'pause', 'Pause på ordre ' || o.order_no, p_reason, o.id);
    end loop;
  elsif p_action = 'faerdig' then
    if t.status in ('faerdig','godkendt') then return public.task_payload(t); end if;
    update public.order_parts set progress = 100 where order_id = t.order_id;
    perform public.finish_task_internal(t);
  elsif p_action in ('godkend','afvis') then
    if not public.is_staff() then raise exception 'Kun butikken kan kontrollere' using errcode = '42501'; end if;
    if t.status <> 'faerdig' then raise exception 'Opgaven er ikke meldt færdig'; end if;
    if o.needs_reconfirm then raise exception 'Ordren er ændret og afventer kundens bekræftelse'; end if;
    if p_action = 'godkend' then
      update public.tailor_tasks set status = 'godkendt', approved_at = now(), approved_by = auth.uid() where id = t.id;
      update public.orders set status = 'klar_til_afhentning' where id = t.order_id;
    else
      if coalesce(trim(p_reason),'') = '' then raise exception 'Skriv hvad der skal rettes'; end if;
      update public.tailor_tasks set status = 'i_gang', done_at = null where id = t.id;
      update public.order_parts set progress = 90 where order_id = t.order_id and progress = 100;
      perform public.recalc_task(t.order_id);
      update public.orders set status = 'i_arbejde' where id = t.order_id;
      insert into public.comments(order_id, author, body, is_question) values (t.order_id, auth.uid(), 'Kontrol: ' || p_reason, false);
      insert into public.notifications(user_id, kind, title, body, order_id)
      values (t.tailor_id, 'omarbejde', 'Retning ønsket: ordre ' || o.order_no, p_reason, o.id);
    end if;
  else
    raise exception 'Ukendt handling %', p_action;
  end if;
  select * into t from public.tailor_tasks where id = p_task_id;
  return public.task_payload(t);
end $$;

create or replace function public.mark_picked_up(p_order_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_staff() then raise exception 'Ingen adgang' using errcode = '42501'; end if;
  update public.orders set status = 'afhentet' where id = p_order_id and status = 'klar_til_afhentning';
  if not found then raise exception 'Ordren er ikke klar til afhentning'; end if;
end $$;

-- Ordrer uden syarbejde kan sendes direkte til kontrol af butikken
create or replace function public.order_to_control(p_order_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_staff() then raise exception 'Ingen adgang' using errcode = '42501'; end if;
  update public.orders set status = 'klar_til_afhentning'
   where id = p_order_id and status in ('bekraeftet','i_arbejde','til_kontrol') and not needs_reconfirm
     and not exists (select 1 from public.tailor_tasks t where t.order_id = p_order_id and t.status <> 'godkendt');
  if not found then raise exception 'Ordren kan ikke klarmeldes endnu (afventer skrædder eller kundebekræftelse)'; end if;
end $$;

-- ---------- Kommentarer giver notifikationer ----------
create or replace function public.comments_notify_trg() returns trigger
language plpgsql security definer set search_path = public as $$
declare o public.orders; t public.tailor_tasks; r record; who text;
begin
  select * into o from public.orders where id = new.order_id;
  select * into t from public.tailor_tasks where order_id = new.order_id;
  select display_name into who from public.employees where id = new.author;
  if t.id is not null and new.author = t.tailor_id then
    for r in select id from public.employees where active and role in ('admin','butik') loop
      insert into public.notifications(user_id, kind, title, body, order_id)
      values (r.id, case when new.is_question then 'spoergsmaal' else 'kommentar' end,
              (case when new.is_question then 'Spørgsmål fra ' else 'Kommentar fra ' end) || who || ' · ordre ' || o.order_no,
              left(new.body, 200), o.id);
    end loop;
  elsif t.id is not null and new.author <> t.tailor_id and new.body not like 'Kontrol: %' then
    insert into public.notifications(user_id, kind, title, body, order_id)
    values (t.tailor_id, 'kommentar', 'Besked fra ' || who || ' · ordre ' || o.order_no, left(new.body, 200), o.id);
  end if;
  return null;
end $$;
create trigger comments_notify after insert on public.comments for each row execute function public.comments_notify_trg();

-- ---------- PIN til hurtigt brugerskift ----------
create or replace function public.set_my_pin(p_pin text) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  if p_pin !~ '^\d{4,6}$' then raise exception 'PIN skal være 4–6 cifre'; end if;
  update public.employees set pin_hash = crypt(p_pin, gen_salt('bf', 8)), pin_failed = 0, pin_locked_until = null
   where id = auth.uid() and active;
end $$;

create or replace function public.verify_my_pin(p_pin text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare e public.employees;
begin
  select * into e from public.employees where id = auth.uid() for update;
  if e.id is null or not e.active then return jsonb_build_object('ok', false, 'reason', 'inaktiv'); end if;
  if e.pin_hash is null then return jsonb_build_object('ok', false, 'reason', 'ingen_pin'); end if;
  if e.pin_locked_until is not null and e.pin_locked_until > now() then
    return jsonb_build_object('ok', false, 'reason', 'laast', 'until', e.pin_locked_until);
  end if;
  if crypt(p_pin, e.pin_hash) = e.pin_hash then
    update public.employees set pin_failed = 0, pin_locked_until = null where id = e.id;
    return jsonb_build_object('ok', true);
  end if;
  if e.pin_failed + 1 >= 5 then
    update public.employees set pin_failed = 0, pin_locked_until = now() + interval '15 minutes' where id = e.id;
    return jsonb_build_object('ok', false, 'reason', 'laast', 'until', now() + interval '15 minutes');
  end if;
  update public.employees set pin_failed = pin_failed + 1 where id = e.id;
  return jsonb_build_object('ok', false, 'reason', 'forkert', 'left', 5 - (e.pin_failed + 1));
end $$;

create or replace function public.order_totals_checked(p_order_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_staff() then raise exception 'Ingen adgang' using errcode = '42501'; end if;
  return public.order_totals(p_order_id);
end $$;
create or replace function public.validate_order_checked(p_order_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_staff() then raise exception 'Ingen adgang' using errcode = '42501'; end if;
  return public.validate_order(p_order_id);
end $$;
create or replace function public.can_access_order_path(p_name text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare oid uuid;
begin
  begin oid := split_part(p_name, '/', 1)::uuid; exception when others then return false; end;
  return public.is_staff() or public.is_my_task_order(oid);
end $$;

