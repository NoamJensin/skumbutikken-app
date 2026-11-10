// Skumbutikken · worker: faktura-PDF'er og kundebeskeder (mail/SMS)
// Kaldes af pg_cron hvert minut og straks efter nye job (pg_net). Kræver x-worker-secret.
import { createClient } from "npm:@supabase/supabase-js@2";
import * as PDFLib from "npm:pdf-lib@1.17.1";
import { renderInvoicePdf } from "./invoice_pdf.js";

const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });
function bytesToB64(bytes: Uint8Array) {
  let s = ""; const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(s);
}
async function timed(url: string, init: RequestInit, ms = 15000) {
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), ms);
  try { return await fetch(url, { ...init, signal: ac.signal }); } finally { clearTimeout(t); }
}

Deno.serve(async (req) => {
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  // Delt nøgle ligger i databasens krypterede vault (worker_secret) – samme som pg_net sender
  const hdr = req.headers.get("x-worker-secret") || "";
  const { data: okSecret } = await db.rpc("check_worker_secret", { p: hdr });
  if (!hdr || okSecret !== true) return json({ error: "forbidden" }, 403);
  const RESEND = Deno.env.get("RESEND_API_KEY");
  const GW = Deno.env.get("GATEWAYAPI_TOKEN");
  const out = { pdfs: 0, pdf_errors: 0, sent: 0, failed: 0, waiting: 0 };

  // 1) PDF for udstedte fakturaer (gemmes uændret; filen overskrives aldrig)
  const { data: pend } = await db.from("invoices").select("id, invoice_no, kind, issued_at, snapshot").eq("pdf_status", "afventer").limit(10);
  let logo: Uint8Array | null = null;
  if ((pend || []).length) {
    try { const r = await timed(Deno.env.get("LOGO_URL") || "https://noamjensin.github.io/skumbutikken-app/sb-monogram.png", {}, 8000); if (r.ok) logo = new Uint8Array(await r.arrayBuffer()); } catch (_) { logo = null; }
  }
  for (const inv of pend || []) {
    try {
      const bytes = await renderInvoicePdf(PDFLib, inv.snapshot, logo);
      const year = String(inv.issued_at).slice(0, 4);
      const path = `${year}/${inv.kind === "kreditnota" ? "kreditnota" : "faktura"}-${inv.invoice_no}.pdf`;
      const up = await db.storage.from("fakturaer").upload(path, bytes, { contentType: "application/pdf", upsert: false });
      if (up.error && !/exists|duplicate/i.test(up.error.message)) throw new Error(up.error.message);
      await db.from("invoices").update({ pdf_path: path, pdf_status: "klar", pdf_error: null }).eq("id", inv.id);
      out.pdfs++;
    } catch (e) {
      await db.from("invoices").update({ pdf_status: "fejl", pdf_error: String((e as Error).message || e) }).eq("id", inv.id);
      out.pdf_errors++;
    }
  }

  // 2) Integrationsstatus
  await db.from("app_settings").update({ value: { email_configured: !!RESEND, sms_configured: !!GW, last_run: new Date().toISOString() }, updated_at: new Date().toISOString() }).eq("key", "integration_status");

  // 3) Beskedkø
  const { data: cfgRow } = await db.from("app_settings").select("value").eq("key", "messaging").single();
  const cfg = (cfgRow && cfgRow.value) || {};
  const { data: jobs, error: claimErr } = await db.rpc("claim_message_jobs", { p_limit: 20 });
  if (claimErr) return json({ ...out, error: claimErr.message }, 500);

  for (const j of jobs || []) {
    const backoff = Math.min(3600, 60 * 2 ** Math.max(0, j.attempts - 1));
    if (j.channel === "email" && !RESEND) { await db.rpc("release_message_job", { p_id: j.id, p_note: "E-mail-integration er ikke sat op endnu" }); out.waiting++; continue; }
    if (j.channel === "sms" && !GW) { await db.rpc("release_message_job", { p_id: j.id, p_note: "SMS-integration er ikke sat op endnu" }); out.waiting++; continue; }

    if (j.channel === "email") {
      try {
        const payload: Record<string, unknown> = {
          from: `${cfg.from_name || "Skumbutikken"} <${cfg.from_email || "faktura@skumbutikken.dk"}>`,
          to: [j.recipient], subject: j.subject || "Skumbutikken", text: j.body,
        };
        if (cfg.reply_to) payload.reply_to = cfg.reply_to;
        if (j.attach_invoice && j.invoice_id) {
          const { data: inv } = await db.from("invoices").select("invoice_no, kind, pdf_path").eq("id", j.invoice_id).single();
          const file = await db.storage.from("fakturaer").download(inv!.pdf_path);
          if (file.error) throw new Error("PDF kunne ikke hentes: " + file.error.message);
          const bytes = new Uint8Array(await file.data.arrayBuffer());
          payload.attachments = [{ filename: `${inv!.kind === "kreditnota" ? "Kreditnota" : "Faktura"}-${inv!.invoice_no}.pdf`, content: bytesToB64(bytes) }];
        }
        const r = await timed("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: `Bearer ${RESEND}`, "Content-Type": "application/json", "Idempotency-Key": j.idempotency_key },
          body: JSON.stringify(payload),
        });
        const body = await r.json().catch(() => ({}));
        if (r.ok) { await db.rpc("finish_message_job", { p_id: j.id, p_status: "afsendt", p_provider: "resend", p_provider_id: body.id || null, p_error: null, p_retry_seconds: null }); out.sent++; }
        else if (r.status === 429 || r.status >= 500) { await db.rpc("finish_message_job", { p_id: j.id, p_status: "fejlet", p_provider: "resend", p_provider_id: null, p_error: `HTTP ${r.status}: ${body.message || ""}`, p_retry_seconds: backoff }); out.failed++; }
        else { await db.rpc("finish_message_job", { p_id: j.id, p_status: "afvist", p_provider: "resend", p_provider_id: null, p_error: `HTTP ${r.status}: ${body.message || JSON.stringify(body)}`, p_retry_seconds: null }); out.failed++; }
      } catch (e) {
        // Timeout/netværk: sikkert at gentage – Resend dedupliker på Idempotency-Key
        await db.rpc("finish_message_job", { p_id: j.id, p_status: "fejlet", p_provider: "resend", p_provider_id: null, p_error: String((e as Error).message || e), p_retry_seconds: backoff });
        out.failed++;
      }
    } else {
      try {
        const msisdn = j.recipient.replace(/\D/g, "");
        const r = await timed("https://gatewayapi.com/rest/mtsms", {
          method: "POST",
          headers: { Authorization: `Token ${GW}`, "Content-Type": "application/json" },
          body: JSON.stringify({ sender: (cfg.sms_sender || "Skumbutik").slice(0, 11), message: j.body, recipients: [{ msisdn: Number(msisdn) }], userref: j.id }),
        });
        const body = await r.json().catch(() => ({}));
        if (r.ok) { await db.rpc("finish_message_job", { p_id: j.id, p_status: "afsendt", p_provider: "gatewayapi", p_provider_id: body.ids ? String(body.ids[0]) : null, p_error: null, p_retry_seconds: null }); out.sent++; }
        else if (r.status === 429 || r.status >= 500) { await db.rpc("finish_message_job", { p_id: j.id, p_status: "fejlet", p_provider: "gatewayapi", p_provider_id: null, p_error: `HTTP ${r.status}: ${body.message || ""}`, p_retry_seconds: backoff }); out.failed++; }
        else { await db.rpc("finish_message_job", { p_id: j.id, p_status: "afvist", p_provider: "gatewayapi", p_provider_id: null, p_error: `HTTP ${r.status}: ${body.message || JSON.stringify(body)}`, p_retry_seconds: null }); out.failed++; }
      } catch (e) {
        // Uklart om SMS'en blev sendt (ingen idempotens hos udbyderen) → ingen automatisk genafsendelse
        await db.rpc("finish_message_job", { p_id: j.id, p_status: "uafklaret", p_provider: "gatewayapi", p_provider_id: null, p_error: "Uklart resultat: " + String((e as Error).message || e) + " – søg på reference " + j.id + " hos GatewayAPI", p_retry_seconds: null });
        out.failed++;
      }
    }
  }
  return json(out);
});
