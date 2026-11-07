// Farm map banner for events on now (ones with event flowers, /api/events):
// which flowers can grow outdoors until when, and a nudge to Generate plan
// when the plan was made before the event started. Dismissing hides an event
// for this run of it, in this browser only.
(function (root, factory) {
  const banner = factory();
  if (typeof module === "object" && module.exports) module.exports = banner;
  root.HKIAEventBanner = banner;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const esc = value => String(value ?? "").replace(/[&<>'"]/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
  })[char]);
  const KEY = "hkia-dismissed-events";
  const eventId = e => `${e.event}|${e.start}`;

  function shortDate(iso) {
    return new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, {month: "short", day: "numeric"});
  }

  function daysLeft(e, today) {
    return Math.round((new Date(`${e.end}T12:00:00`) - new Date(`${today}T12:00:00`)) / 86400000);
  }

  function list(names) {
    return names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
  }

  /** The banner for ``data`` (/api/events), leaving out ``dismissed`` event ids. */
  function bannerHtml(data, dismissed = new Set()) {
    const shown = (data.active || []).filter(e => !dismissed.has(eventId(e)));
    return shown.map(e => {
      const left = daysLeft(e, data.today);
      const when = left <= 0 ? "ends today" : `is on until ${shortDate(e.end)} (${left} day${left === 1 ? "" : "s"} left)`;
      const nudge = e.plan_before_event
        ? `<p class="event-nudge">Your plan is from before it started.
             <button type="button" class="button small primary" data-event-plan>Generate plan</button></p>`
        : "";
      return `<section class="event-banner" data-event="${esc(eventId(e))}">
        <span class="event-icon" aria-hidden="true"><svg class="line-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 16.5A4.5 4.5 0 1 1 7.5 12 4.5 4.5 0 1 1 12 7.5a4.5 4.5 0 1 1 4.5 4.5 4.5 4.5 0 1 1-4.5 4.5"/><path d="M12 7.5V9"/><path d="M7.5 12H9"/><path d="M16.5 12H15"/><path d="M12 16.5V15"/><path d="m8 8 1.88 1.88"/><path d="M14.12 9.88 16 8"/><path d="m8 16 1.88-1.88"/><path d="M14.12 14.12 16 16"/></svg></span>
        <div><p><strong>${esc(e.event)}</strong> ${esc(when)}. ${esc(list(e.flowers))} can grow outdoors now,
          not just in the Greenhouse, so more of ${e.flowers.length === 1 ? "it" : "them"} can be bred at once.</p>${nudge}</div>
        <button type="button" class="icon-button event-dismiss" data-event-dismiss aria-label="Hide this event">×</button>
      </section>`;
    }).join("");
  }

  function dismissed() {
    try { return new Set(JSON.parse(localStorage.getItem(KEY) || "[]")); } catch (_) { return new Set(); }
  }

  function dismiss(id) {
    try { localStorage.setItem(KEY, JSON.stringify([...dismissed(), id].slice(-40))); } catch (_) { /* private mode */ }
  }

  /** Redraw the banner (after every farm load). */
  async function refresh() {
    const box = document.getElementById("eventBanner");
    if (!box) return;
    let data;
    try {
      const response = await fetch("/api/events");
      if (!response.ok) throw new Error();
      data = await response.json();
    } catch (_) {
      box.innerHTML = "";           // an older server without events: no banner
      return;
    }
    box.innerHTML = bannerHtml(data, dismissed());
    box.querySelectorAll("[data-event-dismiss]").forEach(button => button.addEventListener("click", () => {
      dismiss(button.closest("[data-event]").dataset.event);
      button.closest("[data-event]").remove();
    }));
    box.querySelectorAll("[data-event-plan]").forEach(button => button.addEventListener("click",
      () => document.getElementById("generatePlan")?.click()));
  }

  return {refresh, bannerHtml};
});
