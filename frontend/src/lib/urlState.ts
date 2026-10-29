import {
  ALL_TRANSIT_LINES,
  DEFAULT_FILTERS,
  WALK_MAX,
  WALK_MIN,
  type MoveInFilter,
  type NetworkFilter,
  type PropertyFilters,
  type SortOption,
  type TransitLine,
} from "@/services/api";
import type { ActivityFilter } from "@/lib/saved";
import { COMMUTE_PRESETS, type CommuteDestination } from "@/lib/transit";

export type ViewMode = "map" | "split" | "list";

export interface HydratedUrlState {
  filters: PropertyFilters;
  view: ViewMode;
  activity: ActivityFilter;
  destination: CommuteDestination | null;
  maxCommuteMinutes: number | null;
  listingCentrisId: string | null;
}

const VALID_SORTS: Set<SortOption> = new Set([
  "price_asc",
  "price_desc",
  "walk_asc",
  "newest",
  "price_drop_desc",
  "sqft_desc",
  "ppsqft_asc",
  "commute_asc",
]);

const VALID_ACTIVITIES: Set<ActivityFilter> = new Set([
  "all",
  "unseen",
  "favorites",
  "notes",
  "seen",
  "hidden",
]);

function parsePositiveNumber(raw: string | null): number | null {
  if (!raw) return null;
  const num = Number(raw);
  return Number.isFinite(num) && num >= 0 ? num : null;
}

export function parseUrlState(searchString: string): HydratedUrlState {
  const params = new URLSearchParams(searchString);
  const filters: PropertyFilters = { ...DEFAULT_FILTERS, lines: [] };

  const minPrice = parsePositiveNumber(params.get("minPrice"));
  if (minPrice !== null) filters.minPrice = minPrice;

  const maxPrice = parsePositiveNumber(params.get("maxPrice"));
  if (maxPrice !== null) filters.maxPrice = maxPrice;

  if (params.get("studio") === "1") {
    filters.studioOnly = true;
  } else {
    const rooms = parsePositiveNumber(params.get("rooms"));
    if (rooms !== null) filters.minRooms = Math.round(rooms);
  }

  const baths = parsePositiveNumber(params.get("baths"));
  if (baths !== null && baths >= 1) filters.minBathrooms = Math.round(baths);

  const minArea = parsePositiveNumber(params.get("minArea"));
  if (minArea !== null && minArea > 0) filters.minArea = Math.round(minArea);

  const maxPpsqft = parsePositiveNumber(params.get("maxPpsqft"));
  if (maxPpsqft !== null && maxPpsqft > 0) filters.maxPricePerSqft = maxPpsqft;

  filters.parkingRequired = params.get("parking") === "1";
  filters.petsAllowed = params.get("pets") === "1";
  filters.furnished = params.get("furnished") === "1";
  filters.appliancesIncluded = params.get("appliances") === "1";
  filters.laundryInUnit = params.get("laundry") === "1";
  filters.utilitiesIncluded = params.get("utilities") === "1";
  filters.airConditioning = params.get("ac") === "1";
  filters.balcony = params.get("balcony") === "1";

  const moveIn = params.get("moveIn") as MoveInFilter | null;
  if (moveIn === "immediate" || moveIn === "july_1") {
    filters.moveIn = moveIn;
  }

  filters.priceDropsOnly = params.get("drops") === "1";

  const added = parsePositiveNumber(params.get("added"));
  if (added !== null && added >= 1 && added <= 90) {
    filters.addedWithinDays = Math.round(added);
  }

  const walk = parsePositiveNumber(params.get("walk"));
  if (walk !== null) {
    filters.maxWalkMinutes = Math.min(WALK_MAX, Math.max(WALK_MIN, Math.round(walk)));
  }

  const net = params.get("net") as NetworkFilter | null;
  if (net === "METRO" || net === "REM") {
    filters.network = net;
  }

  const linesRaw = params.get("lines");
  if (linesRaw) {
    const valid = linesRaw
      .split(",")
      .map((s) => s.trim() as TransitLine)
      .filter((s) => ALL_TRANSIT_LINES.includes(s));
    filters.lines = Array.from(new Set(valid));
  }

  const station = params.get("station");
  if (station && station.trim()) {
    filters.stationName = station.trim();
  }

  const q = params.get("q");
  if (q && q.trim()) {
    filters.search = q.trim();
  }

  const sort = params.get("sort") as SortOption | null;
  if (sort && VALID_SORTS.has(sort)) {
    filters.sort = sort;
  }

  const rawView = params.get("view");
  const view: ViewMode =
    rawView === "list" || rawView === "split" || rawView === "map" ? rawView : "map";

  const rawTab = params.get("tab") as ActivityFilter | null;
  const activity: ActivityFilter = rawTab && VALID_ACTIVITIES.has(rawTab) ? rawTab : "all";

  let destination: CommuteDestination | null = null;
  const destRaw = params.get("dest");
  if (destRaw) {
    const preset = COMMUTE_PRESETS.find((p) => p.id === destRaw);
    if (preset) {
      destination = preset;
    } else {
      const parts = destRaw.split(",");
      if (parts.length >= 2) {
        const lat = Number(parts[0]);
        const lon = Number(parts[1]);
        const label = parts.slice(2).join(",") || "Custom Pin";
        if (Number.isFinite(lat) && Number.isFinite(lon)) {
          destination = {
            id: "custom",
            label,
            latitude: lat,
            longitude: lon,
            isCustom: true,
          };
        }
      }
    }
  }

  const maxCommute = parsePositiveNumber(params.get("maxCommute"));
  const maxCommuteMinutes = maxCommute !== null && maxCommute > 0 ? Math.round(maxCommute) : null;

  const listingCentrisId = params.get("listing")?.trim() || null;

  return {
    filters,
    view,
    activity,
    destination,
    maxCommuteMinutes,
    listingCentrisId,
  };
}

export function buildUrlQueryString(state: HydratedUrlState): string {
  const params = new URLSearchParams();
  const { filters, view, activity, destination, maxCommuteMinutes, listingCentrisId } = state;

  if (filters.minPrice !== null) params.set("minPrice", String(filters.minPrice));
  if (filters.maxPrice !== null) params.set("maxPrice", String(filters.maxPrice));
  if (filters.studioOnly) {
    params.set("studio", "1");
  } else if (filters.minRooms !== null) {
    params.set("rooms", String(filters.minRooms));
  }
  if (filters.minBathrooms !== null) params.set("baths", String(filters.minBathrooms));
  if (filters.minArea !== null) params.set("minArea", String(filters.minArea));
  if (filters.maxPricePerSqft !== null) params.set("maxPpsqft", String(filters.maxPricePerSqft));

  if (filters.parkingRequired) params.set("parking", "1");
  if (filters.petsAllowed) params.set("pets", "1");
  if (filters.furnished) params.set("furnished", "1");
  if (filters.appliancesIncluded) params.set("appliances", "1");
  if (filters.laundryInUnit) params.set("laundry", "1");
  if (filters.utilitiesIncluded) params.set("utilities", "1");
  if (filters.airConditioning) params.set("ac", "1");
  if (filters.balcony) params.set("balcony", "1");

  if (filters.moveIn !== "any") params.set("moveIn", filters.moveIn);
  if (filters.priceDropsOnly) params.set("drops", "1");
  if (filters.addedWithinDays !== null) params.set("added", String(filters.addedWithinDays));
  if (filters.maxWalkMinutes < WALK_MAX) params.set("walk", String(filters.maxWalkMinutes));
  if (filters.network !== "ALL") params.set("net", filters.network);
  if (filters.lines.length > 0) params.set("lines", filters.lines.join(","));
  if (filters.stationName) params.set("station", filters.stationName);
  if (filters.search.trim()) params.set("q", filters.search.trim());
  if (filters.sort !== DEFAULT_FILTERS.sort) params.set("sort", filters.sort);

  if (view !== "map") params.set("view", view);
  if (activity !== "all") params.set("tab", activity);

  if (destination) {
    if (destination.isCustom) {
      params.set(
        "dest",
        `${destination.latitude.toFixed(5)},${destination.longitude.toFixed(5)},${destination.label}`,
      );
    } else {
      params.set("dest", destination.id);
    }
  }
  if (maxCommuteMinutes !== null) params.set("maxCommute", String(maxCommuteMinutes));
  if (listingCentrisId) params.set("listing", listingCentrisId);

  return params.toString();
}

