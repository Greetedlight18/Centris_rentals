"use client";

import { Bath, BedDouble, Car, ExternalLink, Footprints, ImageOff, MapPin } from "lucide-react";
import { memo, useState, type ReactNode } from "react";
import type { Property } from "@/services/api";
import {
  formatBathrooms,
  formatBedrooms,
  formatPrice,
  formatWalk,
  lineLabel,
} from "@/lib/format";

interface ListViewProps {
  properties: Property[];
  loading: boolean;
  selectedId: number | null;
  onSelect: (id: number) => void;
  onShowOnMap: (id: number) => void;
  emptyState: ReactNode;
  footer?: ReactNode;
}

interface PropertyCardProps {
  property: Property;
  selected: boolean;
  onSelect: (id: number) => void;
  onShowOnMap: (id: number) => void;
}

const PropertyCard = memo(function PropertyCard({
  property,
  selected,
  onSelect,
  onShowOnMap,
}: PropertyCardProps) {
  const [imageFailed, setImageFailed] = useState(false);
  const walk = formatWalk(property.walk_minutes, property.nearest_station_distance_m);
  const showImage = Boolean(property.image_url) && !imageFailed;
  const locationLine = [property.address, property.city && !property.address?.includes(property.city) ? property.city : null]
    .filter(Boolean)
    .join(", ");

  return (
    <article
      onClick={() => onSelect(property.id)}
      className={`group flex flex-col overflow-hidden rounded-2xl border bg-white shadow-card transition hover:-translate-y-0.5 hover:shadow-lg ${
        selected ? "border-brand-500 ring-2 ring-brand-200" : "border-slate-200"
      }`}
    >
      <div className="relative aspect-[4/3] w-full bg-slate-100">
        {showImage ? (
          <img
            src={property.image_url ?? ""}
            alt={property.title ?? property.address ?? "Rental listing"}
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={() => setImageFailed(true)}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-slate-400">
            <ImageOff className="h-8 w-8" aria-hidden="true" />
            <span className="text-xs">No photo available</span>
          </div>
        )}
        <div className="absolute left-3 top-3 rounded-full bg-white/95 px-3 py-1 text-base font-bold text-slate-900 shadow">
          {formatPrice(property.price)}
          {property.price !== null && <span className="text-xs font-medium text-slate-500"> /mo</span>}
        </div>
        {property.parking_available && (
          <div className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-full bg-slate-900/85 px-2.5 py-1 text-xs font-medium text-white">
            <Car className="h-3.5 w-3.5" aria-hidden="true" />
            Parking
          </div>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-3 p-4">
        <div>
          {property.property_type && (
            <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
              {property.property_type}
            </div>
          )}
          <div className="mt-0.5 line-clamp-2 text-sm font-semibold text-slate-900">
            {locationLine || "Address not available"}
          </div>
        </div>

        <div className="flex items-center gap-4 text-sm text-slate-700">
          <span className="inline-flex items-center gap-1.5">
            <BedDouble className="h-4 w-4 text-slate-400" aria-hidden="true" />
            {formatBedrooms(property.bedrooms)}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Bath className="h-4 w-4 text-slate-400" aria-hidden="true" />
            {formatBathrooms(property.bathrooms)}
          </span>
        </div>

        <div className="rounded-xl bg-slate-50 p-3">
          <div className="flex items-center gap-2 text-sm font-medium text-slate-900">
            <span
              className="inline-block h-3 w-3 shrink-0 rounded-full ring-2 ring-white"
              style={{ backgroundColor: property.station_color }}
              aria-hidden="true"
            />
            <span className="truncate">{property.station_name}</span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-600">
            <span>{lineLabel(property.station_network, property.station_line)}</span>
            {walk && (
              <span className="inline-flex items-center gap-1 font-semibold text-emerald-700">
                <Footprints className="h-3.5 w-3.5" aria-hidden="true" />
                {walk.minutes} · {walk.distance}
              </span>
            )}
          </div>
        </div>

        <div className="mt-auto flex gap-2 pt-1">
          <a
            href={property.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(event) => event.stopPropagation()}
            className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-brand-700"
          >
            <ExternalLink className="h-4 w-4" aria-hidden="true" />
            View on Centris
          </a>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onShowOnMap(property.id);
            }}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
          >
            <MapPin className="h-4 w-4" aria-hidden="true" />
            Map
          </button>
        </div>
      </div>
    </article>
  );
});

function SkeletonCard() {
  return (
    <div className="animate-pulse overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-card">
      <div className="aspect-[4/3] w-full bg-slate-200" />
      <div className="space-y-3 p-4">
        <div className="h-3 w-1/3 rounded bg-slate-200" />
        <div className="h-4 w-3/4 rounded bg-slate-200" />
        <div className="h-4 w-1/2 rounded bg-slate-200" />
        <div className="h-16 w-full rounded-xl bg-slate-100" />
        <div className="h-9 w-full rounded-lg bg-slate-200" />
      </div>
    </div>
  );
}

export default function ListView({
  properties,
  loading,
  selectedId,
  onSelect,
  onShowOnMap,
  emptyState,
  footer,
}: ListViewProps) {
  if (loading && properties.length === 0) {
    return (
      <div className="h-full overflow-y-auto p-4 sm:p-6">
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {Array.from({ length: 8 }, (_, index) => (
            <SkeletonCard key={index} />
          ))}
        </div>
      </div>
    );
  }

  if (properties.length === 0) {
    return <div className="flex h-full items-center justify-center overflow-y-auto p-6">{emptyState}</div>;
  }

  return (
    <div className="h-full overflow-y-auto p-4 sm:p-6">
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {properties.map((property) => (
          <PropertyCard
            key={property.id}
            property={property}
            selected={property.id === selectedId}
            onSelect={onSelect}
            onShowOnMap={onShowOnMap}
          />
        ))}
      </div>
      {footer && <div className="mt-6 flex justify-center pb-4">{footer}</div>}
    </div>
  );
}