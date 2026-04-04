import { mkdir, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { createDefaultConfig, hasWikiConfig, writeDefaultConfig } from "./config.ts";
import { readTemplate, renderTemplate, writePage } from "./frontmatter.ts";
import { canonicalPagePath, metaPath, toRelative } from "./paths.ts";
import { dedupeSlug, makePageId, slugifyTitle, todayStamp } from "./slug.ts";
import type { EnsurePageParams, EnsurePageResult, RegistryData, WikiConfig } from "./types.ts";

export const DEFAULT_SOURCE_TEMPLATE = `---
id: {{id}}
type: source
title: {{title}}
kind: {{kind}}
status: captured
captured_at: {{captured_at}}
integrated_at:
origin_type: {{origin_type}}
origin_value: {{origin_value}}
manifest_path: {{manifest_path}}
raw_path: {{raw_path}}
aliases: []
tags: []
source_ids:
  - {{id}}
summary:
---

# {{title}}

## Source at a glance
- Source ID: {{id}}
- Kind: {{kind}}
- Captured: {{captured_at}}
- Origin: {{origin_type}} — {{origin_value}}

## Executive summary

## Main claims
- Claim:
  - Support in source:
  - Caveat:

## Important details and data points

## Entities and concepts mentioned
### Entities

### Concepts

## Reliability / caveats

## Integration targets
- Candidate concept pages:
- Candidate entity pages:
- Candidate synthesis pages:

## Open questions

## Related pages
`;

export const DEFAULT_CONCEPT_TEMPLATE = `---
id: {{id}}
type: concept
title: {{title}}
aliases: []
tags: []
status: draft
updated: {{updated}}
source_ids: []
summary:
---

# {{title}}

## Current understanding

## Key distinctions

## Supporting evidence

## Tensions / caveats

## Open questions

## Related pages
`;

export const DEFAULT_ENTITY_TEMPLATE = `---
id: {{id}}
type: entity
title: {{title}}
aliases: []
tags: []
status: draft
updated: {{updated}}
source_ids: []
summary:
---

# {{title}}

## Who / what

## Relationships

## Supporting evidence

## Tensions / caveats

## Open questions

## Related pages
`;

export const DEFAULT_SYNTHESIS_TEMPLATE = `---
id: {{id}}
type: synthesis
title: {{title}}
aliases: []
tags: []
status: draft
updated: {{updated}}
source_ids: []
summary:
---

# {{title}}

## Current thesis

## Why this seems true

## Counterevidence / disagreement

## Decision boundary

## Unknowns

## Related pages
`;

export const DEFAULT_ANALYSIS_TEMPLATE = `---
id: {{id}}
type: analysis
title: {{title}}
aliases: []
tags: []
status: active
updated: {{updated}}
source_ids: []
summary:
---

# {{title}}

## Question

## Answer

## Evidence used

## Follow-up opportunities
`;

export function defaultSchemaMarkdown(title: string, domain = "General"): string {
  return `# ${title} Wiki Schema

This wiki is maintained as a persistent LLM-authored knowledge base for **${domain}**.

## Layers

1. **raw/** - immutable source capture packets
2. **wiki/** - editable source pages and canonical knowledge pages
3. **meta/** - generated registry, backlinks, index, logs, and reports
4. **schema** - this file and .wiki/config.json

## Non-negotiable rules

- Never directly edit raw/**.
- Never hand-maintain generated metadata under meta/**.
- Every source must become a source page before it influences canonical pages.
- Update existing canonical pages before creating new ones.
- Use folder-qualified wikilinks such as [[concepts/example-topic]].
- Cite factual claims with source page ID links such as [[sources/SRC-YYYY-MM-DD-NNN|SRC-YYYY-MM-DD-NNN]].
- Query mode is read-only by default; file durable answers deliberately into wiki/analyses/.
- Use Tensions / caveats and Open questions whenever evidence is uncertain.

## Page Taxonomy

- wiki/sources/ = what one source says
- wiki/concepts/ = stable concepts tracked over time
- wiki/entities/ = people, orgs, products, papers, etc.
- wiki/syntheses/ = cross-source theses and unresolved tensions
- wiki/analyses/ = durable filed answers from queries

## Source-page standard

Every source page should answer these questions:
- What is this source?
- What are its main claims?
- What concrete details or data points matter?
- Which concepts and entities does it touch?
- How reliable or limited is it?
- Which canonical pages should be updated because of it?

Fill these sections whenever possible:
- Source at a glance
- Executive summary
- Main claims
- Important details and data points
- Entities and concepts mentioned
- Reliability / caveats
- Integration targets
- Open questions

## Workflows

### Capture
1. Use the capture tool to preserve the source packet.
2. Read the extracted content and source page.
3. Improve the source page first.
4. Only then update impacted canonical pages.
5. Log integration when done.

### Query
1. Search the wiki first.
2. Read the most relevant pages.
3. Answer using source page citations.
4. Only create analysis pages if asked or if the result is explicitly worth filing.

### Audit
1. Run deterministic lint for structural issues.
2. Then reason about semantic gaps, contradictions, stale theses, and missing pages.
3. Report tensions before resolving them.
`;
}

export async function bootstrapVault(root: string, title: string, domain?: string, force = false): Promise<string[]> {
  const configPath = join(root, ".wiki", "config.json");
  if (!force && (await hasWikiConfig(root))) {
    throw new Error(`Wiki already appears initialized at ${root}. Use force=true to overwrite scaffold files.`);
  }

  const created = [
    join(root, "raw", "sources"),
    join(root, "wiki", "sources"),
    join(root, "wiki", "concepts"),
    join(root, "wiki", "entities"),
    join(root, "wiki", "syntheses"),
    join(root, "wiki", "analyses"),
    join(root, "meta"),
    join(root, ".wiki", "templates"),
  ];

  for (const dir of created) {
    await mkdir(dir, { recursive: true });
  }

  await writeDefaultConfig(root, title, domain);

  const config = createDefaultConfig(title, domain);
  await writeFile(join(root, config.templates.source), DEFAULT_SOURCE_TEMPLATE, "utf8");
  await writeFile(join(root, config.templates.concept), DEFAULT_CONCEPT_TEMPLATE, "utf8");
  await writeFile(join(root, config.templates.entity), DEFAULT_ENTITY_TEMPLATE, "utf8");
  await writeFile(join(root, config.templates.synthesis), DEFAULT_SYNTHESIS_TEMPLATE, "utf8");
  await writeFile(join(root, config.templates.analysis), DEFAULT_ANALYSIS_TEMPLATE, "utf8");

  await writeFile(join(root, "WIKI_SCHEMA.md"), defaultSchemaMarkdown(title, domain), "utf8");
  await writeFile(metaPath(root, "registry.json"), `${JSON.stringify({ version: 1, generatedAt: new Date().toISOString(), pages: [] }, null, 2)}\n`, "utf8");
  await writeFile(metaPath(root, "backlinks.json"), `${JSON.stringify({ version: 1, generatedAt: new Date().toISOString(), byPath: {} }, null, 2)}\n`, "utf8");
  await writeFile(metaPath(root, "index.md"), `# ${title} Index\n\n_No pages yet._\n`, "utf8");
  await writeFile(metaPath(root, "events.jsonl"), "", "utf8");
  await writeFile(metaPath(root, "log.md"), `# ${title} Log\n\n_No events yet._\n`, "utf8");
  await writeFile(metaPath(root, "lint-report.md"), `# Lint Report\n\n_No lint run yet._\n`, "utf8");

  return [toRelative(root, configPath), ...created.map((dir) => toRelative(root, dir))];
}

export async function ensureCanonicalPage(
  root: string,
  config: WikiConfig,
  registry: RegistryData,
  params: EnsurePageParams,
): Promise<EnsurePageResult> {
  const targetType = params.type;
  const normalizedTitle = params.title.trim().toLowerCase();
  const normalizedAliases = new Set((params.aliases ?? []).map((alias) => alias.trim().toLowerCase()));

  const matches = registry.pages.filter((page) => {
    if (page.type !== targetType) return false;
    const pageNames = [page.title, ...page.aliases].map((value) => value.trim().toLowerCase());
    return (
      pageNames.includes(normalizedTitle) ||
      [...normalizedAliases].some((alias) => pageNames.includes(alias))
    );
  });

  if (matches.length > 1) {
    return {
      resolved: false,
      created: false,
      conflict: true,
      candidates: matches.map((page) => ({ id: page.id, path: page.path, title: page.title, type: page.type })),
    };
  }

  if (matches.length === 1) {
    const page = matches[0];
    return {
      resolved: true,
      created: false,
      conflict: false,
      path: page.path,
      id: page.id,
      title: page.title,
      type: page.type,
    };
  }

  if (!params.createIfMissing) {
    return { resolved: false, created: false, conflict: false };
  }

  const existingSlugs = registry.pages
    .filter((page) => page.type === targetType)
    .map((page) => basename(page.path, ".md").replace(/^\d{4}-\d{2}-\d{2}-/, ""));
  const slug = dedupeSlug(slugifyTitle(params.title), existingSlugs);
  const now = new Date();
  const dateStamp = todayStamp(now);
  const absolutePath = canonicalPagePath(root, targetType, slug, dateStamp);
  const template = await readTemplate(join(root, config.templates[targetType]));
  const id = makePageId(targetType, slug, now);
  const rendered = renderTemplate(template, {
    id,
    title: params.title,
    updated: dateStamp,
  });

  const parsed = {
    id,
    type: targetType,
    title: params.title,
    aliases: params.aliases ?? [],
    tags: params.tags ?? [],
    status: targetType === "analysis" ? "active" : "draft",
    updated: dateStamp,
    source_ids: [],
    summary: params.summary ?? "",
  };

  const frontmatterStart = rendered.indexOf("---\n");
  const secondDelimiter = rendered.indexOf("\n---\n", frontmatterStart + 4);
  const body = secondDelimiter >= 0 ? rendered.slice(secondDelimiter + 5).trimStart() : rendered;

  await writePage(absolutePath, parsed, body);

  return {
    resolved: true,
    created: true,
    conflict: false,
    path: toRelative(root, absolutePath),
    id,
    title: params.title,
    type: targetType,
  };
}
