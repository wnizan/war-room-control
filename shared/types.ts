// =============================================================================
// War Room Control — Shared Types
// Single source of truth. Import from both server and client.
// =============================================================================

// --- Unit -------------------------------------------------------------------

export type UnitStatus = 'active' | 'attacking' | 'moving' | 'idle' | 'destroyed';
export type UnitTeam = 'alpha' | 'bravo';
export type UnitType = 'infantry' | 'vehicle' | 'air';

export interface Unit {
  id: string;
  name: string;
  type: UnitType;
  team: UnitTeam;
  status: UnitStatus;
  health: number; // 0–100
  x: number;     // 0–1 normalized
  y: number;     // 0–1 normalized
}

// --- Delta Update -----------------------------------------------------------

export interface UnitDelta {
  id: string;
  status?: UnitStatus;
  health?: number;
  x?: number;
  y?: number;
}

export interface TickUpdate {
  seq: number;
  timestamp: number;
  units: UnitDelta[];
  events: GameEvent[];
  kpi: KPISummary;
}

// --- Events -----------------------------------------------------------------

export type GameEventType = 'attack' | 'destroyed' | 'capture' | 'heal';

export interface GameEvent {
  id: string;
  type: GameEventType;
  timestamp: number;
  sourceId?: string;
  targetId?: string;
  detail?: string;
}

// --- KPI --------------------------------------------------------------------

export interface ZoneControl {
  alpha: number; // percentage 0–100
  bravo: number;
}

export interface KPISummary {
  seq: number;
  aliveAlpha: number;
  aliveBravo: number;
  destroyedAlpha: number;
  destroyedBravo: number;
  zoneControl: ZoneControl;
}

// --- Transport Envelope -----------------------------------------------------

export interface SnapshotMessage {
  type: 'snapshot';
  seq: number;
  units: Unit[];
  kpi: KPISummary;
}

export type ServerMessage =
  | { type: 'snapshot'; payload: SnapshotMessage }
  | { type: 'tick';     payload: TickUpdate }
  | { type: 'error';    payload: { message: string } };
