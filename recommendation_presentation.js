(function (root, factory) {
  const presentation = factory();
  root.HKIARecommendationPresentation = presentation;
  if (typeof module === "object" && module.exports) module.exports = presentation;
})(typeof window !== "undefined" ? window : globalThis, function () {
  const deferredPlotStates = new Set(["keep", "partial_update", "review"]);

  function forPlot(plot, jobs, matrixMode) {
    const states = jobs.map(job => job.work_state || "new_work");
    const allComplete = states.length > 0 && states.every(state => state === "already_complete");
    const hasNew = states.includes("new_work");
    const hasComplete = states.includes("already_complete");
    const deferred = deferredPlotStates.has(plot.action_state);

    let title = plot.recommended?.custom_target ? "Custom recommendation" : "New recommendation";
    if (plot.action_state === "partial_update" && plot.partial_update_ready) {
      title = "Partial update layout";
    } else if (allComplete) {
      title = "Recommendation (already complete)";
    } else if (hasNew && hasComplete) {
      title = deferred
        ? "Future recommendation (mixed; new work deferred)"
        : "Recommendation (mixed status)";
    } else if (deferred && hasNew) {
      title = "Future recommendation (deferred)";
    }

    let notice = "";
    if (matrixMode === "recommended" && states.length > 0) {
      if (plot.partial_update_ready) {
        notice = plot.partial_update_has_completed
          ? "This layout keeps unfinished Actual targets in their current safe zones and uses zones released by completed work. Clear and replant only the completed zones before recording it."
          : "This layout keeps unfinished Actual targets in place and adds new work only in currently free safe zones.";
      } else if (allComplete) {
        notice = "Inventory already satisfies every goal listed here. No planting is needed.";
      } else if (deferred && hasNew && hasComplete) {
        notice = "This is a future layout. Some goals are already satisfied by inventory; new work for this plot is deferred while unfinished Actual plants remain. Do not replace those plants with this layout.";
      } else if (deferred && hasNew) {
        notice = "This is a future layout for the whole plot. Keep the saved Actual plants in place while their goals are unfinished; this recommendation cannot be planted over them.";
      }
    }

    return {title, notice};
  }

  return {forPlot};
});
