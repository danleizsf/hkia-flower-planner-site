// The forecast (hkia_solver/flow/forecast.py), run on a copy of the farm in
// its own worker so the planner's worker (worker.js) stays free for the page.
// shim.js starts it with {farm: <backup zip>} and relays what it posts to
// worker.js, which writes it into the farm the way the desktop's forecast
// process does: {partial: json} as it goes, then {final: json}, or {error}.
importScripts("https://cdn.jsdelivr.net/pyodide/v0.27.7/full/pyodide.js");

self.onmessage = async ({data}) => {
  try {
    const py = await loadPyodide({env: {PYTHONHASHSEED: "0", HOME: "/home/pyodide"}});
    const app = await fetch("app.zip", {cache: "no-cache"});
    py.unpackArchive(await app.arrayBuffer(), "zip", {extractDir: "/app"});
    // Read the plot layouts worker.js keeps (saves ~20 s); never written from here.
    py.FS.mkdirTree("/app/.cache");
    py.FS.mount(py.FS.filesystems.IDBFS, {}, "/app/.cache");
    await new Promise(resolve => py.FS.syncfs(true, () => resolve()));
    py.FS.writeFile("/tmp/farm.zip", new Uint8Array(data.farm));
    py.globals.set("post_partial", text => self.postMessage({partial: text}));
    py.globals.set("full_forecast", Boolean(data.full));
    const final = py.runPython(`
import json, os, sys, zipfile
from pathlib import Path
os.chdir('/app'); sys.path[:0] = ['/app', '/app/browser']
with zipfile.ZipFile('/tmp/farm.zip') as archive:
    archive.extractall('/farm')
from hkia_solver.flow.forecast import build_forecast, inputs_key
root = Path('/farm')
forecast = build_forecast(root, key=inputs_key(root), **({"max_days": None, "full": True} if full_forecast else {}),
                          on_partial=lambda snapshot: post_partial(json.dumps(snapshot)))
json.dumps(forecast)`);
    self.postMessage({final});
  } catch (error) {
    self.postMessage({error: String(error?.message || error).trim().split("\n").pop()});
  }
};
