/* Record spawns: what a plot can produce, and filtering the plant list.
 *
 * Spawns come from what is physically planted, so the groups use each plot's
 * Actual jobs and cells: breeding targets (color mix and transfers),
 * fertilizer targets, and copies of planted flowers (propagation).
 */
(function (root, factory) {
  const catalog = factory();
  if (typeof module === "object" && module.exports) module.exports = catalog;
  root.HKIASpawnCatalog = catalog;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const GROUPS = [
    {id: "breeding", title: "Breeding"},
    {id: "fertilizing", title: "Fertilizing"},
    {id: "propagating", title: "Propagating"},
  ];

  function key(row) {
    return JSON.stringify([row.flower_type, row.color, row.pattern, row.secondary_color || null]);
  }

  function jobTarget(job) {
    return {
      flower_type: job.target_type, color: job.target_color, pattern: job.target_pattern,
      secondary_color: job.target_secondary_color || null, label: job.target,
    };
  }

  function groupOf(method) {
    if (method === "fertilize_pattern") return "fertilizing";
    if (method === "propagate_solid") return "propagating";
    return "breeding";
  }

  function label(flower) {
    if (flower.label) return flower.label;
    const pattern = flower.pattern === "Solid" ? "" : ` ${flower.pattern}`;
    return `${flower.color}${pattern} ${flower.flower_type}`;
  }

  /** Breeding, fertilizing and propagating targets of the plots in `plots`.
   * Each item is an inventory-shaped row plus `slots`, the plots it comes from. */
  function possibleSpawns(plots, inventory) {
    const stock = new Map((inventory || []).map(row => [key(row), row]));
    const groups = Object.fromEntries(GROUPS.map(group => [group.id, new Map()]));
    const add = (group, flower, slot) => {
      if (!flower.flower_type || !flower.color || !flower.pattern) return;
      const id = key(flower);
      let item = groups[group].get(id);
      if (!item) {
        const row = stock.get(id) || {...flower, label: label(flower), total: 0, planted: 0, collected: false};
        item = {...row, slots: []};
        groups[group].set(id, item);
      }
      if (slot && !item.slots.includes(slot)) item.slots.push(slot);
    };
    for (const plot of plots || []) {
      for (const job of plot.actual_jobs || []) {
        if (job.target_type) add(groupOf(job.method), jobTarget(job), plot.slot);
      }
      // Any planted flower can spread a copy of itself.
      for (const cell of plot.actual_cells || []) add("propagating", cell, plot.slot);
    }
    return GROUPS.map(group => ({
      ...group,
      items: [...groups[group.id].values()].sort((a, b) => a.label.localeCompare(b.label)),
    }));
  }

  /** Whether `row` passes the dialog's search, color, pattern and abundance filters. */
  function matches(row, {query = "", color = "", pattern = "", showAbundant = false} = {}) {
    if (!showAbundant && row.pattern === "Solid" && Number(row.total || 0) >= 30) return false;
    if (color && row.color !== color) return false;
    if (pattern && row.pattern !== pattern) return false;
    const text = `${row.label} ${row.flower_type} ${row.color} ${row.pattern} ${row.secondary_color || ""}`.toLowerCase();
    return !query || query.toLowerCase().split(/\s+/).every(word => text.includes(word));
  }

  /** Returns a function scoring how relevant a row is to `plots` and the search
   * `query` (higher first). Stock counts don't factor in. Signals, strongest first:
   * the search matching the name, a planned (recommended) target, then sharing
   * species, color or pattern with what's planted or targeted. */
  function relevance(plots, query = "") {
    const planned = new Set();
    const types = new Set();
    const typeColors = new Set();
    const typePatterns = new Set();
    const colors = new Set();
    const note = flower => {
      if (!flower.flower_type) return;
      types.add(flower.flower_type);
      typeColors.add(`${flower.flower_type}|${flower.color}`);
      typePatterns.add(`${flower.flower_type}|${flower.pattern}`);
      colors.add(flower.color);
    };
    for (const plot of plots || []) {
      for (const job of plot.recommended_jobs || []) {
        if (job.target_type) { planned.add(key(jobTarget(job))); note(jobTarget(job)); }
      }
      for (const job of plot.actual_jobs || []) if (job.target_type) note(jobTarget(job));
      for (const cell of plot.actual_cells || []) note(cell);
    }
    const q = query.trim().toLowerCase();
    return row => {
      const name = String(row.label || label(row)).toLowerCase();
      let score = planned.has(key(row)) ? 100 : 0;
      if (q) score += name === q ? 400 : name.startsWith(q) ? 300 : name.split(/\s+/).includes(q) ? 200 : 0;
      if (types.has(row.flower_type)) {
        score += 20;
        if (typeColors.has(`${row.flower_type}|${row.color}`)) score += 10;
        if (typePatterns.has(`${row.flower_type}|${row.pattern}`)) score += 5;
      } else if (colors.has(row.color)) {
        score += 3;
      }
      return score;
    };
  }

  return {GROUPS, key, matches, possibleSpawns, relevance};
});
