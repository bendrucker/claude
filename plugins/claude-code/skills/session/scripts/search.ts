#!/usr/bin/env tsx

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as chrono from "chrono-node";

export interface ToolUse {
  readonly name: string;
  readonly input?: Record<string, unknown>;
}

export interface Message {
  readonly role: "user" | "assistant";
  readonly content: string;
  readonly toolUses: readonly ToolUse[];
  readonly timestamp?: string;
}

export interface Conversation {
  readonly sessionId: string;
  readonly projectPath: string | null;
  readonly filePath: string;
  readonly messages: readonly Message[];
  readonly summary: string | null;
  readonly startTime: Date | null;
  readonly endTime: Date | null;
  readonly gitBranch: string | null;
}

export interface SearchResult {
  readonly conversation: Conversation;
  readonly score: number;
  readonly matchedContent: readonly string[];
}

interface SearchOptions {
  projectsDir?: string;
  before?: Date;
  after?: Date;
  project?: string;
  limit?: number;
}

const DEFAULT_PROJECTS_DIR = path.join(os.homedir(), ".claude", "projects");

/** Minimum token length to include in search indexing (excludes "a", "an", "to", etc.) */
const MIN_TOKEN_LENGTH = 3;

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/** Relevance weight multipliers for different content sources */
const RELEVANCE_WEIGHTS = {
  /** Summaries are most valuable - concise descriptions of the entire conversation */
  summary: 3.0,
  /** User prompts often contain the core intent/problem being solved */
  userMessage: 1.5,
  /** Tool invocations provide context about actions taken */
  toolUse: 1.3,
  /** Assistant responses are verbose, so weighted lower */
  assistantMessage: 1.0,
} as const;

/** Content preview limits for search result display */
const DISPLAY_LIMITS = {
  /** Max characters in a message content preview */
  contentPreview: 200,
  /** Max matched content entries to return per result */
  matchedContent: 5,
  /** Max matched content entries to show in formatted output */
  matchedContentDisplay: 3,
  /** Max characters in a matched content line in formatted output */
  matchedLineLength: 100,
} as const;

/** Default result limits when not specified by user */
const DEFAULT_LIMITS = {
  /** Default max results for search queries */
  search: 10,
  /** Default max results for digest queries */
  digest: 20,
} as const;

/** Days in the past for "this week" date filter */
const _WEEK_DAYS = 7;

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/\W+/)
    .filter((t) => t.length >= MIN_TOKEN_LENGTH);
}

function extractTextContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((c) => {
        if (typeof c === "string") return c;
        if (c && typeof c === "object") {
          if ("text" in c && typeof c.text === "string") return c.text;
          if ("thinking" in c && typeof c.thinking === "string") return c.thinking;
        }
        return "";
      })
      .join(" ");
  }
  return "";
}

export function parseConversationFile(filePath: string): Conversation {
  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.split("\n").filter((line) => line.trim());

  const messages: Message[] = [];
  let summary: string | null = null;
  let startTime: Date | null = null;
  let endTime: Date | null = null;
  let sessionId = path.basename(filePath, ".jsonl");
  let gitBranch: string | null = null;
  let projectPath: string | null = null;
  let parseErrors = 0;

  for (const line of lines) {
    let record: Record<string, unknown>;
    try {
      record = JSON.parse(line) as Record<string, unknown>;
    } catch {
      parseErrors++;
      continue;
    }

    if (record.type === "summary") {
      summary = (record.summary as string) || null;
      continue;
    }

    if (record.sessionId) sessionId = record.sessionId as string;
    if (record.gitBranch && !gitBranch) gitBranch = record.gitBranch as string;
    if (record.cwd && !projectPath) projectPath = record.cwd as string;

    if (record.timestamp) {
      const ts = new Date(record.timestamp as string);
      if (!startTime || ts < startTime) startTime = ts;
      if (!endTime || ts > endTime) endTime = ts;
    }

    if (record.type === "user" && !record.isMeta) {
      const message = record.message as Record<string, unknown> | undefined;
      if (message?.content) {
        const timestamp = record.timestamp as string | undefined;
        messages.push({
          role: "user",
          content: extractTextContent(message.content),
          toolUses: [],
          ...(timestamp && { timestamp }),
        });
      }
    }

    if (record.type === "assistant") {
      const message = record.message as Record<string, unknown> | undefined;
      if (message?.content) {
        const contentArray = Array.isArray(message.content) ? message.content : [message.content];

        const toolUses: ToolUse[] = contentArray
          .filter((c: Record<string, unknown>) => c.type === "tool_use")
          .map((c: Record<string, unknown>) => ({
            name: c.name as string,
            input: c.input as Record<string, unknown>,
          }));

        const timestamp = record.timestamp as string | undefined;
        messages.push({
          role: "assistant",
          content: extractTextContent(message.content),
          toolUses,
          ...(timestamp && { timestamp }),
        });
      }
    }
  }

  if (parseErrors > 0 && parseErrors === lines.length) {
    console.error(`Warning: Failed to parse any lines in ${filePath}`);
  }

  return {
    sessionId,
    projectPath,
    filePath,
    messages,
    summary,
    startTime,
    endTime,
    gitBranch,
  };
}

export function calculateRelevanceScore(
  query: string,
  conversation: Conversation,
): { score: number; matchedContent: string[] } {
  const queryTokens = new Set(tokenize(query));
  if (queryTokens.size === 0) return { score: 0, matchedContent: [] };

  let score = 0;
  const matchedContent: string[] = [];

  if (conversation.summary) {
    const summaryTokens = tokenize(conversation.summary);
    const matches = summaryTokens.filter((t) => queryTokens.has(t));
    if (matches.length > 0) {
      score += (matches.length / queryTokens.size) * RELEVANCE_WEIGHTS.summary;
      matchedContent.push(`Summary: ${conversation.summary}`);
    }
  }

  for (const msg of conversation.messages) {
    const msgTokens = tokenize(msg.content);
    const matches = msgTokens.filter((t) => queryTokens.has(t));
    if (matches.length === 0) continue;

    const weight =
      msg.role === "user" ? RELEVANCE_WEIGHTS.userMessage : RELEVANCE_WEIGHTS.assistantMessage;
    score += (matches.length / queryTokens.size) * weight;

    const maxLen = DISPLAY_LIMITS.contentPreview;
    const preview = msg.content.slice(0, maxLen) + (msg.content.length > maxLen ? "..." : "");
    matchedContent.push(`${msg.role}: ${preview}`);
  }

  for (const msg of conversation.messages) {
    for (const tool of msg.toolUses) {
      const toolText = `${tool.name} ${JSON.stringify(tool.input || {})}`;
      const toolTokens = tokenize(toolText);
      const matches = toolTokens.filter((t) => queryTokens.has(t));
      if (matches.length > 0) {
        score += (matches.length / queryTokens.size) * RELEVANCE_WEIGHTS.toolUse;
        matchedContent.push(`Tool: ${tool.name}`);
      }
    }
  }

  return { score, matchedContent: matchedContent.slice(0, DISPLAY_LIMITS.matchedContent) };
}

function matchesProjectFilter(projectDir: string, filter: string): boolean {
  const normalizedFilter = filter.replace(/\//g, "-");
  return projectDir.includes(normalizedFilter) || projectDir.includes(filter);
}

function isWithinDateRange(conversation: Conversation, options: SearchOptions): boolean {
  if (options.after && conversation.startTime && conversation.startTime < options.after) {
    return false;
  }
  if (options.before && conversation.endTime && conversation.endTime > options.before) {
    return false;
  }
  return true;
}

function loadConversations(options: SearchOptions): Conversation[] {
  const projectsDir =
    options.projectsDir || process.env.CLAUDE_PROJECTS_DIR || DEFAULT_PROJECTS_DIR;

  if (!fs.existsSync(projectsDir)) {
    return [];
  }

  const conversations: Conversation[] = [];
  const projectDirs = fs
    .readdirSync(projectsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => path.join(projectsDir, d.name));

  for (const projectDir of projectDirs) {
    if (options.project && !matchesProjectFilter(projectDir, options.project)) {
      continue;
    }

    const sessionFiles = fs
      .readdirSync(projectDir)
      .filter((f) => f.endsWith(".jsonl"))
      .map((f) => path.join(projectDir, f));

    for (const sessionFile of sessionFiles) {
      const conversation = parseConversationFile(sessionFile);
      if (isWithinDateRange(conversation, options)) {
        conversations.push(conversation);
      }
    }
  }

  return conversations;
}

export async function searchConversations(
  query: string,
  options: SearchOptions = {},
): Promise<SearchResult[]> {
  const conversations = loadConversations(options);

  const results: SearchResult[] = [];
  for (const conversation of conversations) {
    const { score, matchedContent } = calculateRelevanceScore(query, conversation);
    if (score > 0) {
      results.push({ conversation, score, matchedContent });
    }
  }

  results.sort((a, b) => b.score - a.score);

  const limit = options.limit ?? DEFAULT_LIMITS.search;
  return results.slice(0, limit);
}

export async function getDigest(options: SearchOptions = {}): Promise<Conversation[]> {
  const conversations = loadConversations(options);

  conversations.sort((a, b) => {
    if (!a.startTime) return 1;
    if (!b.startTime) return -1;
    return b.startTime.getTime() - a.startTime.getTime();
  });

  const limit = options.limit ?? DEFAULT_LIMITS.digest;
  return conversations.slice(0, limit);
}

function formatTimestamp(date: Date | null): string {
  if (!date) return "unknown";
  const iso = date.toISOString();
  return `${iso.split("T")[0]} ${iso.split("T")[1]?.slice(0, 5)}`;
}

export function formatDigest(conversations: Conversation[]): string {
  if (conversations.length === 0) {
    return "No conversations found.";
  }

  const lines: string[] = [];
  for (const conv of conversations) {
    const timestamp = formatTimestamp(conv.startTime);
    const project = conv.projectPath || "unknown";

    lines.push(`[${timestamp}] ${project}`);
    lines.push(`  ${conv.summary || "(no summary)"}`);
    if (conv.gitBranch) {
      lines.push(`  Branch: ${conv.gitBranch}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

export function formatSearchResults(results: SearchResult[]): string {
  if (results.length === 0) {
    return "No matching conversations found.";
  }

  const lines: string[] = [];
  for (const result of results) {
    const conv = result.conversation;
    const timestamp = formatTimestamp(conv.startTime);
    const project = conv.projectPath || "unknown";

    lines.push(`[${timestamp}] (score: ${result.score.toFixed(2)}) ${project}`);
    if (conv.summary) {
      lines.push(`  Summary: ${conv.summary}`);
    }
    for (const match of result.matchedContent.slice(0, DISPLAY_LIMITS.matchedContentDisplay)) {
      const maxLen = DISPLAY_LIMITS.matchedLineLength;
      lines.push(`  - ${match.slice(0, maxLen)}${match.length > maxLen ? "..." : ""}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

export function parseDate(dateStr: string): Date {
  const parsed = chrono.parseDate(dateStr);
  if (!parsed) {
    throw new Error(`Unable to parse date: "${dateStr}"`);
  }
  return startOfDay(parsed);
}

function printUsage(): void {
  console.log(`Usage: search.ts [query] [options]

Search conversation history or get a digest of recent sessions.

Options:
  --digest         Show digest of recent conversations (no query needed)
  --after DATE     Only include conversations after this date
  --before DATE    Only include conversations before this date
  --project PATH   Filter by project path
  --limit N        Maximum results (default: 10 for search, 20 for digest)
  --format FORMAT  Output format: text (default) or json

Date formats:
  today, yesterday, this week, or ISO date (2024-01-15)

Examples:
  search.ts "fix error"              # Search for conversations about errors
  search.ts --digest today           # Today's conversation digest
  search.ts "auth" --after yesterday # Auth discussions since yesterday
`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.includes("--help") || args.includes("-h")) {
    printUsage();
    process.exit(0);
  }

  const options: SearchOptions = {};
  let query = "";
  let isDigest = false;
  let format = "text";

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const nextArg = args[i + 1];

    if (arg === "--digest") {
      isDigest = true;
      if (nextArg && !nextArg.startsWith("--")) {
        options.after = parseDate(nextArg);
        i++;
      }
    } else if (arg === "--after" && nextArg) {
      options.after = parseDate(nextArg);
      i++;
    } else if (arg === "--before" && nextArg) {
      options.before = parseDate(nextArg);
      i++;
    } else if (arg === "--project" && nextArg) {
      options.project = nextArg;
      i++;
    } else if (arg === "--limit" && nextArg) {
      const limit = parseInt(nextArg, 10);
      if (Number.isNaN(limit) || limit < 1) {
        throw new Error(`Invalid --limit: "${nextArg}". Must be a positive integer`);
      }
      options.limit = limit;
      i++;
    } else if (arg === "--format" && nextArg) {
      if (nextArg !== "text" && nextArg !== "json") {
        throw new Error(`Invalid --format: "${nextArg}". Must be "text" or "json"`);
      }
      format = nextArg;
      i++;
    } else if (arg && !arg.startsWith("--")) {
      query = arg;
    }
  }

  if (isDigest) {
    const conversations = await getDigest(options);
    if (format === "json") {
      console.log(JSON.stringify(conversations, null, 2));
    } else {
      console.log(formatDigest(conversations));
    }
  } else if (query) {
    const results = await searchConversations(query, options);
    if (format === "json") {
      console.log(JSON.stringify(results, null, 2));
    } else {
      console.log(formatSearchResults(results));
    }
  } else {
    printUsage();
    process.exit(1);
  }
}

// CLI entry point
const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
