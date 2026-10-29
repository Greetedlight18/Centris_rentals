"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Check,
  Columns2,
  Heart,
  List as ListIcon,
  Loader2,
  Map as MapIcon,
  PanelLeft,
  RefreshCw,
  Search,
  Share2,
  SlidersHorizontal,
  TrainFront,
  TrendingDown,
  X,
} from "lucide-react";
import EmptyState from "@/components/EmptyState";
import FilterSidebar from "@/components/FilterSidebar";
import ListView from "@/components/ListView";
import type { MapBounds, MapFocus } from "@/components/MapView";
import PropertyDetailDrawer from "@/components/PropertyDetailDrawer";
import { formatPrice, formatPricePerSqft, lineHexColor } from "@/lib/format";
import { locationKey } from "@/lib/grouping";
import { useSavedListings, type ActivityFilter } from "@/lib/saved";
import {
  buildCommuteLookup,
  estimatePropertyCommute,
  type CommuteDestination,
  type CommuteEstimate,
} from "@/lib/transit";
import { buildUrlQueryString, parseUrlState, type ViewMode } from "@/lib/urlState";
import { useViewedListings } from "@/lib/viewed";
import {
  DEFAULT_FILTERS,
  WALK_MAX,
  countActiveFilters,
  fetchMeta,
  fetchProperties,
  fetchStations,
  isAbortError,
  isDefaultFilters,
  type MarketStats,
  type Meta,
  type Property,
  type PropertyFilters,
  type Station,
} from "@/services/api";

const MapView = dynamic(() => import("@/components/MapView"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center bg-slate-100 text-sm font-medium text-slate-500">
      <Loader2 className="mr-2 h-4 w-4 animate-spin text-brand-600" aria-hidden="true" />
      Loading transit map…
    </div>
  ),
});

const PAGE_SIZE = 400;
const DEFAULT_WALK_RADIUS_METERS = 1200;

function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong";
}

export default function HomePage() {
  const [hydrated, setHydrated] = useState(false);
  const [filters, setFilters] = useState<PropertyFilters>(DEFAULT_FILTERS);
  const debouncedFilters = useDebounced(filters, 320);

  const [properties, setProperties] = useState<Property[]>([]);
  const [total, setTotal] = useState(0);
  const [marketStats, setMarketStats] = useState<MarketStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [stations, setStations] = useState<Station[]>([]);
  const [meta, setMeta] = useState<Meta | null>(null);

  const [view, setView] = useState<ViewMode>("split");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [hoveredId, setHoveredId] = useState<number | null>(null);
  const [detailId, setDetailId] = useState<number | null>(null);
  const [pendingCentrisId, setPendingCentrisId] = useState<string | null>(null);

  const [focus, setFocus] = useState<MapFocus | null>(null);
  const [fitToken, setFitToken] = useState(0);
  const [showStations, setShowStations] = useState(true);
  const [showTransitLines, setShowTransitLines] = useState(true);

  const [filterByBounds, setFilterByBounds] = useState(false);
  const [mapBounds, setMapBounds] = useState<MapBounds | null>(null);

  const [destination, setDestination] = useState<CommuteDestination | null>(null);
  const [pickingDestination, setPickingDestination] = useState(false);
  const [maxCommuteMinutes, setMaxCommuteMinutes] = useState<number | null>(null);

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [desktopSidebarCollapsed, setDesktopSidebarCollapsed] = useState(false);
  const [copiedShareUrl, setCopiedShareUrl] = useState(false);

  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const { viewed, markViewed, markUnviewed, mergeViewed, clearViewed } = useViewedListings();
  const {
    favorites,
    hidden,
    notes,
    toggleFavorite,
    toggleHidden,
    setNote,
    clearHidden,
    exportBundle,
    importBundle,
  } = useSavedListings();
  const [activityFilter, setActivityFilter] = useState<ActivityFilter>("all");

  const requestRef = useRef<AbortController | null>(null);
  const activeFiltersRef = useRef<PropertyFilters>(DEFAULT_FILTERS);

  // Press '/' anywhere to focus header search input
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement
      ) {
        return;
      }
      if (searchInputRef.current && searchInputRef.current.offsetParent !== null) {
        event.preventDefault();
        searchInputRef.current.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Hydrate initial state from URL query string
  useEffect(() => {
    const applyFromLocation = () => {
      const hasParams = window.location.search.length > 1;
      const parsed = parseUrlState(window.location.search);
      setFilters(parsed.filters);
      if (hasParams && new URLSearchParams(window.location.search).has("view")) {
        setView(parsed.view === "split" && window.innerWidth < 768 ? "map" : parsed.view);
      } else {
        setView(window.innerWidth >= 1024 ? "split" : "map");
      }
      setActivityFilter(parsed.activity);
      setDestination(parsed.destination);
      setMaxCommuteMinutes(parsed.maxCommuteMinutes);
      setPendingCentrisId(parsed.listingCentrisId);
      setHydrated(true);
    };

    applyFromLocation();
    window.addEventListener("popstate", applyFromLocation);
    return () => window.removeEventListener("popstate", applyFromLocation);
  }, []);

  // Resolve shared ?listing=centris_id once properties load
  useEffect(() => {
    if (!pendingCentrisId || properties.length === 0) return;
    const found = properties.find((p) => p.centris_id === pendingCentrisId);
    if (found) {
      setSelectedId(found.id);
      setDetailId(found.id);
      setFocus({ id: found.id, token: Date.now() });
      markViewed(found.centris_id);
      setPendingCentrisId(null);
    }
  }, [pendingCentrisId, properties, markViewed]);

  const detailProperty = useMemo(
    () => (detailId !== null ? properties.find((p) => p.id === detailId) ?? null : null),
    [properties, detailId],
  );

  // Sync current state back to URL query string cleanly
  useEffect(() => {
    if (!hydrated) return;
    const query = buildUrlQueryString({
      filters: debouncedFilters,
      view,
      activity: activityFilter,
      destination,
      maxCommuteMinutes,
      listingCentrisId: detailProperty?.centris_id ?? null,
    });
    const nextUrl = `${window.location.pathname}${query ? `?${query}` : ""}`;
    window.history.replaceState(null, "", nextUrl);
  }, [
    hydrated,
    debouncedFilters,
    view,
    activityFilter,
    destination,
    maxCommuteMinutes,
    detailProperty,
  ]);

  const loadFirstPage = useCallback(async (nextFilters: PropertyFilters) => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    activeFiltersRef.current = nextFilters;

    setLoading(true);
    setError(null);
    try {
      const result = await fetchProperties(
        nextFilters,
        { limit: PAGE_SIZE, offset: 0 },
        controller.signal,
      );
      if (controller.signal.aborted) return;
      setProperties(result.items);
      setTotal(result.total);
      setMarketStats(result.stats);
      setFitToken((token) => token + 1);
    } catch (caught) {
      if (isAbortError(caught)) return;
      setError(errorMessage(caught));
    } finally {
      if (!controller.signal.aborted) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    void loadFirstPage(debouncedFilters);
  }, [hydrated, debouncedFilters, loadFirstPage]);

  useEffect(() => {
    return () => requestRef.current?.abort();
  }, []);

  const loadStationsAndMeta = useCallback(async (signal?: AbortSignal) => {
    const [stationsResult, metaResult] = await Promise.allSettled([
      fetchStations({}, signal),
      fetchMeta(signal),
    ]);
    if (signal?.aborted) return;
    if (stationsResult.status === "fulfilled") {
      setStations(stationsResult.value.items);
    } else if (!isAbortError(stationsResult.reason)) {
      setError(errorMessage(stationsResult.reason));
    }
    if (metaResult.status === "fulfilled") {
      setMeta(metaResult.value);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadStationsAndMeta(controller.signal);
    const interval = window.setInterval(() => {
      fetchMeta()
        .then(setMeta)
        .catch(() => undefined);
    }, 5 * 60 * 1000);
    return () => {
      controller.abort();
      window.clearInterval(interval);
    };
  }, [loadStationsAndMeta]);

  const loadMore = useCallback(async () => {
    if (loading || loadingMore) return;
    setLoadingMore(true);
    try {
      const result = await fetchProperties(activeFiltersRef.current, {
        limit: PAGE_SIZE,
        offset: properties.length,
      });
      setProperties((previous) => {
        const seen = new Set(previous.map((p) => p.id));
        return [...previous, ...result.items.filter((p) => !seen.has(p.id))];
      });
      setTotal(result.total);
      setMarketStats(result.stats);
    } catch (caught) {
      if (!isAbortError(caught)) {
        setError(errorMessage(caught));
      }
    } finally {
      setLoadingMore(false);
    }
  }, [loading, loadingMore, properties.length]);

  const refreshAll = useCallback(() => {
    void loadFirstPage(activeFiltersRef.current);
    void loadStationsAndMeta();
  }, [loadFirstPage, loadStationsAndMeta]);

  // Commute computation
  const commuteLookup = useMemo(
    () => buildCommuteLookup(stations, destination),
    [stations, destination],
  );

  const commuteById = useMemo(() => {
    const map = new Map<number, CommuteEstimate>();
    if (!commuteLookup) return map;
    for (const prop of properties) {
      const est = estimatePropertyCommute(prop, commuteLookup);
      if (est) map.set(prop.id, est);
    }
    return map;
  }, [properties, commuteLookup]);

  // Handlers
  const handleSelect = useCallback((id: number | null) => {
    setSelectedId(id);
  }, []);

  const handleDeselect = useCallback((id: number) => {
    setSelectedId((previous) => (previous === id ? null : previous));
  }, []);

  const handleOpenDetail = useCallback(
    (id: number) => {
      setDetailId(id);
      setSelectedId(id);
      const found = properties.find((p) => p.id === id);
      if (found) markViewed(found.centris_id);
    },
    [properties, markViewed],
  );

  const handleShowOnMap = useCallback((id: number) => {
    setSelectedId(id);
    setFocus({ id, token: Date.now() });
    setView((prev) => (prev === "list" ? (window.innerWidth >= 1024 ? "split" : "map") : prev));
  }, []);

  const handleToggleStation = useCallback((stationName: string) => {
    setFilters((prev) => {
      const same =
        prev.stationName !== null && prev.stationName.toLowerCase() === stationName.toLowerCase();
      return { ...prev, stationName: same ? null : stationName };
    });
  }, []);

  const handlePickDestination = useCallback((lat: number, lon: number) => {
    setDestination({
      id: "custom",
      label: `Custom Pin (${lat.toFixed(3)}, ${lon.toFixed(3)})`,
      latitude: lat,
      longitude: lon,
      isCustom: true,
    });
    setPickingDestination(false);
  }, []);

  const handleClearDestination = useCallback(() => {
    setDestination(null);
    setPickingDestination(false);
    setMaxCommuteMinutes(null);
    setFilters((prev) => (prev.sort === "commute_asc" ? { ...prev, sort: "price_asc" } : prev));
  }, []);

  const handleActivityChange = useCallback((value: ActivityFilter) => {
    setActivityFilter(value);
    setFitToken((token) => token + 1);
  }, []);

  const handleReset = useCallback(() => {
    setFilters(DEFAULT_FILTERS);
    setActivityFilter("all");
    setDestination(null);
    setPickingDestination(false);
    setMaxCommuteMinutes(null);
    setFilterByBounds(false);
    setFitToken((token) => token + 1);
  }, []);

  const handleShareView = useCallback((overrideCentrisId?: string) => {
    try {
      const url = new URL(window.location.href);
      if (overrideCentrisId) {
        url.searchParams.set("listing", overrideCentrisId);
      }
      void navigator.clipboard.writeText(url.toString());
      setCopiedShareUrl(true);
      window.setTimeout(() => setCopiedShareUrl(false), 2200);
    } catch {
      // Clipboard API unavailable
    }
  }, []);

  const handleExportData = useCallback(() => {
    const json = exportBundle(viewed);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `montreal-rentals-shortlist-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }, [exportBundle, viewed]);

  const handleImportData = useCallback(
    (rawJson: string) => {
      const result = importBundle(rawJson);
      if (result.viewed.length > 0) {
        mergeViewed(result.viewed);
      }
    },
    [importBundle, mergeViewed],
  );

  // Step 1: Activity + Commute filtering
  const activityFilteredProperties = useMemo(() => {
    const selected =
      selectedId === null ? null : properties.find((property) => property.id === selectedId) ?? null;
    const selectedKey = selected ? locationKey(selected.latitude, selected.longitude) : null;

    return properties.filter((property) => {
      if (maxCommuteMinutes !== null && destination) {
        const est = commuteById.get(property.id);
        if (!est || est.totalMinutes > maxCommuteMinutes) return false;
      }

      if (activityFilter !== "hidden") {
        if (property.id === selectedId) return true;
        if (
          selectedKey !== null &&
          locationKey(property.latitude, property.longitude) === selectedKey &&
          !hidden.has(property.centris_id)
        ) {
          return true;
        }
      }

      const isHid = hidden.has(property.centris_id);
      const isFav = favorites.has(property.centris_id);
      const isSeen = viewed.has(property.centris_id);
      const hasNote = Boolean(notes[property.centris_id]?.text);

      switch (activityFilter) {
        case "hidden":
          return isHid;
        case "favorites":
          return isFav;
        case "notes":
          return hasNote && !isHid;
        case "unseen":
          return !isSeen && !isHid;
        case "seen":
          return isSeen && !isHid;
        case "all":
        default:
          return !isHid;
      }
    });
  }, [
    properties,
    selectedId,
    maxCommuteMinutes,
    destination,
    commuteById,
    activityFilter,
    hidden,
    favorites,
    viewed,
    notes,
  ]);

  // Step 2: Optional Map Viewport Bounds + Client-Side Commute Sort
  const visibleProperties = useMemo(() => {
    let list = activityFilteredProperties;
    if (filterByBounds && mapBounds && (view === "map" || view === "split")) {
      list = list.filter(
        (p) =>
          p.latitude <= mapBounds.north &&
          p.latitude >= mapBounds.south &&
          p.longitude <= mapBounds.east &&
          p.longitude >= mapBounds.west,
      );
    }
    if (filters.sort === "commute_asc" && destination) {
      list = [...list].sort((a, b) => {
        const ca = commuteById.get(a.id)?.totalMinutes ?? Number.POSITIVE_INFINITY;
        const cb = commuteById.get(b.id)?.totalMinutes ?? Number.POSITIVE_INFINITY;
        return (
          ca - cb || (a.price ?? Number.POSITIVE_INFINITY) - (b.price ?? Number.POSITIVE_INFINITY)
        );
      });
    }
    return list;
  }, [
    activityFilteredProperties,
    filterByBounds,
    mapBounds,
    view,
    filters.sort,
    destination,
    commuteById,
  ]);

  const seenInResults = useMemo(
    () =>
      properties.reduce((count, property) => count + (viewed.has(property.centris_id) ? 1 : 0), 0),
    [properties, viewed],
  );

  const notesCount = useMemo(() => Object.keys(notes).length, [notes]);

  const isClientFiltered =
    activityFilter !== "all" ||
    hidden.size > 0 ||
    filterByBounds ||
    (destination !== null && maxCommuteMinutes !== null);

  const displayTotal = isClientFiltered ? visibleProperties.length : total;
  const hasMore = properties.length < total;
  const filtersActive = !isDefaultFilters(filters) || destination !== null;
  const activeFilterCount =
    countActiveFilters(filters) +
    (destination ? 1 : 0) +
    (activityFilter !== "all" ? 1 : 0) +
    (filterByBounds ? 1 : 0);

  const hiddenByMapBounds =
    filterByBounds && activityFilteredProperties.length > 0 && visibleProperties.length === 0;
  const hiddenByActivityFilter =
    !hiddenByMapBounds &&
    (activityFilter !== "all" || hidden.size > 0) &&
    properties.length > 0 &&
    activityFilteredProperties.length === 0;

  const showEmpty = !loading && !error && visibleProperties.length === 0;
  const walkRadius =
    filters.maxWalkMinutes < WALK_MAX
      ? filters.maxWalkMinutes * 80
      : meta?.walk_radius_meters ?? DEFAULT_WALK_RADIUS_METERS;

  const emptyState = useMemo(
    () => (
      <EmptyState
        lastScrape={meta?.last_scrape}
        filtersActive={filtersActive}
        hiddenByActivityFilter={hiddenByActivityFilter}
        hiddenByMapBounds={hiddenByMapBounds}
        activityFilter={activityFilter}
        onReset={handleReset}
        onShowAll={() => setActivityFilter("all")}
        onDisableMapBounds={() => setFilterByBounds(false)}
      />
    ),
    [
      meta?.last_scrape,
      filtersActive,
      hiddenByActivityFilter,
      hiddenByMapBounds,
      activityFilter,
      handleReset,
    ],
  );

  const loadMoreButton = hasMore ? (
    <button
      type="button"
      onClick={() => void loadMore()}
      disabled={loadingMore}
      className="inline-flex items-center gap-2 rounded-full bg-white px-5 py-2.5 text-xs font-semibold text-slate-800 shadow-card ring-1 ring-slate-200 transition hover:bg-slate-50 disabled:opacity-60"
    >
      {loadingMore && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
      Loaded {properties.length} of {total} · Load more
    </button>
  ) : null;

  // Active Filter Chips
  const activeChips = useMemo(() => {
    const chips: { key: string; label: string; color?: string; onRemove: () => void }[] = [];

    for (const ln of filters.lines) {
      chips.push({
        key: `line-${ln}`,
        label: ln === "REM" ? "REM" : `${ln} line`,
        color: lineHexColor(ln),
        onRemove: () =>
          setFilters((prev) => ({ ...prev, lines: prev.lines.filter((l) => l !== ln) })),
      });
    }
    if (filters.network !== "ALL") {
      chips.push({
        key: "network",
        label: filters.network === "METRO" ? "Metro only" : "REM only",
        onRemove: () => setFilters((prev) => ({ ...prev, network: "ALL" })),
      });
    }
    if (filters.stationName) {
      chips.push({
        key: "station",
        label: `Near ${filters.stationName}`,
        onRemove: () => setFilters((prev) => ({ ...prev, stationName: null })),
      });
    }
    if (filters.minPrice !== null || filters.maxPrice !== null) {
      const label =
        filters.minPrice !== null && filters.maxPrice !== null
          ? `${formatPrice(filters.minPrice)}–${formatPrice(filters.maxPrice)}`
          : filters.maxPrice !== null
            ? `≤ ${formatPrice(filters.maxPrice)}/mo`
            : `≥ ${formatPrice(filters.minPrice)}/mo`;
      chips.push({
        key: "price",
        label,
        onRemove: () => setFilters((prev) => ({ ...prev, minPrice: null, maxPrice: null })),
      });
    }
    if (filters.studioOnly) {
      chips.push({
        key: "rooms",
        label: "Studio",
        onRemove: () => setFilters((prev) => ({ ...prev, studioOnly: false, minRooms: null })),
      });
    } else if (filters.minRooms !== null) {
      chips.push({
        key: "rooms",
        label: `${filters.minRooms}+ bd`,
        onRemove: () => setFilters((prev) => ({ ...prev, minRooms: null })),
      });
    }
    if (filters.minBathrooms !== null) {
      chips.push({
        key: "baths",
        label: `${filters.minBathrooms}+ ba`,
        onRemove: () => setFilters((prev) => ({ ...prev, minBathrooms: null })),
      });
    }
    if (filters.minArea !== null) {
      chips.push({
        key: "area",
        label: `${filters.minArea}+ sq ft`,
        onRemove: () => setFilters((prev) => ({ ...prev, minArea: null })),
      });
    }
    if (filters.maxPricePerSqft !== null) {
      chips.push({
        key: "ppsqft",
        label: `≤ $${filters.maxPricePerSqft.toFixed(2)}/ft²`,
        onRemove: () => setFilters((prev) => ({ ...prev, maxPricePerSqft: null })),
      });
    }
    if (filters.search.trim() !== "") {
      chips.push({
        key: "search",
        label: `“${filters.search.trim()}”`,
        onRemove: () => setFilters((prev) => ({ ...prev, search: "" })),
      });
    }
    if (filters.maxWalkMinutes < WALK_MAX) {
      chips.push({
        key: "walk",
        label: `≤ ${filters.maxWalkMinutes} min walk`,
        onRemove: () => setFilters((prev) => ({ ...prev, maxWalkMinutes: WALK_MAX })),
      });
    }
    if (filters.moveIn !== "any") {
      chips.push({
        key: "moveIn",
        label: filters.moveIn === "immediate" ? "Immediate move-in" : "July 1st",
        onRemove: () => setFilters((prev) => ({ ...prev, moveIn: "any" })),
      });
    }
    if (filters.priceDropsOnly) {
      chips.push({
        key: "drops",
        label: "↓ Price drops",
        onRemove: () => setFilters((prev) => ({ ...prev, priceDropsOnly: false })),
      });
    }
    if (filters.addedWithinDays !== null) {
      chips.push({
        key: "added",
        label: `Added ≤ ${filters.addedWithinDays}d`,
        onRemove: () => setFilters((prev) => ({ ...prev, addedWithinDays: null })),
      });
    }
    if (filters.petsAllowed) {
      chips.push({
        key: "pets",
        label: "Pets allowed",
        onRemove: () => setFilters((prev) => ({ ...prev, petsAllowed: false })),
      });
    }
    if (filters.parkingRequired) {
      chips.push({
        key: "parking",
        label: "Parking",
        onRemove: () => setFilters((prev) => ({ ...prev, parkingRequired: false })),
      });
    }
    if (filters.laundryInUnit) {
      chips.push({
        key: "laundry",
        label: "In-unit laundry",
        onRemove: () => setFilters((prev) => ({ ...prev, laundryInUnit: false })),
      });
    }
    if (filters.appliancesIncluded) {
      chips.push({
        key: "appliances",
        label: "Appliances",
        onRemove: () => setFilters((prev) => ({ ...prev, appliancesIncluded: false })),
      });
    }
    if (filters.utilitiesIncluded) {
      chips.push({
        key: "utilities",
        label: "Heat/Hydro incl.",
        onRemove: () => setFilters((prev) => ({ ...prev, utilitiesIncluded: false })),
      });
    }
    if (filters.airConditioning) {
      chips.push({
        key: "ac",
        label: "Air cond.",
        onRemove: () => setFilters((prev) => ({ ...prev, airConditioning: false })),
      });
    }
    if (filters.balcony) {
      chips.push({
        key: "balcony",
        label: "Balcony",
        onRemove: () => setFilters((prev) => ({ ...prev, balcony: false })),
      });
    }
    if (filters.furnished) {
      chips.push({
        key: "furnished",
        label: "Furnished",
        onRemove: () => setFilters((prev) => ({ ...prev, furnished: false })),
      });
    }
    if (destination) {
      chips.push({
        key: "dest",
        label: maxCommuteMinutes
          ? `≤ ${maxCommuteMinutes}m to ${destination.label}`
          : `To ${destination.label}`,
        onRemove: handleClearDestination,
      });
    }
    if (activityFilter !== "all") {
      chips.push({
        key: "activity",
        label: `Showing: ${activityFilter}`,
        onRemove: () => setActivityFilter("all"),
      });
    }
    if (filterByBounds) {
      chips.push({
        key: "bounds",
        label: "Map area only",
        onRemove: () => setFilterByBounds(false),
      });
    }
    return chips;
  }, [filters, destination, maxCommuteMinutes, activityFilter, filterByBounds, handleClearDestination]);

  const sidebar = (
    <FilterSidebar
      filters={filters}
      onChange={setFilters}
      onReset={handleReset}
      activityFilter={activityFilter}
      onActivityFilterChange={handleActivityChange}
      favoritesCount={favorites.size}
      notesCount={notesCount}
      hiddenCount={hidden.size}
      seenInResults={seenInResults}
      loadedCount={properties.length}
      viewedHistoryCount={viewed.size}
      onClearViewed={clearViewed}
      onClearHidden={clearHidden}
      onExportData={handleExportData}
      onImportData={handleImportData}
      stations={stations}
      showStations={showStations}
      onToggleStations={setShowStations}
      showTransitLines={showTransitLines}
      onToggleTransitLines={setShowTransitLines}
      destination={destination}
      onDestinationChange={setDestination}
      pickingDestination={pickingDestination}
      onTogglePickDestination={() => {
        setPickingDestination((prev) => !prev);
        if (view === "list") setView("map");
        setSidebarOpen(false);
      }}
      maxCommuteMinutes={maxCommuteMinutes}
      onMaxCommuteChange={setMaxCommuteMinutes}
      meta={meta}
      total={displayTotal}
      loading={loading}
    />
  );

  return (
    <div className="flex h-dvh flex-col bg-slate-50">
      {/* Main Header */}
      <header className="z-30 flex h-16 shrink-0 items-center justify-between gap-3 border-b border-slate-200/80 bg-white/95 px-3 shadow-[0_1px_2px_rgba(15,23,42,0.03)] backdrop-blur-md sm:px-5">
        <div className="flex min-w-0 items-center gap-2.5 sm:gap-3">
          <button
            type="button"
            onClick={() => setDesktopSidebarCollapsed((prev) => !prev)}
            aria-label={
              desktopSidebarCollapsed ? "Expand filter sidebar" : "Collapse filter sidebar"
            }
            title={desktopSidebarCollapsed ? "Show filters" : "Hide filters"}
            className={`hidden h-9 w-9 shrink-0 items-center justify-center rounded-xl border transition lg:inline-flex ${
              desktopSidebarCollapsed
                ? "border-brand-200 bg-brand-50 text-brand-700"
                : "border-slate-200/90 text-slate-600 hover:bg-slate-50 hover:text-slate-900"
            }`}
          >
            <PanelLeft className="h-4 w-4" />
          </button>

          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-600 to-indigo-700 text-white shadow-sm ring-1 ring-brand-700/20">
            <TrainFront className="h-5 w-5" aria-hidden="true" />
          </div>

          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-sm font-bold tracking-tight text-slate-900 sm:text-base">
                Montréal Transit Rentals
              </h1>
              {marketStats?.median_price && (
                <span className="hidden items-center gap-1 rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-semibold tabular-nums text-slate-700 xl:inline-flex">
                  Median {formatPrice(marketStats.median_price)}
                  {marketStats.avg_price_per_sqft
                    ? ` · ${formatPricePerSqft(marketStats.avg_price_per_sqft)}`
                    : ""}
                </span>
              )}
              {marketStats && marketStats.price_drop_count > 0 && (
                <button
                  type="button"
                  onClick={() =>
                    setFilters((prev) => ({ ...prev, priceDropsOnly: !prev.priceDropsOnly }))
                  }
                  className={`hidden items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold transition 2xl:inline-flex ${
                    filters.priceDropsOnly
                      ? "bg-emerald-600 text-white shadow-sm"
                      : "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-600/20 hover:bg-emerald-100"
                  }`}
                >
                  <TrendingDown className="h-3 w-3" />
                  {marketStats.price_drop_count} drops
                </button>
              )}
            </div>
            <p className="truncate text-xs font-medium text-slate-500">
              {loading
                ? "Refreshing listings…"
                : `${displayTotal.toLocaleString("en-CA")} rental${
                    displayTotal === 1 ? "" : "s"
                  } near Metro & REM${
                    marketStats?.avg_walk_minutes
                      ? ` · Avg ${Math.round(marketStats.avg_walk_minutes)} min walk`
                      : ""
                  }`}
            </p>
          </div>
        </div>

        {/* Center Search Input */}
        <div className="hidden max-w-xs flex-1 md:block lg:max-w-md">
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
              aria-hidden="true"
            />
            <input
              ref={searchInputRef}
              type="search"
              value={filters.search}
              onChange={(e) => setFilters((prev) => ({ ...prev, search: e.target.value }))}
              placeholder="Search street, neighbourhood, station, ID…"
              aria-label="Search listings"
              className="w-full rounded-full border border-slate-200/90 bg-slate-100/75 py-2 pl-10 pr-9 text-xs font-medium text-slate-800 placeholder:text-slate-400 transition hover:border-slate-300 hover:bg-slate-100 focus:border-brand-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-500/15"
            />
            {filters.search ? (
              <button
                type="button"
                onClick={() => setFilters((prev) => ({ ...prev, search: "" }))}
                aria-label="Clear search"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-full p-0.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            ) : (
              <kbd className="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 rounded border border-slate-200 bg-white px-1.5 py-0.5 font-sans text-[10px] font-semibold text-slate-400 lg:inline-block">
                /
              </kbd>
            )}
          </div>
        </div>

        {/* Right Controls */}
        <div className="flex items-center gap-1.5 sm:gap-2">
          {/* Quick Shortlist Button */}
          <button
            type="button"
            onClick={() =>
              setActivityFilter((prev) => (prev === "favorites" ? "all" : "favorites"))
            }
            aria-pressed={activityFilter === "favorites"}
            title="Toggle saved shortlist"
            className={`inline-flex h-9 items-center gap-1.5 rounded-xl border px-3 text-xs font-semibold transition ${
              activityFilter === "favorites"
                ? "border-rose-200 bg-rose-50 text-rose-700 shadow-sm"
                : "border-slate-200/90 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50"
            }`}
          >
            <Heart
              className={`h-4 w-4 ${
                activityFilter === "favorites" || favorites.size > 0
                  ? "fill-rose-500 text-rose-500"
                  : "text-slate-400"
              }`}
            />
            <span className="hidden sm:inline">Saved</span>
            {favorites.size > 0 && (
              <span className="rounded-full bg-rose-100 px-1.5 py-0.5 text-[10px] font-bold leading-none text-rose-700">
                {favorites.size}
              </span>
            )}
          </button>

          {/* 3-Way View Switcher */}
          <div
            role="group"
            aria-label="View mode"
            className="flex items-center gap-0.5 rounded-xl bg-slate-100/90 p-1 ring-1 ring-inset ring-slate-200/75"
          >
            <button
              type="button"
              aria-pressed={view === "map"}
              onClick={() => setView("map")}
              className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold transition ${
                view === "map"
                  ? "bg-white text-brand-700 shadow-sm ring-1 ring-slate-900/5"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              <MapIcon className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="hidden sm:inline">Map</span>
            </button>
            <button
              type="button"
              aria-pressed={view === "split"}
              onClick={() => setView("split")}
              className={`hidden items-center justify-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold transition md:inline-flex ${
                view === "split"
                  ? "bg-white text-brand-700 shadow-sm ring-1 ring-slate-900/5"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              <Columns2 className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Split</span>
            </button>
            <button
              type="button"
              aria-pressed={view === "list"}
              onClick={() => setView("list")}
              className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold transition ${
                view === "list"
                  ? "bg-white text-brand-700 shadow-sm ring-1 ring-slate-900/5"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              <ListIcon className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="hidden sm:inline">List</span>
            </button>
          </div>

          {/* Share URL Button */}
          <button
            type="button"
            onClick={() => handleShareView()}
            aria-label="Copy shareable search link"
            title="Copy shareable link with current filters"
            className="hidden h-9 items-center gap-1.5 rounded-xl border border-slate-200/90 bg-white px-3 text-xs font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 sm:inline-flex"
          >
            {copiedShareUrl ? (
              <>
                <Check className="h-3.5 w-3.5 text-emerald-600" />
                <span className="text-emerald-700">Copied</span>
              </>
            ) : (
              <>
                <Share2 className="h-3.5 w-3.5 text-slate-500" />
                <span className="hidden xl:inline">Share</span>
              </>
            )}
          </button>

          {/* Refresh */}
          <button
            type="button"
            onClick={refreshAll}
            aria-label="Refresh listings"
            title="Refresh listings"
            className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200/90 bg-white text-slate-600 transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} aria-hidden="true" />
          </button>

          {/* Mobile Filter Trigger */}
          <button
            type="button"
            onClick={() => setSidebarOpen(true)}
            aria-label="Open filters"
            className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-slate-200/90 bg-white px-3 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 lg:hidden"
          >
            <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Filters</span>
            {activeFilterCount > 0 && (
              <span className="rounded-full bg-brand-600 px-1.5 py-0.5 text-[10px] font-bold leading-none text-white">
                {activeFilterCount}
              </span>
            )}
          </button>
        </div>
      </header>

      {/* Active Filter Chips Sub-bar */}
      {activeChips.length > 0 && (
        <div className="z-20 flex shrink-0 items-center gap-1.5 overflow-x-auto border-b border-slate-200/80 bg-white/95 px-4 py-2 backdrop-blur-sm">
          <span className="mr-0.5 shrink-0 text-[11px] font-semibold text-slate-400">
            Filters:
          </span>
          {activeChips.map((chip) => (
            <button
              key={chip.key}
              type="button"
              onClick={chip.onRemove}
              className="group inline-flex shrink-0 items-center gap-1.5 rounded-full border border-slate-200/90 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700 transition hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700"
            >
              {chip.color && (
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: chip.color }}
                />
              )}
              <span>{chip.label}</span>
              <X className="h-3 w-3 text-slate-400 transition group-hover:text-rose-600" />
            </button>
          ))}
          <button
            type="button"
            onClick={handleReset}
            className="ml-1 shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold text-brand-600 transition hover:bg-brand-50"
          >
            Clear all
          </button>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex min-h-0 flex-1">
        {!desktopSidebarCollapsed && (
          <aside className="hidden w-[356px] shrink-0 overflow-y-auto border-r border-slate-200/80 bg-slate-50/80 lg:block xl:w-[376px]">
            {sidebar}
          </aside>
        )}

        <main className="relative flex min-w-0 flex-1">
          {/* Map Pane (shown in 'map' and 'split' modes) */}
          {(view === "map" || view === "split") && (
            <div className="relative h-full min-w-0 flex-1">
              <MapView
                properties={visibleProperties}
                stations={stations}
                selectedId={selectedId}
                hoveredId={hoveredId}
                focus={focus}
                fitToken={fitToken}
                showStations={showStations}
                showTransitLines={showTransitLines}
                activeLines={filters.lines}
                activeStationName={filters.stationName}
                walkRadiusMeters={walkRadius}
                filterByBounds={filterByBounds}
                onToggleFilterByBounds={setFilterByBounds}
                onBoundsChange={setMapBounds}
                destination={destination}
                pickingDestination={pickingDestination}
                onPickDestination={handlePickDestination}
                onCancelPickDestination={() => setPickingDestination(false)}
                onClearDestination={handleClearDestination}
                commuteById={commuteById}
                viewedIds={viewed}
                favoriteIds={favorites}
                notes={notes}
                onSelect={handleSelect}
                onDeselect={handleDeselect}
                onHover={setHoveredId}
                onOpenDetail={handleOpenDetail}
                onToggleStation={handleToggleStation}
                onView={markViewed}
                onUnview={markUnviewed}
                onToggleFavorite={toggleFavorite}
                onToggleHidden={toggleHidden}
              />

              {loading && (
                <div className="pointer-events-none absolute left-1/2 top-3 z-[1000] -translate-x-1/2">
                  <div className="inline-flex items-center gap-2 rounded-full border border-slate-200/80 bg-white/95 px-4 py-1.5 text-xs font-semibold text-slate-700 shadow-card backdrop-blur-md">
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-brand-600" aria-hidden="true" />
                    Updating listings…
                  </div>
                </div>
              )}

              {view === "map" && showEmpty && (
                <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center p-6">
                  <div className="pointer-events-auto">{emptyState}</div>
                </div>
              )}

              {view === "map" && loadMoreButton && !showEmpty && (
                <div className="absolute bottom-5 left-1/2 z-[1000] -translate-x-1/2">
                  {loadMoreButton}
                </div>
              )}
            </div>
          )}

          {/* Split-View List Pane (Desktop / Tablet) */}
          {view === "split" && (
            <div className="hidden h-full w-[400px] shrink-0 border-l border-slate-200/80 bg-slate-50/75 md:block xl:w-[460px] 2xl:w-[660px]">
              <ListView
                properties={visibleProperties}
                loading={loading}
                compact
                selectedId={selectedId}
                hoveredId={hoveredId}
                viewedIds={viewed}
                favoriteIds={favorites}
                hiddenIds={hidden}
                notes={notes}
                commuteById={commuteById}
                onOpenDetail={handleOpenDetail}
                onHover={setHoveredId}
                onShowOnMap={handleShowOnMap}
                onView={markViewed}
                onUnview={markUnviewed}
                onToggleFavorite={toggleFavorite}
                onToggleHidden={toggleHidden}
                emptyState={emptyState}
                footer={loadMoreButton}
              />
            </div>
          )}

          {/* Full List View */}
          {view === "list" && (
            <div className="h-full min-w-0 flex-1 bg-slate-50/60">
              <ListView
                properties={visibleProperties}
                loading={loading}
                selectedId={selectedId}
                hoveredId={hoveredId}
                viewedIds={viewed}
                favoriteIds={favorites}
                hiddenIds={hidden}
                notes={notes}
                commuteById={commuteById}
                onOpenDetail={handleOpenDetail}
                onHover={setHoveredId}
                onShowOnMap={handleShowOnMap}
                onView={markViewed}
                onUnview={markUnviewed}
                onToggleFavorite={toggleFavorite}
                onToggleHidden={toggleHidden}
                emptyState={emptyState}
                footer={loadMoreButton}
              />
            </div>
          )}

          {/* Error Banner */}
          {error && (
            <div className="absolute inset-x-4 top-4 z-[1100] mx-auto flex max-w-xl items-start gap-3 rounded-2xl border border-red-200 bg-red-50/95 p-4 text-sm text-red-800 shadow-card backdrop-blur-sm">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
              <div className="flex-1">
                <div className="font-semibold">Could not load data</div>
                <div className="mt-0.5 text-red-700">{error}</div>
              </div>
              <button
                type="button"
                onClick={refreshAll}
                className="shrink-0 rounded-xl bg-red-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-red-700"
              >
                Retry
              </button>
            </div>
          )}
        </main>
      </div>

      {/* Mobile Filter Drawer */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 lg:hidden"
          role="dialog"
          aria-modal="true"
          aria-label="Filters"
        >
          <div
            className="backdrop-fade absolute inset-0 bg-slate-900/45 backdrop-blur-[2px]"
            onClick={() => setSidebarOpen(false)}
          />
          <aside className="drawer-slide-left absolute left-0 top-0 flex h-full w-[92%] max-w-[380px] flex-col bg-slate-50 shadow-2xl">
            <div className="flex shrink-0 items-center justify-between border-b border-slate-200/80 bg-white px-5 py-3.5">
              <span className="text-sm font-bold text-slate-900">Search & Filters</span>
              <button
                type="button"
                onClick={() => setSidebarOpen(false)}
                aria-label="Close filters"
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100"
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">
              {/* Mobile Search Input inside Drawer */}
              <div className="border-b border-slate-200/70 bg-white px-4 py-3 md:hidden">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    type="search"
                    value={filters.search}
                    onChange={(e) => setFilters((prev) => ({ ...prev, search: e.target.value }))}
                    placeholder="Search street, area, station, ID…"
                    className="w-full rounded-full border border-slate-200 bg-slate-100/80 py-2 pl-10 pr-8 text-xs font-medium text-slate-800 outline-none focus:border-brand-500 focus:bg-white"
                  />
                </div>
              </div>
              {sidebar}
            </div>
            <div className="shrink-0 border-t border-slate-200/80 bg-white p-4">
              <button
                type="button"
                onClick={() => setSidebarOpen(false)}
                className="w-full rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-700"
              >
                Show {displayTotal.toLocaleString("en-CA")} rental{displayTotal === 1 ? "" : "s"}
              </button>
            </div>
          </aside>
        </div>
      )}

      {/* Slide-over Property Detail & Notes Drawer */}
      <PropertyDetailDrawer
        property={detailProperty}
        onClose={() => setDetailId(null)}
        isFavorite={detailProperty ? favorites.has(detailProperty.centris_id) : false}
        isHidden={detailProperty ? hidden.has(detailProperty.centris_id) : false}
        isViewed={detailProperty ? viewed.has(detailProperty.centris_id) : false}
        note={detailProperty ? notes[detailProperty.centris_id] : undefined}
        commute={detailProperty ? commuteById.get(detailProperty.id) ?? null : null}
        destination={destination}
        onToggleFavorite={toggleFavorite}
        onToggleHidden={(cid) => {
          toggleHidden(cid);
          setDetailId(null);
        }}
        onUnview={markUnviewed}
        onSaveNote={setNote}
        onShowOnMap={handleShowOnMap}
        onSelectStation={(name) => setFilters((prev) => ({ ...prev, stationName: name }))}
        onShareListing={(cid) => handleShareView(cid)}
      />
    </div>
  );
}
