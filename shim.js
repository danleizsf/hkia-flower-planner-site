// Browser build: the dashboard's fetch("/api/...") calls go to the planner
// running in a Web Worker (worker.js) instead of a server. Loaded before the
// dashboard's own scripts; everything else in the dashboard is unchanged.
(() => {
  const worker = new Worker("worker.js?v=439fcb27b7");
  const waiting = new Map();
  let nextId = 1;

  const banner = document.createElement("div");
  banner.id = "browserBoot";
  banner.textContent = "Starting the planner in your browser… (first visit downloads about 10 MB)";
  banner.style.cssText = "position:fixed;left:50%;top:12px;transform:translateX(-50%);z-index:99999;"
    + "background:#2d2a32;color:#fff;padding:8px 14px;border-radius:8px;font:14px system-ui;"
    + "box-shadow:0 2px 8px rgba(0,0,0,.25)";
  const showBanner = () => document.body && !banner.isConnected && document.body.appendChild(banner);
  document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", showBanner) : showBanner();

  worker.onmessage = ({data}) => {
    if ("ready" in data) {
      if (data.ready) banner.remove();
      else banner.textContent = `The planner could not start: ${data.error}`;
      return;
    }
    if (data.planDone) return;
    if (data.progress) {           // Generate plan's progress (the page listens for this event)
      window.dispatchEvent(new CustomEvent("hkia-plan-progress", {detail: data.progress}));
      return;
    }
    const done = waiting.get(data.id);
    if (!done) return;
    waiting.delete(data.id);
    done(data);
  };

  function call(message) {
    const id = nextId++;
    return new Promise((resolve) => {
      waiting.set(id, resolve);
      worker.postMessage({id, ...message});
    });
  }

  const realFetch = window.fetch.bind(window);
  window.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === "string" ? input : input.url, location.href);
    const at = url.pathname.indexOf("/api/");
    if (at < 0) return realFetch(input, init);
    const method = (init.method || "GET").toUpperCase();
    const path = url.pathname.slice(at);
    const reply = await call({method, path, body: typeof init.body === "string" ? init.body : ""});
    if (path === "/api/flow/forecast" && reply.status === 200) {
      try { const kind = JSON.parse(reply.body).browser_forecast; if (kind) startForecast(kind === "full"); } catch (_) { /* not JSON */ }
    }
    return new Response(reply.body, {status: reply.status, headers: {"Content-Type": "application/json"}});
  };

  // The forecast: a second worker (forecast_worker.js) on a copy of the farm, its results
  // relayed to the planner's worker. Closing or reloading the tab stops it, so the page asks first.
  let forecastWorker = null;
  const keepOpen = event => { event.preventDefault(); event.returnValue = ""; };
  function forecastDone(error) {
    forecastWorker?.terminate();
    forecastWorker = null;
    window.removeEventListener("beforeunload", keepOpen);
    window.dispatchEvent(new CustomEvent("hkia-forecast-done", {detail: {error: error || null}}));
  }
  async function startForecast(full = false) {
    if (forecastWorker) return;
    const farm = await call({op: "export"});
    if (!farm.file) {
      await call({op: "forecast", kind: "stop"});
      return forecastDone("The farm couldn't be copied for the forecast.");
    }
    forecastWorker = new Worker("forecast_worker.js?v=439fcb27b7");
    window.addEventListener("beforeunload", keepOpen);
    forecastWorker.onmessage = async ({data}) => {
      if (data.partial) {
        await call({op: "forecast", kind: "partial", body: data.partial});
      } else if (data.final) {
        await call({op: "forecast", kind: "final", body: data.final});
        forecastDone();
      } else {
        await call({op: "forecast", kind: "stop"});
        forecastDone(data.error || "The forecast stopped.");
      }
    };
    forecastWorker.onerror = async event => {
      await call({op: "forecast", kind: "stop"});
      forecastDone(event.message || "The forecast stopped.");
    };
    forecastWorker.postMessage({farm: farm.file, full}, [farm.file.buffer]);
  }

  // The farm itself (the Farm menu, web/onboarding.js; also usable from the console):
  //   hkiaBrowser.exportFarm()      downloads the farm as a zip
  //   hkiaBrowser.importFarm(file)  replaces the farm with a downloaded backup, then reloads
  //   hkiaBrowser.resetFarm()       starts over with an empty farm
  //   hkiaBrowser.undoRestore()     brings back the farm the last restore / Start over replaced
  const failed = reply => reply.status && reply.status !== 200
    ? new Error((() => { try { return JSON.parse(reply.body).error; } catch { return reply.body; } })()) : null;
  window.hkiaBrowser = {
    async exportFarm() {
      const reply = await call({op: "export"});
      if (failed(reply)) throw failed(reply);
      const link = document.createElement("a");
      link.href = URL.createObjectURL(new Blob([reply.file], {type: "application/zip"}));
      link.download = `hkia-farm-${new Date().toISOString().slice(0, 10)}.zip`;
      link.click();
    },
    async importFarm(file) {
      const reply = await call({op: "import", file: await file.arrayBuffer()});
      if (failed(reply)) throw failed(reply);
      location.reload();
    },
    async resetFarm() {
      await call({op: "reset"});
      location.reload();
    },
    // The farm the last restore (or Start over) replaced: when it was saved, or null.
    async previousFarm() {
      const reply = await call({op: "previous"});
      return JSON.parse(reply.body).saved;
    },
    forecastRunning: () => Boolean(forecastWorker),
    async undoRestore() {
      const reply = await call({op: "undo"});
      if (failed(reply)) throw failed(reply);
      location.reload();
    },
  };
})();
