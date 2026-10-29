import { useCallback, useEffect, useRef, useState } from "react";

export type ActivityFilter = "all" | "unseen" | "favorites" | "notes" | "seen" | "hidden";

export interface SavedNote {
  text: string;
  updatedAt: string;
}

interface StoredSavedData {
  favorites: string[];
  hidden: string[];
  notes: Record<string, SavedNote>;
}

const STORAGE_KEY = "montreal-rentals:saved:v1";

function emptyData(): StoredSavedData {
  return { favorites: [], hidden: [], notes: {} };
}

function readSavedStorage(): StoredSavedData {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyData();
    const parsed = JSON.parse(raw) as Partial<StoredSavedData>;
    const favorites = Array.isArray(parsed.favorites)
      ? parsed.favorites.filter((v): v is string => typeof v === "string")
      : [];
    const hidden = Array.isArray(parsed.hidden)
      ? parsed.hidden.filter((v): v is string => typeof v === "string")
      : [];
    const notes: Record<string, SavedNote> = {};
    if (parsed.notes && typeof parsed.notes === "object") {
      for (const [id, entry] of Object.entries(parsed.notes)) {
        if (entry && typeof entry.text === "string" && entry.text.trim()) {
          notes[id] = {
            text: entry.text,
            updatedAt: typeof entry.updatedAt === "string" ? entry.updatedAt : new Date().toISOString(),
          };
        }
      }
    }
    return { favorites, hidden, notes };
  } catch {
    return emptyData();
  }
}

function writeSavedStorage(data: StoredSavedData): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // Storage unavailable or full: state continues working in memory.
  }
}

export interface SavedListingsState {
  favorites: Set<string>;
  hidden: Set<string>;
  notes: Record<string, SavedNote>;
  toggleFavorite: (centrisId: string) => void;
  toggleHidden: (centrisId: string) => void;
  setNote: (centrisId: string, text: string) => void;
  clearHidden: () => void;
  exportBundle: (viewedIds: Set<string>) => string;
  importBundle: (rawJson: string) => { favorites: number; hidden: number; notes: number; viewed: string[] };
}

export function useSavedListings(): SavedListingsState {
  const [favorites, setFavorites] = useState<Set<string>>(() => new Set());
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  const [notes, setNotes] = useState<Record<string, SavedNote>>({});

  const favRef = useRef<Set<string>>(new Set());
  const hidRef = useRef<Set<string>>(new Set());
  const notesRef = useRef<Record<string, SavedNote>>({});

  useEffect(() => {
    const hydrate = () => {
      const loaded = readSavedStorage();
      const favSet = new Set(loaded.favorites);
      const hidSet = new Set(loaded.hidden);
      favRef.current = favSet;
      hidRef.current = hidSet;
      notesRef.current = loaded.notes;
      setFavorites(favSet);
      setHidden(hidSet);
      setNotes(loaded.notes);
    };
    hydrate();

    const onStorage = (event: StorageEvent) => {
      if (event.key !== null && event.key !== STORAGE_KEY) return;
      hydrate();
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const persist = useCallback(
    (nextFav: Set<string>, nextHid: Set<string>, nextNotes: Record<string, SavedNote>) => {
      favRef.current = nextFav;
      hidRef.current = nextHid;
      notesRef.current = nextNotes;
      setFavorites(nextFav);
      setHidden(nextHid);
      setNotes(nextNotes);
      writeSavedStorage({
        favorites: Array.from(nextFav),
        hidden: Array.from(nextHid),
        notes: nextNotes,
      });
    },
    [],
  );

  const toggleFavorite = useCallback(
    (centrisId: string) => {
      const nextFav = new Set(favRef.current);
      const nextHid = new Set(hidRef.current);
      if (nextFav.has(centrisId)) {
        nextFav.delete(centrisId);
      } else {
        nextFav.add(centrisId);
        nextHid.delete(centrisId);
      }
      persist(nextFav, nextHid, notesRef.current);
    },
    [persist],
  );

  const toggleHidden = useCallback(
    (centrisId: string) => {
      const nextHid = new Set(hidRef.current);
      const nextFav = new Set(favRef.current);
      if (nextHid.has(centrisId)) {
        nextHid.delete(centrisId);
      } else {
        nextHid.add(centrisId);
        nextFav.delete(centrisId);
      }
      persist(nextFav, nextHid, notesRef.current);
    },
    [persist],
  );

  const setNote = useCallback(
    (centrisId: string, text: string) => {
      const nextNotes = { ...notesRef.current };
      if (!text.trim()) {
        delete nextNotes[centrisId];
      } else {
        nextNotes[centrisId] = {
          text,
          updatedAt: new Date().toISOString(),
        };
      }
      persist(favRef.current, hidRef.current, nextNotes);
    },
    [persist],
  );

  const clearHidden = useCallback(() => {
    persist(favRef.current, new Set(), notesRef.current);
  }, [persist]);

  const exportBundle = useCallback((viewedIds: Set<string>): string => {
    return JSON.stringify(
      {
        version: 1,
        exportedAt: new Date().toISOString(),
        favorites: Array.from(favRef.current),
        hidden: Array.from(hidRef.current),
        notes: notesRef.current,
        viewed: Array.from(viewedIds),
      },
      null,
      2,
    );
  }, []);

  const importBundle = useCallback(
    (rawJson: string) => {
      const parsed = JSON.parse(rawJson) as {
        favorites?: unknown;
        hidden?: unknown;
        notes?: unknown;
        viewed?: unknown;
      };
      const nextFav = new Set(favRef.current);
      const nextHid = new Set(hidRef.current);
      const nextNotes = { ...notesRef.current };

      if (Array.isArray(parsed.favorites)) {
        for (const id of parsed.favorites) {
          if (typeof id === "string") nextFav.add(id);
        }
      }
      if (Array.isArray(parsed.hidden)) {
        for (const id of parsed.hidden) {
          if (typeof id === "string") nextHid.add(id);
        }
      }
      if (parsed.notes && typeof parsed.notes === "object") {
        for (const [id, entry] of Object.entries(parsed.notes as Record<string, unknown>)) {
          if (entry && typeof entry === "object" && "text" in entry) {
            const noteObj = entry as { text?: unknown; updatedAt?: unknown };
            if (typeof noteObj.text === "string" && noteObj.text.trim()) {
              nextNotes[id] = {
                text: noteObj.text,
                updatedAt:
                  typeof noteObj.updatedAt === "string" ? noteObj.updatedAt : new Date().toISOString(),
              };
            }
          }
        }
      }

      const importedViewed = Array.isArray(parsed.viewed)
        ? parsed.viewed.filter((v): v is string => typeof v === "string")
        : [];

      persist(nextFav, nextHid, nextNotes);
      return {
        favorites: nextFav.size,
        hidden: nextHid.size,
        notes: Object.keys(nextNotes).length,
        viewed: importedViewed,
      };
    },
    [persist],
  );

  return {
    favorites,
    hidden,
    notes,
    toggleFavorite,
    toggleHidden,
    setNote,
    clearHidden,
    exportBundle,
    importBundle,
  };
}

