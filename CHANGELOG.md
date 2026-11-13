# What's new

Changes to the planner at https://danleizsf.github.io/hkia-flower-planner-site/,
newest first. Entries before 2026-11-05 were written afterwards from the
project's history, grouped by day.

Each entry starts with its kind: `[feature]` (something new), `[tweak]` (a UI
tweak or smaller improvement) or `[fix]` (a bug fix). `, whats-new` after the
kind also shows it in the planner's What's new window.

## 2026-11-12

- [fix, whats-new] **Daily reset at the right time.** The game resets at
  midnight Mountain Time (11 pm Pacific all year), not a fixed 06:00 UTC, so
  since daylight saving ended the planner's day turned an hour early. Plot
  checks, the History days and event last days now follow the real reset.
- [tweak, whats-new] **Settings where they belong.** **Fillers** moved out of
  the Generate plan window to the Plot map, next to Areas: it's a setting for
  the whole farm that Replant plot uses too, and the map now has an X Filler
  entry in its legend. **I use Cogimyun when fertilizing** moved to the
  Forecast tab, since it changes the forecast, not what you plant. The forecast
  says when it's out of date after you change it.
- [fix, whats-new] **Plans only use plants you really have.** A filler could
  ask for a flower whose last copies were still in another patch that was
  waiting to be replanted. Every plant now counts the same way, whether it's a
  parent, a filler or a fertilizer-bed plant, and a plant stays in its patch
  until you record that patch. A plot that would be short of copies says so on
  the map, and recording it is refused instead of going below zero.
- [feature, whats-new] **Moving plants in a whole-farm replant.** With Replant
  the whole farm, a patch can reuse a plant another patch no longer needs. Its
  Recommendation says where to dig it up first, and you record that patch
  before this one.
- [tweak, whats-new] **A better Full forecast.** Full forecast now runs the
  same forecast as the normal one (your real planner, replanting after each
  find) all the way to the end of your collection, instead of the older, rougher
  simulator. It can take a long time; keep the tab open while it runs.
- [fix, whats-new] **Every spawn cell on the plot map.** Spawn cells shared by
  several flowers in a group weren't tinted green on the plot map, so only a
  few scattered cells showed where new flowers can appear. All of them show now.
- [fix, whats-new] **Fillers around every spawn cell.** Spawn cells shared by
  several flowers in a group (around a patterned parent with many recipients)
  were skipped, so those plots got few or no fillers, and a filler could land
  on a spawn cell. Fillers now go around all of them; generate a plan to get
  the new spots, and move any X that sits on a spawn cell.
- [feature, whats-new] **Cogimyun.** If you use Cogimyun's ability when you
  fertilize, tick **I use Cogimyun when fertilizing** in the Generate plan
  window. Her ability gives each fertilized solid a 5% daily chance (instead of
  1%) to turn into its default pattern, in every region, and the plan and
  forecast now count on it. It doesn't change spawn chances.
- [tweak, whats-new] **Smoother event endings.** Flowers grow overnight at the
  daily reset, and on an event's last day that reset comes after the event, so
  plans made that day already keep its flowers out of outdoor plots. On the
  last day the event banner reminds you to generate a plan for the whole farm
  (the button opens Generate plan with Replant the whole farm ticked), and the
  reminder stays for up to a week until you do. The planner's day now also
  changes at the daily reset instead of at midnight.

## 2026-11-08

- [fix] Flower names in the collection window no longer break in the middle
  of a word.
- [fix, whats-new] **Fillers stay put on a partial update.** After a find, the
  Recommendation used to pick every filler again, so the planting guide asked
  you to dig up fillers that were still working and swap them for other
  colors. Now a filler stays unless its tile is needed, it no longer sits next
  to a spawn tile, or it would breed with a new neighbor. Fillers that do have
  to move are replanted elsewhere before other flowers are used. (Fillers next
  to the same empty tile are still different colors: two of the same flower
  would breed with each other.)
- [feature, whats-new] **What's new and Feedback.** **What's new**, next to the
  Flower Farm title, lists every update by date (a dot means there's one you
  haven't seen yet). **Feedback**, in the bottom-right corner, lets you report
  a problem or suggest an idea right from the planner. No sign-in needed.
- [tweak, whats-new] **A tidier header:** just Farm, Record spawns and Generate
  plan. The **Fillers** switch moved into the Generate plan window, with what
  it does spelled out. The Farm menu no longer disappears on some phone sizes.

## 2026-11-06

- [fix, whats-new] **Fillers only use flowers you have spare.** When a plot had
  more free tiles than spare copies, a used-up flower could still be suggested,
  so the planting guide asked for plants you didn't have. Fillers still use the
  flowers you have the most spare copies of first.
- [fix, whats-new] **Editing a planted layout keeps its fillers.** Saving your
  own changes to a plot (for example, swapping a filler for a different flower)
  used to forget which tiles were fillers, so the next Recommendation tried to
  redo them.
- [fix, whats-new] **Inventory + / − works on iPhone.** The number pad has no
  Enter key, so the amount you typed was thrown away when you tapped the ✓.
  Leaving the box with a number in it now saves it; leave it empty (or press
  Esc) to cancel.

## 2026-11-05

- [fix, whats-new] **Fillers no longer mix with a patterned parent.** A
  patterned flower breeds with a solid flower of its own type when their colors
  can mix (a White Ombre Dandelily and a Red Dandelily make Warm Pink), so
  those are no longer suggested as fillers next to it. Layouts also stop
  putting such pairs side by side by accident. Thanks to the Reddit commenter
  who caught it!
- [fix, whats-new] Fillers are now checked against every flower they share an
  empty tile with, not only the ones around the planned spawn tiles.

## 2026-11-04

- [feature, whats-new] **Fillers:** outdoor Recommendations mark extra flowers
  (X) to plant around the spawn tiles. They raise the daily spawn chance
  without breeding with anything nearby. Plant them once, then fertilize them
  daily. Fillers can be turned off in settings, and the forecast counts them
  when they're on.
- [feature, whats-new] **Forecast:** each target now gets a daily roll at its
  chance, like the game, instead of waiting for its expected time. Forecasts
  are much closer to real play (and still on the cautious side). A Full
  forecast button shows the rest.
- [feature, whats-new] **Found it somewhere else:** record where a find
  actually appeared; finds a patch couldn't have produced are refused.
- [tweak, whats-new] Planting guides show the plants you keep on each step's
  map, as landmarks.

## 2026-11-03

- [tweak, whats-new] Faster first load: the farm shows first and the inventory
  loads behind it.
- [fix, whats-new] History days follow the game's daily reset (06:00 UTC).
- [tweak, whats-new] The forecast explainer is clearer about timing.

## 2026-11-02

- [feature, whats-new] **Event banner:** what's in season and for how long.
- [feature, whats-new] The forecast covers the next 60 days, with your island
  as it is (no unlocks or upgrades assumed), and runs in the browser.
- [tweak, whats-new] Planning is about 20% faster.
- [fix, whats-new] Happadil no longer gets planned in Caldera, Icy Peak or
  Spooky Swamp.
- [tweak, whats-new] Collapsing a region on the map is instant.
- [tweak, whats-new] Setup asks for your seeds and plants rather than
  "flowers".
- [fix, whats-new] Updates reach you right away instead of waiting on a stale
  cache.

## 2026-11-01

- [feature, whats-new] **First public release.** Setup screens (your island,
  your collection, a first plan with progress), a getting-started guide, and a
  Farm menu with backups (restore checks the file first and can be undone).
- [fix, whats-new] Patch check marks clear at the game's daily reset (06:00
  UTC).
