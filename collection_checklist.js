(function (root, factory) {
  const checklist = factory();
  if (typeof module === "object" && module.exports) module.exports = checklist;
  root.HKIACollectionChecklist = checklist;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>\'"]/g, char => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
    })[char]);
  }

  function variantKey(item) {
    return JSON.stringify([
      item.flower_type || "",
      item.color || "",
      item.pattern || "Solid",
      item.secondary_color || null,
    ]);
  }

  function buildPlacementIndex(currentTargets = []) {
    const placements = new Map();
    for (const target of currentTargets || []) {
      if (target.source !== "planted" && target.source !== "recommended") continue;
      const flowerType = target.target_type || target.flower_type;
      const color = target.target_color || target.color;
      const pattern = target.target_pattern || target.pattern || "Solid";
      if (!flowerType || !color) continue;
      const key = variantKey({
        flower_type: flowerType,
        color,
        pattern,
        secondary_color: target.target_secondary_color ?? target.secondary_color ?? null,
      });
      if (!placements.has(key)) placements.set(key, []);
      const location = {
        source: target.source,
        plot: target.plot || target.slot || "Unknown plot",
        region: target.region || "",
        slot: target.slot || "",
      };
      const list = placements.get(key);
      const label = location.region && location.region !== location.plot
        ? `${location.plot} (${location.region})`
        : location.plot;
      if (!list.some(item => item.source === location.source && item.label === label)) {
        list.push({...location, label});
      }
    }
    return placements;
  }

  function placementDetails(item, placementIndex = new Map()) {
    const entries = placementIndex instanceof Map
      ? (placementIndex.get(variantKey(item)) || [])
      : (placementIndex?.[variantKey(item)] || []);
    const planted = entries.filter(entry => entry.source === "planted");
    const recommended = entries.filter(entry => entry.source === "recommended");
    const flags = [];
    const descriptions = [];
    if (planted.length) {
      flags.push({key: "planted", label: "🌱"});
      descriptions.push(`Being bred in ${planted.map(entry => entry.label).join(", ")}`);
    }
    if (recommended.length) {
      flags.push({key: "recommended", label: "R"});
      descriptions.push(`Recommended for ${recommended.map(entry => entry.label).join(", ")} (not recorded as planted)`);
    }
    return {flags, descriptions};
  }

  function shortDate(iso) {
    const [y, m, d] = String(iso || "").split("-").map(Number);
    if (!y) return "";
    return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {month: "short", day: "numeric", timeZone: "UTC"});
  }

  function waitLabel(wait, breed) {
    switch (wait.kind) {
      case "needs_area": return "Needs an area you haven't unlocked";
      case "event": return `Waits for ${wait.event}, ${shortDate(wait.date)}`;
      case "event_now": return `${wait.event} is on until ${shortDate(wait.date)}`;
      case "extreme": return "Extremophile: native plot queue";
      case "no_breed": return `No ${breed} owned yet`;
      default: return "No breeding route yet";
    }
  }

  function waitDetail(wait, breed) {
    switch (wait.kind) {
      case "needs_area": return `None of your unlocked plots can grow it: unlock a patch in ${(wait.areas || []).join(", ")}`;
      case "event": return "Outdoors it only spawns during its event; until then only the Greenhouse can grow it, and its space is shared";
      case "event_now": return "In season now: it can spawn outdoors and is waiting for space";
      case "extreme": return wait.greenhouse === false
        ? "Grows only in its small native plot"
        : `Grows only in its small native plot until Extreme Gardening (${wait.needed} solid colors of each extremophile) opens the Greenhouse`;
      case "no_breed": return `Get any ${breed} in game to start its whole row${(wait.starters || []).length ? ` (starter colors: ${wait.starters.join(", ")})` : ""}${wait.event ? `; it is an ${wait.event} flower` : ""}`;
      default: return "None of its parents can be bred from what you own yet";
    }
  }

  function renderStatusButton({item, state, name, pattern, color, flowerType, placements}) {
    const acquired = state === "acquired";
    const location = acquired ? {flags: [], descriptions: []} : placementDetails(item, placements);
    const breeding = location.flags.some(flag => flag.key === "planted");
    // Why a missing goal is not being bred: a season, the extremophile queue,
    // a breed not owned yet, or no route (structural reasons come first).
    const wait = !acquired && !breeding ? item.wait : null;
    const WAIT_MARK = {needs_area: "🔒", event: "📅", event_now: "📅", extreme: "⛰️", no_breed: "∅", no_route: "∅"};
    const waitMark = wait ? WAIT_MARK[wait.kind] : "";
    const blocked = !acquired && !breeding && !waitMark && Boolean(item.blocked);
    const stateLabel = acquired ? "Acquired" : breeding ? "Breeding" : waitMark ? waitLabel(wait, item.flower_type || flowerType) : blocked ? "Blocked" : "Missing";
    if (waitMark) location.descriptions.push(waitDetail(wait, item.flower_type || flowerType));
    if (blocked) {
      const routes = item.blocking_routes || [];
      location.descriptions.push(item.blocking_reason || "Waiting for available parents");
      routes.forEach((route, index) => location.descriptions.push(
        `Option ${index + 1}: ${route.parents.join(" + ")} — needs ${route.blocking_parents.map(parent =>
          `${parent.label} (${parent.reason}; ${parent.free}/${parent.needed} free)`
        ).join(", ")}`
      ));
    }
    const displayState = acquired ? "acquired" : breeding ? "breeding" : waitMark ? `waiting wait-${wait.kind}` : blocked ? "blocked" : "missing";
    const statusDetails = location.descriptions.length ? ` · ${location.descriptions.join(" · ")}` : "";
    const title = `${name} · ${stateLabel}${statusDetails} · click to edit inventory`;
    const aria = `${name}: ${stateLabel}.${location.descriptions.length ? ` ${location.descriptions.join(". ")}.` : ""} Click to edit inventory.`;
    const flags = location.flags.map(flag => `<span class="collection-breed-flag ${flag.key}" aria-hidden="true">${flag.label}</span>`).join("");
    const key = encodeURIComponent(JSON.stringify([
      item.flower_type || flowerType,
      item.color || color,
      item.pattern || pattern,
      item.secondary_color || "",
    ]));
    return `<button type="button" class="collection-mark ${displayState}${flags ? " has-breeding" : ""}" data-collection-key="${escapeHtml(key)}" aria-label="${escapeHtml(aria)}" title="${escapeHtml(title)}"><span class="collection-mark-state">${acquired ? "✓" : breeding ? "🌱" : waitMark || (blocked ? "🔒" : "×")}</span>${breeding ? location.flags.filter(flag => flag.key !== "planted").map(flag => `<span class="collection-breed-flag ${flag.key}" aria-hidden="true">${flag.label}</span>`).join("") : flags}</button>`;
  }

  function patternSummary(inventory) {
    const result = new Map();
    for (const item of inventory || []) {
      if (!item.in_scope) continue;
      const pattern = item.pattern || "Solid";
      if (!result.has(pattern)) result.set(pattern, {pattern, acquired: 0, missing: 0, total: 0});
      const row = result.get(pattern);
      row.total += 1;
      if (item.collected) row.acquired += 1;
      else row.missing += 1;
    }
    return [...result.values()];
  }

  function defaultSecondaryColor(primaryColor) {
    return primaryColor === "White" ? "Warm Pink" : "White";
  }

  function nonDefaultPatternSummary({inventory = [], flowerTypes = [], colors = [], patterns = [], flowerPatterns = {}} = {}) {
    const validSecondaryPairsPerPrimary = colors.reduce((count, primary) => count + colors.filter(secondary =>
      secondary !== primary && secondary !== defaultSecondaryColor(primary)
    ).length, 0);
    return patterns.map(pattern => {
      const summary = {pattern, acquired: 0, missing: 0, total: 0};
      const compatible = new Set(flowerTypes.filter(flowerType => (flowerPatterns[flowerType] || []).includes(pattern)));
      summary.total = compatible.size * validSecondaryPairsPerPrimary;
      for (const item of inventory || []) {
        if (!item.collected || item.pattern !== pattern || !item.secondary_color || !compatible.has(item.flower_type)) continue;
        if (!colors.includes(item.color) || !colors.includes(item.secondary_color)
          || item.secondary_color === item.color
          || item.secondary_color === defaultSecondaryColor(item.color)) continue;
        summary.acquired += 1;
      }
      summary.missing = Math.max(0, summary.total - summary.acquired);
      return summary;
    }).filter(summary => summary.total > 0);
  }

  function buildNonDefaultMatrix({inventory = [], flowerTypes = [], colors = [], pattern = "Ombre", secondaryColor = "White", search = "", breedFilter = "all", flowerPatterns = {}} = {}) {
    const byVariant = new Map((inventory || []).map(item => [variantKey(item), item]));
    const normalizedSearch = String(search || "").trim().toLocaleLowerCase();
    const rows = [];
    for (const flowerType of flowerTypes) {
      if (normalizedSearch && !flowerType.toLocaleLowerCase().includes(normalizedSearch)) continue;
      const supportsPattern = (flowerPatterns[flowerType] || []).includes(pattern);
      const cells = colors.map(color => {
        const valid = supportsPattern
          && secondaryColor !== color
          && secondaryColor !== defaultSecondaryColor(color);
        if (!valid) return {flower_type: flowerType, color, pattern, secondary_color: secondaryColor, state: "no_goal", item: null};
        const key = variantKey({flower_type: flowerType, color, pattern, secondary_color: secondaryColor});
        const item = byVariant.get(key) || {
          flower_type: flowerType,
          color,
          pattern,
          secondary_color: secondaryColor,
          label: `${color} & ${secondaryColor} ${flowerType} (${pattern})`,
          collected: false,
        };
        return {flower_type: flowerType, color, pattern, secondary_color: secondaryColor, state: item.collected ? "acquired" : "missing", item};
      });
      if (breedFilter === "missing" && !cells.some(cell => cell.state === "missing")) continue;
      if (breedFilter === "acquired" && !cells.some(cell => cell.state === "acquired")) continue;
      rows.push({flower_type: flowerType, cells});
    }
    const summary = {acquired: 0, missing: 0, total: 0};
    for (const flowerType of flowerTypes) {
      if (!(flowerPatterns[flowerType] || []).includes(pattern)) continue;
      for (const color of colors) {
        if (secondaryColor === color || secondaryColor === defaultSecondaryColor(color)) continue;
        summary.total += 1;
        if (byVariant.get(variantKey({flower_type: flowerType, color, pattern, secondary_color: secondaryColor}))?.collected) summary.acquired += 1;
        else summary.missing += 1;
      }
    }
    return {rows, summary};
  }

  function renderScopeTabs(scopes, selectedScope) {
    return scopes.map(scope => `<button type="button" class="collection-scope-tab${scope.id === selectedScope ? " active" : ""}" data-collection-scope="${escapeHtml(scope.id)}" role="tab" aria-selected="${scope.id === selectedScope}"><span>${escapeHtml(scope.label)}</span><small>${escapeHtml(scope.summary || "")}</small></button>`).join("");
  }

  function buildMatrix({inventory = [], flowerTypes = [], colors = [], pattern = "Solid", search = "", breedFilter = "all"} = {}) {
    const scopedRows = inventory.filter(item => item.in_scope);
    const byVariant = new Map(scopedRows.map(item => [variantKey(item), item]));
    const normalizedSearch = String(search || "").trim().toLocaleLowerCase();
    const rows = [];
    for (const flowerType of flowerTypes) {
      if (normalizedSearch && !flowerType.toLocaleLowerCase().includes(normalizedSearch)) continue;
      const cells = colors.map(color => {
        const item = byVariant.get(variantKey({flower_type: flowerType, color, pattern}));
        const state = !item ? "no_goal" : item.collected ? "acquired" : "missing";
        return {flower_type: flowerType, color, pattern, state, item: item || null};
      });
      if (breedFilter === "missing" && !cells.some(cell => cell.state === "missing")) continue;
      if (breedFilter === "acquired" && !cells.some(cell => cell.state === "acquired")) continue;
      rows.push({flower_type: flowerType, cells});
    }
    const summary = scopedRows.reduce((totals, item) => {
      if ((item.pattern || "Solid") !== pattern) return totals;
      totals.total += 1;
      totals[item.collected ? "acquired" : "missing"] += 1;
      return totals;
    }, {acquired: 0, missing: 0, total: 0});
    return {rows, summary};
  }

  function renderPatternTabs(patterns, summaries, selectedPattern) {
    const stats = new Map((summaries || []).map(item => [item.pattern, item]));
    return patterns.map(pattern => {
      const summary = stats.get(pattern) || {acquired: 0, total: 0};
      const active = pattern === selectedPattern;
      return `<button type="button" class="collection-pattern-tab${active ? " active" : ""}" data-collection-pattern="${escapeHtml(pattern)}" role="tab" aria-selected="${active}">
        <span>${escapeHtml(pattern)}</span><small>${summary.acquired}/${summary.total}</small>
      </button>`;
    }).join("");
  }

  // Row heading: the breed and how many of its goals in this view are collected.
  function breedHeading(row) {
    const goals = row.cells.filter(cell => cell.state !== "no_goal");
    const acquired = goals.filter(cell => cell.state === "acquired").length;
    const count = goals.length
      ? ` <small class="collection-breed-count${acquired === goals.length ? " complete" : ""}" title="${acquired} of ${goals.length} collected">${acquired}/${goals.length}</small>`
      : "";
    return `<th class="collection-breed" scope="row">${escapeHtml(row.flower_type)}${count}</th>`;
  }

  function renderMatrix({inventory = [], flowerTypes = [], colors = [], pattern = "Solid", search = "", breedFilter = "all", placements = new Map()} = {}) {
    const {rows, summary} = buildMatrix({inventory, flowerTypes, colors, pattern, search, breedFilter});
    const header = `<thead><tr><th class="collection-breed-heading" scope="col">Breed</th>${colors.map(color => `<th scope="col" title="${escapeHtml(color)}">${escapeHtml(color)}</th>`).join("")}</tr></thead>`;
    const body = rows.map(row => `<tr>${breedHeading(row)}${row.cells.map(cell => {
      if (!cell.item) return `<td><span class="collection-mark no-goal" aria-label="No ${escapeHtml(pattern)} collection goal for ${escapeHtml(cell.color)} ${escapeHtml(row.flower_type)}" title="No collection goal">—</span></td>`;
      const name = cell.item.label || `${cell.color} ${row.flower_type} (${pattern})`;
      return `<td>${renderStatusButton({item: cell.item, state: cell.state, name, pattern, color: cell.color, flowerType: row.flower_type, placements})}</td>`;
    }).join("")}</tr>`).join("") || `<tr><td class="collection-empty" colspan="${Math.max(1, colors.length + 1)}">No breed rows match this view.</td></tr>`;
    return {
      markup: `${header}<tbody>${body}</tbody>`,
      summary,
      visibleBreeds: rows.length,
      totalBreeds: flowerTypes.length,
    };
  }

  function renderNonDefaultMatrix({inventory = [], flowerTypes = [], colors = [], pattern = "Ombre", secondaryColor = "White", search = "", breedFilter = "all", flowerPatterns = {}, placements = new Map()} = {}) {
    const {rows, summary} = buildNonDefaultMatrix({inventory, flowerTypes, colors, pattern, secondaryColor, search, breedFilter, flowerPatterns});
    const header = `<thead><tr><th class="collection-breed-heading" scope="col">Breed</th>${colors.map(color => `<th scope="col" title="Primary ${escapeHtml(color)}">${escapeHtml(color)}</th>`).join("")}</tr></thead>`;
    const body = rows.map(row => `<tr>${breedHeading(row)}${row.cells.map(cell => {
      if (!cell.item) return `<td><span class="collection-mark no-goal" aria-label="No valid non-default ${escapeHtml(secondaryColor)} secondary ${escapeHtml(pattern)} variant for ${escapeHtml(cell.color)} ${escapeHtml(row.flower_type)}" title="Default secondary color or incompatible pattern">—</span></td>`;
      const name = cell.item.label || `${cell.color} & ${secondaryColor} ${row.flower_type} (${pattern})`;
      return `<td>${renderStatusButton({item: cell.item, state: cell.state, name, pattern, color: cell.color, flowerType: row.flower_type, placements})}</td>`;
    }).join("")}</tr>`).join("") || `<tr><td class="collection-empty" colspan="${Math.max(1, colors.length + 1)}">No breed rows match this view.</td></tr>`;
    return {markup: `${header}<tbody>${body}</tbody>`, summary, visibleBreeds: rows.length, totalBreeds: flowerTypes.length};
  }

  return {
    buildMatrix,
    buildNonDefaultMatrix,
    buildPlacementIndex,
    defaultSecondaryColor,
    nonDefaultPatternSummary,
    patternSummary,
    placementDetails,
    renderMatrix,
    renderNonDefaultMatrix,
    renderPatternTabs,
    renderScopeTabs,
    variantKey,
  };
});
