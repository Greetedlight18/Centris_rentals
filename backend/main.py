import logging
import os
from contextlib import asynccontextmanager
from datetime import datetime
from typing import Any, Literal, Optional

import psycopg
from fastapi import FastAPI, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from psycopg.rows import dict_row
from psycopg_pool import AsyncConnectionPool
from pydantic import BaseModel

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

SORT_CLAUSES = {
    "price_asc": "price ASC NULLS LAST, id ASC",
    "price_desc": "price DESC NULLS LAST, id ASC",
    "walk_asc": "walk_minutes ASC NULLS LAST, id ASC",
    "newest": "scraped_at DESC, id ASC",
}


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


class Property(BaseModel):
    id: int
    centris_id: str
    title: Optional[str] = None
    property_type: Optional[str] = None
    price: Optional[float] = None
    bedrooms: Optional[int] = None
    bathrooms: Optional[int] = None
    net_area_sqft: Optional[int] = None
    parking_available: bool
    address: Optional[str] = None
    city: Optional[str] = None
    latitude: float
    longitude: float
    url: str
    image_url: Optional[str] = None
    nearest_station_distance_m: Optional[float] = None
    walk_minutes: Optional[float] = None
    scraped_at: datetime
    station_id: int
    station_name: str
    station_network: str
    station_line: str
    station_color: str


class PropertyList(BaseModel):
    total: int
    limit: int
    offset: int
    items: list[Property]


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
    version="1.0.0",
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
    parking_required: bool = Query(False, description="Only listings with parking"),
    max_walk_minutes: Optional[float] = Query(
        None, gt=0, le=15, description="Maximum walking minutes to the nearest station (up to 15)"
    ),
    network: Optional[Literal["METRO", "REM"]] = Query(None, description="Nearest station network"),
    station_id: Optional[int] = Query(None, ge=1, description="Only listings nearest to this station"),
    sort: Literal["price_asc", "price_desc", "walk_asc", "newest"] = Query("price_asc"),
    limit: int = Query(200, ge=1, le=MAX_PAGE_SIZE),
    offset: int = Query(0, ge=0),
):
    conditions: list[str] = []
    params: list[Any] = []

    if max_price is not None:
        conditions.append("price <= %s")
        params.append(max_price)
    if min_price is not None:
        conditions.append("price >= %s")
        params.append(min_price)
    if min_rooms is not None:
        conditions.append("bedrooms >= %s")
        params.append(min_rooms)
    if parking_required:
        conditions.append("parking_available = TRUE")
    if max_walk_minutes is not None:
        conditions.append("walk_minutes <= %s")
        params.append(max_walk_minutes)
    if network is not None:
        conditions.append("station_network = %s")
        params.append(network)
    if station_id is not None:
        conditions.append("station_id = %s")
        params.append(station_id)

    where_sql = f"WHERE {' AND '.join(conditions)}" if conditions else ""
    order_sql = SORT_CLAUSES[sort]

    count_row = await fetch_one(
        request,
        f"SELECT COUNT(*) AS total FROM v_properties_near_transit {where_sql}",
        params,
    )
    total = int(count_row["total"]) if count_row else 0

    rows = await fetch_all(
        request,
        f"""
        SELECT id,
               centris_id,
               title,
               property_type,
               price,
               bedrooms,
               bathrooms,
               net_area_sqft,
               parking_available,
               address,
               city,
               latitude,
               longitude,
               url,
               image_url,
               nearest_station_distance_m,
               walk_minutes,
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

    return {"total": total, "limit": limit, "offset": offset, "items": rows}


@app.get("/api/meta", response_model=Meta)
async def meta(request: Request):
    counts = await fetch_one(
        request,
        """
        SELECT (SELECT COUNT(*) FROM stations WHERE is_operational = TRUE)                     AS operational_stations,
               (SELECT COUNT(*) FROM properties WHERE is_active = TRUE)                        AS active_properties,
               (SELECT COUNT(*) FROM properties WHERE is_active = TRUE AND within_15_min = TRUE) AS properties_near_transit
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
        "last_scrape": last_scrape,
    }