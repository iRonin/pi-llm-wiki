import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { WikiConfig } from "./types.ts";

const CONFIG_RELATIVE_PATH = join(".wiki", "config.json");

export function createDefaultConfig(title: string, domain = "General"): WikiConfig {
  return {
    version: 1,
    title,
    domain,
    timezone: "UTC",
    paths: {
      raw: "raw",
      wiki: "wiki",
      meta: "meta",
    },
    pageTypes: {
      source: "wiki/sources",
      concept: "wiki/concepts",
      entity: "wiki/entities",
      synthesis: "wiki/syntheses",
      analysis: "wiki/analyses",
    },
    templates: {
      source: ".wiki/templates/source.md",
      concept: ".wiki/templates/concept.md",
      entity: ".wiki/templates/entity.md",
      synthesis: ".wiki/templates/synthesis.md",
      analysis: ".wiki/templates/analysis.md",
    },
    linkStyle: "wikilink-folder-qualified",
    citationStyle: "source-page-id-link",
    protect: [
      "raw/**",
      "meta/registry.json",
      "meta/backlinks.json",
      "meta/events.jsonl",
      "meta/index.md",
      "meta/log.md",
      "meta/lint-report.md",
    ],
    search: {
      defaultLimit: 10,
    },
  };
}

export async function hasWikiConfig(root: string): Promise<boolean> {
  try {
    await access(join(root, CONFIG_RELATIVE_PATH));
    return true;
  } catch {
    return false;
  }
}

export async function loadConfig(root: string): Promise<WikiConfig> {
  const path = join(root, CONFIG_RELATIVE_PATH);
  const raw = await readFile(path, "utf8");
  const parsed = JSON.parse(raw) as Partial<WikiConfig>;

  const fallback = createDefaultConfig(parsed.title ?? "Wiki", parsed.domain ?? "General");

  return {
    ...fallback,
    ...parsed,
    paths: {
      ...fallback.paths,
      ...(parsed.paths ?? {}),
    },
    pageTypes: {
      ...fallback.pageTypes,
      ...(parsed.pageTypes ?? {}),
    },
    templates: {
      ...fallback.templates,
      ...(parsed.templates ?? {}),
    },
    search: {
      ...fallback.search,
      ...(parsed.search ?? {}),
    },
    protect: Array.isArray(parsed.protect) ? parsed.protect : fallback.protect,
  };
}

export async function writeDefaultConfig(root: string, title: string, domain?: string): Promise<string> {
  const path = join(root, CONFIG_RELATIVE_PATH);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(createDefaultConfig(title, domain), null, 2)}\n`, "utf8");
  return path;
}
