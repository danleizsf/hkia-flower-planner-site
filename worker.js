// Runs the planner (Python, via Pyodide) off the page's main thread.
// The program unpacks into /app; the farm lives in /farm, which is saved to
// the browser's IndexedDB after every change, so it survives reloads.
// A first visit starts from an empty farm (then the setup screens). Messages: {id, method, path, body}
// -> {id, status, body}; {id, op: "export"|"import"|"undo"|"previous"|"reset"} for the farm itself,
// {id, op: "forecast", kind, body} for the forecast worker's results.
importScripts("https://cdn.jsdelivr.net/pyodide/v0.27.7/full/pyodide.js");

const FARM = "/farm";
// The farm a restore (or Start over) replaced, kept outside the farm for "Undo the last restore".
const PREVIOUS = "/farm-previous";
let py, entry;

function syncFarm(populate) {
  return new Promise((resolve, reject) => py.FS.syncfs(populate, (err) => (err ? reject(err) : resolve())));
}

async function unpack(url, dir) {
  const response = await fetch(url, {cache: "no-cache"});
  if (!response.ok) throw new Error(`Could not load ${url} (${response.status})`);
  py.unpackArchive(await response.arrayBuffer(), "zip", {extractDir: dir});
}

const ready = (async () => {
  const started = performance.now();
  // The planner breaks ties in set order: a fixed hash seed keeps plans stable between visits.
  py = await loadPyodide({env: {PYTHONHASHSEED: "0", HOME: "/home/pyodide"}});
  await unpack("app.zip", "/app");
  // Also kept: the planner's cache (plot layouts take ~20 s to search; keyed on the code, so an update recomputes).
  for (const dir of [FARM, PREVIOUS, "/app/.cache"]) {
    py.FS.mkdirTree(dir);
    py.FS.mount(py.FS.filesystems.IDBFS, {}, dir);
  }
  await syncFarm(true);
  py.runPython("import os, sys; os.chdir('/app'); sys.path[:0] = ['/app', '/app/browser']");
  if (!py.FS.analyzePath(`${FARM}/farm_data/inventory.json`).exists) {
    py.runPython(`from pathlib import Path; from hkia_solver.new_farm import create_empty_farm; create_empty_farm(Path('${FARM}'))`);
    await syncFarm(false);
  }
  entry = py.pyimport("entry");
  entry.init(FARM);
  // Generate plan runs here and blocks status requests, so its progress is pushed to the page instead.
  entry.listen_progress((text) => self.postMessage({progress: JSON.parse(text)}));
  self.postMessage({ready: true, seconds: (performance.now() - started) / 1000});
})().catch((error) => {
  self.postMessage({ready: false, error: String(error)});
  throw error;
});

// When the saved earlier farm was put aside (shown with "Undo the last restore").
function savedNow() {
  if (py.FS.analyzePath(`${PREVIOUS}/farm.zip`).exists) {
    py.FS.writeFile(`${PREVIOUS}/saved.json`, JSON.stringify({saved: new Date().toISOString()}));
  }
}

// One request at a time, in arrival order (the HTTP dashboard serializes changes the same way).
let queue = Promise.resolve();
self.onmessage = (event) => {
  queue = queue.then(() => handle(event.data));
};

async function handle({id, op, method, path, body, file, kind}) {
  try {
    await ready;
    // Backups: browser/farm_backup.py (tested in tests/test_farm_backup.py).
    if (op === "export") {
      py.runPython(`from pathlib import Path; from farm_backup import export_farm; export_farm(Path('${FARM}'), Path('/tmp/farm.zip'))`);
      const data = py.FS.readFile("/tmp/farm.zip");
      self.postMessage({id, file: data}, [data.buffer]);
      return;
    }
    if (op === "import") {  // checked in full first; a bad backup leaves the farm (and the saved one) as they were
      py.FS.writeFile("/tmp/import.zip", new Uint8Array(file));
      try {
        py.runPython(`from pathlib import Path; from farm_backup import import_farm
import_farm(Path('/tmp/import.zip'), Path('${FARM}'), keep_previous=Path('${PREVIOUS}/farm.zip'))`);
      } finally {
        py.FS.unlink("/tmp/import.zip");
      }
      savedNow();
      await syncFarm(false);
      self.postMessage({id, status: 200, body: "{}"});
      return;
    }
    if (op === "undo") {    // swap the farm with the one the last restore replaced
      py.runPython(`from pathlib import Path; from farm_backup import undo_restore; undo_restore(Path('${FARM}'), Path('${PREVIOUS}/farm.zip'))`);
      savedNow();
      await syncFarm(false);
      self.postMessage({id, status: 200, body: "{}"});
      return;
    }
    if (op === "forecast") {  // from forecast_worker.js via the page: partial / final / stop
      entry.forecast_update(kind, body || "");
      await syncFarm(false);
      self.postMessage({id, status: 200, body: "{}"});
      return;
    }
    if (op === "previous") {
      const saved = py.FS.analyzePath(`${PREVIOUS}/farm.zip`).exists && py.FS.analyzePath(`${PREVIOUS}/saved.json`).exists
        ? JSON.parse(py.FS.readFile(`${PREVIOUS}/saved.json`, {encoding: "utf8"})).saved : null;
      self.postMessage({id, status: 200, body: JSON.stringify({saved})});
      return;
    }
    if (op === "reset") {   // the farm is saved for Undo first; the page reloads into a new, empty farm
      const saved = py.runPython(`import os, shutil
from pathlib import Path
from farm_backup import export_farm
had_farm = Path('${FARM}/farm_data/inventory.json').is_file()
if had_farm:
    export_farm(Path('${FARM}'), Path('${PREVIOUS}/farm.zip'))
for n in os.listdir('${FARM}'):
    p = os.path.join('${FARM}', n)
    shutil.rmtree(p) if os.path.isdir(p) else os.remove(p)
had_farm`);
      if (saved) savedNow();
      await syncFarm(false);
      self.postMessage({id, status: 200, body: "{}"});
      return;
    }
    const result = entry.handle(method, path, body || "");
    const [status, text] = result.toJs();
    result.destroy();
    self.postMessage({id, status, body: text});
    if (method === "POST") {
      // Generate plan replies "starting" first; the work itself runs now.
      if (entry.run_pending()) self.postMessage({planDone: true});
      await syncFarm(false);
    }
  } catch (error) {
    // A Python error carries its whole traceback; the last line is the message.
    const message = String(error?.message || error).trim().split("\n").pop().replace(/^\w*Error: /, "");
    self.postMessage({id, status: 500, body: JSON.stringify({error: message})});
  }
}
