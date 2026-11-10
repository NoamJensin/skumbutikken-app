-- Erstatter reglen fra 0007: kun e-mails som administrator netop har godkendt via admin-users må oprettes
create table if not exists public.signup_allowlist (
  email text primary key,
  created_at timestamptz not null default now()
);
alter table public.signup_allowlist enable row level security;
revoke all on public.signup_allowlist from anon, authenticated;

create or replace function public.block_public_signup() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  delete from public.signup_allowlist where created_at < now() - interval '10 minutes';
  if exists (select 1 from public.signup_allowlist where email = lower(new.email)) then
    delete from public.signup_allowlist where email = lower(new.email);
    return new;
  end if;
  raise exception 'Tilmelding er lukket. Kontakt administrator.' using errcode = '42501';
end $$;
revoke execute on function public.block_public_signup() from public, anon, authenticated;
