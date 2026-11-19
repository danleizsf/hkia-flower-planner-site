// Two buttons: "What's new" beside the Flower Farm title (the site's CHANGELOG.md,
// by date, with a dot until the newest entry has been seen in this browser)
// and "Feedback" in the bottom-right corner, above the tip jar (a bug report
// or idea, sent to a Google Form; see FORM). Both are for the browser version:
// the self-hosted dashboard serves no CHANGELOG.md and shows neither.
(function (root, factory) {
  const whatsNew = factory();
  if (typeof module === "object" && module.exports) module.exports = whatsNew;
  root.HKIAWhatsNew = whatsNew;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const esc = value => String(value ?? "").replace(/[&<>'"]/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
  })[char]);
  const SEEN_KEY = "hkia-whats-new-seen";
  // Feedback goes to a Google Form (a private Sheet of responses), so players
  // need no account. action: the form's formResponse URL; fields: each report
  // field's "entry.N" id, from the form's pre-filled link. Empty action: no
  // Feedback button.
  const FORM = {
    action: "https://docs.google.com/forms/d/e/1FAIpQLSfZo13lANZUspIggDJ4szBnqaRIIH-WCyewWv9HKCOnMyj0fw/formResponse",
    fields: {kind: "entry.1211931363", title: "entry.1050736851", what: "entry.633202109", expected: "entry.1471182114",
             contact: "entry.243889115", details: "entry.1567269427"},
  };

  // ---- The changelog ----

  /** **bold** and [links](https://…) in already-escaped text. */
  function inline(text) {
    return esc(text)
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  }

  // Each entry starts with its kind, plus ", whats-new" to show it in What's new:
  // "- [fix, whats-new] ...". browser/deploy_pages.py refuses entries without one.
  const ENTRY_KINDS = {feature: "New feature", tweak: "Improved", fix: "Fixed"};

  /**
   * CHANGELOG.md as [{date, items: [{kind, whatsNew, html}]}], newest first (the
   * file's order). An entry without a [kind] tag is shown, unlabeled.
   */
  function parseChangelog(markdown) {
    const days = [];
    let item = null;
    for (const line of String(markdown).split(/\r?\n/)) {
      const heading = line.match(/^## (\d{4}-\d{2}-\d{2})\s*$/);
      if (heading) {
        days.push({date: heading[1], items: []});
        item = null;
      } else if (!days.length) {
        continue;                                   // the file's title and intro
      } else if (/^- /.test(line)) {
        const tag = line.match(/^- \[(\w+)(, whats-new)?\]\s*/);
        item = {kind: tag && ENTRY_KINDS[tag[1]] ? tag[1] : null, whatsNew: !tag || Boolean(tag[2]),
                lines: [line.slice(tag ? tag[0].length : 2).trim()]};
        days.at(-1).items.push(item);
      } else if (item && /^\s+\S/.test(line)) {
        item.lines.push(line.trim());               // a wrapped bullet
      } else {
        item = null;
      }
    }
    return days.map(day => ({date: day.date, items: day.items.map(({kind, whatsNew, lines}) =>
      ({kind, whatsNew, html: inline(lines.join(" "))}))}));
  }

  /** Only the entries flagged for What's new, and only days that have some. */
  const whatsNewDays = days => days
    .map(day => ({...day, items: day.items.filter(item => item.whatsNew)}))
    .filter(day => day.items.length);

  function longDate(iso) {
    return new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, {month: "long", day: "numeric", year: "numeric"});
  }

  /** Days newer than ``seen`` (a date; nothing seen yet means just the latest update). */
  const unseen = (days, seen) => (seen ? days.filter(day => day.date > seen) : days.slice(0, 1));

  function changelogHtml(days, seen) {
    const fresh = new Set(unseen(days, seen).map(day => day.date));
    return days.map(day => `<section class="whats-new-day">
        <h3>${esc(longDate(day.date))}${fresh.has(day.date) ? ' <span class="whats-new-pill">New</span>' : ""}</h3>
        <ul>${day.items.map(item => `<li>${item.kind
          ? `<span class="whats-new-kind kind-${item.kind}">${ENTRY_KINDS[item.kind]}</span> ` : ""}${item.html}</li>`).join("")}</ul>
      </section>`).join("");
  }

  // ---- Feedback ----

  /** What the report says about the setup: never farm data or anything personal. */
  function diagnostics(days) {
    const script = typeof document !== "undefined" ? document.querySelector('script[src*="app.js"]') : null;
    const build = script ? new URL(script.src, location.href).searchParams.get("v") : null;
    return [
      `Planner: ${days?.[0]?.date ? `update of ${days[0].date}` : "unknown version"}${build ? ` (build ${build})` : ""}`,
      typeof navigator !== "undefined" ? `Browser: ${navigator.userAgent}` : null,
      typeof window !== "undefined" ? `Screen: ${window.innerWidth} × ${window.innerHeight}` : null,
    ].filter(Boolean).join("\n");
  }

  // label: what the form's Type question gets (its options are Issue and Idea).
  const KINDS = {
    bug: {label: "Issue", what: "What went wrong?", expected: "What did you expect to happen?",
          title: "e.g. The forecast shows no finds", missing: "Please describe what went wrong."},
    idea: {label: "Idea", what: "What's your idea?", expected: "How would it help you?",
           title: "e.g. Show which flowers to pick", missing: "Please describe your idea."},
  };
  /** The report as the Google Form's fields (its entry ids are in FORM.fields). */
  function formBody(report) {
    const body = new URLSearchParams();
    const values = {...report, kind: KINDS[report.kind].label};
    for (const [key, entry] of Object.entries(FORM.fields)) if (values[key]) body.set(entry, values[key]);
    return body;
  }

  /**
   * Sends the report to the Google Form. Google doesn't let the page read the
   * reply (no-cors), so only a network failure can be seen and reported.
   */
  function sendReport(report) {
    return fetch(FORM.action, {method: "POST", mode: "no-cors", body: formBody(report)});
  }
  // ---- The dialogs ----

  let days = [];        // every update (the version in feedback reports)
  let newsDays = [];    // the ones with What's new entries

  function readSeen() {
    try { return localStorage.getItem(SEEN_KEY); } catch (_) { return null; }
  }

  function markSeen() {
    try { if (newsDays[0]) localStorage.setItem(SEEN_KEY, newsDays[0].date); } catch (_) { /* private mode */ }
    document.querySelector("#whatsNew .whats-new-dot")?.remove();
  }

  function dialog(className, html) {
    const box = document.createElement("dialog");
    box.className = `areas-dialog ${className}`;
    box.innerHTML = html;
    document.body.appendChild(box);
    const close = () => { box.close(); box.remove(); };
    box.addEventListener("cancel", close);
    box.querySelectorAll("[data-close]").forEach(button => button.addEventListener("click", close));
    box.addEventListener("click", event => { if (event.target === box) close(); });   // the backdrop
    box.showModal();
    box.scrollTop = 0;          // showModal focuses the first button, which can be far down on a phone
    return {box, close};
  }

  function openWhatsNew() {
    const seen = readSeen();
    const {box, close} = dialog("whats-new-dialog", `
      <h2>What's new</h2>
      <p class="lead">Recent updates to the planner, newest first.</p>
      <div class="whats-new-list">${changelogHtml(newsDays, seen)}</div>
      <div class="onboarding-actions">
        ${FORM.action ? '<button type="button" class="button secondary" data-feedback>Send feedback</button>' : "<span></span>"}
        <button type="button" class="button primary" data-close>Close</button>
      </div>`);
    box.querySelector("[data-feedback]")?.addEventListener("click", () => { close(); openFeedback(); });
    markSeen();
  }

  function openFeedback(kind = "bug") {
    const {box} = dialog("feedback-dialog", `
      <h2>Send feedback</h2>
      <p class="lead">Report a problem or share an idea. It goes straight to the developer, and no sign-in is needed.</p>
      <div class="feedback-kinds" role="radiogroup" aria-label="Type of feedback">
        <label><input type="radio" name="feedbackKind" value="bug"><span>Report a problem</span></label>
        <label><input type="radio" name="feedbackKind" value="idea"><span>Suggest an idea</span></label>
      </div>
      <label class="feedback-field"><span>Summary <small>(optional)</small></span>
        <input type="text" data-field="title" maxlength="120"></label>
      <label class="feedback-field"><span data-label="what"></span>
        <textarea data-field="what" rows="5"></textarea></label>
      <label class="feedback-field"><span><span data-label="expected"></span> <small>(optional)</small></span>
        <textarea data-field="expected" rows="3"></textarea></label>
      <label class="feedback-field"><span>Want a reply? <small>(optional)</small></span>
        <input type="text" data-field="contact" maxlength="200" placeholder="Email or username">
        <small>Leave it blank to stay anonymous.</small></label>
      <label class="check-row feedback-details"><input type="checkbox" data-field="withDetails" checked>
        <span><strong>Include planner version and device info</strong>
        <small data-details></small><small>Your farm isn't sent.</small></span></label>
      <p class="error" hidden></p>
      <div class="onboarding-actions">
        <button type="button" class="button secondary" data-close>Cancel</button>
        <button type="button" class="button primary" data-post>Send feedback</button>
      </div>`);    const field = name => box.querySelector(`[data-field="${name}"]`);
    const details = diagnostics(days);
    box.querySelector("[data-details]").textContent = details;
    const setKind = value => {
      box.querySelector(`input[value="${value}"]`).checked = true;
      box.querySelector('[data-label="what"]').textContent = KINDS[value].what;
      box.querySelector('[data-label="expected"]').textContent = KINDS[value].expected;
      field("title").placeholder = KINDS[value].title;
    };
    setKind(kind);
    box.querySelectorAll('input[name="feedbackKind"]').forEach(input => input.addEventListener("change", () => setKind(input.value)));
    const report = () => ({
      kind: box.querySelector('input[name="feedbackKind"]:checked').value,
      title: field("title").value.trim(),
      what: field("what").value.trim(),
      expected: field("expected").value.trim(),
      contact: field("contact").value.trim(),
      details: field("withDetails").checked ? details : "",
    });
    const error = message => {
      const line = box.querySelector(".error");
      line.textContent = message;
      line.hidden = !message;
    };
    box.addEventListener("input", () => error(""));
    const ready = () => {
      if (report().what) return true;
      error(KINDS[report().kind].missing);
      field("what").focus();
      return false;
    };
    const send = box.querySelector("[data-post]");
    send.addEventListener("click", async () => {
      if (!ready()) return;
      error("");
      send.disabled = true;
      send.textContent = "Sending…";
      try {
        await sendReport(report());
      } catch (_) {
        error("It didn't send. Check your internet connection and try again.");
        send.disabled = false;
        send.textContent = "Send feedback";
        return;
      }
      box.innerHTML = `<h2>Thank you!</h2>
        <p class="lead">Your feedback was sent. Every report helps make the planner better.</p>
        <div class="onboarding-actions"><span></span><button type="button" class="button primary" data-done>Close</button></div>`;
      box.querySelector("[data-done]").addEventListener("click", () => { box.close(); box.remove(); });
    });
    field("title").focus();
  }

  /** Show the buttons (once, at startup): What's new once the changelog loads, Feedback once a form is set. */
  async function init() {
    const feedback = document.getElementById("feedbackButton");
    // Feedback is for players of the browser version, not the self-hosted dashboard.
    if (feedback && FORM.action && globalThis.hkiaBrowser) {
      feedback.addEventListener("click", () => openFeedback());
      feedback.hidden = false;
    }
    const news = document.getElementById("whatsNew");
    if (!news) return;
    try {
      const response = await fetch("CHANGELOG.md", {cache: "no-cache"});
      if (!response.ok) throw new Error();
      days = parseChangelog(await response.text());
      newsDays = whatsNewDays(days);
    } catch (_) {
      return;                                       // not served here: no What's new
    }
    if (!newsDays.length) return;
    if (unseen(newsDays, readSeen()).length) {
      news.insertAdjacentHTML("beforeend", '<span class="whats-new-dot" aria-label="(new updates)"></span>');
    }
    news.addEventListener("click", openWhatsNew);
    news.hidden = false;
  }
  return {init, openWhatsNew, openFeedback, parseChangelog, whatsNewDays, changelogHtml, unseen, formBody, FORM};
});
