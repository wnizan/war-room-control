# War Room Control — Code Audit Report
_Generated: 2026-03-12_

---

## Section 1: Architecture Findings

**[SEVERITY: high] Circular dependency between `wsClient` and `renderLoop`**
- **What:** `wsClient.ts` imports `addPulse` directly from `renderLoop.ts` (line 6). The data-sync layer has a hard dependency on the canvas rendering layer.
- **Where:** `client/src/sync/wsClient.ts:6` → `client/src/map/renderLoop.ts`
- **Why it matters:** Replacing the renderer (WebGL, worker) requires modifying the sync layer. Testing `wsClient` in isolation requires loading the full render module.

**[SEVERITY: high] Module-level mutable globals in `renderLoop.ts` form a hidden shared-state surface**
- **What:** Nine module-level mutable variables: `unitScale`, `viewport`, `_dirty`, `terrainCanvas`, `terrainW`, `terrainH`, `hotspotGrid`, `activePulses`, exported mutation functions. Mutated from `TacticalMap.tsx` and `wsClient.ts` with no ownership boundary.
- **Where:** `client/src/map/renderLoop.ts` lines 8–11, 24, 62–67, 94–95
- **Why it matters:** On render loop remount, globals retain stale state. No reset path for `hotspotGrid` or `activePulses`.

**[SEVERITY: medium] Base spawn coordinates duplicated between server and client**
- **What:** `ALPHA_SPAWN_CENTRES`/`BRAVO_SPAWN_CENTRES` in `server/src/simulation/units.ts` (lines 11–21) are duplicated as `MAP_BASES` in `client/src/map/renderLoop.ts` (lines 230–237). A comment is the only contract enforcement.
- **Where:** Both files above
- **Why it matters:** Correctness risk — updating one without the other misaligns visual markers from actual spawn zones. Should be in `shared/constants.ts`.

**[SEVERITY: medium] `selectionStore` uses inconsistent implementation pattern**
- **What:** All other stores are classes with private members. `selectionStore` uses module-level `let` variables and a plain object literal.
- **Where:** `client/src/store/selectionStore.ts` lines 8–30

**[SEVERITY: medium] `SnapshotMessage` double-envelope in wire format**
- **What:** `SnapshotMessage` has its own `type: 'snapshot'` field, then `ServerMessage` wraps it again with `type: 'snapshot'`. The discriminant appears twice on the wire.
- **Where:** `shared/types.ts` lines 72–82; `server/src/transport/websocket.ts` lines 19–26

**[SEVERITY: low] `ConnectionStatus` type defined in transport layer, imported by UI**
- **Where:** `client/src/sync/wsClient.ts:19` → `client/src/App.tsx:4`

**[SEVERITY: low] `ri()` utility duplicated in two server files**
- **Where:** `server/src/simulation/units.ts` and `server/src/simulation/tick.ts`

---

## Section 2: Code Quality Findings

**[SEVERITY: high] Unsafe type cast on WebSocket message parse**
- **What:** `JSON.parse(data) as ServerMessage` with no runtime validation. A malformed message silently fails or throws an uncaught exception crashing the WS handler.
- **Where:** `client/src/sync/wsClient.ts:52`

**[SEVERITY: high] `drawHotspots` creates a new `RadialGradient` per active hotspot per frame**
- **What:** `ctx.createRadialGradient(...)` called inside the hotspot loop every frame. Plus 8–10 `toFixed(2)` string allocations per hotspot per frame.
- **Where:** `client/src/map/renderLoop.ts:408`

**[SEVERITY: medium] `computeSectorDominance` called inside render loop on every dirty frame**
- **What:** Full 20,000-unit scan on every dirty frame to produce 4 integers that change at most 1Hz.
- **Where:** `client/src/map/renderLoop.ts` lines 151–168, 590

**[SEVERITY: medium] `cellPx` recomputed via two `toScreen` calls per hotspot per frame**
- **What:** `toScreen(0,0,W,H)` and `toScreen(1/HOTSPOT_COLS,0,W,H)` called inside hotspot loop — constant value for the entire frame.
- **Where:** `client/src/map/renderLoop.ts` lines 393–396

**[SEVERITY: medium] `applyFilters` scans 20,000 units on every tick in `UnitsPanel`**
- **Where:** `client/src/panels/UnitsPanel.tsx` lines 88–96

**[SEVERITY: medium] Canvas context state (`globalAlpha`, `textAlign`, `textBaseline`) not protected per-base in `drawBases`**
- **What:** An exception mid-loop leaves canvas context in an unknown state for subsequent draw calls.
- **Where:** `client/src/map/renderLoop.ts` lines 243–357

**[SEVERITY: medium] `usePerformanceMetrics` RAF loop is never stopped**
- **What:** `startRafLoop()` starts an infinite RAF chain with no stop API. `PerformanceObserver` reference is also lost (never disconnected).
- **Where:** `client/src/observability/usePerformanceMetrics.ts` lines 82–132, 136–161

**[SEVERITY: low] Hardcoded "20,000 units" in two components — breaks with `UNIT_COUNT` env var**
- **Where:** `client/src/panels/KpiStrip.tsx:34`; `client/src/map/TacticalMap.tsx:80`

**[SEVERITY: low] Font strings assembled repeatedly rather than extracted to constants**
- **What:** `'Inter, system-ui, sans-serif'` assembled differently in 7+ places. Browser re-parses font string each assignment.
- **Where:** `client/src/map/renderLoop.ts` — multiple lines

---

## Section 3: Runtime Performance Findings

**[SEVERITY: critical] Five complete iterations over 20,000 units per frame**
- **What:** `draw()` makes 5 separate `for (const u of units.values())` passes — one per fill-style category.
- **Where:** `client/src/map/renderLoop.ts` lines 603–639
- **Hypothesis:** ~100,000 Map iteration steps + ~20,000 `toScreen` calls per dirty frame. Estimated 2–8ms per frame on mid-range hardware.

**[SEVERITY: critical] `computeSectorDominance` in render loop — 20,000-unit scan at RAF rate**
- **Hypothesis:** 0.5–2ms per tick wasted. Result changes at most 1Hz, never within a single frame.

**[SEVERITY: high] Per-frame `RadialGradient` + string allocations in `drawHotspots`**
- **Hypothesis:** 50 active cells × 60fps = 3,000 short-lived objects/sec. GC pressure causes periodic frame drops. Plus ~300–500 string allocations/sec from `toFixed`.

**[SEVERITY: high] `applyFilters` scans 20,000 units at 1Hz on main thread**
- **Hypothesis:** 20,000 iterations/sec. With name filter active, includes string comparisons. ~0.5–3ms per tick.

**[SEVERITY: high] `hasActiveHotspots()` scans 400-cell array on every RAF frame**
- **Hypothesis:** 400 × 60fps = 24,000 array reads/sec just to check "should we draw?"

**[SEVERITY: medium] `cellPx` — two redundant `toScreen` calls × 400 hotspot cells per frame**

**[SEVERITY: medium] `sampleIds` copies 20,000-element array every server tick**
- **Hypothesis:** ~160KB short-lived allocation every second on server heap.

**[SEVERITY: medium] Snapshot `JSON.stringify` of 20,000 units blocks Node.js main thread**
- **Hypothesis:** 3–5MB JSON, ~5–15ms serialize time per client reconnect.

**[SEVERITY: low] `PerformanceObserver` leaked — never disconnected; `longTaskCount` grows forever**

---

## TOP-5 Improvements (ROI Order)

### #1 — Reduce canvas unit rendering from 5 passes to 1 pass
- **Problem:** Five full-map iterations per frame for a single rendering concern.
- **Files:** `client/src/map/renderLoop.ts` lines 598–639
- **Effort:** S
- **Impact:** ~60–80% reduction in unit-draw iteration cost. Estimated 2–6ms frame time improvement. Biggest single win.
- **How to fix:**
  1. Define `resolveColor(u: Unit): string` and `resolveSize(u: Unit): number` helpers.
  2. Single pass: set `ctx.fillStyle = resolveColor(u)` per unit, call `ctx.fillRect(...)`.
  3. Optional: pre-group into 4 typed arrays per tick update for batch fill (fastest GPU path).
- **Risk:** Units render in Map iteration order, not by team. Visually irrelevant at 3px dot size.

### #2 — Cache `computeSectorDominance` between ticks
- **Problem:** 20,000-unit scan inside `draw()` for 4 integers that change at most 1Hz.
- **Files:** `client/src/map/renderLoop.ts` lines 151–168, 590
- **Effort:** S
- **Impact:** Removes one 20,000-unit scan from per-frame hot path. Eliminates up to 60 redundant scans/sec during panning/zooming.
- **How to fix:**
  1. Add `let cachedSectorDominance: SectorDominance | null = null`.
  2. Export `invalidateSectorCache()` that sets it to `null`.
  3. Call `invalidateSectorCache()` from the `unitsStore` subscriber inside `startRenderLoop`.
  4. In `draw()`: `const dominance = cachedSectorDominance ?? computeSectorDominance(units); cachedSectorDominance = dominance;`
- **Risk:** None. Invalidated on every unit update — same timing as current computation.

### #3 — Replace `hasActiveHotspots()` linear scan with an active-cell counter
- **Problem:** 400-element array scanned at 60fps just to determine whether to redraw.
- **Files:** `client/src/map/renderLoop.ts` lines 363–374, 564–570, 660
- **Effort:** S
- **Impact:** O(400) → O(1) per frame check. Eliminates 24,000 array reads/sec. Natural place to also hoist `cellPx` above the hotspot loop.
- **How to fix:**
  1. Add `let activeHotspotCount = 0`.
  2. `addHotspot`: `if (hotspotGrid[idx] === 0) activeHotspotCount++; hotspotGrid[idx] = Math.min(1, ...)`
  3. `drawHotspots` decay: `if (newVal <= 0 && oldVal > 0) activeHotspotCount--`
  4. `hasActiveHotspots()`: `return activeHotspotCount > 0`
  5. Hoist `cellPx` above loop at same time.
- **Risk:** Off-by-one on floating-point decay boundary — guard with `if (newVal <= 0 && oldVal > 0)`.

### #4 — Break `wsClient` → `renderLoop` circular dependency via `pulsesStore`
- **Problem:** Sync layer imports canvas render module — impossible to evolve independently.
- **Files:** `client/src/sync/wsClient.ts:6`, lines 78–98; `client/src/map/renderLoop.ts` lines 369–374
- **Effort:** M
- **Impact:** Clean layering. `wsClient` testable in isolation. Render layer replaceable without touching sync code.
- **How to fix:**
  1. Create `client/src/store/pulsesStore.ts` — external store with `enqueue({ id, x, y, type })` and `drain(): Pulse[]`.
  2. In `wsClient.ts`: replace `addPulse(...)` with `pulsesStore.enqueue(...)`. Remove renderLoop import.
  3. In `startRenderLoop`: subscribe to `pulsesStore`; on update, drain and call local `addPulse`.
  4. Make `addPulse` private (remove export).
- **Risk:** Pulses applied one RAF frame later (~16ms delay). Imperceptible in practice.

### #5 — Add runtime validation of WebSocket messages at ingress
- **Problem:** `JSON.parse(data) as ServerMessage` — unsafe cast. Malformed messages silently corrupt stores or crash the handler.
- **Files:** `client/src/sync/wsClient.ts` lines 51–104
- **Effort:** S–M (Zod already used server-side)
- **Impact:** Malformed messages are caught, logged, and discarded. Contract bugs surface immediately during development.
- **How to fix:**
  1. Add `ServerMessageSchema` to `shared/` using Zod.
  2. Replace cast with `ServerMessageSchema.safeParse(JSON.parse(data))`.
  3. In production: validate only `type` discriminant (not full 20k-unit snapshot).
  4. In development (`import.meta.env.DEV`): validate fully.
- **Risk:** Full snapshot validation is expensive (~3MB parse). Must be dev-only or partial.

---

## Verdict

The overall architecture is sound. External-store pattern with `useSyncExternalStore` is correctly applied. Delta-only WebSocket protocol is clean. `shared/types.ts` respected as single source of truth. `OffscreenCanvas` terrain caching and `FixedSizeList` virtualization are good instincts.

**Highest-priority fixes:** #1 + #2 + #3 together reduce per-frame CPU work by an estimated 60–80% and are all small-effort changes. They represent the clearest path to consistently exceeding the 50 FPS validation gate under load.
