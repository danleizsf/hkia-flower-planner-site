(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.HistoryView = api;
})(typeof globalThis === "undefined" ? this : globalThis, function () {
  "use strict";

  // "Flowers in progress" counts distinct flowers; "Active jobs" counts one
  // per plot, so a flower worked on in several plots counts several times.
  const CHART_SERIES = [
    {key: "acquired", label: "Collected", color: "#3c8c63"},
    {key: "breeding_flowers", label: "Flowers in progress", color: "#4f78b8"},
    {key: "breeding", label: "Active jobs", color: "#d28a35"},
    {key: "blocked", label: "Blocked goals", color: "#b65b63"},
  ];

  function humanize(value) {
    return String(value || "").replaceAll("_", " ").replace(/\b\w/g, char => char.toUpperCase());
  }

  function categoryGroup(event) {
    const category = String(event?.category || "");
    if (category === "inventory") return "inventory";
    if (category === "plot_map" || category === "plot_status") return "plots";
    return "planner";
  }

  function categoryLabel(category) {
    return ({
      inventory: "Inventory",
      plot_map: "Farm layout",
      plot_status: "Planted farm",
      recommendation: "Recommendation",
      settings: "Planner settings",
    })[category] || humanize(category) || "Farm update";
  }

  function actionLabel(event) {
    const details = event?.details || {};
    const known = {
      add_inventory: "Added inventory",
      set_inventory: "Set inventory total",
      mark_uncollected: "Marked uncollected",
      found_target: "Recorded a found flower",
      apply_recommendations: "Recorded as planted",
      clear_plots: "Cleared planted work",
      edit_plot_cells: "Edited planted layout",
      reconcile_manual_assignments: "Reconciled Actual targets",
      remove_actual_target: "Removed an Actual target",
      remove_recommendation_target: "Removed a recommendation target",
      update_plot_details: "Edited plot details",
      move_plot: "Moved a plot",
      set_plot_lock: details.locked ? "Locked plot position" : "Unlocked plot position",
      set_region_collapsed: details.collapsed ? "Collapsed region" : "Expanded region",
      set_region_columns: "Changed region layout",
      update_target_categories: "Changed target settings",
    };
    if (known[event?.action]) return known[event.action];
    if (event?.action === "attach_manual_target") return details.action === "updated" ? "Updated an Actual target" : "Attached an Actual target";
    if (event?.action === "add_actual_target") return "Added an Actual target";
    if (event?.action === "replace_actual_target") return "Replaced an Actual target";
    if (event?.action === "remove_actual_target") return "Removed an Actual target";
    if (event?.action === "add_recommendation_target") return "Added a recommendation target";
    if (event?.action === "replace_recommendation_target") return "Replaced a recommendation target";
    return humanize(event?.action) || "Farm update";
  }

  function signed(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return String(value ?? "");
    return number > 0 ? `+${number}` : String(number);
  }

  function detailValue(value) {
    if (Array.isArray(value)) return value.join(", ");
    if (value && typeof value === "object") return JSON.stringify(value);
    if (typeof value === "boolean") return value ? "Yes" : "No";
    return String(value ?? "");
  }

  function describeEvent(event) {
    const details = event?.details && typeof event.details === "object" ? event.details : {};
    const category = String(event?.category || "");
    let summary = "";
    let change = "";

    if (category === "inventory") {
      summary = details.flower || "Flower inventory";
      const previous = Number(details.previous_total);
      const next = Number(details.new_total ?? details.total);
      if (event.action === "mark_uncollected") {
        change = "Collection flag removed";
      } else if (Number.isFinite(previous) && Number.isFinite(next)) {
        change = `${previous} → ${next} (${signed(next - previous)})`;
      } else if (Number.isFinite(Number(details.added))) {
        change = `+${Number(details.added)} · total ${details.total ?? "—"}`;
      }
    } else {
      const parts = [];
      if (details.slot) parts.push(`Plot ${details.slot}`);
      if (details.slots?.length) parts.push(`${details.slots.length} plot${details.slots.length === 1 ? "" : "s"}: ${details.slots.join(", ")}`);
      if (details.target) parts.push(details.target);
      if (details.flower) parts.push(details.flower);
      if (details.region) parts.push(details.region);
      if (details.position) parts.push(`Column ${details.position[0]} · row ${details.position[1]} · width ${details.position[2]}`);
      if (details.locked !== undefined) parts.push(details.locked ? "Position locked" : "Position unlocked");
      if (details.collapsed !== undefined) parts.push(details.collapsed ? "Collapsed" : "Expanded");
      if (details.cards_per_row !== undefined) parts.push(`${details.cards_per_row} cards across`);
      if (details.planted_cells !== undefined) parts.push(`${details.planted_cells} planted cells`);
      if (details.removed !== undefined) parts.push(`${details.removed} assignment${details.removed === 1 ? "" : "s"} cleared`);
      if (details.manual_slots_preserved?.length) parts.push(`Kept manual plots: ${details.manual_slots_preserved.join(", ")}`);
      if (details.swapped) parts.push(`Swapped with ${details.swapped}`);
      if (details.verified !== undefined) parts.push(details.verified ? "Route verified" : "Manual route");
      summary = parts.join(" · ");
      if (!summary) {
        summary = Object.entries(details)
          .filter(([key]) => key !== "job_id" && key !== "action")
          .map(([key, value]) => `${humanize(key)}: ${detailValue(value)}`)
          .join(" · ");
      }
      if (details.action && details.target) change = `${humanize(details.action)} · ${details.target}`;
      else if (details.job_id) change = `Target job ${details.job_id}`;
    }

    const metrics = event?.metrics || {};
    const metricParts = [];
    if (Number.isFinite(Number(metrics.acquired))) metricParts.push(`${metrics.acquired} collected`);
    if (Number.isFinite(Number(metrics.breeding_flowers))) metricParts.push(`${metrics.breeding_flowers} flowers in progress`);
    if (Number.isFinite(Number(metrics.breeding))) metricParts.push(`${metrics.breeding} active jobs`);
    if (Number.isFinite(Number(metrics.blocked))) metricParts.push(`${metrics.blocked} blocked goals`);
    return {
      group: categoryGroup(event),
      category: categoryLabel(category),
      action: actionLabel(event),
      summary: summary || "No additional details",
      change,
      metrics: metricParts.length ? `At save: ${metricParts.join(" · ")}` : "",
      snapshots: Array.isArray(event?.available_backups)
        ? event.available_backups.length
        : (Array.isArray(event?.backups) ? event.backups.length : 0),
      unavailableSnapshots: Number(event?.unavailable_backups) || 0,
    };
  }

  function filterEvents(events, selectedGroup = "all", query = "") {
    const normalized = String(query || "").trim().toLocaleLowerCase();
    return (Array.isArray(events) ? events : []).filter(event => {
      if (selectedGroup !== "all" && categoryGroup(event) !== selectedGroup) return false;
      if (!normalized) return true;
      const description = describeEvent(event);
      const searchable = [
        description.category, description.action, description.summary,
        description.change, event?.category, event?.action, event?.timestamp,
        JSON.stringify(event?.details || {}),
      ].join(" ").toLocaleLowerCase();
      return searchable.includes(normalized);
    });
  }

  function formatTimestamp(timestamp, locale) {
    const date = new Date(timestamp);
    if (!timestamp || Number.isNaN(date.getTime())) return {date: String(timestamp || "—"), time: "", full: String(timestamp || "")};
    return {
      date: new Intl.DateTimeFormat(locale, {dateStyle: "medium"}).format(date),
      time: new Intl.DateTimeFormat(locale, {hour: "numeric", minute: "2-digit"}).format(date),
      full: new Intl.DateTimeFormat(locale, {dateStyle: "full", timeStyle: "long"}).format(date),
    };
  }

  function chartTimeline(daily, days) {
    const count = Math.max(1, Math.floor(Number(days) || 30));
    const rows = (Array.isArray(daily) ? daily : [])
      .filter(row => row && /^\d{4}-\d{2}-\d{2}$/.test(String(row.date || ""))
        && !Number.isNaN(Date.parse(`${row.date}T00:00:00Z`)))
      .slice()
      .sort((left, right) => left.date.localeCompare(right.date));
    const dayMs = 24 * 60 * 60 * 1000;
    const endDate = rows.at(-1)?.date || new Date().toISOString().slice(0, 10);
    const endMs = Date.parse(`${endDate}T00:00:00Z`);
    const startMs = endMs - (count - 1) * dayMs;
    const startDate = new Date(startMs).toISOString().slice(0, 10);
    const visibleRows = rows.filter(row => row.date >= startDate && row.date <= endDate);
    const ticks = Array.from({length: 5}, (_, index) => {
      const tickMs = startMs + Math.round((count - 1) * index / 4) * dayMs;
      return new Date(tickMs).toISOString().slice(0, 10);
    });
    return {
      days: count,
      startDate,
      startMs,
      endDate,
      endMs,
      firstAvailableDate: rows[0]?.date || null,
      rows: visibleRows,
      ticks,
    };
  }

  function formatChartDate(date, locale) {
    const value = new Date(`${date}T00:00:00Z`);
    if (Number.isNaN(value.getTime())) return String(date || "");
    return new Intl.DateTimeFormat(locale, {month: "short", day: "numeric", timeZone: "UTC"}).format(value);
  }

  function formatChartDateLong(date, locale) {
    const value = new Date(`${date}T00:00:00Z`);
    if (Number.isNaN(value.getTime())) return String(date || "");
    return new Intl.DateTimeFormat(locale, {dateStyle: "full", timeZone: "UTC"}).format(value);
  }

  function chartSeries() {
    return CHART_SERIES.map(series => ({...series}));
  }

  // A value is null on days saved before that metric existed.
  function tooltipValues(row) {
    return chartSeries().map(series => ({
      ...series,
      value: row?.[series.key] == null ? null : Number(row[series.key]),
      estimated: Boolean(row?.[`${series.key}_estimated`]),
    }));
  }

  // New flowers grouped by the viewer's local day, newest day first, keeping
  // the last `days` days up to today.
  // Days run from the game's daily reset (midnight Mountain Time, hkia_solver/plot_checks.py),
  // like the collection chart, not from the viewer's midnight: the game day is the Denver date.
  const MOUNTAIN_DATE = new Intl.DateTimeFormat("en-CA", {timeZone: "America/Denver", year: "numeric", month: "2-digit", day: "2-digit"});
  function gameDay(value) {
    return MOUNTAIN_DATE.format(new Date(value));
  }

  function groupNewFlowers(flowers, days, now = new Date()) {
    const start = new Date(now.getTime() - (Math.max(1, Number(days) || 30) - 1) * 86400000);
    const startDay = gameDay(start);
    const byDay = new Map();
    (Array.isArray(flowers) ? flowers : []).forEach(item => {
      if (!item?.timestamp || Number.isNaN(Date.parse(item.timestamp))) return;
      const day = item.day || gameDay(item.timestamp);
      if (day < startDay) return;
      if (!byDay.has(day)) byDay.set(day, []);
      byDay.get(day).push(item);
    });
    return [...byDay.entries()].sort(([a], [b]) => b.localeCompare(a)).map(([date, items]) => ({date, flowers: items}));
  }

  function newFlowerSource(item) {
    if (item?.spotted_in_inventory) return "Spotted in inventory";
    const where = item?.slot ? ` in ${item.slot}` : "";
    return ({
      found_target: `Found${where}`,
      record_spawns: `Spawned${where}`,
      plant_changed: `Plant changed${where}`,
      add_inventory: "Added to inventory",
      set_inventory: "Set in inventory",
    })[item?.action] || humanize(item?.action);
  }

  function dayOffset(date, startDate) {
    return (Date.parse(`${date}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / (24 * 60 * 60 * 1000);
  }

  return {actionLabel, categoryGroup, chartSeries, chartTimeline, dayOffset, describeEvent, filterEvents, formatChartDate, formatChartDateLong, formatTimestamp, groupNewFlowers, newFlowerSource, tooltipValues};
});
