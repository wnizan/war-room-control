import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { FixedSizeList, type ListChildComponentProps } from 'react-window';
import type { Unit, UnitStatus, UnitTeam } from '@shared/types';
import { unitsStore } from '../store/unitsStore';
import { filtersStore, type Filters } from '../store/filtersStore';
import { selectionStore } from '../store/selectionStore';

const TEAM_OPTIONS: Array<{ value: Filters['team']; label: string }> = [
  { value: 'all',   label: 'All Teams' },
  { value: 'alpha', label: 'Alpha' },
  { value: 'bravo', label: 'Bravo' },
];

const STATUS_OPTIONS: Array<{ value: Filters['status']; label: string }> = [
  { value: 'all',       label: 'All' },
  { value: 'active',    label: 'Active' },
  { value: 'attacking', label: 'Attacking' },
  { value: 'moving',    label: 'Moving' },
  { value: 'idle',      label: 'Idle' },
  { value: 'destroyed', label: 'Destroyed' },
];

const UNITS_LIST_LIMIT = 500;

function applyFilters(map: Map<string, Unit>, filters: Filters): Unit[] {
  const out: Unit[] = [];
  const nameLower = filters.name.toLowerCase();
  const filtered = filters.team !== 'all' || filters.status !== 'all' ||
    filters.healthMin > 0 || filters.healthMax < 100 || nameLower.length > 0;

  for (const u of map.values()) {
    if (filters.team   !== 'all' && u.team   !== filters.team)   continue;
    if (filters.status !== 'all' && u.status !== filters.status) continue;
    if (u.health < filters.healthMin || u.health > filters.healthMax) continue;
    if (nameLower && !u.name.toLowerCase().includes(nameLower)) continue;
    out.push(u);
    // Cap unfiltered list to avoid heavy React reconciliation on 20k items
    if (!filtered && out.length >= UNITS_LIST_LIMIT) break;
  }
  return out;
}

function healthColor(h: number): string {
  if (h > 60) return 'var(--color-success)';
  if (h > 25) return 'var(--color-warning)';
  return 'var(--color-critical)';
}

interface RowData {
  units: Unit[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

function UnitRow({ index, style, data }: ListChildComponentProps<RowData>) {
  const unit = data.units[index];
  if (!unit) return null;
  const isSelected = unit.id === data.selectedId;

  return (
    <div
      style={style}
      className={'unit-row' + (isSelected ? ' unit-row-selected' : '')}
      onClick={() => data.onSelect(unit.id)}
    >
      <div className={'unit-team-dot ' + unit.team} />
      <span className="unit-name">{unit.name}</span>
      <span className={'unit-status ' + unit.status}>{unit.status}</span>
      <div>
        <div style={{ fontSize: 'var(--font-size-xs)', textAlign: 'right', color: healthColor(unit.health) }}>
          {unit.health}
        </div>
        <div className="health-bar-bg">
          <div
            className="health-bar-fill"
            style={{ width: unit.health + '%', background: healthColor(unit.health) }}
          />
        </div>
      </div>
    </div>
  );
}

export function UnitsPanel() {
  const filters    = useSyncExternalStore(filtersStore.subscribe, filtersStore.getSnapshot);
  const selectedId = useSyncExternalStore(selectionStore.subscribe, selectionStore.getSnapshot);
  const filtersRef = useRef(filters);
  filtersRef.current = filters;

  const [units, setUnits] = useState<Unit[]>(() =>
    applyFilters(unitsStore.getMap(), filters)
  );

  useEffect(() => {
    let rafPending = false;
    return unitsStore.subscribe(() => {
      if (rafPending) return;
      rafPending = true;
      requestAnimationFrame(() => {
        rafPending = false;
        setUnits(applyFilters(unitsStore.getMap(), filtersRef.current));
      });
    });
  }, []);

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

  const itemData = useMemo<RowData>(() => ({
    units,
    selectedId,
    onSelect: selectionStore.select,
  }), [units, selectedId]);

  return (
    <div className="panel units-panel">
      <div className="panel-header">
        <span className="panel-header-title">Units</span>
        <span className="kpi-sub">{units.length.toLocaleString()}</span>
      </div>

      <div className="filters-bar">
        <select
          className="filter-select"
          value={filters.team}
          onChange={e => filtersStore.set('team', e.target.value as UnitTeam | 'all')}
        >
          {TEAM_OPTIONS.map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>

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
