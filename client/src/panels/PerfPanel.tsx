/**
 * PerfPanel — Performance monitoring UI for War Room Control
 *
 * Displays live metrics from usePerformanceMetrics hook.
 * Collapsible to minimize space when not needed.
 * Metric updates happen at ~2fps (via hook) to minimize visual jitter.
 *
 * Metrics displayed:
 * - FPS: frames per second (target >= 50)
 * - Frame time: milliseconds per frame (target <= 20ms)
 * - JS Heap: JavaScript heap size in MB (Chrome-only, shows "N/A" otherwise)
 * - Update rate: server tick updates per second
 */

import { useState } from 'react';
import { usePerformanceMetrics } from '../observability/usePerformanceMetrics';

function getMetricClass(
  metric: string,
  value: number | null
): 'ok' | 'warn' | 'critical' | null {
  if (value === null) return null;

  switch (metric) {
    case 'fps':
      return value >= 50 ? 'ok' : value >= 30 ? 'warn' : 'critical';
    case 'frameTime':
      return value <= 20 ? 'ok' : value <= 33 ? 'warn' : 'critical';
    case 'updateRate':
      return value >= 1 ? 'ok' : value >= 0.5 ? 'warn' : 'critical';
    case 'apiLatency':
      return value <= 50 ? 'ok' : value <= 200 ? 'warn' : 'critical';
    default:
      return null;
  }
}

function formatValue(metric: string, value: number | null): string {
  if (value === null) return 'N/A';

  switch (metric) {
    case 'fps':
      return `${value} fps`;
    case 'frameTime':
      return `${value.toFixed(1)} ms`;
    case 'heapSize':
      return `${value} MB`;
    case 'updateRate':
      return `${value.toFixed(1)} t/s`;
    case 'apiLatency':
      return `${Math.round(value)} ms`;
    default:
      return String(value);
  }
}

export function PerfPanel() {
  const [isOpen, setIsOpen] = useState(true);
  const metrics = usePerformanceMetrics();

  const fpsClass = getMetricClass('fps', metrics.fps);
  const frameTimeClass = getMetricClass('frameTime', metrics.frameTimeMs);
  const updateRateClass = getMetricClass('updateRate', metrics.updateRateHz);
  const apiLatencyClass = getMetricClass('apiLatency', metrics.apiLatencyMs);

  return (
    <div className="panel perf-panel">
      <div className="panel-header perf-panel-header">
        <button
          className="perf-toggle-btn"
          onClick={() => setIsOpen(!isOpen)}
          aria-label={isOpen ? 'Collapse performance panel' : 'Expand performance panel'}
        >
          <span className={`perf-toggle-icon ${isOpen ? 'open' : 'closed'}`}>
            ▼
          </span>
        </button>
        <span className="panel-header-title">Performance</span>
      </div>

      {isOpen && (
        <div className="perf-grid">
          <div className="perf-metric">
            <span className="perf-metric-label">FPS</span>
            <span className={`perf-metric-value ${fpsClass || ''}`}>
              {formatValue('fps', metrics.fps)}
            </span>
          </div>

          <div className="perf-metric">
            <span className="perf-metric-label">Frame time</span>
            <span className={`perf-metric-value ${frameTimeClass || ''}`}>
              {formatValue('frameTime', metrics.frameTimeMs)}
            </span>
          </div>

          <div className="perf-metric">
            <span className="perf-metric-label">JS Heap</span>
            <span className="perf-metric-value">
              {formatValue('heapSize', metrics.heapSizeMb)}
            </span>
          </div>

          <div className="perf-metric">
            <span className="perf-metric-label">Update rate</span>
            <span className={`perf-metric-value ${updateRateClass || ''}`}>
              {formatValue('updateRate', metrics.updateRateHz)}
            </span>
          </div>

          <div className="perf-metric">
            <span className="perf-metric-label">API latency</span>
            <span className={`perf-metric-value ${apiLatencyClass || ''}`}>
              {formatValue('apiLatency', metrics.apiLatencyMs)}
            </span>
          </div>

          <div className="perf-metric">
            <span className="perf-metric-label">Long tasks /5s</span>
            <span className={`perf-metric-value ${metrics.longTasksLast5s === 0 ? 'ok' : metrics.longTasksLast5s <= 3 ? 'warn' : 'critical'}`}>
              {metrics.longTasksLast5s}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
