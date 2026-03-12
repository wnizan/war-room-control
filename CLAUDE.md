# War Room Control — Claude Instructions

## Project
Full-stack real-time battlefield dashboard. 20,000 units, live updates, Canvas map.
**Server:** Node.js + TypeScript | **Client:** React + TypeScript

---

## Non-Negotiable Rules
- TypeScript strict mode everywhere — **ZERO `any`**
- No DOM rendering of units — **Canvas only**
- Client receives **deltas only** — never full 20k refetch
- Performance panel uses **browser APIs only** — no third-party tools
- Validate all server query parameters with **Zod**

---

## Agent Responsibilities

| Agent | When to use |
|---|---|
| `architect-agent` | Transport/contracts/folder structure decisions |
| `backend-simulation-agent` | Any server code |
| `frontend-sync-agent` | Store, WebSocket client, delta merge |
| `map-rendering-agent` | Canvas component |
| `ui-panels-agent` | KPI, units list, event feed, filters |
| `observability-agent` | Performance panel |
| `qa-perf-agent` | Before any demo or submission |
| `readme-review-agent` | Final README + review prep |
| `design-system-agent` | Design tokens or component guidelines |

---

## Key Skills (load when relevant)

| Skill | Use when |
|---|---|
| `hard-requirements` | Writing any code — check constraints |
| `data-contracts` | Defining or using TypeScript interfaces |
| `realtime-architecture` | WebSocket, snapshot, delta, reconnect |
| `typescript-strict-mode` | TypeScript patterns, Zod validation |
| `react-performance` | Store, memoization, virtualization |
| `canvas-rendering` | Map component, dirty flag, hit-testing |
| `design-system-dark-dashboard` | Colors, tokens, spacing, components |
| `browser-observability` | FPS, heap, RAF patterns |
| `review-defense` | Trade-off Q&A, reviewer preparation |

---

## Folder Structure

```
war-room-control/
├── shared/types.ts         ← single source of truth for all interfaces
├── server/src/
│   ├── simulation/         ← unit generation + tick loop
│   ├── transport/          ← WebSocket server
│   └── api/                ← HTTP endpoints + Zod validation
└── client/src/
    ├── store/              ← external unit store (Map<id, Unit>)
    ├── sync/               ← WebSocket client + snapshot/delta merge
    ├── map/                ← Canvas render loop (outside React)
    ├── panels/             ← KPI, units list, event feed, perf panel
    └── design/             ← CSS tokens + global styles
```

---

## Implementation Phases

| Phase | What | Agent |
|---|---|---|
| 0 | Scaffold, shared types, CLAUDE.md | (manual) |
| 1 | Backend simulation + WebSocket server | `backend-simulation-agent` |
| 2 | Frontend store + WebSocket sync | `frontend-sync-agent` |
| 3 | Design system (parallel with 1+2) | `design-system-agent` |
| 4 | Canvas map rendering | `map-rendering-agent` |
| 5 | UI panels (KPI, units, events) | `ui-panels-agent` |
| 6 | Observability / performance panel | `observability-agent` |
| 7 | QA + performance validation | `qa-perf-agent` |
| 8 | README + review prep | `readme-review-agent` |

---

## Validation Gates (before moving to next phase)
- `tsc --noEmit` passes with **zero errors**
- WS delta messages **< 20KB/tick** (check DevTools Network)
- **No 20k DOM nodes** for units (check DevTools Elements)
- FPS stays **above 50** during active simulation
