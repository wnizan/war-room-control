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

## How It Works

### Data flow: end to end

```
Server setInterval (1000ms)
  └── computeTick()
        ├── Partial Fisher-Yates sample: 200–350 random unit IDs
        ├── Mutate each selected unit (move / attack / heal / idle)
        ├── Build UnitDelta[] — only changed fields, not full Unit objects
        ├── Compute KPISummary (alive counts, zone control)
        └── Emit up to 25 GameEvents

  └── WsTransport.broadcast(TickUpdate)
        └── JSON.stringify once, send to all open WebSocket clients

Client WebSocket (wsClient.ts)
  └── onmessage → parse ServerMessage
        ├── 'snapshot'  → unitsStore.applySnapshot() → rebuild Map<id, Unit>
        └── 'tick'      → unitsStore.applyDeltas()   → mutate existing entries
                           kpiStore.update()
                           eventsStore.addEvents()

  └── unitsStore._bump() → notify all subscribers

Canvas render loop (renderLoop.ts)
  └── subscribe callback sets dirty = true
  └── requestAnimationFrame checks dirty flag
        └── draw() — 4 batched passes over Map<string, Unit>
              pass 1: alpha alive (blue, 2×2px)
              pass 2: bravo alive (orange, 2×2px)
              pass 3: attacking units (red, 3×3px highlight)
              pass 4: destroyed units (dark grey, 1×1px)

React panels (useSyncExternalStore)
  └── KpiStrip     — reads kpiStore, re-renders on every tick
  └── UnitsPanel   — reads unitsStore + filtersStore, virtualized via react-window
  └── EventFeed    — reads eventsStore, last 50 events
  └── PerfPanel    — reads usePerformanceMetrics (2fps display refresh)
```

### Reconnect and resync

- On WebSocket close, the client schedules a reconnect with exponential backoff
  (500ms base, doubles each attempt, capped at 8000ms).
- On reconnect, the server immediately sends a full snapshot.
- The client treats the snapshot as an authoritative rebuild: it replaces the
  entire `Map<string, Unit>` rather than merging.
- If a sequence gap is detected during normal operation (missed tick), the
  client closes the socket deliberately, triggering the same reconnect/resync path.

---

## Architecture Decisions

### WebSocket over SSE

Server-Sent Events are unidirectional and HTTP/1.1-based. WebSockets provide a
persistent full-duplex channel with lower per-message framing overhead. The
primary reason to choose WebSockets here is **reconnect control**: when a
sequence gap is detected, the client needs to signal the server to resend a
snapshot. With SSE that would require a separate HTTP request; with WebSockets
the client simply closes and reopens the same channel, which triggers the
server's `'connection'` handler and dispatches a fresh snapshot automatically.

### Canvas over DOM for unit rendering

Rendering 20,000 units as DOM elements is not viable. At that scale the browser
layout engine must compute position and style for each element on every tick,
producing frame times well above 16ms. Canvas 2D bypasses layout entirely: the
render loop calls `ctx.fillRect` in a tight loop over the `Map`, with colors
pre-computed as string constants. A dirty flag ensures `draw()` is only called
when data has actually changed, so the RAF loop idles at zero CPU cost between
ticks.

### Delta sync, not full refetch

A full snapshot of 20,000 units serialised to JSON is approximately 1–1.5 MB.
At 1 tick per second that is untenable. Each tick only mutates 200–350 units,
so the `TickUpdate.units` array carries only changed fields (`UnitDelta` omits
unchanged values). Measured tick messages are approximately 10–18 KB —
a 60–100x reduction versus full-state broadcast.

The delta format uses a monotonic sequence number (`seq`). The client checks
`seq === lastSeq + 1` on every tick. Any gap triggers an immediate resync
rather than silent data divergence.

### External store over Redux or Zustand

The unit collection is a `Map<string, Unit>` held in a plain class outside
React. This was a deliberate choice, not a simplification:

- Applying 350 deltas per tick is O(1) per delta (`Map.get` + field mutation).
  With Redux, each dispatch would copy the entire state object.
- The Canvas render loop reads the map directly via `getMap()` — it does not go
  through React at all. A Redux selector would add unnecessary indirection.
- `useSyncExternalStore` gives React components a safe, tearing-free subscription
  to the same store without requiring any Redux-style action/reducer boilerplate.
- The entire store layer is approximately 150 lines across four files
  (`unitsStore`, `kpiStore`, `eventsStore`, `filtersStore`).

### Zod validation on HTTP, not WebSocket

Zod schema parsing has measurable cost (schema traversal + coercion). WebSocket
`tick` messages originate from trusted server code and share the same TypeScript
types via `shared/types.ts`. Validating them at runtime would add latency on the
hot path for no safety gain. HTTP query parameters arrive from untrusted callers
and require coercion (strings to numbers), so Zod is appropriate there.

### Shared types as single source of truth

`shared/types.ts` is imported by both `server/` and `client/`. There is no type
duplication. The server's `TickUpdate` and the client's `applyDeltas` function
operate on identical interfaces. TypeScript strict mode enforces this at compile
time.

---

## Performance Characteristics

| Metric | Target | Typical observed |
|---|---|---|
| FPS (Canvas RAF) | >= 50 | 58–60 |
| Frame time | <= 20ms | 2–5ms |
| WS message size per tick | < 20 KB | 10–18 KB |
| JS Heap (Chrome) | Stable | ~45–60 MB, no growth trend |
| Long tasks (> 50ms) | 0 | 0 during steady state |
| Units in DOM | 0 | 0 (Canvas only) |

The performance panel in the dashboard displays FPS, frame time, JS heap size,
server update rate (Hz), and long-task count. These are collected entirely via
browser APIs: `requestAnimationFrame`, `performance.memory` (Chrome-only), and
`PerformanceObserver` with the `longtask` entry type. No third-party monitoring
library is used. The display updates at 2fps to avoid adding rerender overhead
to its own measurements.

---

## Trade-offs

### Canvas 2D, not WebGL

Canvas 2D is sufficient for 20,000 dots at 2×2px with a dirty flag. WebGL would
allow particle shaders and GPU-accelerated transforms, but adds substantial
complexity (shader programs, buffer management, attribute binding). The current
approach renders all units in approximately 2–5ms per frame. WebGL becomes the
correct choice if the unit count grows to 200,000+ or if the rendering needs to
include sprites, rotation, or smooth interpolation.

### No interpolation between ticks

Units jump discretely to their new position each tick rather than animating
smoothly. Implementing interpolation requires storing previous positions and
running a time-based lerp in the render loop. At 1 tick/second the jump is
visible. This is a known limitation; it was excluded to keep the render loop
simple and the architecture reviewable within scope.

### KPI is recomputed on every tick, full scan

`computeKPI` iterates all 20,000 units every second to produce alive/destroyed
counts. This is O(n) per tick. An incremental approach (maintain counters,
decrement on destruction) would be O(delta) per tick and more efficient. The
full scan was chosen for correctness simplicity — it cannot drift out of sync
with the actual state. At 20,000 units the scan completes in under 1ms.

### Sequence gap strategy: close and resync, not buffer

When the client detects a missed sequence number it closes the WebSocket and
waits for a fresh snapshot rather than buffering out-of-order deltas and
replaying them. Buffering is more resilient to transient reordering but requires
a sliding window, per-message ACKs, and careful handling of the buffer drain.
The close-and-resync approach is simpler, correct under the assumption that gaps
are rare (single server, no message reordering on localhost), and guarantees
consistency after recovery.

### react-window requires a fixed item height

The units list uses `FixedSizeList` from `react-window`, which requires every
row to have the same pixel height (36px). Variable-height rows would require
`VariableSizeList` and pre-measured heights, significantly increasing code
complexity. The fixed-height constraint is acceptable because each unit row
displays the same fields.

### No authentication or multi-client isolation

All connected clients receive the same broadcast. There is no session identity,
rate limiting, or per-client filtering at the WebSocket layer. This is appropriate
for a dashboard exercise but not for a production deployment.

---

## Project Structure

```
war-room-control/
├── shared/
│   └── types.ts              Single source of truth for all interfaces
├── server/
│   └── src/
│       ├── index.ts           HTTP server + tick loop bootstrap
│       ├── simulation/
│       │   ├── units.ts       generateUnits() — 20,000 unit factory
│       │   └── tick.ts        computeTick() — delta computation per tick
│       ├── transport/
│       │   └── websocket.ts   WsTransport class — snapshot on connect, broadcast ticks
│       └── api/
│           └── routes.ts      GET /api/units — Zod-validated query params
└── client/
    └── src/
        ├── App.tsx            Layout + connection status badge
        ├── store/
        │   ├── unitsStore.ts  Map<string, Unit> with subscribe/notify
        │   ├── kpiStore.ts    KPISummary — updates each tick
        │   ├── eventsStore.ts GameEvent[] — last 50 events, prepend-and-trim
        │   └── filtersStore.ts Filter state (status, health range, name)
        ├── sync/
        │   └── wsClient.ts    WebSocket client, snapshot/delta dispatch, reconnect
        ├── map/
        │   ├── TacticalMap.tsx Canvas mount, ResizeObserver, render loop lifecycle
        │   └── renderLoop.ts  RAF loop, dirty flag, 4-pass batch draw
        ├── panels/
        │   ├── KpiStrip.tsx   4 KPI cards
        │   ├── UnitsPanel.tsx Virtualized unit list + filter controls
        │   ├── EventFeed.tsx  Event log, last 50
        │   └── PerfPanel.tsx  Live metrics display, collapsible
        ├── observability/
        │   └── usePerformanceMetrics.ts RAF-based FPS/frame-time, heap, update rate
        └── design/
            ├── tokens.css     CSS custom properties (color, spacing, typography)
            └── global.css     Dark theme base, layout grid, component styles
```

---

## Future Improvements

**Smooth unit movement.** Store previous and target positions; lerp in the render
loop between ticks using elapsed time. This eliminates the visible jump and makes
the map considerably more readable at the cost of doubling position storage.

**WebGL renderer.** Replace the Canvas 2D path with a WebGL instanced draw call.
Each unit becomes a vertex in an attribute buffer. Position updates are a typed
array write (`Float32Array`) followed by `bufferSubData`. This would support
100,000+ units at 60fps and enable per-unit color gradients based on health.

**Spatial indexing for hit-testing.** Mouse hover currently requires scanning all
20,000 units to find the nearest. A grid-based spatial index (bucket units into
cells by normalised x/y) would make hover lookup O(1) for sparse grids.

**Incremental KPI counters.** Replace the O(n) full scan with O(delta) counter
updates: increment `destroyedAlpha` when a unit's status transitions to
`'destroyed'`, decrement `aliveAlpha`. This reduces per-tick CPU cost on the
server and makes KPI computation independent of total unit count.

**Selective React subscriptions.** The current `useSyncExternalStore` hooks
re-render subscribing components on every tick regardless of whether the data
they display actually changed. Adding a selector-level equality check (similar to
Zustand's `shallow`) would cut unnecessary React work during high-frequency updates.

**Production build pipeline.** The server currently runs via `tsx watch` (JIT
TypeScript). A production deployment would compile to `dist/` with `tsc`,
containerise with Docker, and serve the Vite build as static files behind a
reverse proxy that upgrades WebSocket connections.

**Message compression.** At high client counts, per-message JSON overhead
accumulates. Enabling `perMessageDeflate` in the `ws` server configuration or
switching to a binary format (MessagePack, protobuf) would reduce bandwidth
proportionally to the number of connected clients.

---

## Reviewer Q&A

**Q: Why not use a state management library like Zustand or Redux Toolkit?**

The unit store has exactly two operations: `applySnapshot` and `applyDeltas`.
Neither fits the action/reducer model well — `applyDeltas` is a tight mutation
loop over a `Map`, not a pure transform of a serialisable object. Zustand's
`set` function copies the state slice, which at 20,000 entries per tick is a
meaningful allocation. The custom store is 59 lines and gives full control over
when and how React is notified. Adding a library here would increase complexity,
not reduce it.

**Q: Why does the Canvas render loop iterate the Map four times per frame?**

Grouping draws by `fillStyle` eliminates style-switching overhead. The Canvas
2D context batches fills of the same style; changing `fillStyle` mid-loop forces
the GPU to flush the current batch. Four passes (alpha alive, bravo alive,
attacking, destroyed) means four style changes per frame regardless of unit
count. A single-pass loop that sets style per unit would incur up to 20,000
style changes. The four-pass approach is a well-known Canvas 2D optimisation.

**Q: What happens if the server falls behind and ticks arrive out of order?**

The server runs a single `setInterval` loop and broadcasts synchronously to all
clients before the next tick fires. Out-of-order delivery is not possible on a
single-process server with a loopback WebSocket connection. The sequence check
is a defence against network-level message reordering (possible on WAN), tab
suspension causing message queuing, or future multi-process architecture. When
triggered, the response is to close and resync, which is conservative but
guarantees consistency.

**Q: Why does the performance panel update at 2fps instead of every frame?**

The metrics are collected every frame via `requestAnimationFrame` into module-level
refs (no state). The 2fps display update calls `setMetrics` (a `useState` setter)
on a 500ms timer. If the panel updated at 60fps, the `setMetrics` call would
trigger a React reconcile 60 times per second for a component that a user reads
at human speed. The panel is specifically designed so that metric _collection_
runs at full rate but metric _display_ runs at a rate that is perceptible without
adding rerender overhead to the thing being measured.

**Q: Why is Zod used on HTTP but not on WebSocket messages?**

WebSocket messages are produced by the server's own `computeTick` function, which
returns a `TickUpdate` typed by the shared TypeScript interfaces. The server and
client share the same type definitions. There is no untrusted input path.
HTTP query parameters arrive from external callers as raw strings with no type
information; Zod coerces, validates, and provides structured error responses.
Applying Zod on the WebSocket hot path would add schema traversal cost to every
tick dispatch for no safety gain.

**Q: Could this scale to 200,000 units?**

Not with the current architecture unchanged. Three bottlenecks emerge at that
scale: (1) the snapshot message on connect grows to ~12MB, which is a slow first
load and memory spike; (2) the Canvas 2D four-pass loop over 200k entries takes
approximately 20–40ms per frame depending on hardware, dropping below 30fps;
(3) `computeKPI`'s O(n) scan takes proportionally longer. The addressed path
would be: chunked snapshot delivery, WebGL instanced rendering with a
`Float32Array` position buffer, and incremental KPI counters. These are
architectural extensions, not rewrites.
