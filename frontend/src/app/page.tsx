"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  List as ListIcon,
  Loader2,
  Map as MapIcon,
  RefreshCw,
  SlidersHorizontal,
  TrainFront,
  X,
} from "lucide-react";
import EmptyState from "@/components/EmptyState";
import FilterSidebar from "@/components/FilterSidebar";
import ListView from "@/components/ListView";
import type { MapFocus } from "@/components/MapView";
import {
  DEFAULT_FILTERS,
  fetchMeta,
  fetchProperties,
  fetchStations,
  isAbortError,
  isDefaultFilters,
  type Meta,
  type Property,
  type PropertyFilters,
  type Station,
} from "@/services/api";

const MapView = dynamic(() => import("@/components/MapView"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center bg-slate-100 text-sm text-slate-500">
      <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
      Loading map…
    </div>
  ),
});

const PAGE_SIZE = 200;
const DEFAULT_WALK_RADIUS_METERS = 1200;

type ViewMode = "map" | "list";

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
  const [filters, setFilters] = useState<PropertyFilters>(DEFAULT_FILTERS);
  const debouncedFilters = useDebounced(filters, 350);

  const [properties, setProperties] = useState<Property[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [stations, setStations] = useState<Station[]>([]);
  const [meta, setMeta] = useState<Meta | null>(null);

  const [view, setView] = useState<ViewMode>("map");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [focus, setFocus] = useState<MapFocus | null>(null);
  const [fitToken, setFitToken] = useState(0);
  const [showStations, setShowStations] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const requestRef = useRef<AbortController | null>(null);
  const activeFiltersRef = useRef<PropertyFilters>(DEFAULT_FILTERS);

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
    void loadFirstPage(debouncedFilters);
  }, [debouncedFilters, loadFirstPage]);

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

  const handleSelect = useCallback((id: number | null) => {
    setSelectedId(id);
  }, []);

  const handleShowOnMap = useCallback((id: number) => {
    setSelectedId(id);
    setFocus({ id, token: Date.now() });
    setView("map");
  }, []);

  const handleReset = useCallback(() => {
    setFilters(DEFAULT_FILTERS);
  }, []);

  const hasMore = properties.length < total;
  const filtersActive = !isDefaultFilters(filters);
  const showEmpty = !loading && !error && properties.length === 0;
  const walkRadius = meta?.walk_radius_meters ?? DEFAULT_WALK_RADIUS_METERS;

  const emptyState = useMemo(
    () => (
      <EmptyState lastScrape={meta?.last_scrape} filtersActive={filtersActive} onReset={handleReset} />
    ),
    [meta?.last_scrape, filtersActive, handleReset],
  );

  const loadMoreButton = hasMore ? (
    <button
      type="button"
      onClick={() => void loadMore()}
      disabled={loadingMore}
      className="inline-flex items-center gap-2 rounded-full bg-white px-5 py-2.5 text-sm font-medium text-slate-800 shadow-card ring-1 ring-slate-200 transition hover:bg-slate-50 disabled:opacity-60"
    >
      {loadingMore && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
      Showing {properties.length} of {total} · Load more
    </button>
  ) : null;

  const sidebar = (
    <FilterSidebar
      filters={filters}
      onChange={setFilters}
      onReset={handleReset}
      showStations={showStations}
      onToggleStations={setShowStations}
      meta={meta}
      total={total}
      loading={loading}
    />
  );

  return (
    <div className="flex h-dvh flex-col">
      <header className="z-30 flex h-16 shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-600 text-white">
            <TrainFront className="h-5 w-5" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-base font-semibold leading-tight text-slate-900">
              Montréal Rentals
            </h1>
            <p className="truncate text-xs text-slate-500">
              {loading
                ? "Loading listings…"
                : `${total} listing${total === 1 ? "" : "s"} within a 15-min walk of Metro & REM`}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div
            role="group"
            aria-label="View mode"
            className="grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1"
          >
            <button
              type="button"
              aria-pressed={view === "map"}
              onClick={() => setView("map")}
              className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                view === "map" ? "bg-white text-brand-700 shadow-sm" : "text-slate-600 hover:text-slate-900"
              }`}
            >
              <MapIcon className="h-4 w-4" aria-hidden="true" />
              <span className="hidden sm:inline">Map</span>
            </button>
            <button
              type="button"
              aria-pressed={view === "list"}
              onClick={() => setView("list")}
              className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                view === "list" ? "bg-white text-brand-700 shadow-sm" : "text-slate-600 hover:text-slate-900"
              }`}
            >
              <ListIcon className="h-4 w-4" aria-hidden="true" />
              <span className="hidden sm:inline">List</span>
            </button>
          </div>

          <button
            type="button"
            onClick={refreshAll}
            aria-label="Refresh listings"
            title="Refresh listings"
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-600 transition hover:bg-slate-50"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} aria-hidden="true" />
          </button>

          <button
            type="button"
            onClick={() => setSidebarOpen(true)}
            aria-label="Open filters"
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 px-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50 lg:hidden"
          >
            <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
            Filters
            {filtersActive && <span className="h-2 w-2 rounded-full bg-brand-600" aria-hidden="true" />}
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="hidden w-80 shrink-0 overflow-y-auto border-r border-slate-200 bg-white lg:block">
          {sidebar}
        </aside>

        <main className="relative min-w-0 flex-1">
          {view === "map" ? (
            <MapView
              properties={properties}
              stations={stations}
              selectedId={selectedId}
              focus={focus}
              fitToken={fitToken}
              showStations={showStations}
              walkRadiusMeters={walkRadius}
              onSelect={handleSelect}
            />
          ) : (
            <ListView
              properties={properties}
              loading={loading}
              selectedId={selectedId}
              onSelect={handleSelect}
              onShowOnMap={handleShowOnMap}
              emptyState={emptyState}
              footer={loadMoreButton}
            />
          )}

          {error && (
            <div className="absolute inset-x-4 top-4 z-20 mx-auto flex max-w-xl items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 shadow-card">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
              <div className="flex-1">
                <div className="font-semibold">Could not load data</div>
                <div className="mt-0.5 text-red-700">{error}</div>
              </div>
              <button
                type="button"
                onClick={refreshAll}
                className="shrink-0 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-red-700"
              >
                Retry
              </button>
            </div>
          )}

          {loading && view === "map" && (
            <div className="pointer-events-none absolute left-1/2 top-4 z-20 -translate-x-1/2">
              <div className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-card">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
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
            <div className="absolute bottom-6 left-1/2 z-20 -translate-x-1/2">{loadMoreButton}</div>
          )}
        </main>
      </div>

      {sidebarOpen && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Filters">
          <div className="absolute inset-0 bg-slate-900/40" onClick={() => setSidebarOpen(false)} />
          <aside className="absolute left-0 top-0 h-full w-[88%] max-w-sm overflow-y-auto bg-white shadow-xl">
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white px-5 py-3">
              <span className="text-sm font-semibold text-slate-900">Filters</span>
              <button
                type="button"
                onClick={() => setSidebarOpen(false)}
                aria-label="Close filters"
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100"
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>
            {sidebar}
            <div className="sticky bottom-0 border-t border-slate-200 bg-white p-4">
              <button
                type="button"
                onClick={() => setSidebarOpen(false)}
                className="w-full rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-700"
              >
                Show {total} listing{total === 1 ? "" : "s"}
              </button>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}