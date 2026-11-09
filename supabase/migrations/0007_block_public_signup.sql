-- Kun administrator (via Edge Function med e-mail bekræftet) må oprette brugere.
-- Offentlige tilmeldinger via /auth/v1/signup oprettes ubekræftede og afvises her.
create or replace function public.block_public_signup() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.email_confirmed_at is null and new.phone_confirmed_at is null then
    raise exception 'Tilmelding er lukket. Kontakt administrator.' using errcode = '42501';
  end if;
  return new;
end $$;
revoke execute on function public.block_public_signup() from public, anon, authenticated;
drop trigger if exists block_public_signup on auth.users;
create trigger block_public_signup before insert on auth.users
  for each row execute function public.block_public_signup();
