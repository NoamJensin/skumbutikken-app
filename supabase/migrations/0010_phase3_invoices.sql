-- Skumbutikken · fase 3 · fakturaer, bankprofiler, betalinger, kundebeskeder
create extension if not exists pg_net;

-- ---------- Indstillinger ----------
insert into public.app_settings(key, value) values
  ('company', '{"name":"Skumbutikken ApS","cvr":"30817907","address":"Lyngby Port, Lyngby Hovedgade 112","zip_city":"2800 Kgs. Lyngby","phone":"+45 45 88 55 47","email":"info@skumbutikken.dk","web":"www.skumbutikken.dk","payment_days":8,"confirmed":false}'),
  ('messaging', '{"auto_on_ready":true,"reminder_days":7,"reminder_max":2,"from_name":"Skumbutikken","from_email":"faktura@skumbutikken.dk","reply_to":"info@skumbutikken.dk","sms_sender":"Skumbutik"}'),
  ('templates', jsonb_build_object(
    'sms_ready', 'Hej {fornavn}. Din ordre {ordrenr} hos Skumbutikken er klar til afhentning. {rest_tekst}Åbent man-tir og fre 10-17.30, tor 10-16, lør 10-13 (onsdag lukket). Venlig hilsen Skumbutikken, Lyngby Hovedgade 112',
    'email_ready_subject', 'Din ordre {ordrenr} er klar til afhentning',
    'email_ready_body', E'Hej {fornavn}\n\nDin ordre {ordrenr} ({titel}) er klar til afhentning hos Skumbutikken, Lyngby Hovedgade 112, 2800 Kgs. Lyngby.\n\n{rest_tekst}\nÅbningstider: mandag-tirsdag og fredag 10.00-17.30, torsdag 10.00-16.00, lørdag 10.00-13.00. Onsdag lukket.\n\nVenlig hilsen\nSkumbutikken\nTlf. 45 88 55 47',
    'email_invoice_subject', 'Faktura {fakturanr} fra Skumbutikken',
    'email_invoice_body', E'Hej {fornavn}\n\nTak for din ordre. Vedhæftet finder du faktura {fakturanr} for ordre {ordrenr} på {total}.\n\n{rest_tekst}\nVenlig hilsen\nSkumbutikken\nTlf. 45 88 55 47 · info@skumbutikken.dk',
    'sms_reminder', 'Hej {fornavn}. Påmindelse: Din ordre {ordrenr} venter på dig hos Skumbutikken, Lyngby Hovedgade 112. Venlig hilsen Skumbutikken',
    'email_reminder_subject', 'Påmindelse: Din ordre {ordrenr} venter på dig',
    'email_reminder_body', E'Hej {fornavn}\n\nDin ordre {ordrenr} er stadig klar til afhentning hos Skumbutikken, Lyngby Hovedgade 112.\n\nVenlig hilsen\nSkumbutikken')),
  ('integration_status', '{"email_configured":false,"sms_configured":false,"last_run":null}')
on conflict (key) do nothing;

-- ---------- Bankprofiler ----------
create table public.bank_profiles (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  bank_name text not null,
  reg_no text not null check (reg_no ~ '^\d{4}$'),
  account_no text not null check (account_no ~ '^\d{4,10}$'),
  iban text, swift text,
  is_default boolean not null default false,
  archived boolean not null default false,
  created_by uuid default auth.uid() references public.employees(id),
  updated_by uuid references public.employees(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index bank_profiles_one_default on public.bank_profiles(is_default) where is_default and not archived;
insert into public.bank_profiles(name, bank_name, reg_no, account_no, created_by)
values ('Driftskonto (fra fakturaeksempel)', 'Arbejdernes Landsbank', '5366', '0240487', null);

create or replace function public.bank_touch() returns trigger language plpgsql set search_path = public as $$
begin new.updated_at := now(); new.updated_by := coalesce(auth.uid(), new.updated_by);
  if new.archived then new.is_default := false; end if; return new; end $$;
create trigger bank_profiles_touch before update on public.bank_profiles for each row execute function public.bank_touch();
create trigger a_bank after insert or update or delete on public.bank_profiles for each row execute function public.audit_trg();

-- Skift standard som én samlet ændring
create or replace function public.set_default_bank(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Kun administrator' using errcode = '42501'; end if;
  if not exists (select 1 from public.bank_profiles where id = p_id and not archived) then raise exception 'Profilen findes ikke eller er arkiveret'; end if;
  update public.bank_profiles set is_default = false where is_default and id <> p_id;
  update public.bank_profiles set is_default = true where id = p_id;
end $$;

alter table public.orders add column bank_profile_id uuid references public.bank_profiles(id);
alter table public.orders add column ready_at timestamptz;
grant insert (bank_profile_id), update (bank_profile_id) on public.orders to authenticated;

-- ---------- Fakturaer ----------
create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  invoice_no text not null unique,
  kind text not null default 'faktura' check (kind in ('faktura','kreditnota')),
  order_id uuid not null references public.orders(id),
  customer_id uuid references public.customers(id),
  credits_invoice_id uuid references public.invoices(id),
  idempotency_key text not null unique,
  issued_at timestamptz not null default now(),
  delivery_date date,
  due_date date,
  bank_profile_id uuid references public.bank_profiles(id),
  base_ore bigint not null, vat_ore bigint not null, total_ore bigint not null,
  paid_ore bigint not null default 0,
  snapshot jsonb not null,
  pdf_path text,
  pdf_status text not null default 'afventer' check (pdf_status in ('afventer','klar','fejl')),
  pdf_error text,
  reason text,
  created_by uuid references public.employees(id),
  created_at timestamptz not null default now()
);
create index invoices_order_idx on public.invoices(order_id);
create index invoices_customer_idx on public.invoices(customer_id);
create unique index invoices_one_credit on public.invoices(credits_invoice_id) where kind = 'kreditnota';

create table public.invoice_lines (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  sort int not null,
  description text not null,
  quantity numeric(10,2) not null,
  unit text not null default 'stk',
  unit_price_ore bigint not null,
  line_ore bigint not null
);

-- Udstedte fakturaer kan ikke ændres (kun PDF-status sættes af worker)
create or replace function public.invoices_lock_trg() returns trigger language plpgsql as $$
begin
  if (new.invoice_no, new.kind, new.order_id, new.snapshot, new.total_ore, new.base_ore, new.vat_ore, new.bank_profile_id, new.issued_at)
     is distinct from (old.invoice_no, old.kind, old.order_id, old.snapshot, old.total_ore, old.base_ore, old.vat_ore, old.bank_profile_id, old.issued_at) then
    raise exception 'En udstedt faktura kan ikke ændres. Brug en kreditnota.';
  end if;
  if old.pdf_status = 'klar' and new.pdf_path is distinct from old.pdf_path then
    raise exception 'Den udstedte PDF kan ikke udskiftes';
  end if;
  return new;
end $$;
create trigger invoices_lock before update on public.invoices for each row execute function public.invoices_lock_trg();
create or replace function public.invoices_nodelete_trg() returns trigger language plpgsql as $$
begin raise exception 'Fakturaer kan ikke slettes (bogføringsloven: 5 års opbevaring)'; end $$;
create trigger invoices_nodelete before delete on public.invoices for each row execute function public.invoices_nodelete_trg();

-- ---------- Betalinger ----------
create table public.payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id),
  invoice_id uuid references public.invoices(id),
  amount_ore bigint not null check (amount_ore <> 0),
  method text not null default 'kort' check (method in ('kort','mobilepay','kontant','bankoverfoersel','andet')),
  paid_at timestamptz not null default now(),
  note text,
  idempotency_key text not null unique,
  created_by uuid default auth.uid() references public.employees(id),
  created_at timestamptz not null default now()
);
create index payments_order_idx on public.payments(order_id);

-- ---------- Beskeder ----------
create table public.message_jobs (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references public.orders(id),
  invoice_id uuid references public.invoices(id),
  customer_id uuid references public.customers(id),
  channel text not null check (channel in ('email','sms')),
  kind text not null check (kind in ('afhentning','faktura','paamindelse','genafsendelse')),
  recipient text not null,
  subject text,
  body text not null,
  attach_invoice boolean not null default false,
  status text not null default 'klargjort' check (status in ('klargjort','i_koe','afsendt','leveret','afvist','fejlet','uafklaret','annulleret')),
  attempts int not null default 0,
  next_attempt_at timestamptz not null default now(),
  locked_at timestamptz,
  provider text, provider_id text, last_error text,
  idempotency_key text not null unique,
  resend_of uuid references public.message_jobs(id),
  created_by uuid references public.employees(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index message_jobs_due_idx on public.message_jobs(next_attempt_at) where status in ('klargjort','fejlet');
create index message_jobs_order_idx on public.message_jobs(order_id);

create table public.message_events (
  id bigserial primary key,
  job_id uuid not null references public.message_jobs(id) on delete cascade,
  status text not null,
  detail text,
  at timestamptz not null default now()
);
create or replace function public.message_jobs_touch_trg() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
create trigger message_jobs_touch before update on public.message_jobs for each row execute function public.message_jobs_touch_trg();
create or replace function public.message_jobs_log_trg() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    insert into public.message_events(job_id, status, detail) values (new.id, new.status, new.last_error);
  end if;
  return null;
end $$;
create trigger message_jobs_log after insert or update on public.message_jobs for each row execute function public.message_jobs_log_trg();

-- =====================================================================
-- Hjælpefunktioner
-- =====================================================================
create or replace function public.kr_txt(ore bigint) returns text language sql immutable set search_path = public as $$
  select replace(replace(replace(to_char(ore / 100.0, 'FM999G999G990D00'), ',', '#'), '.', ','), '#', '.') || ' kr.'
$$;

create or replace function public.render_template(p_tpl text, p_vars jsonb) returns text
language plpgsql immutable set search_path = public as $$
declare k text; v text; out text := p_tpl;
begin
  for k, v in select key, value from jsonb_each_text(p_vars) loop
    out := replace(out, '{' || k || '}', coalesce(v, ''));
  end loop;
  return out;
end $$;

create or replace function public.order_paid(p_order uuid) returns bigint language sql stable set search_path = public as $$
  select coalesce(sum(amount_ore), 0) from public.payments where order_id = p_order
$$;

create or replace function public.part_line_text(p public.order_parts) returns text language sql stable set search_path = public as $$
  select coalesce(nullif(p.label,''), 'Del')
    || case p.part_type when 'skum' then ' – skum efter mål' when 'hynde_betraek' then ' – hynde med betræk'
                        when 'betraek' then ' – betræk' else '' end
    || case when p.length_cm is not null then ' ' || public.fmt_cm(p.length_cm) || '×' || coalesce(public.fmt_cm(p.width_cm),'?') || '×' || coalesce(public.fmt_cm(p.thickness_cm),'?') || ' cm' else '' end
    || coalesce(', ' || nullif(trim(coalesce(p.foam_type,'') || ' ' || coalesce(p.firmness,'')), ''), '')
    || coalesce(', ' || p.fabric || coalesce(' ' || p.fabric_color, ''), '')
    || case when p.zipper then ', lynlås' else '' end
    || case when p.part_type = 'andet' and p.instructions is not null then ': ' || left(p.instructions, 120) else '' end
$$;

-- =====================================================================
-- Udstedelse af faktura (intern – bruges af manuel udstedelse og klarmelding)
-- =====================================================================
create or replace function public.issue_invoice_internal(p_order_id uuid, p_key text, p_bank uuid, p_actor uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  inv public.invoices; o public.orders; c public.customers; b public.bank_profiles; comp jsonb; t jsonb;
  no text; lines jsonb := '[]'::jsonb; p public.order_parts; i int := 0; paid bigint; v_id uuid; due date;
begin
  select * into inv from public.invoices where idempotency_key = p_key;
  if inv.id is not null then return inv.id; end if;
  select * into o from public.orders where id = p_order_id for update;
  if o.id is null then raise exception 'Ordren findes ikke'; end if;
  if o.confirmed_version is null then raise exception 'Ordren er ikke bekræftet af kunden'; end if;
  if exists (select 1 from public.invoices f where f.order_id = o.id and f.kind = 'faktura'
             and not exists (select 1 from public.invoices k where k.credits_invoice_id = f.id)) then
    raise exception 'ALLEREDE_FAKTURERET' using hint = 'Ordren har allerede en aktiv faktura. Lav en kreditnota først.';
  end if;
  select value into comp from public.app_settings where key = 'company';
  if not coalesce((comp->>'confirmed')::boolean, false) then
    raise exception 'VIRKSOMHED_IKKE_BEKRAEFTET' using hint = 'Administrator skal bekræfte virksomhedsoplysninger før fakturering.';
  end if;
  select * into b from public.bank_profiles where id = coalesce(p_bank, o.bank_profile_id) and not archived;
  if b.id is null and coalesce(p_bank, o.bank_profile_id) is null then
    select * into b from public.bank_profiles where is_default and not archived;
  end if;
  if b.id is null then raise exception 'BANKPROFIL_MANGLER' using hint = 'Vælg en aktiv bankprofil.'; end if;
  select * into c from public.customers where id = o.customer_id;

  for p in select * from public.order_parts where order_id = o.id order by sort, created_at loop
    i := i + 1;
    lines := lines || jsonb_build_object('sort', i, 'description', public.part_line_text(p), 'quantity', p.quantity, 'unit', 'stk',
      'unit_price_ore', p.unit_price_ore, 'line_ore', p.quantity * p.unit_price_ore);
  end loop;
  if o.discount_ore > 0 then
    i := i + 1;
    lines := lines || jsonb_build_object('sort', i, 'description', 'Rabat', 'quantity', 1, 'unit', 'stk', 'unit_price_ore', -o.discount_ore, 'line_ore', -o.discount_ore);
  end if;
  t := public.order_totals(o.id);
  paid := public.order_paid(o.id);
  no := public.next_number('faktura');
  due := (now() at time zone 'Europe/Copenhagen')::date + coalesce((comp->>'payment_days')::int, 8);

  insert into public.invoices(invoice_no, kind, order_id, customer_id, idempotency_key, delivery_date, due_date, bank_profile_id,
    base_ore, vat_ore, total_ore, paid_ore, snapshot, created_by)
  values (no, 'faktura', o.id, o.customer_id, p_key, coalesce(o.ready_at, now())::date, due, b.id,
    (t->>'base_ore')::bigint, (t->>'vat_ore')::bigint, (t->>'total_ore')::bigint, paid,
    jsonb_build_object(
      'kind', 'faktura', 'invoice_no', no, 'issued_date', (now() at time zone 'Europe/Copenhagen')::date,
      'delivery_date', coalesce(o.ready_at, now())::date, 'due_date', due,
      'company', comp - 'confirmed',
      'customer', jsonb_build_object('name', c.name, 'company', c.company, 'cvr', c.cvr, 'address', c.billing_address,
                                     'email', c.email, 'phone', c.phone, 'kind', c.kind),
      'order', jsonb_build_object('order_no', o.order_no, 'title', o.title),
      'price_mode', o.price_mode, 'lines', lines, 'totals', t, 'paid_ore', paid,
      'rest_ore', greatest((t->>'total_ore')::bigint - paid, 0),
      'bank', jsonb_build_object('bank_name', b.bank_name, 'reg_no', b.reg_no, 'account_no', b.account_no, 'iban', b.iban, 'swift', b.swift),
      'notes', 'Ordre ' || o.order_no || coalesce(' · ' || o.title, '') || E'\n' ||
               case when o.price_mode = 'inkl' then 'Varelinjer er angivet inkl. moms.' else 'Varelinjer er angivet ekskl. moms.' end ||
               E'\nBetaling senest ' || to_char(due, 'DD.MM.YYYY') || ' til ' || b.bank_name || ', reg. ' || b.reg_no || ' konto ' || b.account_no || '.'),
    p_actor)
  returning invoices.id into v_id;
  insert into public.invoice_lines(invoice_id, sort, description, quantity, unit, unit_price_ore, line_ore)
  select v_id, (x->>'sort')::int, x->>'description', (x->>'quantity')::numeric, x->>'unit', (x->>'unit_price_ore')::bigint, (x->>'line_ore')::bigint
  from jsonb_array_elements(lines) x;
  update public.payments set invoice_id = v_id where order_id = o.id and invoice_id is null;
  return v_id;
end $$;

create or replace function public.issue_invoice(p_order_id uuid, p_bank uuid, p_request uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_id uuid; inv public.invoices;
begin
  if not public.is_staff() then raise exception 'Ingen adgang' using errcode = '42501'; end if;
  v_id := public.issue_invoice_internal(p_order_id, 'manual:' || p_request, p_bank, auth.uid());
  select * into inv from public.invoices where invoices.id = v_id;
  perform public.kick_worker();
  return jsonb_build_object('id', inv.id, 'invoice_no', inv.invoice_no);
end $$;

-- Kreditnota: fuld kreditering af en faktura (ny faktura kan derefter udstedes på ordren)
create or replace function public.create_credit_note(p_invoice uuid, p_reason text, p_request uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare f public.invoices; ex public.invoices; no text; v_id uuid; s jsonb;
begin
  if not public.is_staff() then raise exception 'Ingen adgang' using errcode = '42501'; end if;
  if coalesce(trim(p_reason),'') = '' then raise exception 'Angiv årsag til kreditnotaen'; end if;
  select * into ex from public.invoices where credits_invoice_id = p_invoice and kind = 'kreditnota';
  if ex.id is not null then return jsonb_build_object('id', ex.id, 'invoice_no', ex.invoice_no, 'already', true); end if;
  select * into f from public.invoices where invoices.id = p_invoice and kind = 'faktura' for update;
  if f.id is null then raise exception 'Fakturaen findes ikke'; end if;
  no := public.next_number('faktura');
  s := f.snapshot || jsonb_build_object('kind', 'kreditnota', 'invoice_no', no,
        'issued_date', (now() at time zone 'Europe/Copenhagen')::date, 'credits', f.invoice_no, 'reason', p_reason,
        'lines', (select jsonb_agg(x || jsonb_build_object('unit_price_ore', -(x->>'unit_price_ore')::bigint, 'line_ore', -(x->>'line_ore')::bigint)) from jsonb_array_elements(f.snapshot->'lines') x),
        'totals', (f.snapshot->'totals') || jsonb_build_object('lines_ore', -(f.snapshot->'totals'->>'lines_ore')::bigint, 'base_ore', -f.base_ore, 'vat_ore', -f.vat_ore, 'total_ore', -f.total_ore, 'discount_ore', 0, 'deposit_ore', 0, 'rest_ore', 0),
        'paid_ore', 0, 'rest_ore', 0,
        'notes', 'Kreditnota til faktura ' || f.invoice_no || E'\nÅrsag: ' || p_reason);
  insert into public.invoices(invoice_no, kind, order_id, customer_id, credits_invoice_id, idempotency_key, delivery_date, bank_profile_id,
    base_ore, vat_ore, total_ore, snapshot, reason, created_by)
  values (no, 'kreditnota', f.order_id, f.customer_id, f.id, 'credit:' || f.id, f.delivery_date, f.bank_profile_id,
    -f.base_ore, -f.vat_ore, -f.total_ore, s, p_reason, auth.uid()) returning invoices.id into v_id;
  insert into public.invoice_lines(invoice_id, sort, description, quantity, unit, unit_price_ore, line_ore)
  select v_id, sort, description, quantity, unit, -unit_price_ore, -line_ore from public.invoice_lines where invoice_id = f.id;
  perform public.kick_worker();
  return jsonb_build_object('id', v_id, 'invoice_no', no);
end $$;

create or replace function public.register_payment(p_order uuid, p_amount_ore bigint, p_method text, p_note text, p_request uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; inv uuid;
begin
  if not public.is_staff() then raise exception 'Ingen adgang' using errcode = '42501'; end if;
  select payments.id into v_id from public.payments where idempotency_key = 'pay:' || p_request;
  if v_id is not null then return v_id; end if;
  select f.id into inv from public.invoices f where f.order_id = p_order and f.kind = 'faktura'
    and not exists (select 1 from public.invoices k where k.credits_invoice_id = f.id) order by issued_at desc limit 1;
  insert into public.payments(order_id, invoice_id, amount_ore, method, note, idempotency_key)
  values (p_order, inv, p_amount_ore, p_method, p_note, 'pay:' || p_request) returning payments.id into v_id;
  return v_id;
end $$;

-- =====================================================================
-- Beskeder: oprettelse (outbox), worker-kald, klarmelding, påmindelser
-- =====================================================================
create or replace function public.kick_worker() returns void
language plpgsql security definer set search_path = public as $$
declare secret text;
begin
  select decrypted_secret into secret from vault.decrypted_secrets where name = 'worker_secret';
  if secret is null then return; end if;
  perform net.http_post(
    url := 'https://bxphyanqubgwehhqwzow.supabase.co/functions/v1/worker',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-worker-secret', secret),
    body := '{}'::jsonb, timeout_milliseconds := 2000);
exception when others then null; -- worker køres også af cron hvert minut
end $$;

create or replace function public.msg_vars(p_order uuid, p_invoice uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare o public.orders; c public.customers; inv public.invoices; t jsonb; paid bigint; rest bigint;
begin
  select * into o from public.orders where id = p_order;
  select * into c from public.customers where id = o.customer_id;
  if p_invoice is not null then select * into inv from public.invoices where id = p_invoice; end if;
  t := public.order_totals(o.id);
  paid := public.order_paid(o.id);
  rest := greatest((t->>'total_ore')::bigint - paid, 0);
  return jsonb_build_object('fornavn', split_part(coalesce(c.name,''), ' ', 1), 'navn', c.name, 'ordrenr', o.order_no,
    'titel', coalesce(o.title, ''), 'total', public.kr_txt(coalesce(inv.total_ore, (t->>'total_ore')::bigint)),
    'rest', public.kr_txt(rest), 'rest_tekst', case when rest > 0 then 'Restbeløb ved afhentning: ' || public.kr_txt(rest) || '. ' else '' end,
    'fakturanr', coalesce(inv.invoice_no, ''));
end $$;

create or replace function public.queue_message(p_order uuid, p_invoice uuid, p_channel text, p_kind text, p_key text, p_actor uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare c public.customers; tpl jsonb; vars jsonb; subj text; body text; rcpt text; v_id uuid; base text;
begin
  select m.id into v_id from public.message_jobs m where idempotency_key = p_key;
  if v_id is not null then return v_id; end if;
  select c2.* into c from public.orders o join public.customers c2 on c2.id = o.customer_id where o.id = p_order;
  rcpt := case p_channel when 'email' then nullif(trim(c.email),'') else nullif(regexp_replace(coalesce(c.phone,''), '[^0-9+]', '', 'g'), '') end;
  if rcpt is null then return null; end if;
  if p_channel = 'sms' and rcpt !~ '^\+' then rcpt := '+45' || right(rcpt, 8); end if;
  select value into tpl from public.app_settings where key = 'templates';
  vars := public.msg_vars(p_order, p_invoice);
  base := case p_kind when 'afhentning' then 'ready' when 'faktura' then 'invoice' when 'paamindelse' then 'reminder' else 'ready' end;
  if p_channel = 'sms' then
    body := public.render_template(tpl->>('sms_' || base), vars);
  else
    subj := public.render_template(tpl->>('email_' || base || '_subject'), vars);
    body := public.render_template(tpl->>('email_' || base || '_body'), vars);
  end if;
  insert into public.message_jobs(order_id, invoice_id, customer_id, channel, kind, recipient, subject, body, attach_invoice, idempotency_key, created_by)
  values (p_order, p_invoice, c.id, p_channel, p_kind, rcpt, subj, body, p_kind = 'faktura', p_key, p_actor)
  returning message_jobs.id into v_id;
  return v_id;
end $$;

-- Klarmelding (outbox): faktura + afhentningsbesked + fakturamail i samme transaktion som statusskiftet
create or replace function public.on_order_ready(p_order uuid) returns void
language plpgsql security definer set search_path = public as $$
declare cfg jsonb; o public.orders; c public.customers; inv uuid; err text; hint text;
begin
  select value into cfg from public.app_settings where key = 'messaging';
  if not coalesce((cfg->>'auto_on_ready')::boolean, true) then return; end if;
  select * into o from public.orders where id = p_order;
  select * into c from public.customers where id = o.customer_id;
  begin
    inv := public.issue_invoice_internal(p_order, 'final:' || p_order, null, auth.uid());
  exception when others then
    get stacked diagnostics err = message_text, hint = pg_exception_hint;
    if err = 'ALLEREDE_FAKTURERET' then
      select f.id into inv from public.invoices f where f.order_id = p_order and f.kind = 'faktura'
        and not exists (select 1 from public.invoices k where k.credits_invoice_id = f.id) order by issued_at desc limit 1;
    else
      inv := null;
      perform public.notify_staff('faktura_fejl', 'Faktura ikke udstedt · ordre ' || o.order_no, coalesce(hint, err), p_order);
    end if;
  end;
  -- afhentningsbesked efter kundens kontaktvalg
  if c.preferred_contact = 'email' and nullif(trim(c.email),'') is not null then
    perform public.queue_message(p_order, null, 'email', 'afhentning', 'ready:' || p_order || ':email', auth.uid());
  elsif c.preferred_contact = 'sms' and nullif(trim(c.phone),'') is not null then
    perform public.queue_message(p_order, null, 'sms', 'afhentning', 'ready:' || p_order || ':sms', auth.uid());
  else
    perform public.notify_staff('ring_kunde', 'Ring til kunden · ordre ' || o.order_no, coalesce(c.name,'') || ' ' || coalesce(c.phone,'') || ' – ordren er klar', p_order);
  end if;
  -- faktura på e-mail
  if inv is not null then
    if nullif(trim(c.email),'') is not null then
      perform public.queue_message(p_order, inv, 'email', 'faktura', 'invoice:' || inv, auth.uid());
    else
      perform public.notify_staff('faktura_fejl', 'Faktura uden e-mail · ordre ' || o.order_no, 'Kunden har ingen e-mail. Udlever/print fakturaen.', p_order);
    end if;
  end if;
  perform public.kick_worker();
end $$;

create or replace function public.orders_ready_trg() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'klar_til_afhentning' and old.status is distinct from 'klar_til_afhentning' then
    update public.orders set ready_at = coalesce(ready_at, now()) where id = new.id;
    perform public.on_order_ready(new.id);
  end if;
  if new.status = 'afhentet' and old.status <> 'afhentet' then
    update public.message_jobs set status = 'annulleret', last_error = 'Ordren er afhentet'
     where order_id = new.id and kind = 'paamindelse' and status in ('klargjort','fejlet');
  end if;
  return null;
end $$;
create trigger orders_ready after update of status on public.orders for each row execute function public.orders_ready_trg();

-- Kontrolleret genafsendelse (særskilt handling med medarbejder og tidspunkt)
create or replace function public.resend_message(p_job uuid, p_request uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare j public.message_jobs; v_id uuid; c public.customers; rcpt text;
begin
  if not public.is_staff() then raise exception 'Ingen adgang' using errcode = '42501'; end if;
  select m.id into v_id from public.message_jobs m where idempotency_key = 'resend:' || p_request;
  if v_id is not null then return v_id; end if;
  select * into j from public.message_jobs where message_jobs.id = p_job;
  select * into c from public.customers where id = j.customer_id;
  rcpt := case j.channel when 'email' then coalesce(nullif(trim(c.email),''), j.recipient) else j.recipient end;
  insert into public.message_jobs(order_id, invoice_id, customer_id, channel, kind, recipient, subject, body, attach_invoice, idempotency_key, resend_of, created_by)
  values (j.order_id, j.invoice_id, j.customer_id, j.channel, 'genafsendelse', rcpt, j.subject, j.body, j.attach_invoice, 'resend:' || p_request, j.id, auth.uid())
  returning message_jobs.id into v_id;
  perform public.kick_worker();
  return v_id;
end $$;

-- Send faktura (manuelt udstedt) på mail
create or replace function public.send_invoice_email(p_invoice uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare inv public.invoices; v_id uuid;
begin
  if not public.is_staff() then raise exception 'Ingen adgang' using errcode = '42501'; end if;
  select * into inv from public.invoices where invoices.id = p_invoice;
  v_id := public.queue_message(inv.order_id, inv.id, 'email', 'faktura', 'invoice:' || inv.id, auth.uid());
  if v_id is null then raise exception 'Kunden har ingen e-mail'; end if;
  perform public.kick_worker();
  return v_id;
end $$;

-- Påmindelser (dagligt): efter X dage, højst N gange, stopper ved afhentning
create or replace function public.create_pickup_reminders() returns int
language plpgsql security definer set search_path = public as $$
declare cfg jsonb; days int; maxn int; o record; n int; made int := 0; ch text;
begin
  select value into cfg from public.app_settings where key = 'messaging';
  days := nullif((cfg->>'reminder_days'), '')::int; maxn := coalesce((cfg->>'reminder_max')::int, 1);
  if days is null or days <= 0 then return 0; end if;
  for o in select ord.id, ord.ready_at, c.preferred_contact, c.email, c.phone from public.orders ord join public.customers c on c.id = ord.customer_id
           where ord.status = 'klar_til_afhentning' and ord.ready_at is not null loop
    select count(*) into n from public.message_jobs where order_id = o.id and kind = 'paamindelse';
    if n < maxn and now() >= o.ready_at + make_interval(days => days * (n + 1)) then
      ch := case when o.preferred_contact = 'email' and nullif(trim(o.email),'') is not null then 'email'
                 when nullif(trim(o.phone),'') is not null then 'sms' when nullif(trim(o.email),'') is not null then 'email' end;
      if ch is not null and public.queue_message(o.id, null, ch, 'paamindelse', 'reminder:' || o.id || ':' || (n + 1), null) is not null then made := made + 1; end if;
    end if;
  end loop;
  if made > 0 then perform public.kick_worker(); end if;
  return made;
end $$;

-- Worker-API (kun service_role)
create or replace function public.claim_message_jobs(p_limit int) returns setof public.message_jobs
language plpgsql security definer set search_path = public as $$
begin
  -- job der har hængt i kø > 10 min: uklart resultat → genforsøg sikkert (idempotensnøgle) eller manuel afstemning
  update public.message_jobs set status = 'uafklaret', last_error = 'Ingen svar fra worker – kontrollér hos udbyder'
   where status = 'i_koe' and locked_at < now() - interval '10 minutes' and channel = 'sms';
  update public.message_jobs set status = 'fejlet', last_error = 'Timeout – forsøges igen med samme idempotensnøgle', next_attempt_at = now()
   where status = 'i_koe' and locked_at < now() - interval '10 minutes' and channel = 'email';
  -- påmindelser/afhentningsbeskeder til afhentede ordrer annulleres
  update public.message_jobs m set status = 'annulleret', last_error = 'Ordren er afhentet'
   where m.status in ('klargjort','fejlet') and m.kind in ('afhentning','paamindelse')
     and exists (select 1 from public.orders o where o.id = m.order_id and o.status = 'afhentet');
  return query
  update public.message_jobs m set status = 'i_koe', locked_at = now(), attempts = m.attempts + 1
   where m.id in (
     select j.id from public.message_jobs j
      where j.status in ('klargjort','fejlet') and j.next_attempt_at <= now() and j.attempts < 6
        and (not j.attach_invoice or exists (select 1 from public.invoices i where i.id = j.invoice_id and i.pdf_status = 'klar'))
      order by j.created_at limit p_limit for update skip locked)
  returning m.*;
end $$;

create or replace function public.finish_message_job(p_id uuid, p_status text, p_provider text, p_provider_id text, p_error text, p_retry_seconds int)
returns void language plpgsql security definer set search_path = public as $$
declare j public.message_jobs; o public.orders;
begin
  update public.message_jobs set status = p_status, provider = coalesce(p_provider, provider), provider_id = coalesce(p_provider_id, provider_id),
    last_error = p_error, locked_at = null,
    next_attempt_at = case when p_retry_seconds is not null then now() + make_interval(secs => p_retry_seconds) else next_attempt_at end
   where id = p_id returning * into j;
  if p_status in ('afvist','uafklaret') or (p_status = 'fejlet' and j.attempts >= 6) then
    select * into o from public.orders where id = j.order_id;
    perform public.notify_staff('besked_fejl', 'Besked ikke leveret · ordre ' || coalesce(o.order_no, '?'), j.channel || ' til ' || j.recipient || ': ' || coalesce(p_error, p_status), j.order_id);
  end if;
end $$;

create or replace function public.release_message_job(p_id uuid, p_note text) returns void
language sql security definer set search_path = public as $$
  update public.message_jobs set status = 'klargjort', attempts = greatest(attempts - 1, 0), locked_at = null, last_error = p_note,
    next_attempt_at = now() + interval '5 minutes' where id = p_id
$$;

-- =====================================================================
-- Rettigheder
-- =====================================================================
alter table public.bank_profiles enable row level security;
alter table public.invoices enable row level security;
alter table public.invoice_lines enable row level security;
alter table public.payments enable row level security;
alter table public.message_jobs enable row level security;
alter table public.message_events enable row level security;
revoke all on public.bank_profiles, public.invoices, public.invoice_lines, public.payments, public.message_jobs, public.message_events from anon;

create policy bp_select on public.bank_profiles for select to authenticated using (public.is_staff());
create policy bp_insert on public.bank_profiles for insert to authenticated with check (public.is_admin());
create policy bp_update on public.bank_profiles for update to authenticated using (public.is_admin()) with check (public.is_admin());
revoke delete on public.bank_profiles from authenticated;
revoke update on public.bank_profiles from authenticated;
grant update (name, bank_name, reg_no, account_no, iban, swift, archived) on public.bank_profiles to authenticated;

create policy inv_select on public.invoices for select to authenticated using (public.is_staff());
revoke insert, update, delete on public.invoices from authenticated;
create policy invl_select on public.invoice_lines for select to authenticated using (public.is_staff());
revoke insert, update, delete on public.invoice_lines from authenticated;
create policy pay_select on public.payments for select to authenticated using (public.is_staff());
revoke insert, update, delete on public.payments from authenticated;
create policy mj_select on public.message_jobs for select to authenticated using (public.is_staff());
revoke insert, update, delete on public.message_jobs from authenticated;
create policy me_select on public.message_events for select to authenticated using (public.is_staff());
revoke insert, update, delete on public.message_events from authenticated;

-- indstillinger: admin må opdatere virksomhed, beskeder og skabeloner (integration_status skrives kun af worker)
drop policy if exists set_update on public.app_settings;
create policy set_update on public.app_settings for update to authenticated using (public.is_admin() and key <> 'integration_status') with check (public.is_admin() and key <> 'integration_status');
grant update (value, updated_at) on public.app_settings to authenticated;

-- nummerserie: admin kan sætte startnummer før første faktura
create or replace function public.set_invoice_start(p_next bigint, p_prefix text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Kun administrator' using errcode = '42501'; end if;
  if exists (select 1 from public.invoices) then raise exception 'Nummerserien kan ikke ændres efter første faktura'; end if;
  if p_next < 1 then raise exception 'Ugyldigt nummer'; end if;
  update public.number_series set next_value = p_next, prefix = coalesce(p_prefix, '') where key = 'faktura';
end $$;
create or replace function public.invoice_series() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('next', next_value, 'prefix', prefix, 'locked', exists (select 1 from public.invoices)) from public.number_series where key = 'faktura'
$$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('fakturaer', 'fakturaer', false, 10485760, array['application/pdf']) on conflict (id) do nothing;
create policy fakt_select on storage.objects for select to authenticated using (bucket_id = 'fakturaer' and public.is_staff());

revoke execute on all functions in schema public from anon, public;
revoke execute on function public.issue_invoice_internal(uuid,text,uuid,uuid), public.on_order_ready(uuid), public.queue_message(uuid,uuid,text,text,text,uuid),
  public.msg_vars(uuid,uuid), public.kick_worker(), public.create_pickup_reminders(), public.claim_message_jobs(int),
  public.finish_message_job(uuid,text,text,text,text,int), public.release_message_job(uuid,text), public.orders_ready_trg(),
  public.message_jobs_log_trg(), public.invoices_lock_trg(), public.invoices_nodelete_trg(),
  public.bank_touch(), public.message_jobs_touch_trg(), public.part_line_text(public.order_parts), public.order_paid(uuid)
  from authenticated;
grant execute on function public.claim_message_jobs(int), public.finish_message_job(uuid,text,text,text,text,int), public.release_message_job(uuid,text)
  to service_role;
grant execute on function public.set_default_bank(uuid), public.issue_invoice(uuid,uuid,uuid), public.create_credit_note(uuid,text,uuid),
  public.register_payment(uuid,bigint,text,text,uuid), public.resend_message(uuid,uuid), public.send_invoice_email(uuid),
  public.set_invoice_start(bigint,text), public.invoice_series(), public.kr_txt(bigint), public.render_template(text,jsonb) to authenticated;

alter publication supabase_realtime add table public.invoices, public.payments, public.message_jobs, public.bank_profiles, public.app_settings;

select cron.schedule('skumbutikken-worker', '* * * * *', $$select public.kick_worker()$$);
select cron.schedule('skumbutikken-paamindelser', '7 * * * *', $$select public.create_pickup_reminders()$$);

-- (anvendt som separate migrationer: phase3_tables, phase3_functions, phase3_msgvars_fix)
-- Delt worker-nøgle: oprettes i vault (værdien er ikke i repoet):
--   select vault.create_secret('<hemmelig>', 'worker_secret');
create or replace function public.check_worker_secret(p text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from vault.decrypted_secrets where name = 'worker_secret' and decrypted_secret = p)
$$;
revoke execute on function public.check_worker_secret(text) from public, anon, authenticated;
grant execute on function public.check_worker_secret(text) to service_role;
