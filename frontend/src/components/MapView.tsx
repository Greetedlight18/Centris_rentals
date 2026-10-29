"use client";

import L from "leaflet";
import {
  Fragment,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import {
  Circle,
  MapContainer,
  Marker,
  Polyline,
  Popup,
  TileLayer,
  Tooltip,
  useMap,
  useMapEvents,
} from "react-leaflet";
import {
  Ban,
  Bath,
  BedDouble,
  Building2,
  Calendar,
  Car,
  ChevronLeft,
  ChevronRight,
  Compass,
  Crosshair,
  ExternalLink,
  EyeOff,
  Footprints,
  Heart,
  PawPrint,
  Ruler,
  Sparkles,
  StickyNote,
  TrendingDown,
  X,
} from "lucide-react";
import type { Network, Property, Station, TransitLine } from "@/services/api";
import {
  formatArea,
  formatBathrooms,
  formatBedrooms,
  formatPrice,
  formatPriceCompact,
  formatPricePerSqft,
  formatWalk,
  isNewListing,
  lineHexColor,
  lineLabel,
} from "@/lib/format";
import { groupByLocation, type LocationGroup } from "@/lib/grouping";
import type { SavedNote } from "@/lib/saved";
import {
  buildTransitPolylines,
  type CommuteDestination,
  type CommuteEstimate,
} from "@/lib/transit";

const MONTREAL_CENTER: [number, number] = [45.5088, -73.5878];
const DEFAULT_ZOOM = 11.5;
const FALLBACK_COLOR = "#475569";
const SEEN_COLOR = "#cbd5e1";

export interface MapFocus {
  id: number;
  token: number;
}

export interface MapBounds {
  north: number;
  south: number;
  east: number;
  west: number;
}

interface MapViewProps {
  properties: Property[];
  stations: Station[];
  selectedId: number | null;
  hoveredId: number | null;
  focus: MapFocus | null;
  fitToken: number;
  showStations: boolean;
  showTransitLines: boolean;
  activeLines: TransitLine[];
  activeStationName: string | null;
  walkRadiusMeters: number;
  filterByBounds: boolean;
  onToggleFilterByBounds: (value: boolean) => void;
  onBoundsChange: (bounds: MapBounds) => void;
  destination: CommuteDestination | null;
  pickingDestination: boolean;
  onPickDestination: (lat: number, lon: number) => void;
  onCancelPickDestination: () => void;
  onClearDestination: () => void;
  commuteById: Map<number, CommuteEstimate>;
  viewedIds: Set<string>;
  favoriteIds: Set<string>;
  notes: Record<string, SavedNote>;
  onSelect: (id: number | null) => void;
  onDeselect: (id: number) => void;
  onHover: (id: number | null) => void;
  onOpenDetail: (id: number) => void;
  onToggleStation: (stationName: string) => void;
  onView: (centrisId: string) => void;
  onUnview: (centrisId: string) => void;
  onToggleFavorite: (centrisId: string) => void;
  onToggleHidden: (centrisId: string) => void;
}

function safeColor(value: string | undefined | null): string {
  return value && /^#[0-9a-fA-F]{6}$/.test(value) ? value : FALLBACK_COLOR;
}

/* ------------------------------------------------------------------ */
/* Station grouping and icons                                          */
/* ------------------------------------------------------------------ */
interface StationLine {
  line: string;
  color: string;
  branch: string | null;
}

interface StationGroup {
  key: string;
  name: string;
  network: Network;
  latitude: number;
  longitude: number;
  verified: boolean;
  lines: StationLine[];
}

function groupStations(stations: Station[]): StationGroup[] {
  const groups = new Map<string, StationGroup>();
  for (const station of stations) {
    const key = `${station.network}|${station.name}`;
    const entry: StationLine = {
      line: station.line,
      color: safeColor(station.line_color),
      branch: station.branch,
    };
    const existing = groups.get(key);
    if (existing) {
      if (!existing.lines.some((l) => l.line === entry.line)) {
        existing.lines.push(entry);
      }
      existing.verified = existing.verified && station.coords_verified;
    } else {
      groups.set(key, {
        key,
        name: station.name,
        network: station.network,
        latitude: station.latitude,
        longitude: station.longitude,
        verified: station.coords_verified,
        lines: [entry],
      });
    }
  }
  return Array.from(groups.values());
}

const stationIconCache = new Map<string, L.DivIcon>();

function stationIcon(group: StationGroup, isActive: boolean): L.DivIcon {
  const colors = group.lines.map((l) => l.color);
  const cacheKey = `${group.network}|${colors.join(",")}|${isActive ? 1 : 0}`;
  const cached = stationIconCache.get(cacheKey);
  if (cached) return cached;

  const background =
    colors.length === 1
      ? colors[0]
      : `conic-gradient(${colors
          .map((color, index) => {
            const start = ((index / colors.length) * 100).toFixed(2);
            const end = (((index + 1) / colors.length) * 100).toFixed(2);
            return `${color} ${start}% ${end}%`;
          })
          .join(", ")})`;

  const isRem = group.network === "REM";
  const size = isRem ? 24 : 22;
  const icon = L.divIcon({
    className: "station-marker-icon",
    html: `<div class="station-marker ${isRem ? "station-rem" : "station-metro"}${
      isActive ? " is-active-station" : ""
    }" style="background:${background}"><span>${isRem ? "R" : "M"}</span></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
  stationIconCache.set(cacheKey, icon);
  return icon;
}

const destinationIcon = L.divIcon({
  className: "dest-marker-icon",
  html: `<div class="dest-pin">★</div>`,
  iconSize: [30, 30],
  iconAnchor: [15, 15],
});

/* ------------------------------------------------------------------ */
/* Property icons                                                      */
/* ------------------------------------------------------------------ */
const priceIconCache = new Map<string, L.DivIcon>();

function priceIcon(
  label: string,
  color: string,
  selected: boolean,
  hovered: boolean,
  seen: boolean,
  favorited: boolean,
  hasDrop: boolean,
  count: number,
): L.DivIcon {
  const cacheKey = `${label}|${color}|${selected ? 1 : 0}|${hovered ? 1 : 0}|${seen ? 1 : 0}|${
    favorited ? 1 : 0
  }|${hasDrop ? 1 : 0}|${count}`;
  const cached = priceIconCache.get(cacheKey);
  if (cached) return cached;

  const dropSpan = hasDrop ? `<span class="pill-drop">↓</span>` : "";
  const badge = count > 1 ? `<span class="pill-count">${count}</span>` : "";
  const favBadge = favorited ? `<span class="pill-fav">♥</span>` : "";
  const icon = L.divIcon({
    className: "price-marker",
    html: `<div class="price-pill${selected ? " is-selected" : ""}${
      hovered ? " is-hovered" : ""
    }${seen ? " is-viewed" : ""}" style="--pill-color:${color}">${favBadge}${dropSpan}${label}${badge}</div>`,
    iconSize: [0, 0],
    iconAnchor: [0, 0],
  });
  priceIconCache.set(cacheKey, icon);
  return icon;
}

/* ------------------------------------------------------------------ */
/* Location marker (one or more listings at the same coordinates)      */
/* ------------------------------------------------------------------ */
interface LocationMarkerProps {
  group: LocationGroup;
  selectedId: number | null;
  hoveredId: number | null;
  viewedIds: Set<string>;
  favoriteIds: Set<string>;
  notes: Record<string, SavedNote>;
  commuteById: Map<number, CommuteEstimate>;
  onSelect: (id: number | null) => void;
  onDeselect: (id: number) => void;
  onHover: (id: number | null) => void;
  onOpenDetail: (id: number) => void;
  onView: (centrisId: string) => void;
  onUnview: (centrisId: string) => void;
  onToggleFavorite: (centrisId: string) => void;
  onToggleHidden: (centrisId: string) => void;
  register: (key: string, marker: L.Marker | null) => void;
}

const LocationMarker = memo(function LocationMarker({
  group,
  selectedId,
  hoveredId,
  viewedIds,
  favoriteIds,
  notes,
  commuteById,
  onSelect,
  onDeselect,
  onHover,
  onOpenDetail,
  onView,
  onUnview,
  onToggleFavorite,
  onToggleHidden,
  register,
}: LocationMarkerProps) {
  const items = group.items;
  const [activeId, setActiveId] = useState<number>(items[0].id);
  const popupRef = useRef<L.Popup | null>(null);
  const stripRef = useRef<HTMLDivElement | null>(null);

  const active = items.find((item) => item.id === activeId) ?? items[0];
  const activeIndex = items.indexOf(active);
  const multiple = items.length > 1;

  const activeRef = useRef(active);
  activeRef.current = active;

  useEffect(() => {
    if (selectedId !== null && items.some((item) => item.id === selectedId)) {
      setActiveId(selectedId);
    }
  }, [selectedId, items]);

  useEffect(() => {
    popupRef.current?.update();
  }, [active.id]);

  useEffect(() => {
    const strip = stripRef.current;
    if (!strip) return;
    const chip = strip.querySelector<HTMLElement>('[data-active="true"]');
    if (!chip) return;
    const left = chip.offsetLeft - strip.clientWidth / 2 + chip.clientWidth / 2;
    strip.scrollTo({ left: Math.max(0, left), behavior: "smooth" });
  }, [active.id]);

  const containsSelected = selectedId !== null && items.some((item) => item.id === selectedId);
  const containsHovered = hoveredId !== null && items.some((item) => item.id === hoveredId);
  const anyFavorited = items.some((item) => favoriteIds.has(item.centris_id));
  const anyDrop = items.some((item) => item.price_drop !== null && item.price_drop > 0);
  const allViewed = items.every((item) => viewedIds.has(item.centris_id));

  const activeViewed = viewedIds.has(active.centris_id);
  const activeFavorited = favoriteIds.has(active.centris_id);
  const activeNote = notes[active.centris_id];
  const activeCommute = commuteById.get(active.id);
  const isNew = isNewListing(active.first_seen_at);
  const showAsSeen = allViewed && !containsSelected && !containsHovered && !anyFavorited;

  const lineColor = safeColor(active.station_color);
  const pillColor = showAsSeen ? SEEN_COLOR : lineColor;

  const icon = useMemo(
    () =>
      priceIcon(
        formatPriceCompact(items[0].price),
        pillColor,
        containsSelected,
        containsHovered,
        showAsSeen,
        anyFavorited,
        anyDrop,
        items.length,
      ),
    [items, pillColor, containsSelected, containsHovered, showAsSeen, anyFavorited, anyDrop],
  );

  const handlers = useMemo(
    () => ({
      click: () => onSelect(activeRef.current.id),
      mouseover: () => onHover(activeRef.current.id),
      mouseout: () => onHover(null),
      popupopen: () => {
        onSelect(activeRef.current.id);
        onView(activeRef.current.centris_id);
      },
      popupclose: () => onDeselect(activeRef.current.id),
    }),
    [onSelect, onHover, onView, onDeselect],
  );

  const goTo = useCallback(
    (target: Property) => {
      setActiveId(target.id);
      onSelect(target.id);
      onView(target.centris_id);
    },
    [onSelect, onView],
  );

  const step = useCallback(
    (delta: number) => {
      const next = items[(activeIndex + delta + items.length) % items.length];
      goTo(next);
    },
    [items, activeIndex, goTo],
  );

  const walk = formatWalk(active.walk_minutes, active.nearest_station_distance_m);
  const area = formatArea(active.net_area_sqft);
  const ppsqft = formatPricePerSqft(active.price_per_sqft);
  const oldPrice =
    active.previous_price && active.price && active.previous_price > active.price
      ? active.previous_price
      : active.initial_price && active.price && active.initial_price > active.price
        ? active.initial_price
        : null;

  const address = [
    active.address,
    active.city && !active.address?.includes(active.city) ? active.city : null,
  ]
    .filter(Boolean)
    .join(", ");

  const allLines =
    active.reachable_lines && active.reachable_lines.length > 0
      ? active.reachable_lines
      : [active.station_line];

  const heroPhoto = active.image_url ?? active.photo_urls?.[0] ?? null;

  const zIndex = containsHovered
    ? 3200
    : containsSelected
      ? 2600
      : anyFavorited
        ? 1800
        : showAsSeen
          ? 500
          : 1000;

  return (
    <Marker
      position={[group.latitude, group.longitude]}
      icon={icon}
      zIndexOffset={zIndex}
      eventHandlers={handlers}
      ref={(marker) => register(group.key, marker)}
    >
      <Popup ref={popupRef} minWidth={268} maxWidth={292} closeButton>
        <div className="w-[268px]">
          {multiple && (
            <div className="border-b border-slate-100 bg-slate-50 py-2 pl-3 pr-9">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-700">
                  <Building2 className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
                  {items.length} units here
                </div>
                <div className="flex items-center gap-0.5">
                  <button
                    type="button"
                    onClick={() => step(-1)}
                    aria-label="Previous unit"
                    className="inline-flex h-6 w-6 items-center justify-center rounded-md text-slate-600 transition hover:bg-slate-200"
                  >
                    <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                  </button>
                  <span className="min-w-[38px] text-center text-xs font-medium tabular-nums text-slate-600">
                    {activeIndex + 1} / {items.length}
                  </span>
                  <button
                    type="button"
                    onClick={() => step(1)}
                    aria-label="Next unit"
                    className="inline-flex h-6 w-6 items-center justify-center rounded-md text-slate-600 transition hover:bg-slate-200"
                  >
                    <ChevronRight className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
              </div>
              <div
                ref={stripRef}
                role="tablist"
                aria-label="Units at this address"
                className="relative mt-2 flex gap-1.5 overflow-x-auto pb-1"
              >
                {items.map((item) => {
                  const isActive = item.id === active.id;
                  const isSeen = viewedIds.has(item.centris_id);
                  return (
                    <button
                      key={item.id}
                      type="button"
                      role="tab"
                      aria-selected={isActive}
                      data-active={isActive ? "true" : "false"}
                      onClick={() => goTo(item)}
                      className={`shrink-0 whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-semibold transition ${
                        isActive
                          ? "border-indigo-600 bg-indigo-600 text-white"
                          : isSeen
                            ? "border-slate-200 bg-slate-100 text-slate-400 hover:text-slate-600"
                            : "border-slate-300 bg-white text-slate-700 hover:border-indigo-400"
                      }`}
                    >
                      {formatPriceCompact(item.price)} · {formatBedrooms(item.bedrooms)}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {heroPhoto && (
            <div className="relative overflow-hidden bg-slate-100">
              <img
                key={active.id}
                src={heroPhoto}
                alt={active.title ?? address ?? "Rental listing"}
                referrerPolicy="no-referrer"
                className="h-36 w-full object-cover"
                onError={(event) => {
                  event.currentTarget.style.display = "none";
                }}
              />
              <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-slate-950/45 via-transparent to-slate-950/20" />
              <div className="absolute bottom-2.5 left-2.5 flex flex-wrap gap-1">
                {isNew && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-indigo-600 px-2 py-0.5 text-[10px] font-bold text-white shadow-sm">
                    <Sparkles className="h-2.5 w-2.5" /> New
                  </span>
                )}
                {active.price_drop && active.price_drop > 0 && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-600 px-2 py-0.5 text-[10px] font-bold text-white shadow-sm">
                    <TrendingDown className="h-2.5 w-2.5" />↓ {formatPrice(active.price_drop)}
                  </span>
                )}
              </div>
              <div className="absolute bottom-2.5 right-2.5 flex gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    popupRef.current?.close();
                    onToggleHidden(active.centris_id);
                  }}
                  aria-label="Hide listing"
                  title="Dismiss listing"
                  className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-white/90 text-slate-600 shadow-sm backdrop-blur-md transition hover:bg-white hover:text-slate-900"
                >
                  <Ban className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => onToggleFavorite(active.centris_id)}
                  aria-label={activeFavorited ? "Remove from favorites" : "Save to favorites"}
                  className={`inline-flex h-7 w-7 items-center justify-center rounded-full shadow-sm backdrop-blur-md transition ${
                    activeFavorited
                      ? "bg-rose-600 text-white"
                      : "bg-white/90 text-slate-700 hover:bg-white hover:text-rose-600"
                  }`}
                >
                  <Heart className={`h-3.5 w-3.5 ${activeFavorited ? "fill-current" : ""}`} />
                </button>
              </div>
            </div>
          )}

          <div className="space-y-2.5 p-3.5">
            <div className="flex items-baseline justify-between gap-2">
              <div className="flex items-baseline gap-1.5">
                <span className="text-lg font-bold text-slate-900">{formatPrice(active.price)}</span>
                {active.price !== null && (
                  <span className="text-xs font-medium text-slate-500">/mo</span>
                )}
                {oldPrice !== null && (
                  <span className="text-xs text-slate-400 line-through">
                    {formatPrice(oldPrice)}
                  </span>
                )}
              </div>
              {!heroPhoto && (
                <button
                  type="button"
                  onClick={() => onToggleFavorite(active.centris_id)}
                  aria-label="Toggle favorite"
                  className={`inline-flex h-7 w-7 items-center justify-center rounded-full border ${
                    activeFavorited
                      ? "border-rose-200 bg-rose-50 text-rose-600"
                      : "border-slate-200 text-slate-500"
                  }`}
                >
                  <Heart className={`h-3.5 w-3.5 ${activeFavorited ? "fill-current" : ""}`} />
                </button>
              )}
              {ppsqft && <span className="text-[11px] font-semibold text-slate-500">{ppsqft}</span>}
            </div>

            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-medium text-slate-700">
              <span className="inline-flex items-center gap-1">
                <BedDouble className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
                {formatBedrooms(active.bedrooms)}
              </span>
              <span className="inline-flex items-center gap-1">
                <Bath className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
                {formatBathrooms(active.bathrooms)}
              </span>
              {area && (
                <span className="inline-flex items-center gap-1">
                  <Ruler className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
                  {area}
                </span>
              )}
            </div>

            {(active.available_immediately ||
              active.move_in_label ||
              active.pets_allowed === true ||
              active.parking_available) && (
              <div className="flex flex-wrap gap-1">
                {(active.available_immediately || active.move_in_label) && (
                  <span className="inline-flex items-center gap-1 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-700">
                    <Calendar className="h-2.5 w-2.5" />
                    {active.available_immediately ? "Immediate" : active.move_in_label}
                  </span>
                )}
                {active.pets_allowed === true && (
                  <span className="inline-flex items-center gap-1 rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">
                    <PawPrint className="h-2.5 w-2.5" /> Pets OK
                  </span>
                )}
                {active.parking_available && (
                  <span className="inline-flex items-center gap-1 rounded bg-slate-900 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                    <Car className="h-2.5 w-2.5" /> Parking
                  </span>
                )}
              </div>
            )}

            <div className="line-clamp-2 text-xs text-slate-600">
              {address || "Address not available"}
            </div>

            <div className="rounded-xl bg-slate-50 p-2.5 text-xs text-slate-700">
              <div className="flex items-center justify-between gap-1.5">
                <div className="flex min-w-0 items-center gap-1.5 font-semibold text-slate-900">
                  <div className="flex shrink-0 -space-x-1">
                    {allLines.slice(0, 4).map((ln) => (
                      <span
                        key={ln}
                        className="inline-block h-2.5 w-2.5 rounded-full ring-1 ring-white"
                        style={{ backgroundColor: lineHexColor(ln, lineColor) }}
                      />
                    ))}
                  </div>
                  <span className="truncate">{active.station_name}</span>
                </div>
                {activeCommute && (
                  <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-bold text-indigo-800">
                    <Compass className="h-2.5 w-2.5" />~{activeCommute.totalMinutes}m
                  </span>
                )}
              </div>
              <div className="mt-1 flex items-center justify-between text-[11px] text-slate-500">
                <span>
                  {allLines.length > 1
                    ? allLines.join(" · ")
                    : lineLabel(active.station_network, active.station_line)}
                </span>
                {walk && (
                  <span className="inline-flex items-center gap-1 font-semibold text-emerald-700">
                    <Footprints className="h-3 w-3" aria-hidden="true" />
                    {walk.minutes}
                  </span>
                )}
              </div>
            </div>

            {activeNote?.text && (
              <div className="flex items-start gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] text-amber-900">
                <StickyNote className="mt-0.5 h-3 w-3 shrink-0 text-amber-600" />
                <span className="line-clamp-2">{activeNote.text}</span>
              </div>
            )}

            <div className="flex gap-1.5 pt-0.5">
              <button
                type="button"
                onClick={() => onOpenDetail(active.id)}
                className="inline-flex flex-1 items-center justify-center rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs font-semibold text-slate-800 transition hover:bg-slate-50"
              >
                Details & Notes
              </button>
              <a
                href={active.url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => onView(active.centris_id)}
                className="popup-link inline-flex flex-1 items-center justify-center gap-1 rounded-lg bg-indigo-600 px-2.5 py-2 text-xs font-semibold transition hover:bg-indigo-700"
              >
                Centris
                <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
              </a>
            </div>

            {activeViewed && (
              <button
                type="button"
                onClick={() => onUnview(active.centris_id)}
                className="mx-auto flex items-center gap-1 text-[11px] text-slate-400 underline-offset-2 transition hover:text-slate-700 hover:underline"
              >
                <EyeOff className="h-3 w-3" aria-hidden="true" />
                Mark as unseen
              </button>
            )}
          </div>
        </div>
      </Popup>
    </Marker>
  );
});

/* ------------------------------------------------------------------ */
/* Trackpad gestures: two-finger pan + pinch zoom                      */
/* ------------------------------------------------------------------ */
const WHEEL_LINE_HEIGHT = 40;
const WHEEL_PAGE_HEIGHT = 800;
const TRACKPAD_STICKY_MS = 500;

function TrackpadGestures() {
  const map = useMap();

  useEffect(() => {
    const container = map.getContainer();

    let frame = 0;
    let panX = 0;
    let panY = 0;
    let zoomDelta = 0;
    let gestureTarget: number | null = null;
    let anchor = L.point(container.clientWidth / 2, container.clientHeight / 2);
    let gestureActive = false;
    let gestureStartZoom = 0;
    let lastTrackpadAt = 0;

    const anchorFromClient = (clientX: number, clientY: number): L.Point => {
      const rect = container.getBoundingClientRect();
      const x = Number.isFinite(clientX) ? clientX - rect.left : rect.width / 2;
      const y = Number.isFinite(clientY) ? clientY - rect.top : rect.height / 2;
      return L.point(x, y);
    };

    const flush = () => {
      frame = 0;
      const dx = panX;
      const dy = panY;
      const dz = zoomDelta;
      const target = gestureTarget;
      panX = 0;
      panY = 0;
      zoomDelta = 0;
      gestureTarget = null;

      if (dx !== 0 || dy !== 0) {
        map.panBy([dx, dy], { animate: false });
      }

      let nextZoom: number | null = null;
      if (target !== null) {
        nextZoom = target;
      } else if (dz !== 0) {
        nextZoom = map.getZoom() + dz;
      }
      if (nextZoom !== null) {
        const clamped = Math.min(map.getMaxZoom(), Math.max(map.getMinZoom(), nextZoom));
        if (Math.abs(clamped - map.getZoom()) > 0.001) {
          map.setZoomAround(anchor, clamped, { animate: false });
        }
      }
    };

    const schedule = () => {
      if (!frame) {
        frame = window.requestAnimationFrame(flush);
      }
    };

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      if (gestureActive) return;

      const unit =
        event.deltaMode === 1 ? WHEEL_LINE_HEIGHT : event.deltaMode === 2 ? WHEEL_PAGE_HEIGHT : 1;
      const dx = event.deltaX * unit;
      const dy = event.deltaY * unit;
      anchor = anchorFromClient(event.clientX, event.clientY);
      const now = performance.now();

      if (event.ctrlKey) {
        zoomDelta += Math.max(-50, Math.min(50, -dy)) / 100;
      } else {
        const looksLikeTrackpad =
          event.deltaMode === 0 && (dx !== 0 || Math.abs(dy) < 50 || !Number.isInteger(dy));
        if (looksLikeTrackpad) {
          lastTrackpadAt = now;
        }
        if (now - lastTrackpadAt < TRACKPAD_STICKY_MS) {
          panX += dx;
          panY += dy;
        } else {
          zoomDelta += Math.max(-120, Math.min(120, -dy)) / 200;
        }
      }
      schedule();
    };

    const onGestureStart = (event: Event) => {
      event.preventDefault();
      gestureActive = true;
      gestureStartZoom = map.getZoom();
    };

    const onGestureChange = (event: Event) => {
      event.preventDefault();
      const gesture = event as Event & { scale?: number; clientX?: number; clientY?: number };
      if (!gesture.scale || gesture.scale <= 0) return;
      anchor = anchorFromClient(gesture.clientX ?? Number.NaN, gesture.clientY ?? Number.NaN);
      gestureTarget = gestureStartZoom + Math.log2(gesture.scale);
      schedule();
    };

    const onGestureEnd = (event: Event) => {
      event.preventDefault();
      gestureActive = false;
    };

    container.addEventListener("wheel", onWheel, { passive: false });
    container.addEventListener("gesturestart", onGestureStart, { passive: false });
    container.addEventListener("gesturechange", onGestureChange, { passive: false });
    container.addEventListener("gestureend", onGestureEnd, { passive: false });

    return () => {
      container.removeEventListener("wheel", onWheel);
      container.removeEventListener("gesturestart", onGestureStart);
      container.removeEventListener("gesturechange", onGestureChange);
      container.removeEventListener("gestureend", onGestureEnd);
      if (frame) {
        window.cancelAnimationFrame(frame);
      }
    };
  }, [map]);

  return null;
}

/* ------------------------------------------------------------------ */
/* Map controllers                                                     */
/* ------------------------------------------------------------------ */
function ContainerResizeObserver() {
  const map = useMap();
  useEffect(() => {
    const container = map.getContainer();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      map.invalidateSize({ pan: false });
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [map]);
  return null;
}

function BoundsController({ onBoundsChange }: { onBoundsChange: (bounds: MapBounds) => void }) {
  const map = useMap();

  const report = useCallback(() => {
    const b = map.getBounds();
    onBoundsChange({
      north: b.getNorth(),
      south: b.getSouth(),
      east: b.getEast(),
      west: b.getWest(),
    });
  }, [map, onBoundsChange]);

  useEffect(() => {
    report();
  }, [report]);

  useMapEvents({
    moveend: report,
    zoomend: report,
  });

  return null;
}

function FitController({
  fitToken,
  properties,
  skipFirst,
  disabled,
}: {
  fitToken: number;
  properties: Property[];
  skipFirst: boolean;
  disabled: boolean;
}) {
  const map = useMap();
  const latest = useRef(properties);
  latest.current = properties;
  const first = useRef(true);

  useEffect(() => {
    if (disabled) return;
    if (first.current) {
      first.current = false;
      if (skipFirst) return;
    }
    const items = latest.current;
    if (items.length === 0) return;
    const bounds = L.latLngBounds(items.map((p) => L.latLng(p.latitude, p.longitude)));
    map.fitBounds(bounds, { padding: [56, 56], maxZoom: 15 });
  }, [fitToken, map, skipFirst, disabled]);

  return null;
}

function FocusController({
  focus,
  properties,
  groupKeyById,
  markers,
}: {
  focus: MapFocus | null;
  properties: Property[];
  groupKeyById: Map<number, string>;
  markers: MutableRefObject<Map<string, L.Marker>>;
}) {
  const map = useMap();
  const latest = useRef(properties);
  latest.current = properties;
  const latestKeys = useRef(groupKeyById);
  latestKeys.current = groupKeyById;

  useEffect(() => {
    if (!focus) return;
    const target = latest.current.find((p) => p.id === focus.id);
    if (!target) return;
    const key = latestKeys.current.get(target.id);
    map.flyTo([target.latitude, target.longitude], Math.max(map.getZoom(), 15), { duration: 0.8 });
    const timer = window.setTimeout(() => {
      if (key) {
        markers.current.get(key)?.openPopup();
      }
    }, 900);
    return () => window.clearTimeout(timer);
  }, [focus, map, markers]);

  return null;
}

function MapClickHandler({
  pickingDestination,
  onPickDestination,
  onSelect,
}: {
  pickingDestination: boolean;
  onPickDestination: (lat: number, lon: number) => void;
  onSelect: (id: number | null) => void;
}) {
  useMapEvents({
    click: (event) => {
      if (pickingDestination) {
        onPickDestination(event.latlng.lat, event.latlng.lng);
      } else {
        onSelect(null);
      }
    },
  });
  return null;
}

/* ------------------------------------------------------------------ */
/* Legend                                                              */
/* ------------------------------------------------------------------ */
function Legend() {
  return (
    <div className="pointer-events-none absolute bottom-4 left-4 z-[1000] hidden rounded-2xl border border-slate-200/80 bg-white/95 p-3 text-[11px] text-slate-700 shadow-card backdrop-blur-md xl:block">
      <div className="mb-1.5 font-bold uppercase tracking-wider text-slate-400">Map Guide</div>
      <ul className="space-y-1.5">
        <li className="flex items-center gap-2">
          <span
            className="inline-flex h-4 w-4 items-center justify-center rounded-full border-2 border-white bg-line-green text-[8px] font-extrabold text-white shadow"
            aria-hidden="true"
          >
            M
          </span>
          Metro ·{" "}
          <span
            className="inline-flex h-4 w-4 items-center justify-center rounded-[5px] border-2 border-white bg-line-rem text-[8px] font-extrabold text-white shadow"
            aria-hidden="true"
          >
            R
          </span>{" "}
          REM (click to filter)
        </li>
        <li className="flex items-center gap-2">
          <span className="rounded-full border-2 border-emerald-600 bg-white px-1.5 text-[10px] font-bold text-slate-900">
            <span className="text-emerald-600">↓</span>$
          </span>
          Price drop ·{" "}
          <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-rose-600 text-[9px] text-white">
            ♥
          </span>{" "}
          Saved
        </li>
        <li className="flex items-center gap-2">
          <span className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-white bg-indigo-600 text-[9px] font-bold text-white shadow">
            3
          </span>
          Multi-unit building
        </li>
      </ul>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Main component                                                      */
/* ------------------------------------------------------------------ */
export default function MapView({
  properties,
  stations,
  selectedId,
  hoveredId,
  focus,
  fitToken,
  showStations,
  showTransitLines,
  activeLines,
  activeStationName,
  walkRadiusMeters,
  filterByBounds,
  onToggleFilterByBounds,
  onBoundsChange,
  destination,
  pickingDestination,
  onPickDestination,
  onCancelPickDestination,
  onClearDestination,
  commuteById,
  viewedIds,
  favoriteIds,
  notes,
  onSelect,
  onDeselect,
  onHover,
  onOpenDetail,
  onToggleStation,
  onView,
  onUnview,
  onToggleFavorite,
  onToggleHidden,
}: MapViewProps) {
  const markers = useRef(new Map<string, L.Marker>());
  const mountedWithFocus = useRef(focus !== null);

  const register = useCallback((key: string, marker: L.Marker | null) => {
    if (marker) {
      markers.current.set(key, marker);
    } else {
      markers.current.delete(key);
    }
  }, []);

  const stationGroups = useMemo(() => groupStations(stations), [stations]);
  const polylines = useMemo(() => buildTransitPolylines(stations), [stations]);
  const locationGroups = useMemo(() => groupByLocation(properties), [properties]);

  const groupKeyById = useMemo(() => {
    const lookup = new Map<number, string>();
    for (const group of locationGroups) {
      for (const item of group.items) {
        lookup.set(item.id, group.key);
      }
    }
    return lookup;
  }, [locationGroups]);

  const activeProperty = useMemo(
    () => properties.find((p) => p.id === (hoveredId ?? selectedId)) ?? null,
    [properties, hoveredId, selectedId],
  );
  const activePropertyStation = useMemo(
    () =>
      activeProperty ? stations.find((s) => s.id === activeProperty.station_id) ?? null : null,
    [activeProperty, stations],
  );
  const filteredStationGroup = useMemo(
    () =>
      activeStationName
        ? stationGroups.find((g) => g.name.toLowerCase() === activeStationName.toLowerCase()) ??
          null
        : null,
    [stationGroups, activeStationName],
  );

  return (
    <div className={`relative isolate h-full w-full ${pickingDestination ? "map-pick-mode" : ""}`}>
      {/* Floating Top-Right Map Controls */}
      <div className="pointer-events-none absolute right-3 top-3 z-[1000] flex flex-col items-end gap-2">
        <button
          type="button"
          aria-pressed={filterByBounds}
          onClick={() => onToggleFilterByBounds(!filterByBounds)}
          className={`pointer-events-auto inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-xs font-semibold shadow-card backdrop-blur-md transition ${
            filterByBounds
              ? "border-brand-600 bg-brand-600 text-white"
              : "border-slate-200/90 bg-white/95 text-slate-700 hover:bg-white"
          }`}
        >
          <span
            className={`h-2 w-2 rounded-full ${
              filterByBounds ? "bg-white" : "bg-slate-300"
            }`}
          />
          Search map area
        </button>

        {destination && !pickingDestination && (
          <div className="pointer-events-auto inline-flex items-center gap-1.5 rounded-full border border-slate-200/90 bg-slate-900/90 px-3 py-1 text-xs font-medium text-white shadow-card backdrop-blur-md">
            <Compass className="h-3.5 w-3.5 text-brand-300" />
            <span className="max-w-[160px] truncate">{destination.label}</span>
            <button
              type="button"
              onClick={onClearDestination}
              aria-label="Clear commute destination"
              className="ml-0.5 rounded-full p-0.5 text-slate-300 hover:bg-white/15 hover:text-white"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        )}
      </div>

      {/* Picking destination banner */}
      {pickingDestination && (
        <div className="pointer-events-none absolute inset-x-4 top-3 z-[1000] flex justify-center">
          <div className="pointer-events-auto inline-flex items-center gap-2.5 rounded-full bg-slate-900 px-4 py-2 text-xs font-semibold text-white shadow-xl">
            <Crosshair className="h-4 w-4 animate-pulse text-brand-400" />
            Click anywhere on the map to set your commute destination
            <button
              type="button"
              onClick={onCancelPickDestination}
              className="rounded-full bg-white/15 px-2.5 py-0.5 text-xs hover:bg-white/25"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <MapContainer
        center={MONTREAL_CENTER}
        zoom={DEFAULT_ZOOM}
        zoomSnap={0}
        scrollWheelZoom={false}
        className="h-full w-full"
        preferCanvas
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
          maxZoom={19}
        />

        <ContainerResizeObserver />
        <TrackpadGestures />
        <BoundsController onBoundsChange={onBoundsChange} />
        <MapClickHandler
          pickingDestination={pickingDestination}
          onPickDestination={onPickDestination}
          onSelect={onSelect}
        />

        {/* Transit Line Polylines (White casing + Colored inner line) */}
        {showTransitLines &&
          polylines.map((segment) => {
            const dimmed = activeLines.length > 0 && !activeLines.includes(segment.line);
            return (
              <Fragment key={segment.id}>
                <Polyline
                  positions={segment.positions}
                  pathOptions={{
                    color: "#ffffff",
                    weight: dimmed ? 4 : 6.5,
                    opacity: dimmed ? 0.45 : 0.88,
                    lineCap: "round",
                    lineJoin: "round",
                  }}
                  interactive={false}
                />
                <Polyline
                  positions={segment.positions}
                  pathOptions={{
                    color: segment.color,
                    weight: dimmed ? 2.2 : 3.8,
                    opacity: dimmed ? 0.32 : 0.9,
                    lineCap: "round",
                    lineJoin: "round",
                  }}
                  interactive={false}
                />
              </Fragment>
            );
          })}

        {/* Active filtered station walk circle */}
        {filteredStationGroup && (
          <Circle
            center={[filteredStationGroup.latitude, filteredStationGroup.longitude]}
            radius={walkRadiusMeters}
            pathOptions={{
              color: filteredStationGroup.lines[0]?.color ?? "#4f46e5",
              weight: 2.5,
              dashArray: "6 6",
              fillOpacity: 0.08,
            }}
            interactive={false}
          />
        )}

        {/* Station Markers */}
        {showStations &&
          stationGroups.map((group) => {
            const isActive =
              activeStationName !== null &&
              group.name.toLowerCase() === activeStationName.toLowerCase();
            return (
              <Marker
                key={group.key}
                position={[group.latitude, group.longitude]}
                icon={stationIcon(group, isActive)}
                zIndexOffset={isActive ? 2200 : 100}
                eventHandlers={{
                  click: () => onToggleStation(group.name),
                }}
              >
                <Tooltip direction="top" offset={[0, -10]}>
                  <div className="text-xs font-bold text-slate-900">{group.name}</div>
                  <div className="mt-0.5 space-y-0.5">
                    {group.lines.map((l) => (
                      <div
                        key={l.line}
                        className="flex items-center gap-1.5 text-[11px] text-slate-700"
                      >
                        <span
                          className="inline-block h-2 w-2 rounded-full"
                          style={{ backgroundColor: l.color }}
                        />
                        {group.network === "REM"
                          ? `REM${l.branch ? ` · ${l.branch}` : ""}`
                          : `${l.line} line`}
                      </div>
                    ))}
                    <div className="pt-1 text-[10px] font-semibold text-brand-600">
                      {isActive ? "Active filter · Click to clear" : "Click to filter nearby rentals"}
                    </div>
                  </div>
                </Tooltip>
              </Marker>
            );
          })}

        {/* Selected / Hovered Property Walk Line */}
        {activeProperty && activePropertyStation && (
          <>
            {!filteredStationGroup && (
              <Circle
                center={[activePropertyStation.latitude, activePropertyStation.longitude]}
                radius={walkRadiusMeters}
                pathOptions={{
                  color: safeColor(activePropertyStation.line_color),
                  weight: 2,
                  dashArray: "6 6",
                  fillOpacity: 0.06,
                }}
                interactive={false}
              />
            )}
            <Polyline
              positions={[
                [activeProperty.latitude, activeProperty.longitude],
                [activePropertyStation.latitude, activePropertyStation.longitude],
              ]}
              pathOptions={{
                color: safeColor(activePropertyStation.line_color),
                weight: 3,
                dashArray: "4 6",
              }}
              interactive={false}
            />
          </>
        )}

        {/* Commute Destination Marker */}
        {destination && (
          <Marker
            position={[destination.latitude, destination.longitude]}
            icon={destinationIcon}
            zIndexOffset={3500}
          >
            <Tooltip direction="top" offset={[0, -14]}>
              <div className="text-xs font-bold text-slate-900">
                Commute Destination: {destination.label}
              </div>
            </Tooltip>
          </Marker>
        )}

        {/* Property Price Pills */}
        {locationGroups.map((group) => (
          <LocationMarker
            key={group.key}
            group={group}
            selectedId={selectedId}
            hoveredId={hoveredId}
            viewedIds={viewedIds}
            favoriteIds={favoriteIds}
            notes={notes}
            commuteById={commuteById}
            onSelect={onSelect}
            onDeselect={onDeselect}
            onHover={onHover}
            onOpenDetail={onOpenDetail}
            onView={onView}
            onUnview={onUnview}
            onToggleFavorite={onToggleFavorite}
            onToggleHidden={onToggleHidden}
            register={register}
          />
        ))}

        <FitController
          fitToken={fitToken}
          properties={properties}
          skipFirst={mountedWithFocus.current}
          disabled={filterByBounds}
        />
        <FocusController
          focus={focus}
          properties={properties}
          groupKeyById={groupKeyById}
          markers={markers}
        />
      </MapContainer>
      <Legend />
    </div>
  );
}
