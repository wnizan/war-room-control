# War Room Control

Real-time battlefield dashboard tracking 20,000 units with live WebSocket updates,
Canvas map rendering, and browser-native performance monitoring.

**Stack:** Node.js 22 + TypeScript (server) | React 19 + TypeScript + Vite (client)

---

## Setup and Run

Two packages must be started independently. Open two terminals.

### 1. Server

```bash
cd server
npm install
npm run dev
```

Starts on `http://localhost:3001`.
WebSocket endpoint: `ws://localhost:3001`
REST endpoint: `http://localhost:3001/api/units`
Health check: `http://localhost:3001/health`
Restart endpoint: `POST http://localhost:3001/api/restart`

### 2. Client

```bash
cd client
npm install
npm run dev
```

Starts on `http://localhost:5173`. Open this in a browser.

### TypeScript validation (both packages)

```bash
cd server && npx tsc --noEmit
cd client && npx tsc --noEmit
```

Both must produce zero errors.

---

## Features

### Tactical Map
- Canvas 2D rendering of 20,000 units as coloured dots (zero DOM nodes)
- Single-pass unit classification into 5 typed buckets (alpha / bravo / damaged / attacking / destroyed), then batch `fillRect` per bucket — one `fillStyle` change per category
- 7-layer rendering stack: terrain (OffscreenCanvas) → sectors → bases → hotspots → units → pulses → selection
- **Zoom**: mouse wheel or `+` / `−` / `⌂` buttons (1×–8×)
- **Pan**: drag to pan when zoomed in (pointer capture)
- **Combat hotspots**: 20×20 grid of heat values; attack/destroy events accumulate heat, which decays over time. Rendered as glowing zones at contact lines
- **Pulse animations**: expanding ring per attack/destroy/heal event (800ms, fades out)
- **Base markers**: HQ (diamond ring), FWD (concentric ring), SUPPLY (cardinal tick marks)
- **Sector dominance**: A1/A2/B1/B2 quadrants coloured by team control (>60% threshold)
- **Unit selection**: click to highlight; crosshair overlay on canvas

### Simulation
- 20,000 units split between Alpha (blue) and Bravo (red) teams, configurable at runtime
- Units spawn clustered near team bases via Box-Muller normal distribution (HQ 45%, FWD 35%, SUPPLY 20%)
- Each tick (1 Hz): 200–350 units sampled. Each unit: move with conquest advance toward enemy HQ (40%), attack nearest enemy from 12-sample proximity scan (18%), heal (10%), idle (32%)
- Proximity-based attacks mean combat pulses and hotspots appear at actual front lines, not random map positions

### UI Panels
- **KPI Strip**: Alpha alive, Bravo alive, destroyed counts, zone control percentage, total units
- **Units Panel**: virtualized list (react-window, 36px rows), filters by team / status / health range / name
- **Event Feed**: last 50 events, colour-coded by type (attack / destroyed / heal / capture)
- **Performance Panel**: FPS, frame time, JS heap (Chrome), update rate (Hz), long-task count — all via browser APIs, 2fps display refresh

### Restart
- **↺ Restart** button in the KPI row opens a modal dialog
- Slider sets Alpha/Bravo team ratio (10%–90%) with a live colour bar preview
- `POST /api/restart { alphaRatio }` regenerates all 20,000 units server-side and broadcasts a fresh snapshot to all connected clients
- Client resets event feed on snapshot receipt; canvas state (hotspots, pulses, terrain cache) resets on remount

---

## How It Works

### Data flow: end to end

```
Server setInterval (1000ms)
  └── computeTick()
        ├── Fisher-Yates sample: 200–350 random unit IDs
        ├── Per unit: move (conquest advance + noise) / attack nearest / heal / idle
        ├── Build UnitDelta[] — only changed fields, not full Unit objects
        ├── Compute KPISummary (alive counts, zone control %)
        └── Emit up to 25 GameEvents (attack / destroyed / heal / capture)

  └── WsTransport.broadcast(TickUpdate)
        └── JSON.stringify once → send to all open WebSocket clients

Client WebSocket (wsClient.ts)
  └── onmessage → parse ServerMessage (type discriminant check)
        ├── 'snapshot' → unitsStore.applySnapshot() → rebuild Map<id, Unit>
        │                kpiStore.update()
        │                eventsStore.clear()          ← fresh on restart/reconnect
        └── 'tick'     → unitsStore.applyDeltas()    → mutate existing entries
                          kpiStore.update()
                          eventsStore.addEvents()
                          pulsesStore.enqueue()       ← per attack/destroy/heal event

  └── unitsStore._bump() → notify all subscribers

Canvas render loop (renderLoop.ts)
  └── subscribe callback sets dirty = true
  └── requestAnimationFrame checks dirty | hasPulses | hasActiveHotspots
        └── draw()
              Layer 0:  fillRect background (#0d1117)
              Layer 0b: drawImage(terrainCanvas)       ← OffscreenCanvas, rebuilt on resize
              Layer 1:  drawSectors()                  ← sector dominance, cached between ticks
              Layer 2:  drawBases()                    ← HQ / FWD / SUPPLY markers
              Layer 3:  drawHotspots()                 ← heat grid, pre-computed colour LUTs
              Layer 4:  single-pass unit classify → 5× batchfillRect
              Layer 5:  drawPulses()                   ← expanding ring animations
              Layer 6:  drawSelection()                ← crosshair on selected unit

React panels (useSyncExternalStore)
  └── KpiStrip     — reads kpiStore, re-renders on every tick
  └── UnitsPanel   — reads unitsStore + filtersStore, virtualized (react-window)
  └── EventFeed    — reads eventsStore, last 50 events
  └── PerfPanel    — reads usePerformanceMetrics (2fps display refresh)
```

### Reconnect and resync

- On WebSocket close, the client schedules a reconnect with exponential backoff
  (500ms base, doubles each attempt, capped at 8000ms).
- On reconnect, the server immediately sends a full snapshot.
- The client treats the snapshot as an authoritative rebuild: replaces the entire
  `Map<string, Unit>` and clears the event feed.
- If a sequence gap is detected during normal operation (missed tick), the client
  closes the socket deliberately, triggering the same reconnect/resync path.

---

## Architecture Decisions

### WebSocket over SSE

Server-Sent Events are unidirectional and HTTP/1.1-based. WebSockets provide a
persistent full-duplex channel with lower per-message framing overhead. The
primary reason to choose WebSockets here is **reconnect control**: when a
sequence gap is detected, the client signals the server to resend a snapshot by
closing and reopening the connection. With SSE that would require a separate HTTP
request; with WebSockets the client simply closes and reopens the same channel,
which triggers the server's `'connection'` handler automatically.

### Canvas over DOM for unit rendering

Rendering 20,000 units as DOM elements is not viable. At that scale the browser
layout engine must compute position and style for each element on every tick,
producing frame times well above 16ms. Canvas 2D bypasses layout entirely. A
dirty flag ensures `draw()` is only called when data has actually changed, so
the RAF loop idles at near-zero CPU cost between ticks.

### Single-pass unit rendering with typed buckets

Units are classified once per frame into 5 flat `number[]` arrays (alpha, bravo,
damaged, attacking, destroyed). Each bucket is then rendered with a single
`fillStyle` change followed by N `fillRect` calls. This keeps `fillStyle`
changes to 5 per frame regardless of unit count, matching the Canvas 2D GPU
batch model.

### Delta sync, not full refetch

A full snapshot of 20,000 units serialised to JSON is approximately 1–1.5 MB.
Each tick only mutates 200–350 units, so `TickUpdate.units` carries only changed
fields (`UnitDelta` omits unchanged values). Measured tick messages are
approximately 10–18 KB — a 60–100× reduction versus full-state broadcast.

The delta format uses a monotonic sequence number (`seq`). Any gap triggers an
immediate resync rather than silent data divergence.

### External store over Redux or Zustand

The unit collection is a `Map<string, Unit>` held in a plain class outside React.
Applying 350 deltas per tick is O(1) per delta (`Map.get` + field mutation). The
Canvas render loop reads the map directly via `getMap()` — it does not go through
React at all. `useSyncExternalStore` gives React components a safe, tearing-free
subscription without Redux-style action/reducer boilerplate.

### pulsesStore as decoupling layer

`wsClient.ts` (sync layer) must not import `renderLoop.ts` (canvas layer) — that
would make the sync layer dependent on the renderer, preventing independent
evolution or testing. `pulsesStore` acts as an intermediary: `wsClient` calls
`pulsesStore.enqueue()`, and `renderLoop` subscribes to `pulsesStore` and drains
it each frame. The coupling cost is one RAF frame of latency (~16ms) — imperceptible.

### Zod validation on HTTP, not WebSocket

Zod schema parsing has measurable cost. WebSocket messages originate from trusted
server code typed by `shared/types.ts`. HTTP query parameters arrive from
untrusted callers as raw strings and require coercion, so Zod is appropriate there.
`POST /api/restart` is also Zod-validated (body schema + CORS headers).

### Sector dominance caching

`computeSectorDominance` scans all 20,000 units to produce 4 values that change
at most 1 Hz. The result is cached in `cachedSectorDominance` and invalidated only
when the unit store notifies subscribers (i.e., on each tick). During pan/zoom
the cached value is reused without rescanning.

### Combat proximity targeting

Attacks use `pickNearest()`: sample 12 random enemies, return the closest by
Euclidean distance. O(12) per attacker rather than O(10,000). This ensures
combat events — and therefore canvas pulses and hotspot heat — accumulate at
actual geographical contact zones rather than random map positions.

---

## Performance Characteristics

| Metric | Target | Typical observed |
|---|---|---|
| FPS (Canvas RAF) | ≥ 50 | 58–60 |
| Frame time | ≤ 20ms | 2–5ms |
| WS tick message size | < 20 KB | 10–18 KB |
| JS Heap (Chrome) | Stable | ~45–60 MB, no growth |
| Long tasks (> 50ms) | 0 | 0 during steady state |
| Units in DOM | 0 | 0 (Canvas only) |
| `fillStyle` changes/frame | 5 | 5 (one per bucket) |
| Hotspot colour allocations/frame | 0 | 0 (pre-computed LUTs) |

The performance panel displays all metrics via browser APIs only:
`requestAnimationFrame`, `performance.memory` (Chrome), `PerformanceObserver`
(`longtask` entry type). No third-party monitoring library.

---

## Trade-offs

### Canvas 2D, not WebGL

Canvas 2D is sufficient for 20,000 dots at 3×3px with a dirty flag and single-pass
rendering. WebGL would allow particle shaders and GPU-accelerated transforms but
adds substantial complexity. WebGL becomes the correct choice at 200,000+ units or
when rendering needs sprites, rotation, or smooth interpolation.

### No interpolation between ticks

Units jump discretely to their new position each tick. Implementing interpolation
requires storing previous positions and running a time-based lerp in the render
loop. At 1 tick/second the jump is visible. Excluded to keep the render loop
simple and the scope reviewable.

### KPI is recomputed on every tick, full scan

`computeKPI` iterates all 20,000 units each second. An incremental approach
(counters decremented on destruction) would be O(delta) per tick. The full scan
was chosen for correctness simplicity — it cannot drift. At 20,000 units the scan
completes in under 1ms.

### Sequence gap strategy: close and resync, not buffer

When the client detects a missed sequence number it closes the WebSocket and waits
for a fresh snapshot rather than buffering out-of-order deltas. Buffering is more
resilient to transient reordering but requires a sliding window and careful drain
logic. Close-and-resync is simpler and guarantees consistency.

### No authentication or multi-client isolation

All connected clients receive the same broadcast. There is no session identity,
rate limiting, or per-client filtering. Appropriate for a dashboard exercise; not
for production deployment.

---

## Project Structure

```
war-room-control/
├── shared/
│   └── types.ts                Single source of truth for all interfaces
├── server/
│   └── src/
│       ├── index.ts             HTTP server + tick loop bootstrap + restart handler
│       ├── simulation/
│       │   ├── units.ts         generateUnits(count, alphaRatio) — clustered spawning
│       │   └── tick.ts          computeTick() — delta computation, proximity attacks
│       ├── transport/
│       │   └── websocket.ts     WsTransport — snapshot on connect, broadcast ticks,
│       │                        broadcastSnapshot() for post-restart push
│       └── api/
│           └── routes.ts        GET /api/units (Zod), POST /api/restart (Zod + CORS)
└── client/
    └── src/
        ├── App.tsx              Layout, connection badge, ↺ Restart modal
        ├── store/
        │   ├── unitsStore.ts    Map<string, Unit> with subscribe/notify
        │   ├── kpiStore.ts      KPISummary — updates each tick
        │   ├── eventsStore.ts   GameEvent[] — last 50 events, clear() on snapshot
        │   ├── filtersStore.ts  Filter state (team, status, health range, name)
        │   ├── selectionStore.ts Selected unit ID
        │   └── pulsesStore.ts   Pulse queue — decouples wsClient from renderLoop
        ├── sync/
        │   └── wsClient.ts      WS client, snapshot/delta dispatch, reconnect backoff
        ├── map/
        │   ├── TacticalMap.tsx  Canvas mount, zoom/pan controls, render loop lifecycle
        │   └── renderLoop.ts    RAF loop, 7-layer draw, hotspot LUTs, resetRenderState()
        ├── panels/
        │   ├── KpiStrip.tsx     5 KPI cards (alpha, bravo, destroyed ×2, zone control)
        │   ├── UnitsPanel.tsx   Virtualized list + team/status/health/name filters
        │   ├── EventFeed.tsx    Event log, last 50, colour-coded by type
        │   └── PerfPanel.tsx    Live metrics display, collapsible
        ├── observability/
        │   └── usePerformanceMetrics.ts  RAF-based FPS/frame-time, heap, update rate
        └── design/
            ├── tokens.css       CSS custom properties (colour, spacing, typography)
            └── global.css       Dark theme, layout grid, component + modal styles
```

---

## API Reference

### `GET /api/units`

Query parameters (all optional, Zod-validated):

| Param | Type | Default | Description |
|---|---|---|---|
| `status` | enum | — | Filter by unit status |
| `healthMin` | number 0–100 | — | Minimum health |
| `healthMax` | number 0–100 | — | Maximum health |
| `name` | string ≤100 | — | Substring match on unit name |
| `limit` | number 1–1000 | 200 | Page size |
| `offset` | number ≥0 | 0 | Page offset |

Response: `{ total, offset, limit, units: Unit[] }`

### `POST /api/restart`

Body (JSON):

| Field | Type | Default | Description |
|---|---|---|---|
| `alphaRatio` | number 0–1 | 0.5 | Fraction of units assigned to Alpha team |

Response: `{ ok: true, alphaRatio, units: 20000 }`

Triggers server-side unit regeneration and broadcasts a fresh snapshot to all
connected WebSocket clients.

### `GET /health`

Response: `{ status: "ok", units: number }`

---

## Reviewer Q&A

**Q: Why not use a state management library like Zustand or Redux Toolkit?**

The unit store has exactly two operations: `applySnapshot` and `applyDeltas`.
`applyDeltas` is a tight mutation loop over a `Map`, not a pure transform of a
serialisable object. Zustand's `set` copies the state slice; at 20,000 entries
per tick that is a meaningful allocation. The custom store is ~60 lines and gives
full control over when and how React is notified.

**Q: Why does the Canvas render loop use 5 passes instead of 1?**

It uses **1 classification pass** (loop over all units to bucket them) followed
by **5 render passes** (one `fillStyle` change + N `fillRect` calls per bucket).
Setting `fillStyle` mid-loop forces the GPU to flush the current batch. Five
changes per frame is optimal regardless of unit count. A single-pass loop with
per-unit style changes would incur up to 20,000 GPU flushes.

**Q: What happens if the server falls behind and ticks arrive out of order?**

The server runs a single `setInterval` loop and broadcasts synchronously. Out-of-
order delivery is not possible on a single-process server with a loopback
connection. The sequence check defends against tab suspension causing message
queuing, or future multi-process architecture. When triggered: close and resync.

**Q: Why does the performance panel update at 2fps instead of every frame?**

Metrics are collected every frame into module-level refs (no state). The 2fps
display calls `setMetrics` on a 500ms timer. At 60fps the `setMetrics` call
would trigger a React reconcile 60×/sec for a panel a user reads at human speed.
The design decouples collection rate from display rate.

**Q: Why is Zod used on HTTP but not on WebSocket messages?**

WebSocket messages originate from the server's own typed code — no untrusted
input path. HTTP query parameters arrive as raw strings from external callers and
require coercion. `POST /api/restart` is also validated: body is Zod-parsed,
CORS headers allow `Content-Type` for cross-origin fetch from the Vite dev server.

**Q: Could this scale to 200,000 units?**

Three bottlenecks emerge: (1) snapshot grows to ~12MB; (2) Canvas 2D single-pass
over 200k entries takes ~20–40ms, dropping below 30fps; (3) `computeKPI` O(n)
scan takes proportionally longer. The fix path: chunked snapshot delivery, WebGL
instanced rendering with a `Float32Array` position buffer, incremental KPI
counters.

**Q: How does the Restart feature work end to end?**

Client clicks **↺ Restart**, sets `alphaRatio` via slider (10–90%), clicks
Confirm → `POST /api/restart { alphaRatio }`. Server Zod-validates the body,
calls `handleRestart(alphaRatio)`: regenerates all 20,000 units via `generateUnits`,
resets `seq = 0`, serialises and broadcasts a new snapshot to every open WS
connection. Each client receives `'snapshot'`, calls `applySnapshot` (full map
rebuild), clears the event feed, and the canvas resets hotspots/pulses via
`resetRenderState()` on the next `startRenderLoop` call.

---

## Future Improvements

**Smooth unit movement.** Store previous and target positions; lerp in the render
loop between ticks using elapsed time.

**WebGL renderer.** Replace Canvas 2D with a WebGL instanced draw call. Each unit
is a vertex in an attribute buffer; position updates are a `Float32Array` write +
`bufferSubData`. Supports 100,000+ units at 60fps.

**Spatial indexing for hit-testing.** Mouse hover currently scans all 20,000 units.
A grid-based spatial index would make lookup O(1) for sparse grids.

**Incremental KPI counters.** Replace the O(n) full scan with O(delta) counter
updates on status transitions.

**Selective React subscriptions.** Components re-render on every tick even if
their displayed data did not change. A selector-level equality check (Zustand
`shallow`-style) would cut unnecessary React work.

**Production build pipeline.** Server runs via `tsx watch` (JIT TypeScript). A
production deployment would compile with `tsc`, containerise with Docker, and
serve the Vite build as static files behind a reverse proxy.

**Message compression.** Enable `perMessageDeflate` in the `ws` server config or
switch to a binary format (MessagePack, protobuf) to reduce bandwidth at high
client counts.
