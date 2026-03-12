# War Room Control — Code Audit Report
_Generated: 2026-03-12 | Updated: 2026-03-13 (post-improvements)_

---

## Status: All TOP-5 improvements implemented ✓

| # | Title | Status |
|---|---|---|
| 1 | Reduce canvas unit rendering from 5 passes to 1 | ✓ Done |
| 2 | Cache `computeSectorDominance` between ticks | ✓ Done |
| 3 | Replace `hasActiveHotspots()` scan with counter | ✓ Done |
| 4 | Break `wsClient` → `renderLoop` circular dependency via `pulsesStore` | ✓ Done |
| 5 | Runtime WebSocket message validation | ✓ Done |

**Additional improvements (post-audit):**
- Font string constants (`FONT_TINY/SMALL/NORMAL/LABEL`) — eliminates 7+ repeated string assignments per frame
- Per-frame `RadialGradient` allocations eliminated — replaced with 7 pre-computed 16-bucket rgba LUTs
- `resetRenderState()` export — clears viewport, hotspotGrid, activePulses, terrainCanvas, cachedSectorDominance on remount
- `eventsStore.clear()` on snapshot receipt — event feed resets on reconnect and restart
- CORS headers fixed — `POST /api/restart` now works cross-origin (Content-Type header + POST in Allow-Methods)
- Combat proximity targeting (`pickNearest`, O(12)) — pulses/hotspots appear at actual front lines
- Hotspot visual tuning — balanced Medium style (decay ×4, radius ×0.625, opacity reduced, CONTACT threshold 0.7)

---

## Section 1: Architecture Findings

**[SEVERITY: high] ~~Circular dependency between `wsClient` and `renderLoop`~~** — FIXED
- Resolved via `pulsesStore` intermediary. `wsClient` enqueues; `renderLoop` subscribes and drains each frame.

**[SEVERITY: high] Module-level mutable globals in `renderLoop.ts`** — PARTIALLY FIXED
- `resetRenderState()` export added; called automatically at top of `startRenderLoop()`.
- Remaining: full class encapsulation not done. The reset path covers the practical risk.

**[SEVERITY: medium] Base spawn coordinates duplicated between server and client**
- `ALPHA_SPAWN_CENTRES`/`BRAVO_SPAWN_CENTRES` in `server/src/simulation/units.ts` mirrored as `MAP_BASES` in `client/src/map/renderLoop.ts`. Comment is the only contract enforcement.

**[SEVERITY: medium] `selectionStore` uses inconsistent implementation pattern**
- All other stores use private-member classes. `selectionStore` uses module-level `let` + plain object literal.

**[SEVERITY: medium] `SnapshotMessage` double-envelope in wire format**
- `SnapshotMessage` has `type: 'snapshot'`; `ServerMessage` wraps it again with `type: 'snapshot'`. Discriminant appears twice on the wire. Low practical impact.

**[SEVERITY: low] `ConnectionStatus` type defined in transport layer, imported by UI** — acceptable
**[SEVERITY: low] `ri()` utility duplicated in two server files** — still present; trivial

---

## Section 2: Code Quality Findings

**[SEVERITY: high] ~~Unsafe type cast on WebSocket message parse~~** — FIXED
- try/catch + `typeof parsed === 'object'` + `'type' in parsed` guard replaces raw cast.

**[SEVERITY: high] ~~`drawHotspots` creates a new `RadialGradient` per active hotspot per frame~~** — FIXED
- 7 pre-computed 16-bucket rgba string arrays built at module load. Zero per-frame string allocations from hotspot rendering.

**[SEVERITY: medium] ~~`computeSectorDominance` called inside render loop on every dirty frame~~** — FIXED
- `cachedSectorDominance` invalidated by `invalidateSectorCache()` on unit store update (1Hz). O(1) per frame during pan/zoom.

**[SEVERITY: medium] ~~`cellPx` recomputed via two `toScreen` calls per hotspot per frame~~** — FIXED
- Hoisted above the hotspot loop.

**[SEVERITY: medium] `applyFilters` scans 20,000 units on every tick in `UnitsPanel`**
- Still present. Acceptable at 1Hz. `useMemo` keyed on store version + filter state would fix it.

**[SEVERITY: medium] Canvas context state not protected per-base in `drawBases`**
- `ctx.save()`/`ctx.restore()` wraps the entire base loop, not each base individually.

**[SEVERITY: medium] `usePerformanceMetrics` RAF loop is never stopped**
- Main render loop cleanup now handled. Observability RAF still has no stop API.

**[SEVERITY: low] Hardcoded "20,000 units" in two components** — still present
**[SEVERITY: low] ~~Font strings assembled repeatedly~~** — FIXED (module-level constants)

---

## Section 3: Runtime Performance Findings

**[SEVERITY: critical] ~~Five complete iterations over 20,000 units per frame~~** — FIXED
- Single classification pass into 5 `number[]` arrays, then 5 batch `fillRect` passes.
- 5 `fillStyle` changes per frame, constant regardless of unit count.

**[SEVERITY: critical] ~~`computeSectorDominance` in render loop at RAF rate~~** — FIXED

**[SEVERITY: high] ~~Per-frame `RadialGradient` + string allocations in `drawHotspots`~~** — FIXED
- ~3,000 allocations/sec eliminated. All colour lookups are array index operations.

**[SEVERITY: high] `applyFilters` scans 20,000 units at 1Hz on main thread**
- ~0.5–3ms/tick. Acceptable; not on the render hot path.

**[SEVERITY: high] ~~`hasActiveHotspots()` scans 400-cell array on every RAF frame~~** — FIXED
- `activeHotspotCount` counter. O(1) check per frame.

**[SEVERITY: medium] ~~`cellPx` — two redundant `toScreen` calls per frame~~** — FIXED
**[SEVERITY: medium] `sampleIds` copies 20,000-element array every server tick** — still present (~160KB/sec)
**[SEVERITY: medium] Snapshot `JSON.stringify` of 20,000 units blocks Node.js main thread** — still present (~5–15ms per client connect)
**[SEVERITY: low] `PerformanceObserver` leaked** — still present

---

## Score Progression

| Dimension | Original | After TOP-5 | After all improvements |
|---|---|---|---|
| Architecture | 18/30 | 23/30 | 26/30 |
| Code Quality | 19/35 | 25/35 | 29/35 |
| Performance | 19/35 | 28/35 | 32/35 |
| **Total** | **56/100** | **76/100** | **87/100** |

---

## Remaining open items (for 90+)

1. **`applyFilters` memoization** — `useMemo` in `UnitsPanel` keyed on store version + filter state
2. **`usePerformanceMetrics` stop API** — cancel inner RAF chain + disconnect `PerformanceObserver`
3. **`selectionStore` class refactor** — align pattern with other stores
4. **`shared/constants.ts`** — move base coordinates out of both `renderLoop.ts` and `units.ts`
5. **`sampleIds` allocation** — reusable scratch buffer to avoid `ids.slice()` per tick
