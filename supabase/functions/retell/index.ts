// FrontDesk Pro — Retell bridge.
// One URL per client: https://<project>.supabase.co/functions/v1/retell?key=<client ai_key>
//  - Retell inbound call webhook (event: call_inbound)  -> returns live dynamic variables
//  - Retell agent webhook (call_ended / call_analyzed)   -> stores the call in the portal
//  - GET (e.g. a Retell custom function or n8n)          -> returns the same live context as JSON
import { createClient } from "npm:@supabase/supabase-js@2";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });

function localParts(tz: string) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-AU", {
      timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hour12: false, weekday: "long",
    }).formatToParts(new Date()).map((x) => [x.type, x.value]),
  );
  const iso = `${p.year}-${p.month}-${p.day}`;
  return { iso, weekday: DAYS.indexOf(p.weekday), hhmm: `${p.hour === "24" ? "00" : p.hour}:${p.minute}` };
}
const fmtDate = (d: string) =>
  new Date(d + "T12:00:00Z").toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const fmtDayMonth = (d: string) =>
  new Date(d + "T12:00:00Z").toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const fmtTime = (t: string | null) => {
  if (!t) return "";
  const [h, m] = t.split(":").map(Number);
  return `${((h + 11) % 12) + 1}${m ? ":" + String(m).padStart(2, "0") : ""}${h < 12 ? "am" : "pm"}`;
};
const addDays = (iso: string, n: number) => {
  const d = new Date(iso + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10);
};

async function clientFromKey(key: string | null) {
  if (!key) return null;
  const { data } = await db.from("client_secrets").select("client_id").eq("ai_key", key).maybeSingle();
  if (!data) return null;
  const { data: c } = await db.from("clients").select("*").eq("id", data.client_id).single();
  return c;
}

async function buildContext(c: any) {
  const tz = c.timezone || "Australia/Melbourne";
  const now = localParts(tz);
  const horizon = addDays(now.iso, 14);
  const [staff, away, services, hours, closures] = await Promise.all([
    db.from("staff").select("id,name,role,active").eq("client_id", c.id).eq("active", true).order("name"),
    db.from("staff_away").select("staff_id,starts_on,ends_on,note").eq("client_id", c.id).gte("ends_on", now.iso).lte("starts_on", horizon).order("starts_on"),
    db.from("services").select("name,duration_min,notes,active").eq("client_id", c.id).order("name"),
    db.from("hours").select("*").eq("client_id", c.id).order("weekday"),
    db.from("closures").select("starts_on,ends_on,reason").eq("client_id", c.id).gte("ends_on", now.iso).order("starts_on").limit(5),
  ]);
  const staffById = Object.fromEntries((staff.data || []).map((s: any) => [s.id, s]));
  const awayRows = (away.data || []).filter((a: any) => staffById[a.staff_id]);
  const awayToday = awayRows.filter((a: any) => a.starts_on <= now.iso && a.ends_on >= now.iso);
  const awayLater = awayRows.filter((a: any) => a.starts_on > now.iso);
  const label = (a: any) => `${staffById[a.staff_id].name}${staffById[a.staff_id].role ? " (" + staffById[a.staff_id].role + ")" : ""}`;

  const staffAvailable = (staff.data || []).filter((s: any) => !awayToday.some((a: any) => a.staff_id === s.id))
    .map((s: any) => s.name + (s.role ? ` (${s.role})` : "")).join("; ") || "none listed";
  const awayTodayTxt = awayToday.map((a: any) => `${label(a)} is away until ${fmtDate(a.ends_on)}${a.note ? " — " + a.note : ""}`).join("; ") || "nobody";
  const awayLaterTxt = awayLater.map((a: any) => `${label(a)} away ${fmtDate(a.starts_on)} to ${fmtDate(a.ends_on)}`).join("; ") || "none";
  const svcOn = (services.data || []).filter((s: any) => s.active)
    .map((s: any) => s.name + (s.duration_min ? ` (${s.duration_min} min)` : "") + (s.notes ? ` — ${s.notes}` : "")).join("; ") || "none listed";
  const svcOff = (services.data || []).filter((s: any) => !s.active).map((s: any) => s.name).join("; ") || "none";
  const hoursTxt = (hours.data || []).map((h: any) => `${DAYS[h.weekday]}: ${h.closed ? "closed" : fmtTime(h.opens) + "–" + fmtTime(h.closes)}`).join("; ");
  const closureNow = (closures.data || []).find((x: any) => x.starts_on <= now.iso && x.ends_on >= now.iso);
  const closuresTxt = (closures.data || []).map((x: any) => `${fmtDate(x.starts_on)} to ${fmtDate(x.ends_on)}${x.reason ? " (" + x.reason + ")" : ""}`).join("; ") || "none";
  const today = (hours.data || []).find((h: any) => h.weekday === now.weekday);
  const openNow = !closureNow && today && !today.closed && today.opens && today.closes &&
    now.hhmm >= today.opens.slice(0, 5) && now.hhmm < today.closes.slice(0, 5);

  const vars: Record<string, string> = {
    business_name: c.name,
    today: `${DAYS[now.weekday]} ${fmtDayMonth(now.iso)}`,
    current_time: fmtTime(now.hhmm),
    open_now: openNow ? "yes" : "no",
    staff_available_today: staffAvailable,
    staff_away_today: awayTodayTxt,
    staff_away_upcoming: awayLaterTxt,
    services_available: svcOn,
    services_unavailable: svcOff,
    opening_hours: hoursTxt,
    closures: closuresTxt,
    special_notice: c.notice || "none",
  };
  vars.business_context = [
    `Today is ${vars.today}, ${vars.current_time}. The business is currently ${openNow ? "OPEN" : "CLOSED"}${closureNow ? " (" + (closureNow.reason || "closure") + ")" : ""}.`,
    `Opening hours: ${hoursTxt}.`,
    `Upcoming closures: ${closuresTxt}.`,
    `Staff working today: ${staffAvailable}.`,
    `Staff away today: ${awayTodayTxt}. Do not book appointments with staff while they are away; offer another practitioner or a date after they return.`,
    `Upcoming staff leave: ${awayLaterTxt}.`,
    `Services we offer: ${svcOn}.`,
    `Services temporarily NOT available (do not book these; offer to take a message): ${svcOff}.`,
    `Special notice from the business: ${vars.special_notice}.`,
  ].join("\n");
  return vars;
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const client = await clientFromKey(url.searchParams.get("key"));
  if (!client) return json({ error: "unknown key" }, 401);

  if (req.method === "GET") return json(await buildContext(client));
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  let body: any = {};
  try { body = await req.json(); } catch { /* empty */ }
  const event = body.event;

  if (event === "call_inbound" || event === "chat_inbound") {
    const dynamic_variables = await buildContext(client);
    return json({ [event]: { dynamic_variables } });
  }

  if (event === "call_ended" || event === "call_analyzed") {
    const call = body.call || body.data || {};
    if (!call.call_id) return json({ ok: true, skipped: "no call_id" });
    const analysis = call.call_analysis || {};
    const row: Record<string, unknown> = {
      client_id: client.id,
      retell_call_id: call.call_id,
      from_number: call.from_number ?? null,
      started_at: call.start_timestamp ? new Date(call.start_timestamp).toISOString() : null,
      duration_sec: call.start_timestamp && call.end_timestamp ? Math.round((call.end_timestamp - call.start_timestamp) / 1000) : null,
      transcript: call.transcript ?? null,
      recording_url: call.recording_url ?? null,
    };
    if (analysis.call_summary) row.summary = analysis.call_summary;
    if (analysis.user_sentiment) row.sentiment = analysis.user_sentiment;
    if (analysis.call_successful !== undefined) row.outcome = analysis.call_successful ? "successful" : "unsuccessful";
    else if (call.disconnection_reason) row.outcome = call.disconnection_reason;
    const { error } = await db.from("calls").upsert(row, { onConflict: "retell_call_id" });
    if (error) return json({ ok: false, error: error.message }, 500);
    return json({ ok: true });
  }

  // Retell custom function / n8n POST: return context
  return json(await buildContext(client));
});
