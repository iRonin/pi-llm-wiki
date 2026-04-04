import { access } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import type { CanonicalPageType } from "./types.ts";

export const CONFIG_PATH = join(".wiki", "config.json");

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export function normalizeUserPath(value?: string): string | undefined {
  if (!value) return value;
  return value.startsWith("@") ? value.slice(1) : value;
}

export async function resolveWikiRoot(cwd: string, explicitRoot?: string): Promise<string> {
  if (explicitRoot) {
    const root = resolve(cwd, normalizeUserPath(explicitRoot)!);
    if (await exists(join(root, CONFIG_PATH))) return root;
    throw new Error(`No .wiki/config.json found at ${root}`);
  }

  let current = resolve(cwd);
  while (true) {
    if (await exists(join(current, CONFIG_PATH))) return current;
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }

  throw new Error(`Could not find .wiki/config.json from ${cwd} upward`);
}

export async function maybeResolveWikiRoot(cwd: string, explicitRoot?: string): Promise<string | undefined> {
  try {
    return await resolveWikiRoot(cwd, explicitRoot);
  } catch {
    return undefined;
  }
}

export function resolveFrom(base: string, maybeRelative: string): string {
  const normalized = normalizeUserPath(maybeRelative) ?? maybeRelative;
  return isAbsolute(normalized) ? normalized : resolve(base, normalized);
}

export function toRelative(root: string, absolutePath: string): string {
  return relative(root, absolutePath).split("\\").join("/");
}

export function isWithin(parent: string, target: string): boolean {
  const rel = relative(resolve(parent), resolve(target));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

export function sourcePacketDir(root: string, sourceId: string): string {
  return join(root, "raw", "sources", sourceId);
}

export function sourcePagePath(root: string, sourceId: string): string {
  return join(root, "wiki", "sources", `${sourceId}.md`);
}

export function canonicalDir(root: string, type: CanonicalPageType): string {
  switch (type) {
    case "concept":
      return join(root, "wiki", "concepts");
    case "entity":
      return join(root, "wiki", "entities");
    case "synthesis":
      return join(root, "wiki", "syntheses");
    case "analysis":
      return join(root, "wiki", "analyses");
  }
}

export function canonicalPagePath(root: string, type: CanonicalPageType, slug: string, dateStamp?: string): string {
  if (type === "analysis") {
    return join(canonicalDir(root, type), `${dateStamp ?? "analysis"}-${slug}.md`);
  }
  return join(canonicalDir(root, type), `${slug}.md`);
}

export function metaPath(root: string, name: string): string {
  return join(root, "meta", name);
}

export function lockPath(root: string): string {
  return join(root, ".wiki", ".llm-wiki.lock");
}

export function normalizeWikiLinkTarget(target: string): string | undefined {
  const clean = target.trim().replace(/\\/g, "/").replace(/\.md$/i, "").replace(/^wiki\//, "");
  if (!clean) return undefined;
  if (
    clean.startsWith("sources/") ||
    clean.startsWith("concepts/") ||
    clean.startsWith("entities/") ||
    clean.startsWith("syntheses/") ||
    clean.startsWith("analyses/")
  ) {
    return `wiki/${clean}.md`;
  }
  return undefined;
}

export function generatedMetaFiles(root: string): string[] {
  return [
    metaPath(root, "registry.json"),
    metaPath(root, "backlinks.json"),
    metaPath(root, "events.jsonl"),
    metaPath(root, "index.md"),
    metaPath(root, "log.md"),
    metaPath(root, "lint-report.md"),
  ];
}
