"use client";

import {
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  ArrowUpDown,
  Bath,
  BedDouble,
  Calendar,
  Car,
  Check,
  ChevronDown,
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

function rangeProgressStyle(value: number, min: number, max: number): CSSProperties {
  const pct = Math.max(0, Math.min(100, ((value - min) / Math.max(1, max - min)) * 100));
  return { "--range-progress": `${pct.toFixed(1)}%` } as CSSProperties;
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
      className="flex flex-wrap gap-1 rounded-xl bg-slate-100/90 p-1 ring-1 ring-inset ring-slate-200/75"
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={String(option.value)}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(option.value)}
            className={`flex-1 basis-auto whitespace-nowrap rounded-lg px-2.5 py-1.5 text-center text-xs font-semibold transition-all duration-150 ${
              active
                ? "bg-white text-brand-700 shadow-sm ring-1 ring-slate-900/5"
                : "text-slate-600 hover:bg-white/50 hover:text-slate-900"
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
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors duration-150 ${
        checked ? "bg-brand-600" : "bg-slate-300 hover:bg-slate-400"
      }`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform duration-150 ${
          checked ? "translate-x-4" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}

function CardHeader({
  icon,
  title,
  badge,
  accent = false,
}: {
  icon: ReactNode;
  title: string;
  badge?: string;
  accent?: boolean;
}) {
  return (
    <div className="mb-3 flex items-center justify-between gap-2">
      <div className="flex items-center gap-2.5">
        <span
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${
            accent ? "bg-brand-100 text-brand-700" : "bg-slate-100 text-slate-600"
          }`}
          aria-hidden="true"
        >
          {icon}
        </span>
        <h3 className="text-[13px] font-semibold tracking-tight text-slate-900">{title}</h3>
      </div>
      {badge !== undefined && (
        <span className="rounded-full bg-brand-50 px-2.5 py-0.5 text-[11px] font-semibold text-brand-700 ring-1 ring-inset ring-brand-600/15">
          {badge}
        </span>
      )}
    </div>
  );
}

function FieldLabel({
  icon,
  label,
  value,
  action,
}: {
  icon?: ReactNode;
  label: string;
  value?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-1.5 flex items-center justify-between gap-2">
      <span className="flex items-center gap-1.5 text-xs font-medium text-slate-700">
        {icon && <span className="text-slate-400">{icon}</span>}
        {label}
      </span>
      {action ?? (
        value !== undefined && (
          <span className="text-xs font-semibold tabular-nums text-brand-700">{value}</span>
        )
      )}
    </div>
  );
}

const NETWORK_OPTIONS: SegmentedOption<NetworkFilter>[] = [
  { label: "All networks", value: "ALL" },
  { label: "Metro", value: "METRO" },
  { label: "REM", value: "REM" },
];

const MOVE_IN_OPTIONS: SegmentedOption<MoveInFilter>[] = [
  { label: "Any date", value: "any" },
  { label: "Immediate", value: "immediate" },
  { label: "July 1st", value: "july_1" },
];

const ADDED_OPTIONS: SegmentedOption<number | null>[] = [
  { label: "Any time", value: null },
  { label: "24h", value: 1 },
  { label: "3 days", value: 3 },
  { label: "7 days", value: 7 },
];

const MIN_AREA_OPTIONS: SegmentedOption<number | null>[] = [
  { label: "Any", value: null },
  { label: "500+ ft²", value: 500 },
  { label: "700+ ft²", value: 700 },
  { label: "950+ ft²", value: 950 },
];

const MAX_PPSQFT_OPTIONS: SegmentedOption<number | null>[] = [
  { label: "Any", value: null },
  { label: "≤ $2.50", value: 2.5 },
  { label: "≤ $3.25", value: 3.25 },
  { label: "≤ $4.00", value: 4.0 },
];

const BATH_OPTIONS: SegmentedOption<number | null>[] = [
  { label: "Any", value: null },
  { label: "1+ bath", value: 1 },
  { label: "2+ baths", value: 2 },
  { label: "3+ baths", value: 3 },
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
  const commuteSliderValue = maxCommuteMinutes ?? 60;

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
    { label: "Newest listings first", value: "newest" },
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
      label: "Pets allowed",
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
      label: "Air cond.",
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

  const activityItems: { label: string; value: ActivityFilter; count?: number }[] = [
    { label: "All", value: "all" },
    { label: "Unseen", value: "unseen" },
    { label: "Saved", value: "favorites", count: favoritesCount },
    { label: "Notes", value: "notes", count: notesCount },
    { label: "Seen", value: "seen" },
    { label: "Hidden", value: "hidden", count: hiddenCount },
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

  const rentSummary =
    filters.minPrice !== null || filters.maxPrice !== null
      ? `${filters.minPrice ? formatPrice(filters.minPrice) : "$0"} – ${
          filters.maxPrice ? formatPrice(filters.maxPrice) : "Any"
        }`
      : "Any budget";

  return (
    <div className="flex flex-col gap-3.5 bg-slate-50/80 p-3.5 sm:p-4">
      {/* Top Bar: Sort + Reset */}
      <div className="rounded-2xl border border-slate-200/80 bg-white p-3.5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <div className="mb-2 flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-700">
            <ArrowUpDown className="h-3.5 w-3.5 text-slate-400" />
            Sort listings
          </span>
          <button
            type="button"
            onClick={onReset}
            disabled={atDefaults}
            className="inline-flex items-center gap-1 rounded-lg px-2 py-0.5 text-xs font-semibold text-brand-600 transition hover:bg-brand-50 disabled:cursor-not-allowed disabled:text-slate-400 disabled:hover:bg-transparent"
          >
            <RotateCcw className="h-3 w-3" aria-hidden="true" />
            Reset all
          </button>
        </div>
        <div className="relative">
          <select
            value={filters.sort}
            aria-label="Sort listings"
            onChange={(event) => onChange({ ...filters, sort: event.target.value as SortOption })}
            className="w-full appearance-none rounded-xl border border-slate-200 bg-slate-50/70 py-2 pl-3 pr-9 text-xs font-semibold text-slate-800 outline-none transition hover:border-slate-300 focus:border-brand-500 focus:bg-white focus:ring-2 focus:ring-brand-500/15"
          >
            {sortOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        </div>
      </div>

      {/* Card 1: Budget & Space */}
      <section className="space-y-4 rounded-2xl border border-slate-200/80 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <CardHeader
          icon={<Wallet className="h-4 w-4" />}
          title="Budget & Space"
          badge={rentSummary}
        />

        {/* Monthly Rent */}
        <div>
          <input
            type="range"
            min={PRICE_MIN}
            max={PRICE_MAX}
            step={PRICE_STEP}
            value={priceSliderValue}
            style={rangeProgressStyle(priceSliderValue, PRICE_MIN, PRICE_MAX)}
            aria-label="Maximum monthly rent"
            onChange={(event) => {
              const next = Number(event.target.value);
              onChange({ ...filters, maxPrice: next >= PRICE_MAX ? null : next });
            }}
            className="w-full"
          />
          <div className="mt-3 grid grid-cols-2 gap-2.5">
            <div>
              <label className="mb-1 block text-[11px] font-medium text-slate-500">Min rent</label>
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs font-medium text-slate-400">
                  $
                </span>
                <input
                  type="number"
                  min={0}
                  max={20000}
                  step={50}
                  placeholder="No min"
                  value={filters.minPrice ?? ""}
                  onChange={(e) => {
                    const val = e.target.value.trim();
                    onChange({
                      ...filters,
                      minPrice: val === "" ? null : Math.max(0, Number(val)),
                    });
                  }}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50/60 py-2 pl-6 pr-2.5 text-xs font-semibold text-slate-800 outline-none transition placeholder:font-normal placeholder:text-slate-400 hover:border-slate-300 focus:border-brand-500 focus:bg-white focus:ring-2 focus:ring-brand-500/15"
                />
              </div>
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-medium text-slate-500">Max rent</label>
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs font-medium text-slate-400">
                  $
                </span>
                <input
                  type="number"
                  min={0}
                  max={20000}
                  step={50}
                  placeholder="No max"
                  value={filters.maxPrice ?? ""}
                  onChange={(e) => {
                    const val = e.target.value.trim();
                    onChange({
                      ...filters,
                      maxPrice: val === "" ? null : Math.max(0, Number(val)),
                    });
                  }}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50/60 py-2 pl-6 pr-2.5 text-xs font-semibold text-slate-800 outline-none transition placeholder:font-normal placeholder:text-slate-400 hover:border-slate-300 focus:border-brand-500 focus:bg-white focus:ring-2 focus:ring-brand-500/15"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Bedrooms */}
        <div>
          <FieldLabel icon={<BedDouble className="h-3.5 w-3.5" />} label="Bedrooms" />
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

        {/* Bathrooms */}
        <div>
          <FieldLabel icon={<Bath className="h-3.5 w-3.5" />} label="Bathrooms" />
          <Segmented<number | null>
            label="Minimum bathrooms"
            options={BATH_OPTIONS}
            value={filters.minBathrooms}
            onChange={(v) => onChange({ ...filters, minBathrooms: v })}
          />
        </div>

        {/* Minimum Size */}
        <div>
          <FieldLabel icon={<Ruler className="h-3.5 w-3.5" />} label="Minimum size" />
          <Segmented<number | null>
            label="Minimum square footage"
            options={MIN_AREA_OPTIONS}
            value={filters.minArea}
            onChange={(v) => onChange({ ...filters, minArea: v })}
          />
        </div>

        {/* Max Rent / sq ft */}
        <div>
          <FieldLabel
            label="Max rent per sq ft"
            value={
              filters.maxPricePerSqft !== null
                ? `≤ $${filters.maxPricePerSqft.toFixed(2)}/ft²`
                : undefined
            }
          />
          <Segmented<number | null>
            label="Maximum rent per square foot"
            options={MAX_PPSQFT_OPTIONS}
            value={filters.maxPricePerSqft}
            onChange={(v) => onChange({ ...filters, maxPricePerSqft: v })}
          />
        </div>
      </section>

      {/* Card 2: Transit Lines, Station & Walk */}
      <section className="space-y-4 rounded-2xl border border-slate-200/80 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <CardHeader
          icon={<TrainFront className="h-4 w-4" />}
          title="Transit & Proximity"
          badge={
            filters.maxWalkMinutes >= WALK_MAX
              ? `≤ ${WALK_MAX} min walk`
              : `≤ ${filters.maxWalkMinutes} min walk`
          }
        />

        <div>
          <Segmented<NetworkFilter>
            label="Transit network"
            options={NETWORK_OPTIONS}
            value={filters.network}
            onChange={(value) => onChange({ ...filters, network: value })}
          />

          <div
            className="mt-2.5 flex flex-wrap gap-1.5"
            role="group"
            aria-label="Filter by transit lines"
          >
            {ALL_TRANSIT_LINES.map((line) => {
              const active = filters.lines.includes(line);
              const hex = lineHexColor(line);
              return (
                <button
                  key={line}
                  type="button"
                  aria-pressed={active}
                  onClick={() => toggleLine(line)}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-all duration-150 ${
                    active
                      ? "border-transparent text-white shadow-sm"
                      : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50"
                  }`}
                  style={active ? { backgroundColor: hex } : undefined}
                >
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-black/10"
                    style={{ backgroundColor: active ? "#ffffff" : hex }}
                  />
                  <span>{line}</span>
                  {active && <Check className="h-3 w-3 stroke-[2.5]" />}
                </button>
              );
            })}
          </div>
        </div>

        {/* Specific Station */}
        <div>
          <FieldLabel
            icon={<MapPin className="h-3.5 w-3.5" />}
            label="Station"
            action={
              filters.stationName ? (
                <button
                  type="button"
                  onClick={() => onChange({ ...filters, stationName: null })}
                  className="inline-flex items-center gap-0.5 text-xs font-semibold text-brand-600 hover:underline"
                >
                  Clear <X className="h-3 w-3" />
                </button>
              ) : undefined
            }
          />
          <div className="relative">
            <select
              aria-label="Filter by station"
              value={filters.stationName ?? ""}
              onChange={(e) =>
                onChange({ ...filters, stationName: e.target.value ? e.target.value : null })
              }
              className="w-full appearance-none rounded-xl border border-slate-200 bg-slate-50/70 py-2 pl-3 pr-9 text-xs font-medium text-slate-800 outline-none transition hover:border-slate-300 focus:border-brand-500 focus:bg-white focus:ring-2 focus:ring-brand-500/15"
            >
              <option value="">All operational stations ({uniqueStationNames.length})</option>
              {uniqueStationNames.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          </div>
        </div>

        {/* Walk Time Slider */}
        <div>
          <FieldLabel
            icon={<Footprints className="h-3.5 w-3.5" />}
            label="Walking distance to station"
            value={`≤ ${filters.maxWalkMinutes} min`}
          />
          <input
            type="range"
            min={WALK_MIN}
            max={WALK_MAX}
            step={1}
            value={filters.maxWalkMinutes}
            style={rangeProgressStyle(filters.maxWalkMinutes, WALK_MIN, WALK_MAX)}
            aria-label="Maximum walking minutes to station"
            onChange={(event) =>
              onChange({ ...filters, maxWalkMinutes: Number(event.target.value) })
            }
            className="w-full"
          />
          <div className="mt-1.5 flex justify-between text-[11px] font-medium text-slate-400">
            <span>{WALK_MIN} min</span>
            <span>8 min</span>
            <span>{WALK_MAX} min</span>
          </div>
        </div>
      </section>

      {/* Card 3: Commute Calculator */}
      <section className="rounded-2xl border border-brand-200/70 bg-gradient-to-br from-brand-50/60 via-white to-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <CardHeader
          icon={<Compass className="h-4 w-4" />}
          title="Commute Time"
          accent
          badge={
            destination
              ? maxCommuteMinutes
                ? `≤ ${maxCommuteMinutes} min`
                : "Active"
              : undefined
          }
        />

        <div className="flex gap-2">
          <div className="relative min-w-0 flex-1">
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
              className="w-full appearance-none rounded-xl border border-slate-200 bg-white py-2 pl-3 pr-8 text-xs font-medium text-slate-800 outline-none transition hover:border-slate-300 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/15"
            >
              <option value="">Choose work or campus…</option>
              {COMMUTE_PRESETS.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.label}
                </option>
              ))}
              {destination?.isCustom && <option value="custom">📍 {destination.label}</option>}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          </div>

          <button
            type="button"
            onClick={onTogglePickDestination}
            title="Click on the map to drop a custom destination pin"
            className={`inline-flex shrink-0 items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-semibold transition ${
              pickingDestination
                ? "border-brand-600 bg-brand-600 text-white shadow-sm"
                : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50"
            }`}
          >
            <Crosshair className="h-3.5 w-3.5" />
            Pin
          </button>
        </div>

        {destination && (
          <div className="mt-3.5 space-y-1.5">
            <FieldLabel
              label="Max door-to-door time"
              value={maxCommuteMinutes === null ? "Any time" : `≤ ${maxCommuteMinutes} min`}
            />
            <input
              type="range"
              min={15}
              max={60}
              step={5}
              value={commuteSliderValue}
              style={rangeProgressStyle(commuteSliderValue, 15, 60)}
              aria-label="Maximum commute time in minutes"
              onChange={(e) => {
                const v = Number(e.target.value);
                onMaxCommuteChange(v >= 60 ? null : v);
              }}
              className="w-full"
            />
            <div className="flex justify-between text-[11px] font-medium text-slate-400">
              <span>15 min</span>
              <span>35 min</span>
              <span>Any</span>
            </div>
          </div>
        )}
      </section>

      {/* Card 4: Move-in & Market Signals */}
      <section className="space-y-4 rounded-2xl border border-slate-200/80 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <CardHeader icon={<Calendar className="h-4 w-4" />} title="Timing & Deals" />

        <div>
          <FieldLabel label="Move-in availability" />
          <Segmented<MoveInFilter>
            label="Move-in availability"
            options={MOVE_IN_OPTIONS}
            value={filters.moveIn}
            onChange={(value) => onChange({ ...filters, moveIn: value })}
          />
        </div>

        <div>
          <FieldLabel label="Added to market" />
          <Segmented<number | null>
            label="Added within days"
            options={ADDED_OPTIONS}
            value={filters.addedWithinDays}
            onChange={(v) => onChange({ ...filters, addedWithinDays: v })}
          />
        </div>

        <div className="flex items-center justify-between rounded-xl border border-slate-200/80 bg-slate-50/60 px-3.5 py-2.5">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-800">
            <TrendingDown className="h-4 w-4 text-emerald-600" />
            <span>Price drops only</span>
            {meta && meta.price_drops_count > 0 && (
              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800">
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
      </section>

      {/* Card 5: Amenities & Inclusions */}
      <section className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <CardHeader icon={<Sparkles className="h-4 w-4" />} title="Amenities & Inclusions" />
        <div className="grid grid-cols-2 gap-2">
          {amenityToggles.map((item) => (
            <button
              key={item.key}
              type="button"
              aria-pressed={item.active}
              onClick={() => onChange({ ...filters, [item.key]: !item.active })}
              className={`flex items-center justify-between gap-2 rounded-xl border px-3 py-2 text-left text-xs font-medium transition-all duration-150 ${
                item.active
                  ? "border-brand-600 bg-brand-50/80 font-semibold text-brand-900 shadow-sm"
                  : "border-slate-200/90 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50"
              }`}
            >
              <span className="flex items-center gap-2 whitespace-nowrap">
                <span className={item.active ? "text-brand-600" : "text-slate-400"}>
                  {item.icon}
                </span>
                <span>{item.label}</span>
              </span>
              {item.active && <Check className="h-3.5 w-3.5 shrink-0 text-brand-600" />}
            </button>
          ))}
        </div>
      </section>

      {/* Card 6: Shortlist, Notes & Seen Activity */}
      <section className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <CardHeader icon={<Heart className="h-4 w-4" />} title="Saved & Activity" />

        <div className="grid grid-cols-3 gap-1.5 rounded-xl bg-slate-100/90 p-1 ring-1 ring-inset ring-slate-200/75">
          {activityItems.map((opt) => {
            const active = activityFilter === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                aria-pressed={active}
                onClick={() => onActivityFilterChange(opt.value)}
                className={`inline-flex items-center justify-center gap-1 whitespace-nowrap rounded-lg px-2 py-1.5 text-xs font-semibold transition-all duration-150 ${
                  active
                    ? "bg-white text-brand-700 shadow-sm ring-1 ring-slate-900/5"
                    : "text-slate-600 hover:bg-white/50 hover:text-slate-900"
                }`}
              >
                <span>{opt.label}</span>
                {opt.count !== undefined && opt.count > 0 && (
                  <span
                    className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold leading-none ${
                      active ? "bg-brand-100 text-brand-700" : "bg-slate-200/90 text-slate-600"
                    }`}
                  >
                    {opt.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <p className="mt-2.5 text-[11px] leading-relaxed text-slate-500">
          {seenInResults} of {loadedCount} loaded listing{loadedCount === 1 ? "" : "s"} opened.
          Saved shortlist & notes stay private in your browser.
        </p>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={onExportData}
            className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
          >
            <Download className="h-3.5 w-3.5 text-slate-400" />
            Export JSON
          </button>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
          >
            <Upload className="h-3.5 w-3.5 text-slate-400" />
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
          <div className="mt-2 rounded-xl bg-brand-50 px-3 py-1.5 text-center text-xs font-semibold text-brand-700">
            {importFeedback}
          </div>
        )}

        <div className="mt-2 flex gap-2">
          <button
            type="button"
            onClick={handleClearViewed}
            disabled={viewedHistoryCount === 0}
            className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-slate-200 px-2.5 py-1.5 text-[11px] font-medium text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Eye className="h-3.5 w-3.5 text-slate-400" />
            Clear seen ({viewedHistoryCount})
          </button>
          {hiddenCount > 0 && (
            <button
              type="button"
              onClick={onClearHidden}
              className="inline-flex items-center justify-center gap-1 rounded-xl border border-slate-200 px-2.5 py-1.5 text-[11px] font-medium text-slate-600 transition hover:bg-slate-50"
            >
              <Trash2 className="h-3.5 w-3.5 text-slate-400" />
              Unhide ({hiddenCount})
            </button>
          )}
        </div>
      </section>

      {/* Card 7: Map Layers & Scrape Status */}
      <section className="space-y-3 rounded-2xl border border-slate-200/80 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <CardHeader icon={<Layers className="h-4 w-4" />} title="Map Layers" />

        <div className="space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-700">Transit line routes</span>
            <Switch
              checked={showTransitLines}
              onChange={onToggleTransitLines}
              label="Show transit line polylines on map"
            />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-700">Station markers</span>
            <Switch
              checked={showStations}
              onChange={onToggleStations}
              label="Show station markers on map"
            />
          </div>
        </div>

        <div className="border-t border-slate-100 pt-3 text-[11px] leading-relaxed text-slate-500">
          <div className="font-semibold text-slate-800">
            {loading ? "Refreshing listings…" : `${total} matching listing${total === 1 ? "" : "s"}`}
          </div>
          {meta ? (
            <div className="mt-1 space-y-0.5">
              <div>
                {meta.properties_near_transit} of {meta.active_properties} active near{" "}
                {meta.operational_stations} stations
              </div>
              <div>
                {meta.new_48h_count} new in 48h · {meta.price_drops_count} price drops
              </div>
              {meta.last_scrape && (
                <div>
                  Last sync:{" "}
                  {timeAgo(meta.last_scrape.finished_at ?? meta.last_scrape.started_at)} (
                  {meta.last_scrape.status})
                </div>
              )}
            </div>
          ) : (
            <div className="mt-1">Connecting to backend…</div>
          )}
        </div>
      </section>
    </div>
  );
}
