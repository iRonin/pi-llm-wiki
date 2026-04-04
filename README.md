# pi-llm-wiki

> Inspired by Andrej Karpathy’s “LLM Wiki” gist: https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f  
> This package is a Pi-native implementation of that idea.

[![CI](https://github.com/Kausik-A/pi-llm-wiki/actions/workflows/ci.yml/badge.svg)](https://github.com/Kausik-A/pi-llm-wiki/actions/workflows/ci.yml)
[![GitHub Release](https://img.shields.io/github/v/release/Kausik-A/pi-llm-wiki?display_name=tag)](https://github.com/Kausik-A/pi-llm-wiki/releases)
[![npm version](https://img.shields.io/npm/v/pi-llm-wiki)](https://www.npmjs.com/package/pi-llm-wiki)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)

Build a **persistent, LLM-maintained markdown wiki** inside [pi](https://pi.dev) with immutable source capture, interlinked knowledge pages, generated navigation metadata, and a bundled wiki-maintainer skill.

`pi-llm-wiki` implements the “LLM wiki” pattern as a Pi-native package:

- a **Pi extension** for deterministic operations, guardrails, and generated metadata
- a bundled **`llm-wiki` skill** that teaches the model how to maintain the wiki
- a markdown vault structure that accumulates knowledge over time instead of re-deriving it from raw files on every query

## Why this package exists

Most file-based LLM workflows behave like one-shot RAG: the model searches raw documents every time you ask a question. That works, but the synthesis is ephemeral.

`pi-llm-wiki` creates a middle layer:

- **raw source packets** preserve source-of-truth inputs
- **source pages** summarize what each source says
- **canonical wiki pages** track what the wiki currently believes
- **generated metadata** keeps the whole vault searchable and navigable

The result is a wiki that compounds as you capture sources, ask questions, and file durable analyses.

## Features

- **Wiki bootstrap** — initialize a new vault with config, templates, schema, and metadata files
- **Immutable source capture** — capture URLs, local files, PDFs, or pasted text into `raw/` packets
- **Source-page boundary** — every source becomes a source page before it influences canonical knowledge
- **Canonical page management** — safely resolve or create concept, entity, synthesis, and analysis pages
- **Generated metadata** — rebuilds `meta/registry.json`, `meta/backlinks.json`, `meta/index.md`, and `meta/log.md`
- **Mechanical linting** — broken links, orphan pages, duplicate aliases/titles, frontmatter issues, coverage gaps, stale captures
- **Operational guardrails** — blocks direct edits to raw sources and generated metadata files
- **Bundled skill** — teaches the model how to capture, integrate, query, and audit the wiki
- **Obsidian-friendly links** — folder-qualified wikilinks plus stable source-ID citations

## Architecture

The vault has four logical layers:

1. **Raw capture** — immutable source packets in `raw/`
2. **Wiki pages** — source pages and canonical pages in `wiki/`
3. **Meta** — generated registry, backlinks, index, event log, and lint report in `meta/`
4. **Schema** — human/model operating rules in `WIKI_SCHEMA.md` and `.wiki/config.json`

### Ownership model

| Path | Owner | Rule |
|------|-------|------|
| `raw/**` | extension tools | immutable after capture |
| `wiki/**` | model + user | editable knowledge pages |
| `meta/registry.json` | extension | generated |
| `meta/backlinks.json` | extension | generated |
| `meta/index.md` | extension | generated |
| `meta/events.jsonl` | extension/tool | append-only |
| `meta/log.md` | extension | generated from events |
| `meta/lint-report.md` | extension | generated |
| `WIKI_SCHEMA.md` | human + explicit request | operating manual |

## Install

From npm:

```bash
pi install npm:pi-llm-wiki
```

From GitHub:

```bash
pi install https://github.com/Kausik-A/pi-llm-wiki
```

Try it without installing:

```bash
pi -e https://github.com/Kausik-A/pi-llm-wiki
```

## Quick start

### 1) Create a new wiki repo or folder

```bash
mkdir my-wiki
cd my-wiki
pi
```

### 2) Bootstrap the vault

Ask pi:

```text
Initialize an llm wiki here for AI research.
```

That should call `wiki_bootstrap` and create:

```text
raw/
wiki/
meta/
.wiki/
WIKI_SCHEMA.md
```

### 3) Capture a source

Examples:

```text
Capture this article into the wiki: https://example.com/some-article
```

```text
Capture this PDF into the wiki: ./papers/context-windows.pdf
```

```text
Capture these notes into the wiki: ...pasted text...
```

### 4) Integrate the source

A good integration flow is:

1. capture the source
2. read `wiki/sources/SRC-*.md`
3. update that source page
4. search for impacted canonical pages with `wiki_search`
5. create missing pages with `wiki_ensure_page`
6. update concept/entity/synthesis pages with citations
7. mark the integration with `wiki_log_event kind=integrate`

### 5) Query the wiki

```text
Based on the wiki, what are the main tradeoffs between long-context models and RAG?
```

By default, the bundled skill treats query mode as **read-only**.

If you want a durable answer filed back into the vault:

```text
Answer the question and file the result as an analysis page.
```

## Vault layout

```text
my-wiki/
├─ raw/
│  └─ sources/
│     └─ SRC-2026-04-04-001/
│        ├─ manifest.json
│        ├─ original/
│        ├─ extracted.md
│        └─ attachments/
├─ wiki/
│  ├─ sources/
│  ├─ concepts/
│  ├─ entities/
│  ├─ syntheses/
│  └─ analyses/
├─ meta/
│  ├─ registry.json
│  ├─ backlinks.json
│  ├─ index.md
│  ├─ events.jsonl
│  ├─ log.md
│  └─ lint-report.md
├─ .wiki/
│  ├─ config.json
│  └─ templates/
└─ WIKI_SCHEMA.md
```

## Linking and citation style

### Internal navigation

Use folder-qualified wikilinks:

```md
[[concepts/retrieval-augmented-generation]]
[[entities/openai|OpenAI]]
[[syntheses/long-context-vs-rag]]
```

### Factual citations

Use stable source page ID links:

```md
[[sources/SRC-2026-04-04-001|SRC-2026-04-04-001]]
```

This keeps provenance stable even if titles or page summaries change.

## Tools

| Tool | Description |
|------|-------------|
| `wiki_bootstrap` | Initialize the vault structure, config, templates, schema, and metadata files |
| `wiki_capture_source` | Capture a URL, file, or pasted text into an immutable source packet and create a source page |
| `wiki_search` | Search the generated wiki registry |
| `wiki_ensure_page` | Resolve or safely create canonical concept/entity/synthesis/analysis pages |
| `wiki_lint` | Run deterministic health checks over the wiki |
| `wiki_status` | Show counts, source states, and recent activity |
| `wiki_log_event` | Append structured events and regenerate `meta/log.md` |
| `wiki_rebuild_meta` | Force a full metadata rebuild |

## Commands

| Command | Description |
|---------|-------------|
| `/wiki-status` | Show a concise operational summary |
| `/wiki-lint [mode]` | Run mechanical lint (`all`, `links`, `orphans`, `frontmatter`, `duplicates`, `coverage`, `staleness`) |
| `/wiki-rebuild` | Force a full metadata rebuild |

## Guardrails

The extension blocks direct edits to:

- `raw/**`
- `meta/registry.json`
- `meta/backlinks.json`
- `meta/events.jsonl`
- `meta/index.md`
- `meta/log.md`
- `meta/lint-report.md`

If the model directly edits `wiki/**` using Pi’s built-in `write` or `edit` tools, `pi-llm-wiki` automatically rebuilds generated metadata at the end of the agent turn.

## Source packet format

Each captured source is stored as a packet:

```text
raw/sources/SRC-YYYY-MM-DD-NNN/
├─ manifest.json
├─ original/
├─ extracted.md
└─ attachments/
```

This lets you preserve:

- the original artifact
- normalized extracted text for reading
- capture metadata
- future attachment downloads

## Page model

### Source pages
`wiki/sources/SRC-*.md`

These answer: **what does this specific source say?**

### Canonical pages
- `wiki/concepts/` — concepts and recurring ideas
- `wiki/entities/` — people, orgs, products, papers, systems
- `wiki/syntheses/` — cross-source theses and tensions
- `wiki/analyses/` — durable filed answers from queries

These answer: **what does the wiki currently believe?**

## Skill behavior

The bundled `llm-wiki` skill teaches Pi to:

- never edit raw sources directly
- treat generated metadata as machine-owned
- capture first, integrate second
- search before creating new canonical pages
- cite facts using source-page IDs
- keep query mode read-only by default
- use `Tensions / caveats` and `Open questions` when evidence is mixed

## Versioning and releases

This package uses **Semantic Versioning** and includes a release/tag flow built for repeatable publishes.

### Release flow

1. Add notes under `## [Unreleased]` in [`CHANGELOG.md`](./CHANGELOG.md)
2. Run one of:

```bash
npm run release:patch
npm run release:minor
npm run release:major
```

This will:
- verify the git working tree is clean
- verify you are on `main`
- run `npm run check`
- bump the package version
- move `Unreleased` notes into a dated version section in `CHANGELOG.md`
- create a release commit
- create a matching git tag like `v0.1.1`

3. Push the release commit and tag:

```bash
npm run release:push
```

4. GitHub Actions publishes the tagged version to npm and creates a GitHub Release.

### GitHub Actions

This repo includes:

- **CI** on push and pull request: runs `npm ci`, `npm run check`, and `npm pack --dry-run`
- **Release** on `v*` tags: runs checks, publishes to npm, and creates a GitHub release with generated notes

For a fuller walkthrough, see [`RELEASING.md`](./RELEASING.md).

### First-time npm publishing checklist

Before the first automated release, do this once:

1. Ensure the npm package name is available:

```bash
npm view pi-llm-wiki version
```

2. Log in locally if you want to do a manual first publish:

```bash
npm login
```

3. Create an npm automation token in npm:
   - npmjs.com → Account Settings → Access Tokens
   - Create a token with publish permission for `pi-llm-wiki`

4. Add the token as a GitHub repository secret:

```bash
gh secret set NPM_TOKEN --repo Kausik-A/pi-llm-wiki
```

5. Optionally do the first release manually:

```bash
npm run check
npm publish --access public
```

6. After that, use the release/tag flow for future versions.

### Required repository secret

To enable npm publishing from GitHub Actions, add this repository secret:

- `NPM_TOKEN` — an npm access token with publish permissions for `pi-llm-wiki`

### Manual fallback publish

If you ever need to publish manually:

```bash
npm run check
npm publish --access public
```

Then users can update with:

```bash
pi update
```

## Local development

Install locally for testing:

```bash
pi install ./pi-llm-wiki
```

Load only the extension for one-off testing:

```bash
pi -e ./pi-llm-wiki/extensions/llm-wiki/index.ts
```

Sanity-check the package:

```bash
cd pi-llm-wiki
npm run check
```

## Notes

- For PDFs and some binary formats, the extension tries `uvx --from 'markitdown[pdf]' markitdown ...` when available.
- If `markitdown` is unavailable, capture falls back to simpler text or placeholder extraction.
- v1 intentionally avoids embeddings and vector databases; the **wiki itself** is the main retrieval layer.

## License

MIT
