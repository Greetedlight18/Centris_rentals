"use client";

import { Eye, Inbox, RotateCcw } from "lucide-react";
import type { LastScrape } from "@/services/api";
import type { ViewedFilter } from "@/lib/viewed";
import { timeAgo } from "@/lib/format";

interface EmptyStateProps {
  lastScrape: LastScrape | null | undefined;
  filtersActive: boolean;
  hiddenBySeenFilter: boolean;
  viewedFilter: ViewedFilter;
  onReset: () => void;
  onShowAll: () => void;
}

export default function EmptyState({
  lastScrape,
  filtersActive,
  hiddenBySeenFilter,
  viewedFilter,
  onReset,
  onShowAll,
}: EmptyStateProps) {
  if (hiddenBySeenFilter) {
    const unseenMode = viewedFilter === "unseen";
    return (
      <div className="mx-auto flex max-w-md flex-col items-center rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-card">
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-brand-50 text-brand-600">
          <Eye className="h-6 w-6" aria-hidden="true" />
        </div>
        <h2 className="text-lg font-semibold text-slate-900">
          {unseenMode ? "You have seen everything here" : "Nothing marked as seen yet"}
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-slate-600">
          {unseenMode
            ? "Every listing that matches your filters is already marked as seen. Show all listings, or clear your seen history from the sidebar."
            : "Open a listing's popup or its Centris page and it will show up here."}
        </p>
        <button
          type="button"
          onClick={onShowAll}
          className="mt-5 inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-700"
        >
          <Eye className="h-4 w-4" aria-hidden="true" />
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
    message = "Try raising the maximum rent, lowering the bedroom minimum, or widening the walking time.";
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
    <div className="mx-auto flex max-w-md flex-col items-center rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-card">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-brand-50 text-brand-600">
        <Inbox className="h-6 w-6" aria-hidden="true" />
      </div>
      <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
      <p className="mt-2 text-sm leading-relaxed text-slate-600">{message}</p>
      {filtersActive && (
        <button
          type="button"
          onClick={onReset}
          className="mt-5 inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-700"
        >
          <RotateCcw className="h-4 w-4" aria-hidden="true" />
          Reset filters
        </button>
      )}
    </div>
  );
}