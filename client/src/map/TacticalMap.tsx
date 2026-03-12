import { useEffect, useRef } from 'react';
import { unitsStore } from '../store/unitsStore';
import { selectionStore } from '../store/selectionStore';
import { startRenderLoop, setUnitScale } from './renderLoop';

export function TacticalMap() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const setSize = () => {
      const rect = canvas.getBoundingClientRect();
      canvas.width  = Math.floor(rect.width);
      canvas.height = Math.floor(rect.height);
    };
    setSize();

    const ro = new ResizeObserver(setSize);
    ro.observe(canvas);

    const stop = startRenderLoop(
      canvas,
      unitsStore.getMap,
      unitsStore.subscribe,
      selectionStore.getSnapshot,
      selectionStore.subscribe,
    );

    return () => {
      stop();
      ro.disconnect();
    };
  }, []);

  return (
    <div className="panel tactical-map-panel">
      <div className="panel-header">
        <span className="panel-header-title">Tactical Map</span>
        <span className="kpi-sub">20,000 units</span>
      </div>
      <div className="map-container">
        <canvas ref={canvasRef} className="tactical-map-canvas" />
        <div className="map-controls">
          <label className="map-control-label">Units</label>
          <input
            type="range"
            min="0.5"
            max="2"
            step="0.25"
            defaultValue="1"
            onChange={(e) => setUnitScale(parseFloat(e.target.value))}
          />
        </div>
      </div>
      <div className="map-legend">
        <div className="legend-item">
          <div className="legend-dot" style={{ background: '#3b82f6' }} />
          <span>Alpha</span>
        </div>
        <div className="legend-item">
          <div className="legend-dot" style={{ background: '#ef4444' }} />
          <span>Bravo</span>
        </div>
        <div className="legend-item">
          <div className="legend-dot" style={{ background: '#f97316' }} />
          <span>Damaged</span>
        </div>
        <div className="legend-item">
          <div className="legend-dot" style={{ background: '#f59e0b' }} />
          <span>Attacking</span>
        </div>
        <div className="legend-item">
          <div className="legend-dot" style={{ background: 'rgba(80,80,90,0.8)' }} />
          <span>Destroyed</span>
        </div>
        <div className="legend-item">
          <div className="legend-dot" style={{ background: 'rgba(239,68,68,0.4)' }} />
          <span>Combat Zone</span>
        </div>
        <div className="legend-item">
          <div className="legend-diamond legend-diamond--alpha" />
          <span>Alpha Base</span>
        </div>
        <div className="legend-item">
          <div className="legend-diamond legend-diamond--bravo" />
          <span>Bravo Base</span>
        </div>
      </div>
    </div>
  );
}
