"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Ban,
  Bath,
  BedDouble,
  Calendar,
  Car,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  Compass,
  ExternalLink,
  EyeOff,
  Flame,
  Footprints,
  Heart,
  ImageOff,
  MapPin,
  PawPrint,
  Ruler,
  Share2,
  Shirt,
  Snowflake,
  Sofa,
  Sparkles,
  StickyNote,
  Sun,
  TrendingDown,
  Wifi,
  X,
  Zap,
} from "lucide-react";
import {
  fetchPriceHistory,
  isAbortError,
  type PriceHistoryPoint,
  type Property,
} from "@/services/api";
import {
  daysOnMarketLabel,
  formatArea,
  formatBathrooms,
  formatBedrooms,
  formatDistance,
  formatPrice,
  formatPricePerSqft,
  isNewListing,
  lineHexColor,
} from "@/lib/format";
import type { CommuteDestination, CommuteEstimate } from "@/lib/transit";
import type { SavedNote } from "@/lib/saved";

interface PropertyDetailDrawerProps {
  property: Property | null;
  onClose: () => void;
  isFavorite: boolean;
  isHidden: boolean;
  isViewed: boolean;
  note: SavedNote | undefined;
  commute: CommuteEstimate | null;
  destination: CommuteDestination | null;
  onToggleFavorite: (centrisId: string) => void;
  onToggleHidden: (centrisId: string) => void;
  onUnview: (centrisId: string) => void;
  onSaveNote: (centrisId: string, text: string) => void;
  onShowOnMap: (id: number) => void;
  onSelectStation: (stationName: string) => void;
  onShareListing: (centrisId: string) => void;
}

function PriceSparkline({ points }: { points: PriceHistoryPoint[] }) {
  if (points.length < 2) return null;
  const prices = points.map((p) => p.price);
  const minP = Math.min(...prices);
  const maxP = Math.max(...prices);
  const span = Math.max(1, maxP - minP);
  const width = 280;
  const height = 56;
  const padX = 8;
  const padY = 8;

  const coords = points.map((pt, idx) => {
    const x = padX + (idx / (points.length - 1)) * (width - padX * 2);
    const y = height - padY - ((pt.price - minP) / span) * (height - padY * 2);
    return { x, y, price: pt.price };
  });

  const pathD = coords
    .map((c, idx) => `${idx === 0 ? "M" : "L"} ${c.x.toFixed(1)} ${c.y.toFixed(1)}`)
    .join(" ");

  const dropped = prices[prices.length - 1] < prices[0];
  const stroke = dropped ? "#059669" : "#4f46e5";

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="h-14 w-full overflow-visible"
      aria-label="Rent history chart"
    >
      <path d={pathD} fill="none" stroke={stroke} strokeWidth="2.5" strokeLinecap="round" />
      {coords.map((c, idx) => (
        <circle
          key={idx}
          cx={c.x}
          cy={c.y}
          r={idx === coords.length - 1 ? 4 : 3}
          fill="#ffffff"
          stroke={stroke}
          strokeWidth="2"
        />
      ))}
    </svg>
  );
}

export default function PropertyDetailDrawer({
  property,
  onClose,
  isFavorite,
  isHidden,
  isViewed,
  note,
  commute,
  destination,
  onToggleFavorite,
  onToggleHidden,
  onUnview,
  onSaveNote,
  onShowOnMap,
  onSelectStation,
  onShareListing,
}: PropertyDetailDrawerProps) {
  const [photoIndex, setPhotoIndex] = useState(0);
  const [failedUrls, setFailedUrls] = useState<Set<string>>(() => new Set());
  const [noteDraft, setNoteDraft] = useState("");
  const [copied, setCopied] = useState(false);
  const [historyPoints, setHistoryPoints] = useState<PriceHistoryPoint[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  const photos = useMemo(() => {
    if (!property) return [];
    const list: string[] = [];
    if (property.image_url) list.push(property.image_url);
    for (const url of property.photo_urls ?? []) {
      if (url && !list.includes(url)) list.push(url);
    }
    return list.filter((u) => !failedUrls.has(u));
  }, [property, failedUrls]);

  useEffect(() => {
    setPhotoIndex(0);
    setFailedUrls(new Set());
    setCopied(false);
    setNoteDraft(note?.text ?? "");
  }, [property?.centris_id]);

  useEffect(() => {
    setNoteDraft(note?.text ?? "");
  }, [note?.text]);

  useEffect(() => {
    if (!property) return;
    const controller = new AbortController();
    setLoadingHistory(true);
    fetchPriceHistory(property.centris_id, controller.signal)
      .then((res) => {
        if (!controller.signal.aborted) {
          setHistoryPoints(res.points);
        }
      })
      .catch((err) => {
        if (!isAbortError(err)) setHistoryPoints([]);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingHistory(false);
      });
    return () => controller.abort();
  }, [property?.centris_id]);

  useEffect(() => {
    if (!property) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      } else if (
        event.target instanceof HTMLTextAreaElement ||
        event.target instanceof HTMLInputElement
      ) {
        return;
      } else if (event.key === "ArrowLeft" && photos.length > 1) {
        setPhotoIndex((prev) => (prev - 1 + photos.length) % photos.length);
      } else if (event.key === "ArrowRight" && photos.length > 1) {
        setPhotoIndex((prev) => (prev + 1) % photos.length);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [property, onClose, photos.length]);

  if (!property) return null;

  const currentPhoto = photos[photoIndex] ?? null;
  const area = formatArea(property.net_area_sqft);
  const ppsqft = formatPricePerSqft(property.price_per_sqft);
  const isNew = isNewListing(property.first_seen_at);
  const ageLabel = daysOnMarketLabel(property.first_seen_at);
  const oldPrice =
    property.previous_price && property.price && property.previous_price > property.price
      ? property.previous_price
      : property.initial_price && property.price && property.initial_price > property.price
        ? property.initial_price
        : null;

  const locationLine = [
    property.address,
    property.city && !property.address?.includes(property.city) ? property.city : null,
  ]
    .filter(Boolean)
    .join(", ");

  const nearbyHubs =
    property.nearby_stations && property.nearby_stations.length > 0
      ? property.nearby_stations
      : [
          {
            station_id: property.station_id,
            name: property.station_name,
            network: property.station_network as "METRO" | "REM",
            lines: [property.station_line as "Green" | "Orange" | "Blue" | "Yellow" | "REM"],
            colors: [property.station_color],
            distance_m: property.nearest_station_distance_m ?? 0,
            walk_minutes: property.walk_minutes ?? 0,
          },
        ];

  const amenities: {
    name: string;
    status: string;
    state: "yes" | "no" | "unknown";
    icon: ReactNode;
  }[] = [
    {
      name: "Pets",
      status:
        property.pets_allowed === true
          ? "Allowed"
          : property.pets_allowed === false
            ? "No"
            : "—",
      state:
        property.pets_allowed === true
          ? "yes"
          : property.pets_allowed === false
            ? "no"
            : "unknown",
      icon: <PawPrint className="h-4 w-4" />,
    },
    {
      name: "Parking",
      status: property.parking_available ? "Yes" : "—",
      state: property.parking_available ? "yes" : "unknown",
      icon: <Car className="h-4 w-4" />,
    },
    {
      name: "In-unit laundry",
      status: property.laundry_in_unit ? "Yes" : "—",
      state: property.laundry_in_unit ? "yes" : "unknown",
      icon: <Shirt className="h-4 w-4" />,
    },
    {
      name: "Appliances",
      status: property.appliances_included ? "Included" : "—",
      state: property.appliances_included ? "yes" : "unknown",
      icon: <Sparkles className="h-4 w-4" />,
    },
    {
      name: "Heating",
      status: property.heating_included ? "Included" : "—",
      state: property.heating_included ? "yes" : "unknown",
      icon: <Flame className="h-4 w-4" />,
    },
    {
      name: "Hydro",
      status: property.hydro_included ? "Included" : "—",
      state: property.hydro_included ? "yes" : "unknown",
      icon: <Zap className="h-4 w-4" />,
    },
    {
      name: "Internet",
      status: property.internet_included ? "Included" : "—",
      state: property.internet_included ? "yes" : "unknown",
      icon: <Wifi className="h-4 w-4" />,
    },
    {
      name: "Air conditioning",
      status: property.air_conditioning ? "Yes" : "—",
      state: property.air_conditioning ? "yes" : "unknown",
      icon: <Snowflake className="h-4 w-4" />,
    },
    {
      name: "Balcony / patio",
      status: property.balcony ? "Yes" : "—",
      state: property.balcony ? "yes" : "unknown",
      icon: <Sun className="h-4 w-4" />,
    },
    {
      name: "Furnished",
      status: property.furnished ? "Yes" : "No",
      state: property.furnished ? "yes" : "unknown",
      icon: <Sofa className="h-4 w-4" />,
    },
  ];

  const handleShare = () => {
    onShareListing(property.centris_id);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end"
      role="dialog"
      aria-modal="true"
      aria-label="Listing details"
    >
      <div
        className="backdrop-fade absolute inset-0 bg-slate-900/45 backdrop-blur-[2px]"
        onClick={onClose}
      />

      <aside className="drawer-slide-right relative z-10 flex h-full w-full max-w-[540px] flex-col bg-white shadow-2xl">
        {/* Top bar */}
        <div className="flex shrink-0 items-center justify-between border-b border-slate-200/80 px-5 py-3.5">
          <div className="min-w-0">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              Centris #{property.centris_id}
            </div>
            <div className="truncate text-sm font-semibold text-slate-900">
              {property.property_type ?? "Rental Listing"}
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => onToggleFavorite(property.centris_id)}
              aria-label={isFavorite ? "Remove from favorites" : "Save to favorites"}
              title={isFavorite ? "Saved to shortlist" : "Save to shortlist"}
              className={`inline-flex h-9 w-9 items-center justify-center rounded-xl border transition ${
                isFavorite
                  ? "border-rose-200 bg-rose-50 text-rose-600"
                  : "border-slate-200 text-slate-600 hover:bg-slate-50"
              }`}
            >
              <Heart className={`h-4 w-4 ${isFavorite ? "fill-current" : ""}`} />
            </button>

            <button
              type="button"
              onClick={() => onToggleHidden(property.centris_id)}
              aria-label={isHidden ? "Unhide listing" : "Hide listing"}
              title={isHidden ? "Unhide listing" : "Dismiss / hide listing"}
              className={`inline-flex h-9 w-9 items-center justify-center rounded-xl border transition ${
                isHidden
                  ? "border-amber-200 bg-amber-50 text-amber-700"
                  : "border-slate-200 text-slate-600 hover:bg-slate-50"
              }`}
            >
              <Ban className="h-4 w-4" />
            </button>

            <button
              type="button"
              onClick={handleShare}
              aria-label="Copy link to listing"
              title="Copy shareable link"
              className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-slate-200 px-3 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
            >
              {copied ? (
                <>
                  <Check className="h-3.5 w-3.5 text-emerald-600" />
                  <span className="text-emerald-700">Copied</span>
                </>
              ) : (
                <>
                  <Share2 className="h-3.5 w-3.5" />
                  <span>Share</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={onClose}
              aria-label="Close details"
              className="inline-flex h-9 w-9 items-center justify-center rounded-xl text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto">
          {/* Photo carousel */}
          <div className="relative aspect-[16/10] w-full bg-slate-100">
            {currentPhoto ? (
              <img
                src={currentPhoto}
                alt={locationLine || "Rental photo"}
                referrerPolicy="no-referrer"
                onError={() =>
                  setFailedUrls((prev) => {
                    const next = new Set(prev);
                    next.add(currentPhoto);
                    return next;
                  })
                }
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-slate-400">
                <ImageOff className="h-9 w-9 stroke-[1.5]" />
                <span className="text-xs font-medium">No photo available</span>
              </div>
            )}

            {photos.length > 1 && (
              <>
                <button
                  type="button"
                  onClick={() => setPhotoIndex((prev) => (prev - 1 + photos.length) % photos.length)}
                  aria-label="Previous photo"
                  className="absolute left-3 top-1/2 -translate-y-1/2 rounded-full bg-slate-900/65 p-2 text-white backdrop-blur-sm transition hover:bg-slate-900/85"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setPhotoIndex((prev) => (prev + 1) % photos.length)}
                  aria-label="Next photo"
                  className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full bg-slate-900/65 p-2 text-white backdrop-blur-sm transition hover:bg-slate-900/85"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
                <div className="absolute bottom-3 right-3 rounded-full bg-slate-900/75 px-3 py-1 text-xs font-semibold tabular-nums text-white backdrop-blur-sm">
                  {photoIndex + 1} / {photos.length}
                </div>
              </>
            )}

            <div className="absolute left-3 top-3 flex flex-wrap gap-1.5">
              {isNew && (
                <span className="inline-flex items-center gap-1 rounded-full bg-brand-600 px-2.5 py-1 text-xs font-semibold text-white shadow">
                  <Sparkles className="h-3 w-3" />
                  New
                </span>
              )}
              {property.price_drop && property.price_drop > 0 && (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-600 px-2.5 py-1 text-xs font-semibold text-white shadow">
                  <TrendingDown className="h-3.5 w-3.5" />
                  ↓ {formatPrice(property.price_drop)}
                </span>
              )}
            </div>
          </div>

          <div className="space-y-6 p-5 sm:p-6">
            {/* Price & Address */}
            <div>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div className="flex items-baseline gap-2">
                  <span className="text-2xl font-extrabold tracking-tight text-slate-900">
                    {formatPrice(property.price)}
                  </span>
                  {property.price !== null && (
                    <span className="text-sm font-medium text-slate-500">/month</span>
                  )}
                  {oldPrice !== null && (
                    <span className="text-sm font-medium text-slate-400 line-through">
                      {formatPrice(oldPrice)}
                    </span>
                  )}
                </div>
                {ppsqft && (
                  <span className="rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-semibold tabular-nums text-slate-700">
                    {ppsqft}
                  </span>
                )}
              </div>

              <div className="mt-1.5 text-base font-semibold text-slate-800">
                {locationLine || "Address on Centris"}
              </div>
              {ageLabel && (
                <div className="mt-1 flex items-center gap-1.5 text-xs text-slate-500">
                  <Clock className="h-3.5 w-3.5" />
                  {ageLabel}
                  {isViewed && (
                    <>
                      <span>·</span>
                      <button
                        type="button"
                        onClick={() => onUnview(property.centris_id)}
                        className="inline-flex items-center gap-1 font-medium text-slate-500 underline-offset-2 hover:text-slate-800 hover:underline"
                      >
                        <EyeOff className="h-3 w-3" />
                        Mark unseen
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>

            {/* Key Specs (2x2 spacious cards so nothing clips) */}
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
              <div className="rounded-xl border border-slate-200/80 bg-slate-50/70 p-3">
                <div className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
                  <BedDouble className="h-3.5 w-3.5 text-slate-400" />
                  <span>Bedrooms</span>
                </div>
                <div className="mt-1 text-sm font-bold text-slate-900">
                  {formatBedrooms(property.bedrooms)}
                </div>
              </div>
              <div className="rounded-xl border border-slate-200/80 bg-slate-50/70 p-3">
                <div className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
                  <Bath className="h-3.5 w-3.5 text-slate-400" />
                  <span>Bathrooms</span>
                </div>
                <div className="mt-1 text-sm font-bold text-slate-900">
                  {formatBathrooms(property.bathrooms)}
                </div>
              </div>
              <div className="rounded-xl border border-slate-200/80 bg-slate-50/70 p-3">
                <div className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
                  <Ruler className="h-3.5 w-3.5 text-slate-400" />
                  <span>Area</span>
                </div>
                <div className="mt-1 text-sm font-bold text-slate-900">{area ?? "Unlisted"}</div>
              </div>
              <div className="rounded-xl border border-slate-200/80 bg-slate-50/70 p-3">
                <div className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
                  <Calendar className="h-3.5 w-3.5 text-slate-400" />
                  <span>Move-in</span>
                </div>
                <div className="mt-1 text-sm font-bold leading-snug text-slate-900">
                  {property.available_immediately
                    ? "Immediate"
                    : property.move_in_label ?? "See Centris"}
                </div>
              </div>
            </div>

            {/* Commute breakdown if destination active */}
            {destination && commute && (
              <div className="rounded-2xl border border-brand-200/80 bg-brand-50/60 p-4">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-xs font-semibold text-brand-800">
                    <Compass className="h-4 w-4 text-brand-600" />
                    Commute to {destination.label}
                  </div>
                  <span className="rounded-full bg-brand-600 px-2.5 py-0.5 text-xs font-bold text-white">
                    ~{commute.totalMinutes} min
                  </span>
                </div>
                <p className="mt-2 text-xs leading-relaxed text-slate-700">{commute.summary}</p>
              </div>
            )}

            {/* Personal Note Editor */}
            <div className="rounded-2xl border border-amber-200/80 bg-amber-50/45 p-4">
              <div className="mb-2 flex items-center justify-between">
                <label
                  htmlFor="listing-personal-note"
                  className="flex items-center gap-1.5 text-xs font-semibold text-amber-950"
                >
                  <StickyNote className="h-4 w-4 text-amber-600" />
                  Personal Notes
                </label>
                {note?.updatedAt && (
                  <span className="text-[11px] font-medium text-amber-700/80">Auto-saved</span>
                )}
              </div>
              <textarea
                id="listing-personal-note"
                rows={2}
                value={noteDraft}
                onChange={(e) => {
                  const val = e.target.value;
                  setNoteDraft(val);
                  onSaveNote(property.centris_id, val);
                }}
                placeholder="Write private notes (e.g. sunny balcony, ask about hydro, visited Sat)…"
                className="w-full resize-y rounded-xl border border-amber-200/90 bg-white px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-200/70"
              />
            </div>

            {/* Nearby Transit Stations */}
            <div>
              <h3 className="mb-2.5 text-xs font-semibold text-slate-700">
                Stations within 15-min walk ({nearbyHubs.length})
              </h3>
              <div className="space-y-2">
                {nearbyHubs.map((hub) => (
                  <button
                    key={`${hub.network}-${hub.name}`}
                    type="button"
                    onClick={() => {
                      onSelectStation(hub.name);
                      onClose();
                    }}
                    className="flex w-full items-center justify-between gap-3 rounded-xl border border-slate-200/90 bg-white px-3.5 py-2.5 text-left transition hover:border-brand-300 hover:bg-slate-50"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-semibold text-slate-900">
                          {hub.name}
                        </span>
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-600">
                          {hub.network}
                        </span>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        {hub.lines.map((ln) => (
                          <span
                            key={ln}
                            className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold text-white"
                            style={{ backgroundColor: lineHexColor(ln) }}
                          >
                            {ln === "REM" ? "REM" : `${ln}`}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="inline-flex items-center gap-1 text-sm font-bold text-emerald-700">
                        <Footprints className="h-3.5 w-3.5" />
                        {Math.max(1, Math.round(hub.walk_minutes))} min
                      </div>
                      <div className="text-xs text-slate-500">{formatDistance(hub.distance_m)}</div>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Price History */}
            {(historyPoints.length > 1 || (property.price_drop && property.price_drop > 0)) && (
              <div className="rounded-2xl border border-slate-200/90 p-4">
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-xs font-semibold text-slate-700">Price History</h3>
                  {loadingHistory && <span className="text-xs text-slate-400">Loading…</span>}
                </div>
                <PriceSparkline points={historyPoints} />
                <ul className="mt-2 space-y-1.5 text-xs">
                  {historyPoints.map((pt, idx) => (
                    <li key={idx} className="flex items-center justify-between text-slate-600">
                      <span>
                        {new Date(pt.recorded_at).toLocaleDateString("en-CA", {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        })}
                        {idx === 0
                          ? " (First seen)"
                          : idx === historyPoints.length - 1
                            ? " (Current)"
                            : ""}
                      </span>
                      <span className="font-semibold text-slate-900">{formatPrice(pt.price)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Amenities & Inclusions (Clean Two-Column Key/Value Rows — Zero Truncation) */}
            <div>
              <h3 className="mb-2.5 text-xs font-semibold text-slate-700">
                Inclusions & Features
              </h3>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {amenities.map((item) => (
                  <div
                    key={item.name}
                    className={`flex items-center justify-between gap-2 rounded-xl border px-3 py-2 text-xs ${
                      item.state === "yes"
                        ? "border-emerald-200/90 bg-emerald-50/50 text-slate-900"
                        : item.state === "no"
                          ? "border-rose-200/80 bg-rose-50/40 text-slate-700"
                          : "border-slate-200/70 bg-slate-50/50 text-slate-500"
                    }`}
                  >
                    <span className="flex items-center gap-2 whitespace-nowrap font-medium">
                      <span
                        className={
                          item.state === "yes"
                            ? "text-emerald-600"
                            : item.state === "no"
                              ? "text-rose-500"
                              : "text-slate-400"
                        }
                      >
                        {item.icon}
                      </span>
                      <span>{item.name}</span>
                    </span>
                    <span
                      className={`shrink-0 rounded-md px-2 py-0.5 text-[11px] font-semibold ${
                        item.state === "yes"
                          ? "bg-emerald-100 text-emerald-800"
                          : item.state === "no"
                            ? "bg-rose-100 text-rose-800"
                            : "text-slate-400"
                      }`}
                    >
                      {item.status}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Description Excerpt */}
            {property.description_excerpt && (
              <div>
                <h3 className="mb-1.5 text-xs font-semibold text-slate-700">Listing Excerpt</h3>
                <p className="rounded-xl border border-slate-200/70 bg-slate-50/70 p-3.5 text-xs leading-relaxed text-slate-700">
                  {property.description_excerpt}
                  {property.description_excerpt.length >= 595 ? "…" : ""}
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Sticky Footer */}
        <div className="flex shrink-0 items-center gap-2.5 border-t border-slate-200/80 bg-white px-5 py-3.5">
          <button
            type="button"
            onClick={() => {
              onShowOnMap(property.id);
              onClose();
            }}
            className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            <MapPin className="h-4 w-4" />
            Show on Map
          </button>
          <a
            href={property.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-700"
          >
            <ExternalLink className="h-4 w-4" />
            View on Centris
          </a>
        </div>
      </aside>
    </div>
  );
}
