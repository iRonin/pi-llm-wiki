import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parsePage, writePage } from "./frontmatter.ts";
import { metaPath, sourcePacketDir, sourcePagePath } from "./paths.ts";
import { todayStamp } from "./slug.ts";
import type { WikiEvent } from "./types.ts";

export async function appendEvent(root: string, event: WikiEvent): Promise<void> {
  const eventsPath = metaPath(root, "events.jsonl");
  await mkdir(join(root, "meta"), { recursive: true });
  const existing = await readEvents(root);
  existing.push(event);
  await writeFile(eventsPath, `${existing.map((entry) => JSON.stringify(entry)).join("\n")}\n`, "utf8");
}

function isValidEvent(value: unknown): value is WikiEvent {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const e = value as Record<string, unknown>;
  return (
    typeof e["ts"] === "string" &&
    typeof e["kind"] === "string" &&
    typeof e["title"] === "string"
  );
}

export async function readEvents(root: string): Promise<WikiEvent[]> {
  try {
    const raw = await readFile(metaPath(root, "events.jsonl"), "utf8");
    return raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const parsed: unknown = JSON.parse(line);
        if (!isValidEvent(parsed)) {
          throw new Error(`Malformed event in events.jsonl: ${line.slice(0, 120)}`);
        }
        return parsed;
      });
  } catch {
    return [];
  }
}

export function renderLogMarkdown(title: string, events: WikiEvent[]): string {
  const lines: string[] = [`# ${title} Log`, ""];
  if (events.length === 0) {
    lines.push("_No events yet._");
    return `${lines.join("\n")}\n`;
  }

  for (const event of events) {
    lines.push(`## [${formatTimestamp(event.ts)}] ${event.kind} | ${event.title}`);
    if (event.summary) lines.push(`- Summary: ${event.summary}`);
    if (event.sourceIds?.length) {
      lines.push(`- Sources: ${event.sourceIds.map((id) => `[[sources/${id}|${id}]]`).join(", ")}`);
    }
    if (event.pagePaths?.length) {
      lines.push(
        `- Pages: ${event.pagePaths
          .map((path) => `[[${path.replace(/^wiki\//, "").replace(/\.md$/, "")}]]`)
          .join(", ")}`,
      );
    }
    if (event.notes?.length) lines.push(`- Notes: ${event.notes.join("; ")}`);
    lines.push("");
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

export async function rebuildLog(root: string, title: string): Promise<string> {
  const events = await readEvents(root);
  await writeFile(metaPath(root, "log.md"), renderLogMarkdown(title, events), "utf8");
  return "meta/log.md";
}

export async function markSourcesIntegrated(root: string, sourceIds: string[], integratedAt: string): Promise<void> {
  for (const sourceId of sourceIds) {
    const manifestPath = join(sourcePacketDir(root, sourceId), "manifest.json");
    try {
      const manifestRaw = await readFile(manifestPath, "utf8");
      const manifest = JSON.parse(manifestRaw) as Record<string, any>;
      manifest.status = "integrated";
      manifest.integratedAt = integratedAt;
      await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    } catch {
      // Ignore missing manifests so logging remains robust.
    }

    const sourcePath = sourcePagePath(root, sourceId);
    try {
      const page = await parsePage(root, sourcePath);
      await writePage(
        sourcePath,
        {
          ...page.frontmatter,
          status: "integrated",
          integrated_at: integratedAt,
          updated: todayStamp(new Date(integratedAt)),
        },
        page.body,
      );
    } catch {
      // Ignore missing source pages.
    }
  }
}

function formatTimestamp(timestamp: string): string {
  const date = new Date(timestamp);
  return `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}
