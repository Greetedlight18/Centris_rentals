"use client";

import { Inbox, RotateCcw } from "lucide-react";
import type { LastScrape } from "@/services/api";
import { timeAgo } from "@/lib/format";

interface EmptyStateProps {
  lastScrape: LastScrape | null | undefined;
  filtersActive: boolean;
  onReset: () => void;
}

export default function EmptyState({ lastScrape, filtersActive, onReset }: EmptyStateProps) {
  let title = "No listings yet";
  let message =
    "The scraper has not completed a run yet. The first run starts when the stack boots and can take several minutes. Follow its progress with: docker compose logs -f scraper";

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