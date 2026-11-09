-- Skumbutikken · fase 2 · materialer, bestillingslister, leverandører, modtagelse, placering
create extension if not exists pg_cron;

-- ---------- Indstillinger ----------
create table public.app_settings (
  key text primary key,
  value jsonb not null,
  updated_by uuid references public.employees(id),
  updated_at timestamptz not null default now()
);
insert into public.app_settings(key, value) values
  ('batch_schedule', '{"skum": {"time": "18:30", "days": [1,2,3,4,5]}, "stof": {"time": "18:30", "days": [1,2,3,4,5]}}'),
  ('default_suppliers', '{}');

-- ---------- Leverandører ----------
create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text not null default 'skum' check (category in ('skum','stof','tilbehoer','andet')),
  email text, phone text, contact text, customer_no text, notes text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------- Materialelinjer (indkøbsbehov) ----------
create table public.material_lines (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  part_id uuid references public.order_parts(id) on delete set null,
  category text not null check (category in ('skum','stof','lynlaas','tilbehoer')),
  description text not null,
  spec jsonb not null default '{}'::jsonb,
  quantity numeric(10,2) not null default 1,
  unit text not null default 'stk',
  source text not null check (source in ('bestilles','lager','kunde')),
  status text not null default 'afventer' check (status in
    ('afventer','paa_liste','bestilt','bekraeftet','delvis','modtaget','lager','kunde','annulleret','rettet')),
  received_qty numeric(10,2) not null default 0,
  supplier_id uuid references public.suppliers(id),
  batch_id uuid,
  released_version int not null,
  released_at timestamptz not null default now(),
  needed_by date,
  is_correction boolean not null default false,
  corrects_id uuid references public.material_lines(id),
  follow_up_done boolean not null default true,
  note text,
  row_version int not null default 1,
  updated_by uuid references public.employees(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index material_lines_open_idx on public.material_lines(status, category) where batch_id is null;
create index material_lines_order_idx on public.material_lines(order_id);
create index material_lines_batch_idx on public.material_lines(batch_id);
-- ét aktivt behov pr. ordredel og kategori
create unique index material_lines_active_uq on public.material_lines(part_id, category)
  where status not in ('annulleret','rettet');
create trigger material_lines_touch before update on public.material_lines for each row execute function public.touch_row();

-- ---------- Bestillingsbatches ----------
create table public.order_batches (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('skum','stof')),
  run_date date not null,
  version int not null default 1,
  cutoff timestamptz not null,
  manual boolean not null default false,
  status text not null default 'dannet' check (status in ('dannet','godkendt','sendt','bekraeftet','modtaget')),
  created_by uuid references public.employees(id),
  approved_by uuid references public.employees(id), approved_at timestamptz,
  sent_by uuid references public.employees(id), sent_at timestamptz,
  confirmed_at timestamptz, received_at timestamptz,
  note text,
  created_at timestamptz not null default now(),
  unique (kind, run_date, version)
);
alter table public.material_lines add constraint material_lines_batch_fk foreign key (batch_id) references public.order_batches(id);

-- Planlagte kørsler: én pr. type og dag (beskytter mod dobbeltkørsel)
create table public.batch_runs (
  kind text not null check (kind in ('skum','stof')),
  run_date date not null,
  cutoff timestamptz not null,
  batch_id uuid references public.order_batches(id),
  lines int not null default 0,
  ran_at timestamptz not null default now(),
  catch_up boolean not null default false,
  primary key (kind, run_date)
);

create table public.material_receipts (
  id uuid primary key default gen_random_uuid(),
  line_id uuid not null references public.material_lines(id) on delete cascade,
  quantity numeric(10,2) not null check (quantity > 0),
  received_by uuid not null default auth.uid() references public.employees(id),
  received_at timestamptz not null default now(),
  note text
);

-- ---------- Placering og indleverede ting ----------
alter table public.orders add column location text;
grant update (location) on public.orders to authenticated;

create table public.intake_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  description text not null,
  quantity int not null default 1 check (quantity > 0),
  location text,
  photo_path text,
  received_by uuid default auth.uid() references public.employees(id),
  received_at timestamptz not null default now(),
  returned_at timestamptz,
  returned_by uuid references public.employees(id)
);
create index intake_items_order_idx on public.intake_items(order_id);

-- =====================================================================
-- Afledning af materialebehov fra en bekræftet ordreversion
-- =====================================================================
create or replace function public.fmt_cm(n numeric) returns text
language sql immutable as $$ select replace(trim(to_char(n, 'FM99990.0')), '.', ',') $$;

create or replace function public.notify_staff(p_kind text, p_title text, p_body text, p_order uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  for r in select id from public.employees where active and role in ('admin','butik') loop
    insert into public.notifications(user_id, kind, title, body, order_id) values (r.id, p_kind, p_title, p_body, p_order);
  end loop;
end $$;

create or replace function public.retire_line(l public.material_lines, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare o public.orders;
begin
  if l.batch_id is null or l.status in ('lager','kunde') then
    update public.material_lines set status = 'annulleret', note = coalesce(note || ' · ', '') || p_reason where id = l.id;
  elsif l.status <> 'modtaget' then
    -- allerede på en liste/sendt: synlig rettelse med opfølgning
    update public.material_lines set status = 'rettet', follow_up_done = false,
           note = coalesce(note || ' · ', '') || p_reason where id = l.id;
    select * into o from public.orders where id = l.order_id;
    perform public.notify_staff('rettelse', 'Rettelse til afsendt bestilling · ordre ' || o.order_no, l.description || ' – ' || p_reason, l.order_id);
  end if;
end $$;

create or replace function public.sync_material_lines(p_order_id uuid, p_version int) returns void
language plpgsql security definer set search_path = public as $$
declare
  o public.orders; p record; d record; ex public.material_lines; dims text; src text; st text;
  wanted jsonb;
begin
  select * into o from public.orders where id = p_order_id;
  for p in select * from public.order_parts where order_id = p_order_id order by sort loop
    dims := case when p.length_cm is not null then public.fmt_cm(p.length_cm) || ' × ' || coalesce(public.fmt_cm(p.width_cm), '?') || ' × ' || coalesce(public.fmt_cm(p.thickness_cm), '?') || ' cm' else '' end;
    src := p.material_source;
    st := case src when 'lager' then 'lager' when 'kunde' then 'kunde' else 'afventer' end;
    wanted := '[]'::jsonb;
    if p.part_type in ('skum','hynde_betraek') then
      wanted := wanted || jsonb_build_object('category','skum','qty',p.quantity,'unit','stk',
        'description', trim(coalesce(p.foam_type,'') || ' ' || coalesce(p.firmness,'')) || ' · ' || dims || ' · ' || p.shape
          || case when p.measure_basis = 'faerdigmaal' then ' (færdigmål)' else '' end,
        'spec', jsonb_build_object('foam_type',p.foam_type,'firmness',p.firmness,'length_cm',p.length_cm,'width_cm',p.width_cm,
          'thickness_cm',p.thickness_cm,'shape',p.shape,'measure_basis',p.measure_basis,'label',p.label));
    end if;
    if p.part_type in ('hynde_betraek','betraek') and coalesce(trim(p.fabric),'') <> '' then
      wanted := wanted || jsonb_build_object('category','stof','qty',null,'unit','m',
        'description', p.fabric || coalesce(' · ' || p.fabric_color, '') || ' – til ' || p.quantity || ' × ' || dims,
        'spec', jsonb_build_object('fabric',p.fabric,'color',p.fabric_color,'covers',p.quantity,'length_cm',p.length_cm,
          'width_cm',p.width_cm,'thickness_cm',p.thickness_cm,'seam_allowance_cm',p.seam_allowance_cm,'label',p.label));
    end if;
    if p.zipper and p.part_type in ('hynde_betraek','betraek') then
      wanted := wanted || jsonb_build_object('category','lynlaas','qty',p.quantity,'unit','stk',
        'description', 'Lynlås til ' || coalesce(nullif(p.label,''),'del') || coalesce(' (' || public.fmt_cm(greatest(p.length_cm, p.width_cm)) || ' cm side)', ''),
        'spec', jsonb_build_object('length_cm',greatest(p.length_cm,p.width_cm),'label',p.label));
    end if;
    if coalesce(trim(p.accessories),'') <> '' then
      wanted := wanted || jsonb_build_object('category','tilbehoer','qty',p.quantity,'unit','stk',
        'description', p.accessories || ' – ' || coalesce(nullif(p.label,''),'del'), 'spec', jsonb_build_object('label',p.label));
    end if;

    for d in select * from jsonb_to_recordset(wanted) as x(category text, qty numeric, unit text, description text, spec jsonb) loop
      select * into ex from public.material_lines where part_id = p.id and category = d.category and status not in ('annulleret','rettet');
      if ex.id is null then
        insert into public.material_lines(order_id, part_id, category, description, spec, quantity, unit, source, status,
                                          released_version, needed_by, supplier_id)
        values (p_order_id, p.id, d.category, d.description, d.spec, coalesce(d.qty, 0), d.unit, src, st, p_version, o.deadline,
                (select nullif(value ->> (case d.category when 'skum' then 'skum' when 'stof' then 'stof' else 'tilbehoer' end), '')::uuid
                   from public.app_settings where key = 'default_suppliers'));
      elsif ex.description = d.description and ex.spec = d.spec and ex.source = src
            and (d.qty is null or ex.quantity = d.qty) then
        update public.material_lines set released_version = p_version, needed_by = o.deadline where id = ex.id;
      elsif ex.batch_id is null then
        update public.material_lines set description = d.description, spec = d.spec,
               quantity = case when d.qty is null then quantity else d.qty end, source = src,
               status = case when status in ('afventer','lager','kunde') then st else status end,
               released_version = p_version, released_at = now(), needed_by = o.deadline where id = ex.id;
      else
        perform public.retire_line(ex, 'ændret i version ' || p_version);
        insert into public.material_lines(order_id, part_id, category, description, spec, quantity, unit, source, status,
                                          released_version, needed_by, is_correction, corrects_id, supplier_id)
        values (p_order_id, p.id, d.category, d.description, d.spec, coalesce(d.qty, ex.quantity), d.unit, src, st, p_version,
                o.deadline, true, ex.id, ex.supplier_id);
      end if;
    end loop;

    -- kategorier der ikke længere ønskes for denne del
    for ex in select * from public.material_lines ml where ml.part_id = p.id and ml.status not in ('annulleret','rettet')
              and not exists (select 1 from jsonb_array_elements(wanted) w where w->>'category' = ml.category) loop
      perform public.retire_line(ex, 'fjernet i version ' || p_version);
    end loop;
  end loop;

  -- slettede ordredele
  for ex in select * from public.material_lines ml where ml.order_id = p_order_id and ml.status not in ('annulleret','rettet')
            and (ml.part_id is null or not exists (select 1 from public.order_parts op where op.id = ml.part_id)) loop
    perform public.retire_line(ex, 'del slettet i version ' || p_version);
  end loop;
end $$;

create or replace function public.confirmations_sync_trg() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.sync_material_lines(new.order_id, new.version);
  return null;
end $$;
create trigger confirmations_sync after insert on public.order_confirmations
  for each row execute function public.confirmations_sync_trg();

-- Annullering af ordre fjerner indkøbsbehov
create or replace function public.orders_cancel_lines_trg() returns trigger
language plpgsql security definer set search_path = public as $$
declare ex public.material_lines;
begin
  if new.status = 'annulleret' and old.status <> 'annulleret' then
    for ex in select * from public.material_lines where order_id = new.id and status not in ('annulleret','rettet','modtaget') loop
      perform public.retire_line(ex, 'ordren annulleret');
    end loop;
  end if;
  return null;
end $$;
create trigger orders_cancel_lines after update of status on public.orders
  for each row execute function public.orders_cancel_lines_trg();

-- =====================================================================
-- Dannelse af bestillingslister
-- =====================================================================
create or replace function public.generate_batch(p_kind text, p_run_date date, p_cutoff timestamptz, p_manual boolean, p_catch_up boolean default false)
returns uuid language plpgsql security definer set search_path = public as $$
declare b uuid; v int; n int; cats text[];
begin
  perform pg_advisory_xact_lock(hashtext('sb-batch:' || p_kind));
  if not p_manual and exists (select 1 from public.batch_runs where kind = p_kind and run_date = p_run_date) then
    return null; -- allerede kørt (genkørsel eller parallelt job)
  end if;
  cats := case p_kind when 'skum' then array['skum'] else array['stof','lynlaas','tilbehoer'] end;
  select count(*) into n from public.material_lines
   where batch_id is null and status = 'afventer' and category = any(cats) and released_at <= p_cutoff;
  if n > 0 then
    select coalesce(max(version), 0) + 1 into v from public.order_batches where kind = p_kind and run_date = p_run_date;
    insert into public.order_batches(kind, run_date, version, cutoff, manual, created_by)
    values (p_kind, p_run_date, v, p_cutoff, p_manual, auth.uid()) returning id into b;
    update public.material_lines set batch_id = b, status = 'paa_liste'
     where batch_id is null and status = 'afventer' and category = any(cats) and released_at <= p_cutoff;
  end if;
  if not p_manual then
    insert into public.batch_runs(kind, run_date, cutoff, batch_id, lines, catch_up) values (p_kind, p_run_date, p_cutoff, b, n, p_catch_up);
  end if;
  if b is not null then
    perform public.notify_staff('bestilling', case p_kind when 'skum' then 'Skumbestillingsliste klar' else 'Stof- og tilbehørsliste klar' end
      || ' (' || n || ' linjer)', 'Godkend og send listen under Bestillinger', null);
  end if;
  return b;
end $$;

-- Køres af pg_cron hvert 5. minut. Dansk lokal tid inkl. sommer/vintertid. Indhenter op til 14 dages manglende kørsler.
create or replace function public.run_scheduled_batches() returns int
language plpgsql security definer set search_path = public as $$
declare cfg jsonb; k text; t time; days int[]; d date; last date; today date; cut timestamptz; made int := 0;
begin
  select value into cfg from public.app_settings where key = 'batch_schedule';
  today := (now() at time zone 'Europe/Copenhagen')::date;
  foreach k in array array['skum','stof'] loop
    t := coalesce((cfg -> k ->> 'time')::time, '18:30');
    select coalesce(array_agg(x::int), array[1,2,3,4,5]) into days from jsonb_array_elements_text(cfg -> k -> 'days') x;
    select max(run_date) into last from public.batch_runs where kind = k;
    d := greatest(coalesce(last + 1, today), today - 14);
    while d <= today loop
      if extract(isodow from d)::int = any(days) then
        cut := (d + t) at time zone 'Europe/Copenhagen';
        if now() >= cut then
          if public.generate_batch(k, d, cut, false, d < today) is not null then made := made + 1; end if;
        end if;
      end if;
      d := d + 1;
    end loop;
  end loop;
  return made;
end $$;

-- Manuel ekstra kørsel fra appen
create or replace function public.run_batch_now(p_kind text) returns uuid
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_staff() then raise exception 'Ingen adgang' using errcode = '42501'; end if;
  return public.generate_batch(p_kind, (now() at time zone 'Europe/Copenhagen')::date, now(), true);
end $$;

create or replace function public.set_batch_status(p_batch uuid, p_status text) returns void
language plpgsql security definer set search_path = public as $$
declare b public.order_batches; ord text[] := array['dannet','godkendt','sendt','bekraeftet','modtaget'];
begin
  if not public.is_staff() then raise exception 'Ingen adgang' using errcode = '42501'; end if;
  select * into b from public.order_batches where id = p_batch for update;
  if b.id is null then raise exception 'Listen findes ikke'; end if;
  if array_position(ord, p_status) is null or array_position(ord, p_status) <= array_position(ord, b.status) then
    raise exception 'Ugyldigt statusskift fra % til %', b.status, p_status;
  end if;
  if p_status = 'sendt' and exists (select 1 from public.material_lines where batch_id = p_batch and category = 'stof' and quantity <= 0 and status = 'paa_liste') then
    raise exception 'Angiv mængde (meter) for alle stoflinjer før afsendelse';
  end if;
  update public.order_batches set status = p_status,
    approved_by = case when p_status = 'godkendt' then auth.uid() else approved_by end,
    approved_at = case when p_status = 'godkendt' then now() else approved_at end,
    sent_by = case when p_status = 'sendt' then auth.uid() else sent_by end,
    sent_at = case when p_status = 'sendt' then now() else sent_at end,
    confirmed_at = case when p_status = 'bekraeftet' then now() else confirmed_at end
  where id = p_batch;
  if p_status = 'sendt' then
    update public.material_lines set status = 'bestilt' where batch_id = p_batch and status = 'paa_liste';
  elsif p_status = 'bekraeftet' then
    update public.material_lines set status = 'bekraeftet' where batch_id = p_batch and status in ('paa_liste','bestilt');
  end if;
end $$;

-- Modtagelse pr. linje og delmængde
create or replace function public.receive_line(p_line uuid, p_qty numeric, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare l public.material_lines; o public.orders; t public.tailor_tasks; open_count int;
begin
  if not public.is_staff() then raise exception 'Ingen adgang' using errcode = '42501'; end if;
  if p_qty is null or p_qty <= 0 then raise exception 'Angiv modtaget mængde'; end if;
  select * into l from public.material_lines where id = p_line for update;
  if l.status not in ('paa_liste','bestilt','bekraeftet','delvis','afventer','rettet') then raise exception 'Linjen kan ikke modtages (%)', l.status; end if;
  insert into public.material_receipts(line_id, quantity, note) values (p_line, p_qty, p_note);
  update public.material_lines set received_qty = received_qty + p_qty,
    status = case when l.status = 'rettet' then 'rettet'
                  when received_qty + p_qty >= greatest(quantity, 0.01) then 'modtaget' else 'delvis' end
   where id = p_line returning * into l;
  -- hele batchen modtaget?
  if l.batch_id is not null and not exists (select 1 from public.material_lines where batch_id = l.batch_id and status in ('paa_liste','bestilt','bekraeftet','delvis')) then
    update public.order_batches set status = 'modtaget', received_at = now() where id = l.batch_id;
  end if;
  -- alle materialer til ordren klar?
  select count(*) into open_count from public.material_lines where order_id = l.order_id and status in ('afventer','paa_liste','bestilt','bekraeftet','delvis');
  select * into o from public.orders where id = l.order_id;
  select * into t from public.tailor_tasks where order_id = l.order_id;
  if t.id is not null then
    insert into public.notifications(user_id, kind, title, body, order_id)
    values (t.tailor_id, 'materiale', case when open_count = 0 then 'Alle materialer modtaget · ordre ' || o.order_no else 'Materiale modtaget · ordre ' || o.order_no end, l.description, o.id);
  end if;
  return jsonb_build_object('status', l.status, 'received_qty', l.received_qty, 'open_for_order', open_count);
end $$;

create or replace function public.mark_followed_up(p_line uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_staff() then raise exception 'Ingen adgang' using errcode = '42501'; end if;
  update public.material_lines set follow_up_done = true where id = p_line;
end $$;

-- Skrædderen ser materialestatus på sine opgaver
create or replace function public.task_materials(p_order_id uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('part_id', part_id, 'category', category, 'status', status, 'description', description) order by category), '[]'::jsonb)
  from public.material_lines where order_id = p_order_id and status not in ('annulleret','rettet')
$$;

create or replace function public.task_payload(t public.tailor_tasks) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', t.id, 'status', t.status, 'progress', t.progress, 'pause_reason', t.pause_reason,
    'released_version', t.released_version, 'tailor_id', t.tailor_id, 'updated_at', t.updated_at,
    'order', jsonb_build_object('id', o.id, 'order_no', o.order_no, 'title', o.title, 'deadline', o.deadline,
       'priority', o.priority, 'status', o.status, 'needs_reconfirm', o.needs_reconfirm, 'location', o.location,
       'customer_first_name', split_part(coalesce(c.name,''), ' ', 1)),
    'parts', coalesce((select jsonb_agg(jsonb_build_object(
        'id', p.id, 'label', p.label, 'part_type', p.part_type, 'quantity', p.quantity, 'shape', p.shape,
        'length_cm', p.length_cm, 'width_cm', p.width_cm, 'thickness_cm', p.thickness_cm,
        'measure_basis', p.measure_basis, 'seam_allowance_cm', p.seam_allowance_cm,
        'foam_type', p.foam_type, 'firmness', p.firmness, 'fabric', p.fabric, 'fabric_color', p.fabric_color,
        'zipper', p.zipper, 'sewing', p.sewing, 'accessories', p.accessories,
        'instructions', p.instructions, 'material_source', p.material_source,
        'progress', p.progress, 'stage', p.stage) order by p.sort)
      from public.order_parts p where p.order_id = o.id), '[]'::jsonb),
    'materials', public.task_materials(o.id),
    'open_questions', (select count(*) from public.comments cm where cm.order_id = o.id and cm.is_question and not cm.resolved))
  from public.orders o left join public.customers c on c.id = o.customer_id where o.id = t.order_id
$$;

-- =====================================================================
-- Rettigheder
-- =====================================================================
alter table public.app_settings enable row level security;
alter table public.suppliers enable row level security;
alter table public.material_lines enable row level security;
alter table public.order_batches enable row level security;
alter table public.batch_runs enable row level security;
alter table public.material_receipts enable row level security;
alter table public.intake_items enable row level security;
revoke all on public.app_settings, public.suppliers, public.material_lines, public.order_batches, public.batch_runs,
  public.material_receipts, public.intake_items from anon;

create policy set_select on public.app_settings for select to authenticated using (public.is_staff());
create policy set_update on public.app_settings for update to authenticated using (public.is_admin()) with check (public.is_admin());
revoke insert, delete on public.app_settings from authenticated;

create policy sup_select on public.suppliers for select to authenticated using (public.is_staff());
create policy sup_write on public.suppliers for insert to authenticated with check (public.is_staff());
create policy sup_update on public.suppliers for update to authenticated using (public.is_staff()) with check (public.is_staff());
revoke delete on public.suppliers from authenticated;

create policy ml_select on public.material_lines for select to authenticated using (public.is_staff());
create policy ml_update on public.material_lines for update to authenticated using (public.is_staff()) with check (public.is_staff());
revoke insert, delete, update on public.material_lines from authenticated;
grant update (supplier_id, quantity, unit, note) on public.material_lines to authenticated;

create policy ob_select on public.order_batches for select to authenticated using (public.is_staff());
create policy ob_update on public.order_batches for update to authenticated using (public.is_staff()) with check (public.is_staff());
revoke insert, delete, update on public.order_batches from authenticated;
grant update (note) on public.order_batches to authenticated;

create policy br_select on public.batch_runs for select to authenticated using (public.is_staff());
revoke insert, update, delete on public.batch_runs from authenticated;
create policy mr_select on public.material_receipts for select to authenticated using (public.is_staff());
revoke insert, update, delete on public.material_receipts from authenticated;

create policy ii_select on public.intake_items for select to authenticated using (public.is_staff() or public.is_my_task_order(order_id));
create policy ii_insert on public.intake_items for insert to authenticated with check (public.is_staff());
create policy ii_update on public.intake_items for update to authenticated using (public.is_staff()) with check (public.is_staff());
create policy ii_delete on public.intake_items for delete to authenticated using (public.is_staff());

revoke execute on all functions in schema public from anon, public;
revoke execute on function public.sync_material_lines(uuid,int), public.generate_batch(text,date,timestamptz,boolean,boolean),
  public.run_scheduled_batches(), public.retire_line(public.material_lines,text), public.notify_staff(text,text,text,uuid),
  public.task_materials(uuid) from authenticated;
grant execute on function public.run_batch_now(text), public.set_batch_status(uuid,text), public.receive_line(uuid,numeric,text),
  public.mark_followed_up(uuid), public.fmt_cm(numeric) to authenticated;

alter publication supabase_realtime add table public.material_lines, public.order_batches, public.intake_items, public.suppliers;
alter table public.material_lines replica identity full;

-- Planlagt job: hvert 5. minut (DST håndteres i funktionen via Europe/Copenhagen)
select cron.schedule('skumbutikken-bestillingslister', '*/5 * * * *', $$select public.run_scheduled_batches()$$);

-- (anvendt som separat migration "fmt_cm_trim")
create or replace function public.fmt_cm(n numeric) returns text
language sql immutable as $$ select case when n is null then null when n = trunc(n) then trunc(n)::text else replace(trim(to_char(n, 'FM99990.0')), '.', ',') end $$;
