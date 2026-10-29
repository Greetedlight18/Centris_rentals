import logging
import os
from contextlib import asynccontextmanager
from datetime import date, datetime
from typing import Any, Literal, Optional

import psycopg
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from psycopg.rows import dict_row
from psycopg_pool import AsyncConnectionPool
from pydantic import BaseModel, Field

# ---------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
)
logger = logging.getLogger("rentals-backend")

DATABASE_URL = os.environ.get("DATABASE_URL")
if not DATABASE_URL:
    raise RuntimeError("DATABASE_URL environment variable is required")

CORS_ORIGINS = [
    origin.strip()
    for origin in os.environ.get("CORS_ORIGINS", "http://localhost:3000").split(",")
    if origin.strip()
]

WALK_RADIUS_METERS = float(os.environ.get("WALK_RADIUS_METERS", "1200"))

MAX_PAGE_SIZE = 5000
VALID_LINES = {"Green", "Orange", "Blue", "Yellow", "REM"}

SortOption = Literal[
    "price_asc",
    "price_desc",
    "walk_asc",
    "newest",
    "price_drop_desc",
    "sqft_desc",
    "ppsqft_asc",
]

SORT_CLAUSES: dict[str, str] = {
    "price_asc": "price ASC NULLS LAST, id ASC",
    "price_desc": "price DESC NULLS LAST, id ASC",
    "walk_asc": "walk_minutes ASC NULLS LAST, id ASC",
    "newest": "first_seen_at DESC, id DESC",
    "price_drop_desc": "price_drop DESC NULLS LAST, price ASC NULLS LAST, id ASC",
    "sqft_desc": "net_area_sqft DESC NULLS LAST, price ASC NULLS LAST, id ASC",
    "ppsqft_asc": "price_per_sqft ASC NULLS LAST, price ASC NULLS LAST, id ASC",
}


# ---------------------------------------------------------------------
# Idempotent Startup Schema Migration
# ---------------------------------------------------------------------
SCHEMA_MIGRATION_STATEMENTS: list[str] = [
    "SELECT pg_advisory_xact_lock(84729103)",
    "ALTER TABLE properties ADD COLUMN IF NOT EXISTS initial_price NUMERIC(10, 2)",
    "ALTER TABLE properties ADD COLUMN IF NOT EXISTS previous_price NUMERIC(10, 2)",
    "ALTER TABLE properties ADD COLUMN IF NOT EXISTS price_changed_at TIMESTAMPTZ",
    "ALTER TABLE properties ADD COLUMN IF NOT EXISTS net_area_sqft INTEGER",
    "ALTER TABLE properties ADD COLUMN IF NOT EXISTS pets_allowed BOOLEAN",
    "ALTER TABLE properties ADD COLUMN IF NOT EXISTS furnished BOOLEAN NOT NULL DEFAULT FALSE",
    "ALTER TABLE properties ADD COLUMN IF NOT EXISTS appliances_included BOOLEAN NOT NULL DEFAULT FALSE",
    "ALTER TABLE properties ADD COLUMN IF NOT EXISTS laundry_in_unit BOOLEAN NOT NULL DEFAULT FALSE",
    "ALTER TABLE properties ADD COLUMN IF NOT EXISTS heating_included BOOLEAN NOT NULL DEFAULT FALSE",
    "ALTER TABLE properties ADD COLUMN IF NOT EXISTS hydro_included BOOLEAN NOT NULL DEFAULT FALSE",
    "ALTER TABLE properties ADD COLUMN IF NOT EXISTS internet_included BOOLEAN NOT NULL DEFAULT FALSE",
    "ALTER TABLE properties ADD COLUMN IF NOT EXISTS air_conditioning BOOLEAN NOT NULL DEFAULT FALSE",
    "ALTER TABLE properties ADD COLUMN IF NOT EXISTS balcony BOOLEAN NOT NULL DEFAULT FALSE",
    "ALTER TABLE properties ADD COLUMN IF NOT EXISTS move_in_date DATE",
    "ALTER TABLE properties ADD COLUMN IF NOT EXISTS move_in_label TEXT",
    "ALTER TABLE properties ADD COLUMN IF NOT EXISTS available_immediately BOOLEAN NOT NULL DEFAULT FALSE",
    "ALTER TABLE properties ADD COLUMN IF NOT EXISTS description_excerpt TEXT",
    "ALTER TABLE properties ADD COLUMN IF NOT EXISTS photo_urls TEXT[] NOT NULL DEFAULT '{}'",
    "ALTER TABLE properties ADD COLUMN IF NOT EXISTS reachable_lines TEXT[] NOT NULL DEFAULT '{}'",
    "ALTER TABLE properties ADD COLUMN IF NOT EXISTS reachable_networks TEXT[] NOT NULL DEFAULT '{}'",
    "ALTER TABLE properties ADD COLUMN IF NOT EXISTS reachable_station_ids INTEGER[] NOT NULL DEFAULT '{}'",
    "ALTER TABLE properties ADD COLUMN IF NOT EXISTS nearby_stations JSONB NOT NULL DEFAULT '[]'::jsonb",
    "ALTER TABLE properties ADD COLUMN IF NOT EXISTS detail_scraped_at TIMESTAMPTZ",
    "ALTER TABLE properties ADD COLUMN IF NOT EXISTS detail_schema_version SMALLINT NOT NULL DEFAULT 1",
    "CREATE INDEX IF NOT EXISTS idx_properties_first_seen_at ON properties (first_seen_at DESC)",
    "CREATE INDEX IF NOT EXISTS idx_properties_reachable_lines ON properties USING GIN (reachable_lines)",
    "CREATE INDEX IF NOT EXISTS idx_properties_reachable_stations ON properties USING GIN (reachable_station_ids)",
    """
    CREATE TABLE IF NOT EXISTS property_price_history (
        id          BIGSERIAL PRIMARY KEY,
        property_id BIGINT         NOT NULL REFERENCES properties (id) ON DELETE CASCADE,
        price       NUMERIC(10, 2) NOT NULL,
        recorded_at TIMESTAMPTZ    NOT NULL DEFAULT NOW()
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_price_history_property ON property_price_history (property_id, recorded_at ASC)",
    """
    CREATE OR REPLACE FUNCTION track_property_price_before() RETURNS TRIGGER AS $$
    BEGIN
        IF TG_OP = 'INSERT' THEN
            IF NEW.price IS NOT NULL AND NEW.initial_price IS NULL THEN
                NEW.initial_price := NEW.price;
            END IF;
        ELSIF TG_OP = 'UPDATE' THEN
            NEW.initial_price := COALESCE(OLD.initial_price, OLD.price, NEW.price);
            IF NEW.price IS NOT NULL AND OLD.price IS NOT NULL AND NEW.price <> OLD.price THEN
                NEW.previous_price   := OLD.price;
                NEW.price_changed_at := NOW();
            END IF;
        END IF;
        RETURN NEW;
    END;
    $$ LANGUAGE plpgsql
    """,
    "DROP TRIGGER IF EXISTS trg_properties_price_before ON properties",
    """
    CREATE TRIGGER trg_properties_price_before
        BEFORE INSERT OR UPDATE ON properties
        FOR EACH ROW EXECUTE FUNCTION track_property_price_before()
    """,
    """
    CREATE OR REPLACE FUNCTION track_property_price_after() RETURNS TRIGGER AS $$
    BEGIN
        IF NEW.price IS NOT NULL THEN
            IF TG_OP = 'INSERT' THEN
                INSERT INTO property_price_history (property_id, price, recorded_at)
                VALUES (NEW.id, NEW.price, COALESCE(NEW.first_seen_at, NOW()));
            ELSIF TG_OP = 'UPDATE' AND (OLD.price IS NULL OR NEW.price <> OLD.price) THEN
                INSERT INTO property_price_history (property_id, price, recorded_at)
                VALUES (NEW.id, NEW.price, NOW());
            END IF;
        END IF;
        RETURN NULL;
    END;
    $$ LANGUAGE plpgsql
    """,
    "DROP TRIGGER IF EXISTS trg_properties_price_after ON properties",
    """
    CREATE TRIGGER trg_properties_price_after
        AFTER INSERT OR UPDATE OF price ON properties
        FOR EACH ROW EXECUTE FUNCTION track_property_price_after()
    """,
    """
    CREATE OR REPLACE FUNCTION compute_property_transit() RETURNS TRIGGER AS $$
    DECLARE
        v_station_id INTEGER;
        v_distance   DOUBLE PRECISION;
        v_speed_mpm  CONSTANT DOUBLE PRECISION := 80.0;
        v_max_min    CONSTANT DOUBLE PRECISION := 15.0;
        v_max_dist   CONSTANT DOUBLE PRECISION := 1200.0;
    BEGIN
        IF NEW.location IS NULL THEN
            NEW.nearest_station_id         := NULL;
            NEW.nearest_station_distance_m := NULL;
            NEW.walk_minutes               := NULL;
            NEW.within_15_min              := FALSE;
            NEW.reachable_lines            := '{}';
            NEW.reachable_networks         := '{}';
            NEW.reachable_station_ids      := '{}';
            NEW.nearby_stations            := '[]'::jsonb;
            RETURN NEW;
        END IF;

        SELECT s.id, ST_Distance(s.location, NEW.location)
          INTO v_station_id, v_distance
          FROM stations s
         WHERE s.is_operational = TRUE
         ORDER BY s.location <-> NEW.location, s.id ASC
         LIMIT 1;

        NEW.nearest_station_id         := v_station_id;
        NEW.nearest_station_distance_m := v_distance;
        NEW.walk_minutes               := CASE WHEN v_distance IS NULL THEN NULL ELSE v_distance / v_speed_mpm END;
        NEW.within_15_min              := COALESCE((v_distance / v_speed_mpm) <= v_max_min, FALSE);

        IF NEW.within_15_min THEN
            SELECT COALESCE(array_agg(sub.id ORDER BY sub.dist ASC, sub.id ASC), '{}')
              INTO NEW.reachable_station_ids
              FROM (
                  SELECT s.id, ST_Distance(s.location, NEW.location) AS dist
                    FROM stations s
                   WHERE s.is_operational = TRUE
                     AND ST_DWithin(s.location, NEW.location, v_max_dist + 5.0)
                     AND ST_Distance(s.location, NEW.location) <= v_max_dist
              ) sub;

            SELECT COALESCE(array_agg(sub.line ORDER BY sub.min_dist ASC, sub.line ASC), '{}')
              INTO NEW.reachable_lines
              FROM (
                  SELECT s.line, MIN(ST_Distance(s.location, NEW.location)) AS min_dist
                    FROM stations s
                   WHERE s.is_operational = TRUE
                     AND ST_DWithin(s.location, NEW.location, v_max_dist + 5.0)
                     AND ST_Distance(s.location, NEW.location) <= v_max_dist
                   GROUP BY s.line
              ) sub;

            SELECT COALESCE(array_agg(sub.network ORDER BY sub.min_dist ASC, sub.network ASC), '{}')
              INTO NEW.reachable_networks
              FROM (
                  SELECT s.network, MIN(ST_Distance(s.location, NEW.location)) AS min_dist
                    FROM stations s
                   WHERE s.is_operational = TRUE
                     AND ST_DWithin(s.location, NEW.location, v_max_dist + 5.0)
                     AND ST_Distance(s.location, NEW.location) <= v_max_dist
                   GROUP BY s.network
              ) sub;

            SELECT COALESCE(
                jsonb_agg(
                    jsonb_build_object(
                        'station_id', sub.station_id,
                        'name', sub.name,
                        'network', sub.network,
                        'lines', sub.lines,
                        'colors', sub.colors,
                        'distance_m', ROUND(sub.dist::numeric, 1),
                        'walk_minutes', ROUND((sub.dist / v_speed_mpm)::numeric, 1)
                    )
                    ORDER BY sub.dist ASC, sub.name ASC
                ),
                '[]'::jsonb
            )
              INTO NEW.nearby_stations
              FROM (
                  SELECT MIN(s.id) AS station_id,
                         s.name,
                         s.network,
                         MIN(ST_Distance(s.location, NEW.location)) AS dist,
                         array_agg(s.line ORDER BY s.id ASC) AS lines,
                         array_agg(s.line_color ORDER BY s.id ASC) AS colors
                    FROM stations s
                   WHERE s.is_operational = TRUE
                     AND ST_DWithin(s.location, NEW.location, v_max_dist + 5.0)
                     AND ST_Distance(s.location, NEW.location) <= v_max_dist
                   GROUP BY s.name, s.network
              ) sub;
        ELSE
            NEW.reachable_lines       := '{}';
            NEW.reachable_networks    := '{}';
            NEW.reachable_station_ids := '{}';
            NEW.nearby_stations       := '[]'::jsonb;
        END IF;

        RETURN NEW;
    END;
    $$ LANGUAGE plpgsql
    """,
    "DROP TRIGGER IF EXISTS trg_properties_transit ON properties",
    """
    CREATE TRIGGER trg_properties_transit
        BEFORE INSERT OR UPDATE OF location ON properties
        FOR EACH ROW EXECUTE FUNCTION compute_property_transit()
    """,
    "UPDATE properties SET initial_price = price WHERE initial_price IS NULL AND price IS NOT NULL",
    """
    INSERT INTO property_price_history (property_id, price, recorded_at)
    SELECT p.id, p.price, p.first_seen_at
      FROM properties p
     WHERE p.price IS NOT NULL
       AND NOT EXISTS (
           SELECT 1 FROM property_price_history h WHERE h.property_id = p.id
       )
    """,
    """
    UPDATE properties
       SET location = location
     WHERE location IS NOT NULL
       AND within_15_min = TRUE
       AND cardinality(reachable_lines) = 0
    """,
    "DROP VIEW IF EXISTS v_properties_near_transit",
    """
    CREATE VIEW v_properties_near_transit AS
    SELECT p.id,
           p.centris_id,
           p.title,
           p.property_type,
           p.price,
           p.initial_price,
           p.previous_price,
           p.price_changed_at,
           CASE
               WHEN p.price IS NOT NULL AND p.previous_price IS NOT NULL AND p.price < p.previous_price
                   THEN p.previous_price - p.price
               WHEN p.price IS NOT NULL AND p.initial_price IS NOT NULL AND p.price < p.initial_price
                   THEN p.initial_price - p.price
               ELSE NULL
           END AS price_drop,
           CASE
               WHEN p.price IS NOT NULL AND p.net_area_sqft IS NOT NULL AND p.net_area_sqft > 0
                   THEN ROUND((p.price / p.net_area_sqft)::numeric, 2)
               ELSE NULL
           END AS price_per_sqft,
           p.bedrooms,
           p.bathrooms,
           p.net_area_sqft,
           p.parking_available,
           p.pets_allowed,
           p.furnished,
           p.appliances_included,
           p.laundry_in_unit,
           p.heating_included,
           p.hydro_included,
           p.internet_included,
           p.air_conditioning,
           p.balcony,
           p.move_in_date,
           p.move_in_label,
           p.available_immediately,
           p.description_excerpt,
           p.photo_urls,
           p.address,
           p.city,
           ST_Y(p.location::geometry) AS latitude,
           ST_X(p.location::geometry) AS longitude,
           p.url,
           p.image_url,
           p.nearest_station_distance_m,
           p.walk_minutes,
           p.reachable_lines,
           p.reachable_networks,
           p.reachable_station_ids,
           p.nearby_stations,
           p.first_seen_at,
           p.scraped_at,
           s.id         AS station_id,
           s.name       AS station_name,
           s.network    AS station_network,
           s.line       AS station_line,
           s.line_color AS station_color
      FROM properties p
      JOIN stations s ON s.id = p.nearest_station_id
     WHERE p.is_active = TRUE
       AND p.within_15_min = TRUE
    """,
]


async def ensure_schema(pool: AsyncConnectionPool) -> None:
    async with pool.connection() as conn:
        async with conn.transaction():
            for statement in SCHEMA_MIGRATION_STATEMENTS:
                await conn.execute(statement)
    logger.info("Database schema verified and up to date")


# ---------------------------------------------------------------------
# Response models
# ---------------------------------------------------------------------
class Station(BaseModel):
    id: int
    name: str
    network: Literal["METRO", "REM"]
    line: str
    branch: Optional[str] = None
    line_color: str
    is_operational: bool
    coords_verified: bool
    latitude: float
    longitude: float


class StationList(BaseModel):
    count: int
    items: list[Station]


class NearbyStation(BaseModel):
    station_id: int
    name: str
    network: str
    lines: list[str] = Field(default_factory=list)
    colors: list[str] = Field(default_factory=list)
    distance_m: float
    walk_minutes: float


class Property(BaseModel):
    id: int
    centris_id: str
    title: Optional[str] = None
    property_type: Optional[str] = None
    price: Optional[float] = None
    initial_price: Optional[float] = None
    previous_price: Optional[float] = None
    price_changed_at: Optional[datetime] = None
    price_drop: Optional[float] = None
    price_per_sqft: Optional[float] = None
    bedrooms: Optional[int] = None
    bathrooms: Optional[int] = None
    net_area_sqft: Optional[int] = None
    parking_available: bool = False
    pets_allowed: Optional[bool] = None
    furnished: bool = False
    appliances_included: bool = False
    laundry_in_unit: bool = False
    heating_included: bool = False
    hydro_included: bool = False
    internet_included: bool = False
    air_conditioning: bool = False
    balcony: bool = False
    move_in_date: Optional[date] = None
    move_in_label: Optional[str] = None
    available_immediately: bool = False
    description_excerpt: Optional[str] = None
    photo_urls: list[str] = Field(default_factory=list)
    address: Optional[str] = None
    city: Optional[str] = None
    latitude: float
    longitude: float
    url: str
    image_url: Optional[str] = None
    nearest_station_distance_m: Optional[float] = None
    walk_minutes: Optional[float] = None
    reachable_lines: list[str] = Field(default_factory=list)
    reachable_networks: list[str] = Field(default_factory=list)
    reachable_station_ids: list[int] = Field(default_factory=list)
    nearby_stations: list[NearbyStation] = Field(default_factory=list)
    first_seen_at: datetime
    scraped_at: datetime
    station_id: int
    station_name: str
    station_network: str
    station_line: str
    station_color: str


class MarketStats(BaseModel):
    median_price: Optional[float] = None
    avg_price_per_sqft: Optional[float] = None
    avg_walk_minutes: Optional[float] = None
    new_48h_count: int = 0
    price_drop_count: int = 0


class PropertyList(BaseModel):
    total: int
    limit: int
    offset: int
    stats: MarketStats
    items: list[Property]


class PriceHistoryPoint(BaseModel):
    price: float
    recorded_at: datetime


class PriceHistoryResponse(BaseModel):
    centris_id: str
    current_price: Optional[float] = None
    initial_price: Optional[float] = None
    previous_price: Optional[float] = None
    points: list[PriceHistoryPoint] = Field(default_factory=list)


class LastScrape(BaseModel):
    status: str
    started_at: datetime
    finished_at: Optional[datetime] = None
    listings_found: int
    listings_upserted: int
    error_message: Optional[str] = None


class Meta(BaseModel):
    walk_radius_meters: float
    operational_stations: int
    active_properties: int
    properties_near_transit: int
    price_drops_count: int = 0
    new_48h_count: int = 0
    last_scrape: Optional[LastScrape] = None


# ---------------------------------------------------------------------
# Database lifecycle
# ---------------------------------------------------------------------
@asynccontextmanager
async def lifespan(app: FastAPI):
    pool = AsyncConnectionPool(
        conninfo=DATABASE_URL,
        min_size=1,
        max_size=10,
        open=False,
        kwargs={"row_factory": dict_row},
    )
    await pool.open(wait=True, timeout=60)
    await ensure_schema(pool)
    app.state.pool = pool
    logger.info("Database connection pool opened")
    try:
        yield
    finally:
        await pool.close()
        logger.info("Database connection pool closed")


app = FastAPI(
    title="Montreal Rentals API",
    description="Rental listings within a 15-minute walk of Montreal Metro and REM stations.",
    version="2.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=False,
    allow_methods=["GET", "OPTIONS"],
    allow_headers=["*"],
)


@app.exception_handler(psycopg.Error)
async def database_error_handler(request: Request, exc: psycopg.Error):
    logger.exception("Database error on %s", request.url.path)
    return JSONResponse(
        status_code=503,
        content={"detail": "Database unavailable or query failed"},
    )


async def fetch_all(request: Request, sql: str, params: Optional[list[Any]] = None) -> list[dict]:
    pool: AsyncConnectionPool = request.app.state.pool
    async with pool.connection() as conn:
        cur = await conn.execute(sql, params or [])
        return await cur.fetchall()


async def fetch_one(request: Request, sql: str, params: Optional[list[Any]] = None) -> Optional[dict]:
    pool: AsyncConnectionPool = request.app.state.pool
    async with pool.connection() as conn:
        cur = await conn.execute(sql, params or [])
        return await cur.fetchone()


# ---------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------
@app.get("/health")
async def health(request: Request):
    try:
        row = await fetch_one(request, "SELECT 1 AS ok")
        if not row or row["ok"] != 1:
            raise RuntimeError("Unexpected health query result")
    except Exception:
        logger.exception("Health check failed")
        return JSONResponse(
            status_code=503,
            content={"status": "unhealthy", "database": "down"},
        )
    return {"status": "ok", "database": "up"}


@app.get("/api/stations", response_model=StationList)
async def list_stations(
    request: Request,
    network: Optional[Literal["METRO", "REM"]] = Query(None, description="Filter by network"),
    line: Optional[Literal["Green", "Orange", "Blue", "Yellow", "REM"]] = Query(
        None, description="Filter by line"
    ),
    operational_only: bool = Query(True, description="Hide stations that are not yet open"),
):
    conditions: list[str] = []
    params: list[Any] = []

    if network is not None:
        conditions.append("network = %s")
        params.append(network)
    if line is not None:
        conditions.append("line = %s")
        params.append(line)
    if operational_only:
        conditions.append("is_operational = TRUE")

    where_sql = f"WHERE {' AND '.join(conditions)}" if conditions else ""

    sql = f"""
        SELECT id,
               name,
               network,
               line,
               branch,
               line_color,
               is_operational,
               coords_verified,
               ST_Y(location::geometry) AS latitude,
               ST_X(location::geometry) AS longitude
          FROM stations
          {where_sql}
         ORDER BY network, line, name
    """
    rows = await fetch_all(request, sql, params)
    return {"count": len(rows), "items": rows}


@app.get("/api/properties", response_model=PropertyList)
async def list_properties(
    request: Request,
    max_price: Optional[float] = Query(None, ge=0, description="Maximum monthly rent"),
    min_price: Optional[float] = Query(None, ge=0, description="Minimum monthly rent"),
    min_rooms: Optional[int] = Query(None, ge=0, le=20, description="Minimum number of bedrooms"),
    max_rooms: Optional[int] = Query(None, ge=0, le=20, description="Maximum number of bedrooms"),
    min_bathrooms: Optional[int] = Query(None, ge=1, le=10, description="Minimum number of bathrooms"),
    min_area: Optional[int] = Query(None, ge=0, le=20000, description="Minimum net area in sq ft"),
    max_price_per_sqft: Optional[float] = Query(None, gt=0, description="Maximum rent per sq ft"),
    parking_required: bool = Query(False, description="Only listings with parking"),
    pets_allowed: bool = Query(False, description="Only listings allowing pets"),
    furnished: bool = Query(False, description="Only furnished listings"),
    appliances_included: bool = Query(False, description="Only listings with appliances"),
    laundry_in_unit: bool = Query(False, description="Only listings with in-unit laundry"),
    utilities_included: bool = Query(False, description="Heating or electricity included"),
    air_conditioning: bool = Query(False, description="Only listings with A/C"),
    balcony: bool = Query(False, description="Only listings with balcony or terrace"),
    move_in: Optional[Literal["immediate", "july_1"]] = Query(
        None, description="Move-in availability filter"
    ),
    price_drops_only: bool = Query(False, description="Only listings whose price dropped"),
    added_within_days: Optional[int] = Query(
        None, ge=1, le=90, description="Only listings first seen within N days"
    ),
    max_walk_minutes: Optional[float] = Query(
        None, gt=0, le=15, description="Maximum walking minutes to a matching station (up to 15)"
    ),
    network: Optional[Literal["METRO", "REM"]] = Query(None, description="Reachable station network"),
    lines: Optional[str] = Query(
        None, description="Comma-separated transit lines (Green,Orange,Blue,Yellow,REM)"
    ),
    station_id: Optional[int] = Query(None, ge=1, description="Reachable station ID"),
    station_name: Optional[str] = Query(None, max_length=80, description="Reachable station name"),
    search: Optional[str] = Query(None, max_length=100, description="Search address, city, station, ID"),
    sort: SortOption = Query("price_asc"),
    limit: int = Query(300, ge=1, le=MAX_PAGE_SIZE),
    offset: int = Query(0, ge=0),
):
    conditions: list[str] = []
    params: list[Any] = []
    walk_limit = max_walk_minutes if max_walk_minutes is not None else 15.0

    if max_price is not None:
        conditions.append("price <= %s")
        params.append(max_price)
    if min_price is not None:
        conditions.append("price >= %s")
        params.append(min_price)
    if min_rooms is not None:
        conditions.append("bedrooms >= %s")
        params.append(min_rooms)
    if max_rooms is not None:
        conditions.append("bedrooms <= %s")
        params.append(max_rooms)
    if min_bathrooms is not None:
        conditions.append("bathrooms >= %s")
        params.append(min_bathrooms)
    if min_area is not None and min_area > 0:
        conditions.append("net_area_sqft >= %s")
        params.append(min_area)
    if max_price_per_sqft is not None:
        conditions.append("price_per_sqft <= %s")
        params.append(max_price_per_sqft)
    if parking_required:
        conditions.append("parking_available = TRUE")
    if pets_allowed:
        conditions.append("pets_allowed = TRUE")
    if furnished:
        conditions.append("furnished = TRUE")
    if appliances_included:
        conditions.append("appliances_included = TRUE")
    if laundry_in_unit:
        conditions.append("laundry_in_unit = TRUE")
    if utilities_included:
        conditions.append("(heating_included = TRUE OR hydro_included = TRUE)")
    if air_conditioning:
        conditions.append("air_conditioning = TRUE")
    if balcony:
        conditions.append("balcony = TRUE")

    if move_in == "immediate":
        conditions.append(
            "(available_immediately = TRUE OR (move_in_date IS NOT NULL AND move_in_date <= CURRENT_DATE + 14))"
        )
    elif move_in == "july_1":
        conditions.append(
            "("
            "(move_in_date IS NOT NULL AND EXTRACT(MONTH FROM move_in_date) = 7 AND EXTRACT(DAY FROM move_in_date) <= 7) "
            "OR (move_in_date IS NOT NULL AND EXTRACT(MONTH FROM move_in_date) = 6 AND EXTRACT(DAY FROM move_in_date) >= 24) "
            "OR move_in_label ILIKE %s "
            "OR move_in_label ILIKE %s "
            "OR move_in_label ILIKE %s "
            "OR move_in_label ILIKE %s"
            ")"
        )
        params.extend(["%july 1%", "%jul 1%", "%1er juillet%", "%1 juillet%"])

    if price_drops_only:
        conditions.append("price_drop IS NOT NULL AND price_drop > 0")

    if added_within_days is not None:
        conditions.append("first_seen_at >= NOW() - (%s * INTERVAL '1 day')")
        params.append(added_within_days)

    parsed_lines: list[str] = []
    if lines:
        parsed_lines = [ln.strip() for ln in lines.split(",") if ln.strip() in VALID_LINES]

    cleaned_station_name = station_name.strip() if station_name and station_name.strip() else None

    if max_walk_minutes is not None and not parsed_lines and network is None and cleaned_station_name is None and station_id is None:
        conditions.append("walk_minutes <= %s")
        params.append(max_walk_minutes)

    if network is not None:
        conditions.append(
            """
            EXISTS (
                SELECT 1
                  FROM jsonb_array_elements(nearby_stations) AS ns
                 WHERE ns->>'network' = %s
                   AND (ns->>'walk_minutes')::float8 <= %s
            )
            """
        )
        params.extend([network, walk_limit])

    if parsed_lines:
        conditions.append(
            """
            EXISTS (
                SELECT 1
                  FROM jsonb_array_elements(nearby_stations) AS ns
                 WHERE EXISTS (
                           SELECT 1
                             FROM jsonb_array_elements_text(ns->'lines') AS ln
                            WHERE ln = ANY(%s::text[])
                       )
                   AND (ns->>'walk_minutes')::float8 <= %s
            )
            """
        )
        params.extend([parsed_lines, walk_limit])

    if cleaned_station_name is not None:
        conditions.append(
            """
            EXISTS (
                SELECT 1
                  FROM jsonb_array_elements(nearby_stations) AS ns
                 WHERE LOWER(ns->>'name') = LOWER(%s)
                   AND (ns->>'walk_minutes')::float8 <= %s
            )
            """
        )
        params.extend([cleaned_station_name, walk_limit])
    elif station_id is not None:
        conditions.append(
            """
            EXISTS (
                SELECT 1
                  FROM stations target_s,
                       jsonb_array_elements(nearby_stations) AS ns
                 WHERE target_s.id = %s
                   AND ns->>'name' = target_s.name
                   AND ns->>'network' = target_s.network
                   AND (ns->>'walk_minutes')::float8 <= %s
            )
            """
        )
        params.extend([station_id, walk_limit])

    if search and search.strip():
        like_term = f"%{search.strip()}%"
        conditions.append(
            "("
            "address ILIKE %s OR "
            "city ILIKE %s OR "
            "station_name ILIKE %s OR "
            "centris_id ILIKE %s OR "
            "property_type ILIKE %s OR "
            "description_excerpt ILIKE %s"
            ")"
        )
        params.extend([like_term, like_term, like_term, like_term, like_term, like_term])

    where_sql = f"WHERE {' AND '.join(conditions)}" if conditions else ""
    order_sql = SORT_CLAUSES[sort]

    agg_row = await fetch_one(
        request,
        f"""
        SELECT COUNT(*) AS total,
               PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY price) AS median_price,
               ROUND(AVG(price_per_sqft)::numeric, 2) AS avg_price_per_sqft,
               ROUND(AVG(walk_minutes)::numeric, 1) AS avg_walk_minutes,
               COUNT(*) FILTER (WHERE first_seen_at >= NOW() - INTERVAL '48 hours') AS new_48h_count,
               COUNT(*) FILTER (WHERE price_drop IS NOT NULL AND price_drop > 0) AS price_drop_count
          FROM v_properties_near_transit
          {where_sql}
        """,
        params,
    )
    total = int(agg_row["total"]) if agg_row else 0
    stats = {
        "median_price": float(agg_row["median_price"]) if agg_row and agg_row["median_price"] is not None else None,
        "avg_price_per_sqft": float(agg_row["avg_price_per_sqft"]) if agg_row and agg_row["avg_price_per_sqft"] is not None else None,
        "avg_walk_minutes": float(agg_row["avg_walk_minutes"]) if agg_row and agg_row["avg_walk_minutes"] is not None else None,
        "new_48h_count": int(agg_row["new_48h_count"]) if agg_row else 0,
        "price_drop_count": int(agg_row["price_drop_count"]) if agg_row else 0,
    }

    rows = await fetch_all(
        request,
        f"""
        SELECT id,
               centris_id,
               title,
               property_type,
               price,
               initial_price,
               previous_price,
               price_changed_at,
               price_drop,
               price_per_sqft,
               bedrooms,
               bathrooms,
               net_area_sqft,
               parking_available,
               pets_allowed,
               furnished,
               appliances_included,
               laundry_in_unit,
               heating_included,
               hydro_included,
               internet_included,
               air_conditioning,
               balcony,
               move_in_date,
               move_in_label,
               available_immediately,
               description_excerpt,
               photo_urls,
               address,
               city,
               latitude,
               longitude,
               url,
               image_url,
               nearest_station_distance_m,
               walk_minutes,
               reachable_lines,
               reachable_networks,
               reachable_station_ids,
               nearby_stations,
               first_seen_at,
               scraped_at,
               station_id,
               station_name,
               station_network,
               station_line,
               station_color
          FROM v_properties_near_transit
          {where_sql}
         ORDER BY {order_sql}
         LIMIT %s OFFSET %s
        """,
        params + [limit, offset],
    )

    return {
        "total": total,
        "limit": limit,
        "offset": offset,
        "stats": stats,
        "items": rows,
    }


@app.get("/api/properties/{centris_id}/price-history", response_model=PriceHistoryResponse)
async def get_price_history(request: Request, centris_id: str):
    prop = await fetch_one(
        request,
        """
        SELECT id, centris_id, price, initial_price, previous_price, first_seen_at
          FROM properties
         WHERE centris_id = %s
        """,
        [centris_id],
    )
    if not prop:
        raise HTTPException(status_code=404, detail="Listing not found")

    points = await fetch_all(
        request,
        """
        SELECT price, recorded_at
          FROM property_price_history
         WHERE property_id = %s
         ORDER BY recorded_at ASC, id ASC
        """,
        [prop["id"]],
    )
    if not points and prop["price"] is not None:
        points = [{"price": prop["price"], "recorded_at": prop["first_seen_at"]}]

    return {
        "centris_id": prop["centris_id"],
        "current_price": prop["price"],
        "initial_price": prop["initial_price"],
        "previous_price": prop["previous_price"],
        "points": points,
    }


@app.get("/api/meta", response_model=Meta)
async def meta(request: Request):
    counts = await fetch_one(
        request,
        """
        SELECT (SELECT COUNT(*) FROM stations WHERE is_operational = TRUE)                               AS operational_stations,
               (SELECT COUNT(*) FROM properties WHERE is_active = TRUE)                                  AS active_properties,
               (SELECT COUNT(*) FROM properties WHERE is_active = TRUE AND within_15_min = TRUE)          AS properties_near_transit,
               (SELECT COUNT(*) FROM v_properties_near_transit WHERE price_drop IS NOT NULL AND price_drop > 0) AS price_drops_count,
               (SELECT COUNT(*) FROM v_properties_near_transit WHERE first_seen_at >= NOW() - INTERVAL '48 hours') AS new_48h_count
        """,
    )
    last_scrape = await fetch_one(
        request,
        """
        SELECT status, started_at, finished_at, listings_found, listings_upserted, error_message
          FROM scrape_runs
         ORDER BY started_at DESC
         LIMIT 1
        """,
    )
    return {
        "walk_radius_meters": WALK_RADIUS_METERS,
        "operational_stations": int(counts["operational_stations"]),
        "active_properties": int(counts["active_properties"]),
        "properties_near_transit": int(counts["properties_near_transit"]),
        "price_drops_count": int(counts["price_drops_count"]),
        "new_48h_count": int(counts["new_48h_count"]),
        "last_scrape": last_scrape,
    }
