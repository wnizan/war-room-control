import { useEffect, useRef } from 'react';
import { unitsStore } from '../store/unitsStore';
import { selectionStore } from '../store/selectionStore';
import { startRenderLoop, setUnitScale, setZoom, resetZoom, panViewport, getZoom } from './renderLoop';

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

    // Drag-to-pan
    const cv: HTMLCanvasElement = canvas;
    let dragging = false;
    let lastX = 0;
    let lastY = 0;

    function onPointerDown(e: PointerEvent): void {
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
      cv.setPointerCapture(e.pointerId);
      cv.style.cursor = 'grabbing';
    }

    function onPointerMove(e: PointerEvent): void {
      if (!dragging) return;
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      const zoom = getZoom();
      panViewport(-(dx / (cv.width * zoom)), -(dy / (cv.height * zoom)));
    }

    function onPointerUp(): void {
      dragging = false;
      cv.style.cursor = 'grab';
    }

    cv.style.cursor = 'grab';
    cv.addEventListener('pointerdown', onPointerDown);
    cv.addEventListener('pointermove', onPointerMove);
    cv.addEventListener('pointerup', onPointerUp);
    cv.addEventListener('pointerleave', onPointerUp);

    return () => {
      stop();
      ro.disconnect();
      cv.removeEventListener('pointerdown', onPointerDown);
      cv.removeEventListener('pointermove', onPointerMove);
      cv.removeEventListener('pointerup', onPointerUp);
      cv.removeEventListener('pointerleave', onPointerUp);
    };
  }, []);

  return (
    <div className="panel tactical-map-panel">
      <div className="panel-header">
        <span className="panel-header-title">Tactical Map</span>
        <span className="kpi-sub">20,000 units</span>
      </div>
      <div className="map-container">
        <canvas
          ref={canvasRef}
          className="tactical-map-canvas"
          onWheel={e => { e.preventDefault(); setZoom(e.deltaY < 0 ? 0.15 : -0.15); }}
        />
        <div className="map-controls">
          <label className="map-control-label">Size</label>
          <input
            type="range"
            min="0.5"
            max="2"
            step="0.25"
            defaultValue="1"
            onChange={(e) => setUnitScale(parseFloat(e.target.value))}
          />
          <div className="zoom-controls">
            <button className="zoom-btn" onClick={() => setZoom(0.25)}>+</button>
            <button className="zoom-btn" onClick={resetZoom}>⌂</button>
            <button className="zoom-btn" onClick={() => setZoom(-0.25)}>−</button>
          </div>
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
