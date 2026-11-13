const app = {
  state: null,
  selectedPlot: null,
  spawnBasket: new Map(),
  spawnExpandedGroups: new Set(),
  editingPlot: null,
  editCells: new Map(),
  editTool: "paint",
  planAbortController: null,
  targetPreview: null,
  targetDialogMode: "recommendation",
  targetEditAction: "add",
  targetEditJobId: null,
  toastTimer: null,
  mapDrag: null,
  suppressCardClickUntil: 0,
  inventoryPage: 1,
  inventoryPageSize: 100,
  inventorySubView: "stock",
  collectionPattern: "Solid",
  collectionScope: "standard",
  collectionSecondary: "White",
  historyPage: 1,
  historyPageSize: 25,
  historyCategory: "all",
  historyChartRows: [],
  newFlowers: null,
  newFlowersRevision: null,
  activeView: "farm",
  stateRevision: 0,
  inventoryStateDirty: false,
  inventorySyncTimer: null,
  inventorySyncRunning: false,
  inventorySaving: false,
  expandedTargetLists: new Set(),
  targetListFilters: new Map(),  // foldKey -> {query, pattern, status}: drawer target-list filters, kept across re-renders
  recommendationOpen: new Map(),
  plotChecks: new Set(),
  plotCheckPending: new Map(),  // slot -> the tap still waiting for its reply
  pointerOnCardControl: false,
  plotCheckResetTimer: null,
  openedCheckedRegions: new Set(),
  checkedRegionsKey: "",
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: {"Content-Type": "application/json"},
    ...options,
  });
  // An empty reply means the server stopped mid-request (e.g. restarting after a code update).
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); }
  catch { throw new Error("The dashboard server didn't answer; it may be restarting. Wait a minute and try again."); }
  if (!response.ok) throw new Error(data.error || "Request failed");
  return data;
}

function loading(show, text = "Updating farm…", cancellable = false) {
  $("#loadingText").textContent = text;
  $("#loading").classList.toggle("hidden", !show);
  $("#cancelPlan").classList.toggle("hidden", !show || !cancellable);
  $("#cancelPlan").disabled = false;
}

function toast(message, error = false) {
  const node = $("#toast");
  node.textContent = message;
  node.classList.toggle("error", error);
  node.classList.add("show");
  clearTimeout(app.toastTimer);
  app.toastTimer = setTimeout(() => node.classList.remove("show"), 3200);
}

async function refreshState(showLoader = true) {
  if (showLoader) loading(true, "Loading farm state…");
  try {
    const revision = ++app.stateRevision;
    // The farm first; its inventory (most of the state's size and build time) follows in the
    // background, and until it arrives the last loaded inventory stays in use.
    const state = await api("/api/state/core");
    if (revision !== app.stateRevision) return;
    state.inventory = app.state?.inventory || [];
    app.state = state;
    app.inventoryStateDirty = false;
    app.inventoryPromise = loadInventory(revision);
    populateFilters();
    renderSummary();
    renderReservationWarnings();
    renderPlots();
    renderTargets();
    renderInventory();
    renderCollectionChecklist();
    renderHistory();
    if (app.selectedPlot) openPlot(app.selectedPlot.slot, false);
    // Getting-started checklist and the first-visit map hint (farms set up through onboarding only).
    HKIAOnboarding.refreshGuide().then(() => HKIAOnboarding.hint("map", $(".legend")));
    HKIAEventBanner.refresh();
  } catch (error) {
    toast(error.message, true);
  } finally {
    if (showLoader) loading(false);
  }
}

async function loadInventory(revision) {
  try {
    const {inventory} = await api("/api/inventory");
    if (revision !== app.stateRevision || !app.state) return;
    app.state.inventory = inventory;
    app.inventoryLoaded = true;
    renderInventory();
    renderCollectionChecklist();
    if (app.selectedPlot) openPlot(app.selectedPlot.slot, false);   // its planting guide counts copies
  } catch (error) {
    toast(`Your inventory couldn't load: ${error.message}`, true);
  }
}

function populateSelect(node, values, preserve = true) {
  const previous = preserve ? node.value : "";
  const first = node.querySelector("option")?.outerHTML || "";
  node.innerHTML = first + values.map(value => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join("");
  if ([...node.options].some(option => option.value === previous)) node.value = previous;
}

function populateFilters() {
  populateSelect($("#regionFilter"), app.state.options.regions);
  populateStatusFilter();
  populateSelect($("#inventoryType"), app.state.options.flower_types);
  populateSelect($("#inventoryPattern"), app.state.options.patterns);
  fillEditSelect($("#editFlower"), app.state.options.flower_types);
  fillEditSelect($("#editColor"), app.state.options.colors);
  fillEditSelect($("#editPattern"), app.state.options.patterns);
  refreshInventorySecondarySelector();
  fillEditSelect($("#targetFlower"), app.state.options.target_flower_types);
  fillEditSelect($("#targetColor"), app.state.options.target_colors);
  fillEditSelect($("#targetPatternEdit"), app.state.options.target_patterns);
  populateSelect($("#targetPattern"), app.state.options.target_patterns);
}

function fillEditSelect(node, values) {
  const previous = node.value;
  node.innerHTML = values.map(value => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join("");
  if (values.includes(previous)) node.value = previous;
}

// The Plot map's Fillers button and legend entry follow the saved setting.
function renderFillerSetting() {
  const on = Boolean(app.state?.summary?.fillers);
  $("#fillersButton").textContent = `Fillers: ${on ? "On" : "Off"}`;
  $("#fillersButton").setAttribute("aria-pressed", String(on));
  $("#fillerLegend").hidden = !on;
}

function renderSummary() {
  const summary = app.state.summary;
  renderFillerSetting();
  const cards = [
    ["Collection", `${summary.owned_targets}/${summary.total_targets}`, `${summary.missing_targets} missing`],
    ["Recorded plots", summary.recorded_slots, `${summary.reserved_copies} parent copies reserved`],
    ["Keep in place", summary.keep_slots || 0, `${(summary.goal_reached_slots || 0) + (summary.partial_update_slots || 0) + (summary.review_slots || 0)} plot${((summary.goal_reached_slots || 0) + (summary.partial_update_slots || 0) + (summary.review_slots || 0)) === 1 ? "" : "s"} need attention`],
  ];
  $("#summaryGrid").innerHTML = cards.map(([label, value, note]) => `
    <article class="summary-card"><p>${label}</p><strong>${value}</strong><small>${note}</small></article>
  `).join("");
}

function renderReservationWarnings() {
  const node = $("#reservationWarnings");
  const warnings = app.state.reservation_warnings || [];
  node.classList.toggle("hidden", warnings.length === 0);
  if (!warnings.length) {
    node.innerHTML = "";
    return;
  }
  node.innerHTML = `
    <div class="reservation-warning-head">
      <div><strong>Farm inventory mismatch</strong><span>The planted farm state was saved. These totals need review, but they no longer block plot updates.</span></div>
      <span class="status plan_changed">${warnings.length} warning${warnings.length === 1 ? "" : "s"}</span>
    </div>
    <div class="reservation-warning-list">${warnings.map(item => `
      <div><strong>${escapeHtml(item.flower)}</strong>: ${item.planted} planted, ${item.inventory} recorded in inventory
        <span class="warning-sources">${item.plots.map(source => `<button type="button" class="warning-slot" data-slot="${escapeHtml(source.slot)}">${escapeHtml(source.slot)} × ${source.count}</button>`).join("")}</span>
      </div>`).join("")}
    </div>`;
  $$(".warning-slot").forEach(button => button.addEventListener("click", () => openPlot(button.dataset.slot)));
}

function renderHistory() {
  hideHistoryTooltip();
  const history = app.state.history || {daily: [], events: []};
  const timeline = HistoryView.chartTimeline(history.daily || [], Number($("#historyRange").value || 30));
  const daily = timeline.rows;
  app.historyChartRows = daily;
  const events = history.events || [];
  const current = history.current || {};
  const latest = events[0];
  const latestTime = latest ? HistoryView.formatTimestamp(latest.timestamp) : null;
  const summary = [
    ["Goals collected", current.acquired ?? app.state.summary.owned_targets ?? 0, "current farm state"],
    ["Flowers in progress", current.breeding_flowers ?? 0, "unique targets being worked on"],
    ["Active jobs", current.breeding ?? 0, "one per plot working on a flower"],
    ["Blocked goals", current.blocked ?? 0, "currently unreachable"],
    ["Last update", latestTime?.date || "No changes", latest ? `${HistoryView.actionLabel(latest)} · ${latestTime.time}` : "The journal is ready"],
  ];
  $("#historySummary").innerHTML = summary.map(([label, value, note]) => `
    <article class="history-stat"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong><small>${escapeHtml(note)}</small></article>
  `).join("");
  let chartNote;
  if (!events.length) {
    chartNote = "No earlier updates are saved yet; this chart starts with the current farm state.";
  } else if (timeline.firstAvailableDate && timeline.firstAvailableDate > timeline.startDate) {
    const firstAvailableMs = Date.parse(`${timeline.firstAvailableDate}T00:00:00Z`);
    const availableDays = Math.floor((timeline.endMs - firstAvailableMs) / (24 * 60 * 60 * 1000)) + 1;
    chartNote = `${timeline.days}-day view · saved values cover ${availableDays} day${availableDays === 1 ? "" : "s"} since ${HistoryView.formatChartDate(timeline.firstAvailableDate)}; earlier values aren't recorded.`;
  } else {
    chartNote = `Latest ${timeline.days} days · quiet days carry forward the previous saved state.`;
  }
  $("#historyChartNote").textContent = chartNote;

  renderHistoryChart(timeline);
  if (app.activeView === "history") loadNewFlowers();
  renderNewFlowers(timeline.days);

  $$(".history-filter").forEach(button => {
    const active = button.dataset.historyCategory === app.historyCategory;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  const filtered = HistoryView.filterEvents(events, app.historyCategory, $("#historySearch").value);
  const pageCount = Math.max(1, Math.ceil(filtered.length / app.historyPageSize));
  app.historyPage = Math.min(Math.max(1, app.historyPage), pageCount);
  const startIndex = (app.historyPage - 1) * app.historyPageSize;
  const pageEvents = filtered.slice(startIndex, startIndex + app.historyPageSize);
  $("#historyBody").innerHTML = pageEvents.map(event => {
    const description = HistoryView.describeEvent(event);
    const time = HistoryView.formatTimestamp(event.timestamp);
    const snapshots = description.snapshots;
    const snapshotStatus = snapshots
      ? `<span class="history-snapshot" title="${snapshots} retained pre-change file${snapshots === 1 ? "" : "s"} saved">${snapshots} saved</span>`
      : description.unavailableSnapshots
        ? `<span class="history-snapshot-unavailable" title="${description.unavailableSnapshots} older backup reference${description.unavailableSnapshots === 1 ? "" : "s"} no longer has a snapshot file">Unavailable</span>`
        : `<span class="history-no-snapshot">—</span>`;
    return `<tr>
      <td><time class="history-time" datetime="${escapeHtml(event.timestamp || "")}" title="${escapeHtml(time.full)}">${escapeHtml(time.date)}<small>${escapeHtml(time.time)}</small></time></td>
      <td><span class="history-category history-category-${escapeHtml(description.group)}">${escapeHtml(description.category)}</span><strong class="history-action">${escapeHtml(description.action)}</strong></td>
      <td><strong class="history-detail">${escapeHtml(description.summary)}</strong>${description.change ? `<span class="history-change">${escapeHtml(description.change)}</span>` : ""}${description.metrics ? `<small class="history-metrics">${escapeHtml(description.metrics)}</small>` : ""}</td>
      <td>${snapshotStatus}</td>
    </tr>`;
  }).join("") || `<tr><td colspan="4" class="empty-table">${events.length ? "No changes match this filter." : "No updates recorded yet. Existing farm data has not been altered."}</td></tr>`;
  const first = filtered.length ? startIndex + 1 : 0;
  const last = Math.min(startIndex + app.historyPageSize, filtered.length);
  $("#historyCount").textContent = filtered.length
    ? `Showing ${first}–${last} of ${filtered.length} recent update${filtered.length === 1 ? "" : "s"}`
    : `0 updates`;
  $("#historyPageLabel").textContent = `Page ${app.historyPage} of ${pageCount}`;
  $("#historyPrevPage").disabled = app.historyPage <= 1;
  $("#historyNextPage").disabled = app.historyPage >= pageCount;
  $("#historyPagination").classList.toggle("hidden", filtered.length <= app.historyPageSize);
}

// The new-flowers table reads the whole journal, so it has its own endpoint
// (see CLAUDE.md) and loads once per state revision while History is open.
async function loadNewFlowers() {
  const revision = app.stateRevision;
  if (app.newFlowersRevision === revision) return;
  app.newFlowersRevision = revision;
  try {
    const data = await api("/api/history/new-flowers");
    if (revision !== app.stateRevision) return;
    app.newFlowers = data.flowers || [];
    if (app.activeView === "history") renderNewFlowers(Number($("#historyRange").value || 30));
  } catch (error) {
    if (app.newFlowersRevision === revision) app.newFlowersRevision = null;
    if (!app.newFlowers) $("#historyNewFlowersBody").innerHTML = `<tr><td colspan="3" class="empty-table">Couldn't load new flowers: ${escapeHtml(error.message)}</td></tr>`;
  }
}

function renderNewFlowers(days) {
  if (!app.newFlowers) return;
  const groups = HistoryView.groupNewFlowers(app.newFlowers, days);
  const total = groups.reduce((sum, group) => sum + group.flowers.length, 0);
  $("#historyNewFlowersNote").textContent = `${total} new in the last ${days} days · by your local day`;
  $("#historyNewFlowersBody").innerHTML = groups.map(group => `<tr>
      <td class="history-new-day">${escapeHtml(HistoryView.formatChartDateLong(group.date))}</td>
      <td class="history-new-count">${group.flowers.length}</td>
      <td><div class="history-new-list">${group.flowers.map(item => {
        const time = HistoryView.formatTimestamp(item.timestamp).time;
        const source = HistoryView.newFlowerSource(item);
        return `<span class="history-new-flower" title="${escapeHtml(`${time} · ${source}`)}">${escapeHtml(item.flower)}${item.slot ? `<small>${escapeHtml(item.slot)}</small>` : ""}</span>`;
      }).join("")}</div></td>
    </tr>`).join("") || `<tr><td colspan="3" class="empty-table">No new goal flowers in the last ${days} days.</td></tr>`;
}

const historyValueText = (item, missing = "—") =>
  item.value === null ? missing : item.estimated ? `≈${item.value} (estimate)` : String(item.value);

// Line chart of the daily rows. Days saved before a metric existed have no
// value and are skipped.
function renderHistoryChart(timeline) {
  const daily = timeline.rows;
  const series = HistoryView.chartSeries();
  // Days estimated by the server (`<key>_estimated`) are drawn dashed.
  const estimated = (row, key) => Boolean(row[`${key}_estimated`]);
  const note = key => daily.some(row => estimated(row, key)) ? " (dashed: estimate)" : "";
  $("#historyLegend").innerHTML = series.map(item => `<span style="--series-color:${item.color}">${escapeHtml(item.label + note(item.key))}</span>`).join("");
  const width = 900;
  const height = 270;
  const pad = {left: 48, right: 22, top: 22, bottom: 42};
  const hasValue = (row, key) => row[key] != null;
  const values = daily.flatMap(row => series.filter(({key}) => hasValue(row, key)).map(({key}) => Number(row[key])));
  const maximum = Math.max(1, ...values);
  const x = date => pad.left + HistoryView.dayOffset(date, timeline.startDate) * (width - pad.left - pad.right) / Math.max(1, timeline.days - 1);
  const y = value => height - pad.bottom - Number(value || 0) * (height - pad.top - pad.bottom) / maximum;
  const polylines = series.map(({key, color}) => {
    const rows = daily.filter(row => hasValue(row, key));
    const line = (part, dashed) => part.length ? `<polyline points="${part.map(row => `${x(row.date).toFixed(1)},${y(row[key]).toFixed(1)}`).join(" ")}" fill="none" stroke="${color}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"${dashed ? ` stroke-dasharray="6 6" opacity=".75"` : ""}/>` : "";
    // The dashed part runs into the first recorded day so the two join up.
    const firstRecorded = rows.findIndex(row => !estimated(row, key));
    const estimatedPart = firstRecorded === -1 ? rows : rows.slice(0, firstRecorded + 1);
    const recordedPart = firstRecorded === -1 ? [] : rows.slice(firstRecorded);
    return line(estimatedPart.length > 1 ? estimatedPart : [], true) + line(recordedPart, false);
  }).join("");
  const dots = daily.map(row => {
    const tooltipValues = HistoryView.tooltipValues(row);
    const accessibleLabel = `${HistoryView.formatChartDateLong(row.date)}. ${tooltipValues.map(item => `${item.label}: ${historyValueText(item, "not recorded")}`).join(". ")}.`;
    return tooltipValues.filter(item => item.value !== null).map((item, index) => `<circle class="history-point" data-history-date="${escapeHtml(row.date)}" data-history-series="${escapeHtml(item.key)}" cx="${x(row.date)}" cy="${y(item.value)}" r="${item.estimated ? 3.5 : 5}" fill="${item.color}" tabindex="${index === 0 ? "0" : "-1"}" role="img" aria-label="${escapeHtml(accessibleLabel)}" aria-describedby="historyTooltip"><title>${escapeHtml(HistoryView.formatChartDate(row.date))}: ${escapeHtml(item.label)} ${escapeHtml(historyValueText(item))}</title></circle>`).join("");
  }).join("");
  const dateLabels = timeline.ticks.map(date => `<text x="${x(date)}" y="${height - 13}" text-anchor="middle">${escapeHtml(HistoryView.formatChartDate(date))}</text>`).join("");
  $("#historyChart").innerHTML = daily.length ? `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Daily collected goals, flowers in progress, active jobs, and blocked goals"><line x1="${pad.left}" y1="${height-pad.bottom}" x2="${width-pad.right}" y2="${height-pad.bottom}" class="chart-axis"/><line x1="${pad.left}" y1="${pad.top}" x2="${pad.left}" y2="${height-pad.bottom}" class="chart-axis"/><text x="8" y="${pad.top+5}">${maximum}</text><text x="28" y="${height-pad.bottom+5}">0</text>${polylines}${dots}${dateLabels}</svg>` : `<div class="empty-state">Farm changes will appear here after the first inventory or plot update.</div>`;
}

function showHistoryTooltip(point, clientX, clientY) {
  const date = point?.dataset?.historyDate;
  const row = app.historyChartRows.find(item => item.date === date);
  const tooltip = $("#historyTooltip");
  const shell = $("#historyChartShell");
  if (!row || !tooltip || !shell) return;

  const values = HistoryView.tooltipValues(row);
  tooltip.innerHTML = '<strong class="history-tooltip-date">' + escapeHtml(HistoryView.formatChartDateLong(row.date)) + '</strong><ul>' +
    values.map(item => '<li><span class="history-tooltip-label"><i style="--series-color:' + item.color + '"></i>' +
      escapeHtml(item.label) + '</span><strong>' + escapeHtml(historyValueText(item)) + '</strong></li>').join("") + '</ul>';
  tooltip.classList.add("visible");
  tooltip.setAttribute("aria-hidden", "false");

  const shellRect = shell.getBoundingClientRect();
  const margin = 8;
  const gap = 12;
  const anchorX = clientX - shellRect.left;
  const anchorY = clientY - shellRect.top;
  const width = tooltip.offsetWidth;
  const height = tooltip.offsetHeight;
  let left = anchorX + gap;
  if (left + width > shell.clientWidth - margin) left = anchorX - width - gap;
  left = Math.max(margin, Math.min(left, shell.clientWidth - width - margin));
  let top = anchorY + gap;
  if (top + height > shell.clientHeight - margin) top = anchorY - height - gap;
  top = Math.max(margin, Math.min(top, shell.clientHeight - height - margin));
  tooltip.style.left = String(left) + "px";
  tooltip.style.top = String(top) + "px";
}

function hideHistoryTooltip() {
  const tooltip = $("#historyTooltip");
  if (!tooltip) return;
  tooltip.classList.remove("visible");
  tooltip.setAttribute("aria-hidden", "true");
}

function bindHistoryChartTooltip() {
  const chart = $("#historyChart");
  chart.addEventListener("pointerover", event => {
    const point = event.target.closest?.(".history-point");
    if (point) showHistoryTooltip(point, event.clientX, event.clientY);
  });
  chart.addEventListener("pointermove", event => {
    const point = event.target.closest?.(".history-point");
    if (point) showHistoryTooltip(point, event.clientX, event.clientY);
  });
  chart.addEventListener("pointerout", event => {
    const point = event.target.closest?.(".history-point");
    if (!point) return;
    const next = event.relatedTarget?.closest?.(".history-point");
    if (next === point) return;
    if (next) showHistoryTooltip(next, event.clientX, event.clientY);
    else hideHistoryTooltip();
  });
  chart.addEventListener("focusin", event => {
    const point = event.target.closest?.(".history-point");
    if (!point) return;
    const rect = point.getBoundingClientRect();
    showHistoryTooltip(point, rect.left + rect.width / 2, rect.top + rect.height / 2);
  });
  chart.addEventListener("focusout", event => {
    if (!event.target.closest?.(".history-point")) return;
    if (!event.relatedTarget?.closest?.(".history-point")) hideHistoryTooltip();
  });
  chart.addEventListener("scroll", hideHistoryTooltip, {passive: true});
  window.addEventListener("resize", hideHistoryTooltip);
}

// Card label and Status filter wording, in filter order.
const PLOT_STATUSES = [
  ["keep", "No action", "No action"],
  ["dig_up", "Dig up", "Dig up only"],
  ["partial_update", "Partial update", "Partial update"],
  ["new_work", "Plant", "New work to plant"],
  ["goal_reached", "Goal reached", "Goal reached"],
  ["already_complete", "Already complete", "Already complete"],
  ["review", "Review", "Review"],
  ["manual", "Manual", "Manual layout"],
  ["no_work", "No work", "No work"],
];

function plotStatus(plot) {
  let state = plot.action_state || "no_work";
  // A partial update that plants nothing only has plants to dig up.
  if (state === "partial_update") {
    const guide = window.HKIAPlantingGuide;
    if (!guide.cellsToPlant(plot.recommended_cells, plot.actual_cells).length
        && guide.cellsToRemove(plot.recommended_cells, plot.actual_cells).length) state = "dig_up";
  }
  const status = PLOT_STATUSES.find(([code]) => code === state) || PLOT_STATUSES.at(-1);
  return [status[0], status[1]];
}

// The Status filter lists only statuses some plot has now, with counts.
function populateStatusFilter() {
  const select = $("#statusFilter");
  const previous = select.value;
  const counts = new Map();
  for (const plot of app.state.plots) {
    const [code] = plotStatus(plot);
    counts.set(code, (counts.get(code) || 0) + 1);
  }
  const present = PLOT_STATUSES.filter(([code]) => counts.has(code));
  select.innerHTML = `<option value="">All statuses</option>` + present
    .map(([code, , label]) => `<option value="${code}">${escapeHtml(label)} (${counts.get(code)})</option>`).join("");
  select.value = counts.has(previous) ? previous : "";
}

function renderPlots() {
  const plantedCount = app.state.plots.filter(plot => plot.actual_state !== "unplanted").length;
  const clearAllButton = $("#clearAllPlots");
  if (clearAllButton) {
    clearAllButton.disabled = plantedCount === 0;
    clearAllButton.title = plantedCount
      ? `Clear all ${plantedCount} recorded Actual planted layout${plantedCount === 1 ? "" : "s"}`
      : "No Actual planted layouts are recorded";
  }
  const region = $("#regionFilter").value;
  const status = $("#statusFilter").value;
  const query = $("#plotSearch").value.trim().toLowerCase();
  const filtered = app.state.plots.filter(plot => {
    const [code] = plotStatus(plot);
    const jobTargets = [...(plot.actual_jobs || []), ...(plot.recommended_jobs || [])].map(job => job.target);
    const plantedFlowers = (plot.actual_cells || []).flatMap(cell => [
      flowerVariantLabel(cell), cell.flower_type, cell.color, cell.pattern, cell.secondary_color,
    ]);
    const text = [plot.slot, plot.name, plot.location, plot.region, ...jobTargets, ...plantedFlowers].filter(Boolean).join(" ").toLowerCase();
    return (!region || plot.region === region) && (!status || code === status) && (!query || text.includes(query));
  });
  // Plots the farm hasn't unlocked show greyed in their place (not while filtering by status or search).
  const locked = !status && !query ? (app.state.locked_plots || []).filter(plot => !region || plot.region === region) : [];
  const regions = app.state.options.regions.filter(name =>
    filtered.some(plot => plot.region === name) || locked.some(plot => plot.region === name));
  const container = $("#plotRegions");
  if (!filtered.length && !locked.length) {
    container.innerHTML = `<div class="empty-state">No plots match these filters.</div>`;
    return;
  }
  container.innerHTML = regions.map(name => {
    const plots = filtered.filter(plot => plot.region === name);
    const lockedHere = locked.filter(plot => plot.region === name);
    const regionMap = app.state.options.region_maps[name] || {};
    const allChecked = regionAllChecked(name);
    // A region whose plots are all checked today folds away on its own (not saved).
    const autoCollapsed = !regionMap.collapsed && allChecked && !app.openedCheckedRegions.has(name);
    const collapsed = Boolean(regionMap.collapsed) || autoCollapsed;
    const cardsPerRow = Number(regionMap.cards_per_row || 3) === 4 ? 4 : 3;
    const isGreenhouse = name === "Greenhouse";
    const greenhouse = isGreenhouse ? HKIAGreenhouseOverview.buildSharedLayout(plots) : null;
    const mapRows = isGreenhouse ? 1 : Number(regionMap.map_rows || 1);
    return `<section class="region-section${collapsed ? " collapsed" : ""}" data-region="${escapeHtml(name)}">
      <div class="region-heading">
        <div><p class="region-travel">${escapeHtml(regionMap.travel_label || "")}</p><h3>${escapeHtml(name)} <span class="region-count">${isGreenhouse ? `1 shared ${greenhouse.rows} × ${greenhouse.cols} plot` : [plots.length || !lockedHere.length ? `${plots.length} slot${plots.length === 1 ? "" : "s"}` : "", lockedHere.length ? `${lockedHere.length} locked` : ""].filter(Boolean).join(" · ")}</span>${allChecked ? `<span class="region-checked">All checked ✓</span>` : ""}</h3></div>
        <div class="region-heading-actions">
          <p class="region-hint">${escapeHtml(regionMap.location_hint || "")}</p>
          ${isGreenhouse ? "" : `<button type="button" class="button small secondary region-density" data-region="${escapeHtml(name)}" data-columns="${cardsPerRow}" title="Reflow this region's unlocked map cards">${cardsPerRow === 3 ? "Fit 4 across" : "Use 3 across"}</button>`}
          <button type="button" class="button small secondary region-collapse" data-region="${escapeHtml(name)}" data-collapsed="${collapsed}" data-auto="${autoCollapsed}" aria-expanded="${!collapsed}">${collapsed ? "Expand" : "Collapse"}</button>
        </div>
      </div>
      <div class="region-map${isGreenhouse ? " greenhouse-map" : ""}" data-region="${escapeHtml(name)}" data-rows="${mapRows}" style="--map-rows:${mapRows}">
        <span class="map-north" aria-hidden="true">N ↑</span>
        ${isGreenhouse ? greenhouseCard(greenhouse, plots) : plots.map(plotCard).join("") + lockedHere.map(lockedPlotCard).join("")}
        <span class="map-drop-indicator" aria-hidden="true"></span>
      </div>
    </section>`;
  }).join("");
  // When the check marks change which regions fold, applyPlotChecks redraws the
  // map itself and binds that copy; binding again here would make every ✓
  // toggle twice per tap (checked, then straight back off).
  if (!applyPlotChecks()) bindPlotMapInteractions();
}

function greenhouseCard(layout, plots) {
  const jobs = layout.jobs;
  const activeActual = plots.filter(plot => plot.actual_state !== "unplanted").length;
  const status = activeActual ? "Actual + recommendations" : (jobs.length ? "Recommendations" : "No active targets");
  const targets = jobs.length
    ? jobs.map(job => escapeHtml(job.target)).join(" · ")
    : "No current greenhouse target assignments";
  const bySlot = new Map(plots.map(plot => [plot.slot, plot]));
  const jobLinks = [...bySlot.values()].filter(plot =>
    jobs.some(job => job.slot === plot.slot) || plot.actual_cells?.length
  ).map(plot => {
    const slotJobs = jobs.filter(job => job.slot === plot.slot);
    const label = slotJobs.length
      ? slotJobs.map(job => escapeHtml(job.target)).join(" · ")
      : "No target assigned";
    return `<div class="greenhouse-job-row"><span class="greenhouse-job-target">${label}</span><button type="button" class="button small secondary" data-gh-open-slot="${escapeHtml(plot.slot)}" aria-label="Edit greenhouse targets: ${escapeHtml(label)}">Edit</button></div>`;
  }).join("");
  const emptySlot = app.state.plots.find(plot => plot.region === "Greenhouse"
    && plot.actual_state === "unplanted"
    && !(plot.recommended_jobs?.length || plot.recommended));
  const conflictNote = layout.conflicts.length
    ? `<p class="greenhouse-conflict-note">${layout.conflicts.length} overlapping cell assignment${layout.conflicts.length === 1 ? "" : "s"} need review; marked !.</p>`
    : "";
  return `<article class="plot-card greenhouse-overview-card" data-overview="greenhouse" data-region="Greenhouse" aria-label="Greenhouse shared planting layout">
    <div class="plot-card-head">
      <div><div class="plot-code">Greenhouse</div><div class="plot-name">One shared ${layout.rows} × ${layout.cols} planting area</div><div class="plot-location">All assignments use this shared coordinate grid</div></div>
      <div class="plot-card-tools">${plotCheckButton("GH")}<span class="status ${activeActual ? "keep" : jobs.length ? "new_work" : "no_work"}">${escapeHtml(status)}</span></div>
    </div>
    <div class="plot-target">${jobs.length} active target${jobs.length === 1 ? "" : "s"}<small>${targets}</small></div>
    <div class="greenhouse-overview-layout">
      <div class="greenhouse-map-wrap">${matrixHtml(layout.grid, layout.cols, true, null, layout.cellGrid, HKIAJobTags.jobTags(layout.jobs).cells)}<div class="greenhouse-map-key"><span><i class="cell-key parent-a">A</i> Parent role A</span><span><i class="cell-key parent-b">B</i> Parent role B</span><span><i class="cell-key target">·</i> Spawn cell</span><span><i class="cell-key gh-buffer"></i> Open greenhouse cell</span></div>${conflictNote}</div>
      <div class="greenhouse-job-list"><h4>Targets in this shared plot</h4>${jobLinks || `<p class="greenhouse-no-jobs">No current target assignments.</p>`}${emptySlot ? `<button type="button" class="button small primary greenhouse-add-target" data-gh-open-slot="${escapeHtml(emptySlot.slot)}">Add a greenhouse target</button>` : ""}<p class="greenhouse-edit-note">Edit opens that target’s controls. The matrix above shows the entire greenhouse in one layout.</p></div>
    </div>
  </article>`;
}

// Daily "checked" marks: shared by every device, cleared at the game's daily reset (midnight Mountain Time).
// The reset in the viewer's own time, for today (so it follows daylight saving), e.g. "11:00 PM".
function dailyResetTime() {
  const reset = new Date();
  // 06:00 UTC under MDT, 07:00 UTC under MST: whichever is midnight in Denver today.
  reset.setUTCHours(6, 0, 0, 0);
  const denverHour = new Intl.DateTimeFormat("en-US", {timeZone: "America/Denver", hour: "numeric", hourCycle: "h23"}).format(reset);
  if (Number(denverHour) !== 0) reset.setUTCHours(7);
  return reset.toLocaleTimeString([], {hour: "numeric", minute: "2-digit"});
}
function plotCheckButton(slot) {
  return `<button type="button" class="plot-check" data-check-slot="${escapeHtml(slot)}" aria-pressed="false" title="Mark ${escapeHtml(slot)} checked for today (clears at the daily reset, ${dailyResetTime()} your time)">✓</button>`;
}

function regionAllChecked(region) {
  const plots = (app.state?.plots || []).filter(plot => plot.region === region);
  return plots.length > 0 && plots.every(plot => app.plotChecks.has(plot.slot));
}

// Returns true when it redrew the plot map.
function applyPlotChecks() {
  // Re-draw the map when a region becomes (or stops being) all checked, so it folds or opens.
  const checkedRegions = (app.state?.options.regions || []).filter(regionAllChecked);
  const key = checkedRegions.join("|");
  const redraw = !!app.state && key !== app.checkedRegionsKey;
  if (redraw) {
    app.checkedRegionsKey = key;
    // A region that is no longer all checked folds again the next time it is.
    app.openedCheckedRegions.forEach(region => { if (!checkedRegions.includes(region)) app.openedCheckedRegions.delete(region); });
    renderPlots();  // re-enters here with the key matching; the loop below still covers the panel's ✓
  }
  $$("[data-check-slot]").forEach(button => {
    const checked = app.plotChecks.has(button.dataset.checkSlot);
    button.setAttribute("aria-pressed", String(checked));
    button.setAttribute("aria-label", `${button.dataset.checkSlot} ${checked ? "checked today" : "not checked today"}`);
    button.closest(".plot-card")?.classList.toggle("checked", checked);
  });
  return redraw;
}

function setPlotChecks(result) {
  app.plotChecks = new Set(result.checked || []);
  // A reply can be older than a tap still in flight (quick taps, or the reload
  // when the tab becomes visible again); keep those taps as the user left them.
  app.plotCheckPending.forEach(({checked}, slot) => {
    if (checked) app.plotChecks.add(slot); else app.plotChecks.delete(slot);
  });
  applyPlotChecks();
  clearTimeout(app.plotCheckResetTimer);
  const wait = Date.parse(result.resets_at) - Date.now();
  // Reload just after the reset; cap the wait so a sleeping phone or clock drift can't miss it.
  if (Number.isFinite(wait)) app.plotCheckResetTimer = setTimeout(loadPlotChecks, Math.min(Math.max(wait, 0) + 2000, 3600000));
}

async function loadPlotChecks() {
  try {
    setPlotChecks(await api("/api/plots/checks"));
  } catch (error) {
    toast(error.message, true);
  }
}

async function togglePlotCheck(slot) {
  const checked = !app.plotChecks.has(slot);
  // Show the change at once; the server's answer replaces it.
  const tap = {checked};
  app.plotCheckPending.set(slot, tap);
  if (checked) app.plotChecks.add(slot); else app.plotChecks.delete(slot);
  applyPlotChecks();
  try {
    const result = await api("/api/plots/checks", {method: "POST", body: JSON.stringify({slot, checked})});
    if (app.plotCheckPending.get(slot) === tap) app.plotCheckPending.delete(slot);
    setPlotChecks(result);
  } catch (error) {
    if (app.plotCheckPending.get(slot) === tap) app.plotCheckPending.delete(slot);
    toast(error.message, true);
    loadPlotChecks();
  }
}

function plotCard(plot) {
  const [statusClass, statusLabel] = plotStatus(plot);
  const assignment = plot.actual || plot.recommended;
  const jobs = plot.actual_jobs?.length ? plot.actual_jobs : (plot.recommended_jobs || []);
  const targetText = jobs.length > 1 ? `${jobs.length} targets` : assignment?.target;
  const mode = plot.actual ? "Actual planting" : assignment?.custom_target ? "Custom target" : "Recommendation";
  const position = plot.map_position || {column: 1, row: 1, span: 4};
  // Same job tags (1A/1B, 2F, 3P) as the plot's detail view, for the layout the card shows.
  const shownAssignment = plot.actual_grid ? plot.actual : plot.recommended;
  const shownJobs = plot.actual_grid ? (plot.actual_jobs || []) : (plot.recommended_jobs || []);
  const tags = shownAssignment && shownAssignment.method !== "manual" ? HKIAJobTags.jobTags(shownJobs).cells : null;
  // Fertilizing jobs with bed plants: a stand-in for the in-game fertilizer.
  // A finished job keeps its entry with an empty layout, so it doesn't count.
  // Planned beds not yet planted show the mark dimmed.
  const fertilizerBeds = jobs => (jobs || []).filter(job => String(job.method || "").startsWith("fertilize_")
    && [...(job.layout?.parent_a_cells || []), ...(job.layout?.shared_parent_a_cells || [])].length);
  const fertilizing = fertilizerBeds(plot.actual_jobs);
  const plannedFertilizing = fertilizing.length ? [] : fertilizerBeds(plot.recommended_jobs);
  const fertilizerMark = fertilizing.length
    ? `<span class="plot-fertilizer-mark" title="${escapeHtml(`Fertilizing: ${fertilizing.map(job => job.target).join(", ")}`)}" aria-label="Has a planted fertilizing job"><svg class="line-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2v6a2 2 0 0 0 .245.96l5.51 10.08A2 2 0 0 1 18 22H6a2 2 0 0 1-1.755-2.96l5.51-10.08A2 2 0 0 0 10 8V2"/><path d="M6.453 15h11.094"/><path d="M8.5 2h7"/></svg></span>`
    : plannedFertilizing.length
      ? `<span class="plot-fertilizer-mark planned" title="${escapeHtml(`Planned fertilizing: ${plannedFertilizing.map(job => job.target).join(", ")}`)}" aria-label="Has a planned fertilizing job"><svg class="line-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2v6a2 2 0 0 0 .245.96l5.51 10.08A2 2 0 0 1 18 22H6a2 2 0 0 1-1.755-2.96l5.51-10.08A2 2 0 0 0 10 8V2"/><path d="M6.453 15h11.094"/><path d="M8.5 2h7"/></svg></span>`
      : "";
  return `<article class="plot-card" data-slot="${plot.slot}" data-region="${escapeHtml(plot.region)}" data-span="${position.span}" draggable="true" tabindex="0" role="button" aria-label="Open ${escapeHtml(plot.slot)} ${escapeHtml(plot.name)}" style="--map-col:${position.column};--map-row:${position.row};--map-span:${position.span}">
    <div class="plot-card-head">
      <div><div class="plot-code">${plot.slot}</div><div class="plot-name">${escapeHtml(plot.name)}</div>${plot.location ? `<div class="plot-location">${escapeHtml(plot.location)}</div>` : ""}</div>
      <div class="plot-card-tools">${fertilizerMark}${plotCheckButton(plot.slot)}<span class="status ${statusClass}">${statusLabel}</span></div>
    </div>
    <div class="plot-target">${assignment ? escapeHtml(targetText) : "No assignment"}<small>${jobs.length > 1 ? jobs.map(job => escapeHtml(job.target)).join(" · ") : `${mode}${assignment ? ` · ${humanMethod(assignment.method)}` : ""}`}</small></div>
    ${(plot.copy_shortages || []).length ? `<p class="plot-copy-short">Not enough copies: ${(plot.copy_shortages).map(row => escapeHtml(row.label)).join(", ")}</p>` : ""}
    ${matrixHtml(plot.grid, plot.cols, false, assignment, plot.display_cell_grid, tags)}
  </article>`;
}

// A plot the farm hasn't unlocked: greyed, in its map place, with a way to unlock it.
function lockedPlotCard(plot) {
  const position = plot.map_position || {column: 1, row: 1, span: 4};
  return `<article class="plot-card locked-plot" data-region="${escapeHtml(plot.region)}" data-span="${position.span}" style="--map-col:${position.column};--map-row:${position.row};--map-span:${position.span}">
    <div class="plot-card-head">
      <div><div class="plot-code">${escapeHtml(plot.slot)}</div><div class="plot-name">${escapeHtml(plot.name)}</div></div>
      <div class="plot-card-tools"><span class="status locked">Locked</span></div>
    </div>
    <p class="locked-note">Not unlocked yet · ${plot.spots} spots</p>
    <button type="button" class="button small secondary" data-unlock-slot="${escapeHtml(plot.slot)}">I've unlocked it</button>
  </article>`;
}

function mapDropPosition(map, event, span) {
  const rect = map.getBoundingClientRect();
  const style = getComputedStyle(map);
  const paddingLeft = parseFloat(style.paddingLeft) || 0;
  const paddingRight = parseFloat(style.paddingRight) || 0;
  const paddingTop = parseFloat(style.paddingTop) || 0;
  const paddingBottom = parseFloat(style.paddingBottom) || 0;
  const columnGap = parseFloat(style.columnGap) || 0;
  const rowGap = parseFloat(style.rowGap) || 0;
  const rows = Number(map.dataset.rows || 1);
  const innerWidth = rect.width - paddingLeft - paddingRight;
  const trackWidth = (innerWidth - columnGap * 11) / 12;
  const step = trackWidth + columnGap;
  const x = Math.max(0, event.clientX - rect.left - paddingLeft);
  const column = Math.max(1, Math.min(13 - span, Math.round(x / step) + 1));

  let row;
  if (event.clientY >= rect.bottom - Math.max(22, paddingBottom + 8)) {
    row = rows + 1;
  } else {
    const usableHeight = Math.max(1, rect.height - paddingTop - paddingBottom - rowGap * Math.max(0, rows - 1));
    const rowHeight = usableHeight / rows;
    const y = Math.max(0, event.clientY - rect.top - paddingTop);
    row = Math.max(1, Math.min(rows, Math.floor(y / Math.max(1, rowHeight + rowGap)) + 1));
  }
  return {column, row};
}

function clearMapDrag() {
  $$(".region-map.drag-over").forEach(map => map.classList.remove("drag-over"));
  $$(".plot-card.dragging").forEach(card => card.classList.remove("dragging"));
  $$(".map-drop-indicator").forEach(indicator => {
    indicator.classList.remove("visible");
    indicator.removeAttribute("style");
  });
  app.mapDrag = null;
}

function bindPlotMapInteractions() {
  $$("#plotRegions .plot-check").forEach(button => button.addEventListener("click", event => {
    event.stopPropagation();
    togglePlotCheck(button.dataset.checkSlot);
  }));

  $$(".region-density").forEach(button => button.addEventListener("click", event => {
    event.stopPropagation();
    const current = Number(button.dataset.columns || 3);
    const next = current === 3 ? 4 : 3;
    const region = button.dataset.region;
    if (!confirm(`Reflow ${region} to ${next} plot cards across? This rearranges that region's plot cards.`)) return;
    mutate(
      "/api/regions/columns",
      {region, cards_per_row: next},
      `Reflowing ${region}…`,
    );
  }));

  $$(".region-collapse").forEach(button => button.addEventListener("click", event => {
    event.stopPropagation();
    const region = button.dataset.region;
    if (button.dataset.auto === "true") {
      app.openedCheckedRegions.add(region);  // only folded because it's all checked
      renderPlots();
      return;
    }
    if (button.dataset.collapsed !== "true" && regionAllChecked(region)) {
      app.openedCheckedRegions.delete(region);  // folding a checked region: let it auto-fold again
      renderPlots();
      return;
    }
    // Only a display setting: redraw now and save in the background (no state reload).
    const collapsed = button.dataset.collapsed !== "true";
    const maps = app.state.options.region_maps;
    const before = maps[region];
    maps[region] = {...(before || {}), collapsed};
    renderPlots();
    api("/api/regions/collapse", {method: "POST", body: JSON.stringify({region, collapsed})}).catch(error => {
      if (before === undefined) delete maps[region]; else maps[region] = before;
      renderPlots();
      toast(error.message || "Couldn't save that.", true);
    });
  }));

  $$("[data-unlock-slot]").forEach(button => button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      await HKIAOnboarding.unlockPlot(button.dataset.unlockSlot);
      toast(`${button.dataset.unlockSlot} unlocked. Generate plan to plan for it.`);
      await refreshState(false);
    } catch (error) {
      toast(error.message, true);
      button.disabled = false;
    }
  }));

  $$(".plot-card").forEach(card => {
    if (card.dataset.overview === "greenhouse" || card.classList.contains("locked-plot")) return;
    card.addEventListener("click", event => {
      if (event.target.closest("button") || Date.now() < app.suppressCardClickUntil) return;
      openPlot(card.dataset.slot);
    });
    card.addEventListener("keydown", event => {
      if ((event.key === "Enter" || event.key === " ") && !event.target.closest("button")) {
        event.preventDefault();
        openPlot(card.dataset.slot);
      }
    });
    // A click on the card's ✓ that wobbles a pixel must not turn into a drag.
    card.addEventListener("pointerdown", event => {
      app.pointerOnCardControl = !!event.target.closest("button");
    });
    card.addEventListener("dragstart", event => {
      if (app.pointerOnCardControl || matchMedia("(max-width: 850px)").matches) {
        event.preventDefault();
        return;
      }
      app.mapDrag = {
        slot: card.dataset.slot,
        region: card.dataset.region,
        span: Number(card.dataset.span || 4),
        position: null,
      };
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", card.dataset.slot);
      requestAnimationFrame(() => card.classList.add("dragging"));
    });
    card.addEventListener("dragend", () => {
      app.suppressCardClickUntil = Date.now() + 250;
      clearMapDrag();
    });
  });

  $$(".region-map").forEach(map => {
    map.addEventListener("dragover", event => {
      if (!app.mapDrag || app.mapDrag.region !== map.dataset.region) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      const position = mapDropPosition(map, event, app.mapDrag.span);
      app.mapDrag.position = position;
      map.classList.add("drag-over");
      const indicator = map.querySelector(".map-drop-indicator");
      indicator.style.setProperty("--drop-col", position.column);
      indicator.style.setProperty("--drop-row", position.row);
      indicator.style.setProperty("--drop-span", app.mapDrag.span);
      indicator.classList.add("visible");
    });
    map.addEventListener("dragleave", event => {
      if (map.contains(event.relatedTarget)) return;
      map.classList.remove("drag-over");
      map.querySelector(".map-drop-indicator")?.classList.remove("visible");
    });
    map.addEventListener("drop", event => {
      if (!app.mapDrag || app.mapDrag.region !== map.dataset.region) return;
      event.preventDefault();
      const {slot, position} = app.mapDrag;
      app.suppressCardClickUntil = Date.now() + 250;
      clearMapDrag();
      if (!position) return;
      mutate("/api/plots/map/move", {slot, ...position}, "Moving plot on map…");
    });
  });
  $$('[data-gh-open-slot]').forEach(button => button.addEventListener("click", event => {
    event.stopPropagation();
    openPlot(button.dataset.ghOpenSlot);
  }));
}

function flowerBackground(flower) {
  if (!flower) return "";
  const color = app.state.options.flower_colors[flower.color] || "#b8b1bf";
  if (flower.pattern === "Solid") return color;
  const defaultSecondary = flower.color === "White" ? "Warm Pink" : "White";
  const secondaryName = flower.secondary_color || defaultSecondary;
  const secondary = app.state.options.flower_colors[secondaryName] || "#fffdf7";
  if (app.state.options.effect_patterns.includes(flower.pattern)) return color;
  if (flower.pattern === "Ombre") return `linear-gradient(135deg, ${color} 0 58%, ${secondary} 60% 100%)`;
  return `repeating-linear-gradient(135deg, ${color} 0 6px, ${secondary} 6px 9px)`;
}

function flowerForeground(flower) {
  if (!flower) return "#fff";
  const hex = (app.state.options.flower_colors[flower.color] || "#777777").replace("#", "");
  const rgb = [0, 2, 4].map(index => parseInt(hex.slice(index, index + 2), 16));
  const luminance = (rgb[0] * 299 + rgb[1] * 587 + rgb[2] * 114) / 1000;
  return luminance > 165 ? "#3b3442" : "#ffffff";
}

function flowerStyle(flower) {
  return flower ? `background:${flowerBackground(flower)};color:${flowerForeground(flower)}` : "";
}

function flowerVariantLabel(flower) {
  if (!flower) return "";
  if (!flower.color || !flower.flower_type) return flower.label || "";
  const pattern = flower.pattern || "Solid";
  const secondary = flower.secondary_color ? ` & ${flower.secondary_color}` : "";
  const suffix = pattern === "Solid" ? "" : `${secondary} ${pattern}`;
  return `${flower.color}${suffix} ${flower.flower_type}`;
}

function flowerTooltipAttributes(flower, role = "Plant") {
  if (!flower) return "";
  const label = flowerVariantLabel(flower);
  return [
    `data-flower-tooltip="true"`,
    `data-flower-label="${escapeHtml(label)}"`,
    `data-flower-breed="${escapeHtml(flower.flower_type)}"`,
    `data-flower-color="${escapeHtml(flower.color)}"`,
    `data-flower-pattern="${escapeHtml(flower.pattern || "Solid")}"`,
    flower.secondary_color ? `data-flower-secondary="${escapeHtml(flower.secondary_color)}"` : "",
    `data-flower-role="${escapeHtml(role)}"`,
    `aria-label="${escapeHtml(`${role}: ${label}`)}"`,
  ].filter(Boolean).join(" ");
}

function matrixHtml(grid, cols, large = false, assignment = null, flowerGrid = null, tags = null) {
  const cells = grid.flatMap((row, rowIndex) => row.map((value, colIndex) => {
    const cellFlower = flowerGrid?.[rowIndex]?.[colIndex] || null;
    const marker = value === "!" ? "!" : HKIAParentAnnotations.markerForCell(value, cellFlower);
    const parentIndex = marker === "A" ? 0 : marker === "B" ? 1 : null;
    const parentFlower = parentIndex === null ? null : assignment?.parent_flowers?.[parentIndex];
    const flower = value === "!" ? null : (cellFlower || parentFlower);
    const cls = marker === "A" ? "parent-a" : marker === "B" ? "parent-b" : value === "X" || cellFlower?.filler ? "filler" : value === "·" ? "target" : value === "!" ? "gh-conflict" : value === "#" ? "blocked" : value === "--" ? "gh-buffer" : "buffer";
    const tag = tags?.get(`${rowIndex}:${colIndex}`);
    const text = tag || (["A", "B", "!"].includes(marker) ? marker : cellFlower?.filler ? "X" : cellFlower ? "●" : "");
    const role = marker === "A" ? "Parent A" : marker === "B" ? "Parent B" : cellFlower?.filler ? "Filler (fertilize daily)" : "Planted flower";
    return `<span class="cell ${cls}${flower ? " flower-cell" : ""}${tag ? " tagged" : ""}" style="${flowerStyle(flower)}" ${flowerTooltipAttributes(flower, role)}>${text}</span>`;
  })).join("");
  return `<div class="matrix${large ? " large" : ""}" style="grid-template-columns:repeat(${cols},1fr)">${cells}</div>`;
}

// Legend keyed by the map's job tags (1A/1B pairs, 2F fertilizer, 3P propagation).
function jobLegendHtml(jobs) {
  const {groups} = HKIAJobTags.jobTags(jobs);
  if (!groups.length) return "";
  const chip = (tag, flower) => `<i class="legend-cell flower-cell job-tag" style="${flowerStyle(flower)}">${escapeHtml(tag)}</i>`;
  const name = flower => escapeHtml(flower ? flowerVariantLabel(flower) : "");
  const rows = groups.flatMap(group => group.jobs.map((job, index) => {
    const [a, b] = job.parent_flowers || [];
    const n = group.number;
    const result = `<span class="job-legend-result">→ ${escapeHtml(job.target || "")} · ${escapeHtml(humanMethod(job.method))}</span>`;
    if (group.kind !== "pair") return `<li>${chip(`${n}${group.kind}`, a)} ${name(a)} ${result}</li>`;
    const donor = index === 0 ? `${chip(`${n}A`, a)} ${name(a)} <span class="job-legend-x">×</span> ` : `<span class="job-legend-indent">↳</span> `;
    return `<li>${donor}${b ? `${chip(`${n}B`, b)} ${name(b)} ` : ""}${result}</li>`;
  }));
  return `<ul class="job-legend">${rows.join("")}</ul>`;
}

// X cells: fillers. Each X shows its flower's color; the list is what to take
// from inventory, and hovering an X names the exact flower for that cell.
function fillerLegendHtml(cellGrid) {
  const counts = new Map();
  (cellGrid || []).flat().filter(cell => cell?.filler).forEach(cell => {
    const label = flowerVariantLabel(cell);
    const entry = counts.get(label) || {cell, n: 0};
    entry.n += 1;
    counts.set(label, entry);
  });
  if (!counts.size) return "";
  const total = [...counts.values()].reduce((sum, entry) => sum + entry.n, 0);
  const items = [...counts].sort((a, b) => b[1].n - a[1].n).map(([label, {cell, n}]) =>
    `<li><i class="legend-cell flower-cell job-tag" style="${flowerStyle(cell)}">X</i> ${n} × ${escapeHtml(label)}</li>`).join("");
  return `<div class="filler-legend"><strong>X = filler (${total}):</strong> plant once, then fertilize daily. They only raise the spawn chance next door; they can't breed with their neighbors.<ul class="job-legend">${items}</ul></div>`;
}

function openPlot(slot, open = true) {
  const plot = app.state.plots.find(item => item.slot === slot);
  if (!plot) return;
  app.selectedPlot = plot;
  $("#drawerRegion").textContent = plot.location ? `${plot.region} · ${plot.location}` : plot.region;
  $("#drawerTitle").textContent = `${plot.slot} · ${plot.name}`;
  $("#drawerPlotCheck").dataset.checkSlot = plot.slot;
  $("#drawerPlotCheck").title = `Mark ${plot.slot} checked for today (clears at the daily reset, ${dailyResetTime()} your time)`;
  applyPlotChecks();
  renderDrawer(plot);
  HKIAOnboarding.hint("plot", $("#applyPlot")?.parentElement);
  if (open) {
    $("#plotDrawer").classList.add("open");
    $("#drawerScrim").classList.add("open");
    $("#plotDrawer").setAttribute("aria-hidden", "false");
  }
}

function editCellKey(row, col) { return `${row}:${col}`; }

function editorFlowerOptions() {
  return app.state.inventory.filter(item => item.collected && item.total > 0);
}

function brushFlower() {
  const flower_type = $("#plotBrushFlower").value;
  const color = $("#plotBrushColor").value;
  const pattern = $("#plotBrushPattern").value;
  const secondary_color = $("#plotBrushSecondary").value || null;
  if (!flower_type || !color || !pattern) return null;
  const item = editorFlowerOptions().find(option =>
    option.flower_type === flower_type && option.color === color && option.pattern === pattern &&
    (option.secondary_color || null) === secondary_color
  );
  return item ? {...item} : null;
}

function orderedValues(items, key, preferredOrder) {
  const values = new Set(items.map(item => item[key]));
  return [
    ...preferredOrder.filter(value => values.has(value)),
    ...[...values].filter(value => !preferredOrder.includes(value)).sort(),
  ];
}

function setBrushOptions(node, values, selected, labelFor = value => value) {
  node.innerHTML = values.map(value => `<option value="${escapeHtml(value)}">${escapeHtml(labelFor(value))}</option>`).join("");
  if (values.includes(selected)) node.value = selected;
}

function refreshBrushSelectors(preferred = {}) {
  const options = editorFlowerOptions();
  const desiredFlower = preferred.flower_type || $("#plotBrushFlower").value;
  const flowers = orderedValues(options, "flower_type", app.state.options.flower_types);
  setBrushOptions($("#plotBrushFlower"), flowers, desiredFlower);

  const flower = $("#plotBrushFlower").value;
  const colorOptions = options.filter(item => item.flower_type === flower);
  const desiredColor = preferred.color || $("#plotBrushColor").value;
  const colors = orderedValues(colorOptions, "color", app.state.options.colors);
  setBrushOptions($("#plotBrushColor"), colors, desiredColor);

  const color = $("#plotBrushColor").value;
  const patternOptions = colorOptions.filter(item => item.color === color);
  const desiredPattern = preferred.pattern || $("#plotBrushPattern").value;
  const patterns = orderedValues(patternOptions, "pattern", app.state.options.patterns);
  setBrushOptions($("#plotBrushPattern"), patterns, desiredPattern, pattern => {
    const item = patternOptions.find(option => option.pattern === pattern);
    return `${pattern} — ${item.free} free / ${item.total_label} total`;
  });
  const pattern = $("#plotBrushPattern").value;
  const secondaryOptions = patternOptions.filter(item => item.pattern === pattern);
  const desiredSecondary = Object.prototype.hasOwnProperty.call(preferred, "secondary_color")
    ? (preferred.secondary_color || "")
    : $("#plotBrushSecondary").value;
  const secondaries = [...new Set(secondaryOptions.map(item => item.secondary_color || ""))];
  setBrushOptions($("#plotBrushSecondary"), secondaries, desiredSecondary || "", value => {
    if (value) return value;
    return `Default (${color === "White" ? "Warm Pink" : "White"})`;
  });
}

function openPlotEditor(plot) {
  app.editingPlot = plot;
  app.editTool = "paint";
  app.editCells = new Map(plot.actual_cells.map(cell => [editCellKey(cell.row, cell.col), {...cell}]));
  app.editOriginal = new Map(app.editCells);
  const preferred = plot.actual_cells[0] || plot.recommended_cells[0];
  refreshBrushSelectors(preferred || {});
  $("#plotEditorRegion").textContent = plot.region;
  $("#plotEditorTitle").textContent = `${plot.slot} · ${plot.name}`;
  renderPlotEditor();
  $("#plotEditorDialog").showModal();
}

const sameFlower = (a, b) => !!a && !!b && a.flower_type === b.flower_type && a.color === b.color
  && a.pattern === b.pattern && (a.secondary_color || null) === (b.secondary_color || null);

// The tag a newly painted cell gets on "Auto": the cell's own tag when the
// flower is unchanged; else the tag of the same flower that was moved away
// (its tag now has fewer plants of it than before); else, for a solid, the
// fertilizer bed already holding that solid.
function autoTag(cell, previous) {
  if (previous && sameFlower(previous, cell)) return previous.tag || null;
  const count = (cells, tag) => [...cells.values()].filter(c => c.tag === tag && sameFlower(c, cell)).length;
  const originalTags = [...new Set([...(app.editOriginal || new Map()).values()]
    .filter(c => c.tag && sameFlower(c, cell)).map(c => c.tag))];
  const moved = originalTags.find(tag => count(app.editOriginal, tag) > count(app.editCells, tag));
  if (moved) return moved;
  if (cell.pattern === "Solid") {
    const bed = [...app.editCells.values()].find(c => c.tag && c.tag.endsWith("F") && sameFlower(c, cell));
    if (bed) return bed.tag;
  }
  return null;
}

function refreshTagSelector() {
  const node = $("#plotBrushTag");
  if (!node) return;
  const selected = node.value || "auto";
  const tags = [...new Set([...app.editCells.values()].map(c => c.tag).filter(Boolean))];
  const numberOf = tag => Number.parseInt(tag, 10) || 0;
  const groups = [...new Set(tags.map(numberOf))].sort((a, b) => a - b);
  const next = (groups.length ? Math.max(...groups) : 0) + 1;
  const options = [["auto", "Auto"], ["", "No tag"]];
  groups.forEach(number => {
    const letters = tags.filter(tag => numberOf(tag) === number).map(tag => tag.slice(-1));
    (letters.includes("F") ? ["F"] : letters.includes("P") ? ["P"] : ["A", "B"])
      .forEach(letter => options.push([`${number}${letter}`, `${number}${letter}`]));
  });
  options.push([`${next}A`, `${next}A (new pair: first parent)`], [`${next}B`, `${next}B (new pair: second parent)`],
    [`${next}F`, `${next}F (new fertilizer bed)`]);
  node.innerHTML = options.map(([value, label]) => `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`).join("");
  node.value = options.some(([value]) => value === selected) ? selected : "auto";
}

function setEditorTool(tool) {
  app.editTool = tool;
  $("#paintTool").className = `button small ${tool === "paint" ? "primary" : "secondary"}`;
  $("#eraseTool").className = `button small ${tool === "erase" ? "primary" : "secondary"}`;
}

function renderPlotEditor() {
  const plot = app.editingPlot;
  if (!plot) return;
  const editable = new Set(plot.editable_cells.map(cell => editCellKey(cell.row, cell.col)));
  const cells = [];
  for (let row = 0; row < plot.rows; row += 1) {
    for (let col = 0; col < plot.cols; col += 1) {
      const key = editCellKey(row, col);
      const flower = app.editCells.get(key);
      const canEdit = editable.has(key);
      const tooltip = flower ? flowerTooltipAttributes(flower, "Planted flower") : `aria-label="${escapeHtml(`Row ${row + 1}, column ${col + 1}`)}"`;
      const mark = flower ? (flower.tag ? `<span class="edit-tag">${escapeHtml(flower.tag)}</span>` : "●") : "";
      cells.push(`<button type="button" class="plot-edit-cell${canEdit ? "" : " disabled"}${flower ? " planted" : ""}" data-row="${row}" data-col="${col}" ${canEdit ? "" : "disabled"} style="${flowerStyle(flower)}" ${tooltip}>${mark}</button>`);
    }
  }
  $("#plotEditorGrid").style.gridTemplateColumns = `repeat(${plot.cols}, minmax(27px, 1fr))`;
  $("#plotEditorGrid").innerHTML = cells.join("");
  const untagged = [...app.editCells.values()].filter(cell => !cell.tag).length;
  const anyTag = untagged < app.editCells.size;
  $("#plotEditorCount").textContent = `${app.editCells.size} planted flower${app.editCells.size === 1 ? "" : "s"} recorded.`
    + (anyTag && untagged ? ` ${untagged} without a job tag: FLOW treats ${untagged === 1 ? "it" : "them"} as spare plants.` : "");
  refreshTagSelector();
  const brush = brushFlower();
  $("#brushPreview").style.background = flowerBackground(brush);
  $("#brushPreview").title = brush?.label || "Flower brush";
  setEditorTool(app.editTool);
  $$(".plot-edit-cell:not(.disabled)").forEach(cell => cell.addEventListener("click", () => {
    const row = Number(cell.dataset.row);
    const col = Number(cell.dataset.col);
    const key = editCellKey(row, col);
    if (app.editTool === "erase") {
      app.editCells.delete(key);
    } else {
      const flower = brushFlower();
      if (!flower) return;
      const previous = app.editCells.get(key);
      const choice = $("#plotBrushTag").value;
      const placed = {row, col, flower_type: flower.flower_type, color: flower.color, pattern: flower.pattern, secondary_color: flower.secondary_color || null, label: flower.label};
      placed.tag = choice === "auto" ? autoTag(placed, previous) : (choice || null);
      app.editCells.set(key, placed);
    }
    renderPlotEditor();
  }));
}

async function savePlotEditor(updateRecommendation) {
  const plot = app.editingPlot;
  if (!plot) return;
  const cells = [...app.editCells.values()].map(({row, col, flower_type, color, pattern, secondary_color, tag}) => ({row, col, flower_type, color, pattern, secondary_color: secondary_color || null, tag: tag || null}));
  $("#plotEditorDialog").close();
  loading(true, updateRecommendation ? "Saving plot and updating recommendations…" : "Saving plot…");
  try {
    const saved = await api("/api/plots/cells", {method: "POST", body: JSON.stringify({slot: plot.slot, cells})});
    if (updateRecommendation) {
      const updated = await api("/api/plots/recommendation", {
        method: "POST",
        body: JSON.stringify({slot: plot.slot}),
      });
      toast(`${saved.message} ${updated.message}`);
      await refreshState(false);
    } else {
      toast(saved.message);
      await refreshState(false);
    }
  } catch (error) {
    toast(error.message, true);
  } finally {
    loading(false);
  }
}

// Filter steps for planting a plot's recommendation, cached per state load
// (a big plot takes tens of milliseconds to work out).
function plantingGuide(plot) {
  if (app.plantingGuidesRevision !== app.stateRevision) {
    app.plantingGuides = new Map();
    app.plantingGuidesRevision = app.stateRevision;
  }
  const key = plot.slot;
  if (!app.plantingGuides.has(key)) {
    const guide = window.HKIAPlantingGuide;
    const cells = guide.cellsToPlant(plot.recommended_cells, plot.actual_cells);
    const remove = guide.cellsToRemove(plot.recommended_cells, plot.actual_cells);
    const removed = new Set(remove.map(cell => `${cell.row}:${cell.col}`));
    const options = app.state.options || {};
    app.plantingGuides.set(key, {
      steps: guide.planSteps(cells, app.state.inventory, {
        breeds: options.flower_types, colors: options.colors, patterns: options.patterns,
      }),
      kept: (plot.recommended_cells || []).length - cells.length,
      remove,
      keptCells: (plot.actual_cells || []).filter(cell => cell.flower_type && !removed.has(`${cell.row}:${cell.col}`)),
    });
  }
  return app.plantingGuides.get(key);
}

// Copies (hkia_solver/copies.py): in a whole-farm replant a plant can move
// between plots (dig it up there first); a Recommendation can also lack copies.
function copyNoticeHtml(plot) {
  const list = rows => rows.map(row => `${row.count} ${escapeHtml(row.label)}${row.slot ? ` (${escapeHtml(row.slot)})` : ""}`).join(", ");
  const parts = [];
  const moveIn = plot.copy_moves_in || [], moveOut = plot.copy_moves_out || [], short = plot.copy_shortages || [];
  if (moveIn.length) {
    const from = [...new Set(moveIn.map(row => row.slot))].join(", ");
    parts.push(`<p><strong>Dig up first:</strong> ${list(moveIn)}. Record ${escapeHtml(from)} before this plot.</p>`);
  }
  if (moveOut.length) {
    parts.push(`<p><strong>Goes to another plot:</strong> ${list(moveOut)}. Record this plot first.</p>`);
  }
  if (short.length) {
    parts.push(`<p class="copy-short"><strong>Not enough copies:</strong> ${list(short)} short. Replant plot or generate a new plan.</p>`);
  }
  return parts.length ? `<div class="copy-notice">${parts.join("")}</div>` : "";
}

function plantingGuideHtml(plot) {
  const {steps, kept, remove, keptCells} = plantingGuide(plot);
  return window.HKIAPlantingGuide.renderGuide(
    steps,
    {rows: plot.rows, cols: plot.cols, grid: plot.recommended_grid},
    {flowerStyle, label: flowerVariantLabel, keptCount: kept, removeCells: remove, keptCells, itemAction: missingPlantButton},
  );
}

// "Don't have it": inventory said there was a spare copy, but there isn't.
function missingPlantButton(flower) {
  const data = ["flower_type", "color", "pattern", "secondary_color"]
    .map(key => `data-${key.replace("_", "-")}="${escapeHtml(flower[key] || "")}"`).join(" ");
  return `<button type="button" class="pg-missing" ${data} title="Inventory is off and you have no spare ${escapeHtml(flowerVariantLabel(flower))}">Don't have it</button>`;
}

function inventoryRow(flower) {
  return (app.state.inventory || []).find(row => row.flower_type === flower.flower_type
    && row.color === flower.color && row.pattern === flower.pattern
    && (row.secondary_color || "") === (flower.secondary_color || ""));
}

function openMissingPlantDialog(plot, flower) {
  const row = inventoryRow(flower) || {total: 0, planted: 0, free: 0};
  const label = flowerVariantLabel(flower);
  const freeInput = $("#missingPlantFree");
  freeInput.value = "0";
  freeInput.max = String(Math.max(0, row.free - 1));
  $("#missingPlantTitle").textContent = label;
  const after = () => {
    const free = Math.max(0, Number(freeInput.value) || 0);
    return `${row.planted + free} total · ${row.planted} planted · ${free} free`;
  };
  const render = () => {
    $("#missingPlantCounts").innerHTML = `<dt>Inventory says</dt><dd>${escapeHtml(`${row.total_label || row.total} total · ${row.planted} planted · ${row.free} free`)}</dd><dt>After this</dt><dd>${escapeHtml(after())}</dd>`;
  };
  render();
  freeInput.oninput = render;
  $("#missingPlantHelp").textContent = `Then ${plot.slot} is replanned with the new count, like Replant plot. Plants in the ground and other plots stay as they are.`;
  $("#confirmMissingPlant").onclick = () => {
    const free = Math.max(0, Math.floor(Number(freeInput.value) || 0));
    $("#missingPlantDialog").close();
    app.recommendationOpen.set(plot.slot, true);
    mutate(
      "/api/plots/missing-plant",
      {slot: plot.slot, ...flower, free},
      `Updating ${label} and replanning ${plot.slot}…`,
    );
  };
  $("#missingPlantDialog").showModal();
}

function workStatusClass(state) {
  if (state === "keep") return "keep";
  if (state === "goal_reached") return "goal_reached";
  if (state === "partial_update") return "partial_update";
  if (state === "new_work") return "new_work";
  if (state === "already_complete") return "already_complete";
  if (state === "review") return "review";
  return "no_work";
}

function jobWorkHtml(assignment) {
  if (!assignment?.work_state) return "";
  const state = assignment.work_state;
  const label = assignment.work_label || humanMethod(state);
  const reason = assignment.work_reason || "";
  return `<div class="job-work-state"><span class="status ${workStatusClass(state)}">${escapeHtml(label)}</span>${reason ? `<span>${escapeHtml(reason)}</span>` : ""}</div>`;
}

function assignmentDetails(title, assignment, stockText = "", tone = "", actionsHtml = "", showWorkState = true) {
  if (!assignment) return `<div class="target-detail-card ${tone}"><h4>${title}</h4><div class="detail-list">No assignment.</div></div>`;
  const parents = assignment.parents.map((parent, index) => `${parent} × ${assignment.parent_copies[index]}`).join("; ");
  const propagationNeedNote = assignment.method === "propagate_solid" && assignment.propagation_goal_reason
    ? `<div class="wide"><strong>Why propagate:</strong> ${escapeHtml(assignment.propagation_goal_reason)}</div>`
    : "";
  return `<div class="target-detail-card ${tone}">
    <div class="target-detail-head"><h4><small>${title}</small> ${escapeHtml(assignment.target)}</h4></div>
    ${showWorkState ? jobWorkHtml(assignment) : ""}
    <div class="detail-list">
      <div><strong>Method:</strong> ${humanMethod(assignment.method)}</div>
      <div><strong>Chance/day:</strong> ${assignment.manual_target ? "Manual layout" : `${(assignment.daily_probability * 100).toFixed(1)}%`}</div>
      <div class="wide"><strong>Parents:</strong> ${escapeHtml(parents)}</div>
      ${assignment.manual_target ? `<div class="wide"><strong>Target source:</strong> ${assignment.manual_target_source === "inferred" ? "Auto-recognized from planted parents" : assignment.manual_target_verified ? "Manually attached · route verified" : "Manually attached · route not verified"}</div>` : ""}
      ${stockText ? `<div><strong>Working stock:</strong> ${stockText}</div>` : ""}
      ${propagationNeedNote}
    </div>
    ${actionsHtml ? `<div class="target-detail-actions">${actionsHtml}</div>` : ""}
  </div>`;
}

function foundButtonHtml(job, plot, index = 0) {
  const jobId = job.job_id || (index === 0 ? "primary" : `job-${index + 1}`);
  const reached = job.work_state === "goal_reached" || plot.job_states?.[jobId]?.state === "goal_reached";
  const title = reached ? "Working-stock goal reached; record any extra offspring you find." : "Record one offspring for this target.";
  return `<button type="button" class="button primary found-job" data-job-id="${escapeHtml(jobId)}" title="${title}">Found ${escapeHtml(job.target)}</button>`;
}

function utilizationHtml(utilization, label = "Plan use") {
  if (!utilization) return "";
  const cellPct = Math.round((utilization.cell_utilization || 0) * 100);
  const zones = utilization.safe_zones_total
    ? `${utilization.safe_zones_used}/${utilization.safe_zones_total} safe zones · `
    : "";
  return `<div class="plan-utilization"><strong>${escapeHtml(label)}:</strong> ${zones}${utilization.active_cells}/${utilization.plantable_cells} active cells (${cellPct}%)<span>${utilization.empty_cells} buffer/unused cells</span></div>`;
}

const TARGETS_SHOWN = 4;

function assignmentSection(title, jobs, tone, options = {}) {
  const {
    primaryStockText = "",
    emptyText = "",
    targetActions = null,
    headerActions = "",
    footerActions = "",
    note = "",
    noticeHtml = "",
    badgeText = "",
    foldKey = "",
  } = options;
  const count = jobs.length;
  // Past TARGETS_SHOWN cards the list folds; foldKey remembers it opened across re-renders.
  const folded = foldKey && count > TARGETS_SHOWN && !app.expandedTargetLists.has(foldKey);
  const foldButton = foldKey && count > TARGETS_SHOWN
    ? `<button type="button" class="button small secondary target-fold" data-fold-key="${escapeHtml(foldKey)}">${folded ? `Show all ${count} targets ▾` : "Show fewer ▴"}</button>`
    : "";
  // Long lists also get the Targets tab's search + pattern filter (plus status). Every card is
  // rendered and applyTargetListFilter() hides the non-matching/folded ones, so typing doesn't
  // re-render the drawer and lose focus.
  const filterable = Boolean(foldKey) && count > TARGETS_SHOWN;
  const badge = `${count} target${count === 1 ? "" : "s"}`;
  // When every target shares one status and reason, say it once above the
  // cards instead of repeating it on each.
  const sharedWorkState = count > 1 && jobs[0]?.work_state && jobs.every(job =>
    job.work_state === jobs[0].work_state
    && (job.work_label || "") === (jobs[0].work_label || "")
    && (job.work_reason || "") === (jobs[0].work_reason || "")
  );
  const card = (job, index) => assignmentDetails(
    count > 1 ? `Target ${index + 1}` : "Target",
    job,
    index === 0 ? primaryStockText : "",
    tone,
    typeof targetActions === "function" ? targetActions(job, index) : "",
    !sharedWorkState,
  );
  const body = !count
    ? `<div class="assignment-empty">${escapeHtml(emptyText || "No assignment.")}</div>`
    : filterable
      ? jobs.map((job, index) => `<div class="target-filter-item" data-index="${index}" data-pattern="${escapeHtml(job.target_pattern || "")}" data-status="${escapeHtml(job.work_label || "")}" data-search="${escapeHtml(targetJobSearchText(job))}">${card(job, index)}</div>`).join("")
      : (folded ? jobs.slice(0, TARGETS_SHOWN) : jobs).map(card).join("");
  const filterHtml = filterable ? targetListFilterHtml(jobs, foldKey) : "";
  return `<section class="assignment-section ${tone}"${filterable ? ` data-filter-key="${escapeHtml(foldKey)}" data-total="${count}"` : ""}>
    <div class="assignment-section-header">
      <h3>${title}</h3>
      <div class="assignment-section-heading-actions">
        ${headerActions}
        <span class="assignment-count">${escapeHtml(badgeText || badge)}</span>
      </div>
    </div>
    ${note ? `<p class="assignment-section-note">${escapeHtml(note)}</p>` : ""}
    ${noticeHtml}
    ${sharedWorkState ? `<div class="shared-work-state">${jobWorkHtml(jobs[0])}<span class="shared-work-scope">All ${count} targets</span></div>` : ""}
    ${filterHtml}
    <div class="assignment-target-list">${body}</div>
    ${filterable ? `<p class="target-filter-empty" hidden>No targets match. <button type="button" class="link-button target-filter-clear">Clear filters</button></p>` : ""}
    ${foldButton ? `<div class="target-fold-row">${foldButton}</div>` : ""}
    ${footerActions ? `<div class="assignment-section-footer">${footerActions}</div>` : ""}
  </section>`;
}

// Same fields the Targets tab searches (targetMatches), for one plot job.
function targetJobSearchText(job) {
  return [job.target, job.target_color, job.target_pattern, job.target_type, humanMethod(job.method), job.work_label, ...(job.parents || [])]
    .filter(Boolean).join(" ").toLowerCase();
}

function targetListFilterHtml(jobs, key) {
  const filter = app.targetListFilters.get(key) || {};
  const tally = values => [...values.reduce((m, v) => m.set(v, (m.get(v) || 0) + 1), new Map())].sort((a, b) => a[0].localeCompare(b[0]));
  const options = (values, current) => tally(values.filter(Boolean))
    .map(([value, n]) => `<option value="${escapeHtml(value)}"${value === current ? " selected" : ""}>${escapeHtml(value)} (${n})</option>`).join("");
  const statuses = jobs.map(job => job.work_label);
  return `<div class="filters target-list-filters">
    <label class="search-field"><span>Search targets</span><input type="search" class="target-filter-query" value="${escapeHtml(filter.query || "")}" placeholder="Seafoam Tulia, parent…" autocomplete="off"></label>
    <label><span>Pattern</span><select class="target-filter-pattern"><option value="">All patterns</option>${options(jobs.map(job => job.target_pattern), filter.pattern)}</select></label>
    ${new Set(statuses.filter(Boolean)).size > 1 ? `<label><span>Status</span><select class="target-filter-status"><option value="">All statuses</option>${options(statuses, filter.status)}</select></label>` : ""}
  </div>`;
}

// Show the cards matching this section's filters. With no filter set, the usual fold applies.
function applyTargetListFilter(section) {
  const key = section.dataset.filterKey;
  const filter = app.targetListFilters.get(key) || {};
  const query = (filter.query || "").trim().toLowerCase();
  const active = Boolean(query || filter.pattern || filter.status);
  const folded = !app.expandedTargetLists.has(key);
  let matched = 0;
  section.querySelectorAll(".target-filter-item").forEach(item => {
    const match = (!query || item.dataset.search.includes(query))
      && (!filter.pattern || item.dataset.pattern === filter.pattern)
      && (!filter.status || item.dataset.status === filter.status);
    if (match) matched += 1;
    item.hidden = !(match && (active || !folded || Number(item.dataset.index) < TARGETS_SHOWN));
  });
  const total = Number(section.dataset.total);
  section.querySelector(".assignment-count").textContent = active ? `${matched} of ${total} targets` : `${total} targets`;
  section.querySelector(".target-filter-empty").hidden = !active || matched > 0;
  const foldRow = section.querySelector(".target-fold-row");
  if (foldRow) foldRow.hidden = active;
}

function bindTargetListFilters(root) {
  root.querySelectorAll("[data-filter-key]").forEach(section => {
    const key = section.dataset.filterKey;
    const update = patch => {
      app.targetListFilters.set(key, {...(app.targetListFilters.get(key) || {}), ...patch});
      applyTargetListFilter(section);
    };
    section.querySelector(".target-filter-query").addEventListener("input", event => update({query: event.target.value}));
    section.querySelector(".target-filter-pattern").addEventListener("change", event => update({pattern: event.target.value}));
    section.querySelector(".target-filter-status")?.addEventListener("change", event => update({status: event.target.value}));
    section.querySelector(".target-filter-clear").addEventListener("click", () => {
      app.targetListFilters.delete(key);
      section.querySelector(".target-filter-query").value = "";
      section.querySelectorAll("select").forEach(select => { select.value = ""; });
      applyTargetListFilter(section);
    });
    applyTargetListFilter(section);
  });
}

function reconciliationHtml(plot) {
  if (!plot?.action_note) return "";
  const [statusClass, statusLabel] = plotStatus(plot);
  return `<div class="work-reconciliation ${escapeHtml(plot.action_state || "")}">
    <span class="status ${statusClass}">${escapeHtml(statusLabel)}</span>
    <div><strong>${escapeHtml(plot.action_label || statusLabel)}</strong><p>${escapeHtml(plot.action_note)}</p></div>
  </div>`;
}

function renderDrawer(plot) {
  const [statusClass, statusLabel] = plotStatus(plot);
  const actualJobs = plot.actual_jobs || (plot.actual ? [plot.actual] : []);
  const recommendedJobs = plot.recommended_jobs?.length
    ? plot.recommended_jobs
    : plot.recommended ? [plot.recommended] : [];
  const manualLayout = Boolean(plot.manual_layout || plot.layout_edited);
  const canApplyWithoutConfirmation = Boolean(plot.can_apply_recommendation);
  const hasActual = Boolean(plot.actual_grid);
  // The plot's current planting is the main view. The Recommendation is its own
  // section: open when the plot needs work (or has nothing planted), folded
  // otherwise, and the person can open or fold it either way.
  const recommendationOpen = app.recommendationOpen.get(plot.slot)
    ?? (!hasActual || Boolean(plot.show_recommendation_view));
  const manualCandidates = plot.manual_target_candidates || [];
  const manualCandidateHtml = manualCandidates.length
    ? `<div class="manual-target-candidates"><strong>Possible target${manualCandidates.length === 1 ? "" : "s"}:</strong> ${manualCandidates.slice(0, 5).map(item => `<span>${escapeHtml(item.target)} · ${humanMethod(item.method)}</span>`).join("")}${manualCandidates.length > 5 ? `<small>+${manualCandidates.length - 5} more</small>` : ""}</div>`
    : "";
  const actualSection = hasActual && !plot.actual
    ? `<section class="assignment-section actual">
        <div class="assignment-section-header"><h3>Targets</h3><span class="assignment-count">Manual layout</span></div>
        <div class="assignment-empty"><strong>Exact plants:</strong> ${plot.actual_cells.length}<br>No breeding target is attached yet.${manualCandidateHtml}<button class="button secondary small" type="button" id="attachTargetInline">Manage targets</button></div>
      </section>`
    : assignmentSection(
        "Targets",
        actualJobs,
        "actual",
        {
          primaryStockText: plot.actual ? `${plot.target_total}/${plot.stock_goal}` : "",
          emptyText: "Nothing is recorded as planted here yet.",
          targetActions: (job, index) => foundButtonHtml(job, plot, index),
          foldKey: `${plot.slot}:actual`,
        },
      );
  const plotView = (grid, assignment, jobs, cellGrid, utilization, label) => `<div class="plot-detail-visual">
      ${grid ? matrixHtml(grid, plot.cols, true, assignment, cellGrid, assignment && assignment.method !== "manual" ? HKIAJobTags.jobTags(jobs).cells : null) : ""}
      ${assignment && assignment.method !== "manual" ? jobLegendHtml(jobs) : ""}
      ${fillerLegendHtml(cellGrid)}
      ${utilizationHtml(utilization, label)}
    </div>`;
  const currentHtml = hasActual
    ? `<div class="plot-detail-layout">
        ${plotView(plot.actual_grid, plot.actual, actualJobs, plot.actual_cell_grid, plot.actual_utilization, "In use")}
        <div class="plot-detail-work"><div class="plant-changed-row"><button type="button" class="button small secondary" id="plantChanged" title="A planted flower changed pattern, e.g. stray fertilizer">A plant changed…</button></div>${actualSection}</div>
      </div>`
    : "";

  const recommendationPresentation = window.HKIARecommendationPresentation.forPlot(
    plot,
    recommendedJobs,
    recommendationOpen ? "recommended" : "actual",
  );
  const preservedActualJobs = plot.preserved_actual_jobs || [];
  const recommendationNotice = recommendationPresentation.notice
    ? `<p class="help-text">${escapeHtml(recommendationPresentation.notice)}</p>`
    : "";
  const copyNotice = copyNoticeHtml(plot);
  const preservedActualNotice = preservedActualJobs.length
    ? `<div class="preserved-goal-notice"><strong>Still tracked as planted:</strong> ${escapeHtml(preservedActualJobs.map(job => job.target).join("; "))}. These unfinished goals are not included in this Recommendation. Recording a replacement will ask before stopping their tracking.</div>`
    : "";
  const applyLabel = plot.partial_update_ready ? "Record partial update as planted" : "Record as planted";
  let applyTitle = !recommendedJobs.length
    ? "Replant this plot to generate a recommendation"
    : !recommendationOpen
      ? "Opens the recommendation so you can review it before recording"
      : canApplyWithoutConfirmation
        ? "Record the recommendation shown below as physically planted"
        : "Click to review a confirmation before recording this recommendation";
  if (plot.partial_update_ready && recommendationOpen) {
    applyTitle = "Keep unfinished targets and record new work in the available safe zones";
  }
  const recommendationActions = `<div class="rec-actions">
      ${hasActual ? `<button type="button" class="button small secondary" id="toggleRecommendation" aria-expanded="${recommendationOpen}">${recommendationOpen ? "Hide ▴" : "Show ▾"}</button>` : ""}
      <span class="rec-actions-main">
        <button type="button" class="button secondary small" id="updatePlotRecommendation" title="Refresh this plot with FLOW: planted groups stay unless higher-priority work waits, free space is filled; every other plot stays as planned">Replant plot</button>
        <button type="button" class="button primary small" id="applyPlot" title="${escapeHtml(applyTitle)}">${escapeHtml(applyLabel)}</button>
      </span>
    </div>`;
  const recommendationBody = !recommendationOpen ? "" : recommendedJobs.length
    ? `${recommendationNotice}${copyNotice}${preservedActualNotice}
      <div class="plot-detail-layout">
        ${plantingGuideHtml(plot)}
        ${plotView(plot.recommended_grid, plot.recommended, recommendedJobs, plot.recommended_cell_grid, plot.recommended_utilization, "Recommendation use")}
        <div class="plot-detail-work">${assignmentSection(recommendationPresentation.title, recommendedJobs, "recommended", {foldKey: `${plot.slot}:recommended`})}</div>
      </div>`
    : `<p class="help-text">No recommendation for this plot. Replant plot makes one.</p>`;
  const recommendationHtml = `<section class="rec-section ${statusClass}">
      <div class="rec-head"><h3>Recommendation</h3><span class="status ${statusClass}">${escapeHtml(statusLabel)}</span></div>
      ${plot.action_note ? `<p class="rec-summary"><strong>${escapeHtml(plot.action_label || statusLabel)}.</strong> ${escapeHtml(plot.action_note)}</p>` : ""}
      ${recommendationActions}
      ${recommendationBody}
    </section>`;

  $("#drawerContent").innerHTML = `
    ${currentHtml}
    ${recommendationHtml}
    <details class="plot-tools">
      <summary>More plot actions</summary>
      <p class="plot-tools-help">Less-used controls for changing the target, editing the recorded layout, or adjusting how this plot appears on the map.</p>
      <div class="drawer-actions secondary-actions">
        <button class="button secondary" id="editPlot">Edit planted layout</button>
        <button class="button secondary" id="editMapDetails">Map card layout</button>
        <button class="button danger" id="clearPlot" ${hasActual ? "" : "disabled"}>Clear planted layout</button>
      </div>
    </details>
  `;
  const openRecommendation = () => {
    app.recommendationOpen.set(plot.slot, true);
    renderDrawer(plot);
  };
  $("#toggleRecommendation")?.addEventListener("click", () => {
    app.recommendationOpen.set(plot.slot, !recommendationOpen);
    renderDrawer(plot);
  });
  $$("#drawerContent .pg-missing").forEach(button => button.addEventListener("click", () => {
    const {flowerType, color, pattern, secondaryColor} = button.dataset;
    openMissingPlantDialog(plot, {flower_type: flowerType, color, pattern, secondary_color: secondaryColor || null});
  }));
  bindTargetListFilters($("#drawerContent"));
  $$("#drawerContent .target-fold").forEach(button => button.addEventListener("click", () => {
    const key = button.dataset.foldKey;
    if (app.expandedTargetLists.has(key)) app.expandedTargetLists.delete(key); else app.expandedTargetLists.add(key);
    renderDrawer(plot);
  }));
  const jobFor = button => (plot.actual_jobs || []).find((item, index) =>
    (item.job_id || (index === 0 ? "primary" : `job-${index + 1}`)) === button.dataset.jobId);
  $$(".found-job").forEach(button => button.addEventListener("click", () => {
    const job = jobFor(button);
    if (job && String(job.method || "").startsWith("fertilize_")) {
      openFoundDialog(plot, job, button.dataset.jobId);
      return;
    }
    mutate("/api/found", {slot: plot.slot, job_id: button.dataset.jobId, count: 1}, "Recording target…");
  }));
  $("#managePlotTargets").onclick = () => openTargetManager(plot);
  $("#attachTargetInline")?.addEventListener("click", () => openTargetManager(plot));
  $("#editMapDetails")?.addEventListener("click", () => openMapDetailsDialog(plot));
  $("#editPlot")?.addEventListener("click", () => openPlotEditor(plot));
  $("#plantChanged")?.addEventListener("click", () => openPlantChangedDialog(plot));
  $("#updatePlotRecommendation")?.addEventListener("click", () => {
    openRecommendation();
    mutate(
      "/api/plots/recommendation",
      {slot: plot.slot},
      `Updating ${plot.slot} only…`,
    );
  });
  $("#applyPlot")?.addEventListener("click", async () => {
    if (!recommendedJobs.length) {
      toast(`There is no current recommendation to record for ${plot.slot}. Use Replant plot first.`, true);
      return;
    }
    if (!recommendationOpen) {
      openRecommendation();
      toast("Review this plot's recommendation before recording it.");
      return;
    }
    const requiresConfirmation = manualLayout || !canApplyWithoutConfirmation;
    if (requiresConfirmation) {
      let message = `Replace what's planted in ${plot.slot} with the recommendation shown? Any planted goals left out of the recommendation will stop being tracked.`;
      if (manualLayout) {
        message = `Replace the manually recorded layout and attached targets for ${plot.slot} with the generated recommendation?`;
      } else if (plot.action_state === "already_complete") {
        message = `Record this recommendation for ${plot.slot} even though inventory already satisfies its goal?`;
      }
      const omittedKeeps = (plot.preserved_actual_jobs || []).map(job => job.target);
      if (omittedKeeps.length) {
        message += ` This replacement will stop tracking these unfinished planted goal${omittedKeeps.length === 1 ? "" : "s"}: ${omittedKeeps.join("; ")}.`;
      }
      if (!confirm(message)) return;
    }
    const recorded = await mutate(
      "/api/plots/apply",
      {slots: [plot.slot], confirmed: requiresConfirmation},
      plot.partial_update_ready ? "Applying partial update…" : manualLayout ? "Replacing the planted layout with the recommendation…" : "Recording planted layout…",
    );
    if (recorded) closeDrawer();  // done with this plot: back to the map
  });
  $("#clearPlot")?.addEventListener("click", () => {
    if (confirm(`Clear the recorded planting for ${plot.slot}? The parent plants return to free inventory.`)) mutate("/api/plots/clear", {slots: [plot.slot]}, "Clearing plot…");
  });
}

function managedTargetRow(scope, job, index) {
  const jobId = job.job_id || (index === 0 ? "primary" : `job-${index + 1}`);
  const route = job.method === "manual"
    ? "Manually specified goal"
    : `${humanMethod(job.method)} · ${(job.parents || []).join(" + ")}`;
  const state = scope === "actual" && job.work_label ? ` · ${job.work_label}` : "";
  return `<article class="managed-target-row" data-search="${escapeHtml(targetJobSearchText(job))}">
    <div><strong>${escapeHtml(job.target)}</strong><small>${escapeHtml(route + state)}</small></div>
    <div class="managed-target-actions">
      <button class="button secondary small" type="button" data-managed-scope="${scope}" data-managed-action="edit" data-managed-job-id="${escapeHtml(jobId)}">Edit</button>
      <button class="button danger small" type="button" data-managed-scope="${scope}" data-managed-action="remove" data-managed-job-id="${escapeHtml(jobId)}">Remove</button>
    </div>
  </article>`;
}

function openTargetManager(plot) {
  app.selectedPlot = plot;
  const actualJobs = plot.actual_jobs || (plot.actual ? [plot.actual] : []);
  const recommendedJobs = plot.recommended_jobs?.length
    ? plot.recommended_jobs
    : plot.recommended ? [plot.recommended] : [];
  $("#targetManagerRegion").textContent = `${plot.slot} · ${plot.region} · ${plot.name}`;
  $("#managedActualTargets").innerHTML = actualJobs.length
    ? actualJobs.map((job, index) => managedTargetRow("actual", job, index)).join("")
    : `<p class="managed-target-empty">No Actual targets are tracked on this plot.</p>`;
  $("#managedRecommendationTargets").innerHTML = recommendedJobs.length
    ? recommendedJobs.map((job, index) => managedTargetRow("recommendation", job, index)).join("")
    : `<p class="managed-target-empty">No recommendation targets are saved for this plot.</p>`;
  $("#addActualTarget").disabled = !(plot.actual_cells || []).length;
  $("#addActualTarget").title = plot.actual_cells?.length
    ? "Attach an Actual goal to the plants recorded on this plot"
    : "Record planted cells on this plot before adding an Actual goal";
  const search = $("#targetManagerSearch");
  search.value = "";
  search.closest("label").hidden = actualJobs.length + recommendedJobs.length <= TARGETS_SHOWN;
  search.oninput = () => {
    const query = search.value.trim().toLowerCase();
    $$("#targetManagerDialog .managed-target-row").forEach(row => { row.hidden = Boolean(query) && !row.dataset.search.includes(query); });
  };
  $("#targetManagerDialog").showModal();
  $$("[data-managed-action]").forEach(button => button.addEventListener("click", () => {
    const scope = button.dataset.managedScope;
    const action = button.dataset.managedAction;
    const jobId = button.dataset.managedJobId;
    const source = scope === "actual" ? actualJobs : recommendedJobs;
    const index = source.findIndex((job, jobIndex) =>
      (job.job_id || (jobIndex === 0 ? "primary" : `job-${jobIndex + 1}`)) === jobId
    );
    const selected = index >= 0 ? source[index] : null;
    if (action === "edit" && selected) {
      openManagedTargetEditor(plot, scope, action, selected, jobId);
      return;
    }
    if (action === "remove" && selected) {
      const message = scope === "actual"
        ? `Stop tracking ${selected.target} as an Actual goal on ${plot.slot}? Its recorded plants will stay in place.`
        : `Remove ${selected.target} from the saved recommendation for ${plot.slot}? Other targets will stay unchanged.`;
      if (!confirm(message)) return;
      $("#targetManagerDialog").close();
      mutate("/api/plots/targets", {
        slot: plot.slot, scope, action, job_id: jobId,
      }, `Removing ${scope === "actual" ? "Actual" : "recommendation"} target…`);
    }
  }));
  $("#addActualTarget").onclick = () => openManagedTargetEditor(plot, "actual", "add");
  $("#addRecommendationTarget").onclick = () => openManagedTargetEditor(plot, "recommendation", "add");
}

function openManagedTargetEditor(plot, scope, action, assignment = null, jobId = null) {
  $("#targetManagerDialog").close();
  app.selectedPlot = plot;
  app.targetDialogMode = scope;
  app.targetEditAction = action;
  app.targetEditJobId = jobId;
  if (assignment) {
    $("#targetFlower").value = assignment.target_type;
    $("#targetColor").value = assignment.target_color;
    $("#targetPatternEdit").value = assignment.target_pattern;
  } else if (scope === "actual" && plot.manual_target_candidates?.[0]) {
    const candidate = plot.manual_target_candidates[0];
    $("#targetFlower").value = candidate.target_type;
    $("#targetColor").value = candidate.target_color;
    $("#targetPatternEdit").value = candidate.target_pattern;
  } else {
    const current = (scope === "actual" ? plot.actual : plot.recommended);
    if (current) {
      $("#targetFlower").value = current.target_type;
      $("#targetColor").value = current.target_color;
      $("#targetPatternEdit").value = current.target_pattern;
    }
  }
  $("#targetDialogRegion").textContent = `${plot.slot} · ${plot.region} · ${scope === "actual" ? "Actual farm" : "Recommendation"}`;
  const verb = action === "edit" ? "Edit" : "Add";
  $("#targetDialogTitle").textContent = `${verb} ${scope === "actual" ? "Actual" : "recommendation"} target`;
  resetTargetPreview();
  $("#targetDialog").showModal();
}

function targetPayload() {
  return {
    slot: app.selectedPlot.slot,
    scope: app.targetDialogMode,
    action: app.targetEditAction,
    job_id: app.targetEditJobId,
    flower_type: $("#targetFlower").value,
    color: $("#targetColor").value,
    pattern: $("#targetPatternEdit").value,
  };
}

function resetTargetPreview() {
  app.targetPreview = null;
  const manual = app.targetDialogMode === "actual";
  $("#applyTarget").disabled = true;
  const verb = app.targetEditAction === "edit" ? "Save target changes" : "Add target";
  $("#applyTarget").textContent = verb;
  $("#targetPreview").innerHTML = `<p>${manual
    ? "Choose the Actual goal, then check it against the plants already recorded on this plot. Saving changes only the tracked goal; the planted cells stay in place."
    : "Choose a recommendation goal. The planner reserves the other targets and checks that this additional route fits the plot."}</p>`;
}

async function previewTarget() {
  const manual = app.targetDialogMode === "actual";
  loading(true, manual ? "Checking Actual target…" : "Checking target and plot space…");
  try {
    const result = await api("/api/plots/targets/preview", {
      method: "POST",
      body: JSON.stringify(targetPayload()),
    });
    app.targetPreview = result;
    const assignment = result.assignment;
    const warnings = result.warnings || [];
    if (manual) {
      const candidateHtml = (result.candidates || []).length
        ? `<div class="manual-target-candidates"><strong>Targets recognized from these plants</strong>${result.candidates.slice(0, 8).map(item => `<span>${escapeHtml(item.target)} · ${humanMethod(item.method)} · ${item.parents.map(escapeHtml).join(" + ")}</span>`).join("")}</div>`
        : "";
      const attachedTargets = result.attached_targets || [];
      const attachedHtml = attachedTargets.length
        ? `<div class="manual-target-candidates"><strong>Targets already attached</strong>${attachedTargets.map(target => `<span>${escapeHtml(target)}</span>`).join("")}</div>`
        : "";
      const statusHtml = result.verified
        ? `<div class="success-box"><strong>Route recognized</strong><p>The recorded plants match ${escapeHtml(humanMethod(assignment.method))}: ${assignment.parents.map(escapeHtml).join(" + ")}.</p></div>`
        : `<div class="warning-box"><strong>Target not verified from the recorded plants</strong><p>You can still track it as the intended Actual goal. The plants and cell layout will not change.</p></div>`;
      const editVerb = app.targetEditAction === "edit" ? "Update this Actual goal" : "Add as another Actual goal";
      $("#targetPreview").innerHTML = `${statusHtml}${warnings.length ? `<div class="warning-box"><ul>${warnings.map(item => `<li>${escapeHtml(item)}</li>`)}</ul></div>` : ""}<div class="detail-card"><h3>${escapeHtml(assignment.target)}</h3><div class="detail-list"><div><strong>Method:</strong> ${result.verified ? humanMethod(assignment.method) : "Manual"}</div><div><strong>Recorded parents:</strong> ${assignment.parents.length ? assignment.parents.map(escapeHtml).join(" + ") : "None"}</div><div><strong>Action:</strong> ${editVerb}</div></div></div>${attachedHtml}${candidateHtml}`;
      $("#applyTarget").disabled = false;
      $("#applyTarget").textContent = app.targetEditAction === "edit" ? "Save Actual target" : "Add Actual target";
    } else {
      const warningHtml = warnings.length ? `
        <div class="warning-box"><strong>Check before changing</strong><ul>${warnings.map(item => `<li>${escapeHtml(item)}</li>`).join("")}</ul></div>` :
        `<div class="success-box">This target is not already owned or assigned to another plot.</div>`;
      $("#targetPreview").innerHTML = `
        ${warningHtml}
        <div class="detail-card">
          <h3>${escapeHtml(assignment.target)}</h3>
          <div class="detail-list">
            <div><strong>Method:</strong> ${humanMethod(assignment.method)}</div>
            <div><strong>Parents:</strong> ${assignment.parents.map(escapeHtml).join(" + ")}</div>
            <div><strong>Chance/day:</strong> ${(assignment.daily_probability * 100).toFixed(1)}%</div>
            <div><strong>Stock goal:</strong> ${assignment.stock_goal}</div>
          </div>
          ${matrixHtml(result.grid, app.selectedPlot.cols, false, assignment)}
        </div>`;
      $("#applyTarget").disabled = false;
      $("#applyTarget").textContent = app.targetEditAction === "edit" ? "Save recommendation target" : "Add recommendation target";
    }
  } catch (error) {
    app.targetPreview = null;
    $("#applyTarget").disabled = true;
    $("#targetPreview").innerHTML = `<div class="warning-box"><strong>${manual ? "Cannot attach this target" : "Target is not possible in this plot"}</strong><p>${escapeHtml(error.message)}</p></div>`;
  } finally {
    loading(false);
  }
}

async function applyTarget() {
  if (!app.targetPreview) return;
  const warnings = app.targetPreview.warnings || [];
  if (warnings.length && !confirm(`Review these warnings before saving:\n\n${warnings.join("\n")}\n\nContinue?`)) return;
  const manual = app.targetDialogMode === "actual";
  const payload = {...targetPayload(), confirmed: true};
  $("#targetDialog").close();
  loading(true, manual ? "Saving Actual target…" : "Saving recommendation target…");
  try {
    const result = await api("/api/plots/targets", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    toast(result.message);
    await refreshState(false);
  } catch (error) {
    toast(error.message, true);
  } finally {
    loading(false);
  }
}

function openMapDetailsDialog(plot) {
  app.selectedPlot = plot;
  $("#mapDetailsRegion").textContent = `${plot.region} · ${plot.slot}`;
  $("#mapDetailsTitle").textContent = "Edit map card layout";
  $("#mapPlotName").value = plot.name;
  $("#mapPlotLocation").value = plot.location || "";
  $("#mapPlotColumn").value = plot.map_position.column;
  $("#mapPlotRow").value = plot.map_position.row;
  $("#mapPlotSpan").value = plot.map_position.span;
  $("#mapDetailsDialog").showModal();
}

async function saveMapDetails() {
  const plot = app.selectedPlot;
  if (!plot) return;
  const payload = {
    slot: plot.slot,
    name: $("#mapPlotName").value,
    location: $("#mapPlotLocation").value,
    column: Number($("#mapPlotColumn").value),
    row: Number($("#mapPlotRow").value),
    span: Number($("#mapPlotSpan").value),
  };
  $("#mapDetailsDialog").close();
  loading(true, "Saving map card layout…");
  try {
    const result = await api("/api/plots/map", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    toast(result.message);
    await refreshState(false);
  } catch (error) {
    toast(error.message, true);
  } finally {
    loading(false);
  }
}

function closeDrawer() {
  $("#plotDrawer").classList.remove("open");
  $("#drawerScrim").classList.remove("open");
  $("#plotDrawer").setAttribute("aria-hidden", "true");
}

function inventoryLocationHtml(item) {
  const locations = item.planted_locations || [];
  if (!locations.length) return item.planted > 0 ? `<span class="inventory-location-missing" title="A planted reservation exists, but no exact recorded cell location was found.">Unknown</span>` : `<span class="inventory-location-none">—</span>`;
  return `<div class="inventory-locations">${locations.map(location => {
    const detail = [location.name, location.location, location.region].filter(Boolean).join(" · ");
    const count = Number(location.count || 0);
    return `<button type="button" class="inventory-location-link" data-inventory-plot="${escapeHtml(location.slot)}" title="${escapeHtml(detail || location.slot)}">${escapeHtml(location.slot)}${count > 1 ? ` ×${count}` : ""}</button>`;
  }).join("")}</div>`;
}

function focusPlotFromInventory(slot) {
  const plot = app.state?.plots?.find(item => item.slot === slot);
  if (!plot) return;
  setActiveView("farm");
  const url = `${window.location.pathname}${HKIATabRoutes.toSearch(window.location.search, "farm")}${window.location.hash}`;
  window.history.pushState({tab: "farm"}, "", url);
  $("#regionFilter").value = plot.region;
  $("#statusFilter").value = "";
  $("#plotSearch").value = plot.slot;
  renderPlots();
  openPlot(plot.slot);
}

function renderInventory() {
  if (!app.inventoryLoaded) {
    $("#inventoryBody").innerHTML = "";
    $("#inventoryCount").textContent = "Loading your inventory…";
    return;
  }
  const query = $("#inventorySearch").value.trim().toLowerCase();
  const type = $("#inventoryType").value;
  const pattern = $("#inventoryPattern").value;
  const owned = $("#inventoryOwned").value;
  const hideNoFree = $("#inventoryHideNoFree").checked;
  const hideAbundant = $("#inventoryHideAbundant").checked;
  const rows = app.state.inventory.filter(item => {
    return (!query || item.label.toLowerCase().includes(query)) &&
      (!type || item.flower_type === type) &&
      (!pattern || item.pattern === pattern) &&
      (!owned || (owned === "owned" ? item.collected : !item.collected)) &&
      (!hideNoFree || item.free > 0) &&
      (!hideAbundant || item.free <= 30);
  });

  const requestedSize = Number($("#inventoryPageSize")?.value || app.inventoryPageSize || 100);
  app.inventoryPageSize = [50, 100, 200].includes(requestedSize) ? requestedSize : 100;
  const pageCount = Math.max(1, Math.ceil(rows.length / app.inventoryPageSize));
  app.inventoryPage = Math.min(Math.max(1, app.inventoryPage), pageCount);
  const start = (app.inventoryPage - 1) * app.inventoryPageSize;
  const end = Math.min(start + app.inventoryPageSize, rows.length);
  const pageRows = rows.slice(start, end);

  $("#inventoryBody").innerHTML = pageRows.map(item => {
    const key = encodeURIComponent([item.flower_type,item.color,item.pattern,item.secondary_color || ""].join("|"));
    return `
    <tr>
      <td><span class="variant-name">${escapeHtml(item.label)}</span><span class="variant-meta">${item.pattern} · primary ${item.color}${item.secondary_color ? ` · secondary ${item.secondary_color}` : (item.pattern === "Solid" || app.state.options.effect_patterns.includes(item.pattern)) ? "" : " · default secondary"}</span></td>
      <td><span class="collection-dot ${item.collected ? "owned" : ""}">${item.collected ? "Collected" : "Missing"}</span></td>
      <td class="number-cell">${item.total_label}</td><td class="number-cell">${item.planted}</td><td>${inventoryLocationHtml(item)}</td><td class="number-cell${item.over_reserved ? " inventory-shortage" : ""}">${item.free}${item.over_reserved ? `<span>${item.over_reserved} over</span>` : ""}</td>
      <td class="inventory-row-actions"><button class="button secondary small inventory-step" type="button" data-key="${key}" data-step="-" ${item.total > 0 ? "" : "disabled"} aria-label="Remove some ${escapeHtml(item.label)}" title="Remove a number of copies">−</button><button class="button secondary small inventory-step" type="button" data-key="${key}" data-step="-1" ${item.total > 0 ? "" : "disabled"} aria-label="Remove one ${escapeHtml(item.label)}" title="−1 copy">−1</button><button class="button secondary small inventory-step" type="button" data-key="${key}" data-step="1" aria-label="Add one ${escapeHtml(item.label)}" title="+1 copy">+1</button><button class="button secondary small inventory-step" type="button" data-key="${key}" data-step="+" aria-label="Add some ${escapeHtml(item.label)}" title="Add a number of copies">+</button><button class="button secondary small edit-inventory" data-key="${key}">Edit</button></td>
    </tr>
  `;
  }).join("");

  if (rows.length) {
    $("#inventoryCount").textContent = `Showing ${start + 1}–${end} of ${rows.length} matching variants.`;
  } else {
    $("#inventoryCount").textContent = "No matching variants.";
  }
  $("#inventoryPageIndicator").textContent = `Page ${app.inventoryPage} of ${pageCount}`;
  $("#inventoryPrevPage").disabled = app.inventoryPage <= 1;
  $("#inventoryNextPage").disabled = app.inventoryPage >= pageCount;
  $$(".edit-inventory").forEach(button => button.addEventListener("click", () => openInventoryEditor(decodeURIComponent(button.dataset.key).split("|"))));
  $$(".inventory-step").forEach(button => button.addEventListener("click", () => {
    const step = button.dataset.step;
    if (step === "+" || step === "-") openInventoryStepInput(button);
    else stepInventoryCount(button.dataset.key, Number(step));
  }));
  $$(".inventory-location-link").forEach(button => button.addEventListener("click", () => focusPlotFromInventory(button.dataset.inventoryPlot)));
}

// /api/state leaves out why each blocked goal is blocked (most of its size);
// fetch that only once the checklist is actually on screen.
async function loadBlockingRoutes() {
  const revision = app.stateRevision;
  if (app.blockingRoutesRevision === revision) return;
  app.blockingRoutesRevision = revision;
  try {
    const data = await api("/api/collection/blocking");
    if (revision !== app.stateRevision || !app.state) return;
    const details = new Map(data.routes.map(entry => [HKIACollectionChecklist.variantKey(entry), entry]));
    for (const item of app.state.inventory || []) {
      const entry = details.get(HKIACollectionChecklist.variantKey(item));
      if (!entry) continue;
      item.blocking_routes = entry.blocking_routes;
      item.blocking_reason = entry.blocking_reason;
    }
    if (app.activeView === "inventory" && app.inventorySubView === "checklist") renderCollectionChecklist();
  } catch (error) {
    if (app.blockingRoutesRevision === revision) app.blockingRoutesRevision = null;
  }
}

function renderCollectionChecklist() {
  if (app.activeView === "inventory" && app.inventorySubView === "checklist") loadBlockingRoutes();
  const rows = app.state.inventory || [];
  const options = app.state.options;
  const placements = HKIACollectionChecklist.buildPlacementIndex(app.state.targets?.current || []);
  const extremeTypes = new Set(options.extremophile_flower_types || []);
  const standardRows = rows.filter(item => item.in_scope && !item.extremophile && !item.secondary_color);
  const extremeRows = rows.filter(item => item.in_scope && item.extremophile && !item.secondary_color);
  const standardTypes = (options.target_flower_types || []).filter(type => !extremeTypes.has(type));
  const extremophileTypes = (options.target_flower_types || []).filter(type => extremeTypes.has(type));
  const allTypes = options.flower_types || [];
  const nonDefaultPatterns = options.colored_patterns || [];
  const nonDefaultSummaries = HKIACollectionChecklist.nonDefaultPatternSummary({
    inventory: rows,
    flowerTypes: allTypes,
    colors: options.colors || [],
    patterns: nonDefaultPatterns,
    flowerPatterns: options.flower_patterns || {},
  });
  const nonDefaultSummary = nonDefaultSummaries.reduce((total, item) => ({
    acquired: total.acquired + item.acquired,
    missing: total.missing + item.missing,
    total: total.total + item.total,
  }), {acquired: 0, missing: 0, total: 0});
  const scopeDefinitions = [
    {id: "standard", label: "Standard collection", rows: standardRows, summary: HKIACollectionChecklist.patternSummary(standardRows)},
    {id: "extremophiles", label: "Extremophiles", rows: extremeRows, summary: HKIACollectionChecklist.patternSummary(extremeRows)},
    {id: "nondefault", label: "Non-default secondary", rows: [], summary: nonDefaultSummaries},
  ];
  if (!scopeDefinitions.some(scope => scope.id === app.collectionScope)) app.collectionScope = "standard";
  const countLabel = summary => {
    const totals = Array.isArray(summary)
      ? summary.reduce((result, item) => ({acquired: result.acquired + item.acquired, total: result.total + item.total}), {acquired: 0, total: 0})
      : summary;
    return `${totals.acquired}/${totals.total}`;
  };
  $("#collectionScopeTabs").innerHTML = HKIACollectionChecklist.renderScopeTabs(
    scopeDefinitions.map(scope => ({...scope, summary: countLabel(scope.summary)})),
    app.collectionScope,
  );
  const nonDefaultSelected = app.collectionScope === "nondefault";
  $("#collectionSecondaryFilterWrap").classList.toggle("hidden", !nonDefaultSelected);
  if (nonDefaultSelected) {
    const secondarySelect = $("#collectionSecondaryFilter");
    const secondaryColors = options.colors || [];
    if (!secondaryColors.includes(app.collectionSecondary)) app.collectionSecondary = secondaryColors[0] || "";
    secondarySelect.innerHTML = secondaryColors.map(color => `<option value="${escapeHtml(color)}">${escapeHtml(color)}</option>`).join("");
    secondarySelect.value = app.collectionSecondary;
  }

  const scopeRows = app.collectionScope === "standard" ? standardRows : extremeRows;
  const scopeTypes = app.collectionScope === "standard" ? standardTypes : extremophileTypes;
  const summaries = nonDefaultSelected
    ? nonDefaultSummaries
    : HKIACollectionChecklist.patternSummary(scopeRows);
  const summaryByPattern = new Map(summaries.map(item => [item.pattern, item]));
  const patterns = (nonDefaultSelected ? nonDefaultPatterns : (options.patterns || []))
    .filter(pattern => summaryByPattern.has(pattern));
  if (!patterns.length) {
    $("#collectionPatternTabs").innerHTML = "";
    $("#collectionGrid").innerHTML = `<tbody><tr><td class="collection-empty">No collection goals are active.</td></tr></tbody>`;
    $("#collectionChecklistProgress").textContent = "0 goals";
    $("#collectionChecklistNote").textContent = nonDefaultSelected
      ? "No compatible colored patterns are available for non-default secondary combinations."
      : "No collection goals are active in this section.";
    return;
  }
  if (!patterns.includes(app.collectionPattern)) app.collectionPattern = patterns[0];
  const allGoals = nonDefaultSelected ? nonDefaultSummary.total : summaries.reduce((total, item) => total + item.total, 0);
  const allAcquired = nonDefaultSelected ? nonDefaultSummary.acquired : summaries.reduce((total, item) => total + item.acquired, 0);
  const allMissing = nonDefaultSelected ? nonDefaultSummary.missing : allGoals - allAcquired;
  $("#collectionChecklistProgress").textContent = `${allAcquired} acquired · ${allMissing} missing`;
  $("#collectionPatternTabs").innerHTML = HKIACollectionChecklist.renderPatternTabs(patterns, summaries, app.collectionPattern);

  const targetColors = options.target_colors || [];
  const gameColors = options.colors || [];
  const colors = nonDefaultSelected
    ? gameColors
    : [...gameColors.filter(color => targetColors.includes(color)), ...targetColors.filter(color => !gameColors.includes(color))];
  const matrixOptions = {
    inventory: rows,
    flowerTypes: nonDefaultSelected ? allTypes : scopeTypes,
    colors,
    pattern: app.collectionPattern,
    search: $("#collectionBreedSearch").value,
    breedFilter: $("#collectionBreedFilter").value,
    placements,
  };
  const view = nonDefaultSelected
    ? HKIACollectionChecklist.renderNonDefaultMatrix({
      ...matrixOptions,
      secondaryColor: app.collectionSecondary,
      flowerPatterns: options.flower_patterns || {},
    })
    : HKIACollectionChecklist.renderMatrix({...matrixOptions, inventory: scopeRows});
  $("#collectionGrid").innerHTML = view.markup;
  const patternSummary = summaryByPattern.get(app.collectionPattern) || {acquired: 0, missing: 0, total: 0};
  const displayed = view.visibleBreeds === view.totalBreeds ? `${view.visibleBreeds} breeds` : `${view.visibleBreeds} of ${view.totalBreeds} breeds`;
  $("#collectionChecklistNote").textContent = nonDefaultSelected
    ? `${app.collectionPattern} · ${app.collectionSecondary} secondary: ${view.summary.acquired} acquired, ${view.summary.missing} missing · ${displayed}. This catalog is separate from Generate Plan goals; click a status to edit inventory.`
    : `${app.collectionScope === "extremophiles" ? "Extremophiles · " : ""}${app.collectionPattern}: ${patternSummary.acquired} acquired, ${patternSummary.missing} missing · ${displayed}. Click a status to edit that flower's inventory record.`;
}

function setInventorySubView(view) {
  app.inventorySubView = view === "checklist" ? "checklist" : "stock";
  const checklistActive = app.inventorySubView === "checklist";
  $("#collectionChecklistPanel").classList.toggle("hidden", !checklistActive);
  $("#collectionChecklistPanel").setAttribute("aria-hidden", String(!checklistActive));
  $("#physicalInventoryPanel").classList.toggle("hidden", checklistActive);
  $("#physicalInventoryPanel").setAttribute("aria-hidden", String(checklistActive));
  $$(".inventory-view-tab").forEach(button => {
    const active = button.dataset.inventoryView === app.inventorySubView;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });
  if (app.state) renderVisibleState();
}

function setInventoryPage(page) {
  app.inventoryPage = Math.max(1, Number(page) || 1);
  renderInventory();
  const wrap = $("#inventoryTableWrap");
  if (wrap) wrap.scrollTop = 0;
  window.scrollTo({top: 0});  // the Next/Previous buttons sit below the table
}

// Quick steps on an inventory row: +N adds copies, −N sets the total N lower.
function stepInventoryCount(key, amount) {
  const [flower_type, color, pattern, secondary_color] = decodeURIComponent(key).split("|");
  const item = app.state.inventory.find(row => row.flower_type === flower_type && row.color === color
    && row.pattern === pattern && (row.secondary_color || "") === secondary_color);
  if (!item || !amount) return;
  const base = {flower_type, color, pattern, secondary_color: secondary_color || null};
  if (amount > 0) saveInventoryCount({...base, action: "add", count: amount});
  else if (item.total > 0) saveInventoryCount({...base, action: "set", count: Math.max(0, item.total + amount)});
}

// "+" / "−": the button turns into a small number box. Enter or leaving the
// box with a number in it saves (the iOS number pad has no Enter, only a
// Done check that blurs); Esc or leaving it empty puts the button back.
function openInventoryStepInput(button) {
  const sign = button.dataset.step === "-" ? -1 : 1;
  const input = document.createElement("input");
  Object.assign(input, {type: "number", min: "1", step: "1", inputMode: "numeric", enterKeyHint: "done", className: "inventory-step-input"});
  input.placeholder = sign > 0 ? "+" : "−";
  input.setAttribute("aria-label", button.getAttribute("aria-label"));
  let done = false;
  const restore = () => { if (!done) { done = true; input.replaceWith(button); } };
  const commit = () => {
    if (done) return;
    if (input.value.trim() === "") return restore();
    const count = Number(input.value);
    if (!Number.isInteger(count) || count < 1) {
      toast("Enter a whole number of 1 or more.", true);
      return restore();
    }
    restore();
    stepInventoryCount(button.dataset.key, sign * count);
  };
  input.addEventListener("keydown", event => {
    if (event.key === "Escape") restore();
    if (event.key === "Enter") commit();
  });
  input.addEventListener("blur", commit);
  button.replaceWith(input);
  input.focus();
}

function resetInventoryPagination() {
  app.inventoryPage = 1;
  renderInventory();
}

function targetMatches(item) {
  const query = $("#targetSearch").value.trim().toLowerCase();
  const pattern = $("#targetPattern").value;
  const text = [item.target, item.slot, item.plot, item.region, item.method, ...(item.parents || [])].join(" ").toLowerCase();
  return (!query || text.includes(query)) && (!pattern || item.target_pattern === pattern);
}

function targetVariant(item) {
  const flower = {color: item.target_color, pattern: item.target_pattern};
  return `<span class="target-variant"><i class="target-swatch" style="${flowerStyle(flower)}"></i><span><strong>${escapeHtml(item.target)}</strong><small>${escapeHtml(item.target_pattern)} · goal ${item.stock_goal}</small></span></span>`;
}

function targetStatus(item) {
  if (item.status === "goal_reached") return ["goal_reached", "Goal reached"];
  if (item.status === "keep") return ["keep", "Keep"];
  if (item.status === "review") return ["review", "Review"];
  return ["new_work", "New work"];
}

function renderTargets() {
  const targetState = app.state.targets || {current: [], summary: {}};
  const summary = targetState.summary || {};
  const cards = [
    ["Current jobs", summary.current_jobs || 0, `${summary.planted_jobs || 0} recorded as planted`],
    ["Blocked targets", summary.blocked_targets || 0, "no valid route currently"],
  ];
  $("#targetSummaryGrid").innerHTML = cards.map(([label, value, note]) => `
    <article class="summary-card"><p>${label}</p><strong>${value}</strong><small>${note}</small></article>
  `).join("");

  const current = targetState.current.filter(targetMatches);
  $("#currentTargetsBody").innerHTML = current.map(item => {
    const [statusClass, statusLabel] = targetStatus(item);
    return `<tr>
      <td>${targetVariant(item)}</td>
      <td><strong>${escapeHtml(item.slot)}</strong><span class="variant-meta">${escapeHtml(item.region)} · ${escapeHtml(item.plot)}</span></td>
      <td>${humanMethod(item.method)}</td>
      <td class="target-parents">${item.parents.map(escapeHtml).join("<br>")}</td>
      <td class="number-cell">${item.method === "manual" || item.manual_target ? "Manual" : `${(item.daily_probability * 100).toFixed(1)}%`}</td>
      <td><span class="status ${statusClass}">${statusLabel}</span></td>
    </tr>`;
  }).join("") || `<tr><td colspan="6" class="empty-table">No current targets match these filters.</td></tr>`;
  $("#currentTargetCount").textContent = `${current.length} of ${targetState.current.length} current jobs`;
}

function openInventoryEditor(values = null) {
  let item = null;
  if (values) {
    [$("#editFlower").value, $("#editColor").value, $("#editPattern").value] = values;
    refreshInventorySecondarySelector(values[3] || "");
    item = app.state.inventory.find(row => row.flower_type === values[0] && row.color === values[1] && row.pattern === values[2] && (row.secondary_color || "") === (values[3] || ""));
    $("#editCount").value = item?.total || 0;
  } else {
    $("#editCount").value = 1;
    refreshInventorySecondarySelector();
  }
  app.editingInventoryItem = item;
  const canShowUncollect = Boolean(item?.collected && item.total === 0);
  const uncollectButton = $("#inventoryUncollectAction");
  uncollectButton.classList.toggle("hidden", !canShowUncollect);
  uncollectButton.disabled = Boolean(canShowUncollect && item.planted > 0);
  uncollectButton.title = uncollectButton.disabled ? "Remove planted copies before marking this flower uncollected." : "";
  $("#editAddCount").value = 1;
  $("#inventoryDialog").showModal();
}

function refreshInventorySecondarySelector(selected = null) {
  const pattern = $("#editPattern").value;
  const primary = $("#editColor").value;
  const enabled = app.state.options.colored_patterns.includes(pattern);
  const node = $("#editSecondary");
  const previous = selected ?? node.value;
  const defaultColor = primary === "White" ? "Warm Pink" : "White";
  const values = ["", ...app.state.options.colors.filter(color => color !== primary)];
  node.innerHTML = values.map(value => `<option value="${escapeHtml(value)}">${escapeHtml(value || `Default (${defaultColor})`)}</option>`).join("");
  node.disabled = !enabled;
  node.value = enabled && values.includes(previous) ? previous : "";
}

async function markInventoryUncollected() {
  const item = app.editingInventoryItem;
  if (!item || item.total !== 0 || item.planted !== 0) return;
  const payload = {
    action: "uncollect",
    flower_type: item.flower_type,
    color: item.color,
    pattern: item.pattern,
    secondary_color: item.secondary_color || null,
    count: 0,
  };
  $("#inventoryDialog").close();
  await mutate("/api/inventory", payload, "Marking flower uncollected…");
}

async function updateInventory(action) {
  const payload = {
    action,
    flower_type: $("#editFlower").value,
    color: $("#editColor").value,
    pattern: $("#editPattern").value,
    secondary_color: $("#editSecondary").value || null,
    count: Number(action === "add" ? $("#editAddCount").value : $("#editCount").value),
  };
  $("#inventoryDialog").close();
  await saveInventoryCount(payload);
}

function clearAllPlots() {
  const planted = app.state.plots.filter(plot => plot.actual_state !== "unplanted");
  if (!planted.length) {
    toast("No planted plots to clear.");
    return;
  }
  const count = planted.length;
  const confirmed = confirm(
    `Clear the recorded Actual planting from all ${count} planted plot${count === 1 ? "" : "s"}?\n\n` +
    "Recommendations and inventory totals will stay unchanged. Planted reservations will return to free inventory."
  );
  if (!confirmed) return;
  closeDrawer();
  mutate(
    "/api/plots/clear",
    {slots: planted.map(plot => plot.slot)},
    `Clearing ${count} planted plot${count === 1 ? "" : "s"}…`,
  );
}

function renderVisibleState() {
  if (!app.state) return;
  renderSummary();
  if (app.activeView === "inventory") {
    if (app.inventorySubView === "stock") renderInventory();
    else renderCollectionChecklist();
  } else if (app.activeView === "farm") {
    renderReservationWarnings();
    renderPlots();
    if (app.selectedPlot) openPlot(app.selectedPlot.slot, false);
  } else if (app.activeView === "targets") renderTargets();
  else if (app.activeView === "history") renderHistory();
}

function scheduleInventorySync() {
  clearTimeout(app.inventorySyncTimer);
  app.inventorySyncTimer = setTimeout(syncInventoryState, 200);
}

async function syncInventoryState() {
  if (!app.inventoryStateDirty) return;
  if (app.inventorySaving || app.inventorySyncRunning) {
    scheduleInventorySync();
    return;
  }
  app.inventorySyncRunning = true;
  const revision = app.stateRevision;
  try {
    const state = await api("/api/state");
    // An older refresh must never overwrite a count saved while it was running.
    if (revision !== app.stateRevision || app.inventorySaving) {
      scheduleInventorySync();
      return;
    }
    app.state = state;
    app.inventoryStateDirty = false;
    renderVisibleState();
  } catch (error) {
    toast(`Count saved; dashboard refresh failed: ${error.message}`, true);
  } finally {
    app.inventorySyncRunning = false;
  }
}

async function saveInventoryCount(payload) {
  app.stateRevision += 1;
  app.inventorySaving = true;
  clearTimeout(app.inventorySyncTimer);
  loading(true, "Saving inventory count…");
  try {
    const result = await api("/api/inventory", {method: "POST", body: JSON.stringify(payload)});
    if (!result.inventory_item || !app.state) {
      await refreshState(false);
      app.inventoryStateDirty = false;
    } else {
      const patch = result.inventory_item;
      const item = app.state.inventory.find(row => row.flower_type === patch.flower_type
        && row.color === patch.color && row.pattern === patch.pattern
        && (row.secondary_color || "") === (patch.secondary_color || ""));
      if (item) Object.assign(item, patch);
      else app.state.inventory.push({...patch, planted_locations: []});
      const delta = Number(result.collection_delta || 0);
      app.state.summary.owned_targets += delta;
      app.state.summary.missing_targets -= delta;
      app.inventoryStateDirty = true;
      renderVisibleState();
    }
    toast(result.message || "Count saved.");
  } catch (error) {
    toast(error.message, true);
  } finally {
    app.inventorySaving = false;
    loading(false);
    if (app.inventoryStateDirty) scheduleInventorySync();
  }
}

// Free copies of a flower in inventory, i.e. spares that could be planted.
const spareCopies = flower => ((app.state && app.state.inventory) || []).find(row => sameFlower(row, flower))?.free || 0;

// A fertilizer find: the planted solid turned into the new pattern where it
// stands. Ask which bed plant it was and whether it was dug up (a dug-up
// flower is in inventory, free to plant elsewhere). Default to swapping in a
// spare solid so the bed keeps working, or to dug up when there is none.
// Records a find for one of the plot's targets. "Where it appeared" catches finds filed under
// the wrong plot (e.g. a Greenhouse find recorded here because this plot has the same target):
// a find from elsewhere adds the copy but leaves this plot's plants as they are.
function openFoundDialog(plot, job, jobId, elsewhere = false) {
  const fertilize = String(job.method || "").startsWith("fertilize_");
  const solid = (job.parent_flowers || [])[0] || {};
  const bed = new Set(((job.layout || {}).parent_a_cells || []).map(([r, c]) => `${r}:${c}`));
  const cells = fertilize ? (plot.actual_cells || []).filter(c => sameFlower(c, solid))
    .sort((a, b) => (bed.has(`${b.row}:${b.col}`) - bed.has(`${a.row}:${a.col}`)) || a.row - b.row || a.col - b.col) : [];
  // A fertilizer find changes a plant in place: with none of that plant here, it came from elsewhere.
  const canBeHere = !fertilize || cells.length > 0;
  const others = (app.state.plots || []).filter(p => p.slot !== plot.slot)
    .sort((a, b) => (b.slot === "GH") - (a.slot === "GH"));
  const places = [
    ...(canBeHere ? [[plot.slot, `Here in ${plot.slot}`]] : []),
    ...others.map(p => [p.slot, p.slot === "GH" ? "In the Greenhouse" : `In ${p.slot} · ${p.name}`]),
    ["inventory", "Not sure: I spotted it in my inventory"],
  ];
  const place = $("#foundDialogPlace");
  place.innerHTML = places.map(([value, label]) => `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`).join("");
  place.value = canBeHere && !elsewhere ? plot.slot : (others.some(p => p.slot === "GH") ? "GH" : "inventory");
  const warning = $("#foundDialogWarning");
  warning.hidden = canBeHere;
  warning.textContent = canBeHere ? "" : `No ${job.parents?.[0] || "plant for it"} is recorded in ${plot.slot}, so it can't have changed there. Where did you find it?`;
  $("#foundDialogPlot").textContent = `${plot.slot} · ${fertilize ? "fertilizer find" : "target found"}`;
  $("#foundDialogTitle").textContent = `Found ${job.target}`;
  $("#foundDialogCell").innerHTML = cells.map(c => `<option value="${c.row},${c.col}">R${c.row + 1}·C${c.col + 1}${c.tag ? ` (${escapeHtml(c.tag)})` : ""}</option>`).join("");
  $("#foundDialogWhere").value = spareCopies(solid) > 0 ? "replaced" : "dug";
  const sync = () => {
    const here = place.value === plot.slot;
    $("#foundDialogCellField").hidden = !(fertilize && here);
    $("#foundDialogWhereField").hidden = !(fertilize && here);
    $("#foundDialogHelp").textContent = here && fertilize
      ? `One ${job.parents?.[0] || "bed plant"} turned into ${job.target}. Inventory: ${job.parents?.[0] || "the solid"} −1, ${job.target} +1.`
      : here ? `Adds one ${job.target} to your inventory.`
      : `Adds one ${job.target} to your inventory and marks this target found. ${plot.slot}'s plants stay as they are.`;
  };
  place.onchange = sync;
  sync();
  $("#foundDialogSave").onclick = () => {
    const here = place.value === plot.slot;
    const value = $("#foundDialogCell").value;
    $("#foundDialog").close();
    mutate("/api/found", {
      slot: plot.slot, job_id: jobId, count: 1,
      found_in: here ? null : place.value,
      cell: here && value ? value.split(",").map(Number) : null,
      dug_up: here && fertilize && $("#foundDialogWhere").value === "dug",
      replaced: here && fertilize && $("#foundDialogWhere").value === "replaced",
    }, "Recording target…");
  };
  $("#foundDialog").showModal();
}

// A planted flower changed pattern without a planned job, e.g. stray
// fertilizer: update that cell and move one count between the two variants.
function openPlantChangedDialog(plot) {
  const options = app.state.options;
  const cells = [...(plot.actual_cells || [])].sort((a, b) =>
    (a.pattern !== "Solid") - (b.pattern !== "Solid") || a.row - b.row || a.col - b.col);
  if (!cells.length) return toast("Nothing is recorded as planted here.", true);
  $("#plantChangedPlot").textContent = `${plot.slot} · plant changed`;
  $("#plantChangedCell").innerHTML = cells.map(c =>
    `<option value="${c.row},${c.col}">R${c.row + 1}·C${c.col + 1} · ${escapeHtml(flowerVariantLabel(c))}${c.tag ? ` (${escapeHtml(c.tag)})` : ""}</option>`).join("");
  const selected = () => {
    const [row, col] = $("#plantChangedCell").value.split(",").map(Number);
    return cells.find(c => c.row === row && c.col === col);
  };
  const fillPatterns = () => {
    const cell = selected();
    const patterns = ["Solid", ...(options.flower_patterns?.[cell.flower_type] || [])]
      .filter((pattern, index, all) => pattern !== cell.pattern && all.indexOf(pattern) === index);
    const fertilized = options.default_patterns?.[cell.flower_type];
    $("#plantChangedPattern").innerHTML = patterns.map(pattern =>
      `<option value="${escapeHtml(pattern)}">${escapeHtml(pattern)}${pattern === fertilized ? " (fertilizer)" : ""}</option>`).join("");
    if (patterns.includes(fertilized)) $("#plantChangedPattern").value = fertilized;
    defaultWhere();
  };
  // A plant hit by fertilizer is usually swapped for a spare copy right away,
  // so default to that (or to dug up when no spare is free).
  const defaultWhere = () => {
    const cell = selected();
    const fertilized = options.default_patterns?.[cell.flower_type];
    $("#plantChangedWhere").value = $("#plantChangedPattern").value !== fertilized ? "planted"
      : spareCopies(cell) > 0 ? "replaced" : "dug";
    summarize();
  };
  const summarize = () => {
    const cell = selected();
    const after = flowerVariantLabel({...cell, pattern: $("#plantChangedPattern").value, secondary_color: null});
    const replaced = $("#plantChangedWhere").value === "replaced";
    $("#plantChangedSummary").textContent = `Inventory: ${flowerVariantLabel(cell)} −1, ${after} +1.`
      + (replaced ? ` The spot keeps ${flowerVariantLabel(cell)}.`
        : cell.parent_role ? " This plant is a parent, so replant the plot afterwards." : "");
  };
  $("#plantChangedCell").onchange = fillPatterns;
  $("#plantChangedPattern").onchange = defaultWhere;
  $("#plantChangedWhere").onchange = summarize;
  fillPatterns();
  $("#plantChangedSave").onclick = () => {
    const cell = selected();
    $("#plantChangedDialog").close();
    mutate("/api/plots/plant-changed", {
      slot: plot.slot, row: cell.row, col: cell.col,
      pattern: $("#plantChangedPattern").value,
      dug_up: $("#plantChangedWhere").value === "dug",
      replaced: $("#plantChangedWhere").value === "replaced",
    }, "Recording the change…");
  };
  $("#plantChangedDialog").showModal();
}

async function mutate(path, payload, message) {
  app.stateRevision += 1;
  clearTimeout(app.inventorySyncTimer);
  loading(true, message);
  try {
    const result = await api(path, {method: "POST", body: JSON.stringify(payload)});
    toast(result.message || "Updated.");
    // Refresh every dashboard count after a write, including all inventory totals,
    // planted reservations, and free-copy counts.
    await refreshState(false);
    if (path === "/api/plots/apply") await loadPlotChecks();  // recording a replant checks the plot
    app.inventoryStateDirty = false;
    return true;
  } catch (error) {
    toast(error.message, true);
    return false;
  } finally {
    loading(false);
    if (app.inventoryStateDirty) scheduleInventorySync();
  }
}

async function runPlan(payload) {
  try {
    const result = await api("/api/plan", {method: "POST", body: JSON.stringify(payload)});
    app.planGenerationState = result.state;
    toast("Plan generation started in the background. The previous plan stays available.");
    updatePlanGenerationIndicator(result);
  } catch (error) {
    toast(error.message, true);
  }
}

function updatePlanGenerationIndicator(status) {
  const button = $("#generatePlan");
  const active = ["starting", "running"].includes(status.state);
  button.disabled = active;
  showPlanProgressOnButton(active ? status.progress : null, active);
  // Unlike the old blocking modal, this stays in the regular page controls.
  $("#cancelPlan").classList.toggle("hidden", !active);
  $("#cancelPlan").disabled = !active;
}

// "Generating plan… 42%" with the stage as its tooltip (hkia_solver/progress.py).
function showPlanProgressOnButton(update, active = true) {
  const button = $("#generatePlan");
  if (!active) {
    button.textContent = "Generate plan";
    button.title = "";
    return;
  }
  const progress = update ? HKIAOnboarding.planProgressText(update) : null;
  button.textContent = progress ? `Generating plan… ${progress.percent}%` : "Generating plan…";
  button.title = progress ? [progress.stage, progress.detail].filter(Boolean).join(" · ") : "";
}

async function pollPlanGeneration() {
  try {
    const status = await api("/api/plan/status");
    const previous = app.planGenerationState;
    app.planGenerationState = status.state;
    updatePlanGenerationIndicator(status);
    if (["completed", "failed", "cancelled"].includes(status.state) &&
        ["starting", "running"].includes(previous)) {
      toast(status.message || status.state, status.state === "failed");
      if (status.state === "completed") await refreshState(false);
    }
  } catch (_error) { /* A subsequent poll will retry. */ }
}

async function cancelPlanUpdate() {
  $("#cancelPlan").disabled = true;
  try {
    const result = await api("/api/plan/cancel", {method: "POST", body: "{}"});
    toast(result.message || "Cancellation requested.");
  } catch (error) {
    toast(error.message, true);
  } finally {
    await pollPlanGeneration();
  }
}

function ensureFlowerTooltip() {
  let tooltip = $("#flowerTooltip");
  if (tooltip) return tooltip;
  tooltip = document.createElement("div");
  tooltip.id = "flowerTooltip";
  tooltip.className = "flower-tooltip";
  tooltip.setAttribute("role", "tooltip");
  tooltip.setAttribute("aria-hidden", "true");
  document.body.appendChild(tooltip);
  return tooltip;
}

function positionFlowerTooltip(tooltip, event) {
  const offset = 14;
  const margin = 10;
  let left = event.clientX + offset;
  let top = event.clientY + offset;
  const rect = tooltip.getBoundingClientRect();
  if (left + rect.width + margin > window.innerWidth) left = event.clientX - rect.width - offset;
  if (top + rect.height + margin > window.innerHeight) top = event.clientY - rect.height - offset;
  tooltip.style.left = `${Math.max(margin, left)}px`;
  tooltip.style.top = `${Math.max(margin, top)}px`;
}

function showFlowerTooltip(target, event) {
  const tooltip = ensureFlowerTooltip();
  const rows = [
    ["Breed", target.dataset.flowerBreed],
    ["Color", target.dataset.flowerColor],
    ["Pattern", target.dataset.flowerPattern],
  ];
  if (target.dataset.flowerSecondary) rows.push(["Secondary", target.dataset.flowerSecondary]);
  tooltip.innerHTML = `
    <div class="flower-tooltip-role">${escapeHtml(target.dataset.flowerRole || "Plant")}</div>
    <div class="flower-tooltip-name">${escapeHtml(target.dataset.flowerLabel || "Flower")}</div>
    <div class="flower-tooltip-meta">${rows.map(([key, value]) => `<span><b>${escapeHtml(key)}</b>${escapeHtml(value)}</span>`).join("")}</div>
  `;
  tooltip.classList.add("visible");
  tooltip.setAttribute("aria-hidden", "false");
  positionFlowerTooltip(tooltip, event);
}

function hideFlowerTooltip() {
  const tooltip = $("#flowerTooltip");
  if (!tooltip) return;
  tooltip.classList.remove("visible");
  tooltip.setAttribute("aria-hidden", "true");
}

function bindFlowerTooltips() {
  document.addEventListener("pointerover", event => {
    const target = event.target.closest?.("[data-flower-tooltip]");
    if (!target) return;
    showFlowerTooltip(target, event);
  });
  document.addEventListener("pointermove", event => {
    const target = event.target.closest?.("[data-flower-tooltip]");
    const tooltip = $("#flowerTooltip");
    if (!target || !tooltip?.classList.contains("visible")) return;
    positionFlowerTooltip(tooltip, event);
  });
  // Touch has no hover: a tap shows the tooltip, which then stays until the next tap or a timeout.
  let touchTooltipTimer = 0;
  document.addEventListener("pointerdown", event => {
    if (event.pointerType !== "touch") return;
    clearTimeout(touchTooltipTimer);
    if (!event.target.closest?.("[data-flower-tooltip]")) hideFlowerTooltip();
    else touchTooltipTimer = setTimeout(hideFlowerTooltip, 3500);
  });
  document.addEventListener("pointerout", event => {
    if (event.pointerType === "touch") return;
    const target = event.target.closest?.("[data-flower-tooltip]");
    if (!target) return;
    const next = event.relatedTarget?.closest?.("[data-flower-tooltip]");
    if (next === target) return;
    hideFlowerTooltip();
  });
  document.addEventListener("focusin", event => {
    const target = event.target.closest?.("[data-flower-tooltip]");
    if (!target) return;
    const rect = target.getBoundingClientRect();
    showFlowerTooltip(target, {clientX: rect.left + rect.width / 2, clientY: rect.bottom});
  });
  document.addEventListener("focusout", event => {
    if (event.target.closest?.("[data-flower-tooltip]")) hideFlowerTooltip();
  });
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"})[char]);
}
// Spawn review is intentionally an inventory-only operation: it never edits Actual cells.
function spawnKey(row) {
  return HKIASpawnCatalog.key(row);
}
function spawnCatalog() {
  const rows = new Map();
  for (const row of app.state.inventory || []) rows.set(spawnKey(row), {...row});
  // Recent Actual and recommendation goals are prominently suggested even if unowned.
  for (const plot of app.state.plots || []) {
    for (const job of [...(plot.actual_jobs || []), ...(plot.recommended_jobs || [])]) {
      if (!job.target_type || !job.target_color || !job.target_pattern) continue;
      const key = JSON.stringify([job.target_type, job.target_color, job.target_pattern, job.target_secondary_color || null]);
      if (!rows.has(key)) rows.set(key, {
        flower_type: job.target_type, color: job.target_color, pattern: job.target_pattern,
        secondary_color: job.target_secondary_color || null, label: job.target,
        total: 0, planted: 0, collected: false,
      });
    }
  }
  return [...rows.values()];
}
function openSpawnDialog(slot = "") {
  // Spawns are recorded against your copies: wait for the inventory on a fresh load.
  if (!app.inventoryLoaded && app.inventoryPromise) {
    loading(true, "Loading your inventory…");
    app.inventoryPromise.finally(() => { loading(false); if (app.inventoryLoaded) openSpawnDialog(slot); });
    return;
  }
  app.spawnBasket.clear();
  app.spawnExpandedGroups = new Set();
  $("#spawnPlot").innerHTML = `<option value="">All plots</option>` + (app.state.plots || []).map(p => `<option value="${escapeHtml(p.slot)}">${escapeHtml(p.slot)} · ${escapeHtml(p.name)}</option>`).join("");
  $("#spawnPlot").value = slot || "";
  $("#spawnTitle").textContent = slot ? `Record spawns · ${slot}` : "Record new spawns";
  $("#spawnSearch").value = "";
  populateSelect($("#spawnColor"), app.state.options.colors, false);
  populateSelect($("#spawnPattern"), app.state.options.patterns, false);
  $("#spawnShowAbundant").checked = false;
  renderSpawnSuggestions();
  $("#spawnDialog").showModal();
  HKIAOnboarding.hint("spawns", $("#spawnDialog .spawn-controls"));
}
const SPAWN_GROUP_SHOWN = 12;
function spawnBadge(row) {
  const total = Number(row.total || 0);
  return total >= 30 && row.pattern === "Solid" ? "30+ · skipped" : total === 0 ? "Missing" : total < 10 ? `${total} · scarce` : `${total} owned`;
}
function spawnOptionHtml(row, note = "") {
  const key = encodeURIComponent(spawnKey(row));
  const buttons = [1, 5, 10].map(count => `<button type="button" class="button secondary small" data-spawn-key="${key}" data-spawn-add="${count}">+${count}</button>`).join("");
  return `<div class="spawn-option"><span><strong>${escapeHtml(row.label)}</strong><small>${escapeHtml(spawnBadge(row))}${note ? ` · ${escapeHtml(note)}` : ""}</small></span><div>${buttons}</div></div>`;
}
function spawnSlotsNote(slots, slot) {
  if (slot || !slots.length) return "";
  return slots.length <= 3 ? slots.join(", ") : `${slots.slice(0, 3).join(", ")} +${slots.length - 3}`;
}
function renderSpawnSuggestions() {
  const slot = $("#spawnPlot").value;
  const plot = app.state.plots.find(p => p.slot === slot);
  const filters = {
    query: $("#spawnSearch").value.trim(),
    color: $("#spawnColor").value,
    pattern: $("#spawnPattern").value,
    showAbundant: $("#spawnShowAbundant").checked,
  };
  const groups = HKIASpawnCatalog.possibleSpawns(plot ? [plot] : app.state.plots, app.state.inventory)
    .map(group => ({...group, items: group.items.filter(row => HKIASpawnCatalog.matches(row, filters))}));
  const shownAbove = new Set(groups.flatMap(group => group.items.map(spawnKey)));
  const groupHtml = groups.filter(group => group.items.length).map(group => {
    const expanded = app.spawnExpandedGroups.has(group.id);
    const items = expanded ? group.items : group.items.slice(0, SPAWN_GROUP_SHOWN);
    const more = group.items.length > SPAWN_GROUP_SHOWN
      ? `<div class="target-fold-row"><button type="button" class="button small secondary" data-spawn-group="${group.id}">${expanded ? "Show fewer ▴" : `Show all ${group.items.length} ▾`}</button></div>`
      : "";
    return `<section class="spawn-group"><h4>${escapeHtml(group.title)} <span>${group.items.length}</span></h4>${items.map(row => spawnOptionHtml(row, spawnSlotsNote(row.slots, slot))).join("")}${more}</section>`;
  }).join("");
  const where = slot ? `planted in ${slot}` : "planted across your plots";
  const possibleHtml = groupHtml
    ? `<h3 class="spawn-heading">Possible from what's ${escapeHtml(where)}</h3>${groupHtml}`
    : `<p class="help-text">Nothing ${escapeHtml(where)} matches these filters.</p>`;

  let rows = spawnCatalog().filter(row => !shownAbove.has(spawnKey(row)) && HKIASpawnCatalog.matches(row, filters));
  const relevance = HKIASpawnCatalog.relevance(plot ? [plot] : app.state.plots, filters.query);
  const scores = new Map(rows.map(row => [row, relevance(row)]));
  rows.sort((a,b) => scores.get(b) - scores.get(a) || a.label.localeCompare(b.label));
  const available = rows.length;
  rows = rows.slice(0, 90);
  const otherHtml = `<h3 class="spawn-heading">All other plants</h3><p class="help-text">${available} matching${available > 90 ? " (showing 90; filter to narrow)" : ""}. Most relevant to ${escapeHtml(slot || "your plots")} first.</p>` +
    (rows.length ? rows.map(row => spawnOptionHtml(row)).join("") : '<p class="empty-state">No matches. Try other filters, or use the regular inventory editor for a new variant.</p>');
  $("#spawnSuggestions").innerHTML = possibleHtml + otherHtml;
  renderSpawnBasket();
}
function renderSpawnBasket() {
  const selected = [...app.spawnBasket.values()];
  $("#spawnSelectedCount").textContent = `(${selected.length})`;
  $("#spawnBasket").innerHTML = selected.length ? selected.map(({row, count}) => `<div class="spawn-option"><span>${escapeHtml(row.label)}</span><div><button class="button secondary small" type="button" data-spawn-key="${encodeURIComponent(spawnKey(row))}" data-spawn-add="-1">−</button><strong>×${count}</strong><button class="button secondary small" type="button" data-spawn-key="${encodeURIComponent(spawnKey(row))}" data-spawn-add="1">+</button></div></div>`).join("") : '<p class="help-text">Tap +1 on plants you found. No changes are saved until you confirm.</p>';
  $("#saveSpawns").disabled = !selected.length;
}
function onSpawnAction(event) {
  const more = event.target.closest("[data-spawn-group]");
  if (more) {
    const id = more.dataset.spawnGroup;
    if (app.spawnExpandedGroups.has(id)) app.spawnExpandedGroups.delete(id);
    else app.spawnExpandedGroups.add(id);
    renderSpawnSuggestions();
    return;
  }
  const button = event.target.closest("[data-spawn-key]");
  if (!button) return;
  const key = decodeURIComponent(button.dataset.spawnKey);
  const row = spawnCatalog().find(item => spawnKey(item) === key);
  if (!row) return;
  const previous = app.spawnBasket.get(key)?.count || 0;
  const count = Math.max(0, previous + Number(button.dataset.spawnAdd));
  if (!count) app.spawnBasket.delete(key);
  else app.spawnBasket.set(key, {row, count});
  renderSpawnBasket();
}
async function saveSpawns() {
  const entries = [...app.spawnBasket.values()].map(({row, count}) => ({
    flower_type: row.flower_type, color: row.color, pattern: row.pattern,
    secondary_color: row.secondary_color || null, count,
  }));
  if (!entries.length) return;
  const slot = $("#spawnPlot").value || null;
  $("#spawnDialog").close();
  await mutate("/api/spawns", {entries, slot}, "Recording new spawns…");
}

function humanMethod(value) { return String(value || "").replaceAll("_", " ").replace(/\b\w/g, char => char.toUpperCase()); }

function bindEvents() {
  bindFlowerTooltips();
  bindHistoryChartTooltip();
  $$(".tab").forEach(tab => tab.addEventListener("click", () => {
    const view = tab.dataset.view;
    if (view === app.activeView) return;
    setActiveView(view);
    const url = `${window.location.pathname}${HKIATabRoutes.toSearch(window.location.search, view)}${window.location.hash}`;
    window.history.pushState({tab: view}, "", url);
  }));
  $$(".inventory-view-tab").forEach(button => button.addEventListener("click", () => setInventorySubView(button.dataset.inventoryView)));
  $("#collectionScopeTabs").addEventListener("click", event => {
    const button = event.target.closest?.("[data-collection-scope]");
    if (!button) return;
    app.collectionScope = button.dataset.collectionScope;
    renderCollectionChecklist();
  });
  $("#collectionPatternTabs").addEventListener("click", event => {
    const button = event.target.closest?.("[data-collection-pattern]");
    if (!button) return;
    app.collectionPattern = button.dataset.collectionPattern;
    renderCollectionChecklist();
  });
  $("#collectionSecondaryFilter").addEventListener("change", () => {
    app.collectionSecondary = $("#collectionSecondaryFilter").value;
    renderCollectionChecklist();
  });
  $("#collectionGrid").addEventListener("click", event => {
    const button = event.target.closest?.("[data-collection-key]");
    if (!button) return;
    openInventoryEditor(JSON.parse(decodeURIComponent(button.dataset.collectionKey)));
  });
  $("#collectionBreedSearch").addEventListener("input", renderCollectionChecklist);
  $("#collectionBreedFilter").addEventListener("change", renderCollectionChecklist);
  window.addEventListener("popstate", () => setActiveView(HKIATabRoutes.parse(window.location.search)));
  ["regionFilter","statusFilter","plotSearch"].forEach(id => $("#"+id).addEventListener("input", renderPlots));
  ["inventorySearch","inventoryType","inventoryPattern","inventoryOwned","inventoryHideNoFree","inventoryHideAbundant"].forEach(id => $("#"+id).addEventListener("input", resetInventoryPagination));
  $("#inventoryPageSize").addEventListener("change", () => {
    app.inventoryPageSize = Number($("#inventoryPageSize").value) || 100;
    resetInventoryPagination();
  });
  $("#inventoryPrevPage").addEventListener("click", () => setInventoryPage(app.inventoryPage - 1));
  $("#inventoryNextPage").addEventListener("click", () => setInventoryPage(app.inventoryPage + 1));
  ["targetSearch","targetPattern"].forEach(id => $("#"+id).addEventListener("input", renderTargets));
  $$(".history-filter").forEach(button => button.addEventListener("click", () => {
    app.historyCategory = button.dataset.historyCategory || "all";
    app.historyPage = 1;
    renderHistory();
  }));
  $("#historySearch").addEventListener("input", () => { app.historyPage = 1; renderHistory(); });
  $("#historyRange").addEventListener("change", renderHistory);
  $("#historyPrevPage").addEventListener("click", () => { app.historyPage -= 1; renderHistory(); });
  $("#historyNextPage").addEventListener("click", () => { app.historyPage += 1; renderHistory(); });
  $("#closeDrawer").addEventListener("click", closeDrawer);
  $("#drawerPlotCheck").addEventListener("click", event => {
    const slot = event.currentTarget.dataset.checkSlot;
    const checking = !app.plotChecks.has(slot);
    togglePlotCheck(slot);
    if (checking) closeDrawer();  // done with this plot: back to the map
  });
  $("#plotRecordSpawns").addEventListener("click", () => {
    if (app.selectedPlot) openSpawnDialog(app.selectedPlot.slot);
  });
  $("#drawerScrim").addEventListener("click", closeDrawer);
  $("#auditRefresh").addEventListener("click", () => refreshState());
  $("#recordSpawns").addEventListener("click", () => openSpawnDialog());
  $("#closeSpawnDialog").addEventListener("click", () => $("#spawnDialog").close());
  $("#spawnCancel").addEventListener("click", () => $("#spawnDialog").close());
  $("#spawnPlot").addEventListener("change", renderSpawnSuggestions);
  $("#spawnSearch").addEventListener("input", renderSpawnSuggestions);
  $("#spawnShowAbundant").addEventListener("change", renderSpawnSuggestions);
  $("#spawnColor").addEventListener("change", renderSpawnSuggestions);
  $("#spawnPattern").addEventListener("change", renderSpawnSuggestions);
  $("#spawnSuggestions").addEventListener("click", onSpawnAction);
  $("#spawnBasket").addEventListener("click", onSpawnAction);
  $("#saveSpawns").addEventListener("click", saveSpawns);
  $("#clearAllPlots").addEventListener("click", clearAllPlots);
  $("#addInventory").addEventListener("click", () => openInventoryEditor());
  $("#inventoryUncollectAction").addEventListener("click", markInventoryUncollected);
  $("#inventoryAddAction").addEventListener("click", () => updateInventory("add"));
  $("#inventorySetAction").addEventListener("click", () => updateInventory("set"));
  $("#editCount").addEventListener("keydown", event => {
    if (event.key !== "Enter" || event.isComposing) return;
    event.preventDefault();
    updateInventory("set");
  });
  $("#generatePlan").addEventListener("click", () => $("#planDialog").showModal());
  $("#fillersButton").addEventListener("click", () => {
    $("#fillersToggle").checked = Boolean(app.state?.summary?.fillers);
    $("#fillersDialog").showModal();
  });
  // A farm-wide setting (Generate plan and Replant plot both use it): saved as soon as it changes.
  $("#fillersToggle").addEventListener("change", async event => {
    const enabled = event.target.checked;
    try {
      await api("/api/settings/fillers", {method: "POST", body: JSON.stringify({enabled})});
      if (app.state?.summary) app.state.summary.fillers = enabled;
      renderFillerSetting();
      toast(enabled ? "Fillers on. Generate plan or Replant plot to plan with them." : "Fillers off.");
      await refreshState(false);
    } catch (error) {
      event.target.checked = !enabled;
      toast(error.message, true);
    }
  });
  $("#farmMenu").addEventListener("click", () => HKIAOnboarding.openFarmMenu(toast).catch(error => toast(error.message, true)));
  $("#openCollection").addEventListener("click", () => HKIAOnboarding.openCollection(HKIAOnboarding.afterCollection)
    .catch(error => toast(error.message, true)));
  $("#editAreas").addEventListener("click", () => HKIAOnboarding.openAreas(async message => {
    toast(message);
    await refreshState(false);
  }).catch(error => toast(error.message, true)));
  $("#confirmPlan").addEventListener("click", async () => {
    const payload = {
      replant_all: $("#replantAll").checked,
      // The collection scope is fixed: every supported category, always.
      target_categories: {
        extremophile_solids: true,
        other_solids: true,
        default_patterns_effects: true,
        non_default_secondary_patterns: false,
      },
    };
    $("#planDialog").close();
    $("#replantAll").checked = false;  // a farm-wide replant is a one-off choice
    await runPlan(payload);
  });
  $("#cancelPlan").addEventListener("click", cancelPlanUpdate);
  $("#plotBrushFlower").addEventListener("change", () => { refreshBrushSelectors(); renderPlotEditor(); });
  $("#plotBrushColor").addEventListener("change", () => { refreshBrushSelectors(); renderPlotEditor(); });
  $("#plotBrushPattern").addEventListener("change", () => { refreshBrushSelectors(); renderPlotEditor(); });
  $("#plotBrushSecondary").addEventListener("change", renderPlotEditor);
  $("#editColor").addEventListener("change", () => refreshInventorySecondarySelector());
  $("#editPattern").addEventListener("change", () => refreshInventorySecondarySelector());
  $("#paintTool").addEventListener("click", () => setEditorTool("paint"));
  $("#eraseTool").addEventListener("click", () => setEditorTool("erase"));
  $("#loadRecommendation").addEventListener("click", () => {
    if (!app.editingPlot) return;
    app.editCells = new Map(app.editingPlot.recommended_cells.map(cell => [editCellKey(cell.row, cell.col), {...cell}]));
    renderPlotEditor();
  });
  $("#clearEditor").addEventListener("click", () => { app.editCells.clear(); renderPlotEditor(); });
  $("#savePlot").addEventListener("click", () => savePlotEditor(false));
  $("#saveAndRecommend").addEventListener("click", () => savePlotEditor(true));
  ["targetFlower","targetColor","targetPatternEdit"].forEach(id => $("#"+id).addEventListener("change", resetTargetPreview));
  $("#previewTarget").addEventListener("click", previewTarget);
  $("#applyTarget").addEventListener("click", applyTarget);
  $("#saveMapDetails").addEventListener("click", saveMapDetails);
  document.addEventListener("keydown", event => { if (event.key === "Escape") closeDrawer(); });
}

function setActiveView(view) {
  const selected = HKIATabRoutes.isValid(view) ? view : "farm";
  app.activeView = selected;
  $$(".tab").forEach(tab => {
    const active = tab.dataset.view === selected;
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-current", active ? "page" : "false");
  });
  $$(".view").forEach(section => section.classList.toggle("active", section.id === `${selected}View`));
  $("#addInventory").hidden = selected !== "inventory";
  if (app.state) renderVisibleState();
  if (app.inventoryStateDirty) scheduleInventorySync();
  if (selected === "roadmap") window.HKIARoadmap?.load();
}

setInterval(async () => {
  if (document.visibilityState !== "visible") return;
  await pollPlanGeneration();
}, 5000);
// The browser version pushes Generate plan's progress (its status requests wait for the plan).
HKIAOnboarding.onPlanProgress(update => {
  if (["starting", "running"].includes(app.planGenerationState)) showPlanProgressOnButton(update);
});

bindEvents();
// The browser version's farm only changes in this tab, so there is nothing to refresh from.
if (globalThis.hkiaBrowser) $("#auditRefresh").remove();
setActiveView(HKIATabRoutes.parse(window.location.search));
// A farm without a plan yet (a new player) gets the setup screens first;
// they load the dashboard when the first plan is made.
HKIAOnboarding.start({onDone: () => refreshState()}).then(shown => { if (!shown) refreshState(); });
HKIAWhatsNew.init();
loadPlotChecks();
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") loadPlotChecks();
});
pollPlanGeneration();
