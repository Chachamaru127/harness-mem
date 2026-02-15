import type { FeedItem } from "./types";

export function mergeFeedItems(current: FeedItem[], incoming: FeedItem[], prepend = false): FeedItem[] {
  const order = prepend ? [...incoming, ...current] : [...current, ...incoming];
  const seen = new Set<string>();
  const merged: FeedItem[] = [];

  for (const item of order) {
    const id = item.id;
    if (!id || seen.has(id)) {
      continue;
    }
    seen.add(id);
    merged.push(item);
  }

  return merged;
}
