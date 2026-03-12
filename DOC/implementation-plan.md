# War Room Control — Implementation Plan

## Context
Take-home exercise: full-stack real-time dashboard tracking 20,000 battlefield units.
Evaluated on architectural clarity, delta sync strategy, rendering performance, and trade-off reasoning.
No code exists yet. This plan takes the project from zero to a complete, reviewable submission.

---

## Architecture Summary (Decided)

| Decision | Choice | Rationale |
|---|---|---|
| Transport | WebSocket | Persistent, handles reconnects, bidirectional future |
| Sync | Snapshot + delta | Delta ~15KB/tick vs full 1MB/tick |
| Sequencing | Monotonic seq + resync on gap | Simpler than CRDT, sufficient for exercise |
| Map rendering | Canvas 2D | Sufficient for 20k dots, no WebGL complexity |
| State | `Map<string, Unit>` outside React | O(1) lookup, no rerender storms |
| React sync | `useSyncExternalStore` | High-frequency, selective subscriptions |
| Validation | Zod on server inputs | Runtime safety + TypeScript inference |
| TypeScript | strict: true, zero `any` | Non-negotiable per requirements |

---

## Folder Structure

```
war-room-control/
├── shared/
│   └── types.ts          ← single source of truth for all interfaces
├── server/
│   ├── src/
│   │   ├── simulation/   ← unit generation + tick loop
│   │   ├── transport/    ← WebSocket server
│   │   ├── api/          ← HTTP endpoints + Zod validation
│   │   └── index.ts
│   ├── package.json
│   └── tsconfig.json
├── client/
│   ├── src/
│   │   ├── store/        ← external unit store
│   │   ├── sync/         ← WebSocket client + snapshot/delta merge
│   │   ├── map/          ← Canvas render loop
│   │   ├── panels/       ← KPI, units list, event feed, perf panel
│   │   ├── design/       ← CSS tokens + global styles
│   │   └── App.tsx
│   ├── package.json
│   └── tsconfig.json
└── README.md
```

---

## Phases

### Phase 0 — Foundation (No agent needed)
**Goal:** Monorepo scaffold, shared types, TypeScript config, CLAUDE.md
**Tasks:**
- `mkdir war-room-control && cd war-room-control`
- Init `server/` with Node.js + TypeScript + Zod + ws
- Init `client/` with Vite + React + TypeScript
- Create `shared/types.ts` from `data-contracts` skill
- Configure `tsconfig.json` with `strict: true` on both
- Add `.gitignore`, `README.md` stub
- Create `CLAUDE.md` (see below)

**Deliverable:** Both projects compile. `npm run dev` works on each.
**Dependencies:** None.

---

## CLAUDE.md (Project Instructions for All Agents)

> Path: `c:/WAR ROOM CONTOL/CLAUDE.md`
> Purpose: Persistent context loaded automatically into every agent session.

```markdown
# War Room Control — Claude Instructions

## Project
Full-stack real-time battlefield dashboard. 20,000 units, live updates, Canvas map.
Server: Node.js + TypeScript | Client: React + TypeScript

## Non-Negotiable Rules
- TypeScript strict mode everywhere — ZERO `any`
- No DOM rendering of units — Canvas only
- Client receives deltas only — never full 20k refetch
- Performance panel uses browser APIs only — no third-party tools
- Validate all server query parameters with Zod

## Key Skills (always load when relevant)
- `/hard-requirements` — constraints checklist
- `/data-contracts` — shared TypeScript interfaces
- `/realtime-architecture` — WebSocket + snapshot/delta pattern
- `/typescript-strict-mode` — coding rules + Zod patterns
- `/react-performance` — store, memoization, virtualization
- `/canvas-rendering` — dirty flag, fillRect, hit-testing
- `/design-system-dark-dashboard` — tokens, colors, spacing
- `/browser-observability` — FPS, heap, RAF patterns
- `/review-defense` — trade-off Q&A for reviewer

## Agent Responsibilities
| Agent | When to use |
|---|---|
| architect-agent | Transport/contracts/folder structure decisions |
| backend-simulation-agent | Any server code |
| frontend-sync-agent | Store, WebSocket client, delta merge |
| map-rendering-agent | Canvas component |
| ui-panels-agent | KPI, units list, event feed, filters |
| observability-agent | Performance panel |
| qa-perf-agent | Before any demo or submission |
| readme-review-agent | Final README + review prep |
| design-system-agent | Design tokens or component guidelines |

## Folder Structure
```
war-room-control/
├── shared/types.ts    ← single source of truth
├── server/src/
│   ├── simulation/
│   ├── transport/
│   └── api/
└── client/src/
    ├── store/
    ├── sync/
    ├── map/
    ├── panels/
    └── design/
```

## Validation Gates (run before moving to next phase)
- `tsc --noEmit` passes with zero errors
- WS delta messages are <20KB per tick (check DevTools Network)
- No 20k DOM nodes (check DevTools Elements)
- FPS stays above 50 during active simulation
```


---

### Phase 1 — Backend Simulation
**Agent:** `backend-simulation-agent`
**Skills:** `hard-requirements`, `data-contracts`, `typescript-strict-mode`, `realtime-architecture`

**Tasks:**
1. Generate 20,000 units at startup (two teams, random x/y, health 0–100)
2. Simulation tick every 1000ms — mutate 200–350 random units (move/attack/idle)
3. Compute delta (changed units only) per tick
4. Generate `GameEvent` items per tick (attacks, destroys)
5. Compute `KPISummary` (alive counts, zone control)
6. WebSocket server: send snapshot on connect, broadcast `TickUpdate` per tick
7. HTTP endpoint `GET /api/units` with Zod-validated query params (status, healthMin, healthMax, name)

**Deliverable:** Server starts, sends snapshot + ticks via WebSocket. Can be tested with `wscat` or browser DevTools.
**Dependencies:** Phase 0 (shared types)

---

### Phase 2 — Frontend State + Sync
**Agent:** `frontend-sync-agent`
**Skills:** `react-performance`, `realtime-architecture`, `data-contracts`, `typescript-strict-mode`

**Tasks:**
1. External unit store: `Map<string, Unit>` with subscribe/notify
2. WebSocket client: connect, receive snapshot → populate store
3. Delta merge: apply `TickUpdate.units` to store (O(1) per unit)
4. Sequence validation: detect gaps → trigger resync
5. Reconnect: on drop → request fresh snapshot → rebuild store
6. Separate stores for KPI, events (last 50), filters state
7. Selectors: `useSyncExternalStore` hooks for filtered units, KPI, events

**Deliverable:** Store receives live updates. `console.log` shows unit count updating every second.
**Dependencies:** Phase 1 (server running)

---

### Phase 3 — Design System
**Agent:** `design-system-agent`
**Skills:** `design-system-dark-dashboard`

**Tasks:**
1. CSS custom properties (`--color-*`, `--font-*`, `--space-*`) from design tokens
2. Global styles: dark background, typography reset
3. Panel component: base container with border, header, content slots
4. Semantic state classes: `.status-active`, `.status-critical`, etc.
5. Team color utilities: `.team-alpha`, `.team-bravo`

**Deliverable:** `design/tokens.css` imported in `main.tsx`. Panel component renders correctly.
**Dependencies:** Phase 0 (project scaffold)
**Note:** Can run PARALLEL with Phase 1 + 2

---

### Phase 4 — Tactical Map (Canvas)
**Agent:** `map-rendering-agent`
**Skills:** `canvas-rendering`, `react-performance`

**Tasks:**
1. `<canvas>` element mounted via `useRef`, sized to fill panel
2. Render loop outside React: `requestAnimationFrame` + dirty flag
3. Draw all units: `fillRect(x*W, y*H, 2, 2)` batched by team color
4. Store subscription: `dirty = true` on each tick update
5. Hit-testing: `mousemove` → nearest unit lookup → highlight selected
6. Resize handler: recalculate canvas dimensions on window resize

**Deliverable:** Canvas renders all 20,000 dots. Smooth at ~60fps. Units move visibly per tick.
**Dependencies:** Phase 2 (store with units), Phase 3 (design tokens for colors)

---

### Phase 5 — UI Panels
**Agent:** `ui-panels-agent`
**Skills:** `react-performance`, `design-system-dark-dashboard`, `hard-requirements`

**Tasks:**
1. **KPI Strip:** 4 cards (alive alpha, alive bravo, destroyed, zone control) — update via KPI store selector
2. **Units Panel:** virtualized list (`react-window`) — filter by status, health range, name search
3. **Event Feed:** append-only list, last 50 events, color-coded by type
4. **Layout:** CSS Grid — KPI strip top, map dominant left, panels right column
5. **Filter controls:** status checkboxes, health range slider, name text input

**Deliverable:** All panels render and update live. Filtering works without full rerender.
**Dependencies:** Phase 2 (stores), Phase 3 (design system)

---

### Phase 6 — Observability Panel
**Agent:** `observability-agent`
**Skills:** `browser-observability`

**Tasks:**
1. FPS counter: RAF loop with 1s average
2. Frame time: delta between consecutive frames
3. Heap: `performance.memory?.usedJSHeapSize` — Chrome-only, null fallback
4. Update rate: count `TickUpdate` messages per second
5. Long tasks: `PerformanceObserver` with `longtask` type
6. Panel display: updates at 2fps (human-readable), metrics in monospace
7. Collapsible: toggle open/closed without destroying instrumentation

**Deliverable:** Performance panel shows live metrics. Closing panel does not stop collection.
**Dependencies:** Phase 5 (panel shell), Phase 2 (update rate counter hook)

---

### Phase 7 — QA + Performance Validation
**Agent:** `qa-perf-agent`
**Skills:** `hard-requirements`, `realtime-architecture`

**Checklist:**
- [ ] Snapshot contains exactly 20,000 units
- [ ] Delta contains only changed units (never full list)
- [ ] Seq numbers are monotonic, gaps trigger resync
- [ ] Filters: status / health / name work independently and combined
- [ ] Reconnect: disconnect WebSocket → reconnect → dashboard recovers
- [ ] Canvas: confirm no DOM nodes per unit (DevTools Elements check)
- [ ] FPS: stays above 50fps during active ticks
- [ ] Performance panel: heap usage stable (no memory leak)
- [ ] TypeScript: `tsc --noEmit` passes with zero errors on both projects

**Deliverable:** Written report of findings. Blockers fixed before Phase 8.
**Dependencies:** Phases 1–6 complete

---

### Phase 8 — README + Review Prep
**Agent:** `readme-review-agent`
**Skills:** `review-defense`

**Tasks:**
1. README: setup instructions (`npm install && npm run dev` for each)
2. Architecture Decisions section (required by spec)
3. Trade-offs documented honestly
4. Future improvements section
5. Reviewer Q&A prep (internal notes, not in README)

**Deliverable:** `README.md` complete. Project ready for GitHub submission.
**Dependencies:** Phase 7 complete

---

## Agent Execution Order

```
Phase 0 (manual scaffold)
    │
    ├──► Phase 1: backend-simulation-agent
    ├──► Phase 3: design-system-agent       ← parallel with Phase 1
    │
    └──► Phase 2: frontend-sync-agent       ← after Phase 1
             │
             ├──► Phase 4: map-rendering-agent    ← parallel with Phase 5
             └──► Phase 5: ui-panels-agent
                      │
                      └──► Phase 6: observability-agent
                                │
                                └──► Phase 7: qa-perf-agent
                                          │
                                          └──► Phase 8: readme-review-agent
```

---

## Risks & Mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| Canvas 2D can't hold 60fps at 20k units | Low | Dirty flag + batch draws; WebGL fallback ready |
| Rerender storms in React | Medium | External store + useSyncExternalStore from start |
| TypeScript strict errors pile up late | Medium | Shared types in Phase 0, check `tsc` each phase |
| WebSocket reconnect edge cases | Low | Seq-based resync is simple and robust |
| Performance panel adds overhead | Low | Refs only, no setState, 2fps display update |
| Zod validation too slow on hot path | Very low | Validation only on HTTP API, not WS messages |

---

## Key Libraries

| Library | Where | Why |
|---|---|---|
| `ws` | server | Lightweight WebSocket, no overhead |
| `zod` | server | Runtime validation + type inference |
| `vite` | client | Fast dev server, no CRA overhead |
| `react-window` | client | Virtual list for 20k units panel |
| (no Redux/Zustand) | client | Custom store is 30 lines, no boilerplate needed |

---

## Verification Plan

1. `cd server && npm run dev` — server starts on port 3001
2. `cd client && npm run dev` — client starts on port 5173
3. Open browser → dashboard loads with 20,000 dots on map
4. Watch dots move every second
5. Apply filters → units panel updates, no page freeze
6. DevTools Network → WS messages are small (~15KB/tick, not 1MB)
7. DevTools Elements → no 20k DOM nodes for units
8. DevTools Performance → FPS stays above 50
9. Kill server → client shows reconnect state → restart server → recovers
10. `tsc --noEmit` on both → zero errors
