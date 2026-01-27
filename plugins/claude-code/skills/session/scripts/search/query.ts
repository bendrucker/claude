import type { Dirent } from "node:fs";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { parseConversationFile } from "./parse";
import { calculateRelevanceScore } from "./score";
import {
  type Conversation,
  DEFAULT_LIMITS,
  type DigestResult,
  type SearchOptions,
  type SearchResult,
} from "./types";

const DEFAULT_PROJECTS_DIR = path.join(os.homedir(), ".claude", "projects");

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

function hasContent(conversation: Conversation): boolean {
  return conversation.messages.length > 0;
}

async function loadConversations(options: SearchOptions): Promise<Conversation[]> {
  const projectsDir =
    options.projectsDir || process.env.CLAUDE_PROJECTS_DIR || DEFAULT_PROJECTS_DIR;

  let entries: Dirent[];
  try {
    entries = await fs.readdir(projectsDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const projectDirs = entries
    .filter((d) => d.isDirectory())
    .map((d) => path.join(projectsDir, d.name));

  const parsePromises: Promise<Conversation>[] = [];

  for (const projectDir of projectDirs) {
    if (options.project && !matchesProjectFilter(projectDir, options.project)) {
      continue;
    }

    const files = await fs.readdir(projectDir);
    const sessionFiles = files
      .filter((f) => f.endsWith(".jsonl"))
      .map((f) => path.join(projectDir, f));

    for (const sessionFile of sessionFiles) {
      parsePromises.push(parseConversationFile(sessionFile));
    }
  }

  const conversations = await Promise.all(parsePromises);
  return conversations.filter((conv) => hasContent(conv) && isWithinDateRange(conv, options));
}

export async function searchConversations(
  query: string,
  options: SearchOptions = {},
): Promise<SearchResult[]> {
  const conversations = await loadConversations(options);

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

export async function getDigest(options: SearchOptions = {}): Promise<DigestResult> {
  const conversations = await loadConversations(options);

  conversations.sort((a, b) => {
    if (!a.startTime) return 1;
    if (!b.startTime) return -1;
    return b.startTime.getTime() - a.startTime.getTime();
  });

  const limit = options.limit ?? DEFAULT_LIMITS.digest;
  const totalCount = conversations.length;
  const truncated = conversations.length > limit;

  return {
    conversations: conversations.slice(0, limit),
    totalCount,
    truncated,
  };
}
