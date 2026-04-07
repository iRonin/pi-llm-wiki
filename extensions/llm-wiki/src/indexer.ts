import { mkdir, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { loadConfig } from "./config.ts";
import { parsePage } from "./frontmatter.ts";
import { metaPath, toRelative } from "./paths.ts";
import type { BacklinksData, BacklinksRecord, ParsedPage, RegistryData, RegistryEntry, WikiPageType } from "./types.ts";

const PAGE_ORDER: WikiPageType[] = ["source", "concept", "entity", "synthesis", "analysis"];

export async function scanWikiPages(root: string): Promise<ParsedPage[]> {
  const config = await loadConfig(root);
  const pages: ParsedPage[] = [];
  for (const relativeDir of Object.values(config.pageTypes)) {
    const absoluteDir = join(root, relativeDir);
    const files = await walkMarkdownFiles(absoluteDir);
    for (const file of files) {
      pages.push(await parsePage(root, file));
    }
  }
  pages.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  return pages;
}

export function buildRegistry(pages: ParsedPage[]): RegistryData {
  const entries: RegistryEntry[] = pages.map((page) => {
    const type = String(page.frontmatter.type || inferTypeFromPath(page.relativePath)) as WikiPageType;
    return {
      id: String(page.frontmatter.id ?? page.relativePath),
      type,
      path: page.relativePath,
      title: String(page.frontmatter.title ?? page.relativePath),
      aliases: arrayOfStrings(page.frontmatter.aliases),
      summary: typeof page.frontmatter.summary === "string" ? page.frontmatter.summary : undefined,
      status: typeof page.frontmatter.status === "string" ? page.frontmatter.status : undefined,
      tags: arrayOfStrings(page.frontmatter.tags),
      updated: typeof page.frontmatter.updated === "string" ? page.frontmatter.updated : undefined,
      sourceIds: arrayOfStrings(page.frontmatter.source_ids),
      linksOut: [...new Set(page.normalizedLinks)],
      headings: page.headings,
      wordCount: page.wordCount,
    };
  });

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    pages: entries.sort((a, b) => a.path.localeCompare(b.path)),
  };
}

export function buildBacklinks(registry: RegistryData): BacklinksData {
  const known = new Set(registry.pages.map((page) => page.path));
  const byPath: Record<string, BacklinksRecord> = {};

  for (const page of registry.pages) {
    byPath[page.path] = { inbound: [], outbound: [] };
  }

  for (const page of registry.pages) {
    const outbound = page.linksOut.filter((target) => known.has(target));
    byPath[page.path].outbound = outbound;
    for (const target of outbound) {
      byPath[target] ??= { inbound: [], outbound: [] };
      byPath[target].inbound.push(page.path);
    }
  }

  for (const value of Object.values(byPath)) {
    value.inbound = [...new Set(value.inbound)].sort();
    value.outbound = [...new Set(value.outbound)].sort();
  }

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    byPath,
  };
}

export function renderIndexMarkdown(registry: RegistryData, title = "Wiki"): string {
  const lines: string[] = [`# ${title} Index`, "", `Generated: ${registry.generatedAt}`, ""];
  for (const type of PAGE_ORDER) {
    const entries = registry.pages.filter((page) => page.type === type);
    lines.push(`## ${capitalize(type)} Pages`, "");
    if (entries.length === 0) {
      lines.push("_None yet._", "");
      continue;
    }

    for (const entry of entries) {
      const summary = entry.summary?.trim() ? ` — ${entry.summary.trim()}` : "";
      const sources = entry.sourceIds.length ? ` _(sources: ${entry.sourceIds.length})_` : "";
      lines.push(`- [[${entry.path.replace(/^wiki\//, "").replace(/\.md$/, "")}|${entry.title}]]${summary}${sources}`);
    }
    lines.push("");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

export async function rebuildRegistryAndIndex(root: string): Promise<{
  registry: RegistryData;
  backlinks: BacklinksData;
  rebuilt: string[];
}> {
  const config = await loadConfig(root);
  const pages = await scanWikiPages(root);
  const registry = buildRegistry(pages);
  const backlinks = buildBacklinks(registry);

  await mkdir(join(root, config.paths.meta), { recursive: true });
  await writeFile(metaPath(root, "registry.json"), `${JSON.stringify(registry, null, 2)}\n`, "utf8");
  await writeFile(metaPath(root, "backlinks.json"), `${JSON.stringify(backlinks, null, 2)}\n`, "utf8");
  await writeFile(metaPath(root, "index.md"), renderIndexMarkdown(registry, config.title), "utf8");

  return {
    registry,
    backlinks,
    rebuilt: [
      toRelative(root, metaPath(root, "registry.json")),
      toRelative(root, metaPath(root, "backlinks.json")),
      toRelative(root, metaPath(root, "index.md")),
    ],
  };
}

// Guard against wikis with an unreasonable number of files (symlink loops,
// runaway generation, etc.).
const MAX_WIKI_FILES = 10_000;

async function walkMarkdownFiles(
  dir: string,
  counter = { n: 0 },
): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    const files: string[] = [];
    for (const entry of entries) {
      if (counter.n >= MAX_WIKI_FILES) break;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...(await walkMarkdownFiles(full, counter)));
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        files.push(full);
        counter.n++;
      }
    }
    return files.sort();
  } catch {
    return [];
  }
}

function arrayOfStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function inferTypeFromPath(relativePath: string): WikiPageType {
  if (relativePath.includes("/sources/")) return "source";
  if (relativePath.includes("/concepts/")) return "concept";
  if (relativePath.includes("/entities/")) return "entity";
  if (relativePath.includes("/syntheses/")) return "synthesis";
  return "analysis";
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
