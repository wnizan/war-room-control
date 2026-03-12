# Performance Panel — Quick Reference Guide

## At a Glance

The Performance Panel displays live metrics from browser APIs. It's automatically integrated and requires no configuration.

## Metrics Explained

```
┌─────────────────────────────────────┐
│ ▼ PERFORMANCE                       │
├─────────────────────────────────────┤
│ FPS              Frame time         │
│ 57 fps ✅        12.5 ms ✅         │
│                                     │
│ JS Heap          Update rate        │
│ 128 MB           45 Hz ✅           │
│                                     │
│ Long tasks                          │
│ 2 ⚠️                                │
└─────────────────────────────────────┘
```

| Metric | Meaning | Green | Yellow | Red |
|--------|---------|-------|--------|-----|
| **FPS** | Frames per second | ≥50 | 30–49 | <30 |
| **Frame time** | Time to render one frame | ≤20ms | 20–33ms | >33ms |
| **JS Heap** | JavaScript memory in use | N/A | N/A | N/A* |
| **Update rate** | Server tick messages/sec | ≥30 Hz | 15–29 Hz | <15 Hz |
| **Long tasks** | Tasks blocking >50ms | 0 | 1–5 | >5 |

*Chrome-only; shows "N/A" in other browsers

## Color Legend

- 🟢 **Green (ok):** Target performance achieved
- 🟡 **Orange (warn):** Degraded but playable
- 🔴 **Red (critical):** Poor performance, investigate

## What to Look For

### Good Performance
```
FPS: 60 fps (green)
Frame time: 16 ms (green)
Update rate: 45 Hz (green)
Long tasks: 0
```
→ Dashboard is smooth and responsive

### Degraded Performance
```
FPS: 35 fps (orange)
Frame time: 28 ms (orange)
Update rate: 20 Hz (orange)
Long tasks: 1–2
```
→ Playable, but not optimal. Check for:
- Heavy CPU load (other apps)
- Network latency (ping the server)
- Browser memory pressure (check DevTools)

### Poor Performance
```
FPS: 20 fps (red)
Frame time: 50 ms (red)
Update rate: 10 Hz (red)
Long tasks: 5+
```
→ Serious issue. Investigate:
- Backend tick calculation overhead
- Network packet loss or latency
- Browser memory leak (heap keeps growing)
- Canvas rendering bottleneck

## Troubleshooting

### FPS is low, but frame time looks OK?
→ Likely V-sync or browser frame skipping
→ Check if other tabs are active/consuming CPU

### Heap keeps growing?
→ Possible memory leak
→ Close and reopen Performance Panel (does heap reset?)
→ Force garbage collection in DevTools (trash icon)

### Update rate is low, but server logs show ticks being sent?
→ Network latency (check Network tab in DevTools)
→ WebSocket connection issue (check Connection status badge)
→ Server is throttling messages

### Long tasks keep appearing?
→ User input handlers taking too long
→ Map rendering is slow (canvas bottleneck)
→ Check Performance tab in DevTools for "long tasks" entry type

## Common Issues & Fixes

| Issue | Root Cause | Fix |
|-------|-----------|-----|
| FPS drops when map pans | Canvas rendering | Reduce unit count or simplify rendering |
| Frame time spikes to 50ms | Long task on main thread | Check server tick processing time |
| Update rate < 30 Hz | Network latency | Ping server; check connection |
| Heap grows indefinitely | Memory leak in app | Check for unreleased listeners/timers |
| Panel shows "N/A" for Heap | Using non-Chrome browser | Expected; no action needed |

## How to Use

### Collapse/Expand Panel
Click the **▼** button to toggle display (metrics continue running in background)

### Monitor During Testing
1. Open Performance Panel
2. Start simulation on server
3. Watch metrics update every second
4. Zoom/pan the map → observe FPS changes
5. Close units → observe memory impact

### Capture Baseline
Before submitting demo:
```
Expected metrics (with 20k units active):
- FPS: 50–60 (stable)
- Frame time: 16–20 ms
- Update rate: 30–60 Hz
- Long tasks: 0–1
- Heap: <500 MB (baseline + deltas)
```

## Technical Details

### Data Collection
- **Method:** Browser APIs only (no third-party tools)
- **Frequency:** Continuous (60fps potential)
- **Display:** ~2fps (500ms batches)

### Browser Support
| Browser | FPS | Frame time | Heap | Update rate | Long tasks |
|---------|-----|-----------|------|-------------|------------|
| Chrome | ✅ | ✅ | ✅ | ✅ | ✅ |
| Edge | ✅ | ✅ | ✅ | ✅ | ✅ |
| Firefox | ✅ | ✅ | ❌ | ✅ | ✅* |
| Safari | ✅ | ✅ | ❌ | ✅ | ⚠️ |

*May require browser settings; ⚠️ = Limited support

### Performance Cost
- **CPU:** <1% overhead at 60fps
- **Memory:** <1 KB for metric state
- **Network:** Zero additional requests (uses existing WebSocket)

## API Integration

For developers extending the observability system:

```typescript
// Import the hook
import { usePerformanceMetrics } from '../observability/usePerformanceMetrics';

// Use in any React component
function MyComponent() {
  const metrics = usePerformanceMetrics();

  // metrics.fps, metrics.frameTimeMs, metrics.heapSizeMb, etc.
  return <div>FPS: {metrics.fps}</div>;
}

// Record a tick (called automatically by wsClient)
import { recordTickUpdate } from '../observability/usePerformanceMetrics';
recordTickUpdate();  // Increment tick counter
```

## Caveats

1. **Frame time is noisy** — 1–2ms variance is normal at 60fps
2. **Heap size is a snapshot** — Not precise GC tracking
3. **Update rate depends on network** — Not just server performance
4. **500ms display lag** — Metrics are up to 500ms old on screen
5. **Long tasks omitted if unavailable** — Some contexts don't support `longtask` entryType

## Files Involved

- **Hook:** `/c/WAR ROOM CONTOL/client/src/observability/usePerformanceMetrics.ts`
- **UI Panel:** `/c/WAR ROOM CONTOL/client/src/panels/PerfPanel.tsx`
- **WebSocket integration:** `/c/WAR ROOM CONTOL/client/src/sync/wsClient.ts`
- **Styles:** `/c/WAR ROOM CONTOL/client/src/design/global.css` (perf-* classes)

## Questions?

See `/c/WAR ROOM CONTOL/DOC/OBSERVABILITY.md` for detailed documentation.
