# Visual check harness

Every frontend change here has to be *seen* working, not just read. Electron
segfaults in the agent sandbox, so instead of launching the desktop app these
scripts serve the built bundle and drive it in headless Chromium over the
Chrome DevTools Protocol.

This directory is the one copy. Before HOM-341 it lived in whichever task's
`~/.cache/HOM-###/` happened to create it, and each task copied the previous
fork — including its bugs.

| File | What it is |
| --- | --- |
| `cdp.mjs` | the DevTools driver: `eval`, `goto`, `click`, `key`, `shot`, `scrollBox`, `box` |
| `launch.mjs` | starts headless Chromium with a throwaway profile and waits for CDP |
| `ports.mjs` | engine/http/cdp ports derived from `$PAPERCLIP_RUN_ID`, plus a free-port assert |
| `bundle.mjs` | proves the origin you are about to drive serves the build you just made |
| `harness.mjs` | `start()`, `clickText`, `openProject`, `toJob`, `audit`, `reportAudit` |
| `audit.mjs` | measures the rendered DOM into a snapshot |
| `audit-core.mjs` | the layout rules, as pure functions over that snapshot |
| `selfcheck.mjs` | drives `fixtures/overflow-row.html` and asserts the audit still catches the bug |
| `text-floor-audit.mjs` | opens Crystallize (every tab) and HSQC and fails on any rendered text under 12px |
| `seed-fixture-project.py` | builds a database with a fixture project the checks can open |

## Running a check

```bash
cd protein-labs-web
eval "$(node scripts/visual/ports.mjs)"      # ENGINE_PORT / HTTP_PORT / CDP_PORT

# 1. Build. The API origin is baked in at bundle time *and* written into the
#    page CSP's connect-src, so an engine on another port is unreachable
#    without this.
NEXT_PUBLIC_PROTEIN_LABS_API="http://127.0.0.1:$ENGINE_PORT" npm run build

# 2. Engine. Use the backend's own venv: system python3 has no Bio and the
#    server dies on import.
( cd ../protein-labs/backend && .venv/bin/python -m protein_labs.server \
    --port "$ENGINE_PORT" --database ~/.cache/visual/db.sqlite3 & )

# 3. Static server, with an explicit -d so it cannot serve someone else's tree.
python3 -m http.server "$HTTP_PORT" -b 127.0.0.1 -d desktop-dist &

# 4. Chromium.
chromium --headless=new --remote-debugging-port="$CDP_PORT" \
         --user-data-dir="$(mktemp -d)" about:blank &

node your-scenario.mjs
```

A scenario is a few lines:

```js
import { start, toJob, clickText, reportAudit, SHOTS, sleep } from "./scripts/visual/harness.mjs";

const page = await start({ width: 1440, height: 1000, theme: "paper" });
await toJob(page, "Crystallize your protein", "Membrane transporter (fixture)");
await clickText(page, "Space groups", ".crystallize-tabs [role=tab]");
await sleep(1200);
await reportAudit(page, ".crystallize-workspace");
await page.shot(`${SHOTS}/space-groups.png`);
```

Shots land in `.visual-shots/` (git-ignored); override with `$VISUAL_SHOTS`.
Check both 1440x1000 and the 900x650 minimum window.

## Two traps this harness now closes

**Driving someone else's bundle.** Paperclip runs agents against this machine
in parallel. The old harness hard-coded 8951/8952/945x, so on [HOM-332] a
concurrent run already held them: the engine and static server silently failed
to bind, every health check answered 200 from the *other* run's services, and
the wrong bundle got driven for several minutes. `ports.mjs` derives ports from
`$PAPERCLIP_RUN_ID`, and `start()` refuses to run until `assertServedBundle`
has compared the served `index.html` and every entry asset against the bytes in
`desktop-dist/`. Pass `marker: "some string only my change contains"` (or
`$VISUAL_BUNDLE_MARKER`) to also prove the build includes your change — the
marker is looked for in every emitted chunk, not just the entry ones, so a
change that lands only in a lazily imported chunk still counts.

If a port is taken anyway, pick another — **never `pkill` by port pattern**,
that kills the other agent's run.

**An audit that looked clean.** See below.

## What `audit()` reports

`audit(page, rootSel)` measures every visible element under `rootSel` and
returns findings:

| Finding | Meaning |
| --- | --- |
| `page scrollX …` | the page itself scrolls sideways |
| `offscreen … past the viewport` | an element reaches past the window's right edge |
| `overflow … past X` | an element reaches past its nearest clipping ancestor |
| `hscroll …` | a box has a horizontal scrollbar it probably did not want |
| `clip … +Npx` | a box cuts its own content off (`overflow-x: hidden`, no ellipsis) |
| `wide … +Npx` | content is wider than its box and spills into whatever is beside it |
| `small …` | text below the 12px floor (`lib/text-floor.test.ts`) |

They come back in that order, so on a busy screen the structural problems
survive the 25-finding limit.

`overflow` compares against the nearest ancestor that actually clips, not the
window, so a badge hanging 12px out of a 234px column is reported even at
1440px wide.

`hscroll` exists because `overflow-y: auto` on its own computes `overflow-x` to
`auto` as well: a list meant to scroll vertically quietly grows a sideways
scrollbar the moment one row is too wide. It is reported for a human to judge,
not as a certain bug. Containers that are *meant* to scroll sideways opt out
with `class="table-scroll"` or a `data-h-scroll` attribute.

`wide` is the soft one: with `overflow-x: visible` nothing is cut off, the
content simply sits on top of its neighbour — which is how the dashboard's
COMPLETE badge ends up over the job title. Read it with the screenshot.

One overflow is reported once. A `visible` box's `scrollWidth` includes its
descendants' overflow, so a single long label makes every wrapper up to the
clipping box look equally guilty; only the innermost gets a line. `clip` yields
only to a nested `clip`, so the box where content actually disappears is still
named.

Not measured at all: `svg`, `canvas`, `.molecular-webgl`, `.sr-only`, anything
inside an `inert` subtree (the hidden face of a flip card, content behind a
modal) or inside an `opacity: 0` one (a panel mid-fade — opacity does not
inherit, so its children each report `1` while being just as invisible), and
boxes under 2px in either dimension (hairlines, and the 1x1 visually-hidden
idiom, whose nowrap text always "overflows").

### The bug this replaced

Until HOM-341 both the small-text *and* the clipping check were gated on
whether an element had a direct text-node child:

```js
const own = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
if (own && el.scrollWidth > el.clientWidth + 1 && …)   // ← wrong
```

Most chip, badge and label rows in this app put all their text in child
`<span>`s, so `own` was false and their overflow was never measured. On
[HOM-332] a two-badge row overflowed its column by 3px, the second badge sat
12px past the list's right edge, the list grew a horizontal scrollbar — and
`audit()` reported a clean line at both 1440x1000 and 900x650. A reviewer found
it by eye in a 2x crop.

Overflow is a box property and needs no text node, so the clipping check lost
the gate. The small-text check keeps it: a wrapper's computed `font-size` says
nothing about text it does not itself hold, and without the gate one small
label would be reported against every ancestor.

Run the regression check after touching either file:

```bash
node scripts/visual/selfcheck.mjs --shot
```

It drives `fixtures/overflow-row.html` — a standalone reproduction of that
geometry — in real Chromium, asserts the three findings appear, asserts the
controls (an intentional ellipsis, an intentional horizontal scroller, a
visually-hidden label, an inert flip face, rows that fit) stay quiet, and
re-runs the pre-HOM-341 rules over the same snapshot to show they still see
nothing. `audit-core.test.mts` covers the rules themselves
(`npx vitest run scripts/visual`).

## Other things worth knowing

- **Don't `scrollIntoView`.** It scrolls the page as well as the container and
  invalidates any clip rect captured beforehand, so the close-up crop frames
  the wrong region. Use `page.scrollBox(".sg-list", { target: "…" })`.
- **A clean audit is not proof.** It measures boxes, not whether the screen
  reads well. Take the screenshot and look at it; for a dense component take a
  2x crop (`start({ scale: 2 })` plus `page.box(sel)`).
- The citation superscripts (`.cite-marker`) are a fixed 12px since HOM-401;
  they used to be `.72em` and rendered at 8.6–10px. `lib/text-floor.test.ts`
  now treats em, % and the smaller/small keywords as under the floor unless
  wrapped in `max(12px, …)`, and `text-floor-audit.mjs` checks the rendered
  pages. Run it after touching citations or the Crystallize/HSQC screens.
- `start()` injects a stub for `window.proteinLabDesktop`, which the Electron
  preload normally provides. Pass `desktopBridge: false` to check the browser's
  own fallback path.

[HOM-332]: https://github.com/hammonsnick1/protein-lab/pull/88
