"use client";

import type { ReactNode } from "react";
import { Ban, Eye, Heart, Inbox, MapPin, RotateCcw, StickyNote } from "lucide-react";
import type { LastScrape } from "@/services/api";
import type { ActivityFilter } from "@/lib/saved";
import { timeAgo } from "@/lib/format";

interface EmptyStateProps {
  lastScrape: LastScrape | null | undefined;
  filtersActive: boolean;
  hiddenByActivityFilter: boolean;
  hiddenByMapBounds: boolean;
  activityFilter: ActivityFilter;
  onReset: () => void;
  onShowAll: () => void;
  onDisableMapBounds: () => void;
}

export default function EmptyState({
  lastScrape,
  filtersActive,
  hiddenByActivityFilter,
  hiddenByMapBounds,
  activityFilter,
  onReset,
  onShowAll,
  onDisableMapBounds,
}: EmptyStateProps) {
  if (hiddenByMapBounds) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center rounded-2xl border border-slate-200 bg-white/95 p-8 text-center shadow-card backdrop-blur-sm">
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-brand-50 text-brand-600">
          <MapPin className="h-6 w-6" aria-hidden="true" />
        </div>
        <h2 className="text-lg font-semibold text-slate-900">No rentals in this map area</h2>
        <p className="mt-2 text-sm leading-relaxed text-slate-600">
          Zoom out or pan toward a Metro / REM line, or turn off &ldquo;Search map area&rdquo; to
          see all matching listings across Greater Montréal.
        </p>
        <button
          type="button"
          onClick={onDisableMapBounds}
          className="mt-5 inline-flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700"
        >
          Show entire Montréal area
        </button>
      </div>
    );
  }

  if (hiddenByActivityFilter) {
    const config: Record<
      ActivityFilter,
      { icon: ReactNode; title: string; message: string }
    > = {
      all: {
        icon: <Eye className="h-6 w-6" />,
        title: "All matching listings are hidden",
        message: "You dismissed the listings matching this search. Switch to Hidden or show all.",
      },
      unseen: {
        icon: <Eye className="h-6 w-6" />,
        title: "You have seen everything here",
        message:
          "Every listing matching your filters has already been opened. Show all listings, or clear your seen history from the sidebar.",
      },
      seen: {
        icon: <Eye className="h-6 w-6" />,
        title: "Nothing marked as seen yet",
        message: "Open a listing's popup, details drawer, or Centris page and it will appear here.",
      },
      favorites: {
        icon: <Heart className="h-6 w-6" />,
        title: "Your shortlist is empty",
        message:
          "Click the heart icon on any apartment card or map popup to save it to your shortlist.",
      },
      notes: {
        icon: <StickyNote className="h-6 w-6" />,
        title: "No listings with notes",
        message: "Open any listing's Details & Notes panel to jot down private thoughts.",
      },
      hidden: {
        icon: <Ban className="h-6 w-6" />,
        title: "No hidden listings",
        message: "Listings you dismiss will be tucked away here in case you want to restore them.",
      },
    };
    const item = config[activityFilter];
    return (
      <div className="mx-auto flex max-w-md flex-col items-center rounded-2xl border border-slate-200 bg-white/95 p-8 text-center shadow-card backdrop-blur-sm">
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-brand-50 text-brand-600">
          {item.icon}
        </div>
        <h2 className="text-lg font-semibold text-slate-900">{item.title}</h2>
        <p className="mt-2 text-sm leading-relaxed text-slate-600">{item.message}</p>
        <button
          type="button"
          onClick={onShowAll}
          className="mt-5 inline-flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700"
        >
          Show all listings
        </button>
      </div>
    );
  }

  let title = "No listings yet";
  let message =
    "The scraper has not completed a run yet. The first run starts when the stack boots and can take several minutes. Follow its progress in the scraper container's logs.";

  if (filtersActive) {
    title = "No listings match your filters";
    message =
      "Try raising your max rent, relaxing amenity toggles, widening the walking or commute time, or clearing the selected station.";
  } else if (lastScrape) {
    if (lastScrape.status === "running") {
      title = "Scraper is running";
      message = `A scrape started ${timeAgo(lastScrape.started_at)} and is still in progress. Listings appear as they are stored.`;
    } else if (lastScrape.status === "failed") {
      title = "Last scrape failed";
      message = lastScrape.error_message
        ? `${lastScrape.error_message} (${timeAgo(lastScrape.started_at)}). Check the scraper logs for details.`
        : `The last scrape failed ${timeAgo(lastScrape.started_at)}. Check the scraper logs for details.`;
    } else {
      title = "No listings near transit";
      message = `The last scrape finished ${timeAgo(lastScrape.finished_at ?? lastScrape.started_at)} and found ${lastScrape.listings_found} listings, but none are within a 15-minute walk of a station yet.`;
    }
  }

  return (
    <div className="mx-auto flex max-w-md flex-col items-center rounded-2xl border border-slate-200 bg-white/95 p-8 text-center shadow-card backdrop-blur-sm">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-brand-50 text-brand-600">
        <Inbox className="h-6 w-6" aria-hidden="true" />
      </div>
      <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
      <p className="mt-2 text-sm leading-relaxed text-slate-600">{message}</p>
      {filtersActive && (
        <button
          type="button"
          onClick={onReset}
          className="mt-5 inline-flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700"
        >
          <RotateCcw className="h-4 w-4" aria-hidden="true" />
          Reset all filters
        </button>
      )}
    </div>
  );
}
