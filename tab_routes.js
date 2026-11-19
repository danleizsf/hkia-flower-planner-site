(function (root, factory) {
  const routes = factory();
  if (typeof module === "object" && module.exports) module.exports = routes;
  root.HKIATabRoutes = routes;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const validTabs = new Set(["farm", "targets", "inventory", "history", "roadmap"]);

  function isValid(tab) {
    return validTabs.has(tab);
  }

  function parse(search) {
    const selected = new URLSearchParams(search || "").get("tab");
    return isValid(selected) ? selected : "farm";
  }

  function toSearch(search, tab) {
    const params = new URLSearchParams(search || "");
    if (tab === "farm") params.delete("tab");
    else if (isValid(tab)) params.set("tab", tab);
    const query = params.toString();
    return query ? `?${query}` : "";
  }

  return {isValid, parse, toSearch};
});
