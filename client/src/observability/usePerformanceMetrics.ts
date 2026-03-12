/**
 * usePerformanceMetrics — Performance monitoring hook for War Room Control
 *
 * Collects browser-level metrics:
 * - FPS (via requestAnimationFrame)
 * - Frame time (delta between consecutive frames)
 * - JS Heap size (performance.memory, Chrome-only)
 * - Update rate (TickUpdate messages per second)
 * - Long tasks (PerformanceObserver, if available)
 *
 * Metrics are stored in refs (no state) to avoid triggering rerenders.
 * Display updates happen at ~2fps via a separate RAF loop to minimize overhead.
 */

import { useEffect, useRef, useState } from 'react';

// --- Type Definitions ---

export interface PerformanceMetrics {
  fps: number | null;
  frameTimeMs: number | null;
  heapSizeMb: number | null;
  updateRateHz: number | null;
  longTaskCount: number;
}

// --- Metric Collection State (refs, not state) ---

interface MetricState {
  fps: number | null;
  frameTimeMs: number | null;
  heapSizeMb: number | null;
  updateRateHz: number | null;
  longTaskCount: number;

  // FPS tracking
  frameCount: number;
  lastFpsTime: number;

  // Frame time tracking
  lastFrameTime: number;

  // Tick update tracking
  tickCount: number;
  lastTickTime: number;

  // RAF loop active flag
  rafActive: boolean;
}

// Global metric state (shared across all hook instances)
let globalMetrics: MetricState = {
  fps: null,
  frameTimeMs: null,
  heapSizeMb: null,
  updateRateHz: null,
  longTaskCount: 0,
  frameCount: 0,
  lastFpsTime: performance.now(),
  lastFrameTime: performance.now(),
  tickCount: 0,
  lastTickTime: performance.now(),
  rafActive: false,
};

// Callbacks for tick updates
let tickUpdateCallbacks = new Set<(count: number) => void>();

// --- Public API for wsClient to call ---

export function recordTickUpdate(): void {
  globalMetrics.tickCount += 1;
}

export function onTickUpdateCount(cb: (count: number) => void): () => void {
  tickUpdateCallbacks.add(cb);
  return () => { tickUpdateCallbacks.delete(cb); };
}

// --- RAF Loop (core metric collection) ---

function startRafLoop(): void {
  if (globalMetrics.rafActive) return;
  globalMetrics.rafActive = true;

  function fpsAndFrameTimeLoop(now: number): void {
    if (!globalMetrics.rafActive) return;

    // FPS calculation
    globalMetrics.frameCount++;
    const fpsDelta = now - globalMetrics.lastFpsTime;
    if (fpsDelta >= 1000) {
      globalMetrics.fps = Math.round(
        (globalMetrics.frameCount * 1000) / fpsDelta
      );
      globalMetrics.frameCount = 0;
      globalMetrics.lastFpsTime = now;
    }

    // Frame time (milliseconds since last frame)
    globalMetrics.frameTimeMs = now - globalMetrics.lastFrameTime;
    globalMetrics.lastFrameTime = now;

    // Heap size (Chrome-only)
    const perfMemory = (performance as { memory?: { usedJSHeapSize: number } })
      .memory;
    if (perfMemory) {
      globalMetrics.heapSizeMb = Math.round(
        perfMemory.usedJSHeapSize / 1_048_576
      );
    }

    // Update rate (ticks per second)
    const tickDelta = now - globalMetrics.lastTickTime;
    if (tickDelta >= 1000) {
      globalMetrics.updateRateHz = Math.round(
        (globalMetrics.tickCount * 1000) / tickDelta
      );
      globalMetrics.tickCount = 0;
      globalMetrics.lastTickTime = now;

      // Notify tick callbacks
      for (const cb of tickUpdateCallbacks) {
        cb(globalMetrics.updateRateHz);
      }
    }

    requestAnimationFrame(fpsAndFrameTimeLoop);
  }

  requestAnimationFrame(fpsAndFrameTimeLoop);
}

// --- Long Tasks (PerformanceObserver) ---

function startLongTaskObserver(): void {
  if (!('PerformanceObserver' in window)) {
    console.debug('[perf] PerformanceObserver not available');
    return;
  }

  try {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.duration > 50) {
          globalMetrics.longTaskCount++;
        }
      }
    });

    // Try to observe longtask (may fail due to permissions)
    try {
      observer.observe({ entryTypes: ['longtask'] });
    } catch (e) {
      // longtask not available in this context
      console.debug('[perf] longtask entryType not available');
    }
  } catch (e) {
    console.debug('[perf] PerformanceObserver setup failed');
  }
}

// --- Hook ---

export function usePerformanceMetrics(): PerformanceMetrics {
  const [metrics, setMetrics] = useState<PerformanceMetrics>({
    fps: null,
    frameTimeMs: null,
    heapSizeMb: null,
    updateRateHz: null,
    longTaskCount: 0,
  });

  const displayRefreshTimerRef = useRef<ReturnType<typeof requestAnimationFrame> | null>(
    null
  );
  const isFirstRunRef = useRef(true);

  useEffect(() => {
    // Initialize metric collection on first run
    if (isFirstRunRef.current) {
      isFirstRunRef.current = false;
      startRafLoop();
      startLongTaskObserver();
    }

    // Display update loop (refreshes at ~2fps to minimize component rerenders)
    function displayUpdateLoop(): void {
      setMetrics({
        fps: globalMetrics.fps,
        frameTimeMs: globalMetrics.frameTimeMs,
        heapSizeMb: globalMetrics.heapSizeMb,
        updateRateHz: globalMetrics.updateRateHz,
        longTaskCount: globalMetrics.longTaskCount,
      });

      // Schedule next update in ~500ms (2fps)
      displayRefreshTimerRef.current = setTimeout(() => {
        displayUpdateLoop();
      }, 500);
    }

    displayUpdateLoop();

    return () => {
      if (displayRefreshTimerRef.current !== null) {
        clearTimeout(displayRefreshTimerRef.current);
      }
    };
  }, []);

  return metrics;
}
