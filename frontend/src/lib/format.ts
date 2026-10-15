const priceFormatter = new Intl.NumberFormat("en-CA", {
  style: "currency",
  currency: "CAD",
  maximumFractionDigits: 0,
});

export function formatPrice(price: number | null | undefined): string {
  if (price === null || price === undefined || Number.isNaN(price)) return "Price on request";
  return priceFormatter.format(price);
}

export function formatPriceCompact(price: number | null | undefined): string {
  if (price === null || price === undefined || Number.isNaN(price)) return "N/A";
  return priceFormatter.format(price);
}

export function formatBedrooms(bedrooms: number | null | undefined): string {
  if (bedrooms === null || bedrooms === undefined) return "— bd";
  if (bedrooms === 0) return "Studio";
  return `${bedrooms} bd`;
}

export function formatBathrooms(bathrooms: number | null | undefined): string {
  if (bathrooms === null || bathrooms === undefined) return "— ba";
  return `${bathrooms} ba`;
}

export function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.max(10, Math.round(meters / 10) * 10)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

export interface WalkInfo {
  minutes: string;
  distance: string;
}

export function formatWalk(
  minutes: number | null | undefined,
  meters: number | null | undefined,
): WalkInfo | null {
  if (minutes === null || minutes === undefined || meters === null || meters === undefined) {
    return null;
  }
  return {
    minutes: `${Math.max(1, Math.round(minutes))} min walk`,
    distance: formatDistance(meters),
  };
}

export function lineLabel(network: string, line: string): string {
  return network === "REM" ? "REM" : `${line} line`;
}

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "never";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "unknown";
  const seconds = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return `${days} d ago`;
}

export function formatArea(sqft: number | null | undefined): string | null {
  if (sqft === null || sqft === undefined || Number.isNaN(sqft)) return null;
  return `${Math.round(sqft).toLocaleString("en-CA")} sq ft`;
}