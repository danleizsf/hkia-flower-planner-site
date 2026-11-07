/* Forecast tab: the FLOW forecast of the next 60 days from today's farm.
 *
 * Reads /api/flow/roadmap; "Run the forecast" explains what it does and how
 * long it takes, then posts /api/flow/forecast. On the desktop it runs as a
 * background process; in the browser version in a second worker in this tab
 * (browser/forecast_worker.js), so the tab must stay open.
 */
(function (root) {
  const METHOD = {
    pattern_transfer: "Pattern transfer",
    color_transfer: "Color transfer",
    color_mix: "Color mix",
    fertilize_pattern: "Fertilize",
  };
  const POLL_MS = 10000;
  const HORIZON_DAYS = 60;   // hkia_solver/flow/forecast.py FORECAST_DAYS
  let timer = null;
  let lastView = null;
  let showAll = false;

  const $ = selector => document.querySelector(selector);
  const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]));
  const viewActive = () => $("#roadmapView")?.classList.contains("active");

  function fmtDate(iso) {
    if (!iso) return "—";
    const d = new Date(iso + "T12:00:00");
    return d.toLocaleDateString(undefined, {year: "numeric", month: "short", day: "numeric"});
  }
  function monthLabel(iso) {
    const d = new Date(iso + "T12:00:00");
    return d.toLocaleDateString(undefined, {year: "numeric", month: "long"});
  }
  function fromNow(iso) {
    if (!iso) return "";
    const days = Math.round((new Date(iso + "T12:00:00") - new Date()) / 86400000);
    if (days <= 0) return "now";
    if (days < 60) return `in ${days} days`;
    if (days < 730) return `in ${Math.round(days / 30.4)} months`;
    return `in ${(days / 365.25).toFixed(1)} years`;
  }

  // An older dashboard server answers unknown routes with an HTML 404 page.
  async function readJson(response) {
    const text = await response.text();
    try {
      return JSON.parse(text);
    } catch (_) {
      throw new Error(response.status === 404
        ? "The dashboard server is running older code without the Roadmap. Restart the dashboard to load it."
        : `The dashboard answered with an unexpected response (HTTP ${response.status}).`);
    }
  }

  async function load() {
    clearTimeout(timer);
    const host = $("#roadmapRoot");
    if (!host) return;
    if (!lastView) host.innerHTML = `<p class="help-text">Loading the forecast…</p>`;
    try {
      const response = await fetch("/api/flow/roadmap", {cache: "no-store"});
      const data = await readJson(response);
      if (!response.ok) throw new Error(data.error || "The forecast could not be loaded.");
      lastView = data;
      render(data);
      if (data.running && viewActive()) timer = setTimeout(load, POLL_MS);
    } catch (error) {
      host.innerHTML = `<p class="help-text">${esc(error.message)}</p>`;
    }
  }

  const inBrowser = () => Boolean(root.hkiaBrowser);

  // What the forecast does, how long it takes and (browser) that the tab must stay open.
  function explainerHtml(browser) {
    return `<h2>Run the forecast?</h2>
      <p class="lead">It plays your planner forward day by day for the next ${HORIZON_DAYS} days, rolling the dice for every target each day like the game does, to guess:</p>
      <ul class="forecast-explainer">
        <li>which flowers you'll likely get, and roughly when,</li>
        <li>when you'll reach your preliminary target, if that's within ${HORIZON_DAYS} days,</li>
        <li>and which event windows matter for your flowers.</li>
      </ul>
      <p>It uses your island as it is now (your unlocked patches and Greenhouse) and doesn't assume you'll unlock or
        upgrade anything.</p>
      <p><strong>How long:</strong> roughly 5 to 15 minutes on a fast computer. It depends on how many new
        flowers are within reach, not on the size of your collection${browser ? ", and a browser is a few times slower, more so on a phone" : ""}.</p>
      <p>${browser
        ? "<strong>Keep this tab open until it finishes.</strong> You can switch to other tabs and keep using the planner; closing or reloading this tab stops the forecast."
        : "It runs in the background on this computer, so you can keep using the planner or close the page."}</p>
      <p class="fine">It's a guess: the order of things is more reliable than the exact dates.</p>
      <div class="onboarding-actions">
        <button type="button" class="button secondary" data-no>Not now</button>
        <button type="button" class="button primary" data-yes>Start the forecast</button>
      </div>`;
  }

  function confirmFull() {
    return Promise.resolve(window.confirm(
      "Full forecast (to the end of your collection)\n\n" +
      "This uses the older, simpler simulator instead of your real planner. It looks all the way to the finish, " +
      "but it is much rougher: dates past a few months are very uncertain, and it does not plan your actual plots. " +
      "It replaces the current forecast until you run the normal one again." +
      (inBrowser() ? "\n\nIt can take a long time in a browser; keep this tab open." : "")));
  }

  // How far to trust the numbers: the planner forecast has run well behind real farms.
  function disclaimerHtml(v) {
    const notes = [];
    if (v.engine === "full") {
      notes.push("<strong>Full forecast:</strong> the older, simpler simulator, run to the end of your collection. Treat far-off dates as a rough order, not a schedule.");
    } else {
      notes.push("<strong>Leans conservative:</strong> on real farms people have found new flowers about 3× faster than this forecast predicts. How fast you go also depends on how often you check and replant.");
    }
    if (v.settings?.outdoor_model === "wiki_fillers") {
      notes.push("<strong>Fillers on:</strong> counted optimistically, as if every free cell next to an outdoor spawn cell held a fertilized filler.");
    }
    return `<div class="warning-box forecast-disclaimer">${notes.map(n => `<p>${n}</p>`).join("")}</div>`;
  }

  function confirmStart() {
    return new Promise(resolve => {
      const dialog = document.createElement("dialog");
      dialog.className = "areas-dialog forecast-dialog";
      dialog.innerHTML = explainerHtml(inBrowser());
      document.body.appendChild(dialog);
      const done = answer => { dialog.close(); dialog.remove(); resolve(answer); };
      dialog.addEventListener("cancel", () => done(false));
      dialog.querySelector("[data-no]").addEventListener("click", () => done(false));
      dialog.querySelector("[data-yes]").addEventListener("click", () => done(true));
      dialog.showModal();
    });
  }

  async function update(full = false) {
    if (!(await (full ? confirmFull() : confirmStart()))) return;
    const button = $("#roadmapUpdate");
    if (button) button.disabled = true;
    try {
      const response = await fetch("/api/flow/forecast", {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({full})});
      const data = await readJson(response);
      if (!response.ok) throw new Error(data.error || "The forecast could not start.");
      lastView = data;
      render(data);
      timer = setTimeout(load, POLL_MS);
    } catch (error) {
      if (typeof root.toast === "function") root.toast(error.message, true);
      if (button) button.disabled = false;
    }
  }

  function statusLine(v) {
    const keepOpen = inBrowser() ? " <strong>Keep this tab open until it finishes.</strong>" : "";
    if (v.running && v.showing_previous) {
      const progress = v.progress ? ` The new one has simulated through ${fmtDate(v.progress.simulated_through)} so far.` : "";
      return `<p class="roadmap-status running"><span class="status partial_update">Forecasting</span> Showing the forecast from ${fmtDate(v.as_of)} while a new one runs.${progress}${keepOpen}</p>`;
    }
    if (v.running) {
      const through = v.available ? ` Simulated through ${fmtDate(v.simulated_through)} so far.` : "";
      return `<p class="roadmap-status running"><span class="status partial_update">Forecasting</span> It fills in as it goes.${through}${keepOpen}</p>`;
    }
    if (v.stale) {
      return `<p class="roadmap-status"><span class="status plan_changed">Out of date</span> Your flowers or settings changed since this forecast was made. Run it again when convenient.</p>`;
    }
    const done = v.status === "complete" ? "Complete" : v.horizon_days ? `Next ${v.horizon_days} days` : "Partial";
    return `<p class="roadmap-status"><span class="status keep">${done}</span> Forecast from ${fmtDate(v.as_of)}, simulated through ${fmtDate(v.simulated_through)}.</p>`;
  }

  // The island the forecast planned with: it never assumes unlocks or upgrades.
  function islandNote(island) {
    if (!island) return "";
    // Extreme Gardening is a Greenhouse upgrade: named only for a farm with a Greenhouse.
    const greenhouse = !island.greenhouse ? "no Greenhouse"
      : `a ${esc(island.greenhouse)} Greenhouse${island.extreme_gardening ? " with Extreme Gardening" : ""}`;
    return `<p class="help-text">Planned with your island as it is: ${island.outdoor_plots} flower patches and ${greenhouse}.
      It doesn't assume you'll unlock more areas or upgrade the Greenhouse; change them with Areas on the Farm map
      and run it again.</p>`;
  }

  function milestone(label, m, detail, horizon) {
    const date = m?.date;
    const beyond = horizon ? `Not within ${horizon} days` : "Beyond the forecast so far";
    return `<article class="summary-card roadmap-milestone">
      <p>${esc(label)}</p>
      <strong>${date ? esc(fmtDate(date)) : "Not yet"}</strong>
      <small>${date ? esc(fromNow(date)) : beyond}${detail ? " · " + esc(detail) : ""}</small>
    </article>`;
  }

  function upcomingTable(rows, span) {
    if (!rows.length) return `<p class="help-text">No targets are forecast in the ${esc(span)} yet.</p>`;
    const visible = showAll ? rows : rows.slice(0, 120);
    let month = "";
    const body = visible.map(r => {
      const head = monthLabel(r.date) !== month ? `<tr class="roadmap-month"><th colspan="4">${esc(month = monthLabel(r.date))}</th></tr>` : "";
      const where = r.slot === "GH" ? "Greenhouse" : r.plot ? `${r.plot}` : (r.region || "Fertilizer bed");
      const parents = (r.parents || []).join(" + ");
      return `${head}<tr class="${r.phase === "secondary" ? "roadmap-secondary" : ""}">
        <td class="number-cell">${esc(fmtDate(r.date))}</td>
        <td><strong>${esc(r.target)}</strong>${r.phase === "secondary" ? `<span class="variant-meta">Secondary target</span>` : ""}</td>
        <td>${esc(where)}<span class="variant-meta">${esc(r.region || "")}</span></td>
        <td>${esc(METHOD[r.method] || r.method)}<span class="variant-meta">${esc(parents)}</span></td>
      </tr>`;
    }).join("");
    const more = rows.length > visible.length
      ? `<button class="button secondary small" id="roadmapShowAll" type="button">Show all ${rows.length}</button>` : "";
    return `<div class="table-wrap"><table class="inventory-table roadmap-table">
      <thead><tr><th>Expected</th><th>Target</th><th>Where</th><th>How</th></tr></thead>
      <tbody>${body}</tbody></table></div>${more}`;
  }

  function eventsTable(events, through) {
    if (!events.length) return `<p class="help-text">No event windows in the next 15 months.</p>`;
    const rows = events.map(e => {
      let what;
      if (e.unlocks_blocked && !e.forecast_targets) {
        what = `<strong>Get ${esc(e.flower_type)}.</strong> You have none, and it unlocks ${e.unlocks_blocked.toLocaleString()} blocked targets.`;
      } else if (through && e.start > through) {
        what = `After the forecast window: run it again closer to the date to see what to plant.`;
      } else if (e.forecast_targets) {
        what = `Swing outdoor plots to ${esc(e.flower_type)}: ${e.forecast_targets} targets forecast in this window.<span class="variant-meta">${esc(e.examples.join(", "))}${e.forecast_targets > e.examples.length ? ", …" : ""}</span>`;
      } else {
        what = `Nothing forecast for ${esc(e.flower_type)} in this window.`;
      }
      return `<tr><td><strong>${esc(e.event)}</strong></td><td class="number-cell">${esc(fmtDate(e.start))} – ${esc(fmtDate(e.end))}</td><td>${what}</td></tr>`;
    }).join("");
    return `<div class="table-wrap"><table class="inventory-table roadmap-table">
      <thead><tr><th>Event</th><th>Dates</th><th>What to do</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }

  function render(v) {
    const host = $("#roadmapRoot");
    if (!host) return;
    const label = v.running ? "Forecasting…" : v.available ? "Run it again" : "Run the forecast";
    const button = `<button class="button primary" id="roadmapUpdate" type="button"${v.running ? " disabled" : ""}>${label}</button>`
      + `<button class="button secondary" id="roadmapFull" type="button"${v.running ? " disabled" : ""} title="Older simulator, to the end of your collection: rougher">Full forecast…</button>`;
    const heading = `<div class="section-heading"><div><p class="eyebrow">A rough guess at what's ahead</p><h2>Forecast</h2></div><div class="filters">${button}</div></div>`;
    if (!v.available) {
      host.innerHTML = heading + statusLine(v) + (v.running ? "" : `<p class="help-text">No forecast yet. It plays your planner forward ${HORIZON_DAYS} days, rolling the dice like the game does, to guess what's coming up. It takes several minutes${inBrowser() ? ", and this tab has to stay open" : " (it runs in the background)"}; press Run the forecast to see the details first.</p>`);
      bind();
      return;
    }
    const c = v.counts || {}, m = v.milestones || {};
    const horizon = v.horizon_days;
    const span = horizon ? `next ${horizon} days` : "next 12 months";
    const through = horizon && !v.running ? v.simulated_through : null;
    // Only with a full 10 × 10 Greenhouse (the Extreme upgrade comes after the five size upgrades).
    const level = v.island?.greenhouse_level ?? 6;
    const extreme = m.extreme_gardening?.status === "unlocked"
      ? `<article class="summary-card roadmap-milestone"><p>Extreme Gardening</p><strong>Unlocked</strong><small>Your Greenhouse is 10 × 11</small></article>`
      : level >= 6 ? milestone("Extreme Gardening requirement", m.extreme_gardening,
                               "14 solid colors of each extremophile; the upgrade itself isn't assumed", horizon)
      : "";
    host.innerHTML = heading + statusLine(v) + disclaimerHtml(v) + islandNote(v.island) + `
      <section class="summary-grid roadmap-milestones">
        ${extreme}
        ${milestone("Preliminary target", m.preliminary, `${(c.preliminary ?? 0).toLocaleString()} flowers`, horizon)}
        ${milestone("Everything viable", m.everything, `${((c.preliminary ?? 0) + (c.secondary ?? 0)).toLocaleString()} flowers`, horizon)}
      </section>
      <section class="target-section">
        <div class="target-section-head"><div><p class="eyebrow">${esc(span[0].toUpperCase() + span.slice(1))}</p><h3>Up next</h3></div>
          <p class="table-note">${v.upcoming.length.toLocaleString()} targets expected</p></div>
        ${upcomingTable(v.upcoming, span)}
      </section>
      <section class="target-section">
        <div class="target-section-head"><div><p class="eyebrow">Seasonal flowers</p><h3>Event calendar</h3></div></div>
        ${eventsTable(v.events || [], through)}
      </section>
      <p class="help-text">This is one likely run of luck: the total is a fair estimate, but any single flower could come sooner or later. The plan for today is always the Farm map.</p>`;
    bind();
  }

  function bind() {
    $("#roadmapUpdate")?.addEventListener("click", () => update(false));
    $("#roadmapFull")?.addEventListener("click", () => update(true));
    $("#roadmapShowAll")?.addEventListener("click", () => { showAll = true; render(lastView); });
  }

  // The browser version's forecast worker finished or stopped.
  root.addEventListener?.("hkia-forecast-done", event => {
    if (event.detail?.error && typeof root.toast === "function") root.toast(`The forecast stopped: ${event.detail.error}`, true);
    else if (typeof root.toast === "function") root.toast("The forecast is ready (Forecast tab).");
    load();
  });

  root.HKIARoadmap = {load, explainerHtml};
})(typeof globalThis !== "undefined" ? globalThis : this);
