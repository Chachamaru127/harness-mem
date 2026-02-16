import type { FeedItem } from "./types";

function takeString(primary: string | undefined, secondary: string | undefined): string | undefined {
  if (typeof primary === "string" && primary.trim().length > 0) {
    return primary;
  }
  if (typeof secondary === "string" && secondary.trim().length > 0) {
    return secondary;
  }
  return primary ?? secondary;
}

function mergeStringArray(primary: string[] | undefined, secondary: string[] | undefined): string[] {
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const source of [primary || [], secondary || []]) {
    for (const value of source) {
      if (typeof value !== "string" || value.length === 0 || seen.has(value)) {
        continue;
      }
      seen.add(value);
      merged.push(value);
    }
  }
  return merged;
}

function mergeFeedItem(primary: FeedItem, secondary: FeedItem): FeedItem {
  return {
    ...secondary,
    ...primary,
    id: primary.id || secondary.id,
    event_id: takeString(primary.event_id, secondary.event_id),
    platform: takeString(primary.platform, secondary.platform),
    project: takeString(primary.project, secondary.project),
    session_id: takeString(primary.session_id, secondary.session_id),
    event_type: takeString(primary.event_type, secondary.event_type),
    card_type: takeString(primary.card_type, secondary.card_type),
    title: takeString(primary.title, secondary.title),
    content: takeString(primary.content, secondary.content),
    summary: takeString(primary.summary, secondary.summary),
    created_at: takeString(primary.created_at, secondary.created_at),
    tags: mergeStringArray(primary.tags, secondary.tags),
    privacy_tags: mergeStringArray(primary.privacy_tags, secondary.privacy_tags),
  };
}

export function mergeFeedItems(current: FeedItem[], incoming: FeedItem[], prepend = false): FeedItem[] {
  const order = prepend ? [...incoming, ...current] : [...current, ...incoming];
  const indexes = new Map<string, number>();
  const merged: FeedItem[] = [];

  for (const item of order) {
    const id = item.id;
    if (!id) {
      continue;
    }
    const existingIndex = indexes.get(id);
    if (typeof existingIndex === "number") {
      merged[existingIndex] = mergeFeedItem(merged[existingIndex]!, item);
      continue;
    }
    indexes.set(id, merged.length);
    merged.push(item);
  }

  return merged;
}
