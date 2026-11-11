/* FrontDesk Pro — shared behaviour. Settings live in assets/config.js */
(function () {
  var C = window.FDP || {};
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var telHref = function (n) { return "tel:" + String(n).replace(/[^\d+]/g, ""); };

  /* ---------- Mobile menu ---------- */
  $$("nav .nav-content").forEach(function (nc) {
    var links = nc.querySelector(".nav-links");
    if (!links || nc.querySelector(".menu-toggle")) return;
    var b = document.createElement("button");
    b.className = "menu-toggle";
    b.setAttribute("aria-label", "Open menu");
    b.setAttribute("aria-expanded", "false");
    b.innerHTML = "<span></span><span></span><span></span>";
    b.addEventListener("click", function () {
      var open = links.classList.toggle("open");
      b.setAttribute("aria-expanded", open ? "true" : "false");
    });
    links.addEventListener("click", function (e) {
      if (e.target.tagName === "A") { links.classList.remove("open"); b.setAttribute("aria-expanded", "false"); }
    });
    nc.appendChild(b);
  });

  /* ---------- Fill contact details from config ---------- */
  $$("[data-fdp-if]").forEach(function (el) {
    var keys = el.getAttribute("data-fdp-if").split(" ");
    var show = keys.every(function (k) { return k.charAt(0) === "!" ? !C[k.slice(1)] : !!C[k]; });
    el.hidden = !show;
  });
  $$("[data-fdp-text]").forEach(function (el) {
    var v = C[el.getAttribute("data-fdp-text")];
    if (v) el.textContent = v;
  });
  $$("[data-fdp-href]").forEach(function (el) {
    var k = el.getAttribute("data-fdp-href"), v = C[k];
    if (!v) return;
    el.href = k === "email" ? "mailto:" + v : telHref(v);
  });
  $$("[data-year]").forEach(function (el) { el.textContent = new Date().getFullYear(); });

  /* ---------- Forms: Web3Forms if key set, otherwise pre-filled email ---------- */
  $$("form.fdp-form").forEach(function (form) {
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var status = form.querySelector(".form-status");
      var btn = form.querySelector("button[type=submit]");
      var data = {};
      new FormData(form).forEach(function (v, k) { data[k] = v; });
      if (data.botcheck) return; // honeypot
      delete data.botcheck;
      var subject = (form.getAttribute("data-subject") || "Website enquiry") + " — " + (data.business || data.name || "");

      var done = function (ok, msg) {
        btn.disabled = false; btn.textContent = btn.getAttribute("data-label");
        status.className = "form-status " + (ok ? "ok" : "err");
        status.innerHTML = msg;
        if (ok) form.reset();
      };
      btn.setAttribute("data-label", btn.textContent);
      btn.disabled = true; btn.textContent = "Sending…";

      if (C.formAccessKey) {
        var payload = Object.assign({ access_key: C.formAccessKey, subject: subject, from_name: "FrontDesk Pro website" }, data);
        fetch("https://api.web3forms.com/submit", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify(payload)
        }).then(function (r) { return r.json(); }).then(function (j) {
          if (j.success) done(true, form.getAttribute("data-success") || "Thanks — we've got it and will be in touch within 1 business day.");
          else throw new Error(j.message);
        }).catch(function () {
          done(false, "Sorry, that didn't send. Please email us at <a href='mailto:" + C.email + "' style='color:#00D9C9'>" + C.email + "</a>" + (C.phone ? " or call " + C.phone : "") + ".");
        });
      } else {
        var body = Object.keys(data).map(function (k) {
          return k.charAt(0).toUpperCase() + k.slice(1).replace(/_/g, " ") + ": " + data[k];
        }).join("\n");
        window.location.href = "mailto:" + (C.email || "") + "?subject=" + encodeURIComponent(subject) + "&body=" + encodeURIComponent(body);
        done(true, "Your email app should have opened with your details filled in — just hit send. Nothing opened? Email <a href='mailto:" + C.email + "' style='color:#00D9C9'>" + C.email + "</a>.");
      }
    });
  });

  /* ---------- Booking: real Cal.com calendar when a link is set ---------- */
  var calEl = document.getElementById("cal-inline");
  var direct = document.getElementById("cal-direct");
  if (direct && C.bookingLink) direct.href = "https://cal.com/" + C.bookingLink.replace(/^https?:\/\/(app\.)?cal\.com\//, "");
  if (calEl && C.bookingLink) {
    (function (C2, A, L) { var p = function (a, ar) { a.q.push(ar); }; var d = C2.document; C2.Cal = C2.Cal || function () { var cal = C2.Cal; var ar = arguments; if (!cal.loaded) { cal.ns = {}; cal.q = cal.q || []; d.head.appendChild(d.createElement("script")).src = A; cal.loaded = true; } if (ar[0] === L) { var api = function () { p(api, arguments); }; var namespace = ar[1]; api.q = api.q || []; if (typeof namespace === "string") { cal.ns[namespace] = cal.ns[namespace] || api; p(cal.ns[namespace], ar); p(cal, ["initNamespace", namespace]); } else p(cal, ar); return; } p(cal, ar); }; })(window, "https://app.cal.com/embed/embed.js", "init");
    Cal("init", "demo", { origin: "https://cal.com" });
    Cal.ns.demo("inline", { elementOrSelector: "#cal-inline", calLink: C.bookingLink.replace(/^https?:\/\/(app\.)?cal\.com\//, ""), layout: "month_view", config: { theme: "dark" } });
    Cal.ns.demo("ui", { theme: "dark", styles: { branding: { brandColor: "#00D9C9" } }, hideEventTypeDetails: false });
  }
})();
