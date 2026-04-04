import { loadConfig } from "./config.ts";
import type { RegistryData, SearchMatch, SearchResult, WikiPageType } from "./types.ts";

export async function searchRegistry(
  root: string,
  registry: RegistryData,
  query: string,
  type?: WikiPageType,
  limit?: number,
): Promise<SearchResult> {
  const config = await loadConfig(root);
  const normalized = query.trim().toLowerCase();
  const tokens = tokenize(normalized);

  const matches = registry.pages
    .filter((entry) => !type || entry.type === type)
    .map((entry) => ({
      entry,
      score: scoreEntry(entry, normalized, tokens),
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.entry.title.localeCompare(b.entry.title))
    .slice(0, limit ?? config.search.defaultLimit)
    .map<SearchMatch>(({ entry, score }) => ({
      id: entry.id,
      type: entry.type,
      path: entry.path,
      title: entry.title,
      summary: entry.summary,
      aliases: entry.aliases,
      score,
      sourceIds: entry.sourceIds,
    }));

  return { query, matches };
}

function scoreEntry(entry: RegistryData["pages"][number], normalizedQuery: string, tokens: string[]): number {
  let score = 0;
  const title = entry.title.toLowerCase();
  const aliases = entry.aliases.map((alias) => alias.toLowerCase());
  const summary = (entry.summary ?? "").toLowerCase();
  const headings = entry.headings.map((heading) => heading.toLowerCase());
  const path = entry.path.toLowerCase();
  const sourceIds = entry.sourceIds.map((id) => id.toLowerCase());
  const tags = entry.tags.map((tag) => tag.toLowerCase());

  if (title === normalizedQuery) score += 120;
  if (aliases.includes(normalizedQuery)) score += 110;
  if (path.includes(normalizedQuery)) score += 40;
  if (summary.includes(normalizedQuery)) score += 50;
  if (headings.some((heading) => heading.includes(normalizedQuery))) score += 35;
  if (sourceIds.includes(normalizedQuery)) score += 45;

  for (const token of tokens) {
    if (!token) continue;
    if (title.includes(token)) score += 18;
    if (aliases.some((alias) => alias.includes(token))) score += 14;
    if (summary.includes(token)) score += 8;
    if (headings.some((heading) => heading.includes(token))) score += 6;
    if (tags.some((tag) => tag.includes(token))) score += 4;
    if (sourceIds.some((id) => id.includes(token))) score += 5;
    if (path.includes(token)) score += 3;
  }

  return score;
}

function tokenize(input: string): string[] {
  return [...new Set(input.split(/[^a-z0-9]+/).map((part) => part.trim()).filter(Boolean))];
}
