"use client";

import { useMemo, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import {
  ArrowUpDown,
  BedDouble,
  Calendar,
  Car,
  Compass,
  Crosshair,
  Download,
  Eye,
  Flame,
  Footprints,
  Heart,
  Layers,
  MapPin,
  PawPrint,
  RotateCcw,
  Ruler,
  Shirt,
  Snowflake,
  Sofa,
  Sparkles,
  Sun,
  TrainFront,
  Trash2,
  TrendingDown,
  Upload,
  Wallet,
  X,
} from "lucide-react";
import {
  ALL_TRANSIT_LINES,
  PRICE_MAX,
  PRICE_MIN,
  PRICE_STEP,
  WALK_MAX,
  WALK_MIN,
  isDefaultFilters,
  type Meta,
  type MoveInFilter,
  type NetworkFilter,
  type PropertyFilters,
  type SortOption,
  type Station,
  type TransitLine,
} from "@/services/api";
import type { ActivityFilter } from "@/lib/saved";
import { COMMUTE_PRESETS, type CommuteDestination } from "@/lib/transit";
import { formatPrice, lineHexColor, timeAgo } from "@/lib/format";

interface FilterSidebarProps {
  filters: PropertyFilters;
  onChange: (next: PropertyFilters) => void;
  onReset: () => void;
  activityFilter: ActivityFilter;
  onActivityFilterChange: (value: ActivityFilter) => void;
  favoritesCount: number;
  notesCount: number;
  hiddenCount: number;
  seenInResults: number;
  loadedCount: number;
  viewedHistoryCount: number;
  onClearViewed: () => void;
  onClearHidden: () => void;
  onExportData: () => void;
  onImportData: (rawJson: string) => void;
  stations: Station[];
  showStations: boolean;
  onToggleStations: (value: boolean) => void;
  showTransitLines: boolean;
  onToggleTransitLines: (value: boolean) => void;
  destination: CommuteDestination | null;
  onDestinationChange: (dest: CommuteDestination | null) => void;
  pickingDestination: boolean;
  onTogglePickDestination: () => void;
  maxCommuteMinutes: number | null;
  onMaxCommuteChange: (minutes: number | null) => void;
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
            className={`truncate rounded-lg px-2 py-1.5 text-xs font-semibold transition ${
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
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition ${
        checked ? "bg-brand-600" : "bg-slate-300"
      }`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition ${
          checked ? "translate-x-4" : "translate-x-0.5"
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
  icon: ReactNode;
  title: string;
  value?: string;
}) {
  return (
    <div className="mb-2 flex items-center justify-between gap-2">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-600">
        <span className="text-slate-400" aria-hidden="true">
          {icon}
        </span>
        {title}
      </div>
      {value !== undefined && <span className="text-xs font-bold text-brand-700">{value}</span>}
    </div>
  );
}

const NETWORK_OPTIONS: SegmentedOption<NetworkFilter>[] = [
  { label: "All", value: "ALL" },
  { label: "Metro", value: "METRO" },
  { label: "REM", value: "REM" },
];

const MOVE_IN_OPTIONS: SegmentedOption<MoveInFilter>[] = [
  { label: "Any date", value: "any" },
  { label: "Immediate", value: "immediate" },
  { label: "July 1st", value: "july_1" },
];

const ADDED_OPTIONS: SegmentedOption<number | null>[] = [
  { label: "Any", value: null },
  { label: "24h", value: 1 },
  { label: "3d", value: 3 },
  { label: "7d", value: 7 },
];

const MIN_AREA_OPTIONS: SegmentedOption<number | null>[] = [
  { label: "Any", value: null },
  { label: "500+", value: 500 },
  { label: "700+", value: 700 },
  { label: "950+", value: 950 },
];

const MAX_PPSQFT_OPTIONS: SegmentedOption<number | null>[] = [
  { label: "Any", value: null },
  { label: "≤ $2.50", value: 2.5 },
  { label: "≤ $3.25", value: 3.25 },
  { label: "≤ $4.00", value: 4.0 },
];

const BATH_OPTIONS: SegmentedOption<number | null>[] = [
  { label: "Any", value: null },
  { label: "1+", value: 1 },
  { label: "2+", value: 2 },
];

export default function FilterSidebar({
  filters,
  onChange,
  onReset,
  activityFilter,
  onActivityFilterChange,
  favoritesCount,
  notesCount,
  hiddenCount,
  seenInResults,
  loadedCount,
  viewedHistoryCount,
  onClearViewed,
  onClearHidden,
  onExportData,
  onImportData,
  stations,
  showStations,
  onToggleStations,
  showTransitLines,
  onToggleTransitLines,
  destination,
  onDestinationChange,
  pickingDestination,
  onTogglePickDestination,
  maxCommuteMinutes,
  onMaxCommuteChange,
  meta,
  total,
  loading,
}: FilterSidebarProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [importFeedback, setImportFeedback] = useState<string | null>(null);

  const uniqueStationNames = useMemo(() => {
    const names = new Set<string>();
    for (const s of stations) {
      if (s.is_operational) names.add(s.name);
    }
    return Array.from(names).sort((a, b) => a.localeCompare(b, "fr-CA"));
  }, [stations]);

  const priceSliderValue = filters.maxPrice ?? PRICE_MAX;
  const atDefaults =
    isDefaultFilters(filters) &&
    activityFilter === "all" &&
    destination === null &&
    maxCommuteMinutes === null;

  const toggleLine = (line: TransitLine) => {
    const exists = filters.lines.includes(line);
    const nextLines = exists
      ? filters.lines.filter((l) => l !== line)
      : [...filters.lines, line];
    onChange({ ...filters, lines: nextLines });
  };

  const roomSelection: string = filters.studioOnly
    ? "studio"
    : filters.minRooms === null
      ? "any"
      : String(filters.minRooms);

  const handleRoomSelect = (val: string) => {
    if (val === "any") {
      onChange({ ...filters, studioOnly: false, minRooms: null });
    } else if (val === "studio") {
      onChange({ ...filters, studioOnly: true, minRooms: 0 });
    } else {
      onChange({ ...filters, studioOnly: false, minRooms: Number(val) });
    }
  };

  const sortOptions: SegmentedOption<SortOption>[] = [
    { label: "Price: low to high", value: "price_asc" },
    { label: "Price: high to low", value: "price_desc" },
    { label: "Closest to station", value: "walk_asc" },
    ...(destination ? [{ label: "Shortest commute", value: "commute_asc" as SortOption }] : []),
    { label: "Newest first", value: "newest" },
    { label: "Biggest price drop", value: "price_drop_desc" },
    { label: "Largest area (sq ft)", value: "sqft_desc" },
    { label: "Lowest $/sq ft", value: "ppsqft_asc" },
  ];

  const amenityToggles: {
    key: keyof PropertyFilters;
    label: string;
    icon: ReactNode;
    active: boolean;
  }[] = [
    {
      key: "petsAllowed",
      label: "Pets OK",
      icon: <PawPrint className="h-3.5 w-3.5" />,
      active: filters.petsAllowed,
    },
    {
      key: "parkingRequired",
      label: "Parking",
      icon: <Car className="h-3.5 w-3.5" />,
      active: filters.parkingRequired,
    },
    {
      key: "laundryInUnit",
      label: "In-unit laundry",
      icon: <Shirt className="h-3.5 w-3.5" />,
      active: filters.laundryInUnit,
    },
    {
      key: "appliancesIncluded",
      label: "Appliances",
      icon: <Sparkles className="h-3.5 w-3.5" />,
      active: filters.appliancesIncluded,
    },
    {
      key: "utilitiesIncluded",
      label: "Heat / Hydro",
      icon: <Flame className="h-3.5 w-3.5" />,
      active: filters.utilitiesIncluded,
    },
    {
      key: "airConditioning",
      label: "A/C",
      icon: <Snowflake className="h-3.5 w-3.5" />,
      active: filters.airConditioning,
    },
    {
      key: "balcony",
      label: "Balcony",
      icon: <Sun className="h-3.5 w-3.5" />,
      active: filters.balcony,
    },
    {
      key: "furnished",
      label: "Furnished",
      icon: <Sofa className="h-3.5 w-3.5" />,
      active: filters.furnished,
    },
  ];

  const handleClearViewed = () => {
    if (
      window.confirm(
        `Clear your seen history? ${viewedHistoryCount} listing${
          viewedHistoryCount === 1 ? "" : "s"
        } will go back to unseen.`,
      )
    ) {
      onClearViewed();
    }
  };

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        onImportData(String(reader.result ?? ""));
        setImportFeedback("Shortlist & notes imported!");
        window.setTimeout(() => setImportFeedback(null), 3000);
      } catch {
        setImportFeedback("Invalid backup JSON file");
        window.setTimeout(() => setImportFeedback(null), 3000);
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="flex flex-col gap-5 p-4 sm:p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold tracking-tight text-slate-900">Search & Filters</h2>
        <button
          type="button"
          onClick={onReset}
          disabled={atDefaults}
          className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold text-slate-600 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
          Reset all
        </button>
      </div>

      {/* 1. Sort */}
      <section>
        <SectionLabel icon={<ArrowUpDown className="h-3.5 w-3.5" />} title="Sort results" />
        <select
          value={filters.sort}
          aria-label="Sort listings"
          onChange={(event) => onChange({ ...filters, sort: event.target.value as SortOption })}
          className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-800 outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-200"
        >
          {sortOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </section>

      {/* 2. Commute Calculator */}
      <section className="rounded-2xl border border-brand-200/80 bg-gradient-to-br from-brand-50/80 via-white to-slate-50 p-3.5">
        <SectionLabel
          icon={<Compass className="h-3.5 w-3.5 text-brand-600" />}
          title="Commute to Work / Uni"
          value={
            destination
              ? maxCommuteMinutes
                ? `≤ ${maxCommuteMinutes} min`
                : "Active"
              : undefined
          }
        />
        <div className="flex gap-1.5">
          <select
            aria-label="Commute destination"
            value={destination ? (destination.isCustom ? "custom" : destination.id) : ""}
            onChange={(e) => {
              const val = e.target.value;
              if (!val) {
                onDestinationChange(null);
                onMaxCommuteChange(null);
                if (filters.sort === "commute_asc") {
                  onChange({ ...filters, sort: "price_asc" });
                }
              } else {
                const preset = COMMUTE_PRESETS.find((p) => p.id === val);
                if (preset) onDestinationChange(preset);
              }
            }}
            className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-800 outline-none focus:border-brand-500"
          >
            <option value="">Select destination…</option>
            {COMMUTE_PRESETS.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.label}
              </option>
            ))}
            {destination?.isCustom && <option value="custom">📍 {destination.label}</option>}
          </select>

          <button
            type="button"
            onClick={onTogglePickDestination}
            title="Click on the map to drop a custom destination pin"
            className={`inline-flex shrink-0 items-center gap-1 rounded-xl border px-2.5 py-1.5 text-xs font-semibold transition ${
              pickingDestination
                ? "border-brand-600 bg-brand-600 text-white shadow-sm"
                : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
            }`}
          >
            <Crosshair className="h-3.5 w-3.5" />
            Pin
          </button>
        </div>

        {destination && (
          <div className="mt-3 space-y-1.5">
            <div className="flex items-center justify-between text-xs text-slate-600">
              <span>Max door-to-door time</span>
              <span className="font-semibold text-brand-700">
                {maxCommuteMinutes === null ? "Any time" : `≤ ${maxCommuteMinutes} min`}
              </span>
            </div>
            <input
              type="range"
              min={15}
              max={60}
              step={5}
              value={maxCommuteMinutes ?? 60}
              aria-label="Maximum commute time in minutes"
              onChange={(e) => {
                const v = Number(e.target.value);
                onMaxCommuteChange(v >= 60 ? null : v);
              }}
              className="w-full"
            />
            <div className="flex justify-between text-[11px] text-slate-400">
              <span>15 min</span>
              <span>35 min</span>
              <span>Any</span>
            </div>
          </div>
        )}
      </section>

      {/* 3. Transit Lines, Station & Walk */}
      <section className="space-y-3.5">
        <div>
          <SectionLabel icon={<TrainFront className="h-3.5 w-3.5" />} title="Transit Network & Lines" />
          <Segmented<NetworkFilter>
            label="Transit network"
            options={NETWORK_OPTIONS}
            value={filters.network}
            onChange={(value) => onChange({ ...filters, network: value })}
          />
          <div className="mt-2.5 flex flex-wrap gap-1.5" role="group" aria-label="Filter by transit lines">
            {ALL_TRANSIT_LINES.map((line) => {
              const active = filters.lines.includes(line);
              const hex = lineHexColor(line);
              return (
                <button
                  key={line}
                  type="button"
                  aria-pressed={active}
                  onClick={() => toggleLine(line)}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold transition ${
                    active
                      ? "border-transparent text-white shadow-sm"
                      : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50"
                  }`}
                  style={active ? { backgroundColor: hex } : undefined}
                >
                  <span
                    className="h-2.5 w-2.5 rounded-full ring-1 ring-black/10"
                    style={{ backgroundColor: active ? "#ffffff" : hex }}
                  />
                  {line}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <div className="mb-1.5 flex items-center justify-between text-xs font-semibold text-slate-600">
            <span className="flex items-center gap-1.5">
              <MapPin className="h-3.5 w-3.5 text-slate-400" />
              Specific Station
            </span>
            {filters.stationName && (
              <button
                type="button"
                onClick={() => onChange({ ...filters, stationName: null })}
                className="inline-flex items-center gap-0.5 text-xs font-medium text-brand-600 hover:underline"
              >
                Clear <X className="h-3 w-3" />
              </button>
            )}
          </div>
          <select
            aria-label="Filter by station"
            value={filters.stationName ?? ""}
            onChange={(e) =>
              onChange({ ...filters, stationName: e.target.value ? e.target.value : null })
            }
            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-800 outline-none focus:border-brand-500"
          >
            <option value="">All stations ({uniqueStationNames.length})</option>
            {uniqueStationNames.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <SectionLabel
            icon={<Footprints className="h-3.5 w-3.5" />}
            title="Walk to station"
            value={
              filters.maxWalkMinutes >= WALK_MAX
                ? `≤ ${WALK_MAX} min`
                : `≤ ${filters.maxWalkMinutes} min`
            }
          />
          <input
            type="range"
            min={WALK_MIN}
            max={WALK_MAX}
            step={1}
            value={filters.maxWalkMinutes}
            aria-label="Maximum walking minutes to station"
            onChange={(event) =>
              onChange({ ...filters, maxWalkMinutes: Number(event.target.value) })
            }
            className="w-full"
          />
          <div className="mt-1 flex justify-between text-[11px] text-slate-400">
            <span>{WALK_MIN} min</span>
            <span>8 min</span>
            <span>{WALK_MAX} min</span>
          </div>
        </div>
      </section>

      <hr className="border-slate-100" />

      {/* 4. Budget & Space */}
      <section className="space-y-3.5">
        <div>
          <SectionLabel
            icon={<Wallet className="h-3.5 w-3.5" />}
            title="Monthly Rent"
            value={
              filters.minPrice !== null || filters.maxPrice !== null
                ? `${filters.minPrice ? formatPrice(filters.minPrice) : "$0"} – ${
                    filters.maxPrice ? formatPrice(filters.maxPrice) : "Any"
                  }`
                : "Any"
            }
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
            className="w-full"
          />
          <div className="mt-2 grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[11px] font-medium text-slate-500">Min ($)</label>
              <input
                type="number"
                min={0}
                max={20000}
                step={50}
                placeholder="No min"
                value={filters.minPrice ?? ""}
                onChange={(e) => {
                  const val = e.target.value.trim();
                  onChange({ ...filters, minPrice: val === "" ? null : Math.max(0, Number(val)) });
                }}
                className="mt-0.5 w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-800 outline-none focus:border-brand-500"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-slate-500">Max ($)</label>
              <input
                type="number"
                min={0}
                max={20000}
                step={50}
                placeholder="No max"
                value={filters.maxPrice ?? ""}
                onChange={(e) => {
                  const val = e.target.value.trim();
                  onChange({ ...filters, maxPrice: val === "" ? null : Math.max(0, Number(val)) });
                }}
                className="mt-0.5 w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-800 outline-none focus:border-brand-500"
              />
            </div>
          </div>
        </div>

        <div>
          <SectionLabel icon={<BedDouble className="h-3.5 w-3.5" />} title="Bedrooms" />
          <Segmented<string>
            label="Bedrooms"
            options={[
              { label: "Any", value: "any" },
              { label: "Studio", value: "studio" },
              { label: "1+", value: "1" },
              { label: "2+", value: "2" },
              { label: "3+", value: "3" },
              { label: "4+", value: "4" },
            ]}
            value={roomSelection}
            onChange={handleRoomSelect}
          />
        </div>

        <div className="grid grid-cols-2 gap-2.5">
          <div>
            <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Bathrooms
            </div>
            <Segmented<number | null>
              label="Minimum bathrooms"
              options={BATH_OPTIONS}
              value={filters.minBathrooms}
              onChange={(v) => onChange({ ...filters, minBathrooms: v })}
            />
          </div>
          <div>
            <div className="mb-1.5 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              <Ruler className="h-3 w-3" /> Min sq ft
            </div>
            <Segmented<number | null>
              label="Minimum square footage"
              options={MIN_AREA_OPTIONS}
              value={filters.minArea}
              onChange={(v) => onChange({ ...filters, minArea: v })}
            />
          </div>
        </div>

        <div>
          <div className="mb-1.5 flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            <span>Max rent / sq ft</span>
            {filters.maxPricePerSqft !== null && (
              <span className="font-bold text-brand-700">
                ≤ ${filters.maxPricePerSqft.toFixed(2)}/ft²
              </span>
            )}
          </div>
          <Segmented<number | null>
            label="Maximum rent per square foot"
            options={MAX_PPSQFT_OPTIONS}
            value={filters.maxPricePerSqft}
            onChange={(v) => onChange({ ...filters, maxPricePerSqft: v })}
          />
        </div>
      </section>

      <hr className="border-slate-100" />

      {/* 5. Move-in & Market Signals */}
      <section className="space-y-3.5">
        <div>
          <SectionLabel icon={<Calendar className="h-3.5 w-3.5" />} title="Move-in Availability" />
          <Segmented<MoveInFilter>
            label="Move-in availability"
            options={MOVE_IN_OPTIONS}
            value={filters.moveIn}
            onChange={(value) => onChange({ ...filters, moveIn: value })}
          />
        </div>

        <div className="flex items-center justify-between rounded-xl border border-slate-200 px-3 py-2.5">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-800">
            <TrendingDown className="h-4 w-4 text-emerald-600" />
            Price drops only
            {meta && meta.price_drops_count > 0 && (
              <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-800">
                {meta.price_drops_count}
              </span>
            )}
          </div>
          <Switch
            checked={filters.priceDropsOnly}
            onChange={(v) => onChange({ ...filters, priceDropsOnly: v })}
            label="Only show listings with price drops"
          />
        </div>

        <div>
          <SectionLabel icon={<Sparkles className="h-3.5 w-3.5" />} title="Added to Market" />
          <Segmented<number | null>
            label="Added within days"
            options={ADDED_OPTIONS}
            value={filters.addedWithinDays}
            onChange={(v) => onChange({ ...filters, addedWithinDays: v })}
          />
        </div>
      </section>

      <hr className="border-slate-100" />

      {/* 6. Amenities & Inclusions */}
      <section>
        <SectionLabel icon={<Sparkles className="h-3.5 w-3.5" />} title="Amenities & Inclusions" />
        <div className="grid grid-cols-2 gap-1.5">
          {amenityToggles.map((item) => (
            <button
              key={item.key}
              type="button"
              aria-pressed={item.active}
              onClick={() => onChange({ ...filters, [item.key]: !item.active })}
              className={`flex items-center gap-1.5 rounded-xl border px-2.5 py-2 text-left text-xs font-medium transition ${
                item.active
                  ? "border-brand-600 bg-brand-50 text-brand-800 shadow-sm"
                  : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50"
              }`}
            >
              <span className={item.active ? "text-brand-600" : "text-slate-400"}>{item.icon}</span>
              <span className="truncate">{item.label}</span>
            </button>
          ))}
        </div>
      </section>

      <hr className="border-slate-100" />

      {/* 7. Personal Shortlist, Notes & Seen History */}
      <section className="rounded-2xl border border-slate-200 p-3.5">
        <SectionLabel icon={<Heart className="h-3.5 w-3.5" />} title="Your Activity" />
        <div className="grid grid-cols-3 gap-1 rounded-xl bg-slate-100 p-1">
          {(
            [
              { label: "All", value: "all" },
              { label: "Unseen", value: "unseen" },
              { label: `Saved (${favoritesCount})`, value: "favorites" },
              { label: `Notes (${notesCount})`, value: "notes" },
              { label: "Seen", value: "seen" },
              { label: `Hidden (${hiddenCount})`, value: "hidden" },
            ] as { label: string; value: ActivityFilter }[]
          ).map((opt) => {
            const active = activityFilter === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => onActivityFilterChange(opt.value)}
                className={`truncate rounded-lg px-1.5 py-1.5 text-[11px] font-semibold transition ${
                  active
                    ? "bg-white text-brand-700 shadow-sm"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>

        <p className="mt-2.5 text-[11px] leading-relaxed text-slate-500">
          {seenInResults} of {loadedCount} loaded listing{loadedCount === 1 ? "" : "s"} opened.
          Shortlist, hidden listings, and notes save automatically in your browser.
        </p>

        <div className="mt-3 grid grid-cols-2 gap-1.5">
          <button
            type="button"
            onClick={onExportData}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50"
          >
            <Download className="h-3.5 w-3.5" />
            Export JSON
          </button>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50"
          >
            <Upload className="h-3.5 w-3.5" />
            Import JSON
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            onChange={handleFileChange}
            className="hidden"
          />
        </div>

        {importFeedback && (
          <div className="mt-2 rounded-lg bg-brand-50 px-2.5 py-1.5 text-center text-xs font-medium text-brand-700">
            {importFeedback}
          </div>
        )}

        <div className="mt-2 flex gap-1.5">
          <button
            type="button"
            onClick={handleClearViewed}
            disabled={viewedHistoryCount === 0}
            className="inline-flex flex-1 items-center justify-center gap-1 rounded-lg border border-slate-200 px-2 py-1.5 text-[11px] font-medium text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Eye className="h-3 w-3" />
            Clear seen ({viewedHistoryCount})
          </button>
          {hiddenCount > 0 && (
            <button
              type="button"
              onClick={onClearHidden}
              className="inline-flex items-center justify-center gap-1 rounded-lg border border-slate-200 px-2 py-1.5 text-[11px] font-medium text-slate-600 transition hover:bg-slate-50"
            >
              <Trash2 className="h-3 w-3" />
              Unhide ({hiddenCount})
            </button>
          )}
        </div>
      </section>

      {/* 8. Map Layers */}
      <section className="rounded-2xl border border-slate-200 p-3.5 space-y-2.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-800">
            <Layers className="h-3.5 w-3.5 text-slate-400" />
            Transit line paths
          </div>
          <Switch
            checked={showTransitLines}
            onChange={onToggleTransitLines}
            label="Show transit line polylines on map"
          />
        </div>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-800">
            <TrainFront className="h-3.5 w-3.5 text-slate-400" />
            Station markers
          </div>
          <Switch
            checked={showStations}
            onChange={onToggleStations}
            label="Show station markers on map"
          />
        </div>
      </section>

      {/* 9. Database & Scrape Status */}
      <section className="rounded-2xl bg-slate-100/80 p-3.5 text-xs leading-relaxed text-slate-600">
        <div className="font-semibold text-slate-900">
          {loading ? "Updating…" : `${total} listing${total === 1 ? "" : "s"} match`}
        </div>
        {meta ? (
          <ul className="mt-1.5 space-y-1 text-[11px]">
            <li>
              {meta.properties_near_transit} of {meta.active_properties} active rentals within{" "}
              {Math.round(meta.walk_radius_meters / 80)} min of {meta.operational_stations} stations
            </li>
            <li>
              {meta.new_48h_count} new in 48h · {meta.price_drops_count} price drops tracked
            </li>
            <li>
              {meta.last_scrape
                ? `Last scrape: ${meta.last_scrape.status} · ${timeAgo(
                    meta.last_scrape.finished_at ?? meta.last_scrape.started_at,
                  )}`
                : "Waiting for first scrape run"}
            </li>
          </ul>
        ) : (
          <div className="mt-1">Connecting to API…</div>
        )}
      </section>
    </div>
  );
}
