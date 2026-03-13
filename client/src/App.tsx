import { useEffect, useRef, useState } from 'react';
import './design/tokens.css';
import './design/global.css';
import { startSync, getConnectionStatus, onConnectionStatus, type ConnectionStatus } from './sync/wsClient';
import { KpiStrip } from './panels/KpiStrip';
import { TacticalMap } from './map/TacticalMap';
import { UnitsPanel } from './panels/UnitsPanel';
import { EventFeed } from './panels/EventFeed';
import { PerfPanel } from './panels/PerfPanel';

const API_BASE = import.meta.env.DEV ? 'http://localhost:3001' : '';

function useConnectionStatus(): ConnectionStatus {
  const [status, setStatus] = useState<ConnectionStatus>(getConnectionStatus);
  useEffect(() => onConnectionStatus(setStatus), []);
  return status;
}

// ── Restart dialog ─────────────────────────────────────────────────────────────

interface RestartDialogProps {
  onClose: () => void;
}

function RestartDialog({ onClose }: RestartDialogProps) {
  const [alphaRatio, setAlphaRatio] = useState(50); // 0–100 displayed as %
  const [busy, setBusy] = useState(false);
  const overlayRef = useRef<HTMLDivElement>(null);

  function handleOverlayClick(e: React.MouseEvent<HTMLDivElement>) {
    if (e.target === overlayRef.current) onClose();
  }

  async function handleConfirm() {
    setBusy(true);
    try {
      await fetch(`${API_BASE}/api/restart`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ alphaRatio: alphaRatio / 100 }),
      });
    } catch (err) {
      console.error('[restart] fetch failed', err);
    } finally {
      setBusy(false);
      onClose();
    }
  }

  const bravoRatio = 100 - alphaRatio;

  return (
    <div className="restart-overlay" ref={overlayRef} onClick={handleOverlayClick}>
      <div className="restart-dialog" role="dialog" aria-modal="true" aria-label="Restart simulation">
        <div className="restart-dialog-header">
          <img src="/WR_ICON.png" alt="" className="restart-dialog-icon" />
          <span className="restart-dialog-title">Restart Simulation</span>
          <button className="restart-close-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="restart-dialog-body">
          <p className="restart-description">
            Regenerate all {(20000).toLocaleString()} units with the selected team split.
            All positions and health will reset.
          </p>

          <div className="restart-ratio-row">
            <span className="restart-team-label alpha-label">Alpha {alphaRatio}%</span>
            <input
              type="range"
              min={10}
              max={90}
              value={alphaRatio}
              onChange={e => setAlphaRatio(Number(e.target.value))}
              className="restart-slider"
              aria-label="Alpha team ratio"
            />
            <span className="restart-team-label bravo-label">Bravo {bravoRatio}%</span>
          </div>

          <div className="restart-bar">
            <div className="restart-bar-alpha" style={{ width: `${alphaRatio}%` }} />
            <div className="restart-bar-bravo" style={{ width: `${bravoRatio}%` }} />
          </div>
        </div>

        <div className="restart-dialog-footer">
          <button className="restart-btn-cancel" onClick={onClose}>Cancel</button>
          <button className="restart-btn-confirm" onClick={handleConfirm} disabled={busy}>
            {busy ? 'Restarting…' : 'Restart'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── App ────────────────────────────────────────────────────────────────────────

export default function App() {
  const connStatus = useConnectionStatus();
  const [showRestart, setShowRestart] = useState(false);

  useEffect(() => {
    startSync();
  }, []);

  return (
    <div className="app">
      <header className="app-header">
        <div className="app-header-left">
          <div className="app-header-title-block">
            <span className="app-header-title">War Room Control</span>
            <span className="app-header-subtitle">Battlefield Operations Dashboard</span>
          </div>
        </div>
        <img src="/WR_ICON.png" alt="War Room" className="app-header-icon" />
      </header>
      <div className="kpi-row">
        <KpiStrip />
        <button className="restart-trigger-btn" onClick={() => setShowRestart(true)} title="Restart simulation">
          ↺ Restart
        </button>
        <span className={`conn-badge ${connStatus}`}>{connStatus}</span>
      </div>
      <div className="main-grid">
        <TacticalMap />
        <div className="side-panels">
          <UnitsPanel />
          <EventFeed />
          <PerfPanel />
        </div>
      </div>

      {showRestart && <RestartDialog onClose={() => setShowRestart(false)} />}
    </div>
  );
}
