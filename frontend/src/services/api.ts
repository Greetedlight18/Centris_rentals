export const API_BASE_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000").replace(
  /\/+$/,
  "",
);

export type Network = "METRO" | "REM";
export type NetworkFilter = Network | "ALL";
export type SortOption = "price_asc" | "price_desc" | "walk_asc" | "newest";

export interface Station {
  id: number;
  name: string;
  network: Network;
  line: string;
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

export interface Property {
  id: number;
  centris_id: string;
  title: string | null;
  property_type: string | null;
  price: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  net_area_sqft: number | null;
  parking_available: boolean;
  address: string | null;
  city: string | null;
  latitude: number;
  longitude: number;
  url: string;
  image_url: string | null;
  nearest_station_distance_m: number | null;
  walk_minutes: number | null;
  scraped_at: string;
  station_id: number;
  station_name: string;
  station_network: string;
  station_line: string;
  station_color: string;
}

export interface PropertyList {
  total: number;
  limit: number;
  offset: number;
  items: Property[];
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
  last_scrape: LastScrape | null;
}

export interface PropertyFilters {
  maxPrice: number | null;
  minRooms: number | null;
  parkingRequired: boolean;
  maxWalkMinutes: number;
  network: NetworkFilter;
  sort: SortOption;
}

export const PRICE_MIN = 500;
export const PRICE_MAX = 5000;
export const PRICE_STEP = 50;
export const WALK_MIN = 5;
export const WALK_MAX = 15;

export const DEFAULT_FILTERS: PropertyFilters = {
  maxPrice: null,
  minRooms: null,
  parkingRequired: false,
  maxWalkMinutes: WALK_MAX,
  network: "ALL",
  sort: "price_asc",
};

export function isDefaultFilters(filters: PropertyFilters): boolean {
  return (
    filters.maxPrice === DEFAULT_FILTERS.maxPrice &&
    filters.minRooms === DEFAULT_FILTERS.minRooms &&
    filters.parkingRequired === DEFAULT_FILTERS.parkingRequired &&
    filters.maxWalkMinutes === DEFAULT_FILTERS.maxWalkMinutes &&
    filters.network === DEFAULT_FILTERS.network &&
    filters.sort === DEFAULT_FILTERS.sort
  );
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
    if (value === null || value === undefined) continue;
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
  return request<PropertyList>(
    "/api/properties",
    {
      max_price: filters.maxPrice,
      min_rooms: filters.minRooms,
      parking_required: filters.parkingRequired ? true : undefined,
      max_walk_minutes: filters.maxWalkMinutes < WALK_MAX ? filters.maxWalkMinutes : undefined,
      network: filters.network === "ALL" ? undefined : filters.network,
      sort: filters.sort,
      limit: page.limit,
      offset: page.offset,
    },
    signal,
  );
}

export function fetchMeta(signal?: AbortSignal): Promise<Meta> {
  return request<Meta>("/api/meta", {}, signal);
}