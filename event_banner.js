// Farm map banner for events on now (ones with event flowers, /api/events):
// which flowers can grow outdoors until when, and a nudge to Generate plan
// for the whole farm when the plan was made before the event started, and
// again from its last day (that night's reset rolls after the event) until a
// whole-farm plan leaves its flowers out of outdoor plots. Dismissing hides
// an event for this run of it (start and end separately), in this browser only.
(function (root, factory) {
  const banner = factory();
  if (typeof module === "object" && module.exports) module.exports = banner;
  root.HKIAEventBanner = banner;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const esc = value => String(value ?? "").replace(/[&<>'"]/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
  })[char]);
  const KEY = "hkia-dismissed-events";
  const endPhase = (e, today) => e.ended || daysLeft(e, today) <= 0;
  const eventId = (e, today) => `${e.event}|${e.start}${endPhase(e, today) ? "|end" : ""}`;

  function shortDate(iso) {
    return new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, {month: "short", day: "numeric"});
  }

  function daysLeft(e, today) {
    return Math.round((new Date(`${e.end}T12:00:00`) - new Date(`${today}T12:00:00`)) / 86400000);
  }

  function list(names) {
    return names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
  }

  function resetTime(iso) {
    const time = iso ? new Date(iso) : null;
    return time && !isNaN(time) ? ` (${time.toLocaleTimeString(undefined, {hour: "numeric", minute: "2-digit"})})` : "";
  }

  const planButton = `<button type="button" class="button small primary" data-event-plan>Generate plan for the whole farm</button>`;

  /** What the banner says about ``e``: its sentence and the nudge under it. */
  function message(e, data) {
    const names = esc(list(e.flowers));
    const they = e.flowers.length === 1 ? "it" : "them";
    if (endPhase(e, data.today)) {
      const when = e.ended
        ? `ended on ${esc(shortDate(e.end))}. New ${names} only appear in the Greenhouse now`
        : `ends at tonight's reset${esc(resetTime(data.resets_at))}. Plants roll at that reset, after the event,
           so new ${names} can only appear in the Greenhouse from today's planting on`;
      const nudge = e.replant_after_event
        ? `<p class="event-nudge">${e.ended ? "Your outdoor plots were planned while it was on." :
             "Plans made today already leave them out of outdoor plots."}
             Replant the whole farm so those plots move to other work. ${planButton}</p>`
        : "";
      return `<p><strong>${esc(e.event)}</strong> ${when}.</p>${nudge}`;
    }
    const left = daysLeft(e, data.today);
    const when = `is on until ${shortDate(e.end)} (${left} day${left === 1 ? "" : "s"} left)`;
    const nudge = e.plan_before_event
      ? `<p class="event-nudge">Your plan is from before it started. ${planButton}</p>`
      : "";
    return `<p><strong>${esc(e.event)}</strong> ${esc(when)}. ${names} can grow outdoors now,
      not just in the Greenhouse, so more of ${they} can be bred at once.</p>${nudge}`;
  }

  /** The banner for ``data`` (/api/events), leaving out ``dismissed`` event ids. */
  function bannerHtml(data, dismissed = new Set()) {
    const shown = (data.active || []).filter(e => !dismissed.has(eventId(e, data.today))
      && (!e.ended || e.replant_after_event));    // a past event only while the farm still needs replanting
    return shown.map(e => {
      return `<section class="event-banner" data-event="${esc(eventId(e, data.today))}">
        <span class="event-icon" aria-hidden="true"><svg class="line-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 16.5A4.5 4.5 0 1 1 7.5 12 4.5 4.5 0 1 1 12 7.5a4.5 4.5 0 1 1 4.5 4.5 4.5 4.5 0 1 1-4.5 4.5"/><path d="M12 7.5V9"/><path d="M7.5 12H9"/><path d="M16.5 12H15"/><path d="M12 16.5V15"/><path d="m8 8 1.88 1.88"/><path d="M14.12 9.88 16 8"/><path d="m8 16 1.88-1.88"/><path d="M14.12 14.12 16 16"/></svg></span>
        <div>${message(e, data)}</div>
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
    box.querySelectorAll("[data-event-plan]").forEach(button => button.addEventListener("click", () => {
      document.getElementById("generatePlan")?.click();
      const whole = document.getElementById("replantAll");
      if (whole) whole.checked = true;
    }));
  }

  return {refresh, bannerHtml};
});
