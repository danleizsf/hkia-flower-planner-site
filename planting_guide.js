/* Planting guide: turns a plot's recommendation into in-game filter steps.
 *
 * The game's planting list can be filtered by Breed, Color and Pattern, and
 * each filter accepts several values. Every step picks one filter setting and
 * lists the flowers to plant from it, with 1-based row/column spots.
 *
 * Steps are chosen to balance two costs: setting filters (each step and each
 * filter value is a tap) and finding a flower in the filtered list (longer
 * lists take longer to scan). Groups of flowers are merged into one step
 * while that lowers the total.
 */
(function (root, factory) {
  const guide = factory();
  if (typeof module === "object" && module.exports) module.exports = guide;
  root.HKIAPlantingGuide = guide;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const STEP_COST = 2;    // clearing the old filters and starting a step
  const TAP_COST = 1;     // each filter value picked
  const EASY_TAPS = 4;    // past this, a step is hard to set up correctly
  const EXTRA_TAP_COST = 1.5;
  // Finding one flower costs this much per flower shown in the filtered
  // list, plus extra per flower beyond LONG_LIST (the list needs scrolling).
  const SCAN_COST = 0.04;
  const LONG_LIST = 16;
  const SCROLL_COST = 0.2;
  // The dig-up list stays open up to this many different flowers.
  const DIG_LIST_OPEN = 6;

  const CATEGORIES = [
    ["breeds", "flower_type", "Breed"],
    ["colors", "color", "Color"],
    ["patterns", "pattern", "Pattern"],
  ];

  function variantKey(flower) {
    return [flower.flower_type, flower.color, flower.pattern || "Solid", flower.secondary_color || ""].join("|");
  }

  function normalize(flower) {
    return {
      flower_type: flower.flower_type,
      color: flower.color,
      pattern: flower.pattern || "Solid",
      secondary_color: flower.secondary_color || null,
    };
  }

  // Cells in the recommendation that don't already hold that same flower.
  function cellsToPlant(recommendedCells, actualCells) {
    const actual = new Map((actualCells || []).map(cell => [`${cell.row}:${cell.col}`, variantKey(normalize(cell))]));
    return (recommendedCells || [])
      .filter(cell => cell.flower_type && actual.get(`${cell.row}:${cell.col}`) !== variantKey(normalize(cell)))
      .map(cell => ({row: Number(cell.row), col: Number(cell.col), flower: normalize(cell)}))
      .sort((a, b) => a.row - b.row || a.col - b.col);
  }

  // Planted cells the recommendation doesn't keep as they are.
  function cellsToRemove(recommendedCells, actualCells) {
    const wanted = new Map((recommendedCells || []).map(cell => [`${cell.row}:${cell.col}`, variantKey(normalize(cell))]));
    return (actualCells || [])
      .filter(cell => cell.flower_type && wanted.get(`${cell.row}:${cell.col}`) !== variantKey(normalize(cell)))
      .map(cell => ({row: Number(cell.row), col: Number(cell.col), flower: normalize(cell)}))
      .sort((a, b) => a.row - b.row || a.col - b.col);
  }

  function findCost(results) {
    return SCAN_COST * results + SCROLL_COST * Math.max(0, results - LONG_LIST);
  }

  // The flowers the game would list: every variant with a free copy, plus the
  // ones this plot needs (in case the inventory hasn't caught up). Indexed by
  // each category's value so a count only looks at flowers that can match.
  function buildPool(inventory, needed) {
    const unique = new Map();
    for (const item of inventory || []) {
      if (Number(item.free) > 0) unique.set(variantKey(normalize(item)), normalize(item));
    }
    for (const flower of needed) unique.set(variantKey(flower), flower);
    const index = {};
    CATEGORIES.forEach(([name, field]) => {
      index[name] = new Map();
      for (const flower of unique.values()) {
        if (!index[name].has(flower[field])) index[name].set(flower[field], []);
        index[name].get(flower[field]).push(flower);
      }
    });
    return index;
  }

  function countMatches(pool, filter) {
    let smallest = null;
    for (const [name] of CATEGORIES) {
      if (!filter[name]) continue;
      const lists = [...filter[name]].map(value => pool[name].get(value) || []);
      const size = lists.reduce((sum, list) => sum + list.length, 0);
      if (!smallest || size < smallest.size) smallest = {size, lists};
    }
    let count = 0;
    for (const list of smallest.lists) {
      for (const flower of list) {
        if ((!filter.breeds || filter.breeds.has(flower.flower_type))
          && (!filter.colors || filter.colors.has(flower.color))
          && (!filter.patterns || filter.patterns.has(flower.pattern))) count += 1;
      }
    }
    return count;
  }

  // The cheapest filter setting that shows every flower in the group.
  function bestFilter(group, pool) {
    let best = null;
    for (let mask = 1; mask < 8; mask += 1) {
      const filter = {};
      let taps = 0;
      CATEGORIES.forEach(([name, field], index) => {
        if (!(mask & (1 << index))) return;
        filter[name] = new Set(group.map(flower => flower[field]));
        taps += filter[name].size;
      });
      const results = countMatches(pool, filter);
      const cost = STEP_COST + TAP_COST * taps + EXTRA_TAP_COST * Math.max(0, taps - EASY_TAPS)
        + group.length * findCost(results);
      if (!best || cost < best.cost - 1e-9) best = {filter, results, cost};
    }
    return best;
  }

  function ordered(values, order) {
    const known = (order || []).filter(value => values.has(value));
    const rest = [...values].filter(value => !(order || []).includes(value)).sort();
    return [...known, ...rest];
  }

  /* Returns [{filter: {breeds, colors, patterns}, results, items: [{number,
   * flower, cells: [{row, col}]}]}]. `orders` gives the game's value order
   * for each category so chips read like the in-game picker. */
  function planSteps(cells, inventory, orders = {}) {
    const byVariant = new Map();
    for (const cell of cells) {
      const key = variantKey(cell.flower);
      if (!byVariant.has(key)) byVariant.set(key, {flower: cell.flower, cells: []});
      byVariant.get(key).cells.push({row: cell.row, col: cell.col});
    }
    const variants = [...byVariant.values()];
    if (!variants.length) return [];
    const pool = buildPool(inventory, variants.map(variant => variant.flower));

    let groups = variants.map(variant => {
      const members = [variant];
      return {members, ...bestFilter([variant.flower], pool)};
    });
    // Merge the pair that saves the most until no merge saves anything.
    const mergeCache = new Map();
    const merged = (a, b) => {
      const key = a.id < b.id ? `${a.id}+${b.id}` : `${b.id}+${a.id}`;
      if (!mergeCache.has(key)) {
        const members = [...a.members, ...b.members];
        mergeCache.set(key, {members, ...bestFilter(members.map(member => member.flower), pool)});
      }
      return mergeCache.get(key);
    };
    let nextId = 0;
    groups.forEach(group => { group.id = nextId++; });
    for (;;) {
      let best = null;
      for (let i = 0; i < groups.length; i += 1) {
        for (let j = i + 1; j < groups.length; j += 1) {
          const candidate = merged(groups[i], groups[j]);
          const saving = groups[i].cost + groups[j].cost - candidate.cost;
          if (saving > 1e-9 && (!best || saving > best.saving)) best = {i, j, candidate, saving};
        }
      }
      if (!best) break;
      const group = {...best.candidate, id: nextId++};
      groups = groups.filter((_, index) => index !== best.i && index !== best.j);
      groups.push(group);
    }

    const plantCount = group => group.members.reduce((sum, member) => sum + member.cells.length, 0);
    const firstCell = group => Math.min(...group.members.map(member => member.cells[0].row * 1000 + member.cells[0].col));
    groups.sort((a, b) => plantCount(b) - plantCount(a) || firstCell(a) - firstCell(b));
    let number = 0;
    return groups.map(group => {
      const filter = {};
      CATEGORIES.forEach(([name]) => {
        filter[name] = group.filter[name] ? ordered(group.filter[name], orders[name]) : [];
      });
      const members = [...group.members].sort((a, b) =>
        a.cells[0].row - b.cells[0].row || a.cells[0].col - b.cells[0].col);
      return {
        filter,
        results: group.results,
        items: members.map(member => ({number: ++number, flower: member.flower, cells: member.cells})),
      };
    });
  }

  function spot(cell) {
    return `R${cell.row + 1}·C${cell.col + 1}`;
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>'"]/g, char => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
    })[char]);
  }

  function defaultLabel(flower) {
    const pattern = flower.pattern === "Solid" ? "" : ` ${flower.secondary_color ? `& ${flower.secondary_color} ` : ""}${flower.pattern}`;
    return `${flower.color}${pattern} ${flower.flower_type}`;
  }

  // A small map of the plot with 1-based row/column numbers. cellHtml(row,
  // col, key) draws a cell, or returns "" for the default (blank, or
  // dimmed when `dimmed` holds the key, or outlined when `later` does).
  function gridHtml(shape, cellHtml, dimmed, later = new Set()) {
    const parts = [`<span class="pg-axis"></span>`];
    for (let col = 0; col < shape.cols; col += 1) parts.push(`<span class="pg-axis">${col + 1}</span>`);
    for (let row = 0; row < shape.rows; row += 1) {
      parts.push(`<span class="pg-axis">${row + 1}</span>`);
      for (let col = 0; col < shape.cols; col += 1) {
        const key = `${row}:${col}`;
        const custom = cellHtml(row, col, key);
        if (custom) {
          parts.push(custom);
        } else if (shape.grid?.[row]?.[col] === "#") {
          parts.push(`<span class="pg-cell outside"></span>`);
        } else {
          parts.push(`<span class="pg-cell${dimmed.has(key) ? " other" : later.has(key) ? " later" : ""}"></span>`);
        }
      }
    }
    return `<div class="pg-map" style="grid-template-columns:auto repeat(${shape.cols}, 1fr)" aria-hidden="true">${parts.join("")}</div>`;
  }

  // This step's cells show their item number. Spots already holding a plant
  // by then (kept plants and earlier steps) are dimmed, as on the dig-up map,
  // so they work as landmarks; later steps' spots are only outlined.
  function miniMapHtml(index, steps, shape, keptCells, flowerStyle) {
    const keyOf = cell => `${cell.row}:${cell.col}`;
    const stepCells = step => step.items.flatMap(item => item.cells);
    const here = new Map();
    steps[index].items.forEach(item => item.cells.forEach(cell => here.set(keyOf(cell), item)));
    const planted = new Set([...keptCells, ...steps.slice(0, index).flatMap(stepCells)].map(keyOf));
    const later = new Set(steps.slice(index + 1).flatMap(stepCells).map(keyOf));
    return gridHtml(shape, (row, col, key) => {
      const item = here.get(key);
      return item
        ? `<span class="pg-cell plant" style="${flowerStyle(item.flower)}" title="${escapeHtml(spot({row, col}))}">${item.number}</span>`
        : "";
    }, planted, later);
  }

  // Group cells by flower, in reading order of each flower's first spot.
  function byFlower(cells) {
    const groups = new Map();
    for (const cell of cells) {
      const key = variantKey(cell.flower);
      if (!groups.has(key)) groups.set(key, {flower: cell.flower, cells: []});
      groups.get(key).cells.push(cell);
    }
    return [...groups.values()];
  }

  // Spots to dig up are marked ✕; plants that stay are dimmed for bearings.
  function digUpHtml(removeCells, keptCells, shape, flowerStyle, label) {
    if (!removeCells.length) return "";
    const dig = new Map(removeCells.map(cell => [`${cell.row}:${cell.col}`, cell]));
    const kept = new Set(keptCells.map(cell => `${cell.row}:${cell.col}`));
    const map = gridHtml(shape, (row, col, key) => {
      const cell = dig.get(key);
      return cell
        ? `<span class="pg-cell dig" title="${escapeHtml(`Dig up ${label(cell.flower)} at ${spot(cell)}`)}">✕</span>`
        : "";
    }, kept);
    const count = removeCells.length;
    const groups = byFlower(removeCells);
    const items = groups.map(group => `<li>
        <span class="pg-swatch" style="${flowerStyle(group.flower)}"></span>
        <span class="pg-item-name">${escapeHtml(label(group.flower))}${group.cells.length > 1 ? ` <small>× ${group.cells.length}</small>` : ""}</span>
        <span class="pg-spots">${group.cells.map(spot).join(", ")}</span>
      </li>`).join("");
    // A long list would push the map's neighbours far down; the map is
    // what matters, so fold the list away past a handful of flowers.
    const list = groups.length > DIG_LIST_OPEN
      ? `<details class="pg-dig-list"><summary>Which flower is on each spot (${groups.length})</summary><ol class="pg-items">${items}</ol></details>`
      : `<ol class="pg-items">${items}</ol>`;
    return `<div class="pg-step pg-remove">
        <div class="pg-step-text">
          <div class="pg-step-head"><span class="pg-step-number">✕</span><strong>First dig up ${count} plant${count === 1 ? "" : "s"}</strong></div>
          <p class="pg-results">Marked ✕ on the map. Grey spots keep their plants.</p>
          ${list}
        </div>
        ${map}
      </div>`;
  }

  function filterHtml(step) {
    const rows = CATEGORIES
      .filter(([name]) => step.filter[name].length)
      .map(([name, , label]) => `<span class="pg-filter"><small>${label}</small>${step.filter[name].map(value => `<b>${escapeHtml(value)}</b>`).join("")}</span>`);
    return rows.join("");
  }

  /* shape: {rows, cols, grid}; flowerStyle(flower) gives inline CSS for a
   * swatch; label(flower) names a variant. removeCells are planted cells to
   * dig up first; keptCells are planted cells that stay. */
  function renderGuide(steps, shape, {flowerStyle = () => "", label = defaultLabel, keptCount = 0, removeCells = [], keptCells = [], itemAction = () => ""} = {}) {
    if (!steps.length && !removeCells.length) return "";
    const remove = digUpHtml(removeCells, keptCells, shape, flowerStyle, label);
    const kept = keptCount ? ` · ${keptCount} already in place` : "";
    if (!steps.length) {
      // A partial update that only removes plants: the dig-up map is the whole guide.
      const digs = removeCells.length;
      return `<details class="planting-guide" open>
      <summary><strong>Planting guide</strong><span>Dig up ${digs} plant${digs === 1 ? "" : "s"}, nothing to plant${kept}</span></summary>
      ${remove}
    </details>`;
    }
    const allCells = steps.flatMap(step => step.items.flatMap(item => item.cells));
    const plants = allCells.length;
    const stepHtml = steps.map((step, index) => `<li class="pg-step">
        <div class="pg-step-text">
          <div class="pg-step-head"><span class="pg-step-number">${index + 1}</span><div class="pg-filters">${filterHtml(step)}</div></div>
          <p class="pg-results">${step.results} flower${step.results === 1 ? "" : "s"} in the filtered list</p>
          <ol class="pg-items">${step.items.map(item => `<li>
            <span class="pg-swatch" style="${flowerStyle(item.flower)}">${item.number}</span>
            <span class="pg-item-name">${escapeHtml(label(item.flower))}${item.cells.length > 1 ? ` <small>× ${item.cells.length}</small>` : ""}</span>
            <span class="pg-spots">${item.cells.map(spot).join(", ")}</span>
            ${itemAction(item.flower)}
          </li>`).join("")}</ol>
        </div>
        ${miniMapHtml(index, steps, shape, keptCells, flowerStyle)}
      </li>`).join("");
    return `<details class="planting-guide" open>
      <summary><strong>Planting guide</strong><span>${plants} plant${plants === 1 ? "" : "s"} in ${steps.length} step${steps.length === 1 ? "" : "s"}${kept}</span></summary>
      <p class="pg-help">Set the filters for each step, then plant each flower on its spot. R = row and C = column, counted from the top-left corner starting at 1. On each map, grey spots already have a plant and outlined spots get one in a later step.</p>
      ${remove}
      <ol class="pg-steps">${stepHtml}</ol>
    </details>`;
  }

  return {cellsToPlant, cellsToRemove, planSteps, renderGuide, spot, variantKey};
});
