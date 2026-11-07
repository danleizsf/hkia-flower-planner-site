# What's new

Changes to the planner at https://danleizsf.github.io/hkia-flower-planner-site/,
newest first. Entries before 2026-11-05 were written afterwards from the
project's history, grouped by day.

## 2026-11-06

- **Fillers only use flowers you have spare.** When a plot had more free tiles
  than spare copies, a used-up flower could still be suggested, so the planting
  guide asked for plants you didn't have. Fillers still use the flowers you
  have the most spare copies of first.
- **Editing a planted layout keeps its fillers.** Saving your own changes to a
  plot (for example, swapping a filler for a different flower) used to forget
  which tiles were fillers, so the next Recommendation tried to redo them.
- **Inventory + / − works on iPhone.** The number pad has no Enter key, so the
  amount you typed was thrown away when you tapped the ✓. Leaving the box with a
  number in it now saves it; leave it empty (or press Esc) to cancel.

## 2026-11-05

- **Fillers no longer mix with a patterned parent.** A patterned flower breeds
  with a solid flower of its own type when their colors can mix (a White Ombre
  Dandelily and a Red Dandelily make Warm Pink), so those are no longer
  suggested as fillers next to it. Layouts also stop putting such pairs side
  by side by accident. Thanks to the Reddit commenter who caught it!
- Fillers are now checked against every flower they share an empty tile with,
  not only the ones around the planned spawn tiles.

## 2026-11-04

- **Fillers:** outdoor Recommendations mark extra flowers (X) to plant around
  the spawn tiles. They raise the daily spawn chance without breeding with
  anything nearby. Plant them once, then fertilize them daily. Fillers can be
  turned off in settings, and the forecast counts them when they're on.
- **Forecast:** each target now gets a daily roll at its chance, like the game,
  instead of waiting for its expected time. Forecasts are much closer to real
  play (and still on the cautious side). A Full forecast button shows the rest.
- **Found it somewhere else:** record where a find actually appeared; finds a
  patch couldn't have produced are refused.
- Planting guides show the plants you keep on each step's map, as landmarks.

## 2026-11-03

- Faster first load: the farm shows first and the inventory loads behind it.
- History days follow the game's daily reset (06:00 UTC).
- The forecast explainer is clearer about timing.

## 2026-11-02

- **Event banner:** what's in season and for how long.
- The forecast covers the next 60 days, with your island as it is (no unlocks
  or upgrades assumed), and runs in the browser.
- Planning is about 20% faster.
- Happadil no longer gets planned in Caldera, Icy Peak or Spooky Swamp.
- Collapsing a region on the map is instant.
- Setup asks for your seeds and plants rather than "flowers".
- Updates reach you right away instead of waiting on a stale cache.

## 2026-11-01

- **First public release.** Setup screens (your island, your collection, a
  first plan with progress), a getting-started guide, and a Farm menu with
  backups (restore checks the file first and can be undone).
- Patch check marks clear at the game's daily reset (06:00 UTC).
