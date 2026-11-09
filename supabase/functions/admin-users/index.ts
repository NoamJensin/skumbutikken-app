// Skumbutikken · medarbejderadministration (kun administrator)
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const ROLES = ["admin", "butik", "skraedder"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Metode ikke tilladt" }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(url, service, { auth: { persistSession: false } });

  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const { data: who, error: whoErr } = await admin.auth.getUser(jwt);
  if (whoErr || !who.user) return json({ error: "Ikke logget ind" }, 401);
  const { data: me } = await admin.from("employees").select("role, active").eq("id", who.user.id).maybeSingle();
  if (!me || !me.active || me.role !== "admin") return json({ error: "Kun administrator" }, 403);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "Ugyldig forespørgsel" }, 400); }
  const action = String(body.action || "");

  if (action === "create") {
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    const display_name = String(body.display_name || "").trim();
    const role = String(body.role || "butik");
    const title = body.title ? String(body.title) : null;
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: "Ugyldig e-mail" }, 400);
    if (password.length < 10) return json({ error: "Adgangskoden skal være mindst 10 tegn" }, 400);
    if (!display_name) return json({ error: "Navn mangler" }, 400);
    if (!ROLES.includes(role)) return json({ error: "Ukendt rolle" }, 400);
    const { data: created, error } = await admin.auth.admin.createUser({
      email, password, email_confirm: true, user_metadata: { display_name },
    });
    if (error || !created.user) return json({ error: error?.message || "Kunne ikke oprette bruger" }, 400);
    const { error: e2 } = await admin.from("employees").insert({
      id: created.user.id, email, display_name, role, title,
    });
    if (e2) {
      await admin.auth.admin.deleteUser(created.user.id);
      return json({ error: e2.message }, 400);
    }
    return json({ ok: true, id: created.user.id });
  }

  const id = String(body.id || "");
  if (!id) return json({ error: "Medarbejder mangler" }, 400);

  if (action === "set_active") {
    const active = Boolean(body.active);
    if (id === who.user.id && !active) return json({ error: "Du kan ikke deaktivere dig selv" }, 400);
    const { error } = await admin.from("employees").update({ active }).eq("id", id);
    if (error) return json({ error: error.message }, 400);
    // Deaktivering: spær login og tilbagekald alle aktive sessioner
    await admin.auth.admin.updateUserById(id, { ban_duration: active ? "none" : "876000h" });
    if (!active) {
      await admin.rpc("revoke_sessions", { p_user: id });
    }
    return json({ ok: true });
  }

  if (action === "reset_password") {
    const password = String(body.password || "");
    if (password.length < 10) return json({ error: "Adgangskoden skal være mindst 10 tegn" }, 400);
    const { error } = await admin.auth.admin.updateUserById(id, { password });
    if (error) return json({ error: error.message }, 400);
    await admin.rpc("revoke_sessions", { p_user: id });
    return json({ ok: true });
  }

  if (action === "revoke_sessions") {
    await admin.rpc("revoke_sessions", { p_user: id });
    return json({ ok: true });
  }

  if (action === "clear_pin") {
    const { error } = await admin.from("employees").update({ pin_hash: null, pin_failed: 0, pin_locked_until: null }).eq("id", id);
    if (error) return json({ error: error.message }, 400);
    return json({ ok: true });
  }

  return json({ error: "Ukendt handling" }, 400);
});
