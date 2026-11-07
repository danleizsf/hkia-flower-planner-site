// First-time setup. A farm with no plan yet (a new player) opens these
// screens instead of the dashboard: a welcome, "Your island" (which flower
// patches and which Greenhouse they have), "Your collection" (tick what
// they've collected, filtered like the in-game inventory), then the first
// plan. The copies and "what's planted" steps come next (browser/ONBOARDING.md). The island screen also edits the areas later,
// from the Farm map's "Areas" button, and a locked plot's card unlocks it.
(function (root, factory) {
  const onboarding = factory();
  if (typeof module === "object" && module.exports) module.exports = onboarding;
  root.HKIAOnboarding = onboarding;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const esc = value => String(value ?? "").replace(/[&<>'"]/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
  })[char]);

  async function call(path, body) {
    const response = await fetch(path, body === undefined ? {} : {
      method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(body),
    });
    const data = await response.json().catch(() => ({error: "The planner didn't answer. Try again."}));
    if (!response.ok) throw new Error(data.error || "Request failed");
    return data;
  }

  // ---- Your island: pure rendering, so it is testable without a page ----

  function greenhousePreview(size) {
    if (!size.plots) return `<span class="gh-preview gh-none">—</span>`;
    const dots = Array.from({length: size.plots}, () => "<i></i>").join("");
    return `<span class="gh-preview" style="--gh-rows:${size.rows};--gh-cols:${size.cols}">${dots}</span>`;
  }

  function greenhouseLabel(size) {
    if (!size.plots) return "Not yet";
    return `${size.rows} × ${size.cols}${size.level === 7 ? " · Extreme" : ""}`;
  }

  function islandHtml(data, choice) {
    const areas = data.areas.map(area => {
      const on = area.plots.filter(plot => choice.unlocked.has(plot.slot)).length;
      const all = on === area.plots.length;
      const patches = area.plots.map(plot => `
        <label class="patch">
          <input type="checkbox" data-patch="${esc(plot.slot)}" ${choice.unlocked.has(plot.slot) ? "checked" : ""}>
          <span>${esc(plot.name)}</span><small>${plot.spots} spots</small>
        </label>`).join("");
      return `<details class="area" data-area="${esc(area.region)}" ${choice.open.has(area.region) ? "open" : ""}>
        <summary>
          <input type="checkbox" data-area-toggle="${esc(area.region)}" ${all ? "checked" : ""}
                 data-partial="${on > 0 && !all}" aria-label="All of ${esc(area.region)}">
          <span class="area-name">${esc(area.region)}</span>
          <span class="area-count">${on} of ${area.plots.length} patch${area.plots.length === 1 ? "" : "es"}</span>
        </summary>
        <div class="patches">${patches}</div>
      </details>`;
    }).join("");
    const sizes = data.greenhouse_sizes.map(size => `
      <label class="gh-size${choice.level === size.level ? " chosen" : ""}">
        <input type="radio" name="ghLevel" value="${size.level}" ${choice.level === size.level ? "checked" : ""}>
        ${greenhousePreview(size)}
        <strong>${greenhouseLabel(size)}</strong>
        <small>${size.plots ? `${size.plots} plots` : "not unlocked"}</small>
      </label>`).join("");
    return `
      <section class="island-areas">
        <div class="island-head">
          <h3>Flower patches</h3>
          <span class="island-total">${choice.unlocked.size} of ${data.areas.reduce((n, a) => n + a.plots.length, 0)} unlocked</span>
          <button type="button" class="button small secondary" data-all="on">All on</button>
          <button type="button" class="button small secondary" data-all="off">All off</button>
        </div>
        <p class="hint">Patches open one at a time through quests. Open an area to pick its patches.</p>
        ${areas}
      </section>
      <section class="island-greenhouse">
        <h3>Greenhouse</h3>
        <p class="hint">It grows with each upgrade; most of the breeding happens here once it's big.</p>
        <div class="gh-sizes">${sizes}</div>
      </section>`;
  }

  // Wires an island form; choice = {unlocked: Set, level, open: Set} is edited in place.
  function bindIsland(container, data, choice) {
    const redraw = () => {
      container.innerHTML = islandHtml(data, choice);
      container.querySelectorAll("[data-partial=true]").forEach(box => { box.indeterminate = true; });
      bind();
    };
    const bind = () => {
      container.querySelectorAll("[data-patch]").forEach(box => box.addEventListener("change", () => {
        box.checked ? choice.unlocked.add(box.dataset.patch) : choice.unlocked.delete(box.dataset.patch);
        redraw();
      }));
      container.querySelectorAll("[data-area-toggle]").forEach(box => {
        box.addEventListener("click", event => event.stopPropagation());   // don't open/close the area
        box.addEventListener("change", () => {
          const area = data.areas.find(a => a.region === box.dataset.areaToggle);
          area.plots.forEach(plot => (box.checked ? choice.unlocked.add(plot.slot) : choice.unlocked.delete(plot.slot)));
          redraw();
        });
      });
      container.querySelectorAll("details.area").forEach(details => details.addEventListener("toggle", () => {
        details.open ? choice.open.add(details.dataset.area) : choice.open.delete(details.dataset.area);
      }));
      container.querySelectorAll("[data-all]").forEach(button => button.addEventListener("click", () => {
        choice.unlocked = new Set(button.dataset.all === "on" ? data.areas.flatMap(a => a.plots.map(p => p.slot)) : []);
        redraw();
      }));
      container.querySelectorAll("input[name=ghLevel]").forEach(radio => radio.addEventListener("change", () => {
        choice.level = Number(radio.value);
        redraw();
      }));
    };
    redraw();
  }

  function choiceFrom(data) {
    return {
      unlocked: new Set(data.areas.flatMap(a => a.plots.filter(p => p.unlocked).map(p => p.slot))),
      level: data.greenhouse_level,
      open: new Set(),
    };
  }

  function saveIsland(choice) {
    if (!choice.unlocked.size && !choice.level) {
      throw new Error("Pick at least one flower patch or a Greenhouse to plan for.");
    }
    return call("/api/farm/plots", {unlocked_plots: [...choice.unlocked], greenhouse_level: choice.level});
  }

  // ---- Your collection: same filters as the in-game inventory ----

  const variantKey = (type, color, pattern) => `${type}|${color}|${pattern}`;

  // view = {by: "color" | "type", color, type, pattern}; collected: Set of variant keys.
  function collectionPage(data, view) {
    const types = data.flower_types.filter(t => t.patterns.includes(view.pattern));
    if (view.by === "color") {
      return types.map(t => ({key: variantKey(t.name, view.color, view.pattern), label: t.name,
                              hex: data.colors.find(c => c.name === view.color)?.hex}));
    }
    const type = data.flower_types.find(t => t.name === view.type);
    if (!type.patterns.includes(view.pattern)) return [];
    return data.colors.map(c => ({key: variantKey(type.name, c.name, view.pattern), label: c.name, hex: c.hex,
                                  starter: type.default_colors.includes(c.name)}));
  }

  // counts: Map of variant key -> plantable copies (collected flowers only).
  function collectionHtml(data, view, collected, counts) {
    const page = collectionPage(data, view);
    const choices = view.by === "color" ? data.colors.map(c => c.name) : data.flower_types.map(t => t.name);
    const current = view.by === "color" ? view.color : view.type;
    const patterns = view.by === "type"
      ? data.flower_types.find(t => t.name === view.type).patterns
      : [...new Set(data.flower_types.flatMap(t => t.patterns))];
    const chips = page.map(item => {
      const on = collected.has(item.key);
      return `<div class="chip${on ? " on" : ""}">
        <button type="button" class="chip-toggle" data-variant="${esc(item.key)}" aria-pressed="${on}">
          <i class="swatch" style="background:${esc(item.hex || "#ccc")}"></i>
          <span>${esc(item.label)}</span>${item.starter ? `<small>starter</small>` : ""}
        </button>
        ${on ? `<label class="chip-count" title="Seeds and plants you have">×<input type="number" min="0" max="999"
          inputmode="numeric" value="${counts.get(item.key) ?? 1}" data-count="${esc(item.key)}"
          aria-label="Copies of ${esc(item.label)}"></label>` : ""}
      </div>`;
    }).join("");
    return `
      <details class="copies-hint"><summary>Tap each seed or plant you have, then type how many.
        What counts?</summary>
        <p>Copies are what you can plant: <strong>seed packets</strong> and <strong>seedlings</strong> (use the
          seed / plant filter in your inventory), plus plucked <strong>plain flowers</strong>, which the Seed
          Dispenser turns back into seeds of the same color (extremophiles too). Plucked patterned or event
          flowers don't count. Not sure? Leave 1; you can change counts later on the Inventory tab.</p>
      </details>
      <div class="collection-filters">
        <div class="segmented" role="group" aria-label="Browse by">
          <button type="button" data-by="color" aria-pressed="${view.by === "color"}">By color</button>
          <button type="button" data-by="type" aria-pressed="${view.by === "type"}">By flower type</button>
        </div>
        <label>Pattern <select data-pattern>${patterns.map(p => `<option ${p === view.pattern ? "selected" : ""}>${esc(p)}</option>`).join("")}</select></label>
      </div>
      <div class="collection-pager">
        <button type="button" class="button small secondary" data-step="-1" aria-label="Previous">◀</button>
        <select data-current aria-label="${view.by === "color" ? "Color" : "Flower type"}">
          ${choices.map(name => `<option ${name === current ? "selected" : ""}>${esc(name)}</option>`).join("")}
        </select>
        <button type="button" class="button small secondary" data-step="1" aria-label="Next">▶</button>
        <span class="collection-total">${collected.size} collected</span>
      </div>
      <div class="chips">${chips || `<p class="hint">${esc(view.type)} has no ${esc(view.pattern)} pattern.</p>`}</div>
      <div class="collection-page-actions">
        <button type="button" class="button small secondary" data-page="all">All on this page</button>
        <button type="button" class="button small secondary" data-page="none">None on this page</button>
      </div>`;
  }

  function bindCollection(container, data, view, collected, counts) {
    const redraw = () => { container.innerHTML = collectionHtml(data, view, collected, counts); bind(); };
    // A newly collected flower starts at 1 copy; a typed count is never overwritten.
    const add = key => { collected.add(key); if (!counts.has(key)) counts.set(key, 1); };
    const drop = key => { collected.delete(key); counts.delete(key); };
    const bind = () => {
      container.querySelectorAll("[data-variant]").forEach(chip => chip.addEventListener("click", () => {
        const key = chip.dataset.variant;
        collected.has(key) ? drop(key) : add(key);
        redraw();
        container.querySelector(`[data-count="${CSS.escape(key)}"]`)?.select();
      }));
      container.querySelectorAll("[data-count]").forEach(input => {
        // No redraw while typing (it would steal the focus); a bad entry goes back on leaving the box.
        input.addEventListener("input", () => {
          const value = Number(input.value);
          if (input.value !== "" && Number.isInteger(value) && value >= 0 && value <= 999) counts.set(input.dataset.count, value);
        });
        input.addEventListener("change", () => { input.value = counts.get(input.dataset.count) ?? 1; });
      });
      container.querySelectorAll("[data-by]").forEach(button => button.addEventListener("click", () => {
        view.by = button.dataset.by;
        if (view.by === "type" && !data.flower_types.find(t => t.name === view.type).patterns.includes(view.pattern)) {
          view.pattern = "Solid";
        }
        redraw();
      }));
      container.querySelector("[data-pattern]").addEventListener("change", event => {
        view.pattern = event.target.value;
        redraw();
      });
      const choices = () => (view.by === "color" ? data.colors.map(c => c.name) : data.flower_types.map(t => t.name));
      const setCurrent = name => { view.by === "color" ? (view.color = name) : (view.type = name); };
      container.querySelector("[data-current]").addEventListener("change", event => {
        setCurrent(event.target.value);
        redraw();
      });
      container.querySelectorAll("[data-step]").forEach(button => button.addEventListener("click", () => {
        const list = choices();
        const at = list.indexOf(view.by === "color" ? view.color : view.type);
        setCurrent(list[(at + Number(button.dataset.step) + list.length) % list.length]);
        if (view.by === "type" && !data.flower_types.find(t => t.name === view.type).patterns.includes(view.pattern)) {
          view.pattern = "Solid";
        }
        redraw();
      }));
      container.querySelectorAll("[data-page]").forEach(button => button.addEventListener("click", () => {
        collectionPage(data, view).forEach(item => (button.dataset.page === "all" ? add(item.key) : drop(item.key)));
        redraw();
      }));
    };
    redraw();
  }

  // Only what changed is sent: newly collected flowers and changed counts
  // (with their count), and flowers no longer collected.
  function collectionChanges(before, after, beforeCounts = new Map(), counts = new Map()) {
    const row = key => { const [flower_type, color, pattern] = key.split("|"); return {flower_type, color, pattern}; };
    return {
      collect: [...after]
        .filter(key => !before.has(key) || (counts.get(key) ?? 1) !== (beforeCounts.get(key) ?? 1))
        .map(key => ({...row(key), count: counts.get(key) ?? 1})),
      uncollect: [...before].filter(key => !after.has(key)).map(row),
    };
  }

  // Shown on the welcome screen and in the Farm menu. The plot shapes and the
  // pattern list are hkiaflowergen's data; no code was taken from it.
  const CREDITS = `<p class="credits">A fan-made tool, not affiliated with Sanrio or Sunblink.
    Plot shapes and which patterns each flower can have come from
    <a href="https://flowerfulpowerful.github.io/hkiaflowergen/" target="_blank" rel="noopener">hkiaflowergen</a>
    by Auevi (Vi) &amp; contributors; where flowers grow and how breeding works, from the
    <a href="https://hellokittyislandadventure.wiki.gg/" target="_blank" rel="noopener">Hello Kitty Island Adventure Wiki</a>,
    cross-checked against hkiaflowergen. Thank you!
    Free software under the <a href="https://github.com/danleizsf/hkia-flower-planner-site" target="_blank"
    rel="noopener">AGPL-3.0</a>. Built with help from Claude Code, an AI coding assistant.
    <a href="https://github.com/danleizsf/hkia-flower-planner-site/blob/main/CHANGELOG.md" target="_blank"
    rel="noopener">What's new</a></p>`;

  // The browser version's tip jar: a small link in the bottom-right corner.
  const TIP_URL = "https://ko-fi.com/danleiz";
  function showTipJar() {
    if (!browserFarm() || document.getElementById("tipJar")) return;
    const link = document.createElement("a");
    Object.assign(link, {id: "tipJar", className: "tip-jar", href: TIP_URL, target: "_blank", rel: "noopener",
                         textContent: "♥ Tip jar", title: "Enjoying the planner? Leave a tip on Ko-fi"});
    document.body.appendChild(link);
  }

  // ---- The first-visit screens ----

  let overlay = null;

  function screen(html) {
    overlay.innerHTML = `<div class="onboarding-card">${html}</div>`;
    overlay.scrollTop = 0;
    return overlay.querySelector(".onboarding-card");
  }

  function welcome(onDone) {
    const card = screen(`
      <div class="onboarding-mark">✿</div>
      <h2>Plan your Hello Kitty Island Adventure flower farm</h2>
      <p class="lead">Tell it which areas you've unlocked and which flowers you've collected, and it works
        out what to plant where to finish your collection fastest.</p>
      <p class="fine">Everything stays on this device. Nothing is uploaded.</p>
      <div class="welcome-actions">
        <button type="button" class="button primary big" data-go>Set up my farm</button>
        ${browserFarm() ? `<button type="button" class="link-button" data-restore>Restore a farm backup</button>` : ""}
      </div>
      <p class="error" hidden></p>
      ${CREDITS}`);
    card.querySelector("[data-go]").addEventListener("click", () => island(onDone));
    showTipJar();
    const fail = error => {
      const box = card.querySelector(".error");
      box.textContent = error.message;
      box.hidden = false;
    };
    card.querySelector("[data-restore]")?.addEventListener("click", () => restoreBackup(fail));
    // After Start over (or a restore) the farm it replaced is kept: offer it back here too.
    browserFarm()?.previousFarm().then(saved => {
      if (!saved || !card.isConnected) return;
      const undo = document.createElement("button");
      undo.type = "button";
      undo.className = "link-button";
      undo.dataset.undo = "";
      undo.textContent = "Bring back my previous farm";
      undo.addEventListener("click", () => browserFarm().undoRestore().catch(fail));
      card.querySelector(".welcome-actions").appendChild(undo);
    }).catch(() => {});
  }

  async function island(onDone) {
    const card = screen(`<p class="fine">Loading your island…</p>`);
    let data;
    try {
      data = await call("/api/farm/plots");
    } catch (error) {
      card.innerHTML = `<p class="error">${esc(error.message)}</p>`;
      return;
    }
    const choice = choiceFrom(data);
    const view = screen(`
      <p class="step">Step 1 · Your island</p>
      <h2>Which parts of the island do you have?</h2>
      <p class="lead">The plan only uses the flower patches and Greenhouse you've unlocked. Not sure? Leave
        everything on; you can change it any time with <strong>Areas</strong> on the Farm map.</p>
      <div class="island-form"></div>
      <p class="error" hidden></p>
      <div class="onboarding-actions">
        <button type="button" class="button secondary" data-back>Back</button>
        <button type="button" class="button primary big" data-next>Next</button>
      </div>`);
    bindIsland(view.querySelector(".island-form"), data, choice);
    view.querySelector("[data-back]").addEventListener("click", () => welcome(onDone));
    view.querySelector("[data-next]").addEventListener("click", async () => {
      const error = view.querySelector(".error");
      error.hidden = true;
      try {
        await saveIsland(choice);
        await call("/api/setup", {step: "island"});
      } catch (err) {
        error.textContent = err.message;
        error.hidden = false;
        return;
      }
      collection(onDone);
    });
  }

  const COLLECTION_LEAD = `We're after what you can <strong>plant</strong>: mostly seed packets and
    seedlings, not picked flowers (see "What counts?" below). In your in-game inventory, switch to seeds and plants, set the same filter (color, flower
    type, pattern) and tap what you see. Anything you miss can be added later from the Inventory tab.`;

  /** The collection form in ``container``; resolves {save} (saves only what changed, in one go). */
  async function mountCollection(container) {
    const data = await call("/api/setup/collection");
    const before = new Set(data.collected);
    const collected = new Set(data.collected);
    const beforeCounts = new Map(Object.entries(data.counts || {}));
    const counts = new Map(beforeCounts);
    const view = {by: "color", color: data.colors[0].name, type: data.flower_types[0].name, pattern: "Solid"};
    bindCollection(container, data, view, collected, counts);
    return {
      async save() {
        const changes = collectionChanges(before, collected, beforeCounts, counts);
        if (changes.collect.length || changes.uncollect.length) await call("/api/setup/collection", changes);
        changes.collect.forEach(row => {
          const key = variantKey(row.flower_type, row.color, row.pattern);
          before.add(key);
          beforeCounts.set(key, row.count);
        });
        changes.uncollect.forEach(row => {
          const key = variantKey(row.flower_type, row.color, row.pattern);
          before.delete(key);
          beforeCounts.delete(key);
        });
        return changes.collect.length + changes.uncollect.length;
      },
    };
  }

  async function collection(onDone) {
    const page = screen(`
      <p class="step">Step 2 · Your collection</p>
      <h2>Which seeds and plants do you have, and how many?</h2>
      <p class="lead">${COLLECTION_LEAD}</p>
      <div class="collection-form"><p class="fine">Loading your collection…</p></div>
      <p class="error" hidden></p>
      <div class="onboarding-actions">
        <button type="button" class="button secondary" data-back>Back</button>
        <div class="onboarding-actions-end">
          <button type="button" class="button secondary" data-skip title="Keep what you've ticked and finish this later from the Inventory tab or the Farm menu">Skip for now</button>
          <button type="button" class="button primary big" data-next>Next</button>
        </div>
      </div>`);
    const fail = err => {
      const box = page.querySelector(".error");
      box.textContent = err.message;
      box.hidden = false;
    };
    let form;
    try {
      form = await mountCollection(page.querySelector(".collection-form"));
    } catch (err) {
      fail(err);
      return;
    }
    // "Skipped" puts "Add your collection" at the top of the guide until it is done.
    const finish = step => async () => {
      try {
        await form.save();
        await call("/api/setup", {step: "collection", value: step});
      } catch (err) {
        fail(err);
        return;
      }
      planted(onDone);
    };
    page.querySelector("[data-back]").addEventListener("click", () => form.save().then(() => island(onDone), fail));
    page.querySelector("[data-skip]").addEventListener("click", finish("skipped"));
    page.querySelector("[data-next]").addEventListener("click", finish(true));
  }

  /** The collection form as a dialog (Inventory tab, Farm menu, the guide); onSaved(message) after a save. */
  async function openCollection(onSaved) {
    const dialog = document.createElement("dialog");
    dialog.className = "areas-dialog collection-dialog";
    dialog.innerHTML = `
      <h2>Your collection</h2>
      <p class="lead">${COLLECTION_LEAD}</p>
      <div class="collection-form"><p class="fine">Loading your collection…</p></div>
      <p class="error" hidden></p>
      <div class="onboarding-actions">
        <button type="button" class="button secondary" data-cancel>Cancel</button>
        <button type="button" class="button primary" data-save>Save</button>
      </div>`;
    document.body.appendChild(dialog);
    const close = () => { dialog.close(); dialog.remove(); };
    const fail = error => {
      const box = dialog.querySelector(".error");
      box.textContent = error.message;
      box.hidden = false;
    };
    dialog.addEventListener("cancel", close);
    dialog.querySelector("[data-cancel]").addEventListener("click", close);
    dialog.showModal();
    let form;
    try {
      form = await mountCollection(dialog.querySelector(".collection-form"));
    } catch (error) {
      fail(error);
      return;
    }
    dialog.querySelector("[data-save]").addEventListener("click", async () => {
      try {
        const changed = await form.save();
        // A collection skipped during setup now counts as done ("later" keeps its guide item, ticked).
        if (guide?.collection === "skipped") await call("/api/setup", {step: "collection", value: "later"});
        close();
        onSaved?.(changed ? `Saved ${changed} change${changed === 1 ? "" : "s"}. Generate plan to plan with them.` : "No changes.");
      } catch (error) {
        fail(error);
      }
    });
  }

  function planted(onDone) {
    const view = screen(`
      <p class="step">Step 3 · What's planted now</p>
      <h2>What about the flowers already in your plots?</h2>
      <p class="lead">The plan says what to plant in each plot. Either way you can change your mind later.</p>
      <div class="planted-choices">
        <label class="planted-choice chosen">
          <input type="radio" name="planted" value="fresh" checked>
          <strong>Plan as if my plots were empty</strong>
          <span>Quickest to start: replant each plot as the plan shows when you get to it.</span>
        </label>
        <label class="planted-choice">
          <input type="radio" name="planted" value="keep">
          <strong>Keep what's planted</strong>
          <span>Record what's in each plot first (open a plot, then <em>Edit planted layout</em>), then make a
            new plan: it keeps the work already in the ground. The guide on the Farm map walks you through it.</span>
        </label>
      </div>
      <p class="error" hidden></p>
      <div class="onboarding-actions">
        <button type="button" class="button secondary" data-back>Back</button>
        <button type="button" class="button primary big" data-next>Make my first plan</button>
      </div>`);
    view.querySelectorAll("input[name=planted]").forEach(radio => radio.addEventListener("change", () => {
      view.querySelectorAll(".planted-choice").forEach(label => label.classList.toggle("chosen", label.contains(radio) && radio.checked));
    }));
    view.querySelector("[data-back]").addEventListener("click", () => collection(onDone));
    view.querySelector("[data-next]").addEventListener("click", async () => {
      const choice = view.querySelector("input[name=planted]:checked").value;
      try {
        await call("/api/setup", {step: "planted", value: choice});
      } catch (err) {
        const box = view.querySelector(".error");
        box.textContent = err.message;
        box.hidden = false;
        return;
      }
      firstPlan(onDone);
    });
  }

  async function firstPlan(onDone) {
    const card = screen(`
      <h2>Making your first plan…</h2>
      <div class="plan-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
        <div class="plan-progress-bar"><i style="width:0%"></i></div>
        <p class="plan-progress-stage"><strong>0%</strong> · Starting…</p>
        <p class="plan-progress-detail"></p>
      </div>
      <p class="lead">This takes about a minute on a computer, longer on a phone. <span class="plan-elapsed"></span></p>`);
    const started = Date.now();
    const clock = setInterval(() => {
      const s = Math.round((Date.now() - started) / 1000);
      card.querySelector(".plan-elapsed").textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")} so far.`;
    }, 1000);
    const stop = onPlanProgress(update => showPlanProgress(card, update));
    try {
      let status = await call("/api/plan", {replant_all: true});
      while (["starting", "running"].includes(status.state)) {
        await new Promise(resolve => setTimeout(resolve, 1500));
        status = await call("/api/plan/status");
        if (status.progress) showPlanProgress(card, status.progress);      // the desktop reports here
      }
      if (status.state !== "completed") throw new Error(status.message || "The plan could not be made.");
    } catch (error) {
      card.innerHTML = `<h2>That didn't work</h2><p class="error">${esc(error.message)}</p>
        <button type="button" class="button primary" data-retry>Try again</button>`;
      card.querySelector("[data-retry]").addEventListener("click", () => firstPlan(onDone));
      return;
    } finally {
      clearInterval(clock);
      stop();
    }
    overlay.remove();
    overlay = null;
    document.body.classList.remove("onboarding-open");
    onDone?.();
  }

  // ---- Generate plan's progress (hkia_solver/progress.py) ----

  /** Calls ``handler(update)`` for each progress update the browser version pushes; returns a stop function. */
  function onPlanProgress(handler) {
    const listener = event => handler(event.detail);
    globalThis.addEventListener?.("hkia-plan-progress", listener);
    return () => globalThis.removeEventListener?.("hkia-plan-progress", listener);
  }

  // update = {stage, label, percent, detail}
  function planProgressText(update) {
    return {percent: Math.max(0, Math.min(100, Number(update.percent) || 0)), stage: update.label || "Working…",
            detail: update.detail || ""};
  }

  function showPlanProgress(container, update) {
    const {percent, stage, detail} = planProgressText(update);
    container.querySelector(".plan-progress")?.setAttribute("aria-valuenow", String(percent));
    const bar = container.querySelector(".plan-progress-bar i");
    if (bar) bar.style.width = `${percent}%`;
    const line = container.querySelector(".plan-progress-stage");
    if (line) line.innerHTML = `<strong>${percent}%</strong> · ${esc(stage)}`;
    const more = container.querySelector(".plan-progress-detail");
    if (more) more.textContent = detail;
  }

  /** Show the setup screens if this farm needs them; resolves true when shown. */
  async function start({onDone} = {}) {
    let status;
    try {
      status = await call("/api/setup");
    } catch (_error) {
      return false;          // an older server without setup: just show the dashboard
    }
    if (!status.needs_setup) return false;
    overlay = document.createElement("div");
    overlay.id = "onboarding";
    overlay.className = "onboarding";
    document.body.appendChild(overlay);
    document.body.classList.add("onboarding-open");
    welcome(onDone);
    return true;
  }

  // ---- The guide: a getting-started checklist on the Farm map, and one-time hints ----

  let guide = null;              // /api/setup's "guide" (null: a farm set up before onboarding existed)

  // The checklist, in order; the browser version adds the backup item (its farm lives only there).
  function guideItems(state, inBrowser) {
    const items = [{key: "setup", label: "Set up your farm", done: true}];
    if (state.collection === "skipped" || state.collection === "later") {
      items.push({key: "collection", label: "Add your collection", action: "Add your collection",
                  how: "Tick the flowers you've collected and how many, then Generate plan. Also on the Inventory tab.",
                  done: state.collection === "later"});
    }
    if (state.planted === "keep") {
      items.push({key: "recorded", label: "Record what's already in your plots",
                  how: "Open a plot, press Edit planted layout and paint what's there. Then Generate plan: it keeps that work."});
    }
    items.push(
      {key: "applied", label: "Plant your first plot",
       how: "Open a plot card, plant it in the game exactly as shown, then press Record as planted so the planner knows."},
      {key: "spawns", label: "Record your first spawns",
       how: "Next time you play, press Record spawns and add the new flowers that appeared."},
      {key: "found", label: "Find your first target",
       how: "When a plot's target flower appears, open the plot and press Found."},
      {key: "replanned", label: "Make a new plan after a few finds",
       how: "Generate plan builds a fresh plan around what you've found."},
    );
    if (inBrowser) {
      items.push({key: "backup", label: "Download a backup of your farm",
                  how: "Your farm lives only in this browser. Use Farm > Download a backup now and then."});
    }
    return items.map(item => ({...item, done: item.done || (item.key === "backup" ? Boolean(state.backup) : Boolean(state.done?.[item.key]))}));
  }

  // A browser farm lives only in that browser: remind once it has progress and no backup, or a week after the last one.
  function backupDue(state, inBrowser, today = new Date()) {
    if (!inBrowser) return false;
    if (!state.backup) return Boolean(state.done?.found);
    return (today - new Date(`${state.backup}T00:00:00`)) / 86400000 >= 7;
  }

  function guideHtml(state, inBrowser, today = new Date()) {
    const items = guideItems(state, inBrowser);
    const next = items.find(item => !item.done);
    const done = items.filter(item => item.done).length;
    const stale = (state.finds_since_plan >= 3
      ? `<p class="guide-nudge">You've found ${state.finds_since_plan} targets since your last plan.
           <button type="button" class="button small primary" data-guide-plan>Generate plan</button></p>` : "")
      + (backupDue(state, inBrowser, today)
        ? `<p class="guide-nudge">Your farm is only saved in this browser${state.backup ? `; last backup ${esc(state.backup)}` : ""}.
             <button type="button" class="button small secondary" data-guide-backup>Download a backup</button></p>` : "");
    if (state.hidden) return stale ? `<section class="guide-card slim">${stale}</section>` : "";
    return `<section class="guide-card" aria-label="Getting started">
      <div class="guide-head">
        <h3>${next ? "Getting started" : "You're all set!"}</h3>
        <span class="guide-progress">${done} of ${items.length}</span>
        <button type="button" class="button small secondary" data-guide-hide>Hide</button>
      </div>
      <ol class="guide-items">${items.map(item => `
        <li class="${item.done ? "done" : item === next ? "next" : ""}">
          <span class="tick" aria-hidden="true">${item.done ? "✓" : ""}</span>
          <div><strong>${esc(item.label)}</strong>${item === next && item.how ? `<small>${esc(item.how)}</small>` : ""}
            ${item === next && item.action ? `<button type="button" class="button small primary guide-action" data-guide-action="${esc(item.key)}">${esc(item.action)}</button>` : ""}</div>
        </li>`).join("")}</ol>
      ${stale}
    </section>`;
  }

  /** Redraw the guide card (after every farm change); resolves the guide state. */
  async function refreshGuide() {
    const box = document.getElementById("gettingStarted");
    try {
      guide = (await call("/api/setup")).guide;
    } catch (_error) {
      guide = null;
    }
    const menu = document.getElementById("farmMenu");
    if (menu) menu.hidden = !farmMenuAvailable();
    showTipJar();
    if (!box) return guide;
    box.innerHTML = guide ? guideHtml(guide, Boolean(browserFarm())) : "";
    box.querySelector("[data-guide-hide]")?.addEventListener("click", async () => {
      await call("/api/setup", {step: "guide", value: "hidden"}).catch(() => {});
      refreshGuide();
    });
    box.querySelector("[data-guide-plan]")?.addEventListener("click", () => document.getElementById("generatePlan")?.click());
    box.querySelector("[data-guide-backup]")?.addEventListener("click", () => downloadBackup());
    box.querySelector("[data-guide-action=collection]")?.addEventListener("click", () => openCollection(afterCollection));
    return guide;
  }

  // After the collection dialog saves: tell the player and reload the dashboard (which redraws the guide).
  function afterCollection(message) {
    globalThis.toast?.(message);
    return globalThis.refreshState ? globalThis.refreshState(false) : refreshGuide();
  }

  async function showGuideAgain() {
    await call("/api/setup", {step: "guide", value: "shown"});
    return refreshGuide();
  }

  const HINTS = {
    map: "How to read a plot: <strong>A</strong> and <strong>B</strong> are the two parent flowers, and the dotted cells are where new flowers spawn. Open a plot to see exactly what goes where.",
    plot: "Plant this in the game exactly as shown, then press <strong>Record as planted</strong> so the planner knows it's in the ground.",
    spawns: "Add the new flowers that appeared since you last played. The planner updates your copies, and marks a target found when it shows up.",
  };

  /** A one-time hint placed before ``anchor`` (inline, so it also works inside dialogs and on phones). */
  function hint(id, anchor) {
    if (!guide || guide.hints_seen.includes(id) || !anchor || document.querySelector(`[data-hint="${id}"]`)) return;
    const box = document.createElement("div");
    box.className = "hint-bubble";
    box.dataset.hint = id;
    box.innerHTML = `<span class="hint-icon" aria-hidden="true">💡</span><p>${HINTS[id]}</p>
      <button type="button" class="button small secondary">Got it</button>`;
    box.querySelector("button").addEventListener("click", () => {
      guide.hints_seen.push(id);
      box.remove();
      call("/api/setup/hint", {hint: id}).catch(() => {});
    });
    anchor.before(box);
  }

  // ---- Farm menu: backups (browser version) and the guide ----

  const browserFarm = () => globalThis.hkiaBrowser || null;

  async function downloadBackup() {
    // The date goes in first, so the backup itself remembers it was backed up.
    await call("/api/setup", {step: "backup", value: new Date().toISOString().slice(0, 10)});
    await browserFarm().exportFarm();
    return refreshGuide();
  }

  // Picks a backup file and restores it (the page reloads into the restored farm).
  function restoreBackup(onError) {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".zip,application/zip";
    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      if (!file) return;
      if (!confirm(`Replace the farm in this browser with ${file.name}? Your current farm is kept, so you can undo this from the Farm menu.`)) return;
      try {
        await browserFarm().importFarm(file);
      } catch (error) {
        onError?.(error);
      }
    });
    input.click();
  }

  /** The header's Farm button: shown in the browser version, or for a farm that has the guide. */
  function farmMenuAvailable() {
    return Boolean(browserFarm() || guide);
  }

  async function openFarmMenu(toast) {
    const farm = browserFarm();
    // The farm the last restore (or Start over) replaced, if one was kept.
    const previous = farm ? await farm.previousFarm().catch(() => null) : null;
    const dialog = document.createElement("dialog");
    dialog.className = "areas-dialog farm-menu";
    dialog.innerHTML = `
      <h2>Your farm</h2>
      ${farm ? `<p class="lead">Your farm is saved in this browser only. Download a backup now and then, and to
        move it to another device.</p>
      <div class="farm-menu-actions">
        <button type="button" class="button primary" data-act="backup">Download a backup</button>
        <button type="button" class="button secondary" data-act="restore">Restore from a backup…</button>
      </div>
      ${guide?.backup ? `<p class="fine">Last backup: ${esc(guide.backup)}</p>` : ""}
      ${previous ? `<div class="farm-menu-actions"><button type="button" class="button secondary" data-act="undo">Undo the last restore</button></div>
        <p class="fine">Brings back the farm you had before your last restore or Start over
          (kept ${esc(new Date(previous).toLocaleString())}).</p>` : ""}` : ""}
      <div class="farm-menu-actions"><button type="button" class="button secondary" data-act="collection">Your collection…</button></div>
      ${guide?.hidden ? `<div class="farm-menu-actions"><button type="button" class="button secondary" data-act="guide">Show the getting-started guide</button></div>` : ""}
      ${farm ? `<div class="farm-menu-danger"><button type="button" class="button danger small" data-act="reset">Start over with an empty farm</button></div>` : ""}
      <p class="error" hidden></p>
      ${CREDITS}
      <div class="onboarding-actions"><span></span><button type="button" class="button secondary" data-act="close">Close</button></div>`;
    document.body.appendChild(dialog);
    const close = () => { dialog.close(); dialog.remove(); };
    const fail = error => {
      const box = dialog.querySelector(".error");
      box.textContent = error.message;
      box.hidden = false;
    };
    dialog.addEventListener("cancel", close);
    dialog.querySelector("[data-act=close]").addEventListener("click", close);
    dialog.querySelector("[data-act=backup]")?.addEventListener("click", () =>
      downloadBackup().then(() => { close(); toast?.("Backup downloaded."); }, fail));
    dialog.querySelector("[data-act=restore]")?.addEventListener("click", () => restoreBackup(fail));
    dialog.querySelector("[data-act=guide]")?.addEventListener("click", () => showGuideAgain().then(close, fail));
    dialog.querySelector("[data-act=collection]").addEventListener("click", () => { close(); openCollection(afterCollection); });
    dialog.querySelector("[data-act=undo]")?.addEventListener("click", () => {
      if (confirm("Go back to the farm you had before the last restore or Start over? The farm you have now is kept, so you can switch back.")) {
        farm.undoRestore().catch(fail);
      }
    });
    dialog.querySelector("[data-act=reset]")?.addEventListener("click", () => {
      if (confirm("Start over with an empty farm? Your current farm is kept, so you can undo this from the Farm menu.")) {
        farm.resetFarm().catch(fail);
      }
    });
    dialog.showModal();
  }

  // ---- Later: editing the areas from the Farm map ----

  /** The island screen as a dialog; onSaved(message) after a save. */
  async function openAreas(onSaved) {
    const data = await call("/api/farm/plots");
    const choice = choiceFrom(data);
    const dialog = document.createElement("dialog");
    dialog.className = "areas-dialog";
    dialog.innerHTML = `<form method="dialog">
      <h2>Your island</h2>
      <p class="lead">Turn on the flower patches and Greenhouse you've unlocked, then Generate plan.</p>
      <div class="island-form"></div>
      <p class="error" hidden></p>
      <div class="onboarding-actions">
        <button type="button" class="button secondary" data-cancel>Cancel</button>
        <button type="button" class="button primary" data-save>Save</button>
      </div></form>`;
    document.body.appendChild(dialog);
    bindIsland(dialog.querySelector(".island-form"), data, choice);
    const close = () => { dialog.close(); dialog.remove(); };
    dialog.querySelector("[data-cancel]").addEventListener("click", close);
    dialog.addEventListener("cancel", close);
    dialog.querySelector("[data-save]").addEventListener("click", async () => {
      try {
        const result = await saveIsland(choice);
        close();
        onSaved?.(result.message);
      } catch (error) {
        const box = dialog.querySelector(".error");
        box.textContent = error.message;
        box.hidden = false;
      }
    });
    dialog.showModal();
  }

  /** A locked plot's "I've unlocked it": add it to the farm's unlocked plots. */
  async function unlockPlot(slot) {
    const data = await call("/api/farm/plots");
    const unlocked = data.areas.flatMap(a => a.plots.filter(p => p.unlocked || p.slot === slot).map(p => p.slot));
    return call("/api/farm/plots", {unlocked_plots: unlocked});
  }

  return {start, openAreas, unlockPlot, refreshGuide, showGuideAgain, hint, openFarmMenu, farmMenuAvailable,
          openCollection, afterCollection, onPlanProgress, planProgressText,
          islandHtml, choiceFrom, collectionPage, collectionChanges, guideItems, guideHtml, backupDue};
});
