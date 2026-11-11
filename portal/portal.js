/* FrontDesk Pro — client portal */
(function () {
  const SUPABASE_URL = "https://wurpbanlymetiralhkpd.supabase.co";
  const SUPABASE_KEY = "sb_publishable_3xKXy7MjV761iNGoFq66dA_T_ReWxqp"; // public key; data is protected by row-level security
  const RETELL_FN = SUPABASE_URL + "/functions/v1/retell?key=";
  const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const h = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

  const S = { user: null, admin: false, clients: [], cid: null, staff: [], calls: [], callsPage: 0 };
  const client = () => S.clients.find((c) => c.id === S.cid) || {};
  const tz = () => client().timezone || "Australia/Melbourne";

  /* ---------- helpers ---------- */
  function todayISO() {
    const p = Object.fromEntries(new Intl.DateTimeFormat("en-AU", { timeZone: tz(), year: "numeric", month: "2-digit", day: "2-digit" })
      .formatToParts(new Date()).map((x) => [x.type, x.value]));
    return `${p.year}-${p.month}-${p.day}`;
  }
  function nowLocal() {
    const p = Object.fromEntries(new Intl.DateTimeFormat("en-AU", { timeZone: tz(), weekday: "long", hour: "2-digit", minute: "2-digit", hour12: false })
      .formatToParts(new Date()).map((x) => [x.type, x.value]));
    return { weekday: DAYS.indexOf(p.weekday), hhmm: `${p.hour === "24" ? "00" : p.hour}:${p.minute}` };
  }
  const fmtDate = (d) => new Date(d + "T12:00:00Z").toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
  const fmtDT = (t) => t ? new Date(t).toLocaleString("en-AU", { timeZone: tz(), weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "—";
  const fmtDur = (s) => s == null ? "" : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  const t5 = (t) => (t || "").slice(0, 5);

  let toastTimer;
  function toast(msg, err) {
    const t = $("#toast"); t.textContent = msg; t.className = "toast show" + (err ? " err" : "");
    clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.className = "toast"), 3200);
  }
  function status(id, msg, ok) { const el = $(id); el.textContent = msg || ""; el.className = "status " + (msg ? (ok ? "ok" : "err") : ""); }
  function check(res, okMsg) {
    if (res.error) { toast(res.error.message || "Something went wrong", true); return false; }
    if (okMsg) toast(okMsg);
    return true;
  }
  const show = (id) => ["#login-view", "#noaccess-view", "#app-view"].forEach((v) => ($(v).hidden = v !== id));

  /* ---------- auth ---------- */
  $("#login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector("button"); btn.disabled = true;
    const email = $("#login-email").value.trim();
    const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin + "/portal/" } });
    btn.disabled = false;
    status("#login-status", error ? error.message : `Check ${email} — we've sent you a sign-in link. It works once and expires in an hour.`, !error);
  });
  $("#signout").addEventListener("click", async () => { await sb.auth.signOut(); location.reload(); });

  async function start(session) {
    if (!session) { $("#who").textContent = ""; $("#signout").hidden = true; show("#login-view"); return; }
    if (S.user && S.user.id === session.user.id) return;
    S.user = session.user;
    $("#who").textContent = S.user.email; $("#signout").hidden = false;
    const adm = await sb.rpc("is_admin"); S.admin = !!adm.data;
    await loadClients();
    if (!S.clients.length && !S.admin) { show("#noaccess-view"); return; }
    show("#app-view");
    $("#client-switch").hidden = !S.admin || S.clients.length < 1;
    $("#new-client").hidden = !S.admin;
    $("#tab-settings").hidden = !S.admin;
    if (!S.clients.length) { $("#client-name").textContent = "No clients yet — create one"; return; }
    await selectClient(localStorage.getItem("fdp_cid"));
  }

  async function loadClients() {
    const r = await sb.from("clients").select("*").order("name");
    S.clients = r.data || [];
    $("#client-switch").innerHTML = S.clients.map((c) => `<option value="${c.id}">${h(c.name)}</option>`).join("");
  }
  async function selectClient(id) {
    S.cid = S.clients.some((c) => c.id === id) ? id : S.clients[0].id;
    try { localStorage.setItem("fdp_cid", S.cid); } catch (_) {}
    $("#client-switch").value = S.cid;
    $("#client-name").textContent = client().name;
    await refreshAll();
  }
  $("#client-switch").addEventListener("change", (e) => selectClient(e.target.value));

  /* ---------- tabs ---------- */
  function goTab(name) {
    $$(".tabs button").forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
    $$("[data-panel]").forEach((p) => (p.hidden = p.dataset.panel !== name));
    try { history.replaceState(null, "", "#" + name); } catch (_) {}
  }
  $$(".tabs button").forEach((b) => b.addEventListener("click", () => goTab(b.dataset.tab)));
  $$("[data-goto]").forEach((b) => b.addEventListener("click", () => goTab(b.dataset.goto)));

  /* ---------- data ---------- */
  async function refreshAll() {
    await Promise.all([loadTeam(), loadServices(), loadHours(), loadClosures(), loadCalls(true), loadRequests(), loadUsage()]);
    $("#notice").value = client().notice || "";
    renderOverview();
    if (S.admin) loadSettings();
  }

  // Team & leave
  async function loadTeam() {
    const [st, aw] = await Promise.all([
      sb.from("staff").select("*").eq("client_id", S.cid).order("name"),
      sb.from("staff_away").select("*").eq("client_id", S.cid).gte("ends_on", todayISO()).order("starts_on"),
    ]);
    S.staff = st.data || []; S.away = aw.data || [];
    const byId = Object.fromEntries(S.staff.map((s) => [s.id, s]));
    $("#staff-list").innerHTML = S.staff.length ? S.staff.map((s) => `
      <div class="item ${s.active ? "" : "off"}">
        <div class="grow"><strong>${h(s.name)}</strong> <span class="meta">${h(s.role || "")}</span></div>
        <label class="switch" title="${s.active ? "Bookable" : "Hidden from receptionist"}"><input type="checkbox" data-staff-active="${s.id}" ${s.active ? "checked" : ""}><span></span></label>
        <button class="icon-btn" data-staff-del="${s.id}" aria-label="Remove ${h(s.name)}">Remove</button>
      </div>`).join("") : `<div class="empty">No team members yet.</div>`;
    $("#away-form [name=staff_id]").innerHTML = S.staff.filter((s) => s.active).map((s) => `<option value="${s.id}">${h(s.name)}${s.role ? " — " + h(s.role) : ""}</option>`).join("");
    const t = todayISO();
    $("#away-list").innerHTML = S.away.length ? S.away.map((a) => `
      <div class="item">
        <div class="grow"><strong>${h(byId[a.staff_id]?.name || "—")}</strong> ${a.starts_on <= t ? '<span class="pill now">Away now</span>' : ""}
          <div class="meta">${fmtDate(a.starts_on)} → ${fmtDate(a.ends_on)}${a.note ? " · " + h(a.note) : ""}</div></div>
        <button class="icon-btn" data-away-del="${a.id}">Delete</button>
      </div>`).join("") : `<div class="empty">Nobody is away.</div>`;
  }
  $("#staff-form").addEventListener("submit", async (e) => {
    e.preventDefault(); const f = new FormData(e.target);
    if (check(await sb.from("staff").insert({ client_id: S.cid, name: f.get("name").trim(), role: f.get("role").trim() || null }), "Team member added")) { e.target.reset(); loadTeam(); }
  });
  $("#staff-list").addEventListener("change", async (e) => {
    const id = e.target.dataset.staffActive; if (!id) return;
    if (check(await sb.from("staff").update({ active: e.target.checked }).eq("id", id), e.target.checked ? "Now bookable" : "Hidden from your receptionist")) loadTeam();
  });
  $("#staff-list").addEventListener("click", async (e) => {
    const id = e.target.dataset.staffDel; if (!id) return;
    const s = S.staff.find((x) => x.id === id);
    if (!confirm(`Remove ${s ? s.name : "this person"}? Their leave entries are removed too.`)) return;
    if (check(await sb.from("staff").delete().eq("id", id), "Removed")) loadTeam();
  });
  $("#away-form").addEventListener("submit", async (e) => {
    e.preventDefault(); const f = new FormData(e.target);
    if (!f.get("staff_id")) return status("#away-status", "Add a team member first.");
    if (f.get("ends_on") < f.get("starts_on")) return status("#away-status", "The end date must be on or after the start date.");
    const r = await sb.from("staff_away").insert({ client_id: S.cid, staff_id: f.get("staff_id"), starts_on: f.get("starts_on"), ends_on: f.get("ends_on"), note: f.get("note").trim() || null });
    if (check(r)) { status("#away-status", "Saved — your receptionist knows from the next call.", true); e.target.reset(); loadTeam(); renderOverview(); }
  });
  $("#away-list").addEventListener("click", async (e) => {
    const id = e.target.dataset.awayDel; if (!id) return;
    if (check(await sb.from("staff_away").delete().eq("id", id), "Leave removed")) { await loadTeam(); renderOverview(); }
  });

  // Services
  async function loadServices() {
    const r = await sb.from("services").select("*").eq("client_id", S.cid).order("name");
    const list = r.data || [];
    $("#svc-list").innerHTML = list.length ? list.map((s) => `
      <div class="item ${s.active ? "" : "off"}">
        <div class="grow"><strong>${h(s.name)}</strong> <span class="meta">${s.duration_min ? s.duration_min + " min" : ""}${s.notes ? " · " + h(s.notes) : ""}</span>
          ${s.active ? "" : '<div class="meta">Not being booked right now</div>'}</div>
        <label class="switch" title="${s.active ? "Available" : "Switched off"}"><input type="checkbox" data-svc-active="${s.id}" ${s.active ? "checked" : ""}><span></span></label>
        <button class="icon-btn" data-svc-del="${s.id}">Delete</button>
      </div>`).join("") : `<div class="empty">No services yet.</div>`;
  }
  $("#svc-form").addEventListener("submit", async (e) => {
    e.preventDefault(); const f = new FormData(e.target);
    const r = await sb.from("services").insert({ client_id: S.cid, name: f.get("name").trim(), duration_min: f.get("duration_min") ? +f.get("duration_min") : null, notes: f.get("notes").trim() || null });
    if (check(r, "Service added")) { e.target.reset(); loadServices(); }
  });
  $("#svc-list").addEventListener("change", async (e) => {
    const id = e.target.dataset.svcActive; if (!id) return;
    if (check(await sb.from("services").update({ active: e.target.checked }).eq("id", id), e.target.checked ? "Service switched on" : "Service switched off")) loadServices();
  });
  $("#svc-list").addEventListener("click", async (e) => {
    const id = e.target.dataset.svcDel; if (!id) return;
    if (!confirm("Delete this service? (Tip: switch it off instead if it's only temporary.)")) return;
    if (check(await sb.from("services").delete().eq("id", id), "Deleted")) loadServices();
  });

  // Hours
  async function loadHours() {
    const r = await sb.from("hours").select("*").eq("client_id", S.cid);
    S.hours = Object.fromEntries((r.data || []).map((x) => [x.weekday, x]));
    $("#hours-table").innerHTML = DAY_ORDER.map((d) => {
      const x = S.hours[d] || { closed: true };
      return `<div class="hrow" data-day="${d}">
        <label>${DAYS[d]}</label>
        <span class="closed-lbl"><input type="checkbox" class="h-closed" ${x.closed ? "checked" : ""}> Closed</span>
        <input type="time" class="h-open" value="${t5(x.opens) || "09:00"}" ${x.closed ? "disabled" : ""} aria-label="${DAYS[d]} opens">
        <input type="time" class="h-close" value="${t5(x.closes) || "17:00"}" ${x.closed ? "disabled" : ""} aria-label="${DAYS[d]} closes">
      </div>`;
    }).join("");
  }
  $("#hours-table").addEventListener("change", (e) => {
    if (!e.target.classList.contains("h-closed")) return;
    const row = e.target.closest(".hrow"); $$("input[type=time]", row).forEach((i) => (i.disabled = e.target.checked));
  });
  $("#save-hours").addEventListener("click", async () => {
    const rows = $$(".hrow").map((row) => {
      const closed = $(".h-closed", row).checked;
      return { client_id: S.cid, weekday: +row.dataset.day, closed, opens: closed ? null : $(".h-open", row).value, closes: closed ? null : $(".h-close", row).value };
    });
    const bad = rows.find((r) => !r.closed && (!r.opens || !r.closes || r.closes <= r.opens));
    if (bad) return status("#hours-status", `Check ${DAYS[bad.weekday]}: closing time must be after opening time.`);
    if (check(await sb.from("hours").upsert(rows, { onConflict: "client_id,weekday" }))) { status("#hours-status", "Hours saved — live from the next call.", true); loadHours(); renderOverview(); }
  });

  // Closures
  async function loadClosures() {
    const r = await sb.from("closures").select("*").eq("client_id", S.cid).gte("ends_on", todayISO()).order("starts_on");
    S.closures = r.data || [];
    const t = todayISO();
    $("#closure-list").innerHTML = S.closures.length ? S.closures.map((c) => `
      <div class="item"><div class="grow"><strong>${h(c.reason || "Closed")}</strong> ${c.starts_on <= t ? '<span class="pill now">Now</span>' : ""}
        <div class="meta">${fmtDate(c.starts_on)} → ${fmtDate(c.ends_on)}</div></div>
        <button class="icon-btn" data-cl-del="${c.id}">Delete</button></div>`).join("") : `<div class="empty">No upcoming closures.</div>`;
  }
  $("#closure-form").addEventListener("submit", async (e) => {
    e.preventDefault(); const f = new FormData(e.target);
    if (f.get("ends_on") < f.get("starts_on")) return status("#closure-status", "The end date must be on or after the start date.");
    if (check(await sb.from("closures").insert({ client_id: S.cid, starts_on: f.get("starts_on"), ends_on: f.get("ends_on"), reason: f.get("reason").trim() || null }))) {
      status("#closure-status", "Closure added.", true); e.target.reset(); await loadClosures(); renderOverview();
    }
  });
  $("#closure-list").addEventListener("click", async (e) => {
    const id = e.target.dataset.clDel; if (!id) return;
    if (check(await sb.from("closures").delete().eq("id", id), "Closure removed")) { await loadClosures(); renderOverview(); }
  });

  // Notice
  $("#save-notice").addEventListener("click", async () => {
    const notice = $("#notice").value.trim() || null;
    if (check(await sb.from("clients").update({ notice }).eq("id", S.cid))) {
      client().notice = notice; status("#notice-status", notice ? "Saved — callers will hear this from the next call." : "Cleared.", true);
    }
  });

  // Calls
  const PAGE = 20;
  async function loadCalls(reset) {
    if (reset) { S.calls = []; S.callsPage = 0; }
    const from = S.callsPage * PAGE;
    const r = await sb.from("calls").select("*").eq("client_id", S.cid).order("started_at", { ascending: false, nullsFirst: false }).range(from, from + PAGE - 1);
    const rows = r.data || []; S.calls = S.calls.concat(rows); S.callsPage++;
    $("#calls-more").hidden = rows.length < PAGE;
    $("#calls-list").innerHTML = S.calls.length ? S.calls.map(callHTML).join("") : `<div class="empty">No calls yet. Once your number is live, every call shows up here.</div>`;
  }
  function callHTML(c, i) {
    const pill = c.outcome ? `<span class="pill ${c.outcome === "successful" ? "done" : ""}">${h(c.outcome.replace(/_/g, " "))}</span>` : "";
    return `<div class="item call" data-call="${i}">
      <div class="call-top"><div class="grow"><strong>${h(c.from_number || "Unknown caller")}</strong>
        <div class="meta">${fmtDT(c.started_at)}${c.duration_sec != null ? " · " + fmtDur(c.duration_sec) : ""}</div></div>${pill}</div>
      ${c.summary ? `<div style="margin-top:.4rem">${h(c.summary)}</div>` : ""}
      <div class="call-body" hidden>${c.recording_url ? `<a href="${h(c.recording_url)}" target="_blank" rel="noopener">▶ Listen to recording</a>\n\n` : ""}${h(c.transcript || "No transcript.")}</div>
    </div>`;
  }
  $("#calls-list").addEventListener("click", (e) => {
    if (e.target.closest("a")) return;
    const el = e.target.closest("[data-call]"); if (el) $(".call-body", el).hidden = !$(".call-body", el).hidden;
  });
  $("#calls-more").addEventListener("click", () => loadCalls(false));

  async function loadUsage() {
    const t = todayISO(); const monthStart = t.slice(0, 8) + "01";
    const r = await sb.from("calls").select("duration_sec").eq("client_id", S.cid).gte("started_at", monthStart);
    const rows = r.data || [];
    S.usage = { calls: rows.length, mins: Math.ceil(rows.reduce((a, x) => a + (x.duration_sec || 0), 0) / 60) };
  }

  // Requests
  async function loadRequests() {
    const r = await sb.from("change_requests").select("*").eq("client_id", S.cid).order("created_at", { ascending: false });
    const list = r.data || [];
    const open = list.filter((x) => x.status === "received" || x.status === "in_progress").length;
    $("#req-badge").hidden = !open; $("#req-badge").textContent = open;
    const label = { received: "Received", in_progress: "In progress", done: "Done", declined: "Declined" };
    $("#req-list").innerHTML = list.length ? list.map((x) => `
      <div class="item" style="display:block">
        <div class="call-top"><div class="grow"><strong>${h(x.category)}</strong>
          <div class="meta">${fmtDT(x.created_at)}${x.created_by_email ? " · " + h(x.created_by_email) : ""}</div></div>
          <span class="pill ${x.status}">${label[x.status]}</span></div>
        <div style="margin-top:.5rem;white-space:pre-wrap">${h(x.details)}</div>
        ${x.admin_note ? `<div class="meta" style="margin-top:.5rem">FrontDesk Pro: ${h(x.admin_note)}</div>` : ""}
        ${S.admin ? `<div class="req-admin">
          <select data-req-status="${x.id}">${Object.keys(label).map((k) => `<option value="${k}" ${k === x.status ? "selected" : ""}>${label[k]}</option>`).join("")}</select>
          <input data-req-note="${x.id}" placeholder="Reply to client (optional)" value="${h(x.admin_note || "")}">
          <button class="ghost small" data-req-save="${x.id}">Update</button></div>` : ""}
      </div>`).join("") : `<div class="empty">No requests yet.</div>`;
  }
  $("#req-form").addEventListener("submit", async (e) => {
    e.preventDefault(); const f = new FormData(e.target); const btn = e.target.querySelector("button"); btn.disabled = true;
    const r = await sb.from("change_requests").insert({ client_id: S.cid, category: f.get("category"), details: f.get("details").trim() }).select("id").single();
    btn.disabled = false;
    if (check(r)) {
      status("#req-status", "Sent. We'll be in touch, usually within 1 business day.", true); e.target.reset(); loadRequests();
      sb.functions.invoke("notify-request", { body: { request_id: r.data.id } }).catch(() => {});
    }
  });
  $("#req-list").addEventListener("click", async (e) => {
    const id = e.target.dataset.reqSave; if (!id) return;
    const st = $(`[data-req-status="${id}"]`).value; const note = $(`[data-req-note="${id}"]`).value.trim() || null;
    if (check(await sb.from("change_requests").update({ status: st, admin_note: note }).eq("id", id), "Request updated")) loadRequests();
  });

  // Overview
  function renderOverview() {
    const t = todayISO(); const n = nowLocal();
    const closure = (S.closures || []).find((c) => c.starts_on <= t && c.ends_on >= t);
    const hrs = (S.hours || {})[n.weekday];
    const open = !closure && hrs && !hrs.closed && n.hhmm >= t5(hrs.opens) && n.hhmm < t5(hrs.closes);
    $("#ov-open").textContent = closure ? "Closed" : open ? "Open" : "Closed";
    const awayNow = (S.away || []).filter((a) => a.starts_on <= t);
    $("#ov-away").textContent = awayNow.length ? awayNow.length + (awayNow.length === 1 ? " person" : " people") : "Nobody";
    const u = S.usage || { calls: 0, mins: 0 }; const cap = client().plan_minutes || 0;
    $("#ov-calls").textContent = u.calls;
    $("#ov-mins").textContent = cap ? `${u.mins} / ${cap}` : u.mins;
    $("#ov-meter").style.width = cap ? Math.min(100, (u.mins / cap) * 100) + "%" : "0";
    $("#ov-recent").innerHTML = S.calls.length ? S.calls.slice(0, 3).map((c) => `
      <div class="item"><div class="grow"><strong>${h(c.from_number || "Unknown caller")}</strong>
        <div class="meta">${fmtDT(c.started_at)}</div>${c.summary ? `<div class="meta">${h(c.summary)}</div>` : ""}</div></div>`).join("")
      : `<div class="empty">No calls yet.</div>`;
  }

  /* ---------- admin ---------- */
  async function loadSettings() {
    const c = client(); const f = $("#client-form");
    ["name", "industry", "timezone", "plan", "plan_minutes", "phone_number", "retell_agent_id"].forEach((k) => (f.elements[k].value = c[k] ?? ""));
    const [sec, inv] = await Promise.all([
      sb.from("client_secrets").select("ai_key").eq("client_id", S.cid).maybeSingle(),
      sb.from("invites").select("email").eq("client_id", S.cid).order("email"),
    ]);
    $("#ai-url").value = sec.data ? RETELL_FN + sec.data.ai_key : "";
    const list = inv.data || [];
    $("#invite-list").innerHTML = list.length ? list.map((i) => `
      <div class="item"><div class="grow">${h(i.email)}</div><button class="icon-btn" data-inv-del="${h(i.email)}">Remove access</button></div>`).join("")
      : `<div class="empty">Nobody can sign in for this client yet.</div>`;
  }
  $("#client-form").addEventListener("submit", async (e) => {
    e.preventDefault(); const f = new FormData(e.target);
    const upd = {}; ["name", "industry", "timezone", "plan", "phone_number", "retell_agent_id"].forEach((k) => (upd[k] = (f.get(k) || "").trim() || null));
    upd.plan_minutes = +f.get("plan_minutes") || 0; if (!upd.name) return;
    if (check(await sb.from("clients").update(upd).eq("id", S.cid))) {
      status("#client-status", "Saved.", true); await loadClients(); $("#client-switch").value = S.cid; $("#client-name").textContent = client().name; renderOverview();
    }
  });
  $("#invite-form").addEventListener("submit", async (e) => {
    e.preventDefault(); const email = new FormData(e.target).get("email").trim().toLowerCase();
    if (check(await sb.from("invites").insert({ email, client_id: S.cid }), `${email} can now sign in`)) { e.target.reset(); loadSettings(); }
  });
  $("#invite-list").addEventListener("click", async (e) => {
    const email = e.target.dataset.invDel; if (!email) return;
    if (!confirm(`Remove portal access for ${email}?`)) return;
    if (check(await sb.rpc("revoke_access", { p_email: email, p_client: S.cid }), "Access removed")) loadSettings();
  });
  $("#copy-ai").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText($("#ai-url").value); toast("Copied"); } catch (_) { $("#ai-url").select(); }
  });
  $("#new-client").addEventListener("click", () => { $("#new-client-form").reset(); $("#new-client-dialog").showModal(); });
  $("#new-client-dialog").addEventListener("close", async () => {
    if ($("#new-client-dialog").returnValue !== "ok") return;
    const f = new FormData($("#new-client-form"));
    const r = await sb.from("clients").insert({ name: f.get("name").trim(), industry: f.get("industry").trim() || null }).select().single();
    if (!check(r, "Client created")) return;
    const email = (f.get("email") || "").trim().toLowerCase();
    if (email) await sb.from("invites").insert({ email, client_id: r.data.id });
    await loadClients(); $("#client-switch").hidden = false; await selectClient(r.data.id); goTab("settings");
  });

  /* ---------- boot ---------- */
  const startTab = (location.hash || "").slice(1);
  if (startTab && $(`[data-tab="${startTab}"]`)) goTab(startTab);
  sb.auth.onAuthStateChange((_ev, session) => { setTimeout(() => start(session), 0); });
  sb.auth.getSession().then(({ data }) => start(data.session));
})();
