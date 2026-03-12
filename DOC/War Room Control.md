# War Room Control — Full Stack Take-Home Exercise

## The Task

Build a live battle dashboard that tracks a simulated battlefield of **20,000 units** in real time.

The server runs a simulation that continuously mutates units (movement, attacks, healing). The client visualises the battlefield as it evolves — no page refresh required.

> **AI tools are allowed and encouraged.** Use whatever tools help you work effectively.  
> The important part is that you understand and can explain the decisions and code you submit.

This exercise focuses on **data modeling, synchronization, rendering performance, and architectural trade-offs**.


## What You're Building

### Server (Node.js + TypeScript)

- Generate **20,000 units** at startup (two teams, random positions, health 0–100).
- Run a simulation tick every second:
  - Randomly move, attack, or idle ~200–350 units per tick.
- Expose an API that allows the client to receive live updates.
- Validate all incoming query parameters.
- Use TypeScript strictly — no `any`.

You may choose your transport strategy (polling, SSE, WebSocket, etc.).  
Be prepared to justify your decision.

---

### Client (React + TypeScript)

- A filterable, searchable list of units with:
  - Status
  - Health range filtering
  - Name search
- A 2D tactical map showing all **20,000 unit positions** as live dots.
- A live event feed (attacks, destroyed, captures).
- Top-level KPIs:
  - Units alive
  - Destroyed count
  - Zone control (define your own simple logic)

#### Performance Monitor Panel

Add a live performance panel that displays:

- FPS
- Frame time
- JavaScript heap usage
- API latency
- Store update rate

The panel must:

- Source its data entirely from **browser APIs**:
  - `requestAnimationFrame` for FPS
  - `PerformanceObserver` for long tasks and API latency
  - `performance.memory` for heap usage (where available)
- Not negatively impact the rest of the app when open.

The panel should make it immediately obvious whether the app is healthy or under stress.

---

## Hard Requirements

- The map must render all 20,000 units smoothly.
  - **DOM rendering (20k divs) is not acceptable.**
- The client must not re-fetch all 20,000 units on every update — only changes.
- The units panel must support filtering by status, health range, and name search.
- TypeScript on both client and server — no `any`.
- The performance panel must not introduce measurable performance degradation.

---

## What We're Evaluating

Working code is the baseline. We’re primarily evaluating:

- **Data architecture** — how you model and store 20k units.
- **Update strategy** — how you synchronize only what changed.
- **Rendering approach** — how you handle 20k visual elements at 60fps.
- **Observability** — can you instrument your app without third-party monitoring tools.
- **Library choices** — what you choose and why.
- **Code structure** — separation of concerns, naming, readability.
- **Trade-off reasoning** — your ability to explain architectural decisions.

Be prepared to walk through and defend your decisions during the review call.

---

## Scope Guidance

This is not a production system. We value:

- Clear thinking
- Sound architecture
- Performance awareness
- Well-reasoned trade-offs

You do **not** need to implement:

- Authentication
- Persistence/database storage
- Deployment setup
- Pixel-perfect UI styling

Focus on correctness, performance, and clarity.

---

## Deliverables

- A GitHub repository with:
  - `server/`
  - `client/`
- A `README.md` including:
  - Setup instructions
  - A section titled **"Architecture Decisions"**
    - Bullet points explaining your key choices and trade-offs
- Both apps runnable locally with a single command each.

---

## Constraints

- Any libraries or tools may be used.
- The exercise assumes a **Node.js + TypeScript server** and a **React + TypeScript client**, but you may deviate if you have a strong reason.
---

We care more about architectural clarity and reasoning than UI polish.  
Make thoughtful choices and be ready to explain them.