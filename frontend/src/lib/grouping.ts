import type { Property } from "@/services/api";

// Listings whose coordinates match to this many decimals share one marker.
// 5 decimals is roughly 1.1 m. Use 4 (about 11 m) to also merge neighbouring entrances.
export const COORD_DECIMALS = 5;

export function locationKey(latitude: number, longitude: number): string {
  return `${latitude.toFixed(COORD_DECIMALS)},${longitude.toFixed(COORD_DECIMALS)}`;
}

export interface LocationGroup {
  key: string;
  latitude: number;
  longitude: number;
  items: Property[];
}

export function groupByLocation(properties: Property[]): LocationGroup[] {
  const groups = new Map<string, LocationGroup>();
  for (const property of properties) {
    const key = locationKey(property.latitude, property.longitude);
    const existing = groups.get(key);
    if (existing) {
      existing.items.push(property);
    } else {
      groups.set(key, {
        key,
        latitude: property.latitude,
        longitude: property.longitude,
        items: [property],
      });
    }
  }

  const result = Array.from(groups.values());
  for (const group of result) {
    group.items.sort(
      (a, b) => (a.price ?? Number.POSITIVE_INFINITY) - (b.price ?? Number.POSITIVE_INFINITY) || a.id - b.id,
    );
  }
  return result;
}