/* Job tags for the plot map: one number per job group plus a role letter.
 *
 *   1A / 1B  a breeding pair (A = first parent, B = second). A donor shared by
 *            several jobs keeps one number; each of its recipients is 1B.
 *   2F       a plant in a fertilizer bed
 *   3P       a single plant propagating copies of itself
 */
(function (root, factory) {
  const tags = factory();
  if (typeof module === "object" && module.exports) module.exports = tags;
  root.HKIAJobTags = tags;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const key = cell => `${cell[0]}:${cell[1]}`;

  function kindOf(job) {
    const method = String(job.method || "");
    if (method.startsWith("fertilize_")) return "F";
    if (method === "propagate_solid" || method === "propagation") return "P";
    return "pair";
  }

  // Returns {cells: Map("r:c" -> tag), groups: [{number, kind, jobs}]}.
  // Groups are numbered by position on the plot, top-left first.
  function jobTags(jobs) {
    const groups = [];
    const byDonor = new Map();
    (jobs || []).forEach(job => {
      const layout = job.layout || {};
      const aCells = [...(layout.parent_a_cells || []), ...(layout.shared_parent_a_cells || [])];
      const bCells = layout.parent_b_cells || [];
      const kind = kindOf(job);
      let group = kind === "pair" && aCells.length ? byDonor.get(key(aCells[0])) : null;
      if (!group) {
        group = {number: 0, kind, jobs: [], a: [], b: []};
        groups.push(group);
        if (kind === "pair") aCells.forEach(cell => byDonor.set(key(cell), group));
      }
      group.jobs.push(job);
      group.a.push(...aCells);
      group.b.push(...bCells);
    });
    const first = group => [...group.a, ...group.b].reduce(
      (best, cell) => (!best || cell[0] < best[0] || (cell[0] === best[0] && cell[1] < best[1]) ? cell : best), null) || [1e9, 1e9];
    groups.sort((x, y) => first(x)[0] - first(y)[0] || first(x)[1] - first(y)[1]);
    const cells = new Map();
    groups.forEach((group, index) => {
      group.number = index + 1;
      const letterA = group.kind === "pair" ? "A" : group.kind;
      group.a.forEach(cell => { if (!cells.has(key(cell))) cells.set(key(cell), `${group.number}${letterA}`); });
      group.b.forEach(cell => { if (!cells.has(key(cell))) cells.set(key(cell), `${group.number}B`); });
      delete group.a;
      delete group.b;
    });
    return {cells, groups};
  }

  return {jobTags, kindOf};
});
