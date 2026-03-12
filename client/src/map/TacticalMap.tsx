import { useEffect, useRef } from 'react';
import { unitsStore } from '../store/unitsStore';
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

    const stop = startRenderLoop(canvas, unitsStore.getMap, unitsStore.subscribe);

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
    </div>
  );
}
