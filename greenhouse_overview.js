(function (root, factory) {
  const overview = factory();
  if (typeof module === "object" && module.exports) module.exports = overview;
  root.HKIAGreenhouseOverview = overview;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  // The Greenhouse grows with its upgrades (2 x 3 up to 10 x 11): sized from its plot's grid.
  const DEFAULT_SIZE = 10;
  const occupiedMarkers = new Set(["A", "B", "·"]);

  function emptyGrid(fill, height, width) {
    return Array.from({length: height}, () => Array(width).fill(fill));
  }

  function plantSignature(cell) {
    if (!cell) return "";
    return [cell.flower_type, cell.color, cell.pattern, cell.secondary_color || ""].join("|");
  }

  function jobRows(plot) {
    const actual = plot.actual_jobs?.length ? plot.actual_jobs : (plot.actual ? [plot.actual] : []);
    const recommendation = plot.recommended_jobs?.length
      ? plot.recommended_jobs
      : (plot.recommended ? [plot.recommended] : []);
    return (actual.length ? actual : recommendation).map(job => ({
      ...job,
      slot: plot.slot,
      work_view: actual.length ? "Actual" : "Recommendation",
    }));
  }

  function buildSharedLayout(plots = []) {
    const sized = plots.find(plot => plot && (plot.greenhouse || plot.region === "Greenhouse") && plot.grid?.length);
    const HEIGHT = sized ? sized.grid.length : DEFAULT_SIZE;
    const WIDTH = sized ? sized.grid[0].length : DEFAULT_SIZE;
    const grid = emptyGrid("--", HEIGHT, WIDTH);
    const cellGrid = emptyGrid(null, HEIGHT, WIDTH);
    const conflicts = [];
    const jobs = [];
    const slots = [];

    for (const plot of plots) {
      if (!plot || !(plot.greenhouse || plot.region === "Greenhouse")) continue;
      slots.push(plot.slot);
      jobs.push(...jobRows(plot));
      const sourceGrid = plot.grid || plot.actual_grid || plot.recommended_grid;
      const sourceFlowers = plot.display_cell_grid
        || (plot.actual_state !== "unplanted" ? plot.actual_cell_grid : null)
        || plot.recommended_cell_grid;
      for (let row = 0; row < HEIGHT; row += 1) {
        for (let col = 0; col < WIDTH; col += 1) {
          const marker = sourceGrid?.[row]?.[col];
          const flower = sourceFlowers?.[row]?.[col] || null;
          if (grid[row][col] === "!") continue;
          if (flower) {
            const previous = cellGrid[row][col];
            if (previous && plantSignature(previous) !== plantSignature(flower)) {
              grid[row][col] = "!";
              cellGrid[row][col] = null;
              conflicts.push({row, col, kind: "different-plants"});
            } else if (!previous) {
              cellGrid[row][col] = flower;
            }
          }
          if (!occupiedMarkers.has(marker)) continue;
          const current = grid[row][col];
          if (current === "--" || current === "x") {
            grid[row][col] = marker;
            continue;
          }
          if (current === marker && marker !== "·") continue;
          if (current === "·" && marker === "·") {
            grid[row][col] = "!";
            cellGrid[row][col] = null;
            conflicts.push({row, col, kind: "shared-spawn-cell"});
          } else if (["A", "B"].includes(current) && ["A", "B"].includes(marker)
            && plantSignature(cellGrid[row][col])) {
            // A physical flower can be Parent A in one recipe and Parent B in
            // another; role letters are recipe-local, not separate plants.
            continue;
          } else if (current !== marker) {
            grid[row][col] = "!";
            cellGrid[row][col] = null;
            conflicts.push({row, col, kind: "plant-spawn-overlap"});
          }
        }
      }
    }

    return {grid, cellGrid, conflicts, jobs, slots, rows: HEIGHT, cols: WIDTH};
  }

  return {buildSharedLayout};
});
