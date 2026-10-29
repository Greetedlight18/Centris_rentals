export const API_BASE_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000").replace(
  /\/+$/,
  "",
);

export type Network = "METRO" | "REM";
export type NetworkFilter = Network | "ALL";
export type TransitLine = "Green" | "Orange" | "Blue" | "Yellow" | "REM";
export type MoveInFilter = "any" | "immediate" | "july_1";

export type BackendSortOption =
  | "price_asc"
  | "price_desc"
  | "walk_asc"
  | "newest"
  | "price_drop_desc"
  | "sqft_desc"
  | "ppsqft_asc";

export type SortOption = BackendSortOption | "commute_asc";

export interface Station {
  id: number;
  name: string;
  network: Network;
  line: TransitLine;
  branch: string | null;
  line_color: string;
  is_operational: boolean;
  coords_verified: boolean;
  latitude: number;
  longitude: number;
}

export interface StationList {
  count: number;
  items: Station[];
}

export interface NearbyStation {
  station_id: number;
  name: string;
  network: Network;
  lines: TransitLine[];
  colors: string[];
  distance_m: number;
  walk_minutes: number;
}

export interface Property {
  id: number;
  centris_id: string;
  title: string | null;
  property_type: string | null;
  price: number | null;
  initial_price: number | null;
  previous_price: number | null;
  price_changed_at: string | null;
  price_drop: number | null;
  price_per_sqft: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  net_area_sqft: number | null;
  parking_available: boolean;
  pets_allowed: boolean | null;
  furnished: boolean;
  appliances_included: boolean;
  laundry_in_unit: boolean;
  heating_included: boolean;
  hydro_included: boolean;
  internet_included: boolean;
  air_conditioning: boolean;
  balcony: boolean;
  move_in_date: string | null;
  move_in_label: string | null;
  available_immediately: boolean;
  description_excerpt: string | null;
  photo_urls: string[];
  address: string | null;
  city: string | null;
  latitude: number;
  longitude: number;
  url: string;
  image_url: string | null;
  nearest_station_distance_m: number | null;
  walk_minutes: number | null;
  reachable_lines: TransitLine[];
  reachable_networks: Network[];
  reachable_station_ids: number[];
  nearby_stations: NearbyStation[];
  first_seen_at: string;
  scraped_at: string;
  station_id: number;
  station_name: string;
  station_network: string;
  station_line: string;
  station_color: string;
}

export interface MarketStats {
  median_price: number | null;
  avg_price_per_sqft: number | null;
  avg_walk_minutes: number | null;
  new_48h_count: number;
  price_drop_count: number;
}

export interface PropertyList {
  total: number;
  limit: number;
  offset: number;
  stats: MarketStats;
  items: Property[];
}

export interface PriceHistoryPoint {
  price: number;
  recorded_at: string;
}

export interface PriceHistoryResponse {
  centris_id: string;
  current_price: number | null;
  initial_price: number | null;
  previous_price: number | null;
  points: PriceHistoryPoint[];
}

export interface LastScrape {
  status: string;
  started_at: string;
  finished_at: string | null;
  listings_found: number;
  listings_upserted: number;
  error_message: string | null;
}

export interface Meta {
  walk_radius_meters: number;
  operational_stations: number;
  active_properties: number;
  properties_near_transit: number;
  price_drops_count: number;
  new_48h_count: number;
  last_scrape: LastScrape | null;
}

export interface PropertyFilters {
  minPrice: number | null;
  maxPrice: number | null;
  minRooms: number | null;
  studioOnly: boolean;
  minBathrooms: number | null;
  minArea: number | null;
  maxPricePerSqft: number | null;
  parkingRequired: boolean;
  petsAllowed: boolean;
  furnished: boolean;
  appliancesIncluded: boolean;
  laundryInUnit: boolean;
  utilitiesIncluded: boolean;
  airConditioning: boolean;
  balcony: boolean;
  moveIn: MoveInFilter;
  priceDropsOnly: boolean;
  addedWithinDays: number | null;
  maxWalkMinutes: number;
  network: NetworkFilter;
  lines: TransitLine[];
  stationName: string | null;
  search: string;
  sort: SortOption;
}

export const PRICE_MIN = 500;
export const PRICE_MAX = 5000;
export const PRICE_STEP = 50;
export const WALK_MIN = 2;
export const WALK_MAX = 15;

export const ALL_TRANSIT_LINES: TransitLine[] = ["Green", "Orange", "Blue", "Yellow", "REM"];

export const DEFAULT_FILTERS: PropertyFilters = {
  minPrice: null,
  maxPrice: null,
  minRooms: null,
  studioOnly: false,
  minBathrooms: null,
  minArea: null,
  maxPricePerSqft: null,
  parkingRequired: false,
  petsAllowed: false,
  furnished: false,
  appliancesIncluded: false,
  laundryInUnit: false,
  utilitiesIncluded: false,
  airConditioning: false,
  balcony: false,
  moveIn: "any",
  priceDropsOnly: false,
  addedWithinDays: null,
  maxWalkMinutes: WALK_MAX,
  network: "ALL",
  lines: [],
  stationName: null,
  search: "",
  sort: "price_asc",
};

export function isDefaultFilters(filters: PropertyFilters): boolean {
  return (
    filters.minPrice === DEFAULT_FILTERS.minPrice &&
    filters.maxPrice === DEFAULT_FILTERS.maxPrice &&
    filters.minRooms === DEFAULT_FILTERS.minRooms &&
    filters.studioOnly === DEFAULT_FILTERS.studioOnly &&
    filters.minBathrooms === DEFAULT_FILTERS.minBathrooms &&
    filters.minArea === DEFAULT_FILTERS.minArea &&
    filters.maxPricePerSqft === DEFAULT_FILTERS.maxPricePerSqft &&
    filters.parkingRequired === DEFAULT_FILTERS.parkingRequired &&
    filters.petsAllowed === DEFAULT_FILTERS.petsAllowed &&
    filters.furnished === DEFAULT_FILTERS.furnished &&
    filters.appliancesIncluded === DEFAULT_FILTERS.appliancesIncluded &&
    filters.laundryInUnit === DEFAULT_FILTERS.laundryInUnit &&
    filters.utilitiesIncluded === DEFAULT_FILTERS.utilitiesIncluded &&
    filters.airConditioning === DEFAULT_FILTERS.airConditioning &&
    filters.balcony === DEFAULT_FILTERS.balcony &&
    filters.moveIn === DEFAULT_FILTERS.moveIn &&
    filters.priceDropsOnly === DEFAULT_FILTERS.priceDropsOnly &&
    filters.addedWithinDays === DEFAULT_FILTERS.addedWithinDays &&
    filters.maxWalkMinutes === DEFAULT_FILTERS.maxWalkMinutes &&
    filters.network === DEFAULT_FILTERS.network &&
    filters.lines.length === 0 &&
    filters.stationName === DEFAULT_FILTERS.stationName &&
    filters.search.trim() === "" &&
    filters.sort === DEFAULT_FILTERS.sort
  );
}

export function countActiveFilters(filters: PropertyFilters): number {
  let count = 0;
  if (filters.minPrice !== null) count++;
  if (filters.maxPrice !== null) count++;
  if (filters.minRooms !== null || filters.studioOnly) count++;
  if (filters.minBathrooms !== null) count++;
  if (filters.minArea !== null) count++;
  if (filters.maxPricePerSqft !== null) count++;
  if (filters.parkingRequired) count++;
  if (filters.petsAllowed) count++;
  if (filters.furnished) count++;
  if (filters.appliancesIncluded) count++;
  if (filters.laundryInUnit) count++;
  if (filters.utilitiesIncluded) count++;
  if (filters.airConditioning) count++;
  if (filters.balcony) count++;
  if (filters.moveIn !== "any") count++;
  if (filters.priceDropsOnly) count++;
  if (filters.addedWithinDays !== null) count++;
  if (filters.maxWalkMinutes < WALK_MAX) count++;
  if (filters.network !== "ALL") count++;
  if (filters.lines.length > 0) count++;
  if (filters.stationName !== null) count++;
  if (filters.search.trim() !== "") count++;
  return count;
}

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

type QueryValue = string | number | boolean | null | undefined;

async function request<T>(
  path: string,
  query: Record<string, QueryValue>,
  signal?: AbortSignal,
): Promise<T> {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === null || value === undefined || value === "") continue;
    search.set(key, String(value));
  }
  const queryString = search.toString();
  const url = `${API_BASE_URL}${path}${queryString ? `?${queryString}` : ""}`;

  let response: Response;
  try {
    response = await fetch(url, {
      signal,
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
  } catch (error) {
    if (isAbortError(error)) throw error;
    throw new ApiError(`Cannot reach the API at ${API_BASE_URL}. Is the backend running?`, 0);
  }

  if (!response.ok) {
    let detail = `Request failed with status ${response.status}`;
    try {
      const body = (await response.json()) as { detail?: unknown };
      if (typeof body.detail === "string") {
        detail = body.detail;
      }
    } catch {
      // Response body was not JSON; keep the generic message.
    }
    throw new ApiError(detail, response.status);
  }

  return (await response.json()) as T;
}

export interface StationQuery {
  network?: Network;
  line?: string;
  operationalOnly?: boolean;
}

export function fetchStations(query: StationQuery = {}, signal?: AbortSignal): Promise<StationList> {
  return request<StationList>(
    "/api/stations",
    {
      network: query.network,
      line: query.line,
      operational_only: query.operationalOnly ?? true,
    },
    signal,
  );
}

export interface PageQuery {
  limit: number;
  offset: number;
}

export function fetchProperties(
  filters: PropertyFilters,
  page: PageQuery,
  signal?: AbortSignal,
): Promise<PropertyList> {
  const backendSort: BackendSortOption =
    filters.sort === "commute_asc" ? "walk_asc" : filters.sort;

  return request<PropertyList>(
    "/api/properties",
    {
      min_price: filters.minPrice,
      max_price: filters.maxPrice,
      min_rooms: filters.studioOnly ? 0 : filters.minRooms,
      max_rooms: filters.studioOnly ? 0 : undefined,
      min_bathrooms: filters.minBathrooms,
      min_area: filters.minArea,
      max_price_per_sqft: filters.maxPricePerSqft,
      parking_required: filters.parkingRequired ? true : undefined,
      pets_allowed: filters.petsAllowed ? true : undefined,
      furnished: filters.furnished ? true : undefined,
      appliances_included: filters.appliancesIncluded ? true : undefined,
      laundry_in_unit: filters.laundryInUnit ? true : undefined,
      utilities_included: filters.utilitiesIncluded ? true : undefined,
      air_conditioning: filters.airConditioning ? true : undefined,
      balcony: filters.balcony ? true : undefined,
      move_in: filters.moveIn === "any" ? undefined : filters.moveIn,
      price_drops_only: filters.priceDropsOnly ? true : undefined,
      added_within_days: filters.addedWithinDays,
      max_walk_minutes: filters.maxWalkMinutes < WALK_MAX ? filters.maxWalkMinutes : undefined,
      network: filters.network === "ALL" ? undefined : filters.network,
      lines: filters.lines.length > 0 ? filters.lines.join(",") : undefined,
      station_name: filters.stationName ?? undefined,
      search: filters.search.trim() || undefined,
      sort: backendSort,
      limit: page.limit,
      offset: page.offset,
    },
    signal,
  );
}

export function fetchPriceHistory(
  centrisId: string,
  signal?: AbortSignal,
): Promise<PriceHistoryResponse> {
  return request<PriceHistoryResponse>(
    `/api/properties/${encodeURIComponent(centrisId)}/price-history`,
    {},
    signal,
  );
}

export function fetchMeta(signal?: AbortSignal): Promise<Meta> {
  return request<Meta>("/api/meta", {}, signal);
}
