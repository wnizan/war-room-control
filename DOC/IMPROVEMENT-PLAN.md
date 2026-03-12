# War Room Control — Improvement Plan
_Generated 2026-03-12_

---

## Current State Summary

All 6 implementation phases are complete. The system works correctly:
- WebSocket delta sync, 20k units, <20KB/tick
- Canvas render loop with 4-pass batch draw
- Zones A/B/C/D with dominance fill
- Pulse animations (attack/destroy/heal)
- KPI strip, virtualized units panel, event feed, perf panel

**What is missing:** The tactical map is a cloud of colored dots with no spatial context.
The layout already matches the requested structure. The work is mostly in the renderer.

---

## Scope of Changes

### Files that change
| File | Change |
|---|---|
| `server/src/index.ts` | Read `UNIT_COUNT` from env/query param |
| `shared/types.ts` | Add `ZoneId` export, `Base` interface, `Hotspot` interface |
| `client/src/map/renderLoop.ts` | Full renderer rewrite with layered pipeline |
| `client/src/map/TacticalMap.tsx` | Wire selection, add legend below map |
| `client/src/panels/UnitsPanel.tsx` | Selection callback, selected unit highlight |
| `client/src/store/selectionStore.ts` | New: tiny store for selected unit ID |
| `client/src/design/global.css` | Legend styles, KPI zone control display |
| `client/src/panels/KpiStrip.tsx` | Add Zone Control display |

### Files that do NOT change
- `shared/types.ts` Unit/Delta/Tick interfaces — no structural change
- All stores except new `selectionStore.ts`
- `wsClient.ts` — no transport changes
- `PerfPanel.tsx` / `EventFeed.tsx` — no changes
- All server simulation logic except unit count config

---

## Part 1: Configurable Unit Count

### 1.1 Server (`server/src/index.ts`)

Replace hardcoded `UNIT_COUNT = 20_000` with:

```typescript
const UNIT_COUNT = (() => {
  const env = process.env['UNIT_COUNT'];
  if (env) {
    const n = parseInt(env, 10);
    if (n > 0 && n <= 100_000) return n;
  }
  return 20_000;
})();
```

Also expose the count in the `/health` endpoint so the client can display it:
```json
{ "status": "ok", "unitCount": 20000 }
```

### 1.2 Client — URL param support

In `client/src/main.tsx`, read `?units=N` and store in sessionStorage or pass as prop.
The client doesn't need to know the count to render — it's purely cosmetic (update
the "20,000 units" label in `TacticalMap.tsx` header to be dynamic).

---

## Part 2: Selection Store

New file: `client/src/store/selectionStore.ts`

```typescript
// External store (same pattern as other stores)
// Holds the ID of the currently selected unit, or null

type Listener = () => void;
let selectedId: string | null = null;
const listeners = new Set<Listener>();

function notify() { listeners.forEach(l => l()); }

export const selectionStore = {
  select(id: string | null): void {
    if (selectedId === id) return;
    selectedId = id;
    notify();
  },
  getSnapshot(): string | null { return selectedId; },
  subscribe(cb: Listener): () => void {
    listeners.add(cb);
    return () => listeners.delete(cb);
  },
};
```

---

## Part 3: Renderer Rewrite (`renderLoop.ts`)

This is the main work. The new renderer has 7 ordered layers:

```
Layer 0: Terrain (offscreen canvas, drawn once, repainted on resize)
Layer 1: Sector grid + labels (drawn each frame, cheap)
Layer 2: Base locations (drawn each frame, 6 fixed points)
Layer 3: Combat hotspots (drawn each frame, fading circles)
Layer 4: Units (4-pass batch, existing approach retained)
Layer 5: Event pulses (existing, retained)
Layer 6: Selected unit highlight (new, drawn last)
```

### 3.1 Terrain Layer (offscreen canvas)

Generate once at startup and on canvas resize.

**Strategy:** Divide canvas into a grid of ~40×30 cells. Each cell gets a
procedurally assigned terrain type. Use a simple seeded noise (no library needed —
a 2-level hash of `(col * 17 + row * 31) % N` is sufficient for visual variety).

Terrain types and their dark-theme colors:
```
plains:    rgba(20, 28, 18, 1)     — very dark green-gray
hills:     rgba(22, 20, 15, 1)     — dark brown-gray
mountains: rgba(18, 18, 22, 1)     — dark blue-gray
water:     rgba(12, 20, 28, 1)     — dark navy
```

These are subtle — barely distinguishable from the background. Their purpose is to
add texture, not to distract from units.

**Implementation:**
```typescript
let terrainCanvas: OffscreenCanvas | null = null;
let terrainW = 0;
let terrainH = 0;

function buildTerrainCanvas(W: number, H: number): OffscreenCanvas {
  const oc = new OffscreenCanvas(W, H);
  const ctx = oc.getContext('2d')!;
  const COLS = 40;
  const ROWS = 30;
  const cw = W / COLS;
  const ch = H / ROWS;

  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const hash = (col * 17 + row * 31 + col * row * 7) % 16;
      let color: string;
      if (hash < 7)       color = '#141c12';  // plains
      else if (hash < 11) color = '#16140f';  // hills
      else if (hash < 14) color = '#121216';  // mountains
      else                color = '#0c141c';  // water
      ctx.fillStyle = color;
      ctx.fillRect(col * cw, row * ch, cw + 1, ch + 1); // +1 avoids gaps
    }
  }
  return oc;
}

// In draw(), invalidate when dimensions change:
if (!terrainCanvas || terrainW !== W || terrainH !== H) {
  terrainCanvas = buildTerrainCanvas(W, H);
  terrainW = W; terrainH = H;
}
ctx.drawImage(terrainCanvas, 0, 0);
```

**Performance:** `drawImage` of an OffscreenCanvas is GPU-accelerated and ~0.1ms.
The terrain is only rebuilt on resize.

### 3.2 Sector Grid (4 named sectors)

Rename zones A/B/C/D → A1/A2/B1/B2 to match the spec. Keep the same bounds.

Current zone borders are nearly invisible. Make them slightly more visible:
```typescript
const SECTOR_BORDER = 'rgba(255,255,255,0.12)';  // was 0.08
const SECTOR_LABEL  = 'rgba(255,255,255,0.35)';  // was 0.25
```

Draw control state as a small badge in the zone corner:
```
"A1  [ALPHA]"   — in alpha blue, subdued
"B2  [CONTESTED]" — in amber
```

Sector labels at font-size 12px, upper-left corner, inset 8px.
Control state badge next to label, smaller (10px), colored by team.

### 3.3 Base Locations

Six fixed strategic locations (3 per team), placed at meaningful positions:

```typescript
interface MapBase {
  id: string;
  label: string;
  team: 'alpha' | 'bravo' | 'neutral';
  x: number;   // normalized 0-1
  y: number;
  radius: number;  // influence ring radius, pixels (will scale with canvas)
}

const MAP_BASES: MapBase[] = [
  { id: 'alpha-main',    label: 'Alpha HQ',    team: 'alpha',   x: 0.12, y: 0.15, radius: 30 },
  { id: 'alpha-fwd',     label: 'Alpha Fwd',   team: 'alpha',   x: 0.35, y: 0.45, radius: 20 },
  { id: 'alpha-supply',  label: 'Supply A',    team: 'alpha',   x: 0.08, y: 0.70, radius: 18 },
  { id: 'bravo-main',    label: 'Bravo HQ',    team: 'bravo',   x: 0.88, y: 0.85, radius: 30 },
  { id: 'bravo-fwd',     label: 'Bravo Fwd',   team: 'bravo',   x: 0.65, y: 0.55, radius: 20 },
  { id: 'bravo-supply',  label: 'Supply B',    team: 'bravo',   x: 0.92, y: 0.30, radius: 18 },
];
```

Draw each base as:
1. Influence ring (dashed circle, team color at 20% opacity)
2. Center marker: small filled diamond (4 canvas lines, ±4px)
3. Label text 10px above marker, team color, font-size 10px

```typescript
function drawBases(ctx: CanvasRenderingContext2D, W: number, H: number): void {
  ctx.save();
  ctx.font = '10px Inter, system-ui, sans-serif';
  ctx.textAlign = 'center';

  for (const base of MAP_BASES) {
    const px = base.x * W;
    const py = base.y * H;
    const color = base.team === 'alpha' ? COLOR_ALPHA : COLOR_BRAVO;

    // Influence ring
    ctx.beginPath();
    ctx.arc(px, py, base.radius, 0, Math.PI * 2);
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.2;
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;

    // Diamond marker
    ctx.beginPath();
    ctx.moveTo(px,     py - 5);
    ctx.lineTo(px + 4, py);
    ctx.lineTo(px,     py + 5);
    ctx.lineTo(px - 4, py);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.9;
    ctx.fill();
    ctx.globalAlpha = 1;

    // Label
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.8;
    ctx.fillText(base.label, px, py - 8);
    ctx.globalAlpha = 1;
  }

  ctx.textAlign = 'start';
  ctx.restore();
}
```

### 3.4 Combat Hotspots

A hotspot is a spatial cluster of recent combat events. It decays over time.

**Data structure:**
```typescript
interface Hotspot {
  x: number;
  y: number;
  intensity: number;   // 0–1, decays per frame
  lastUpdate: number;  // performance.now()
}

// Grid-based (faster than per-event): divide map into 20x20 cells
// Each cell has an intensity value that increments on events and decays each frame

const HOTSPOT_COLS = 20;
const HOTSPOT_ROWS = 20;
const hotspotGrid = new Float32Array(HOTSPOT_COLS * HOTSPOT_ROWS); // all zeros
const HOTSPOT_DECAY = 0.002;  // per frame at 60fps ≈ 0.12/sec
const HOTSPOT_HIT   = 0.15;   // per combat event
```

**On each combat event** (called from `addPulse` or a new `addHotspot` function):
```typescript
export function addHotspot(x: number, y: number): void {
  const col = Math.min(HOTSPOT_COLS - 1, (x * HOTSPOT_COLS) | 0);
  const row = Math.min(HOTSPOT_ROWS - 1, (y * HOTSPOT_ROWS) | 0);
  const idx = row * HOTSPOT_COLS + col;
  hotspotGrid[idx] = Math.min(1, (hotspotGrid[idx] ?? 0) + HOTSPOT_HIT);
}
```

**Draw function** (called each frame before units):
```typescript
function drawHotspots(ctx: CanvasRenderingContext2D, W: number, H: number): void {
  const cw = W / HOTSPOT_COLS;
  const ch = H / HOTSPOT_ROWS;

  ctx.save();
  for (let i = 0; i < hotspotGrid.length; i++) {
    const v = hotspotGrid[i];
    if (v === undefined || v < 0.05) continue;  // skip inactive cells

    const col = i % HOTSPOT_COLS;
    const row = (i / HOTSPOT_COLS) | 0;
    const cx = (col + 0.5) * cw;
    const cy = (row + 0.5) * ch;

    // Pulsing glow — radius oscillates slightly
    const pulse = Math.sin(performance.now() * 0.003) * 0.15 + 0.85;
    const radius = cw * 0.6 * v * pulse;

    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    grad.addColorStop(0, `rgba(239,68,68,${v * 0.25})`);   // red center
    grad.addColorStop(1, 'rgba(239,68,68,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fill();

    // Decay
    hotspotGrid[i] = Math.max(0, v - HOTSPOT_DECAY);
  }
  ctx.restore();
}
```

**Performance note:** `Float32Array` of 400 elements is negligible memory.
Radial gradients: only ~5–15 cells active at once. The `createRadialGradient` call
inside the draw loop is fine since we guard with `v < 0.05`. If profiling shows
it's expensive, cache one gradient per intensity level.

### 3.5 Unit Rendering (existing 4-pass, enhanced)

Keep the 4-pass batch structure. Enhancements:
- Default unit size: 3px for alive, 1px for destroyed (was 2/1)
- Damaged units (health < 25): orange tint instead of team color
- The 4 passes become 5:
  1. Alpha alive, healthy (blue, 3px)
  2. Bravo alive, healthy (red, 3px)
  3. Damaged units of either team (orange, 3px)  ← new pass
  4. Attacking (amber, 4px)
  5. Destroyed (gray, 1px)

```typescript
const COLOR_DAMAGED = '#f97316'; // orange

// Pass 3 (new):
ctx.fillStyle = COLOR_DAMAGED;
for (const u of units.values()) {
  if (u.status === 'destroyed' || u.status === 'attacking') continue;
  if (u.health >= 25) continue;   // only damaged
  const size = Math.max(1, Math.round(3 * scale));
  ctx.fillRect((u.x * W) | 0, (u.y * H) | 0, size, size);
}
```

Pass 1 and 2 skip units where `health < 25` (handled by pass 3 instead).

### 3.6 Event Pulses (existing, no change)

Keep as-is. The `addPulse` function also calls `addHotspot` so events feed both systems.

```typescript
// In addPulse(), add one line:
export function addPulse(unitId, x, y, type) {
  activePulses.set(unitId, { ... });
  if (type === 'attack' || type === 'destroy') addHotspot(x, y);
}
```

### 3.7 Selected Unit Highlight

When `selectionStore` has a selected unit ID, draw a crosshair "+" around it.

```typescript
function drawSelection(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  units: Map<string, Unit>,
  selectedId: string | null,
): void {
  if (!selectedId) return;
  const unit = units.get(selectedId);
  if (!unit) return;

  const px = (unit.x * W) | 0;
  const py = (unit.y * H) | 0;
  const ARM = 10;  // crosshair arm length
  const GAP = 4;   // gap between center and arm start

  ctx.save();
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1.5;
  ctx.globalAlpha = 0.9;

  // Horizontal arms
  ctx.beginPath();
  ctx.moveTo(px - GAP - ARM, py);
  ctx.lineTo(px - GAP,       py);
  ctx.moveTo(px + GAP,       py);
  ctx.lineTo(px + GAP + ARM, py);

  // Vertical arms
  ctx.moveTo(px, py - GAP - ARM);
  ctx.lineTo(px, py - GAP);
  ctx.moveTo(px, py + GAP);
  ctx.lineTo(px, py + GAP + ARM);
  ctx.stroke();

  // Outer circle (subtle glow)
  ctx.beginPath();
  ctx.arc(px, py, GAP + ARM + 3, 0, Math.PI * 2);
  ctx.strokeStyle = '#60a5fa';  // light blue
  ctx.globalAlpha = 0.3;
  ctx.lineWidth = 8;
  ctx.stroke();

  ctx.restore();
}
```

This is cheap: drawn last, only 1 unit, 6 lines + 1 arc.

### 3.8 `startRenderLoop` signature change

Add `selectionStore` subscription so the selection highlight updates immediately:

```typescript
export function startRenderLoop(
  canvas: HTMLCanvasElement,
  getMap: () => Map<string, Unit>,
  subscribe: (cb: () => void) => UnsubscribeFn,
  getSelectedId: () => string | null,
  subscribeSelection: (cb: () => void) => UnsubscribeFn,
): UnsubscribeFn
```

Both `subscribe` and `subscribeSelection` just set `dirty = true`.

---

## Part 4: Unit Selection Wiring

### 4.1 `UnitsPanel.tsx` changes

Add `onClick` to `UnitRow`:

```typescript
// Add `onSelect` to RowProps data
interface RowData { units: Unit[]; selectedId: string | null; onSelect: (id: string) => void; }

function UnitRow({ index, style, data }: ListChildComponentProps<RowData>) {
  const unit = data.units[index];
  if (!unit) return null;
  const isSelected = unit.id === data.selectedId;

  return (
    <div
      style={style}
      className={`unit-row${isSelected ? ' unit-row-selected' : ''}`}
      onClick={() => data.onSelect(unit.id)}
    >
      ...
    </div>
  );
}
```

In `UnitsPanel`:
```typescript
const selectedId = useSyncExternalStore(selectionStore.subscribe, selectionStore.getSnapshot);
const itemData = useMemo(() => ({
  units,
  selectedId,
  onSelect: selectionStore.select,
}), [units, selectedId]);
```

### 4.2 CSS for selected row

```css
.unit-row-selected {
  background: rgba(59,130,246,0.15);
  border-left: 2px solid var(--color-alpha);
}
```

### 4.3 `TacticalMap.tsx` changes

Pass selection callbacks to `startRenderLoop`:

```typescript
const stop = startRenderLoop(
  canvas,
  unitsStore.getMap,
  unitsStore.subscribe,
  selectionStore.getSnapshot,
  selectionStore.subscribe,
);
```

---

## Part 5: Legend Panel

Add below the map canvas in `TacticalMap.tsx`, as a DOM element (not canvas).

```tsx
<div className="map-legend">
  <LegendItem color="#3b82f6" label="Alpha" />
  <LegendItem color="#ef4444" label="Bravo" />
  <LegendItem color="#f97316" label="Damaged (<25 HP)" />
  <LegendItem color="#f59e0b" label="Attacking" />
  <LegendItem color="rgba(80,80,90,0.8)" label="Destroyed" />
  <LegendItem color="rgba(239,68,68,0.4)" label="Combat Zone" />
  <LegendItem diamond color="#3b82f6" label="Alpha Base" />
  <LegendItem diamond color="#ef4444" label="Bravo Base" />
</div>
```

Simple horizontal legend strip. No canvas involvement.

CSS:
```css
.map-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 16px;
  padding: 6px 12px;
  border-top: 1px solid var(--color-border);
  flex-shrink: 0;
}
.legend-item {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 10px;
  color: var(--color-text-muted);
}
.legend-dot {
  width: 8px; height: 8px;
  border-radius: 2px;
  flex-shrink: 0;
}
```

---

## Part 6: KPI Strip — Zone Control

Current `KpiStrip` has 4 cards: alpha alive, bravo alive, total alive, destroyed.
Add a 5th card for Zone Control:

```tsx
<div className="kpi-card">
  <span className="kpi-label">Zone Control</span>
  <span className="kpi-value zone">
    α {kpi.zoneControl.alpha}% / β {kpi.zoneControl.bravo}%
  </span>
</div>
```

CSS: `.kpi-strip` grid changes from `repeat(4, 1fr)` to `repeat(5, 1fr)`.

---

## Part 7: Layout Fixes

Current layout already matches the target spec. Minor adjustments:

1. Side panel row distribution: units panel should be taller (it's currently `1fr`
   competing with event feed at 220px). The event feed should be shorter (160px
   is enough for ~8 events). Suggested:

```css
.side-panels {
  grid-template-rows: 1fr 160px auto;  /* was: 1fr 220px auto */
}
```

2. The tactical map panel should fill all available space. No change needed — it
   already uses `1fr` in the main grid.

3. Map legend sits inside `.tactical-map-panel` as a flex child below the canvas.
   The panel needs `flex-direction: column` (already has it via `.panel` class).

---

## Implementation Order (step-by-step)

Execute in this order to avoid breaking the running app:

| Step | What | Risk |
|---|---|---|
| 1 | Add `selectionStore.ts` | No risk, new file |
| 2 | Unit count env var in server | Low risk, server only |
| 3 | `renderLoop.ts` — terrain layer | Medium, renderer-only |
| 4 | `renderLoop.ts` — base locations | Low, additive |
| 5 | `renderLoop.ts` — hotspot grid | Low, additive |
| 6 | `renderLoop.ts` — selection highlight + signature | Medium, API change |
| 7 | `TacticalMap.tsx` — pass selection callbacks, add legend | Low |
| 8 | `UnitsPanel.tsx` — add click selection | Low |
| 9 | `KpiStrip.tsx` — zone control card | Low |
| 10 | `global.css` — legend styles, selected row | Low |
| 11 | `tsc --noEmit` both projects | Verification |

---

## Performance Expectations After Changes

| Change | FPS impact |
|---|---|
| Terrain (offscreen canvas, drawImage) | <0.5ms/frame |
| Base locations (6 shapes + text) | <0.1ms/frame |
| Hotspot grid (≤20 radial gradients) | ~0.3ms/frame |
| Selection highlight (1 unit, 6 lines + arc) | <0.05ms/frame |
| 5th unit pass (damaged) | +1ms/frame worst case |

**Total expected overhead: ~2ms/frame.** Current frame time is 2–5ms.
At 60fps this leaves ~11ms headroom. No FPS regression expected.

---

## TypeScript Interfaces to Add

In `shared/types.ts` (optional — these can also live in `renderLoop.ts` since
they're renderer-internal):

```typescript
// Renderer-local types (do NOT need to go in shared/types.ts)

interface MapBase {
  id: string;
  label: string;
  team: 'alpha' | 'bravo';
  x: number;
  y: number;
  radius: number;
}

// hotspotGrid: Float32Array — no interface needed
// Pulse: already defined in renderLoop.ts — no change
```

No changes to `shared/types.ts` are required.

---

## What is Intentionally NOT Done

- No zoom/pan on the map (adds significant complexity, not in spec)
- No per-unit tooltip on hover (requires hit-testing 20k units, out of scope)
- No animated base capture transitions (out of scope)
- No sound effects
- No authentication, persistence, deployment

These omissions keep the implementation clean and reviewable.
