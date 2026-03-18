# Victory Modal — Design Spec
Date: 2026-03-18

## Overview
A victory modal that appears when one team wins the simulation. Triggered when either all units of one team are destroyed, or one team achieves ≥100% zone control. The dashboard continues to run in the background with a blur overlay.

## Win Conditions (evaluated in order on every KPI update)
1. `aliveAlpha === 0 && aliveBravo > 0` → Bravo wins (reason: `'eliminated'`)
2. `aliveBravo === 0 && aliveAlpha > 0` → Alpha wins (reason: `'eliminated'`)
3. `aliveAlpha === 0 && aliveBravo === 0` → **Draw** — no modal shown, no winner
4. `zoneControl.alpha >= 100 && zoneControl.bravo >= 100` → **Draw** — no modal (server should prevent this but we guard it)
5. `zoneControl.alpha >= 100` → Alpha wins (reason: `'zone_control'`)
6. `zoneControl.bravo >= 100` → Bravo wins (reason: `'zone_control'`)

Use `>= 100` (not `=== 100`) to handle floating-point server values. First condition met fires. Once a winner is set, subsequent ticks are ignored until `reset()`.

## TypeScript Interfaces

```ts
// VictoryState — captured once at win moment
interface VictoryState {
  winner: UnitTeam;                 // 'alpha' | 'bravo'
  reason: 'eliminated' | 'zone_control';
  elapsedMs: number;                // Date.now() - simulationStartTime
  aliveAlpha: number;
  aliveBravo: number;
  destroyedAlpha: number;
  destroyedBravo: number;
  zoneControl: ZoneControl;
  byTypeAlpha: Record<UnitType, { alive: number; destroyed: number }>;
  byTypeBravo: Record<UnitType, { alive: number; destroyed: number }>;
}

// VictoryModalProps
interface VictoryModalProps {
  victory: VictoryState;
  onNewSimulation: () => void;
}
```

## Architecture

### `client/src/sync/wsClient.ts` — add start time tracking
Add:
```ts
let _simulationStartTime: number | null = null;
export function getSimulationStartTime(): number | null { return _simulationStartTime; }
```
Set `_simulationStartTime = Date.now()` when first snapshot is received (and on every subsequent snapshot — restarts send a new snapshot). This resets timing correctly across restarts.

### `client/src/store/victoryStore.ts`
Subscribes to `kpiStore`. On each KPI update:
1. If `_victory !== null`, skip (already won).
2. Check win conditions in order.
3. On win: call `unitsStore.getMap()` to compute per-type breakdown — iterate all units, classify by team+type+status.
4. Per-type records must be initialized before iteration:
   ```ts
   const initByType = (): Record<UnitType, { alive: number; destroyed: number }> => ({
     infantry: { alive: 0, destroyed: 0 },
     vehicle:  { alive: 0, destroyed: 0 },
     air:      { alive: 0, destroyed: 0 },
   });
   ```
5. Capture `elapsedMs`. At this point `getSimulationStartTime()` is guaranteed non-null (a KPI update can only arrive after a snapshot). Use: `elapsedMs = Date.now() - getSimulationStartTime()!` — if somehow null, fall back to `0` and log a warning.
6. Store `VictoryState`, notify listeners.

Exposes:
- `getVictory(): VictoryState | null`
- `subscribe(listener: () => void): () => void`
- `reset(): void` — sets `_victory = null`, notifies listeners

### `client/src/panels/VictoryModal.tsx`
Pure display component. Props: `VictoryModalProps`.

Layout (top to bottom):
- `/WR_ICON.png` logo (64px, centered)
- "VICTORY" heading (2.5rem, bold, winner's team color)
- Winner team name + win reason badge
- Stats grid (2-column):
  - Time elapsed (formatted as mm:ss)
  - Units remaining: Alpha N | Bravo N
  - Units destroyed: Alpha N | Bravo N
  - Zone control: Alpha X% | Bravo X%
- By-type table (3 rows × 5 cols: Type | Alpha Alive | Alpha Destroyed | Bravo Alive | Bravo Destroyed)
- "New Simulation" button (full width, primary style)

### `client/src/App.tsx`
- `useSyncExternalStore(victoryStore.subscribe, victoryStore.getVictory)`
- Renders `<VictoryModal>` when `victory !== null`
- `onNewSimulation`:
  1. `setShowRestart(true)` — opens RestartDialog
  - **Do NOT call `victoryStore.reset()` here**
- `victoryStore.reset()` is called **only** from `RestartDialog.handleConfirm` (after confirmed POST), not on cancel/close.
- The new snapshot from the server (post-restart) will naturally arrive and the store remains in "won" state until `reset()` is called on confirmed restart. This prevents the modal re-appearing on the same data.

## Styling
- Backdrop: fixed overlay, `rgba(0,0,0,0.75)` + `backdrop-filter: blur(4px)`, z-index above all panels
- Modal card: `--color-surface`, `border-radius: 12px`, `max-width: 520px`, centered, padding 2rem
- "VICTORY" heading: alpha → `--color-alpha`, bravo → `--color-bravo`
- Stats grid: muted label color, bright value color, 0.75rem gap
- By-type table: compact, `font-size: 0.8rem`, alternating row backgrounds
- "New Simulation" CTA: full width, `--color-primary` background

## No New Dependencies
All logic uses existing stores (`kpiStore`, `unitsStore`), `wsClient`, and browser APIs only.
