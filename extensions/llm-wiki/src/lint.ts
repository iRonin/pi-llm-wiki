import { writeFile } from "node:fs/promises";
import { buildBacklinks, buildRegistry, scanWikiPages } from "./indexer.ts";
import { metaPath, normalizeWikiLinkTarget } from "./paths.ts";
import type { BacklinksData, LintIssue, LintRun, ParsedPage, RegistryData } from "./types.ts";

const SOURCE_REQUIRED = [
  "id",
  "type",
  "title",
  "status",
  "captured_at",
  "origin_type",
  "origin_value",
  "manifest_path",
  "raw_path",
  "source_ids",
] as const;

const CANONICAL_REQUIRED = ["id", "type", "title", "status", "updated", "source_ids", "summary"] as const;

export async function runLint(root: string, mode: string, writeReport = false, limit?: number): Promise<LintRun> {
  const pages = await scanWikiPages(root);
  const registry = buildRegistry(pages);
  const backlinks = buildBacklinks(registry);

  const allIssues: LintIssue[] = [];

  if (mode === "links" || mode === "all") allIssues.push(...lintLinks(pages, registry));
  if (mode === "orphans" || mode === "all") allIssues.push(...lintOrphans(registry, backlinks));
  if (mode === "frontmatter" || mode === "all") allIssues.push(...lintFrontmatter(pages));
  if (mode === "duplicates" || mode === "all") allIssues.push(...lintDuplicates(registry));
  if (mode === "coverage" || mode === "all") allIssues.push(...lintCoverage(registry, backlinks));
  if (mode === "staleness" || mode === "all") allIssues.push(...lintStaleness(registry));

  const issues = typeof limit === "number" ? allIssues.slice(0, limit) : allIssues;
  const run: LintRun = {
    mode,
    counts: {
      total: allIssues.length,
      brokenLinks: allIssues.filter((issue) => issue.kind === "broken-link").length,
      orphans: allIssues.filter((issue) => issue.kind === "orphan").length,
      frontmatter: allIssues.filter((issue) => issue.kind === "frontmatter").length,
      duplicates: allIssues.filter((issue) => issue.kind === "duplicate").length,
      coverage: allIssues.filter((issue) => issue.kind === "coverage").length,
      staleness: allIssues.filter((issue) => issue.kind === "staleness").length,
    },
    issues,
  };

  if (writeReport) {
    const reportPath = metaPath(root, "lint-report.md");
    await writeFile(reportPath, renderLintReport(run), "utf8");
    run.reportPath = "meta/lint-report.md";
  }

  return run;
}

export function renderLintReport(run: LintRun): string {
  const lines: string[] = [
    "# Lint Report",
    "",
    `Mode: ${run.mode}`,
    `Total issues: ${run.counts.total}`,
    `Generated: ${new Date().toISOString()}`,
    "",
    "## Counts",
    "",
    `- brokenLinks: ${run.counts.brokenLinks}`,
    `- orphans: ${run.counts.orphans}`,
    `- frontmatter: ${run.counts.frontmatter}`,
    `- duplicates: ${run.counts.duplicates}`,
    `- coverage: ${run.counts.coverage}`,
    `- staleness: ${run.counts.staleness}`,
    "",
    "## Issues",
    "",
  ];

  if (run.issues.length === 0) {
    lines.push("_No issues found._");
  } else {
    for (const issue of run.issues) {
      lines.push(`- **${issue.severity}** [${issue.kind}] \`${issue.path}\` — ${issue.message}`);
    }
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

function lintLinks(pages: ParsedPage[], registry: RegistryData): LintIssue[] {
  const known = new Set(registry.pages.map((page) => page.path));
  const issues: LintIssue[] = [];

  for (const page of pages) {
    for (const rawLink of page.rawLinks) {
      const normalized = normalizeWikiLinkTarget(rawLink);
      if (!normalized) {
        issues.push({
          kind: "broken-link",
          severity: "warning",
          path: page.relativePath,
          message: `Link is not folder-qualified or cannot be normalized: [[${rawLink}]]`,
        });
        continue;
      }
      if (!known.has(normalized)) {
        issues.push({
          kind: "broken-link",
          severity: "error",
          path: page.relativePath,
          message: `Target does not exist: [[${rawLink}]]`,
        });
      }
    }
  }

  return issues;
}

function lintOrphans(registry: RegistryData, backlinks: BacklinksData): LintIssue[] {
  return registry.pages
    .filter((page) => page.type !== "source")
    .flatMap((page) => {
      const record = backlinks.byPath[page.path];
      if (!record) return [];
      if (record.inbound.length === 0 && record.outbound.length === 0) {
        return [
          {
            kind: "orphan",
            severity: "warning",
            path: page.path,
            message: "Canonical page has no inbound or outbound wiki links.",
          } satisfies LintIssue,
        ];
      }
      return [];
    });
}

function lintFrontmatter(pages: ParsedPage[]): LintIssue[] {
  const issues: LintIssue[] = [];
  for (const page of pages) {
    const required = page.frontmatter.type === "source" ? SOURCE_REQUIRED : CANONICAL_REQUIRED;
    for (const field of required) {
      if (!Object.prototype.hasOwnProperty.call(page.frontmatter, field)) {
        issues.push({
          kind: "frontmatter",
          severity: "error",
          path: page.relativePath,
          message: `Missing required frontmatter field: ${field}`,
        });
      }
    }
  }
  return issues;
}

function lintDuplicates(registry: RegistryData): LintIssue[] {
  const issues: LintIssue[] = [];
  const seenTitles = new Map<string, string>();
  const seenAliases = new Map<string, string>();
  const seenIds = new Map<string, string>();

  for (const page of registry.pages.filter((entry) => entry.type !== "source")) {
    const normalizedTitle = page.title.trim().toLowerCase();
    if (seenTitles.has(normalizedTitle)) {
      issues.push({
        kind: "duplicate",
        severity: "warning",
        path: page.path,
        message: `Duplicate title also used by ${seenTitles.get(normalizedTitle)}`,
      });
    } else {
      seenTitles.set(normalizedTitle, page.path);
    }

    if (seenIds.has(page.id)) {
      issues.push({
        kind: "duplicate",
        severity: "error",
        path: page.path,
        message: `Duplicate id also used by ${seenIds.get(page.id)}`,
      });
    } else {
      seenIds.set(page.id, page.path);
    }

    for (const alias of page.aliases) {
      const normalizedAlias = alias.trim().toLowerCase();
      if (!normalizedAlias) continue;
      if (seenAliases.has(normalizedAlias)) {
        issues.push({
          kind: "duplicate",
          severity: "warning",
          path: page.path,
          message: `Duplicate alias "${alias}" also used by ${seenAliases.get(normalizedAlias)}`,
        });
      } else {
        seenAliases.set(normalizedAlias, page.path);
      }
    }
  }

  return issues;
}

function lintCoverage(registry: RegistryData, backlinks: BacklinksData): LintIssue[] {
  const issues: LintIssue[] = [];
  for (const page of registry.pages) {
    if (page.type === "source") {
      const inbound = backlinks.byPath[page.path]?.inbound ?? [];
      const citedByCanonical = inbound.filter((path) => !path.includes("/sources/") && path !== page.path);
      if (citedByCanonical.length === 0) {
        issues.push({
          kind: "coverage",
          severity: "info",
          path: page.path,
          message: "Source page is not cited by any canonical page yet.",
        });
      }
      continue;
    }

    if (page.sourceIds.length === 0) {
      issues.push({
        kind: "coverage",
        severity: "warning",
        path: page.path,
        message: "Canonical page has no source_ids listed.",
      });
    }
  }
  return issues;
}

function lintStaleness(registry: RegistryData): LintIssue[] {
  return registry.pages.flatMap((page) => {
    if (page.type === "source" && page.status === "captured") {
      return [
        {
          kind: "staleness",
          severity: "info",
          path: page.path,
          message: "Source page is still in captured state and has not been marked integrated.",
        } satisfies LintIssue,
      ];
    }
    return [];
  });
}
