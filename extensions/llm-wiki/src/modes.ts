import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Api, Model } from "@mariozechner/pi-ai";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Mirror of pi-agent-core's ThinkingLevel. Defined locally so we don't
 * need a direct import from a peer of a peer.
 */
export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

export interface ModeConfig {
  /** Model spec: "provider/model-id" or bare "model-id" for fuzzy match. */
  model: string;
  thinking: ThinkingLevel;
}

export interface WikiModes {
  researcher: ModeConfig;
  worker: ModeConfig;
}

/** In-memory snapshot of the model + thinking level before any wiki mode switch. */
export interface SavedMainMode {
  provider: string;
  modelId: string;
  thinking: ThinkingLevel;
}

/**
 * Classify a wiki tool call as requiring researcher, worker, or no switch.
 * Grunt/deterministic tools (lint, search, rebuild, status, log) get the
 * worker model for the turn(s) that process their results.
 * LLM-heavy tools (capture, ensure_page) get the researcher model.
 */
export type ToolClass = "researcher" | "worker" | "none";

const WORKER_TOOLS = new Set([
  "wiki_lint",
  "wiki_rebuild_meta",
  "wiki_status",
  "wiki_search",
  "wiki_log_event",
]);

const RESEARCHER_TOOLS = new Set([
  "wiki_capture_source",
  "wiki_ensure_page",
]);

export function classifyTool(toolName: string): ToolClass {
  if (RESEARCHER_TOOLS.has(toolName)) return "researcher";
  if (WORKER_TOOLS.has(toolName)) return "worker";
  return "none";
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const MODES_PATH = join(".wiki", "modes.json");

const THINKING_LEVELS = new Set<string>(["off", "minimal", "low", "medium", "high", "xhigh"]);

export const EXAMPLE_MODES: WikiModes = {
  researcher: { model: "anthropic/claude-opus-4-5", thinking: "high" },
  worker: { model: "anthropic/claude-sonnet-4-5", thinking: "medium" },
};

// ---------------------------------------------------------------------------
// Config I/O
// ---------------------------------------------------------------------------

function isThinkingLevel(v: unknown): v is ThinkingLevel {
  return typeof v === "string" && THINKING_LEVELS.has(v);
}

function parseModeConfig(v: unknown): ModeConfig | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const c = v as Record<string, unknown>;
  if (typeof c["model"] !== "string" || !c["model"].trim()) return null;
  if (!isThinkingLevel(c["thinking"])) return null;
  return { model: c["model"].trim(), thinking: c["thinking"] };
}

function parseWikiModes(raw: unknown): WikiModes | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const researcher = parseModeConfig(r["researcher"]);
  const worker = parseModeConfig(r["worker"]);
  if (!researcher || !worker) return null;
  return { researcher, worker };
}

// Per-root cache so we don't stat the file on every tool_call.
const modesCache = new Map<string, WikiModes | null>();

export function clearModesCache(): void {
  modesCache.clear();
}

export async function loadModes(root: string, bustCache = false): Promise<WikiModes | null> {
  if (!bustCache && modesCache.has(root)) return modesCache.get(root) ?? null;
  try {
    const text = await readFile(join(root, MODES_PATH), "utf8");
    const result = parseWikiModes(JSON.parse(text));
    modesCache.set(root, result);
    return result;
  } catch {
    modesCache.set(root, null);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Model resolution
// ---------------------------------------------------------------------------

/**
 * Resolve a model spec ("provider/model-id" or bare "model-id") against the
 * full model registry.
 *
 * Lookup order:
 * 1. Exact id match
 * 2. Prefix match — when multiple models share the prefix the shortest id wins
 *    (closest to what the user specified, avoids picking a future versioned id).
 */
export function resolveModel(
  allModels: Model<Api>[],
  spec: string,
): Model<Api> | undefined {
  const slash = spec.indexOf("/");

  if (slash === -1) {
    const exact = allModels.find((m) => m.id === spec);
    if (exact) return exact;
    return allModels
      .filter((m) => m.id.startsWith(spec))
      .sort((a, b) => a.id.length - b.id.length)[0];
  }

  const provider = spec.slice(0, slash);
  const modelId = spec.slice(slash + 1);
  const exact = allModels.find((m) => m.provider === provider && m.id === modelId);
  if (exact) return exact;
  return allModels
    .filter((m) => m.provider === provider && m.id.startsWith(modelId))
    .sort((a, b) => a.id.length - b.id.length)[0];
}

// ---------------------------------------------------------------------------
// UI helpers
// ---------------------------------------------------------------------------

export function formatModesHelp(modes: WikiModes | null): string {
  if (!modes) {
    return [
      "No .wiki/modes.json found. Create it to configure wiki modes:",
      "",
      JSON.stringify(EXAMPLE_MODES, null, 2),
      "",
      "Place it at .wiki/modes.json in your wiki root, then run /wiki-grunt or /wiki-research.",
    ].join("\n");
  }
  return [
    `researcher → ${modes.researcher.model} / thinking:${modes.researcher.thinking}`,
    `worker     → ${modes.worker.model} / thinking:${modes.worker.thinking}`,
  ].join("\n");
}
