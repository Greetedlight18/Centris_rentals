"use client";

import {
  Ban,
  Bath,
  BedDouble,
  Calendar,
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
  Ruler,
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
  formatWalk,
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
  const walk = formatWalk(property.walk_minutes, property.nearest_station_distance_m);
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

  const badges: { label: string; icon: ReactNode; tone: string }[] = [];
  if (property.available_immediately) {
    badges.push({
      label: "Immediate",
      icon: <Calendar className="h-3 w-3" />,
      tone: "bg-sky-50 text-sky-700 border-sky-200",
    });
  } else if (property.move_in_label) {
    badges.push({
      label: property.move_in_label,
      icon: <Calendar className="h-3 w-3" />,
      tone: "bg-slate-100 text-slate-700 border-slate-200",
    });
  }
  if (property.pets_allowed === true) {
    badges.push({
      label: "Pets OK",
      icon: <PawPrint className="h-3 w-3" />,
      tone: "bg-emerald-50 text-emerald-700 border-emerald-200",
    });
  }
  if (property.parking_available) {
    badges.push({
      label: "Parking",
      icon: <Car className="h-3 w-3" />,
      tone: "bg-slate-100 text-slate-700 border-slate-200",
    });
  }
  if (property.laundry_in_unit) {
    badges.push({
      label: "In-unit laundry",
      icon: <Shirt className="h-3 w-3" />,
      tone: "bg-indigo-50 text-indigo-700 border-indigo-200",
    });
  }
  if (property.heating_included || property.hydro_included) {
    badges.push({
      label: property.hydro_included ? "Hydro incl." : "Heat incl.",
      icon: <Flame className="h-3 w-3" />,
      tone: "bg-amber-50 text-amber-800 border-amber-200",
    });
  }
  if (property.furnished) {
    badges.push({
      label: "Furnished",
      icon: <Sofa className="h-3 w-3" />,
      tone: "bg-purple-50 text-purple-700 border-purple-200",
    });
  }
  if (property.air_conditioning) {
    badges.push({
      label: "A/C",
      icon: <Snowflake className="h-3 w-3" />,
      tone: "bg-cyan-50 text-cyan-700 border-cyan-200",
    });
  }

  return (
    <article
      onClick={() => onOpenDetail(property.id)}
      onMouseEnter={() => onHover(property.id)}
      onMouseLeave={() => onHover(null)}
      className={`group flex cursor-pointer flex-col overflow-hidden rounded-2xl border bg-white shadow-card transition duration-150 hover:-translate-y-0.5 hover:opacity-100 hover:shadow-lg ${
        selected
          ? "border-brand-500 ring-2 ring-brand-200"
          : hovered
            ? "border-brand-400 ring-2 ring-brand-100"
            : "border-slate-200/90"
      } ${viewed && !selected && !favorited ? "opacity-80" : ""}`}
    >
      <div className="relative aspect-[16/10] w-full overflow-hidden bg-slate-100">
        {showImage ? (
          <img
            src={heroPhoto ?? ""}
            alt={property.title ?? property.address ?? "Rental listing"}
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={() => setImageFailed(true)}
            className={`h-full w-full object-cover transition duration-300 group-hover:scale-[1.03] ${
              viewed && !favorited ? "grayscale-[45%] group-hover:grayscale-0" : ""
            }`}
          />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-slate-400">
            <ImageOff className="h-8 w-8" aria-hidden="true" />
            <span className="text-xs">No photo available</span>
          </div>
        )}

        {/* Price badge */}
        <div className="absolute left-3 top-3 flex items-baseline gap-1.5 rounded-full bg-white/95 px-3 py-1 shadow backdrop-blur-sm">
          <span className="text-base font-bold text-slate-900">{formatPrice(property.price)}</span>
          {property.price !== null && <span className="text-[11px] font-medium text-slate-500">/mo</span>}
          {oldPrice !== null && (
            <span className="text-[11px] font-medium text-slate-400 line-through">
              {formatPrice(oldPrice)}
            </span>
          )}
        </div>

        {/* Favorite & Hide quick buttons */}
        <div className="absolute right-3 top-3 flex items-center gap-1.5">
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onToggleFavorite(property.centris_id);
            }}
            aria-label={favorited ? "Remove from favorites" : "Save to favorites"}
            title={favorited ? "Saved to shortlist" : "Save to shortlist"}
            className={`inline-flex h-8 w-8 items-center justify-center rounded-full shadow backdrop-blur-sm transition ${
              favorited
                ? "bg-rose-600 text-white"
                : "bg-white/90 text-slate-700 hover:bg-white hover:text-rose-600"
            }`}
          >
            <Heart className={`h-4 w-4 ${favorited ? "fill-current" : ""}`} />
          </button>

          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onToggleHidden(property.centris_id);
            }}
            aria-label={isHidden ? "Unhide listing" : "Hide listing"}
            title={isHidden ? "Restore listing" : "Dismiss / hide listing"}
            className={`inline-flex h-8 w-8 items-center justify-center rounded-full shadow backdrop-blur-sm transition ${
              isHidden
                ? "bg-amber-600 text-white"
                : "bg-white/85 text-slate-500 opacity-0 group-hover:opacity-100 hover:bg-white hover:text-slate-900 focus:opacity-100"
            }`}
          >
            <Ban className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Bottom overlay tags */}
        <div className="absolute bottom-2.5 left-3 right-3 flex items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            {isNew && (
              <span className="inline-flex items-center gap-1 rounded-full bg-brand-600/95 px-2.5 py-0.5 text-[11px] font-semibold text-white shadow">
                <Sparkles className="h-3 w-3" />
                New
              </span>
            )}
            {property.price_drop && property.price_drop > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-600/95 px-2.5 py-0.5 text-[11px] font-semibold text-white shadow">
                <TrendingDown className="h-3 w-3" />↓ {formatPrice(property.price_drop)}
              </span>
            )}
            {viewed && !isNew && (
              <span className="inline-flex items-center gap-1 rounded-full bg-slate-900/75 px-2 py-0.5 text-[11px] font-medium text-white backdrop-blur-sm">
                <Eye className="h-3 w-3" />
                Seen
              </span>
            )}
          </div>

          {property.photo_urls && property.photo_urls.length > 1 && (
            <span className="rounded-full bg-slate-900/70 px-2 py-0.5 text-[11px] font-medium tabular-nums text-white backdrop-blur-sm">
              {property.photo_urls.length} photos
            </span>
          )}
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-3 p-4">
        <div>
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              {property.property_type ?? "Rental"}
            </span>
            {ppsqft && (
              <span className="shrink-0 text-[11px] font-semibold text-slate-500">{ppsqft}</span>
            )}
          </div>
          <div className="mt-0.5 line-clamp-1 text-sm font-semibold text-slate-900">
            {locationLine || "Address not available"}
          </div>
        </div>

        {/* Core specs */}
        <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1 text-xs font-medium text-slate-700">
          <span className="inline-flex items-center gap-1">
            <BedDouble className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
            {formatBedrooms(property.bedrooms)}
          </span>
          <span className="inline-flex items-center gap-1">
            <Bath className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
            {formatBathrooms(property.bathrooms)}
          </span>
          {area && (
            <span className="inline-flex items-center gap-1" title="Net area">
              <Ruler className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
              {area}
            </span>
          )}
        </div>

        {/* Amenity & Move-in tags */}
        {badges.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {badges.slice(0, 4).map((b) => (
              <span
                key={b.label}
                className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-medium ${b.tone}`}
              >
                {b.icon}
                {b.label}
              </span>
            ))}
          </div>
        )}

        {/* Transit & Commute Box */}
        <div className="rounded-xl bg-slate-50 p-2.5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-1.5 text-xs font-semibold text-slate-900">
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
              <span className="truncate">{property.station_name}</span>
            </div>

            {commute && (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-brand-100 px-2 py-0.5 text-[11px] font-bold text-brand-800">
                <Compass className="h-3 w-3" />~{commute.totalMinutes}m
              </span>
            )}
          </div>

          <div className="mt-1 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
            <span className="truncate">
              {allLines.length > 1
                ? `${allLines.join(" · ")} (${property.nearby_stations?.length ?? 1} stn)`
                : lineLabel(property.station_network, property.station_line)}
            </span>
            {walk && (
              <span className="inline-flex items-center gap-1 font-semibold text-emerald-700">
                <Footprints className="h-3.5 w-3.5" aria-hidden="true" />
                {walk.minutes} · {walk.distance}
              </span>
            )}
          </div>
        </div>

        {/* Personal Note preview */}
        {note?.text && (
          <div className="flex items-start gap-1.5 rounded-xl border border-amber-200/80 bg-amber-50/70 px-2.5 py-2 text-xs text-amber-900">
            <StickyNote className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
            <span className="line-clamp-2">{note.text}</span>
          </div>
        )}

        {/* Actions */}
        <div className="mt-auto space-y-1.5 pt-1">
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onOpenDetail(property.id);
              }}
              className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-800 transition hover:border-brand-300 hover:bg-slate-50"
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
              className="inline-flex items-center justify-center gap-1 rounded-xl border border-slate-200 px-2.5 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
            >
              <MapPin className="h-3.5 w-3.5" />
              {!compact && <span>Map</span>}
            </button>
            <a
              href={property.url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(event) => {
                event.stopPropagation();
                onView(property.centris_id);
              }}
              className="inline-flex items-center justify-center gap-1 rounded-xl bg-brand-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-brand-700"
            >
              Centris
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </div>
          {viewed && (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onUnview(property.centris_id);
              }}
              className="mx-auto flex items-center gap-1 text-[11px] text-slate-400 underline-offset-2 transition hover:text-slate-700 hover:underline"
            >
              <EyeOff className="h-3 w-3" aria-hidden="true" />
              Mark as unseen
            </button>
          )}
        </div>
      </div>
    </article>
  );
});

function SkeletonCard() {
  return (
    <div className="animate-pulse overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-card">
      <div className="aspect-[16/10] w-full bg-slate-200" />
      <div className="space-y-3 p-4">
        <div className="h-3 w-1/3 rounded bg-slate-200" />
        <div className="h-4 w-3/4 rounded bg-slate-200" />
        <div className="h-4 w-1/2 rounded bg-slate-200" />
        <div className="h-14 w-full rounded-xl bg-slate-100" />
        <div className="h-9 w-full rounded-xl bg-slate-200" />
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
