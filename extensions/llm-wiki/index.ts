import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { StringEnum } from "@mariozechner/pi-ai";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { withFileMutationQueue } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { captureSource } from "./src/capture.ts";
import { loadConfig } from "./src/config.ts";
import { analyzeToolMutation } from "./src/guards.ts";
import { rebuildRegistryAndIndex } from "./src/indexer.ts";
import { runLint } from "./src/lint.ts";
import { appendEvent, markSourcesIntegrated, readEvents, rebuildLog } from "./src/log.ts";
import { metaPath, lockPath, maybeResolveWikiRoot, resolveWikiRoot, toRelative } from "./src/paths.ts";
import { searchRegistry } from "./src/search.ts";
import { bootstrapVault, ensureCanonicalPage } from "./src/scaffold.ts";
import type { RegistryData, StatusSummary, WikiConfig, WikiEvent, WikiPageType } from "./src/types.ts";

const baseDir = dirname(fileURLToPath(import.meta.url));
const skillPath = join(baseDir, "resources", "skills", "llm-wiki", "SKILL.md");
const dirtyRoots = new Set<string>();

const PAGE_TYPE_ENUM = StringEnum(["source", "concept", "entity", "synthesis", "analysis"] as const);
const CANONICAL_TYPE_ENUM = StringEnum(["concept", "entity", "synthesis", "analysis"] as const);
const LINT_MODE_ENUM = StringEnum(["links", "orphans", "frontmatter", "duplicates", "coverage", "staleness", "all"] as const);
const EVENT_KIND_ENUM = StringEnum(["capture", "integrate", "query", "file-analysis", "lint", "refactor", "rebuild"] as const);

export default function llmWikiExtension(pi: ExtensionAPI) {
  pi.on("resources_discover", () => ({
    skillPaths: [skillPath],
  }));

  pi.on("tool_call", async (event, ctx) => {
    if (
      event.toolName !== "write" &&
      event.toolName !== "edit" &&
      event.toolName !== "bash"
    ) return undefined;

    const root = await maybeResolveWikiRoot(ctx.cwd);
    if (!root) return undefined;

    // For bash commands we cannot reliably extract file paths, so we do a
    // best-effort string scan for known protected path fragments.  This is
    // intentionally conservative to avoid false positives while still
    // catching the obvious "echo … > meta/registry.json" bypass.
    if (event.toolName === "bash") {
      const command = typeof (event.input as Record<string, unknown>)["command"] === "string"
        ? (event.input as Record<string, unknown>)["command"] as string
        : "";
      const protectedFragments = [
        "raw/",
        "meta/registry.json",
        "meta/backlinks.json",
        "meta/events.jsonl",
        "meta/index.md",
        "meta/log.md",
        "meta/lint-report.md",
      ];
      for (const fragment of protectedFragments) {
        if (command.includes(fragment)) {
          const msg = `llm-wiki: bash command references protected path fragment "${fragment}"`;
          if (ctx.hasUI) ctx.ui.notify(msg, "warning");
          return { block: true, reason: msg };
        }
      }
      return undefined;
    }

    const analysis = analyzeToolMutation(root, event.toolName, event.input, ctx.cwd);
    if (analysis.protectedPaths.length > 0) {
      const protectedList = analysis.protectedPaths.map((path) => toRelative(root, path)).join(", ");
      if (ctx.hasUI) ctx.ui.notify(`Blocked protected wiki path(s): ${protectedList}`, "warning");
      return { block: true, reason: `llm-wiki protects these paths: ${protectedList}` };
    }

    if (analysis.wikiPaths.length > 0) {
      dirtyRoots.add(root);
    }

    return undefined;
  });

  pi.on("agent_end", async (_event, ctx) => {
    for (const root of [...dirtyRoots]) {
      try {
        await withRootLock(root, async () => {
          await rebuildAllGeneratedArtifacts(root);
        });
        dirtyRoots.delete(root);
      } catch (error) {
        if (ctx.hasUI) {
          ctx.ui.notify(`llm-wiki rebuild failed: ${(error as Error).message}`, "error");
        }
      }
    }
  });

  pi.registerTool({
    name: "wiki_bootstrap",
    label: "Wiki Bootstrap",
    description: "Initialize an llm-wiki vault in the current directory or a specified root path.",
    promptSnippet: "Initialize the llm-wiki folder structure, config, templates, schema, and generated metadata files",
    promptGuidelines: ["Use this tool before any other llm-wiki workflow when the current project is not bootstrapped yet."],
    parameters: Type.Object({
      rootPath: Type.Optional(Type.String({ description: "Optional root directory for the wiki vault" })),
      title: Type.String({ description: "Human-readable wiki title" }),
      domain: Type.Optional(Type.String({ description: "Short description of the wiki domain" })),
      force: Type.Optional(Type.Boolean({ description: "Overwrite scaffold files if the wiki already exists" })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const root = resolve(ctx.cwd, params.rootPath ?? ".");
      const created = await bootstrapVault(root, params.title, params.domain, params.force ?? false);
      await withRootLock(root, async () => {
        await rebuildAllGeneratedArtifacts(root);
      });
      return {
        content: [{ type: "text", text: `Initialized llm-wiki at ${root}` }],
        details: {
          rootPath: root,
          created,
          configPath: join(root, ".wiki", "config.json"),
        },
      };
    },
  });

  pi.registerTool({
    name: "wiki_capture_source",
    label: "Wiki Capture Source",
    description: "Capture a URL, file, or pasted text into an immutable source packet and scaffold a source page.",
    promptSnippet: "Capture a new source into raw/ and create a wiki/sources page before integrating it into canonical pages",
    promptGuidelines: [
      "Use this tool when a user supplies a URL, local file, PDF, webpage, transcript, or pasted text that should become part of the wiki.",
      "After capture, read the source page before updating canonical pages.",
    ],
    parameters: Type.Object({
      inputType: StringEnum(["url", "file", "text"] as const),
      value: Type.String({ description: "The URL, file path, or raw text to capture" }),
      title: Type.Optional(Type.String({ description: "Optional override title" })),
      kind: Type.Optional(Type.String({ description: "Optional source kind, e.g. article, paper, note, transcript" })),
      tags: Type.Optional(Type.Array(Type.String({ description: "Tag" }))),
      createSourcePage: Type.Optional(Type.Boolean({ description: "Whether to create wiki/sources/SRC-*.md (default true)" })),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const root = await resolveWikiRoot(ctx.cwd);
      const config = await loadConfig(root);
      return withRootLock(root, async () => {
        const result = await captureSource(
          root,
          ctx.cwd,
          config,
          params,
          {
            exec: (command, args, options) => pi.exec(command, args, options),
          },
          signal,
        );

        await appendEvent(root, {
          ts: new Date().toISOString(),
          kind: "capture",
          title: `Captured ${result.title}`,
          sourceIds: [result.sourceId],
          pagePaths: result.sourcePagePath ? [result.sourcePagePath] : undefined,
          actor: "extension",
          notes: [`inputType=${params.inputType}`],
        });

        await rebuildAllGeneratedArtifacts(root);

        return {
          content: [{ type: "text", text: `Captured ${result.sourceId}: ${result.title}` }],
          details: result,
        };
      });
    },
  });

  pi.registerTool({
    name: "wiki_search",
    label: "Wiki Search",
    description: "Search the compiled wiki registry by title, alias, summary, headings, path, tags, and source ids.",
    promptSnippet: "Search the wiki registry for relevant pages before reading or editing markdown files directly",
    promptGuidelines: ["Use this tool first for query and integration workflows so you update existing pages instead of creating duplicates."],
    parameters: Type.Object({
      query: Type.String({ description: "Search query" }),
      type: Type.Optional(PAGE_TYPE_ENUM),
      limit: Type.Optional(Type.Number({ description: "Maximum number of matches to return" })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const root = await resolveWikiRoot(ctx.cwd);
      const registry = await loadRegistry(root);
      const result = await searchRegistry(root, registry, params.query, params.type as WikiPageType | undefined, params.limit);
      return {
        content: [{ type: "text", text: formatSearch(result) }],
        details: result,
      };
    },
  });

  pi.registerTool({
    name: "wiki_ensure_page",
    label: "Wiki Ensure Page",
    description: "Resolve an existing canonical page by title or alias, or create it safely from a template if missing.",
    promptSnippet: "Resolve or create canonical concept/entity/synthesis/analysis pages without duplicating titles or aliases",
    promptGuidelines: ["Use this tool before creating a new canonical page in wiki/concepts, wiki/entities, wiki/syntheses, or wiki/analyses."],
    parameters: Type.Object({
      type: CANONICAL_TYPE_ENUM,
      title: Type.String({ description: "Page title" }),
      aliases: Type.Optional(Type.Array(Type.String({ description: "Alias" }))),
      tags: Type.Optional(Type.Array(Type.String({ description: "Tag" }))),
      summary: Type.Optional(Type.String({ description: "Optional one-line summary" })),
      createIfMissing: Type.Optional(Type.Boolean({ description: "Create page if not found (default true)" })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const root = await resolveWikiRoot(ctx.cwd);
      const config = await loadConfig(root);
      return withRootLock(root, async () => {
        const registry = await loadRegistry(root);
        const result = await ensureCanonicalPage(root, config, registry, {
          ...params,
          createIfMissing: params.createIfMissing ?? true,
        });

        if (result.created && result.path) {
          await appendEvent(root, {
            ts: new Date().toISOString(),
            kind: "refactor",
            title: `Created ${result.type} page ${result.title}`,
            pagePaths: [result.path],
            actor: "extension",
          });
          await rebuildAllGeneratedArtifacts(root);
        }

        return {
          content: [{ type: "text", text: formatEnsurePage(result) }],
          details: result,
        };
      });
    },
  });

  pi.registerTool({
    name: "wiki_lint",
    label: "Wiki Lint",
    description: "Run deterministic structural lint checks over the wiki, including links, orphans, frontmatter, duplicates, coverage, and staleness.",
    promptSnippet: "Run deterministic health checks over wiki structure and generated metadata",
    promptGuidelines: ["Use this tool before a semantic audit when you want a mechanical health report of the wiki."],
    parameters: Type.Object({
      mode: Type.Optional(LINT_MODE_ENUM),
      writeReport: Type.Optional(Type.Boolean({ description: "Write meta/lint-report.md" })),
      limit: Type.Optional(Type.Number({ description: "Maximum number of issues to return" })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const root = await resolveWikiRoot(ctx.cwd);
      const result = await runLint(root, params.mode ?? "all", params.writeReport ?? true, params.limit);
      return {
        content: [{ type: "text", text: formatLint(result) }],
        details: result,
      };
    },
  });

  pi.registerTool({
    name: "wiki_status",
    label: "Wiki Status",
    description: "Show a quick operational dashboard for the wiki, including page counts, source states, and recent events.",
    promptSnippet: "Inspect the wiki's current operational status and recent activity",
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
      const root = await resolveWikiRoot(ctx.cwd);
      const status = await buildStatus(root);
      return {
        content: [{ type: "text", text: formatStatus(status) }],
        details: status,
      };
    },
  });

  pi.registerTool({
    name: "wiki_log_event",
    label: "Wiki Log Event",
    description: "Append a structured event to meta/events.jsonl, regenerate meta/log.md, and optionally mark captured sources as integrated.",
    promptSnippet: "Record structured wiki events such as capture, integrate, query, file-analysis, lint, refactor, and rebuild",
    promptGuidelines: [
      "Use this tool after integration when you want the chronology preserved in meta/events.jsonl and meta/log.md.",
      "If you pass kind=integrate and sourceIds, the corresponding source packets and source pages are marked integrated.",
    ],
    parameters: Type.Object({
      kind: EVENT_KIND_ENUM,
      title: Type.String({ description: "Short event title" }),
      summary: Type.Optional(Type.String({ description: "Optional event summary" })),
      sourceIds: Type.Optional(Type.Array(Type.String({ description: "Source ID" }))),
      pagePaths: Type.Optional(Type.Array(Type.String({ description: "Relative page path, e.g. wiki/concepts/foo.md" }))),
      notes: Type.Optional(Type.Array(Type.String({ description: "Additional note" }))),
      actor: Type.Optional(StringEnum(["agent", "user", "extension"] as const)),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const root = await resolveWikiRoot(ctx.cwd);
      const config = await loadConfig(root);
      return withRootLock(root, async () => {
        const ts = new Date().toISOString();
        const event: WikiEvent = {
          ts,
          kind: params.kind,
          title: params.title,
          summary: params.summary,
          sourceIds: params.sourceIds,
          pagePaths: params.pagePaths,
          notes: params.notes,
          actor: params.actor ?? "agent",
        };
        await appendEvent(root, event);
        if (params.kind === "integrate" && params.sourceIds?.length) {
          await markSourcesIntegrated(root, params.sourceIds, ts);
          await rebuildAllGeneratedArtifacts(root);
        } else {
          await rebuildLog(root, config.title);
        }
        return {
          content: [{ type: "text", text: `Logged ${params.kind}: ${params.title}` }],
          details: {
            eventTs: ts,
            eventPath: "meta/events.jsonl",
            logPath: "meta/log.md",
          },
        };
      });
    },
  });

  pi.registerTool({
    name: "wiki_rebuild_meta",
    label: "Wiki Rebuild Meta",
    description: "Force a full rescan of wiki pages and regenerate registry, backlinks, index, and log files.",
    promptSnippet: "Force-rescan the wiki and rebuild generated metadata files",
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
      const root = await resolveWikiRoot(ctx.cwd);
      return withRootLock(root, async () => {
        const rebuilt = await rebuildAllGeneratedArtifacts(root);
        return {
          content: [{ type: "text", text: `Rebuilt metadata for ${root}` }],
          details: { rebuilt },
        };
      });
    },
  });

  pi.registerCommand("wiki-status", {
    description: "Show a short llm-wiki status summary",
    handler: async (_args, ctx) => {
      const root = await resolveWikiRoot(ctx.cwd);
      const status = await buildStatus(root);
      ctx.ui.notify(formatStatus(status), "info");
    },
  });

  pi.registerCommand("wiki-lint", {
    description: "Run llm-wiki mechanical lint. Usage: /wiki-lint [mode]",
    handler: async (args, ctx) => {
      const root = await resolveWikiRoot(ctx.cwd);
      const mode = (args?.trim() || "all") as Parameters<typeof runLint>[1];
      const result = await runLint(root, mode, true, 50);
      ctx.ui.notify(formatLint(result), result.counts.total === 0 ? "info" : "warning");
    },
  });

  pi.registerCommand("wiki-rebuild", {
    description: "Force a full llm-wiki metadata rebuild",
    handler: async (_args, ctx) => {
      const root = await resolveWikiRoot(ctx.cwd);
      await withRootLock(root, async () => {
        await rebuildAllGeneratedArtifacts(root);
      });
      ctx.ui.notify("llm-wiki metadata rebuilt", "info");
    },
  });
}

async function withRootLock<T>(root: string, task: () => Promise<T>): Promise<T> {
  return withFileMutationQueue(lockPath(root), task);
}

async function rebuildAllGeneratedArtifacts(root: string): Promise<string[]> {
  const config = await loadConfig(root);
  const { rebuilt } = await rebuildRegistryAndIndex(root);
  const logPath = await rebuildLog(root, config.title);
  return [...rebuilt, logPath];
}

async function loadRegistry(root: string): Promise<RegistryData> {
  try {
    const raw = await readFile(metaPath(root, "registry.json"), "utf8");
    return JSON.parse(raw) as RegistryData;
  } catch {
    const rebuilt = await rebuildRegistryAndIndex(root);
    return rebuilt.registry;
  }
}

async function buildStatus(root: string): Promise<StatusSummary> {
  const registry = await loadRegistry(root);
  const events = await readEvents(root);
  const totals = {
    allPages: registry.pages.length,
    source: registry.pages.filter((page) => page.type === "source").length,
    concept: registry.pages.filter((page) => page.type === "concept").length,
    entity: registry.pages.filter((page) => page.type === "entity").length,
    synthesis: registry.pages.filter((page) => page.type === "synthesis").length,
    analysis: registry.pages.filter((page) => page.type === "analysis").length,
  };
  const sources = registry.pages.filter((page) => page.type === "source");
  const captured = sources.filter((page) => page.status === "captured").length;
  const integrated = sources.filter((page) => page.status === "integrated").length;

  return {
    totals,
    sources: {
      captured,
      integrated,
      unintegrated: captured,
    },
    lastCapture: [...events].reverse().find((event) => event.kind === "capture")?.ts,
    lastEvent: events.at(-1)?.ts,
  };
}

function formatSearch(result: Awaited<ReturnType<typeof searchRegistry>>): string {
  if (result.matches.length === 0) return `No wiki matches for: ${result.query}`;
  return [
    `Top matches for: ${result.query}`,
    ...result.matches.map((match) => `- [${match.score}] ${match.title} (${match.type}) — ${match.path}`),
  ].join("\n");
}

function formatEnsurePage(result: { resolved: boolean; created: boolean; conflict: boolean; path?: string; title?: string; candidates?: Array<{ path: string; title: string }> }): string {
  if (result.conflict) {
    return `Conflict: multiple pages matched. Candidates: ${(result.candidates ?? []).map((candidate) => candidate.path).join(", ")}`;
  }
  if (!result.resolved) return "No matching page found.";
  if (result.created) return `Created page: ${result.path}`;
  return `Resolved existing page: ${result.path}`;
}

function formatLint(result: Awaited<ReturnType<typeof runLint>>): string {
  return [
    `Lint mode: ${result.mode}`,
    `Total issues: ${result.counts.total}`,
    `brokenLinks=${result.counts.brokenLinks} orphans=${result.counts.orphans} frontmatter=${result.counts.frontmatter}`,
    `duplicates=${result.counts.duplicates} coverage=${result.counts.coverage} staleness=${result.counts.staleness}`,
    ...(result.reportPath ? [`Report: ${result.reportPath}`] : []),
  ].join("\n");
}

function formatStatus(status: StatusSummary): string {
  return [
    `Pages: ${status.totals.allPages} total (${status.totals.source} source, ${status.totals.concept} concept, ${status.totals.entity} entity, ${status.totals.synthesis} synthesis, ${status.totals.analysis} analysis)`,
    `Sources: ${status.sources.captured} captured, ${status.sources.integrated} integrated, ${status.sources.unintegrated} unintegrated`,
    ...(status.lastCapture ? [`Last capture: ${status.lastCapture}`] : []),
    ...(status.lastEvent ? [`Last event: ${status.lastEvent}`] : []),
  ].join("\n");
}
