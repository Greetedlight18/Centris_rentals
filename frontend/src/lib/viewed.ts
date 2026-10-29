import { useCallback, useEffect, useRef, useState } from "react";

export type ViewedFilter = "all" | "unseen" | "seen";

const STORAGE_KEY = "montreal-rentals:viewed:v1";
const MAX_STORED = 5000;

function readStorage(): string[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((value): value is string => typeof value === "string");
  } catch {
    return [];
  }
}

function writeStorage(ids: Set<string>): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(ids)));
  } catch {
    // Storage unavailable (private mode or quota): the app keeps working in memory.
  }
}

export interface ViewedListings {
  viewed: Set<string>;
  markViewed: (centrisId: string) => void;
  markUnviewed: (centrisId: string) => void;
  mergeViewed: (ids: string[]) => void;
  clearViewed: () => void;
}

export function useViewedListings(): ViewedListings {
  const [viewed, setViewed] = useState<Set<string>>(() => new Set());
  const current = useRef<Set<string>>(new Set());

  useEffect(() => {
    const hydrate = () => {
      const loaded = new Set(readStorage());
      current.current = loaded;
      setViewed(loaded);
    };
    hydrate();

    const onStorage = (event: StorageEvent) => {
      if (event.key !== null && event.key !== STORAGE_KEY) return;
      hydrate();
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const commit = useCallback((next: Set<string>) => {
    let bounded = next;
    if (next.size > MAX_STORED) {
      bounded = new Set(Array.from(next).slice(next.size - MAX_STORED));
    }
    current.current = bounded;
    setViewed(bounded);
    writeStorage(bounded);
  }, []);

  const markViewed = useCallback(
    (centrisId: string) => {
      if (current.current.has(centrisId)) return;
      const next = new Set(current.current);
      next.add(centrisId);
      commit(next);
    },
    [commit],
  );

  const markUnviewed = useCallback(
    (centrisId: string) => {
      if (!current.current.has(centrisId)) return;
      const next = new Set(current.current);
      next.delete(centrisId);
      commit(next);
    },
    [commit],
  );

  const mergeViewed = useCallback(
    (ids: string[]) => {
      if (ids.length === 0) return;
      const next = new Set(current.current);
      for (const id of ids) {
        if (id) next.add(id);
      }
      commit(next);
    },
    [commit],
  );

  const clearViewed = useCallback(() => {
    commit(new Set());
  }, [commit]);

  return { viewed, markViewed, markUnviewed, mergeViewed, clearViewed };
}
