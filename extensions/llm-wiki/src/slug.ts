import type { CanonicalPageType } from "./types.ts";

export function slugifyTitle(title: string): string {
  return title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-") || "untitled";
}

export function todayStamp(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

export function makeSourceId(existingIds: string[], now = new Date()): string {
  const stamp = todayStamp(now);
  const prefix = `SRC-${stamp}-`;
  const used = existingIds
    .filter((id) => id.startsWith(prefix))
    .map((id) => Number.parseInt(id.slice(prefix.length), 10))
    .filter((value) => Number.isFinite(value));

  const next = (used.length === 0 ? 0 : Math.max(...used)) + 1;
  return `${prefix}${String(next).padStart(3, "0")}`;
}

export function makePageId(type: CanonicalPageType, slug: string, now = new Date()): string {
  if (type === "analysis") {
    return `analysis-${todayStamp(now)}-${slug}`;
  }
  return `${type}-${slug}`;
}

export function dedupeSlug(baseSlug: string, existingSlugs: Iterable<string>): string {
  const seen = new Set(existingSlugs);
  if (!seen.has(baseSlug)) return baseSlug;
  let index = 2;
  while (seen.has(`${baseSlug}-${index}`)) index += 1;
  return `${baseSlug}-${index}`;
}
