-- Skumbutikken · fase 1 · kerneskema
create extension if not exists pgcrypto with schema extensions;

-- ---------- Typer ----------
create type public.app_role as enum ('admin', 'butik', 'skraedder');
create type public.order_status as enum (
  'kladde', 'klar_til_bekraeftelse', 'bekraeftet', 'i_arbejde',
  'til_kontrol', 'klar_til_afhentning', 'afhentet', 'annulleret');
create type public.part_type as enum ('skum', 'hynde_betraek', 'betraek', 'andet');
create type public.task_status as enum ('tildelt', 'modtaget', 'i_gang', 'pause', 'faerdig', 'godkendt');

-- ---------- Medarbejdere ----------
create table public.employees (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  email text not null,
  role public.app_role not null default 'butik',
  title text,
  active boolean not null default true,
  sort_order int not null default 100,
  pin_hash text,
  pin_failed int not null default 0,
  pin_locked_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.my_role() returns public.app_role
language sql stable security definer set search_path = public as $$
  select role from public.employees where id = auth.uid() and active
$$;
create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select role in ('admin','butik') from public.employees where id = auth.uid() and active), false)
$$;
create or replace function public.is_active_employee() returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.employees where id = auth.uid() and active)
$$;
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select role = 'admin' from public.employees where id = auth.uid() and active), false)
$$;

-- ---------- Fælles: tidsstempler, rækkeversion ----------
create or replace function public.touch_row() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  if tg_op = 'UPDATE' then
    new.row_version := old.row_version + 1;
    new.updated_by := coalesce(auth.uid(), new.updated_by);
  end if;
  return new;
end $$;

-- ---------- Nummerserier ----------
create table public.number_series (
  key text primary key,
  prefix text not null default '',
  next_value bigint not null default 1
);
insert into public.number_series(key, prefix, next_value) values ('ordre', '', 1001), ('faktura', '', 1);

create or replace function public.next_number(p_key text) returns text
language plpgsql security definer set search_path = public as $$
declare v bigint; p text;
begin
  update public.number_series set next_value = next_value + 1
   where key = p_key returning next_value - 1, prefix into v, p;
  if v is null then raise exception 'Ukendt nummerserie %', p_key; end if;
  return p || v::text;
end $$;
revoke all on function public.next_number(text) from public, anon, authenticated;

-- ---------- Kunder ----------
create table public.customers (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'privat' check (kind in ('privat','erhverv')),
  name text not null,
  phone text,
  email text,
  billing_address text,
  delivery_address text,
  company text,
  cvr text,
  preferred_contact text not null default 'sms' check (preferred_contact in ('sms','email','telefon')),
  notes text,
  row_version int not null default 1,
  created_by uuid default auth.uid() references public.employees(id),
  updated_by uuid references public.employees(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index customers_phone_idx on public.customers (regexp_replace(coalesce(phone,''), '\D', '', 'g'));
create index customers_email_idx on public.customers (lower(email));
create trigger customers_touch before update on public.customers for each row execute function public.touch_row();

-- ---------- Ordrer ----------
create table public.orders (
  id uuid primary key default gen_random_uuid(),
  order_no text unique,
  kind text not null default 'tilbud' check (kind in ('tilbud','ordre')),
  title text,
  customer_id uuid references public.customers(id),
  status public.order_status not null default 'kladde',
  price_mode text not null default 'ekskl' check (price_mode in ('ekskl','inkl')),
  discount_ore bigint not null default 0 check (discount_ore >= 0),
  deposit_ore bigint not null default 0 check (deposit_ore >= 0),
  deadline date,
  delivery_mode text not null default 'afhentning' check (delivery_mode in ('afhentning','levering')),
  assigned_tailor uuid references public.employees(id),
  priority text not null default 'normal' check (priority in ('normal','hoj')),
  internal_notes text,
  prepared_version int,          -- version butikken har gennemgået
  prepared_by uuid references public.employees(id),
  prepared_at timestamptz,
  confirmed_version int,         -- seneste version kunden har bekræftet
  needs_reconfirm boolean not null default false,
  row_version int not null default 1,
  created_by uuid default auth.uid() references public.employees(id),
  updated_by uuid references public.employees(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index orders_customer_idx on public.orders(customer_id);
create index orders_status_idx on public.orders(status);
create trigger orders_touch before update on public.orders for each row execute function public.touch_row();

create or replace function public.orders_assign_no() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.order_no is null then new.order_no := public.next_number('ordre'); end if;
  return new;
end $$;
create trigger orders_no before insert on public.orders for each row execute function public.orders_assign_no();

create table public.order_parts (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  sort int not null default 0,
  part_type public.part_type not null default 'skum',
  label text not null default '',
  quantity int not null default 1 check (quantity > 0),
  shape text not null default 'rektangel',
  length_cm numeric(8,1),
  width_cm numeric(8,1),
  thickness_cm numeric(8,1),
  measure_basis text not null default 'faerdigmaal' check (measure_basis in ('faerdigmaal','skummaal')),
  seam_allowance_cm numeric(5,1) not null default 0,
  foam_type text,
  firmness text,
  foam_item_no text,
  fabric text,
  fabric_color text,
  fabric_item_no text,
  zipper boolean not null default false,
  sewing text,
  accessories text,
  instructions text,
  material_source text not null default 'bestilles' check (material_source in ('lager','bestilles','kunde')),
  unit_price_ore bigint not null default 0 check (unit_price_ore >= 0),
  progress int not null default 0 check (progress between 0 and 100),
  stage text,
  row_version int not null default 1,
  created_by uuid default auth.uid() references public.employees(id),
  updated_by uuid references public.employees(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index order_parts_order_idx on public.order_parts(order_id, sort);
create trigger order_parts_touch before update on public.order_parts for each row execute function public.touch_row();

-- Versioner (låst snapshot af det kunden får vist)
create table public.order_versions (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  version int not null,
  snapshot jsonb not null,
  prepared_by uuid not null references public.employees(id),
  prepared_at timestamptz not null default now(),
  unique (order_id, version)
);

create table public.order_confirmations (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  version int not null,
  confirmed_at timestamptz not null default now(),
  device_user uuid references public.employees(id),
  unique (order_id, version)
);

-- ---------- Skrædderopgaver ----------
create table public.tailor_tasks (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  tailor_id uuid not null references public.employees(id),
  status public.task_status not null default 'tildelt',
  pause_reason text,
  released_version int not null,
  received_at timestamptz,
  started_at timestamptz,
  done_at timestamptz,
  approved_at timestamptz,
  approved_by uuid references public.employees(id),
  row_version int not null default 1,
  updated_by uuid references public.employees(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (order_id)
);
create index tailor_tasks_tailor_idx on public.tailor_tasks(tailor_id, status);
create trigger tailor_tasks_touch before update on public.tailor_tasks for each row execute function public.touch_row();

-- ---------- Kommentarer / spørgsmål ----------
create table public.comments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  part_id uuid references public.order_parts(id) on delete set null,
  author uuid not null default auth.uid() references public.employees(id),
  body text not null check (length(body) between 1 and 4000),
  is_question boolean not null default false,
  resolved boolean not null default false,
  created_at timestamptz not null default now()
);
create index comments_order_idx on public.comments(order_id, created_at);

-- ---------- Bilag (fotos, skitser, skabeloner) ----------
create table public.attachments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  part_id uuid references public.order_parts(id) on delete cascade,
  path text not null unique,
  kind text not null default 'foto' check (kind in ('foto','skitse','skabelon')),
  uploaded_by uuid not null default auth.uid() references public.employees(id),
  created_at timestamptz not null default now()
);

-- ---------- Notifikationer ----------
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.employees(id) on delete cascade,
  kind text not null,
  title text not null,
  body text,
  order_id uuid references public.orders(id) on delete cascade,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on public.notifications(user_id, created_at desc);

-- ---------- Auditlog ----------
create table public.audit_log (
  id bigserial primary key,
  at timestamptz not null default now(),
  actor uuid,
  table_name text not null,
  row_id uuid,
  action text not null,
  data jsonb
);

create or replace function public.audit_trg() returns trigger
language plpgsql security definer set search_path = public as $$
declare rid uuid; d jsonb;
begin
  if tg_op = 'DELETE' then rid := old.id; d := to_jsonb(old);
  elsif tg_op = 'INSERT' then rid := new.id; d := to_jsonb(new);
  else
    rid := new.id;
    select jsonb_object_agg(n.key, n.value) into d
      from jsonb_each(to_jsonb(new)) n
      join jsonb_each(to_jsonb(old)) o using (key)
     where n.value is distinct from o.value and n.key not in ('updated_at','row_version');
  end if;
  insert into public.audit_log(actor, table_name, row_id, action, data)
  values (auth.uid(), tg_table_name, rid, lower(tg_op), d - 'pin_hash');
  return null;
end $$;

create trigger a_customers after insert or update or delete on public.customers for each row execute function public.audit_trg();
create trigger a_orders after insert or update or delete on public.orders for each row execute function public.audit_trg();
create trigger a_parts after insert or update or delete on public.order_parts for each row execute function public.audit_trg();
create trigger a_tasks after insert or update or delete on public.tailor_tasks for each row execute function public.audit_trg();
create trigger a_employees after insert or update or delete on public.employees for each row execute function public.audit_trg();
