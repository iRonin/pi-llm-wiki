---
name: llm-wiki
description: Maintain a persistent interlinked markdown wiki from raw sources. Use when capturing a new source, integrating it into source/concept/entity/synthesis pages, answering questions from the wiki, filing durable analyses, or running semantic wiki audits.
---

# LLM Wiki

You are maintaining a persistent markdown wiki with four layers:

1. raw capture (`raw/`) — immutable source packets
2. wiki pages (`wiki/`) — editable knowledge pages
3. meta (`meta/`) — generated registry, backlinks, index, logs, and reports
4. schema (`WIKI_SCHEMA.md`, `.wiki/config.json`) — operating rules

Your job is not to treat this like ad hoc note-taking. Your job is to maintain it like a small knowledge system with provenance, structure, and evolving synthesis.

## Non-negotiable rules

1. **Never directly edit `raw/**`.**
   - Use `wiki_capture_source` to add sources.

2. **Never directly edit generated metadata.**
   - Do not manually maintain:
     - `meta/registry.json`
     - `meta/backlinks.json`
     - `meta/index.md`
     - `meta/log.md`
     - `meta/events.jsonl`
     - `meta/lint-report.md`

3. **Every source must become a source page before it influences canonical knowledge.**
   - Read `wiki/sources/SRC-*.md` before updating concepts, entities, or syntheses from that source.
   - If the source page is weak or incomplete, improve it first.

4. **Prefer updating existing pages over creating new ones.**
   - Search first with `wiki_search`.
   - Resolve or create safely with `wiki_ensure_page`.

5. **Use folder-qualified wikilinks for internal navigation.**
   - Example: `[[concepts/retrieval-augmented-generation]]`

6. **Cite factual claims using stable source page ID links.**
   - Example: `[[sources/SRC-2026-04-04-001|SRC-2026-04-04-001]]`
   - Do not cite raw packet files directly in canonical pages.

7. **Keep uncertainty visible.**
   - If evidence is mixed, incomplete, speculative, or contradicted, write that into `Tensions / caveats`, `Reliability / caveats`, or `Open questions`.
   - Do not collapse ambiguity into false certainty.

8. **Query mode is read-only by default.**
   - Only file a new analysis page if explicitly asked, or if the user clearly wants durable answers filed into the wiki.

## Required startup reads

When this skill is loaded:
1. Read `WIKI_SCHEMA.md`
2. Read `.wiki/config.json`
3. Read `meta/index.md` or use `wiki_search`
4. Read relevant pages before editing

## Page taxonomy

- `wiki/sources/` = what an individual source says
- `wiki/concepts/` = what a concept means in this wiki
- `wiki/entities/` = facts and relationships about a thing
- `wiki/syntheses/` = cross-source theses, tensions, and evolving conclusions
- `wiki/analyses/` = durable filed answers from queries

## Source-page standard

A source page should answer:
- What is this source?
- What does it claim?
- What concrete details, observations, or data points matter?
- Which entities and concepts does it touch?
- How reliable, narrow, speculative, or biased is it?
- Which canonical pages should change because of it?

When completing or refining a source page, prefer filling these sections in order:
1. `Source at a glance`
2. `Executive summary`
3. `Main claims`
4. `Important details and data points`
5. `Entities and concepts mentioned`
6. `Reliability / caveats`
7. `Integration targets`
8. `Open questions`
9. `Related pages`

## Integration discipline

When integrating a source into canonical pages:
1. Read the source page first.
2. Use `wiki_search` to find likely existing pages.
3. Use `wiki_ensure_page` before creating any new concept/entity/synthesis/analysis page.
4. Touch only pages that are clearly affected.
5. Add source citations near the factual claim, not only once at the bottom.
6. Prefer small, targeted edits over sweeping rewrites.
7. If the source is weak, say so explicitly instead of giving it equal weight.

## Workflow: capture

When the user provides a new URL, file, or text source:
1. Use `wiki_capture_source`
2. Read the created source page and extracted content
3. Improve the source page first
4. Identify impacted canonical pages
5. Update only the relevant pages
6. Record integration with `wiki_log_event` when appropriate

## Workflow: integrate

When integrating a captured source:
1. Read the source page first
2. Search for existing relevant concept/entity/synthesis pages
3. Use `wiki_ensure_page` before creating any new canonical page
4. Make bounded updates
5. Add links and source citations
6. Preserve section structure
7. Mark completed integration with `wiki_log_event` using `kind=integrate`

## Workflow: query

When answering a question:
1. Search first with `wiki_search`
2. Read the most relevant pages
3. Synthesize an answer grounded in the wiki
4. Cite source page IDs for factual claims
5. Do not modify the wiki unless asked to file the answer or instructed to do so

If the answer should become durable knowledge, file it into `wiki/analyses/` and link it to the relevant concepts/entities/syntheses.

## Workflow: semantic audit

When asked to audit or health-check the wiki:
1. Optionally run `wiki_lint` for mechanical issues
2. Then look for semantic issues:
   - contradictions
   - overgeneralizations
   - stale theses
   - missing canonical pages
   - pages that should be split or merged
   - pages whose confidence exceeds the underlying evidence
3. Report tensions clearly instead of silently resolving them

## Editing rules

- Keep frontmatter valid
- Preserve required section headings
- Prefer small, targeted edits
- Avoid duplicate pages and duplicate aliases
- Do not rename source page files
- If a page is genuinely disputed, use `status: contested`
- If a source is captured but not yet integrated, leave that state visible until integration is complete
