#!/usr/bin/env python3
"""
Montreal Rentals scraper.

Responsibilities
  1. Sync Metro / REM station coordinates from OpenStreetMap (Overpass API)
     and mark them as verified in PostGIS.
  2. Scrape Centris rental listings with Playwright (stealth evasions,
     human-like pacing, block detection and fingerprint rotation).
  3. Upsert listings into PostGIS (the DB trigger computes the nearest
     station / walking time) and log every run into scrape_runs.
  4. Repeat every SCRAPE_INTERVAL_HOURS (optionally running at startup).
"""

import json
import logging
import os
import random
import re
import signal
import subprocess
import sys
import threading
import time
import unicodedata
from dataclasses import dataclass, field
from datetime import datetime, timezone
from math import asin, cos, radians, sin, sqrt
from pathlib import Path
from typing import Any, Callable, Optional
from urllib.parse import unquote, urljoin, urlparse

import psycopg
import requests
from bs4 import BeautifulSoup
from playwright.sync_api import (
    Error as PlaywrightError,
    Page,
    Playwright,
    TimeoutError as PlaywrightTimeout,
    sync_playwright,
)
from psycopg.rows import dict_row

# ---------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------
logging.basicConfig(
    level=os.environ.get("LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
    stream=sys.stdout,
)
logger = logging.getLogger("scraper")


# ---------------------------------------------------------------------
# Configuration helpers
# ---------------------------------------------------------------------
def env_str(name: str, default: str) -> str:
    value = os.environ.get(name)
    if value is None or value.strip() == "":
        return default
    return value.strip()


def env_int(name: str, default: int) -> int:
    try:
        return int(env_str(name, str(default)))
    except ValueError:
        logger.warning("Invalid integer for %s, using %s", name, default)
        return default


def env_float(name: str, default: float) -> float:
    try:
        return float(env_str(name, str(default)))
    except ValueError:
        logger.warning("Invalid number for %s, using %s", name, default)
        return default


def env_bool(name: str, default: bool) -> bool:
    value = env_str(name, "true" if default else "false").lower()
    return value in ("1", "true", "yes", "y", "on")


DATABASE_URL = os.environ.get("DATABASE_URL", "").strip()
if not DATABASE_URL:
    logger.error("DATABASE_URL environment variable is required")
    sys.exit(1)

SCRAPE_INTERVAL_HOURS = env_float("SCRAPE_INTERVAL_HOURS", 6.0)
SCRAPE_MAX_PAGES = max(1, env_int("SCRAPE_MAX_PAGES", 20))
SCRAPE_HEADLESS = env_bool("SCRAPE_HEADLESS", True)
SCRAPE_PROXY = env_str("SCRAPE_PROXY", "")
MIN_DELAY = max(0.5, env_float("SCRAPE_MIN_DELAY_SECONDS", 2.0))
MAX_DELAY = max(MIN_DELAY, env_float("SCRAPE_MAX_DELAY_SECONDS", 6.0))
RUN_ON_STARTUP = env_bool("RUN_ON_STARTUP", True)
SCRAPE_START_URL = env_str("SCRAPE_START_URL", "https://www.centris.ca/en/properties~for-rent?uc=0")
SCRAPE_START_URLS = env_str("SCRAPE_START_URLS", "")
MAX_DETAILS_PER_RUN = max(0, env_int("SCRAPE_MAX_DETAILS_PER_RUN", 300))
MAX_BLOCK_RETRIES = max(1, env_int("SCRAPE_MAX_BLOCK_RETRIES", 3))
GEOCODE_FALLBACK = env_bool("GEOCODE_FALLBACK", True)
STATION_SYNC_MODE = env_str("STATION_SYNC_MODE", "auto").lower()
STATION_MAX_DRIFT_METERS = env_float("STATION_MAX_DRIFT_METERS", 8000.0)
OVERPASS_URLS = [
    u.strip()
    for u in env_str(
        "OVERPASS_URLS",
        "https://overpass-api.de/api/interpreter,https://overpass.kumi.systems/api/interpreter",
    ).split(",")
    if u.strip()
]
DEBUG_DIR = Path(env_str("DEBUG_DIR", "/app/debug"))

BASE_URL = "https://www.centris.ca"
DEFAULT_GENERIC_START_URL = "https://www.centris.ca/en/properties~for-rent?uc=0"
GREATER_MONTREAL_START_URLS = [
    "https://www.centris.ca/en/properties~for-rent~montreal-island",
    "https://www.centris.ca/en/properties~for-rent~laval",
    "https://www.centris.ca/en/properties~for-rent~longueuil",
    "https://www.centris.ca/en/properties~for-rent~brossard",
]

# Greater Montreal sanity box: (min_lat, max_lat, min_lon, max_lon)
GM_BBOX = (44.9, 46.2, -74.5, -72.9)
# Overpass box: (south, west, north, east) - covers Anse-a-l'Orme to Brossard to Deux-Montagnes
OVERPASS_BBOX = (45.30, -74.10, 45.75, -73.35)

USER_AGENT_APP = "montreal-rentals-scraper/1.0 (self-hosted; personal use)"

STOP = threading.Event()


class StopRequested(Exception):
    """Raised when a shutdown signal was received."""


class BlockedError(Exception):
    """Raised when an anti-bot wall or throttling response is detected."""


class ScrapeError(Exception):
    """Raised for unexpected scraping failures that are not blocks."""


# ---------------------------------------------------------------------
# Generic utilities
# ---------------------------------------------------------------------
def check_stop() -> None:
    if STOP.is_set():
        raise StopRequested()


def interruptible_sleep(seconds: float) -> None:
    if STOP.wait(max(0.0, seconds)):
        raise StopRequested()


def polite_sleep(multiplier: float = 1.0) -> None:
    interruptible_sleep(random.uniform(MIN_DELAY, MAX_DELAY) * multiplier)


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6371008.8
    p1, p2 = radians(lat1), radians(lat2)
    dp = p2 - p1
    dl = radians(lon2 - lon1)
    a = sin(dp / 2) ** 2 + cos(p1) * cos(p2) * sin(dl / 2) ** 2
    return 2 * r * asin(sqrt(a))


def in_gm_bbox(lat: float, lon: float) -> bool:
    return GM_BBOX[0] <= lat <= GM_BBOX[1] and GM_BBOX[2] <= lon <= GM_BBOX[3]


def strip_accents(value: str) -> str:
    decomposed = unicodedata.normalize("NFKD", value or "")
    return "".join(ch for ch in decomposed if not unicodedata.combining(ch))


def normalize_station_name(value: str) -> str:
    text = strip_accents(value).lower().replace("œ", "oe").replace("æ", "ae")
    text = re.sub(r"\b(station|gare|metro)\b", " ", text)
    return re.sub(r"[^a-z0-9]", "", text)


def names_match(a: str, b: str) -> bool:
    if not a or not b:
        return False
    if a == b:
        return True
    shortest = min(len(a), len(b))
    return shortest >= 6 and (a.startswith(b) or b.startswith(a))


def connect_db() -> psycopg.Connection:
    return psycopg.connect(DATABASE_URL, autocommit=True, row_factory=dict_row)


def wait_for_database(max_attempts: int = 60) -> None:
    for attempt in range(1, max_attempts + 1):
        try:
            with connect_db() as conn:
                conn.execute("SELECT 1")
            logger.info("Database is reachable")
            return
        except psycopg.Error as exc:
            logger.info("Waiting for database (%s/%s): %s", attempt, max_attempts, exc)
            interruptible_sleep(2)
    raise RuntimeError("Database did not become reachable in time")


def dump_debug(page: Optional[Page], label: str) -> None:
    if page is None:
        return
    try:
        DEBUG_DIR.mkdir(parents=True, exist_ok=True)
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S")
        safe = re.sub(r"[^a-zA-Z0-9_-]", "_", label)[:60]
        (DEBUG_DIR / f"{stamp}_{safe}.html").write_text(page.content(), encoding="utf-8")
        page.screenshot(path=str(DEBUG_DIR / f"{stamp}_{safe}.png"), full_page=False)
        logger.info("Saved debug snapshot %s_%s in %s", stamp, safe, DEBUG_DIR)
    except Exception as exc:  # debugging aid must never break the run
        logger.warning("Could not save debug snapshot: %s", exc)


# =====================================================================
# 1. OpenStreetMap station sync
# =====================================================================
def classify_osm_kind(tags: dict[str, str]) -> str:
    station = (tags.get("station") or "").lower()
    network_blob = " ".join(
        [tags.get("network", ""), tags.get("operator", ""), tags.get("brand", "")]
    ).lower()
    if station == "subway" or tags.get("subway") == "yes":
        return "METRO"
    if station == "light_rail":
        return "REM"
    if re.search(r"\brem\b", network_blob) or "réseau express" in network_blob or "cdpq" in network_blob:
        return "REM"
    if "stm" in network_blob and "metro" in strip_accents(network_blob):
        return "METRO"
    return "OTHER"


def fetch_osm_stations() -> list[dict[str, Any]]:
    south, west, north, east = OVERPASS_BBOX
    bbox = f"{south},{west},{north},{east}"
    query = (
        "[out:json][timeout:90];"
        "("
        f'nwr["railway"="station"]({bbox});'
        f'nwr["station"~"^(subway|light_rail)$"]({bbox});'
        f'nwr["public_transport"="station"]["subway"="yes"]({bbox});'
        ");"
        "out center tags;"
    )
    last_error: Optional[Exception] = None
    for endpoint in OVERPASS_URLS:
        for attempt in range(1, 3):
            check_stop()
            try:
                logger.info("Querying Overpass %s (attempt %s)", endpoint, attempt)
                response = requests.post(
                    endpoint,
                    data={"data": query},
                    headers={"User-Agent": USER_AGENT_APP},
                    timeout=120,
                )
                if response.status_code == 429 or response.status_code >= 500:
                    raise RuntimeError(f"Overpass HTTP {response.status_code}")
                response.raise_for_status()
                payload = response.json()
                candidates: list[dict[str, Any]] = []
                for element in payload.get("elements", []):
                    tags = element.get("tags") or {}
                    lat = element.get("lat")
                    lon = element.get("lon")
                    if lat is None or lon is None:
                        center = element.get("center") or {}
                        lat, lon = center.get("lat"), center.get("lon")
                    if lat is None or lon is None:
                        continue
                    raw_names = [
                        tags.get(key, "")
                        for key in ("name", "name:fr", "name:en", "alt_name", "official_name")
                    ]
                    names: set[str] = set()
                    for raw in raw_names:
                        for part in re.split(r"[;/]", raw):
                            normalized = normalize_station_name(part)
                            if normalized:
                                names.add(normalized)
                    if not names:
                        continue
                    candidates.append(
                        {
                            "names": names,
                            "lat": float(lat),
                            "lon": float(lon),
                            "kind": classify_osm_kind(tags),
                            "label": tags.get("name", ""),
                        }
                    )
                logger.info("Overpass returned %s usable station elements", len(candidates))
                return candidates
            except StopRequested:
                raise
            except Exception as exc:
                last_error = exc
                logger.warning("Overpass request failed: %s", exc)
                interruptible_sleep(5 * attempt)
    raise RuntimeError(f"All Overpass endpoints failed: {last_error}")


def sync_stations(conn: psycopg.Connection) -> None:
    rows = conn.execute(
        """
        SELECT id, name, network, line,
               ST_Y(location::geometry) AS lat,
               ST_X(location::geometry) AS lon
          FROM stations
        """
    ).fetchall()
    candidates = fetch_osm_stations()
    if not candidates:
        logger.warning("No OSM stations received; skipping station sync")
        return

    tiers = {"METRO": [["METRO"], ["OTHER"]], "REM": [["REM"], ["OTHER"]]}
    updates: list[dict[str, Any]] = []
    unmatched: list[str] = []

    for station in rows:
        target = normalize_station_name(station["name"])
        chosen: Optional[dict[str, Any]] = None
        for kinds in tiers.get(station["network"], [["OTHER"]]):
            matching = [
                c
                for c in candidates
                if c["kind"] in kinds and any(names_match(target, n) for n in c["names"])
            ]
            if matching:
                chosen = min(
                    matching,
                    key=lambda c: haversine_m(station["lat"], station["lon"], c["lat"], c["lon"]),
                )
                break
        if chosen is None:
            unmatched.append(f"{station['name']} ({station['line']})")
            continue
        drift = haversine_m(station["lat"], station["lon"], chosen["lat"], chosen["lon"])
        if drift > STATION_MAX_DRIFT_METERS:
            logger.warning(
                "Skipping %s (%s): OSM match '%s' is %.0f m from seed (limit %.0f m)",
                station["name"],
                station["line"],
                chosen["label"],
                drift,
                STATION_MAX_DRIFT_METERS,
            )
            unmatched.append(f"{station['name']} ({station['line']})")
            continue
        updates.append(
            {"id": station["id"], "lat": chosen["lat"], "lon": chosen["lon"], "drift": drift,
             "name": station["name"], "line": station["line"]}
        )

    with conn.cursor() as cur:
        for item in updates:
            cur.execute(
                """
                UPDATE stations
                   SET location = ST_SetSRID(ST_MakePoint(%(lon)s, %(lat)s), 4326)::geography,
                       coords_verified = TRUE
                 WHERE id = %(id)s
                """,
                item,
            )
            if item["drift"] > 150:
                logger.info(
                    "Corrected %s (%s) by %.0f m", item["name"], item["line"], item["drift"]
                )

    if updates:
        # Re-fire the proximity trigger so distances use the corrected coordinates.
        conn.execute("UPDATE properties SET location = location WHERE location IS NOT NULL")

    logger.info(
        "Station sync finished: %s verified, %s unmatched%s",
        len(updates),
        len(unmatched),
        f" ({', '.join(unmatched)})" if unmatched else "",
    )


def maybe_sync_stations(conn: psycopg.Connection) -> None:
    if STATION_SYNC_MODE == "never":
        return
    unverified = conn.execute(
        "SELECT COUNT(*) AS n FROM stations WHERE coords_verified = FALSE"
    ).fetchone()["n"]
    if STATION_SYNC_MODE != "always" and unverified == 0:
        logger.info("All stations already verified; skipping OSM sync")
        return
    try:
        sync_stations(conn)
    except StopRequested:
        raise
    except Exception as exc:
        logger.error("Station sync failed (continuing with existing coordinates): %s", exc)


# =====================================================================
# 2. Browser session with stealth evasions
# =====================================================================
STEALTH_JS = r"""
(() => {
  const define = (obj, prop, getter) => {
    try { Object.defineProperty(obj, prop, { get: getter, configurable: true }); } catch (e) {}
  };

  define(Navigator.prototype, 'webdriver', () => undefined);
  define(Navigator.prototype, 'languages', () => ['en-CA', 'en', 'fr-CA']);
  define(Navigator.prototype, 'platform', () => 'Win32');
  define(Navigator.prototype, 'hardwareConcurrency', () => 8);
  define(Navigator.prototype, 'deviceMemory', () => 8);
  define(Navigator.prototype, 'maxTouchPoints', () => 0);
  define(Navigator.prototype, 'vendor', () => 'Google Inc.');

  const makePlugin = (name, filename, description) => ({
    name, filename, description, length: 1,
    0: { type: 'application/pdf', suffixes: 'pdf', description: 'Portable Document Format' },
  });
  const fakePlugins = [
    makePlugin('PDF Viewer', 'internal-pdf-viewer', 'Portable Document Format'),
    makePlugin('Chrome PDF Viewer', 'internal-pdf-viewer', 'Portable Document Format'),
    makePlugin('Chromium PDF Viewer', 'internal-pdf-viewer', 'Portable Document Format'),
    makePlugin('Microsoft Edge PDF Viewer', 'internal-pdf-viewer', 'Portable Document Format'),
    makePlugin('WebKit built-in PDF', 'internal-pdf-viewer', 'Portable Document Format'),
  ];
  define(Navigator.prototype, 'plugins', () => fakePlugins);

  if (!window.chrome) { window.chrome = {}; }
  window.chrome.runtime = window.chrome.runtime || {};
  window.chrome.app = window.chrome.app || { isInstalled: false, InstallState: {}, RunningState: {} };
  window.chrome.loadTimes = window.chrome.loadTimes || function () { return {}; };
  window.chrome.csi = window.chrome.csi || function () { return {}; };

  try {
    const originalQuery = window.navigator.permissions && window.navigator.permissions.query;
    if (originalQuery) {
      window.navigator.permissions.query = (parameters) =>
        parameters && parameters.name === 'notifications'
          ? Promise.resolve({ state: Notification.permission, onchange: null })
          : originalQuery.call(window.navigator.permissions, parameters);
    }
  } catch (e) {}

  const patchWebGL = (proto) => {
    if (!proto) return;
    const original = proto.getParameter;
    proto.getParameter = function (parameter) {
      if (parameter === 37445) return 'Intel Inc.';
      if (parameter === 37446) return 'Intel Iris OpenGL Engine';
      return original.call(this, parameter);
    };
  };
  patchWebGL(window.WebGLRenderingContext && WebGLRenderingContext.prototype);
  patchWebGL(window.WebGL2RenderingContext && WebGL2RenderingContext.prototype);

  if (window.outerWidth === 0 || window.outerHeight === 0) {
    define(window, 'outerWidth', () => window.innerWidth);
    define(window, 'outerHeight', () => window.innerHeight + 85);
  }
})();
"""

VIEWPORTS = [
    {"width": 1366, "height": 768},
    {"width": 1440, "height": 900},
    {"width": 1536, "height": 864},
    {"width": 1920, "height": 1080},
]

BLOCK_MARKERS = (
    "incapsula",
    "request unsuccessful",
    "access denied",
    "verify you are human",
    "pardon our interruption",
    "unusual traffic",
    "are you a robot",
    "checking your browser",
    "just a moment",
    "you have been blocked",
    "captcha",
)

CONSENT_BUTTON_PATTERN = re.compile(
    r"^(accept( all)?|i agree|agree|continue|accepter|j'accepte|continuer)$", re.I
)

NEXT_SELECTORS = [
    "li.next:not(.disabled) > a",
    "li.pager-next:not(.disabled) a",
    "a.next:not(.disabled)",
    "a[rel='next']",
    "a[aria-label*='Next' i]",
    "a[title*='Next' i]",
    "a[aria-label*='Suivant' i]",
    "a[title*='Suivant' i]",
    "button[aria-label*='Next' i]",
]


def parse_proxy(value: str) -> Optional[dict[str, str]]:
    if not value:
        return None
    parsed = urlparse(value)
    if not parsed.scheme or not parsed.hostname:
        raise ValueError(f"Invalid SCRAPE_PROXY value: {value!r}")
    server = f"{parsed.scheme}://{parsed.hostname}"
    if parsed.port:
        server += f":{parsed.port}"
    proxy: dict[str, str] = {"server": server}
    if parsed.username:
        proxy["username"] = unquote(parsed.username)
    if parsed.password:
        proxy["password"] = unquote(parsed.password)
    return proxy


class BrowserSession:
    """Owns one browser + context + page and can rotate its fingerprint."""

    def __init__(self, playwright: Playwright) -> None:
        self.playwright = playwright
        self.browser = None
        self.context = None
        self.page: Optional[Page] = None
        self.warmed_up = False
        self.pages_since_open = 0
        self.rotate_after = random.randint(12, 20)

    def open(self) -> None:
        self.close()
        launch_kwargs: dict[str, Any] = {
            "headless": SCRAPE_HEADLESS,
            "args": [
                "--disable-blink-features=AutomationControlled",
                "--no-sandbox",
                "--disable-dev-shm-usage",
                "--disable-infobars",
                "--lang=en-CA",
                "--window-size=1920,1080",
            ],
        }
        proxy = parse_proxy(SCRAPE_PROXY)
        if proxy:
            launch_kwargs["proxy"] = proxy
        self.browser = self.playwright.chromium.launch(**launch_kwargs)

        major = self.browser.version.split(".")[0]
        user_agent = (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
            f"(KHTML, like Gecko) Chrome/{major}.0.0.0 Safari/537.36"
        )
        viewport = random.choice(VIEWPORTS)
        self.context = self.browser.new_context(
            user_agent=user_agent,
            viewport=viewport,
            screen={"width": viewport["width"], "height": viewport["height"]},
            locale="en-CA",
            timezone_id="America/Toronto",
            geolocation={"latitude": 45.5017, "longitude": -73.5673},
            color_scheme="light",
            device_scale_factor=1,
            java_script_enabled=True,
            extra_http_headers={
                "Accept-Language": "en-CA,en;q=0.9,fr-CA;q=0.8,fr;q=0.7",
                "sec-ch-ua": f'"Chromium";v="{major}", "Google Chrome";v="{major}", "Not_A Brand";v="24"',
                "sec-ch-ua-mobile": "?0",
                "sec-ch-ua-platform": '"Windows"',
            },
        )
        self.context.add_init_script(STEALTH_JS)
        self.context.set_default_timeout(45000)
        self.context.set_default_navigation_timeout(60000)
        self.context.route(
            "**/*",
            lambda route: route.abort()
            if route.request.resource_type in ("media", "font")
            else route.continue_(),
        )
        self.page = self.context.new_page()
        self.warmed_up = False
        self.pages_since_open = 0
        self.rotate_after = random.randint(12, 20)
        logger.info(
            "Opened browser session (Chromium %s, viewport %sx%s, headless=%s, proxy=%s)",
            major,
            viewport["width"],
            viewport["height"],
            SCRAPE_HEADLESS,
            "yes" if proxy else "no",
        )

    def close(self) -> None:
        for resource in (self.context, self.browser):
            try:
                if resource is not None:
                    resource.close()
            except Exception:
                pass
        self.context = None
        self.browser = None
        self.page = None

    def require_page(self) -> Page:
        if self.page is None:
            self.open()
        assert self.page is not None
        return self.page

    def maybe_rotate(self) -> None:
        if self.pages_since_open >= self.rotate_after:
            logger.info("Rotating browser fingerprint after %s pages", self.pages_since_open)
            self.open()

    def warm_up(self) -> None:
        if self.warmed_up:
            return
        page = self.require_page()
        page.goto(f"{BASE_URL}/en", wait_until="domcontentloaded")
        self.settle(page)
        self.dismiss_overlays()
        self.assert_not_blocked()
        human_mouse(page)
        interruptible_sleep(random.uniform(1.5, 3.5))
        self.warmed_up = True

    def settle(self, page: Page, wait_selector: Optional[str] = None) -> None:
        try:
            page.wait_for_load_state("networkidle", timeout=12000)
        except PlaywrightTimeout:
            pass
        if wait_selector:
            try:
                page.wait_for_selector(wait_selector, timeout=15000)
            except PlaywrightTimeout:
                pass

    def goto(self, url: str, wait_selector: Optional[str] = None) -> None:
        check_stop()
        self.maybe_rotate()
        self.warm_up()
        page = self.require_page()
        response = page.goto(url, wait_until="domcontentloaded")
        self.pages_since_open += 1
        if response is not None and response.status in (403, 429, 503):
            raise BlockedError(f"HTTP {response.status} for {url}")
        self.settle(page, wait_selector)
        self.dismiss_overlays()
        self.assert_not_blocked()

    def dismiss_overlays(self) -> None:
        page = self.require_page()
        try:
            buttons = page.get_by_role("button", name=CONSENT_BUTTON_PATTERN)
            if buttons.count() > 0 and buttons.first.is_visible():
                buttons.first.click(timeout=2500)
                interruptible_sleep(random.uniform(0.6, 1.4))
        except StopRequested:
            raise
        except Exception:
            pass

    def assert_not_blocked(self) -> None:
        page = self.require_page()
        try:
            title = (page.title() or "").lower()
            body_text = (page.inner_text("body", timeout=5000) or "")[:2500].lower()
        except PlaywrightError:
            return
        haystack = f"{title}\n{body_text}"
        for marker in BLOCK_MARKERS:
            if marker in haystack:
                raise BlockedError(f"Anti-bot marker detected: '{marker}'")


# ---------------------------------------------------------------------
# Human-like behaviour helpers
# ---------------------------------------------------------------------
def human_mouse(page: Page) -> None:
    try:
        viewport = page.viewport_size or {"width": 1366, "height": 768}
        for _ in range(random.randint(1, 3)):
            page.mouse.move(
                random.randint(80, max(120, viewport["width"] - 80)),
                random.randint(80, max(120, viewport["height"] - 80)),
                steps=random.randint(8, 22),
            )
            time.sleep(random.uniform(0.1, 0.4))
    except PlaywrightError:
        pass


def human_scroll(page: Page) -> None:
    try:
        for _ in range(random.randint(2, 4)):
            page.mouse.wheel(0, random.randint(250, 700))
            time.sleep(random.uniform(0.3, 0.9))
        if random.random() < 0.3:
            page.mouse.wheel(0, -random.randint(100, 300))
            time.sleep(random.uniform(0.2, 0.6))
    except PlaywrightError:
        pass


def with_block_retries(session: BrowserSession, label: str, action: Callable[[], Any]) -> Any:
    last_error: Optional[Exception] = None
    for attempt in range(1, MAX_BLOCK_RETRIES + 1):
        check_stop()
        try:
            return action()
        except StopRequested:
            raise
        except (BlockedError, PlaywrightError) as exc:
            last_error = exc
            logger.warning("%s failed (attempt %s/%s): %s", label, attempt, MAX_BLOCK_RETRIES, exc)
            dump_debug(session.page, f"{label}_attempt{attempt}")
            if attempt == MAX_BLOCK_RETRIES:
                break
            interruptible_sleep(random.uniform(45, 120) * attempt)
            session.open()
    if isinstance(last_error, BlockedError):
        raise last_error
    raise BlockedError(f"{label} failed after {MAX_BLOCK_RETRIES} attempts: {last_error}")


# =====================================================================
# 3. Centris parsing
# =====================================================================
CENTRIS_ID_RE = re.compile(r"/(\d{7,9})(?:[/?#]|$)")


@dataclass
class Card:
    centris_id: str
    url: str
    property_type: Optional[str] = None
    price: Optional[float] = None
    bedrooms: Optional[int] = None
    bathrooms: Optional[int] = None
    address: Optional[str] = None
    city: Optional[str] = None
    image_url: Optional[str] = None


@dataclass
class DetailInfo:
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    parking_available: Optional[bool] = None
    bedrooms: Optional[int] = None
    bathrooms: Optional[int] = None


def parse_price(text: Optional[str]) -> Optional[float]:
    if not text:
        return None
    match = re.search(r"\d[\d\s\u00a0\u202f,.]*\d|\d", text)
    if not match:
        return None
    raw = re.sub(r"[\s\u00a0\u202f]", "", match.group(0))
    if re.fullmatch(r"\d{1,3}(,\d{3})+(\.\d+)?", raw):
        raw = raw.replace(",", "")
    elif re.fullmatch(r"\d+,\d{1,2}", raw):
        raw = raw.replace(",", ".")
    else:
        raw = raw.replace(",", "")
    try:
        value = float(raw)
    except ValueError:
        return None
    return value if value > 0 else None


def parse_rooms(text: Optional[str]) -> Optional[int]:
    if not text:
        return None
    lowered = text.lower()
    if "studio" in lowered or "bachelor" in lowered or "garçonnière" in lowered:
        return 0
    numbers = [int(n) for n in re.findall(r"\d+", lowered)]
    if not numbers:
        return None
    if "+" in lowered and len(numbers) >= 2:
        return numbers[0] + numbers[1]
    return numbers[0]


def clean_text(value: Optional[str]) -> str:
    return re.sub(r"\s+", " ", (value or "").replace("\u00a0", " ")).strip()


def find_card_container(anchor: Any) -> Any:
    node = anchor
    for _ in range(8):
        parent = node.parent
        if parent is None or getattr(parent, "name", None) in ("body", "html", "[document]"):
            break
        node = parent
        if node.select_one(".price") is not None or node.select_one("[class*='price']") is not None:
            ids = set()
            for link in node.select("a[href]"):
                found = CENTRIS_ID_RE.search(link.get("href", ""))
                if found:
                    ids.add(found.group(1))
            if len(ids) <= 1:
                return node
            break
    return anchor.parent if anchor.parent is not None else anchor


def parse_cards(html: str) -> list[Card]:
    soup = BeautifulSoup(html, "lxml")
    cards: dict[str, Card] = {}
    anchors = soup.select(
        "a.property-thumbnail-summary-link, a.a-more-detail, a[href*='for-rent']"
    )
    for anchor in anchors:
        href = anchor.get("href") or ""
        match = CENTRIS_ID_RE.search(href)
        if not match:
            continue
        centris_id = match.group(1)
        if centris_id in cards:
            continue
        container = find_card_container(anchor)
        container_text = clean_text(container.get_text(" ", strip=True))

        price_node = container.select_one(".price") or container.select_one("[class*='price']")
        price = parse_price(price_node.get_text(" ", strip=True)) if price_node else None

        bed_node = container.select_one(".cac")
        bedrooms = parse_rooms(bed_node.get_text(" ", strip=True)) if bed_node else None
        if bedrooms is None:
            bed_match = re.search(r"(\d+)\s*(?:bedrooms?|beds?|chambres?)", container_text, re.I)
            if bed_match:
                bedrooms = int(bed_match.group(1))
            elif re.search(r"\bstudio\b", container_text, re.I):
                bedrooms = 0

        bath_node = container.select_one(".sdb")
        bathrooms = parse_rooms(bath_node.get_text(" ", strip=True)) if bath_node else None
        if bathrooms is None:
            bath_match = re.search(
                r"(\d+)\s*(?:bathrooms?|baths?|salles? de bains?)", container_text, re.I
            )
            if bath_match:
                bathrooms = int(bath_match.group(1))

        address_node = container.select_one(".address")
        address: Optional[str] = None
        city: Optional[str] = None
        if address_node is not None:
            parts = [
                clean_text(child.get_text(" ", strip=True))
                for child in address_node.find_all("div", recursive=False)
            ]
            parts = [p for p in parts if p]
            if not parts:
                parts = [clean_text(address_node.get_text(" ", strip=True))]
            address = ", ".join(p for p in parts if p) or None
            if parts:
                city = clean_text(re.sub(r"\([^)]*\)", "", parts[-1])) or None

        category_node = container.select_one(".category")
        property_type = clean_text(category_node.get_text(" ", strip=True)) if category_node else None

        image_url: Optional[str] = None
        image = container.find("img")
        if image is not None:
            for attr in ("src", "data-src", "data-original", "data-lazy"):
                candidate = image.get(attr)
                if candidate and not candidate.startswith("data:"):
                    image_url = urljoin(BASE_URL, candidate)
                    break

        cards[centris_id] = Card(
            centris_id=centris_id,
            url=urljoin(BASE_URL, href.split("?")[0].split("#")[0]),
            property_type=property_type or None,
            price=price,
            bedrooms=bedrooms,
            bathrooms=bathrooms,
            address=address,
            city=city,
            image_url=image_url,
        )
    return list(cards.values())


def find_geo_in_json(node: Any) -> Optional[tuple[float, float]]:
    if isinstance(node, dict):
        lowered = {str(k).lower(): v for k, v in node.items()}
        lat = lowered.get("latitude", lowered.get("lat"))
        lon = lowered.get("longitude", lowered.get("lng", lowered.get("lon")))
        try:
            if lat is not None and lon is not None:
                lat_f, lon_f = float(lat), float(lon)
                if in_gm_bbox(lat_f, lon_f):
                    return lat_f, lon_f
        except (TypeError, ValueError):
            pass
        for value in node.values():
            found = find_geo_in_json(value)
            if found:
                return found
    elif isinstance(node, list):
        for value in node:
            found = find_geo_in_json(value)
            if found:
                return found
    return None


LAT_LON_PATTERNS = [
    re.compile(
        r'"?latitude"?\s*[:=]\s*"?(-?\d{1,2}\.\d{3,})"?[\s\S]{0,80}?"?longitude"?\s*[:=]\s*"?(-?\d{1,3}\.\d{3,})',
        re.I,
    ),
    re.compile(
        r'"?\blat"?\s*[:=]\s*"?(-?\d{1,2}\.\d{3,})"?[\s\S]{0,80}?"?(?:lng|lon|long)"?\s*[:=]\s*"?(-?\d{1,3}\.\d{3,})',
        re.I,
    ),
    re.compile(
        r"(?:[?&](?:q|ll|center|destination)=|@)(-?\d{1,2}\.\d{3,}),\s*(-?\d{1,3}\.\d{3,})",
        re.I,
    ),
]


def extract_coordinates(soup: BeautifulSoup, html: str) -> Optional[tuple[float, float]]:
    # 1. schema.org microdata
    lat_meta = soup.find("meta", attrs={"itemprop": "latitude"})
    lon_meta = soup.find("meta", attrs={"itemprop": "longitude"})
    if lat_meta and lon_meta:
        try:
            lat, lon = float(lat_meta.get("content", "")), float(lon_meta.get("content", ""))
            if in_gm_bbox(lat, lon):
                return lat, lon
        except ValueError:
            pass

    # 2. JSON-LD blocks
    for script in soup.find_all("script", attrs={"type": "application/ld+json"}):
        try:
            data = json.loads(script.string or script.get_text() or "")
        except (json.JSONDecodeError, TypeError):
            continue
        found = find_geo_in_json(data)
        if found:
            return found

    # 3. data-* attributes on map elements
    for element in soup.select("[data-lat], [data-latitude]"):
        lat_raw = element.get("data-lat") or element.get("data-latitude")
        lon_raw = (
            element.get("data-lng")
            or element.get("data-lon")
            or element.get("data-long")
            or element.get("data-longitude")
        )
        try:
            lat, lon = float(lat_raw), float(lon_raw)
            if in_gm_bbox(lat, lon):
                return lat, lon
        except (TypeError, ValueError):
            continue

    # 4. Inline JS / URLs
    for pattern in LAT_LON_PATTERNS:
        for match in pattern.finditer(html):
            try:
                lat, lon = float(match.group(1)), float(match.group(2))
            except ValueError:
                continue
            if in_gm_bbox(lat, lon):
                return lat, lon
    return None


PARKING_KEYS = ("parking", "garage", "stationnement", "driveway", "allee", "carport")
NEGATIVE_VALUES = {"0", "none", "no", "non", "aucun", "aucune", "n/a", "-", ""}
NEGATION_PREFIXES = ("no ", "sans ", "pas de ", "without ", "not ", "aucun ", "non ")


def text_mentions_parking(text: str) -> bool:
    lowered = text.lower()
    for match in re.finditer(r"\b(parking|garage|stationnement|driveway)\b", lowered):
        prefix = lowered[max(0, match.start() - 15):match.start()]
        if not any(prefix.endswith(neg) or neg in prefix[-9:] for neg in NEGATION_PREFIXES):
            return True
    return False


def extract_parking(soup: BeautifulSoup) -> Optional[bool]:
    positives = False
    negatives = False
    for container in soup.select(".carac-container"):
        title_node = container.select_one(".carac-title")
        value_node = container.select_one(".carac-value")
        if title_node is None:
            continue
        title = strip_accents(clean_text(title_node.get_text(" ", strip=True))).lower()
        if not any(key in title for key in PARKING_KEYS):
            continue
        value = clean_text(value_node.get_text(" ", strip=True)).lower() if value_node else ""
        if value in NEGATIVE_VALUES or re.fullmatch(r"0+", value):
            negatives = True
        else:
            positives = True
    if positives:
        return True

    description_node = (
        soup.select_one("[itemprop='description']")
        or soup.select_one(".property-description")
        or soup.select_one("#PropertyDescription")
        or soup.select_one(".description")
    )
    if description_node is not None and text_mentions_parking(
        clean_text(description_node.get_text(" ", strip=True))
    ):
        return True
    if negatives:
        return False
    return False if description_node is not None else None


def parse_detail(html: str) -> DetailInfo:
    soup = BeautifulSoup(html, "lxml")
    info = DetailInfo()

    coords = extract_coordinates(soup, html)
    if coords:
        info.latitude, info.longitude = coords

    info.parking_available = extract_parking(soup)

    bed_node = soup.select_one(".teaser .cac") or soup.select_one(".cac")
    bath_node = soup.select_one(".teaser .sdb") or soup.select_one(".sdb")
    if bed_node is not None:
        info.bedrooms = parse_rooms(bed_node.get_text(" ", strip=True))
    if bath_node is not None:
        info.bathrooms = parse_rooms(bath_node.get_text(" ", strip=True))

    for container in soup.select(".carac-container"):
        title_node = container.select_one(".carac-title")
        value_node = container.select_one(".carac-value")
        if title_node is None or value_node is None:
            continue
        title = strip_accents(clean_text(title_node.get_text(" ", strip=True))).lower()
        value = clean_text(value_node.get_text(" ", strip=True))
        if info.bedrooms is None and ("bedroom" in title or "chambre" in title):
            info.bedrooms = parse_rooms(value)
        if info.bathrooms is None and ("bathroom" in title or "salle de bain" in title):
            info.bathrooms = parse_rooms(value)
    return info


# ---------------------------------------------------------------------
# Geocoding fallback (Nominatim, 1 request/second max)
# ---------------------------------------------------------------------
_geocode_cache: dict[str, Optional[tuple[float, float]]] = {}
_last_geocode_call = 0.0


def geocode_address(address: Optional[str]) -> Optional[tuple[float, float]]:
    global _last_geocode_call
    if not GEOCODE_FALLBACK or not address:
        return None
    query = clean_text(re.sub(r"\([^)]*\)", "", address))
    if not query:
        return None
    query = f"{query}, Québec, Canada"
    if query in _geocode_cache:
        return _geocode_cache[query]

    wait = 1.2 - (time.monotonic() - _last_geocode_call)
    if wait > 0:
        interruptible_sleep(wait)
    _last_geocode_call = time.monotonic()

    result: Optional[tuple[float, float]] = None
    try:
        response = requests.get(
            "https://nominatim.openstreetmap.org/search",
            params={
                "q": query,
                "format": "jsonv2",
                "limit": 1,
                "countrycodes": "ca",
                "viewbox": f"{GM_BBOX[2]},{GM_BBOX[1]},{GM_BBOX[3]},{GM_BBOX[0]}",
                "bounded": 1,
            },
            headers={"User-Agent": USER_AGENT_APP},
            timeout=20,
        )
        response.raise_for_status()
        data = response.json()
        if data:
            lat, lon = float(data[0]["lat"]), float(data[0]["lon"])
            if in_gm_bbox(lat, lon):
                result = (lat, lon)
    except StopRequested:
        raise
    except Exception as exc:
        logger.warning("Geocoding failed for '%s': %s", query, exc)
    _geocode_cache[query] = result
    return result


# =====================================================================
# 4. Navigation and pagination
# =====================================================================
CARD_WAIT_SELECTOR = "a.property-thumbnail-summary-link, div.property-thumbnail-item"

FETCH_PAGE_JS = """
async (startPosition) => {
  const response = await fetch('/Property/GetInscriptions', {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Requested-With': 'XMLHttpRequest',
      'Accept': 'application/json, text/javascript, */*; q=0.01'
    },
    body: JSON.stringify({ startPosition: startPosition })
  });
  return { status: response.status, text: await response.text() };
}
"""


def card_ids(html: str) -> tuple[str, ...]:
    return tuple(card.centris_id for card in parse_cards(html))


def resolve_start_urls() -> list[str]:
    if SCRAPE_START_URLS:
        urls = [u.strip() for u in SCRAPE_START_URLS.split(",") if u.strip()]
        if urls:
            return urls
    if SCRAPE_START_URL and SCRAPE_START_URL != DEFAULT_GENERIC_START_URL:
        return [SCRAPE_START_URL]
    return list(GREATER_MONTREAL_START_URLS)


def advance_via_dom(session: BrowserSession, previous_ids: tuple[str, ...]) -> Optional[str]:
    page = session.require_page()
    for selector in NEXT_SELECTORS:
        try:
            locator = page.locator(selector).first
            if locator.count() == 0 or not locator.is_visible():
                continue
            locator.scroll_into_view_if_needed(timeout=5000)
            human_mouse(page)
            locator.click(timeout=8000)
        except StopRequested:
            raise
        except PlaywrightError:
            continue
        deadline = time.monotonic() + 25
        while time.monotonic() < deadline:
            interruptible_sleep(1.0)
            html = page.content()
            ids = card_ids(html)
            if ids and ids != previous_ids:
                session.assert_not_blocked()
                return html
        logger.info("Next-page click via '%s' did not change the results", selector)
    return None


def advance_via_fetch(session: BrowserSession, start_position: int) -> Optional[str]:
    page = session.require_page()
    try:
        result = page.evaluate(FETCH_PAGE_JS, start_position)
    except PlaywrightError as exc:
        logger.info("In-page pagination fetch failed: %s", exc)
        return None
    status = result.get("status")
    if status in (403, 429, 503):
        raise BlockedError(f"HTTP {status} from pagination endpoint")
    if status != 200:
        return None
    try:
        payload = json.loads(result.get("text") or "")
        html = payload["d"]["Result"]["html"]
    except (json.JSONDecodeError, KeyError, TypeError):
        return None
    return html if isinstance(html, str) and html.strip() else None


def scrape_search(session: BrowserSession, url: str) -> tuple[list[Card], bool]:
    """Scrape one search URL. Returns (cards, reached_natural_end)."""

    def load_first_page() -> str:
        session.goto(url, wait_selector=CARD_WAIT_SELECTOR)
        human_scroll(session.require_page())
        return session.require_page().content()

    html = with_block_retries(session, "search_load", load_first_page)
    first_cards = parse_cards(html)
    if not first_cards:
        dump_debug(session.page, "search_no_cards")
        raise ScrapeError(f"No listing cards found at {url} (see debug snapshot)")

    collected: dict[str, Card] = {}
    page_size = len(first_cards) or 20
    page_number = 1
    use_fetch = False
    current_html = html
    complete = False

    while True:
        check_stop()
        cards = parse_cards(current_html)
        fresh = [c for c in cards if c.centris_id not in collected]
        for card in fresh:
            collected[card.centris_id] = card
        logger.info(
            "%s page %s: %s cards (%s new, %s total)",
            url.rsplit("/", 1)[-1],
            page_number,
            len(cards),
            len(fresh),
            len(collected),
        )

        if page_number > 1 and not fresh:
            complete = True
            break
        if page_number >= SCRAPE_MAX_PAGES:
            logger.info("Reached SCRAPE_MAX_PAGES=%s for %s", SCRAPE_MAX_PAGES, url)
            break

        polite_sleep()
        previous_ids = tuple(c.centris_id for c in cards)
        next_html: Optional[str] = None

        if not use_fetch:
            next_html = with_block_retries(
                session, "search_next", lambda: advance_via_dom(session, previous_ids)
            )
            if next_html is None:
                next_html = advance_via_fetch(session, page_number * page_size)
                if next_html is not None:
                    logger.info("Switched to in-page fetch pagination")
                    use_fetch = True
        else:
            next_html = advance_via_fetch(session, page_number * page_size)

        if next_html is None:
            complete = True
            break
        if not parse_cards(next_html):
            complete = True
            break

        current_html = next_html
        page_number += 1

    return list(collected.values()), complete


def fetch_detail(session: BrowserSession, card: Card) -> DetailInfo:
    def action() -> str:
        session.goto(
            card.url,
            wait_selector="[itemprop='price'], .price, .carac-container, .property-summary",
        )
        human_scroll(session.require_page())
        return session.require_page().content()

    html = with_block_retries(session, f"detail_{card.centris_id}", action)
    return parse_detail(html)


# =====================================================================
# 5. Persistence
# =====================================================================
UPSERT_SQL = """
INSERT INTO properties (
    centris_id, title, property_type, price, bedrooms, bathrooms, parking_available,
    address, city, location, url, image_url, is_active, scraped_at
)
VALUES (
    %(centris_id)s, %(title)s, %(property_type)s, %(price)s, %(bedrooms)s, %(bathrooms)s,
    %(parking)s, %(address)s, %(city)s,
    CASE WHEN %(lat)s::float8 IS NULL OR %(lon)s::float8 IS NULL THEN NULL
         ELSE ST_SetSRID(ST_MakePoint(%(lon)s::float8, %(lat)s::float8), 4326)::geography END,
    %(url)s, %(image_url)s, TRUE, NOW()
)
ON CONFLICT (centris_id) DO UPDATE SET
    title             = COALESCE(EXCLUDED.title, properties.title),
    property_type     = COALESCE(EXCLUDED.property_type, properties.property_type),
    price             = COALESCE(EXCLUDED.price, properties.price),
    bedrooms          = COALESCE(EXCLUDED.bedrooms, properties.bedrooms),
    bathrooms         = COALESCE(EXCLUDED.bathrooms, properties.bathrooms),
    parking_available = EXCLUDED.parking_available,
    address           = COALESCE(EXCLUDED.address, properties.address),
    city              = COALESCE(EXCLUDED.city, properties.city),
    location          = COALESCE(EXCLUDED.location, properties.location),
    url               = EXCLUDED.url,
    image_url         = COALESCE(EXCLUDED.image_url, properties.image_url),
    is_active         = TRUE,
    scraped_at        = NOW()
"""

CARD_UPDATE_SQL = """
UPDATE properties
   SET price         = COALESCE(%(price)s::numeric, price),
       title         = COALESCE(%(title)s::text, title),
       property_type = COALESCE(%(property_type)s::text, property_type),
       image_url     = COALESCE(%(image_url)s::text, image_url),
       url           = %(url)s,
       is_active     = TRUE,
       scraped_at    = NOW()
 WHERE centris_id = %(centris_id)s
"""


def card_params(card: Card) -> dict[str, Any]:
    return {
        "centris_id": card.centris_id,
        "title": card.property_type,
        "property_type": card.property_type,
        "price": card.price,
        "bedrooms": card.bedrooms,
        "bathrooms": card.bathrooms,
        "address": card.address,
        "city": card.city,
        "url": card.url,
        "image_url": card.image_url,
    }


def upsert_listing(conn: psycopg.Connection, card: Card, detail: DetailInfo) -> bool:
    lat, lon = detail.latitude, detail.longitude
    if lat is None or lon is None:
        geocoded = geocode_address(card.address)
        if geocoded:
            lat, lon = geocoded
            logger.info("Listing %s located via geocoding fallback", card.centris_id)
    params = card_params(card)
    params.update(
        {
            "bedrooms": detail.bedrooms if detail.bedrooms is not None else card.bedrooms,
            "bathrooms": detail.bathrooms if detail.bathrooms is not None else card.bathrooms,
            "parking": bool(detail.parking_available),
            "lat": lat,
            "lon": lon,
        }
    )
    conn.execute(UPSERT_SQL, params)
    return lat is not None and lon is not None


# ---------------------------------------------------------------------
# Run bookkeeping
# ---------------------------------------------------------------------
@dataclass
class RunStats:
    found: int = 0
    upserted: int = 0
    warnings: list[str] = field(default_factory=list)


def start_run(conn: psycopg.Connection) -> tuple[int, datetime]:
    row = conn.execute(
        "INSERT INTO scrape_runs (status) VALUES ('running') RETURNING id, started_at"
    ).fetchone()
    return row["id"], row["started_at"]


def finish_run(
    conn: psycopg.Connection, run_id: int, status: str, stats: RunStats, error: Optional[str]
) -> None:
    conn.execute(
        """
        UPDATE scrape_runs
           SET status = %s,
               finished_at = NOW(),
               listings_found = %s,
               listings_upserted = %s,
               error_message = %s
         WHERE id = %s
        """,
        (status, stats.found, stats.upserted, error, run_id),
    )


def process_cards(
    conn: psycopg.Connection, session: BrowserSession, cards: dict[str, Card], stats: RunStats
) -> None:
    ids = list(cards.keys())
    existing_rows = conn.execute(
        """
        SELECT centris_id, (location IS NOT NULL) AS has_location
          FROM properties
         WHERE centris_id = ANY(%s)
        """,
        (ids,),
    ).fetchall()
    existing = {row["centris_id"]: row["has_location"] for row in existing_rows}

    # Refresh price / image / last-seen for everything already stored.
    refreshed = 0
    with conn.cursor() as cur:
        for centris_id in existing:
            cur.execute(CARD_UPDATE_SQL, card_params(cards[centris_id]))
            refreshed += 1
    stats.upserted += refreshed
    logger.info("Refreshed %s known listings from search cards", refreshed)

    new_cards = [c for cid, c in cards.items() if cid not in existing]
    retry_cards = [cards[cid] for cid, has_loc in existing.items() if not has_loc]
    targets = (new_cards + retry_cards)[:MAX_DETAILS_PER_RUN]
    deferred = len(new_cards) + len(retry_cards) - len(targets)
    logger.info(
        "Detail pages to fetch: %s (%s new, %s missing coordinates, %s deferred to next run)",
        len(targets),
        len(new_cards),
        len(retry_cards),
        max(0, deferred),
    )
    if deferred > 0:
        stats.warnings.append(
            f"{deferred} listings deferred (raise SCRAPE_MAX_DETAILS_PER_RUN to process more per run)"
        )

    located = 0
    for index, card in enumerate(targets, start=1):
        check_stop()
        try:
            detail = fetch_detail(session, card)
        except BlockedError as exc:
            stats.warnings.append(f"Detail phase aborted after block: {exc}")
            logger.error("Aborting detail phase: %s", exc)
            break
        except PlaywrightError as exc:
            logger.warning("Detail page failed for %s: %s", card.centris_id, exc)
            detail = DetailInfo()
        try:
            has_coordinates = upsert_listing(conn, card, detail)
        except psycopg.Error as exc:
            logger.error("Database error while storing %s: %s", card.centris_id, exc)
            stats.warnings.append(f"DB error for listing {card.centris_id}")
            continue
        stats.upserted += 1
        located += 1 if has_coordinates else 0
        if index % 10 == 0 or index == len(targets):
            logger.info("Detail progress: %s/%s (%s with coordinates)", index, len(targets), located)
        polite_sleep()


def execute_scrape(
    conn: psycopg.Connection, run_started: datetime, stats: RunStats
) -> None:
    urls = resolve_start_urls()
    logger.info("Scraping %s search URL(s)", len(urls))
    cards: dict[str, Card] = {}
    all_complete = True
    consecutive_blocks = 0

    with sync_playwright() as playwright:
        session = BrowserSession(playwright)
        try:
            session.open()
            for url in urls:
                check_stop()
                try:
                    region_cards, complete = scrape_search(session, url)
                    consecutive_blocks = 0
                except BlockedError as exc:
                    all_complete = False
                    consecutive_blocks += 1
                    stats.warnings.append(f"Blocked on {url}: {exc}")
                    logger.error("Blocked on %s: %s", url, exc)
                    if consecutive_blocks >= 2:
                        stats.warnings.append(
                            "Blocked repeatedly; try SCRAPE_HEADLESS=false and/or SCRAPE_PROXY"
                        )
                        break
                    interruptible_sleep(random.uniform(90, 180))
                    session.open()
                    continue
                except (ScrapeError, PlaywrightError) as exc:
                    all_complete = False
                    stats.warnings.append(f"Failed on {url}: {exc}")
                    logger.error("Failed on %s: %s", url, exc)
                    continue

                for card in region_cards:
                    cards.setdefault(card.centris_id, card)
                if not complete:
                    all_complete = False
                polite_sleep(2.0)

            stats.found = len(cards)
            if not cards:
                return
            process_cards(conn, session, cards, stats)
        finally:
            session.close()

    if all_complete and cards:
        result = conn.execute(
            "UPDATE properties SET is_active = FALSE WHERE is_active = TRUE AND scraped_at < %s",
            (run_started,),
        )
        logger.info("Marked %s listings as no longer active", result.rowcount)
    else:
        logger.info("Skipping stale-listing deactivation (run incomplete or capped)")


def run_cycle() -> None:
    logger.info("=== Scrape cycle starting ===")
    conn = connect_db()
    stats = RunStats()
    run_id, run_started = start_run(conn)
    try:
        maybe_sync_stations(conn)
        execute_scrape(conn, run_started, stats)
        if stats.found == 0 and stats.warnings:
            status = "failed"
        else:
            status = "success"
        message = "; ".join(stats.warnings)[:1000] if stats.warnings else None
        finish_run(conn, run_id, status, stats, message)
        logger.info(
            "=== Scrape cycle finished: status=%s found=%s upserted=%s ===",
            status,
            stats.found,
            stats.upserted,
        )
    except StopRequested:
        finish_run(conn, run_id, "failed", stats, "Interrupted by shutdown")
        raise
    except Exception as exc:
        logger.exception("Scrape cycle crashed")
        try:
            finish_run(conn, run_id, "failed", stats, str(exc)[:1000])
        except psycopg.Error:
            logger.error("Could not record failed run in scrape_runs")
    finally:
        try:
            conn.close()
        except Exception:
            pass


# =====================================================================
# 6. Scheduler
# =====================================================================
def start_virtual_display() -> None:
    """Start Xvfb for headed Chromium. Not needed (and skipped) in headless mode."""
    if SCRAPE_HEADLESS:
        return
    display = ":99"
    try:
        subprocess.Popen(
            ["Xvfb", display, "-screen", "0", "1920x1080x24", "-nolisten", "tcp"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
    except OSError as exc:
        logger.error("Could not start Xvfb: %s", exc)
        return
    socket_path = Path("/tmp/.X11-unix/X99")
    deadline = time.monotonic() + 15
    while time.monotonic() < deadline:
        if socket_path.exists():
            os.environ["DISPLAY"] = display
            logger.info("Virtual display started on %s", display)
            return
        time.sleep(0.25)
    logger.error("Xvfb did not become ready within 15 seconds")

def handle_signal(signum: int, _frame: Any) -> None:
    logger.info("Received signal %s, shutting down", signum)
    STOP.set()


def main() -> None:
    signal.signal(signal.SIGTERM, handle_signal)
    signal.signal(signal.SIGINT, handle_signal)
    logger.info("Scraper process started (pid %s)", os.getpid())
    start_virtual_display()

    try:
        wait_for_database()
        with connect_db() as conn:
            conn.execute(
                """
                UPDATE scrape_runs
                   SET status = 'failed', finished_at = NOW(),
                       error_message = 'Interrupted (container restarted)'
                 WHERE status = 'running'
                """
            )
    except StopRequested:
        return

    interval_seconds = SCRAPE_INTERVAL_HOURS * 3600.0
    logger.info(
        "Scheduler: interval=%.2f h, run_on_startup=%s, headless=%s, max_pages=%s",
        SCRAPE_INTERVAL_HOURS,
        RUN_ON_STARTUP,
        SCRAPE_HEADLESS,
        SCRAPE_MAX_PAGES,
    )
    next_run = time.monotonic() + (0 if RUN_ON_STARTUP else max(interval_seconds, 0))

    try:
        while not STOP.is_set():
            wait = next_run - time.monotonic()
            if wait > 0:
                logger.info("Next scrape in %.1f minutes", wait / 60.0)
                if STOP.wait(wait):
                    break
            cycle_started = time.monotonic()
            run_cycle()
            if interval_seconds <= 0:
                logger.info("SCRAPE_INTERVAL_HOURS <= 0: single run done, idling")
                STOP.wait()
                break
            jitter = random.uniform(-300, 300)
            next_run = cycle_started + max(60.0, interval_seconds + jitter)
    except StopRequested:
        pass
    logger.info("Scraper stopped")


if __name__ == "__main__":
    main()