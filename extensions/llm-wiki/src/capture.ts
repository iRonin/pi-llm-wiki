import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, stat, writeFile, copyFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { readTemplate, renderTemplate, writePage } from "./frontmatter.ts";
import { isWithin, resolveFrom, sourcePacketDir, sourcePagePath, toRelative } from "./paths.ts";
import { makeSourceId } from "./slug.ts";
import type { CaptureParams, CaptureResult, SourceManifest, WikiConfig } from "./types.ts";

// ---------------------------------------------------------------------------
// Security guards
// ---------------------------------------------------------------------------

// Cap URL-fetched content at 50 MB to prevent memory exhaustion.
const MAX_URL_RESPONSE_BYTES = 50 * 1024 * 1024;

// Maximum redirect hops when following a URL.
const MAX_REDIRECTS = 5;

/**
 * Block URLs that target private/loopback/cloud-metadata addresses.
 * Checked syntactically (no DNS resolution) on every hop of a redirect chain.
 * Prevents SSRF attacks where an LLM-supplied or prompt-injected URL probes
 * internal services such as the AWS EC2 metadata endpoint (169.254.169.254).
 */
const PRIVATE_HOST_RE = [
  /^localhost$/i,
  /^127\./,              // IPv4 loopback
  /^0\./,               // IPv4 this-network
  /^10\./,              // RFC-1918 class A
  /^172\.(1[6-9]|2[0-9]|3[01])\./,  // RFC-1918 class B
  /^192\.168\./,        // RFC-1918 class C
  /^169\.254\./,        // link-local / cloud metadata (AWS, GCP, Azure)
  /^0\.0\.0\.0$/,       // unspecified
  /^::1$/,              // IPv6 loopback
  /^fc[0-9a-f]{2}:/i,   // IPv6 ULA (fc00::/7)
  /^fe[89ab][0-9a-f]:/i, // IPv6 link-local (fe80::/10)
];

function assertSafeUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`Invalid URL: ${raw}`);
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(`Unsupported URL protocol: ${url.protocol}`);
  }

  // Strip IPv6 brackets so the regex tests work uniformly.
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  for (const pattern of PRIVATE_HOST_RE) {
    if (pattern.test(hostname)) {
      throw new Error(
        `URL targets a private or reserved address and cannot be fetched: ${hostname}`,
      );
    }
  }

  return url;
}

/**
 * Fetch a URL with SSRF protection on every redirect hop and a response-body
 * size cap.  Replaces bare `fetch(value)` in materializeUrl.
 */
async function safeFetch(rawUrl: string, signal?: AbortSignal): Promise<Response> {
  let current = rawUrl;
  let hopsLeft = MAX_REDIRECTS;

  while (true) {
    assertSafeUrl(current);

    const response = await fetch(current, { signal, redirect: "manual" });

    if (response.status >= 300 && response.status < 400) {
      if (hopsLeft <= 0) throw new Error("Too many redirects");
      const location = response.headers.get("location");
      if (!location) throw new Error("Redirect with no Location header");
      // Resolve relative redirects and re-check for private hosts.
      current = new URL(location, current).toString();
      hopsLeft--;
      continue;
    }

    return response;
  }
}

export interface CommandRunner {
  exec(command: string, args: string[], options?: { signal?: AbortSignal; timeout?: number }): Promise<{
    stdout: string;
    stderr: string;
    code: number;
  }>;
}

const TEXT_EXTENSIONS = new Set([
  ".md",
  ".txt",
  ".json",
  ".csv",
  ".yaml",
  ".yml",
  ".xml",
  ".html",
  ".htm",
  ".js",
  ".ts",
  ".tsx",
  ".jsx",
  ".py",
  ".rs",
  ".go",
  ".java",
  ".c",
  ".cpp",
  ".sql",
]);

export async function captureSource(
  root: string,
  cwd: string,
  config: WikiConfig,
  params: CaptureParams,
  runner: CommandRunner,
  signal?: AbortSignal,
): Promise<CaptureResult> {
  const existingIds = await listExistingSourceIds(root);
  const sourceId = makeSourceId(existingIds);
  const packetDir = sourcePacketDir(root, sourceId);
  const originalDir = join(packetDir, "original");
  const attachmentsDir = join(packetDir, "attachments");
  await mkdir(originalDir, { recursive: true });
  await mkdir(attachmentsDir, { recursive: true });

  const capturedAt = new Date().toISOString();
  const captured = await materializeInput(packetDir, cwd, params, runner, signal);
  const title = params.title?.trim() || inferTitle(params, captured) || sourceId;
  const kind = params.kind ?? inferKind(params, captured.mimeType, captured.originalPath);
  const manifestPath = join(packetDir, "manifest.json");
  const extractedPath = join(packetDir, "extracted.md");
  const extractedHash = sha256(captured.extractedMarkdown);

  await writeFile(extractedPath, ensureTrailingNewline(captured.extractedMarkdown), "utf8");

  const manifest: SourceManifest = {
    version: 1,
    sourceId,
    title,
    kind,
    origin: {
      type: params.inputType,
      value: params.value,
    },
    capturedAt,
    mimeType: captured.mimeType,
    hash: captured.originalHash,
    originalFiles: [
      {
        path: toRelative(packetDir, captured.originalPath),
        size: captured.originalSize,
        sha256: captured.originalHash.replace(/^sha256:/, ""),
      },
    ],
    extracted: {
      path: "extracted.md",
      converter: captured.converter,
      sha256: extractedHash.replace(/^sha256:/, ""),
    },
    attachments: [],
    status: "captured",
  };

  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  let sourcePage: string | undefined;
  if (params.createSourcePage !== false) {
    sourcePage = await createSourcePageStub(root, config, {
      sourceId,
      title,
      kind,
      capturedAt,
      originType: params.inputType,
      originValue: params.value,
      manifestPath: toRelative(root, manifestPath),
      rawPath: toRelative(root, extractedPath),
      tags: params.tags ?? [],
      summary: inferSummary(captured.extractedMarkdown),
    });
  }

  return {
    sourceId,
    packetDir: toRelative(root, packetDir),
    manifestPath: toRelative(root, manifestPath),
    extractedPath: toRelative(root, extractedPath),
    sourcePagePath: sourcePage,
    title,
    status: "captured",
  };
}

interface MaterializedInput {
  originalPath: string;
  originalSize: number;
  originalHash: string;
  extractedMarkdown: string;
  mimeType: string;
  converter: string;
}

async function materializeInput(
  packetDir: string,
  cwd: string,
  params: CaptureParams,
  runner: CommandRunner,
  signal?: AbortSignal,
): Promise<MaterializedInput> {
  switch (params.inputType) {
    case "text":
      return materializeText(packetDir, params.value);
    case "file":
      return materializeFile(packetDir, cwd, params.value, runner, signal);
    case "url":
      return materializeUrl(packetDir, params.value, runner, signal);
  }
}

async function materializeText(packetDir: string, value: string): Promise<MaterializedInput> {
  const originalPath = join(packetDir, "original", "source.txt");
  await writeFile(originalPath, ensureTrailingNewline(value), "utf8");
  const size = Buffer.byteLength(value, "utf8");
  return {
    originalPath,
    originalSize: size,
    originalHash: sha256(value),
    extractedMarkdown: value,
    mimeType: "text/plain",
    converter: "inline-text",
  };
}

async function materializeFile(
  packetDir: string,
  cwd: string,
  value: string,
  runner: CommandRunner,
  signal?: AbortSignal,
): Promise<MaterializedInput> {
  const absoluteInput = resolveFrom(cwd, value);

  // Guard against path traversal: only allow files within the working directory.
  // This prevents an LLM (potentially prompt-injected) from exfiltrating
  // arbitrary files such as ~/.pi/agent/auth.json or ~/.ssh/id_rsa.
  if (!isWithin(cwd, absoluteInput)) {
    throw new Error(
      `File path escapes the working directory and cannot be captured: ${absoluteInput}`,
    );
  }
  const extension = extname(absoluteInput) || ".bin";
  const originalPath = join(packetDir, "original", `source${extension}`);
  await copyFile(absoluteInput, originalPath);
  const fileStats = await stat(originalPath);
  const originalBuffer = await readFile(originalPath);
  const mimeType = inferMimeType(extension);

  let extractedMarkdown = "";
  let converter = "native";

  if (TEXT_EXTENSIONS.has(extension.toLowerCase())) {
    extractedMarkdown = await readTextFileWithFallback(originalPath);
    if (extension === ".html" || extension === ".htm") {
      extractedMarkdown = htmlToMarkdown(extractedMarkdown);
      converter = "html-fallback";
    }
  } else {
    const markitdown = await runMarkitdown(absoluteInput, runner, signal);
    if (markitdown) {
      extractedMarkdown = markitdown;
      converter = "markitdown";
    } else {
      extractedMarkdown = `# Binary source captured\n\nOriginal file: ${basename(absoluteInput)}\n\nNo markdown extraction backend was available. Preserve this packet and inspect the original file directly if needed.\n`;
      converter = "binary-placeholder";
    }
  }

  return {
    originalPath,
    originalSize: fileStats.size,
    originalHash: sha256(originalBuffer),
    extractedMarkdown,
    mimeType,
    converter,
  };
}

async function materializeUrl(
  packetDir: string,
  value: string,
  runner: CommandRunner,
  signal?: AbortSignal,
): Promise<MaterializedInput> {
  const response = await safeFetch(value, signal);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${value}: ${response.status} ${response.statusText}`);
  }

  // Reject oversized responses before buffering to prevent memory exhaustion.
  const contentLength = response.headers.get("content-length");
  if (contentLength && Number.parseInt(contentLength, 10) > MAX_URL_RESPONSE_BYTES) {
    throw new Error(
      `URL response too large: ${contentLength} bytes (limit ${MAX_URL_RESPONSE_BYTES})`,
    );
  }

  const contentType = response.headers.get("content-type") || "application/octet-stream";
  const extension = extensionFromContentType(contentType) || extensionFromUrl(value) || ".bin";
  const originalPath = join(packetDir, "original", `source${extension}`);
  const buffer = Buffer.from(await response.arrayBuffer());

  if (buffer.byteLength > MAX_URL_RESPONSE_BYTES) {
    throw new Error(
      `URL response body too large: ${buffer.byteLength} bytes (limit ${MAX_URL_RESPONSE_BYTES})`,
    );
  }
  await writeFile(originalPath, buffer);

  let extractedMarkdown = await runMarkitdown(value, runner, signal);
  let converter = extractedMarkdown ? "markitdown" : "fetch-fallback";

  if (!extractedMarkdown) {
    if (contentType.includes("html") || extension === ".html") {
      extractedMarkdown = htmlToMarkdown(buffer.toString("utf8"));
    } else if (contentType.startsWith("text/") || extension === ".txt" || extension === ".md") {
      extractedMarkdown = buffer.toString("utf8");
    } else {
      extractedMarkdown = `# Remote source captured\n\nOrigin URL: ${value}\n\nFetched content type: ${contentType}\n\nNo markdown extraction backend was available for this content. Inspect the original artifact directly if needed.\n`;
    }
  }

  return {
    originalPath,
    originalSize: buffer.byteLength,
    originalHash: sha256(buffer),
    extractedMarkdown,
    mimeType: contentType.split(";")[0].trim(),
    converter,
  };
}

async function createSourcePageStub(
  root: string,
  config: WikiConfig,
  values: {
    sourceId: string;
    title: string;
    kind: string;
    capturedAt: string;
    originType: string;
    originValue: string;
    manifestPath: string;
    rawPath: string;
    tags: string[];
    summary: string;
  },
): Promise<string> {
  const template = await readTemplate(join(root, config.templates.source));
  const rendered = renderTemplate(template, {
    id: values.sourceId,
    title: values.title,
    kind: values.kind,
    captured_at: values.capturedAt,
    origin_type: values.originType,
    origin_value: values.originValue,
    manifest_path: values.manifestPath,
    raw_path: values.rawPath,
  });

  const absolutePath = sourcePagePath(root, values.sourceId);
  const bodyStart = rendered.indexOf("\n---\n", 4);
  const body = bodyStart >= 0 ? rendered.slice(bodyStart + 5).trimStart() : rendered;

  await writePage(absolutePath, {
    id: values.sourceId,
    type: "source",
    title: values.title,
    kind: values.kind,
    status: "captured",
    captured_at: values.capturedAt,
    integrated_at: "",
    origin_type: values.originType,
    origin_value: values.originValue,
    manifest_path: values.manifestPath,
    raw_path: values.rawPath,
    aliases: [],
    tags: values.tags,
    source_ids: [values.sourceId],
    summary: values.summary,
  }, body);

  return toRelative(root, absolutePath);
}

async function runMarkitdown(input: string, runner: CommandRunner, signal?: AbortSignal): Promise<string | undefined> {
  try {
    const result = await runner.exec(
      "uvx",
      ["--from", "markitdown[pdf]", "markitdown", input],
      { signal, timeout: 120_000 },
    );
    if (result.code === 0 && result.stdout.trim()) {
      return result.stdout.trim();
    }
  } catch {
    // Fallback below
  }
  return undefined;
}

async function listExistingSourceIds(root: string): Promise<string[]> {
  const sourcesDir = join(root, "raw", "sources");
  try {
    const entries = await readdir(sourcesDir, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch {
    return [];
  }
}

function inferTitle(params: CaptureParams, captured: MaterializedInput): string | undefined {
  if (params.inputType === "file") {
    const value = basename(params.value).replace(/\.[^.]+$/, "");
    return value || titleFromMarkdown(captured.extractedMarkdown);
  }
  if (params.inputType === "url") {
    return titleFromMarkdown(captured.extractedMarkdown) || titleFromUrl(params.value);
  }
  return titleFromMarkdown(captured.extractedMarkdown) || firstNonEmptyLine(params.value)?.slice(0, 80);
}

function inferKind(params: CaptureParams, mimeType: string, originalPath: string): string {
  if (params.inputType === "url") {
    if (mimeType.includes("html")) return "webpage";
    if (mimeType.includes("pdf")) return "pdf";
    return "article";
  }

  if (params.inputType === "text") return "note";

  const extension = extname(originalPath).toLowerCase();
  if (extension === ".pdf") return "pdf";
  if ([".md", ".txt"].includes(extension)) return "note";
  if ([".html", ".htm"].includes(extension)) return "webpage";
  if ([".docx", ".doc"].includes(extension)) return "paper";
  return "other";
}

function inferSummary(markdown: string): string {
  const paragraph = markdown
    .split(/\n\s*\n/)
    .map((block) => block.replace(/^#+\s+/gm, "").trim())
    .find((block) => block.length > 40);
  if (!paragraph) return "";
  return paragraph.slice(0, 220).trim();
}

function titleFromMarkdown(markdown: string): string | undefined {
  const heading = markdown.match(/^#\s+(.+)$/m)?.[1]?.trim();
  if (heading) return heading;
  const line = firstNonEmptyLine(markdown);
  return line?.replace(/^#+\s*/, "").slice(0, 100).trim() || undefined;
}

function titleFromUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    const tail = url.pathname.split("/").filter(Boolean).pop();
    if (!tail) return url.hostname;
    return decodeURIComponent(tail).replace(/[-_]+/g, " ").replace(/\.[^.]+$/, "");
  } catch {
    return undefined;
  }
}

function firstNonEmptyLine(text: string): string | undefined {
  return text.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
}

function inferMimeType(extension: string): string {
  switch (extension.toLowerCase()) {
    case ".md":
    case ".txt":
      return "text/plain";
    case ".html":
    case ".htm":
      return "text/html";
    case ".json":
      return "application/json";
    case ".pdf":
      return "application/pdf";
    case ".csv":
      return "text/csv";
    default:
      return "application/octet-stream";
  }
}

function extensionFromContentType(contentType: string): string | undefined {
  const clean = contentType.split(";")[0].trim();
  switch (clean) {
    case "text/html":
      return ".html";
    case "text/plain":
      return ".txt";
    case "text/markdown":
      return ".md";
    case "application/pdf":
      return ".pdf";
    case "application/json":
      return ".json";
    default:
      return undefined;
  }
}

function extensionFromUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    const ext = extname(url.pathname);
    return ext || undefined;
  } catch {
    return undefined;
  }
}

async function readTextFileWithFallback(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch {
    const buffer = await readFile(path);
    return buffer.toString("utf8");
  }
}

function htmlToMarkdown(html: string): string {
  const title = html.match(/<title>(.*?)<\/title>/is)?.[1]?.trim();
  const body = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<\/?(p|div|section|article|br|li|ul|ol|h1|h2|h3|h4|h5|h6)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();

  const heading = title ? `# ${title}\n\n` : "";
  return `${heading}${body}`.trim();
}

function ensureTrailingNewline(text: string): string {
  return text.endsWith("\n") ? text : `${text}\n`;
}

function sha256(value: string | Buffer): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}
