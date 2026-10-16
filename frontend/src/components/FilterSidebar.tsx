"use client";

import {
  ArrowUpDown,
  BedDouble,
  Car,
  Eye,
  Footprints,
  Layers,
  RotateCcw,
  TrainFront,
  Trash2,
  Wallet,
} from "lucide-react";
import {
  PRICE_MAX,
  PRICE_MIN,
  PRICE_STEP,
  WALK_MAX,
  WALK_MIN,
  isDefaultFilters,
  type Meta,
  type NetworkFilter,
  type PropertyFilters,
  type SortOption,
} from "@/services/api";
import type { ViewedFilter } from "@/lib/viewed";
import { formatPrice, timeAgo } from "@/lib/format";

interface FilterSidebarProps {
  filters: PropertyFilters;
  onChange: (next: PropertyFilters) => void;
  onReset: () => void;
  viewedFilter: ViewedFilter;
  onViewedFilterChange: (value: ViewedFilter) => void;
  seenInResults: number;
  loadedCount: number;
  viewedHistoryCount: number;
  onClearViewed: () => void;
  showStations: boolean;
  onToggleStations: (value: boolean) => void;
  meta: Meta | null;
  total: number;
  loading: boolean;
}

interface SegmentedOption<T> {
  label: string;
  value: T;
}

function Segmented<T extends string | number | null>({
  options,
  value,
  onChange,
  label,
}: {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="grid gap-1 rounded-xl bg-slate-100 p-1"
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={String(option.value)}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(option.value)}
            className={`rounded-lg px-2 py-1.5 text-sm font-medium transition ${
              active
                ? "bg-white text-brand-700 shadow-sm"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition ${
        checked ? "bg-brand-600" : "bg-slate-300"
      }`}
    >
      <span
        className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${
          checked ? "translate-x-5" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}

function SectionLabel({
  icon,
  title,
  value,
}: {
  icon: React.ReactNode;
  title: string;
  value?: string;
}) {
  return (
    <div className="mb-2 flex items-center justify-between">
      <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
        <span className="text-slate-400" aria-hidden="true">
          {icon}
        </span>
        {title}
      </div>
      {value !== undefined && <span className="text-sm font-medium text-brand-700">{value}</span>}
    </div>
  );
}

const ROOM_OPTIONS: SegmentedOption<number | null>[] = [
  { label: "Any", value: null },
  { label: "1+", value: 1 },
  { label: "2+", value: 2 },
  { label: "3+", value: 3 },
  { label: "4+", value: 4 },
];

const NETWORK_OPTIONS: SegmentedOption<NetworkFilter>[] = [
  { label: "All", value: "ALL" },
  { label: "Metro", value: "METRO" },
  { label: "REM", value: "REM" },
];

const VIEWED_OPTIONS: SegmentedOption<ViewedFilter>[] = [
  { label: "All", value: "all" },
  { label: "Unseen", value: "unseen" },
  { label: "Seen", value: "seen" },
];

const SORT_OPTIONS: SegmentedOption<SortOption>[] = [
  { label: "Price: low to high", value: "price_asc" },
  { label: "Price: high to low", value: "price_desc" },
  { label: "Closest to station", value: "walk_asc" },
  { label: "Newest", value: "newest" },
];

export default function FilterSidebar({
  filters,
  onChange,
  onReset,
  viewedFilter,
  onViewedFilterChange,
  seenInResults,
  loadedCount,
  viewedHistoryCount,
  onClearViewed,
  showStations,
  onToggleStations,
  meta,
  total,
  loading,
}: FilterSidebarProps) {
  const priceSliderValue = filters.maxPrice ?? PRICE_MAX;
  const atDefaults = isDefaultFilters(filters) && viewedFilter === "all";

  const handleClearViewed = () => {
    const confirmed = window.confirm(
      `Clear your seen history? ${viewedHistoryCount} listing${
        viewedHistoryCount === 1 ? "" : "s"
      } will go back to unseen.`,
    );
    if (confirmed) {
      onClearViewed();
    }
  };

  return (
    <div className="flex flex-col gap-6 p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-slate-900">Filters</h2>
        <button
          type="button"
          onClick={onReset}
          disabled={atDefaults}
          className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium text-slate-600 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <RotateCcw className="h-4 w-4" aria-hidden="true" />
          Reset
        </button>
      </div>

      <section>
        <SectionLabel
          icon={<Wallet className="h-4 w-4" />}
          title="Max rent"
          value={filters.maxPrice === null ? "Any" : `${formatPrice(filters.maxPrice)}/mo`}
        />
        <input
          type="range"
          min={PRICE_MIN}
          max={PRICE_MAX}
          step={PRICE_STEP}
          value={priceSliderValue}
          aria-label="Maximum monthly rent"
          onChange={(event) => {
            const next = Number(event.target.value);
            onChange({ ...filters, maxPrice: next >= PRICE_MAX ? null : next });
          }}
          className="w-full accent-brand-600"
        />
        <div className="mt-1 flex justify-between text-xs text-slate-500">
          <span>{formatPrice(PRICE_MIN)}</span>
          <span>{formatPrice(PRICE_MAX)}+</span>
        </div>
      </section>

      <section>
        <SectionLabel icon={<BedDouble className="h-4 w-4" />} title="Bedrooms" />
        <Segmented<number | null>
          label="Minimum bedrooms"
          options={ROOM_OPTIONS}
          value={filters.minRooms}
          onChange={(value) => onChange({ ...filters, minRooms: value })}
        />
      </section>

      <section>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
            <Car className="h-4 w-4 text-slate-400" aria-hidden="true" />
            Parking required
          </div>
          <Switch
            checked={filters.parkingRequired}
            onChange={(value) => onChange({ ...filters, parkingRequired: value })}
            label="Parking required"
          />
        </div>
      </section>

      <section>
        <SectionLabel
          icon={<Footprints className="h-4 w-4" />}
          title="Walk to station"
          value={
            filters.maxWalkMinutes >= WALK_MAX ? `Up to ${WALK_MAX} min` : `≤ ${filters.maxWalkMinutes} min`
          }
        />
        <input
          type="range"
          min={WALK_MIN}
          max={WALK_MAX}
          step={1}
          value={filters.maxWalkMinutes}
          aria-label="Maximum walking minutes to the nearest station"
          onChange={(event) => onChange({ ...filters, maxWalkMinutes: Number(event.target.value) })}
          className="w-full accent-brand-600"
        />
        <div className="mt-1 flex justify-between text-xs text-slate-500">
          <span>{WALK_MIN} min</span>
          <span>{WALK_MAX} min</span>
        </div>
      </section>

      <section>
        <SectionLabel icon={<TrainFront className="h-4 w-4" />} title="Nearest network" />
        <Segmented<NetworkFilter>
          label="Nearest station network"
          options={NETWORK_OPTIONS}
          value={filters.network}
          onChange={(value) => onChange({ ...filters, network: value })}
        />
      </section>

      <section>
        <SectionLabel icon={<ArrowUpDown className="h-4 w-4" />} title="Sort by" />
        <select
          value={filters.sort}
          aria-label="Sort listings"
          onChange={(event) => onChange({ ...filters, sort: event.target.value as SortOption })}
          className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-200"
        >
          {SORT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </section>

      <section className="rounded-xl border border-slate-200 p-4">
        <SectionLabel icon={<Eye className="h-4 w-4" />} title="Seen listings" />
        <Segmented<ViewedFilter>
          label="Filter by seen status"
          options={VIEWED_OPTIONS}
          value={viewedFilter}
          onChange={onViewedFilterChange}
        />
        <p className="mt-3 text-xs leading-relaxed text-slate-600">
          {seenInResults} of {loadedCount} loaded listing{loadedCount === 1 ? "" : "s"} marked as
          seen. Listings turn gray after you open them.
        </p>
        <button
          type="button"
          onClick={handleClearViewed}
          disabled={viewedHistoryCount === 0}
          className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Trash2 className="h-4 w-4" aria-hidden="true" />
          Clear seen history
          {viewedHistoryCount > 0 && <span className="text-slate-400">({viewedHistoryCount})</span>}
        </button>
      </section>

      <section className="rounded-xl border border-slate-200 p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
            <Layers className="h-4 w-4 text-slate-400" aria-hidden="true" />
            Show stations on map
          </div>
          <Switch checked={showStations} onChange={onToggleStations} label="Show stations on map" />
        </div>
        <ul className="mt-4 grid grid-cols-2 gap-x-3 gap-y-2 text-xs text-slate-600">
          <li className="flex items-center gap-2">
            <span className="h-3 w-3 rounded-full bg-line-green" /> Green line
          </li>
          <li className="flex items-center gap-2">
            <span className="h-3 w-3 rounded-full bg-line-orange" /> Orange line
          </li>
          <li className="flex items-center gap-2">
            <span className="h-3 w-3 rounded-full bg-line-blue" /> Blue line
          </li>
          <li className="flex items-center gap-2">
            <span className="h-3 w-3 rounded-full bg-line-yellow" /> Yellow line
          </li>
          <li className="col-span-2 flex items-center gap-2">
            <span className="h-3 w-3 rounded-[4px] bg-line-rem" /> REM (square markers)
          </li>
        </ul>
      </section>

      <section className="rounded-xl bg-slate-50 p-4 text-xs leading-relaxed text-slate-600">
        <div className="font-semibold text-slate-800">
          {loading ? "Loading…" : `${total} listing${total === 1 ? "" : "s"} match`}
        </div>
        {meta ? (
          <ul className="mt-2 space-y-1">
            <li>
              {meta.properties_near_transit} of {meta.active_properties} active listings are within{" "}
              {Math.round(meta.walk_radius_meters / 80)} min of a station
            </li>
            <li>{meta.operational_stations} operational stations tracked</li>
            <li>
              {meta.last_scrape
                ? `Last scrape: ${meta.last_scrape.status} · ${timeAgo(
                    meta.last_scrape.finished_at ?? meta.last_scrape.started_at,
                  )}`
                : "No scrape has run yet"}
            </li>
          </ul>
        ) : (
          <div className="mt-2">Waiting for API…</div>
        )}
      </section>
    </div>
  );
}