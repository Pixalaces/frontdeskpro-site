// FrontDesk Pro — email Chris when a client submits a change request.
// Called by the portal right after a request is created (user's login token required).
// Sends only when RESEND_API_KEY, NOTIFY_FROM and NOTIFY_TO secrets are set; otherwise it's a no-op.
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const { request_id } = await req.json().catch(() => ({}));
  if (!request_id) return json({ error: "request_id required" }, 400);

  // Read the request as the signed-in user, so row-level security decides access.
  const userDb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") || "" } },
    auth: { persistSession: false },
  });
  const { data: r, error } = await userDb
    .from("change_requests").select("id,category,details,created_by_email,created_at,clients(name)")
    .eq("id", request_id).maybeSingle();
  if (error || !r) return json({ error: "not found" }, 404);

  const key = Deno.env.get("RESEND_API_KEY");
  const from = Deno.env.get("NOTIFY_FROM");
  const to = Deno.env.get("NOTIFY_TO");
  if (!key || !from || !to) return json({ sent: false, reason: "email not configured" });

  const client = (r as any).clients?.name || "A client";
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from, to: to.split(",").map((s) => s.trim()),
      reply_to: r.created_by_email || undefined,
      subject: `New change request — ${client} (${r.category})`,
      html: `<p><strong>${esc(client)}</strong> sent a change request.</p>
<p><strong>Type:</strong> ${esc(r.category)}<br><strong>From:</strong> ${esc(r.created_by_email || "unknown")}</p>
<p style="white-space:pre-wrap;border-left:3px solid #00D9C9;padding-left:12px">${esc(r.details)}</p>
<p><a href="https://frontdeskpro-site.pages.dev/portal/">Open the FrontDesk Pro portal</a></p>`,
    }),
  });
  return json({ sent: res.ok });
});
