export const PAGE_TYPES = ["source", "concept", "entity", "synthesis", "analysis"] as const;
export type WikiPageType = (typeof PAGE_TYPES)[number];

export const CANONICAL_PAGE_TYPES = ["concept", "entity", "synthesis", "analysis"] as const;
export type CanonicalPageType = (typeof CANONICAL_PAGE_TYPES)[number];

export interface WikiConfig {
  version: number;
  title: string;
  domain: string;
  timezone: string;
  paths: {
    raw: string;
    wiki: string;
    meta: string;
  };
  pageTypes: Record<WikiPageType, string>;
  templates: Record<WikiPageType, string>;
  linkStyle: string;
  citationStyle: string;
  protect: string[];
  search: {
    defaultLimit: number;
  };
}

export interface ParsedPage {
  absolutePath: string;
  relativePath: string;
  frontmatter: Record<string, any>;
  body: string;
  headings: string[];
  rawLinks: string[];
  normalizedLinks: string[];
  wordCount: number;
}

export interface RegistryEntry {
  id: string;
  type: WikiPageType;
  path: string;
  title: string;
  aliases: string[];
  summary?: string;
  status?: string;
  tags: string[];
  updated?: string;
  sourceIds: string[];
  linksOut: string[];
  headings: string[];
  wordCount: number;
}

export interface RegistryData {
  version: number;
  generatedAt: string;
  pages: RegistryEntry[];
}

export interface BacklinksRecord {
  inbound: string[];
  outbound: string[];
}

export interface BacklinksData {
  version: number;
  generatedAt: string;
  byPath: Record<string, BacklinksRecord>;
}

export type WikiEventKind =
  | "capture"
  | "integrate"
  | "query"
  | "file-analysis"
  | "lint"
  | "refactor"
  | "rebuild";

export interface WikiEvent {
  ts: string;
  kind: WikiEventKind;
  title: string;
  summary?: string;
  sourceIds?: string[];
  pagePaths?: string[];
  notes?: string[];
  actor?: "agent" | "user" | "extension";
}

export interface LintIssue {
  kind: string;
  severity: "info" | "warning" | "error";
  path: string;
  message: string;
}

export interface LintRun {
  mode: string;
  counts: {
    total: number;
    brokenLinks: number;
    orphans: number;
    frontmatter: number;
    duplicates: number;
    coverage: number;
    staleness: number;
  };
  issues: LintIssue[];
  reportPath?: string;
}

export interface SourceManifest {
  version: number;
  sourceId: string;
  title: string;
  kind: string;
  origin: {
    type: "url" | "file" | "text";
    value: string;
  };
  capturedAt: string;
  integratedAt?: string;
  mimeType: string;
  hash: string;
  originalFiles: Array<{
    path: string;
    size: number;
    sha256: string;
  }>;
  extracted: {
    path: string;
    converter: string;
    sha256: string;
  };
  attachments: Array<{
    path: string;
    size?: number;
    sha256?: string;
  }>;
  status: "captured" | "integrated" | "superseded" | "archived";
}

export interface CaptureParams {
  inputType: "url" | "file" | "text";
  value: string;
  title?: string;
  kind?: string;
  tags?: string[];
  createSourcePage?: boolean;
}

export interface CaptureResult {
  sourceId: string;
  packetDir: string;
  manifestPath: string;
  extractedPath: string;
  sourcePagePath?: string;
  title: string;
  status: "captured";
}

export interface EnsurePageParams {
  type: CanonicalPageType;
  title: string;
  aliases?: string[];
  tags?: string[];
  summary?: string;
  createIfMissing?: boolean;
}

export interface EnsurePageResult {
  resolved: boolean;
  created: boolean;
  conflict: boolean;
  path?: string;
  id?: string;
  title?: string;
  type?: string;
  candidates?: Array<{
    id: string;
    path: string;
    title: string;
    type: string;
  }>;
}

export interface SearchMatch {
  id: string;
  type: string;
  path: string;
  title: string;
  summary?: string;
  aliases?: string[];
  score: number;
  sourceIds?: string[];
}

export interface SearchResult {
  query: string;
  matches: SearchMatch[];
}

export interface StatusSummary {
  totals: {
    allPages: number;
    source: number;
    concept: number;
    entity: number;
    synthesis: number;
    analysis: number;
  };
  sources: {
    captured: number;
    integrated: number;
    unintegrated: number;
  };
  lastCapture?: string;
  lastEvent?: string;
}
