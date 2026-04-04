import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import matter from "gray-matter";
import { normalizeWikiLinkTarget, toRelative } from "./paths.ts";
import type { ParsedPage } from "./types.ts";

export async function parsePage(root: string, absolutePath: string): Promise<ParsedPage> {
  const raw = await readFile(absolutePath, "utf8");
  const parsed = matter(raw);
  const body = parsed.content.trim();
  const rawLinks = extractWikiLinks(parsed.content);

  return {
    absolutePath,
    relativePath: toRelative(root, absolutePath),
    frontmatter: parsed.data as Record<string, any>,
    body,
    headings: extractHeadings(parsed.content),
    rawLinks,
    normalizedLinks: rawLinks.map((link) => normalizeWikiLinkTarget(link)).filter(Boolean) as string[],
    wordCount: countWords(body),
  };
}

export async function writePage(
  absolutePath: string,
  frontmatterData: Record<string, any>,
  body: string,
): Promise<void> {
  await mkdir(dirname(absolutePath), { recursive: true });
  const content = matter.stringify(body.trimEnd() + "\n", cleanFrontmatter(frontmatterData));
  await writeFile(absolutePath, normalizeTrailingNewline(content), "utf8");
}

export async function readTemplate(path: string): Promise<string> {
  return readFile(path, "utf8");
}

export function renderTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key) => values[key] ?? "");
}

export function extractHeadings(markdown: string): string[] {
  const headings: string[] = [];
  const regex = /^#{1,6}\s+(.+)$/gm;
  for (const match of markdown.matchAll(regex)) {
    headings.push(match[1].trim());
  }
  return headings;
}

export function extractWikiLinks(markdown: string): string[] {
  const links: string[] = [];
  const regex = /\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g;
  for (const match of markdown.matchAll(regex)) {
    links.push(match[1].trim());
  }
  return links;
}

function countWords(text: string): number {
  const words = text.trim().match(/\S+/g);
  return words ? words.length : 0;
}

function cleanFrontmatter(frontmatterData: Record<string, any>): Record<string, any> {
  const output: Record<string, any> = {};
  for (const [key, value] of Object.entries(frontmatterData)) {
    if (value === undefined) {
      output[key] = "";
      continue;
    }
    output[key] = value;
  }
  return output;
}

function normalizeTrailingNewline(content: string): string {
  return content.endsWith("\n") ? content : `${content}\n`;
}
