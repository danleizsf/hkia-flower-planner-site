(function (root, factory) {
  const annotations = factory();
  if (typeof module === "object" && module.exports) module.exports = annotations;
  root.HKIAParentAnnotations = annotations;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  function markerForCell(gridMarker, cell) {
    const role = cell?.parent_role;
    return role === "A" || role === "B" ? role : gridMarker;
  }

  return {markerForCell};
});
