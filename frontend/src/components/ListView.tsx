"use client";

import {
  Ban,
  Camera,
  Car,
  Compass,
  ExternalLink,
  Eye,
  EyeOff,
  Flame,
  Footprints,
  Heart,
  ImageOff,
  MapPin,
  PawPrint,
  Shirt,
  Snowflake,
  Sofa,
  Sparkles,
  StickyNote,
  TrendingDown,
} from "lucide-react";
import { memo, useState, type ReactNode } from "react";
import type { Property } from "@/services/api";
import {
  formatArea,
  formatBathrooms,
  formatBedrooms,
  formatPrice,
  formatPricePerSqft,
  isNewListing,
  lineHexColor,
  lineLabel,
} from "@/lib/format";
import type { SavedNote } from "@/lib/saved";
import type { CommuteEstimate } from "@/lib/transit";

interface ListViewProps {
  properties: Property[];
  loading: boolean;
  compact?: boolean;
  selectedId: number | null;
  hoveredId: number | null;
  viewedIds: Set<string>;
  favoriteIds: Set<string>;
  hiddenIds: Set<string>;
  notes: Record<string, SavedNote>;
  commuteById: Map<number, CommuteEstimate>;
  onOpenDetail: (id: number) => void;
  onHover: (id: number | null) => void;
  onShowOnMap: (id: number) => void;
  onView: (centrisId: string) => void;
  onUnview: (centrisId: string) => void;
  onToggleFavorite: (centrisId: string) => void;
  onToggleHidden: (centrisId: string) => void;
  emptyState: ReactNode;
  footer?: ReactNode;
}

interface PropertyCardProps {
  property: Property;
  compact: boolean;
  selected: boolean;
  hovered: boolean;
  viewed: boolean;
  favorited: boolean;
  isHidden: boolean;
  note: SavedNote | undefined;
  commute: CommuteEstimate | undefined;
  onOpenDetail: (id: number) => void;
  onHover: (id: number | null) => void;
  onShowOnMap: (id: number) => void;
  onView: (centrisId: string) => void;
  onUnview: (centrisId: string) => void;
  onToggleFavorite: (centrisId: string) => void;
  onToggleHidden: (centrisId: string) => void;
}

const PropertyCard = memo(function PropertyCard({
  property,
  compact,
  selected,
  hovered,
  viewed,
  favorited,
  isHidden,
  note,
  commute,
  onOpenDetail,
  onHover,
  onShowOnMap,
  onView,
  onUnview,
  onToggleFavorite,
  onToggleHidden,
}: PropertyCardProps) {
  const [imageFailed, setImageFailed] = useState(false);
  const area = formatArea(property.net_area_sqft);
  const ppsqft = formatPricePerSqft(property.price_per_sqft);
  const isNew = isNewListing(property.first_seen_at);
  const heroPhoto = property.image_url ?? property.photo_urls?.[0] ?? null;
  const showImage = Boolean(heroPhoto) && !imageFailed;

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

  const allLines =
    property.reachable_lines && property.reachable_lines.length > 0
      ? property.reachable_lines
      : [property.station_line];

  const walkMins =
    property.walk_minutes !== null && property.walk_minutes !== undefined
      ? Math.max(1, Math.round(property.walk_minutes))
      : null;

  const moveInShort = property.available_immediately
    ? "Immediate"
    : property.move_in_label
      ? property.move_in_label
      : null;

  const highlights: { label: string; icon: ReactNode; accent?: boolean }[] = [];
  if (property.pets_allowed === true) {
    highlights.push({
      label: "Pets OK",
      icon: <PawPrint className="h-3 w-3" />,
      accent: true,
    });
  }
  if (property.laundry_in_unit) {
    highlights.push({
      label: "In-unit laundry",
      icon: <Shirt className="h-3 w-3" />,
    });
  }
  if (property.heating_included || property.hydro_included) {
    highlights.push({
      label: property.hydro_included ? "Hydro incl." : "Heat incl.",
      icon: <Flame className="h-3 w-3" />,
    });
  }
  if (property.parking_available) {
    highlights.push({
      label: "Parking",
      icon: <Car className="h-3 w-3" />,
    });
  }
  if (property.air_conditioning) {
    highlights.push({
      label: "A/C",
      icon: <Snowflake className="h-3 w-3" />,
    });
  }
  if (property.furnished) {
    highlights.push({
      label: "Furnished",
      icon: <Sofa className="h-3 w-3" />,
    });
  }

  return (
    <article
      onClick={() => onOpenDetail(property.id)}
      onMouseEnter={() => onHover(property.id)}
      onMouseLeave={() => onHover(null)}
      className={`group flex cursor-pointer flex-col overflow-hidden rounded-2xl border bg-white transition-all duration-200 hover:-translate-y-0.5 hover:opacity-100 hover:shadow-[0_12px_28px_-6px_rgba(15,23,42,0.12)] ${
        selected
          ? "border-brand-500 shadow-md ring-2 ring-brand-500/20"
          : hovered
            ? "border-slate-400 shadow-md"
            : "border-slate-200/85 shadow-[0_1px_3px_rgba(15,23,42,0.04)]"
      } ${viewed && !selected && !favorited ? "opacity-85" : ""}`}
    >
      {/* Photo Hero */}
      <div className="relative aspect-[16/10] w-full overflow-hidden bg-slate-100">
        {showImage ? (
          <>
            <img
              src={heroPhoto ?? ""}
              alt={property.title ?? property.address ?? "Rental listing"}
              loading="lazy"
              referrerPolicy="no-referrer"
              onError={() => setImageFailed(true)}
              className={`h-full w-full object-cover transition duration-500 ease-out group-hover:scale-[1.04] ${
                viewed && !favorited ? "grayscale-[30%] group-hover:grayscale-0" : ""
              }`}
            />
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-slate-950/40 via-transparent to-slate-950/15" />
          </>
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-1.5 bg-slate-100 text-slate-400">
            <ImageOff className="h-7 w-7 stroke-[1.5]" aria-hidden="true" />
            <span className="text-xs font-medium">No photo provided</span>
          </div>
        )}

        {/* Top-left Status Pills */}
        <div className="absolute left-3 top-3 flex flex-wrap items-center gap-1.5">
          {isNew && (
            <span className="inline-flex items-center gap-1 rounded-full bg-brand-600 px-2.5 py-1 text-[11px] font-semibold tracking-wide text-white shadow-sm">
              <Sparkles className="h-3 w-3" />
              New
            </span>
          )}
          {property.price_drop && property.price_drop > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-600 px-2.5 py-1 text-[11px] font-semibold text-white shadow-sm">
              <TrendingDown className="h-3 w-3" />↓ {formatPrice(property.price_drop)}
            </span>
          )}
        </div>

        {/* Top-right Shortlist & Dismiss Buttons */}
        <div className="absolute right-3 top-3 flex items-center gap-1.5">
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onToggleHidden(property.centris_id);
            }}
            aria-label={isHidden ? "Unhide listing" : "Hide listing"}
            title={isHidden ? "Restore listing" : "Dismiss listing"}
            className={`inline-flex h-8 w-8 items-center justify-center rounded-full shadow-sm backdrop-blur-md transition ${
              isHidden
                ? "bg-amber-600 text-white"
                : "bg-white/90 text-slate-600 opacity-0 group-hover:opacity-100 hover:bg-white hover:text-slate-900 focus:opacity-100"
            }`}
          >
            <Ban className="h-3.5 w-3.5" />
          </button>

          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onToggleFavorite(property.centris_id);
            }}
            aria-label={favorited ? "Remove from favorites" : "Save to favorites"}
            title={favorited ? "Saved to shortlist" : "Save to shortlist"}
            className={`inline-flex h-8 w-8 items-center justify-center rounded-full shadow-sm backdrop-blur-md transition ${
              favorited
                ? "bg-rose-600 text-white"
                : "bg-white/90 text-slate-700 hover:scale-105 hover:bg-white hover:text-rose-600"
            }`}
          >
            <Heart className={`h-4 w-4 ${favorited ? "fill-current" : ""}`} />
          </button>
        </div>

        {/* Bottom Photo Metadata */}
        <div className="absolute bottom-2.5 left-3 right-3 flex items-center justify-between gap-2">
          <div>
            {viewed && (
              <span className="inline-flex items-center gap-1 rounded-full bg-slate-900/75 px-2.5 py-0.5 text-[11px] font-medium text-white backdrop-blur-sm">
                <Eye className="h-3 w-3" />
                Seen
              </span>
            )}
          </div>

          {property.photo_urls && property.photo_urls.length > 1 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-slate-900/75 px-2.5 py-0.5 text-[11px] font-medium tabular-nums text-white backdrop-blur-sm">
              <Camera className="h-3 w-3" />
              {property.photo_urls.length}
            </span>
          )}
        </div>
      </div>

      {/* Card Body */}
      <div className="flex flex-1 flex-col gap-3 p-4">
        {/* Price + $/sqft + Specs + Address */}
        <div>
          <div className="flex items-baseline justify-between gap-2">
            <div className="flex flex-wrap items-baseline gap-1.5">
              <span className="text-xl font-extrabold tracking-tight text-slate-900">
                {formatPrice(property.price)}
              </span>
              {property.price !== null && (
                <span className="text-xs font-medium text-slate-400">/mo</span>
              )}
              {oldPrice !== null && (
                <span className="text-xs font-medium text-slate-400 line-through">
                  {formatPrice(oldPrice)}
                </span>
              )}
            </div>

            {ppsqft && (
              <span className="shrink-0 rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-slate-600">
                {ppsqft}
              </span>
            )}
          </div>

          {/* Unified Scannable Specs Strip */}
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-semibold text-slate-700">
            <span>{formatBedrooms(property.bedrooms)}</span>
            <span className="text-slate-300">·</span>
            <span>{formatBathrooms(property.bathrooms)}</span>
            {area && (
              <>
                <span className="text-slate-300">·</span>
                <span>{area}</span>
              </>
            )}
            {moveInShort && (
              <>
                <span className="text-slate-300">·</span>
                <span
                  className={
                    property.available_immediately
                      ? "text-brand-700"
                      : "font-medium text-slate-500"
                  }
                >
                  {moveInShort}
                </span>
              </>
            )}
          </div>

          {/* Address */}
          <div className="mt-1 line-clamp-1 text-[13px] font-medium text-slate-600">
            {locationLine || property.property_type || "Address on Centris"}
          </div>
        </div>

        {/* Transit & Commute Pill Bar */}
        <div className="rounded-xl border border-slate-200/75 bg-slate-50/80 px-3 py-2">
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <div className="flex shrink-0 -space-x-1">
                {allLines.slice(0, 4).map((ln) => (
                  <span
                    key={ln}
                    title={ln === "REM" ? "REM" : `${ln} line`}
                    className="inline-block h-3 w-3 rounded-full ring-2 ring-white"
                    style={{ backgroundColor: lineHexColor(ln, property.station_color) }}
                  />
                ))}
              </div>
              <span className="truncate text-xs font-semibold text-slate-900">
                {property.station_name}
              </span>
            </div>

            <div className="flex shrink-0 items-center gap-1.5">
              {walkMins !== null && (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-600/15">
                  <Footprints className="h-3 w-3" aria-hidden="true" />
                  {walkMins}m
                </span>
              )}
              {commute && (
                <span className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-semibold text-brand-700 ring-1 ring-inset ring-brand-600/15">
                  <Compass className="h-3 w-3" />~{commute.totalMinutes}m
                </span>
              )}
            </div>
          </div>

          {allLines.length > 1 ? (
            <div className="mt-0.5 truncate text-[11px] text-slate-500">
              {allLines.join(" · ")}
              {property.nearby_stations && property.nearby_stations.length > 1
                ? ` · ${property.nearby_stations.length} stations nearby`
                : ""}
            </div>
          ) : (
            <div className="mt-0.5 text-[11px] text-slate-500">
              {lineLabel(property.station_network, property.station_line)}
            </div>
          )}
        </div>

        {/* Subtle Amenity Chips */}
        {highlights.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {highlights.slice(0, 4).map((h) => (
              <span
                key={h.label}
                className={`inline-flex items-center gap-1 whitespace-nowrap rounded-lg px-2 py-0.5 text-[11px] font-medium ${
                  h.accent
                    ? "bg-emerald-50 text-emerald-800 ring-1 ring-inset ring-emerald-600/20"
                    : "bg-slate-100 text-slate-600"
                }`}
              >
                <span className={h.accent ? "text-emerald-600" : "text-slate-400"}>{h.icon}</span>
                {h.label}
              </span>
            ))}
          </div>
        )}

        {/* Personal Note Preview */}
        {note?.text && (
          <div className="flex items-start gap-2 rounded-xl border border-amber-200/80 bg-amber-50/70 px-3 py-2 text-xs text-amber-950">
            <StickyNote className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
            <span className="line-clamp-2">{note.text}</span>
          </div>
        )}

        {/* Card Footer Actions */}
        <div className="mt-auto flex items-center gap-1.5 pt-1">
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onOpenDetail(property.id);
            }}
            className="inline-flex flex-1 items-center justify-center rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900"
          >
            Details & Notes
          </button>

          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onShowOnMap(property.id);
            }}
            aria-label="Show on map"
            title="Focus on map"
            className="inline-flex items-center justify-center gap-1 rounded-xl border border-slate-200 bg-white px-2.5 py-2 text-xs font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900"
          >
            <MapPin className="h-3.5 w-3.5 text-slate-500" />
            {!compact && <span>Map</span>}
          </button>

          {viewed && (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onUnview(property.centris_id);
              }}
              aria-label="Mark as unseen"
              title="Mark as unseen"
              className="inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white p-2 text-slate-400 transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-700"
            >
              <EyeOff className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          )}

          <a
            href={property.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(event) => {
              event.stopPropagation();
              onView(property.centris_id);
            }}
            className="inline-flex items-center justify-center gap-1 rounded-xl bg-brand-600 px-3 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-brand-700"
          >
            <span>Centris</span>
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </div>
      </div>
    </article>
  );
});

function SkeletonCard() {
  return (
    <div className="animate-pulse overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm">
      <div className="aspect-[16/10] w-full bg-slate-200/80" />
      <div className="space-y-3 p-4">
        <div className="h-5 w-1/3 rounded-lg bg-slate-200" />
        <div className="h-3.5 w-2/3 rounded bg-slate-100" />
        <div className="h-4 w-3/4 rounded bg-slate-100" />
        <div className="h-11 w-full rounded-xl bg-slate-100" />
        <div className="h-9 w-full rounded-xl bg-slate-100" />
      </div>
    </div>
  );
}

export default function ListView({
  properties,
  loading,
  compact = false,
  selectedId,
  hoveredId,
  viewedIds,
  favoriteIds,
  hiddenIds,
  notes,
  commuteById,
  onOpenDetail,
  onHover,
  onShowOnMap,
  onView,
  onUnview,
  onToggleFavorite,
  onToggleHidden,
  emptyState,
  footer,
}: ListViewProps) {
  const gridClasses = compact
    ? "grid grid-cols-1 gap-4 2xl:grid-cols-2"
    : "grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4";

  if (loading && properties.length === 0) {
    return (
      <div className="h-full overflow-y-auto p-4 sm:p-5">
        <div className={gridClasses}>
          {Array.from({ length: compact ? 6 : 8 }, (_, index) => (
            <SkeletonCard key={index} />
          ))}
        </div>
      </div>
    );
  }

  if (properties.length === 0) {
    return (
      <div className="flex h-full items-center justify-center overflow-y-auto p-6">
        {emptyState}
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-4 sm:p-5">
      <div className={gridClasses}>
        {properties.map((property) => (
          <PropertyCard
            key={property.id}
            property={property}
            compact={compact}
            selected={property.id === selectedId}
            hovered={property.id === hoveredId}
            viewed={viewedIds.has(property.centris_id)}
            favorited={favoriteIds.has(property.centris_id)}
            isHidden={hiddenIds.has(property.centris_id)}
            note={notes[property.centris_id]}
            commute={commuteById.get(property.id)}
            onOpenDetail={onOpenDetail}
            onHover={onHover}
            onShowOnMap={onShowOnMap}
            onView={onView}
            onUnview={onUnview}
            onToggleFavorite={onToggleFavorite}
            onToggleHidden={onToggleHidden}
          />
        ))}
      </div>
      {footer && <div className="mt-6 flex justify-center pb-4">{footer}</div>}
    </div>
  );
}
