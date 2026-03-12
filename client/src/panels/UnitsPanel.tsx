import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { FixedSizeList, type ListChildComponentProps } from 'react-window';
import type { Unit, UnitStatus } from '@shared/types';
import { unitsStore } from '../store/unitsStore';
import { filtersStore, type Filters } from '../store/filtersStore';

interface UnitStats {
  active: number;
  attacking: number;
  damaged: number;
  critical: number;
}

function computeStats(units: Unit[]): UnitStats {
  let active = 0;
  let attacking = 0;
  let damaged = 0;
  let critical = 0;
  for (const u of units) {
    if (u.status === 'active' || u.status === 'moving' || u.status === 'idle') active++;
    if (u.status === 'attacking') attacking++;
    if (u.health < 50) damaged++;
    if (u.health < 25) critical++;
  }
  return { active, attacking, damaged, critical };
}

const STATUS_OPTIONS: Array<{ value: Filters['status']; label: string }> = [
  { value: 'all',       label: 'All' },
  { value: 'active',    label: 'Active' },
  { value: 'attacking', label: 'Attacking' },
  { value: 'moving',    label: 'Moving' },
  { value: 'idle',      label: 'Idle' },
  { value: 'destroyed', label: 'Destroyed' },
];

function applyFilters(map: Map<string, Unit>, filters: Filters): Unit[] {
  const out: Unit[] = [];
  const nameLower = filters.name.toLowerCase();

  for (const u of map.values()) {
    if (filters.status !== 'all' && u.status !== filters.status) continue;
    if (u.health < filters.healthMin || u.health > filters.healthMax) continue;
    if (nameLower && !u.name.toLowerCase().includes(nameLower)) continue;
    out.push(u);
  }
  return out;
}

function healthColor(h: number): string {
  if (h > 60) return 'var(--color-success)';
  if (h > 25) return 'var(--color-warning)';
  return 'var(--color-critical)';
}

interface RowProps extends ListChildComponentProps {
  data: Unit[];
}

function UnitRow({ index, style, data }: RowProps) {
  const unit = data[index];
  if (!unit) return null;

  return (
    <div style={style} className="unit-row">
      <div className={`unit-team-dot ${unit.team}`} />
      <span className="unit-name">{unit.name}</span>
      <span className={`unit-status ${unit.status}`}>{unit.status}</span>
      <div>
        <div style={{ fontSize: 'var(--font-size-xs)', textAlign: 'right', color: healthColor(unit.health) }}>
          {unit.health}
        </div>
        <div className="health-bar-bg">
          <div
            className="health-bar-fill"
            style={{ width: `${unit.health}%`, background: healthColor(unit.health) }}
          />
        </div>
      </div>
    </div>
  );
}

export function UnitsPanel() {
  const filters = useSyncExternalStore(filtersStore.subscribe, filtersStore.getSnapshot);
  const filtersRef = useRef(filters);
  filtersRef.current = filters;

  const [units, setUnits] = useState<Unit[]>(() =>
    applyFilters(unitsStore.getMap(), filters)
  );

  // Re-filter on store update
  useEffect(() => {
    return unitsStore.subscribe(() => {
      setUnits(applyFilters(unitsStore.getMap(), filtersRef.current));
    });
  }, []);

  // Re-filter on filter change
  useEffect(() => {
    setUnits(applyFilters(unitsStore.getMap(), filters));
  }, [filters]);

  const listRef = useRef<HTMLDivElement>(null);
  const [listHeight, setListHeight] = useState(300);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      const entry = entries[0];
      if (entry) setListHeight(entry.contentRect.height);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const itemData = useMemo(() => units, [units]);

  return (
    <div className="panel units-panel">
      <div className="panel-header">
        <span className="panel-header-title">Units</span>
        <span className="kpi-sub">{units.length.toLocaleString()}</span>
      </div>

      <div className="filters-bar">
        <select
          className="filter-select"
          value={filters.status}
          onChange={e => filtersStore.set('status', e.target.value as UnitStatus | 'all')}
        >
          {STATUS_OPTIONS.map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>

        <input
          type="text"
          className="filter-input"
          placeholder="Search name..."
          value={filters.name}
          onChange={e => filtersStore.set('name', e.target.value)}
          style={{ flex: 1 }}
        />

        <input
          type="number"
          className="filter-input"
          placeholder="HP min"
          value={filters.healthMin}
          min={0} max={100}
          onChange={e => filtersStore.set('healthMin', Number(e.target.value))}
          style={{ width: 60 }}
        />
        <input
          type="number"
          className="filter-input"
          placeholder="HP max"
          value={filters.healthMax}
          min={0} max={100}
          onChange={e => filtersStore.set('healthMax', Number(e.target.value))}
          style={{ width: 60 }}
        />
      </div>

      <div ref={listRef} className="panel-body">
        <FixedSizeList
          height={listHeight}
          itemCount={units.length}
          itemSize={36}
          width="100%"
          itemData={itemData}
        >
          {UnitRow}
        </FixedSizeList>
      </div>
    </div>
  );
}
