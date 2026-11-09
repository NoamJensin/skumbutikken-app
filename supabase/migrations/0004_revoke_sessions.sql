create or replace function public.revoke_sessions(p_user uuid) returns void
language plpgsql security definer set search_path = public, auth as $$
begin
  delete from auth.refresh_tokens where user_id::uuid = p_user;
  delete from auth.sessions where user_id = p_user;
end $$;
revoke execute on function public.revoke_sessions(uuid) from public, anon, authenticated;
grant execute on function public.revoke_sessions(uuid) to service_role;
