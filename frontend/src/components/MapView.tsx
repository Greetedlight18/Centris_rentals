"use client";

import L from "leaflet";
import { memo, useCallback, useEffect, useMemo, useRef } from "react";
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
import { Bath, BedDouble, Car, ExternalLink, EyeOff, Footprints, Ruler } from "lucide-react";
import type { Network, Property, Station } from "@/services/api";
import {
  formatArea,
  formatBathrooms,
  formatBedrooms,
  formatPrice,
  formatPriceCompact,
  formatWalk,
  lineLabel,
} from "@/lib/format";

const MONTREAL_CENTER: [number, number] = [45.5088, -73.5878];
const DEFAULT_ZOOM = 11;
const FALLBACK_COLOR = "#475569";
const SEEN_COLOR = "#cbd5e1";

export interface MapFocus {
  id: number;
  token: number;
}

interface MapViewProps {
  properties: Property[];
  stations: Station[];
  selectedId: number | null;
  focus: MapFocus | null;
  fitToken: number;
  showStations: boolean;
  walkRadiusMeters: number;
  viewedIds: Set<string>;
  onSelect: (id: number | null) => void;
  onDeselect: (id: number) => void;
  onView: (centrisId: string) => void;
  onUnview: (centrisId: string) => void;
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

function stationIcon(group: StationGroup): L.DivIcon {
  const colors = group.lines.map((l) => l.color);
  const cacheKey = `${group.network}|${colors.join(",")}`;
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
    html: `<div class="station-marker ${isRem ? "station-rem" : "station-metro"}" style="background:${background}"><span>${
      isRem ? "R" : "M"
    }</span></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
  stationIconCache.set(cacheKey, icon);
  return icon;
}

/* ------------------------------------------------------------------ */
/* Property icons                                                      */
/* ------------------------------------------------------------------ */
const priceIconCache = new Map<string, L.DivIcon>();

function priceIcon(label: string, color: string, selected: boolean, seen: boolean): L.DivIcon {
  const cacheKey = `${label}|${color}|${selected ? 1 : 0}|${seen ? 1 : 0}`;
  const cached = priceIconCache.get(cacheKey);
  if (cached) return cached;

  const icon = L.divIcon({
    className: "price-marker",
    html: `<div class="price-pill${selected ? " is-selected" : ""}${
      seen ? " is-viewed" : ""
    }" style="--pill-color:${color}">${label}</div>`,
    iconSize: [0, 0],
    iconAnchor: [0, 0],
  });
  priceIconCache.set(cacheKey, icon);
  return icon;
}

/* ------------------------------------------------------------------ */
/* Property marker + popup                                             */
/* ------------------------------------------------------------------ */
interface PropertyMarkerProps {
  property: Property;
  selected: boolean;
  viewed: boolean;
  onSelect: (id: number | null) => void;
  onDeselect: (id: number) => void;
  onView: (centrisId: string) => void;
  onUnview: (centrisId: string) => void;
  register: (id: number, marker: L.Marker | null) => void;
}

const PropertyMarker = memo(function PropertyMarker({
  property,
  selected,
  viewed,
  onSelect,
  onDeselect,
  onView,
  onUnview,
  register,
}: PropertyMarkerProps) {
  const lineColor = safeColor(property.station_color);
  const showAsSeen = viewed && !selected;
  const pillColor = showAsSeen ? SEEN_COLOR : lineColor;
  const icon = useMemo(
    () => priceIcon(formatPriceCompact(property.price), pillColor, selected, showAsSeen),
    [property.price, pillColor, selected, showAsSeen],
  );
  const handlers = useMemo(
    () => ({
      click: () => onSelect(property.id),
      popupopen: () => onView(property.centris_id),
      popupclose: () => onDeselect(property.id),
    }),
    [onSelect, onView, onDeselect, property.id, property.centris_id],
  );
  const walk = formatWalk(property.walk_minutes, property.nearest_station_distance_m);
  const area = formatArea(property.net_area_sqft);
  const address = [
    property.address,
    property.city && !property.address?.includes(property.city) ? property.city : null,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <Marker
      position={[property.latitude, property.longitude]}
      icon={icon}
      zIndexOffset={selected ? 2000 : showAsSeen ? 500 : 1000}
      eventHandlers={handlers}
      ref={(marker) => register(property.id, marker)}
    >
      <Popup minWidth={250} maxWidth={280} closeButton>
        <div className="w-[250px]">
          {property.image_url && (
            <img
              src={property.image_url}
              alt={property.title ?? address ?? "Rental listing"}
              referrerPolicy="no-referrer"
              className="h-32 w-full object-cover"
              onError={(event) => {
                event.currentTarget.style.display = "none";
              }}
            />
          )}
          <div className="space-y-2 p-3">
            <div className="flex items-baseline justify-between gap-2">
              <div className="text-lg font-bold text-slate-900">
                {formatPrice(property.price)}
                {property.price !== null && (
                  <span className="text-xs font-medium text-slate-500"> /mo</span>
                )}
              </div>
              {property.parking_available && (
                <span className="inline-flex items-center gap-1 rounded-full bg-slate-900 px-2 py-0.5 text-[11px] font-medium text-white">
                  <Car className="h-3 w-3" aria-hidden="true" />
                  Parking
                </span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-700">
              <span className="inline-flex items-center gap-1">
                <BedDouble className="h-4 w-4 text-slate-400" aria-hidden="true" />
                {formatBedrooms(property.bedrooms)}
              </span>
              <span className="inline-flex items-center gap-1">
                <Bath className="h-4 w-4 text-slate-400" aria-hidden="true" />
                {formatBathrooms(property.bathrooms)}
              </span>
              {area && (
                <span className="inline-flex items-center gap-1" title="Net area">
                  <Ruler className="h-4 w-4 text-slate-400" aria-hidden="true" />
                  {area}
                </span>
              )}
            </div>
            <div className="text-sm text-slate-600">{address || "Address not available"}</div>
            <div className="rounded-lg bg-slate-50 p-2 text-xs text-slate-700">
              <div className="flex items-center gap-1.5 font-semibold text-slate-900">
                <span
                  className="inline-block h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: lineColor }}
                />
                {property.station_name}
                <span className="font-normal text-slate-500">
                  · {lineLabel(property.station_network, property.station_line)}
                </span>
              </div>
              {walk && (
                <div className="mt-1 inline-flex items-center gap-1 font-medium text-emerald-700">
                  <Footprints className="h-3.5 w-3.5" aria-hidden="true" />
                  {walk.minutes} · {walk.distance}
                </div>
              )}
            </div>
            <a
              href={property.url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => onView(property.centris_id)}
              className="popup-link flex items-center justify-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium transition hover:bg-indigo-700"
            >
              <ExternalLink className="h-4 w-4" aria-hidden="true" />
              View on Centris
            </a>
            {viewed && (
              <button
                type="button"
                onClick={() => onUnview(property.centris_id)}
                className="mx-auto flex items-center gap-1 text-xs text-slate-500 underline-offset-2 transition hover:text-slate-800 hover:underline"
              >
                <EyeOff className="h-3.5 w-3.5" aria-hidden="true" />
                Marked as seen · mark as unseen
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
        // Trackpad pinch (Chrome, Edge, Firefox) or Ctrl + mouse wheel.
        zoomDelta += Math.max(-50, Math.min(50, -dy)) / 100;
      } else {
        const looksLikeTrackpad =
          event.deltaMode === 0 && (dx !== 0 || Math.abs(dy) < 50 || !Number.isInteger(dy));
        if (looksLikeTrackpad) {
          lastTrackpadAt = now;
        }
        if (now - lastTrackpadAt < TRACKPAD_STICKY_MS) {
          // Two-finger scroll: pan. The OS already applies natural-scroll direction.
          panX += dx;
          panY += dy;
        } else {
          // Notched mouse wheel: zoom.
          zoomDelta += Math.max(-120, Math.min(120, -dy)) / 200;
        }
      }
      schedule();
    };

    // Safari reports pinch as proprietary gesture events instead of ctrl+wheel.
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
function FitController({
  fitToken,
  properties,
  skipFirst,
}: {
  fitToken: number;
  properties: Property[];
  skipFirst: boolean;
}) {
  const map = useMap();
  const latest = useRef(properties);
  latest.current = properties;
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      if (skipFirst) return;
    }
    const items = latest.current;
    if (items.length === 0) return;
    const bounds = L.latLngBounds(items.map((p) => L.latLng(p.latitude, p.longitude)));
    map.fitBounds(bounds, { padding: [56, 56], maxZoom: 15 });
  }, [fitToken, map, skipFirst]);

  return null;
}

function FocusController({
  focus,
  properties,
  markers,
}: {
  focus: MapFocus | null;
  properties: Property[];
  markers: React.MutableRefObject<Map<number, L.Marker>>;
}) {
  const map = useMap();
  const latest = useRef(properties);
  latest.current = properties;

  useEffect(() => {
    if (!focus) return;
    const target = latest.current.find((p) => p.id === focus.id);
    if (!target) return;
    map.flyTo([target.latitude, target.longitude], Math.max(map.getZoom(), 15), { duration: 0.8 });
    const timer = window.setTimeout(() => {
      markers.current.get(focus.id)?.openPopup();
    }, 900);
    return () => window.clearTimeout(timer);
  }, [focus, map, markers]);

  return null;
}

function ClickToDeselect({ onSelect }: { onSelect: (id: number | null) => void }) {
  useMapEvents({
    click: () => onSelect(null),
  });
  return null;
}

/* ------------------------------------------------------------------ */
/* Legend                                                              */
/* ------------------------------------------------------------------ */
function Legend() {
  return (
    <div className="pointer-events-none absolute bottom-4 left-4 z-[1000] hidden rounded-xl bg-white/95 p-3 text-xs text-slate-700 shadow-card sm:block">
      <div className="mb-2 font-semibold text-slate-900">Legend</div>
      <ul className="space-y-1.5">
        <li className="flex items-center gap-2">
          <span
            className="inline-flex h-4 w-4 items-center justify-center rounded-full border-2 border-white bg-line-green text-[8px] font-extrabold text-white shadow"
            aria-hidden="true"
          >
            M
          </span>
          Metro station (round)
        </li>
        <li className="flex items-center gap-2">
          <span
            className="inline-flex h-4 w-4 items-center justify-center rounded-[5px] border-2 border-white bg-line-rem text-[8px] font-extrabold text-white shadow"
            aria-hidden="true"
          >
            R
          </span>
          REM station (square)
        </li>
        <li className="flex items-center gap-2">
          <span className="rounded-full border-2 border-slate-500 bg-white px-1.5 text-[10px] font-bold text-slate-900">
            $
          </span>
          Rental (border = nearest line)
        </li>
        <li className="flex items-center gap-2">
          <span className="rounded-full border-2 border-slate-300 bg-slate-100 px-1.5 text-[10px] font-bold text-slate-400">
            $
          </span>
          Rental you have seen
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
  focus,
  fitToken,
  showStations,
  walkRadiusMeters,
  viewedIds,
  onSelect,
  onDeselect,
  onView,
  onUnview,
}: MapViewProps) {
  const markers = useRef(new Map<number, L.Marker>());
  const mountedWithFocus = useRef(focus !== null);

  const register = useCallback((id: number, marker: L.Marker | null) => {
    if (marker) {
      markers.current.set(id, marker);
    } else {
      markers.current.delete(id);
    }
  }, []);

  const stationGroups = useMemo(() => groupStations(stations), [stations]);

  const selectedProperty = useMemo(
    () => properties.find((p) => p.id === selectedId) ?? null,
    [properties, selectedId],
  );
  const selectedStation = useMemo(
    () => (selectedProperty ? stations.find((s) => s.id === selectedProperty.station_id) ?? null : null),
    [selectedProperty, stations],
  );

  return (
    <div className="relative isolate h-full w-full">
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

        <TrackpadGestures />
        <ClickToDeselect onSelect={onSelect} />

        {showStations &&
          stationGroups.map((group) => (
            <Marker
              key={group.key}
              position={[group.latitude, group.longitude]}
              icon={stationIcon(group)}
              zIndexOffset={0}
              keyboard={false}
            >
              <Tooltip direction="top" offset={[0, -10]}>
                <div className="text-xs font-semibold text-slate-900">{group.name}</div>
                <div className="mt-0.5 space-y-0.5">
                  {group.lines.map((l) => (
                    <div key={l.line} className="flex items-center gap-1.5 text-[11px] text-slate-700">
                      <span
                        className="inline-block h-2 w-2 rounded-full"
                        style={{ backgroundColor: l.color }}
                      />
                      {group.network === "REM"
                        ? `REM${l.branch ? ` · ${l.branch}` : ""}`
                        : `${l.line} line`}
                    </div>
                  ))}
                  {!group.verified && (
                    <div className="pt-0.5 text-[10px] italic text-slate-500">Approximate position</div>
                  )}
                </div>
              </Tooltip>
            </Marker>
          ))}

        {selectedProperty && selectedStation && (
          <>
            <Circle
              center={[selectedStation.latitude, selectedStation.longitude]}
              radius={walkRadiusMeters}
              pathOptions={{
                color: safeColor(selectedStation.line_color),
                weight: 2,
                dashArray: "6 6",
                fillOpacity: 0.07,
              }}
              interactive={false}
            />
            <Polyline
              positions={[
                [selectedProperty.latitude, selectedProperty.longitude],
                [selectedStation.latitude, selectedStation.longitude],
              ]}
              pathOptions={{
                color: safeColor(selectedStation.line_color),
                weight: 3,
                dashArray: "4 6",
              }}
              interactive={false}
            />
          </>
        )}

        {properties.map((property) => (
          <PropertyMarker
            key={property.id}
            property={property}
            selected={property.id === selectedId}
            viewed={viewedIds.has(property.centris_id)}
            onSelect={onSelect}
            onDeselect={onDeselect}
            onView={onView}
            onUnview={onUnview}
            register={register}
          />
        ))}

        <FitController
          fitToken={fitToken}
          properties={properties}
          skipFirst={mountedWithFocus.current}
        />
        <FocusController focus={focus} properties={properties} markers={markers} />
      </MapContainer>
      <Legend />
    </div>
  );
}