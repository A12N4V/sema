# Architecture

The README says what the app is. This says why it is built the way it is, and
what will bite you if you change it.

---

## The shape

A FastAPI process holds live MNE objects in memory. A React app drives them
through one endpoint. Nothing here reimplements signal processing.

```
frontend (React 19 + TS)  ──POST /ops──▶  operation registry
        ▲                                        │
        │                                  ┌─────┴──────┐
   transparent PNG                         ▼            ▼
   + wire JSON                        Session       Ledger
        │                          (Raw · ICA ·   (branching
        └───── figure renderer ◀──  Epochs · TFR      DAG)
                (disk cache)        · Evoked · stc)     │
                                          ▲             ▼
                                          │        pipeline.py
                                       MNE 1.12
```

---

## The five load-bearing decisions

### 1. One operation per MNE call, declared once

Everything mutating is an `Operation` in `backend/app/core/operations/`. One
declaration carries:

| field | what it buys |
|---|---|
| `id`, `label`, `stage` | the command palette entry and where it sits in the ribbon |
| `inputs` / `output` (`ContainerKind`) | the edge in the container graph |
| `params_model` (Pydantic, `extra="forbid"`) | the generated form, and validation |
| `requires` (capability tokens) | the gate: greyed out until you have earned it |
| `template` | the line it contributes to `pipeline.py` |
| `long_running` | whether it dispatches to the job runner instead of blocking |

Adding a capability is adding one of these. Nothing else needs to know about it:
not the frontend, not the router, not the exporter. This is the single reason
the registry could go from 10 operations to 22 without the UI growing a
proportional amount of code.

**There is exactly one mutating endpoint, `POST /ops`.** An earlier version also
had per-operation routes (`/preprocessing/bandpass` and friends) and a second
epochs path; both have been deleted. They were a way to change the signal
without writing a ledger entry, which means a session whose exported script does
not reproduce it. If you add a route that mutates a session, you have introduced
that bug again.

### 2. The ledger is a DAG

`services/ledger.py`. Each entry has a `parent`, and the ledger has a `head`.
Reverting moves the head; re-running from there appends a new entry whose parent
is that older step, so the old branch is still reachable. `leaves()` enumerates
the tips, `on_path()` answers whether an entry is an ancestor of the head, and
`to_python()` walks head-to-root to emit the script.

The consequence worth knowing: **`info_before` / `info_after` are stored on the
entry**, so the pipeline view can show what a step actually changed without
replaying anything.

### 3. Figures are precomputed, and the size is a shared constant

`core/precompute.py` renders the topography for the whole recording on load, on
a 0.1 s-quantised grid, into a disk cache keyed by a hash of
`(container graph, ledger head, raw summary, renderer version, size, theme)`.
`lib/figures.ts` is the client half.

Two things must match exactly or the feature silently evaporates:

- **`FRAME_SIZE`**, which is `400` in both `core/precompute.py` and
  `lib/figures.ts`. The size is part of the cache key, so a mismatch does not
  error: every scrub just misses the cache and re-runs matplotlib, and the only
  symptom is that the app got slow. `test_the_frame_size_matches_the_client`
  reads the TypeScript constant and compares, because there is nowhere else the
  two halves can be checked against each other.
- **the 0.1 s quantisation**, applied on both sides before the request.

`RENDERER_VERSION` is also in the cache key. The state hash tracks the *signal*;
it does not know you changed the drawing code. Bump it when you change how a
figure looks, or users will keep seeing the old one.

### 4. Sessions live in process, so it runs single-worker

`services/session_manager.py` holds a dict of `session_id → Session`, where a
`Session` owns the live `Raw`, `ICA`, `Epochs`, `Evoked`, `AverageTFR` and
`SourceEstimate`. A second uvicorn worker would serve requests from a process
that does not hold the session and 404. **Scale the box, not the worker count.**
The `Procfile` says `--workers 1` for this reason.

Each session carries an `RLock`. Route handlers are plain `def`, not `async
def`, so FastAPI runs them in the threadpool: a two-second filter does not block
the event loop, and the lock serialises operations on one session.

**A read of a live MNE object is not a read.** `raw.get_montage()` runs MNE's
`_check_consistency`, which *writes* `info["ch_names"]` while normalising them.
So **every path that touches `session.raw` takes the lock, including the ones
that only look**. This has bitten twice:

- `services/persistence.py` wrote the autosave bundle on a background thread
  while the next operation mutated the same object, surfacing as `RuntimeError:
  ch_names cannot be set directly` about one run in three, hidden completely by
  a bare `except Exception: pass`.
- `core/precompute.py`'s `filmstrip_manifest`, which the client polls on a
  timer, read `get_montage()` unlocked and 500'd whenever a rename landed
  underneath it.

Both were found by symptoms that look like flakes. **An intermittent failure in
this repo is a race, not a flake.** To audit: for each `app/api/*.py`, compare
how many times it touches `session.raw` against how many `with session.lock:`
blocks it has.

### 5. The cursor is the spine

One time value in the zustand store. The waveform, topography, 3D field,
spectrum, ICA activations and source estimate all read it, and anything that can
move it writes it. This is why the panes agree with each other, and it is the
invariant `store.test.ts` exists to protect.

---

## Backend layout

```
app/
  main.py                 the app, CORS, router mounting
  api/                    thin routers, no logic
    ops.py                POST /ops: the only mutating path
    sessions.py           open, info, recent, delete, upload
    viewer.py             windowed traces, overview, field at cursor
    channels.py           per-channel p-p and sd, decimated
    analysis.py           epochs summary, ERP image, evoked, TFR
    ica.py  source.py  spectral.py  render.py  export.py  jobs.py  datasets.py
  core/
    operations/           the registry, one module per stage
      base.py             Operation, ContainerKind, the registry itself
      preprocessing.py  channels.py  decomposition.py  analysis.py  source.py
    containers.py         the container graph and lineage
    render.py             MNE figure to transparent PNG, disk-cached
    figtheme.py           restyle a matplotlib figure into the app's palette
    precompute.py         the whole-recording figure pass
    extend.py             @sema.operation, the plugin decorator
    loader.py  filters.py  ica_ops.py  topomap.py  source.py  wire.py  demo.py
  services/
    session_manager.py    the Session object and its lifecycle
    ledger.py             the provenance DAG
    persistence.py        session bundles on disk
    jobs.py               the background job runner
  models/schemas.py       Pydantic request/response shapes
sema/                   the pip package: launch(raw), the CLI
```

## Frontend layout

```
src/
  components/
    shell/     Ribbon (verbs) · ContainerStrip (nouns) · TimeBar · Workspace
    panels/    Waveform · ChannelsTable · Annotations · ICA · Panel · OgStrip
    cards/     VisualsCard · EpochsCard · EvokedCard · TFRCard · SourceCard
    ops/       CommandPalette · Wizard
    ui/        Brand · SignalField · primitives
  lib/
    plot/      the canvas substrate: LinePlot, Heatmap, scales, paint, useCanvas
    figures.ts the client half of the figure cache
    ops.ts     the shared mutation helper: call, refresh session + ledger + graph
    router.ts  a history router with no dependency
  store/       zustand slices; the cursor is the spine
  api/client.ts a hand-written typed client
```

`lib/plot/paint.ts` reads the resolved CSS custom properties, so every canvas
repaints from the theme rather than from hard-coded colours. Panels re-read it
off `themeTick`.

---

## Gotchas that cost real time

These are all things that were tried, or that broke.

- **`dockview` has no React build.** The tiling layout is hand-rolled.
- **react-three-fiber dies in a hidden tab.** The 3D scalp field is a
  server-rendered PNG from PyVista, orbited by re-requesting at a new camera
  angle. This also means it works with no WebGL at all.
- **Canvas painting must be synchronous.** `useCanvas` paints on resize and on
  dependency change directly, not in a `requestAnimationFrame` callback: rAF is
  throttled in a background tab and panes came back blank.
- **CSS resets must be layered.** An unlayered `* { padding: 0 }` beats every
  Tailwind `px-*` utility, because the utility layer comes later in cascade
  order. The base reset lives in `@layer base`.
- **MNE's `Spectrum` mismatches on bad channels.** Compute the PSD on a copy
  with bads handled explicitly.
- **`devices["iPhone 13"]` in Playwright defaults to WebKit.** The phone project
  is Desktop Chrome at 390×844 with `hasTouch`, because the thing under test is
  the layout, not the engine.
- **vitest's `include` must cover `.tsx`.** It was `src/**/*.test.ts`, so a new
  component test never ran while the suite reported all green.
- **`max-h-full` does not scale an image up.** It caps at the intrinsic size, so
  a 400px topomap sat in the middle of a 900px pane. `h-full w-full
  object-contain`.
- **Some races here cannot be reproduced in a test, and a racing test that
  passes either way is decoration.** Two threads hammering the filmstrip poll
  and a rename never reproduced the crash above: the window is inside MNE's
  rename, and `TestClient` serialises requests through one portal so it cannot
  interleave them at all. The honest test asserts the invariant instead
  (`session.lock._is_owned()` while the Raw is touched). Always confirm a
  regression test fails without the fix before trusting it.

---

## Testing

```bash
./scripts/check.sh          # backend, typecheck, lint, frontend
./scripts/check.sh fast     # skip the slow source-localisation tests
./scripts/check.sh e2e      # plus Playwright against real servers
```

Three layers, each answering a question the one below it cannot:

- **backend pytest** (101 tests) drives real MNE. `test_e2e_workflow.py` walks
  the full pipeline and guards the registry contract: every operation must
  declare a params model, a template, and container kinds that exist.
- **vitest + Testing Library** (92 tests) mounts every surface in eleven
  situations at two widths, with `failOnConsoleError()`, so a component that
  throws on empty data fails a test rather than blanking a pane in production.
- **Playwright** (18 scenarios × desktop and 390px) answers what jsdom
  structurally cannot: did the canvas paint, did the precompute job finish, does
  a drag on the topography move the cursor, does anything overflow at 390px.

The browser suite reuses running servers, so `./dev.sh` and `check.sh e2e` share
a stack.

---

## Where the seams are

Deliberate boundaries, in case you want to move one.

- **MNE is never imported in `api/`.** Routers call `Session` methods or the
  registry; the MNE calls live in `core/`.
- **The frontend never constructs an MNE call.** It posts an `op_id` and a
  params object. The template that becomes Python lives with the operation.
- **Figures are the server's job.** Anything requiring a montage interpolation, a
  head geometry or a brain surface is rendered by matplotlib or PyVista and sent
  as a transparent PNG. Anything that is a line or a matrix of numbers is drawn
  on the client canvas, because those need to answer to the cursor at 60fps.

That last line is the rule for deciding where a new visualisation goes.
