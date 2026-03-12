import { useEffect, useState } from 'react';
import './design/tokens.css';
import './design/global.css';
import { startSync, getConnectionStatus, onConnectionStatus, type ConnectionStatus } from './sync/wsClient';
import { KpiStrip } from './panels/KpiStrip';
import { TacticalMap } from './map/TacticalMap';
import { UnitsPanel } from './panels/UnitsPanel';
import { EventFeed } from './panels/EventFeed';
import { PerfPanel } from './panels/PerfPanel';

function useConnectionStatus(): ConnectionStatus {
  const [status, setStatus] = useState<ConnectionStatus>(getConnectionStatus);
  useEffect(() => onConnectionStatus(setStatus), []);
  return status;
}

export default function App() {
  const connStatus = useConnectionStatus();

  useEffect(() => {
    startSync();
  }, []);

  return (
    <div className="app">
      <div className="kpi-row">
        <KpiStrip />
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
    </div>
  );
}
