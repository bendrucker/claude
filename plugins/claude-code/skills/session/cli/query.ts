import { collectConcurrent } from "./concurrent";
import { debug, incrementCount, startTiming } from "./debug";
import {
  compareTimestampsDesc,
  findSessionFile,
  isWithinDateRange,
  streamSessionFiles,
} from "./files";
import { parseConversationFile } from "./parse";
import { calculateRelevanceScore } from "./score";
import {
  type Conversation,
  DEFAULT_LIMITS,
  type DigestResult,
  type SearchOptions,
  type SearchResult,
} from "./types";

function hasContent(conversation: Conversation): boolean {
  return conversation.messages.length > 0;
}

async function loadConversations(options: SearchOptions): Promise<Conversation[]> {
  const { ctx } = options;

  const stopParsing = ctx ? startTiming(ctx, "file_parsing") : undefined;
  const parsed = await collectConcurrent(
    streamSessionFiles(options),
    async (file) => {
      if (ctx) {
        incrementCount(ctx, "files_found");
        debug(ctx, `Parsing ${file.path}`);
      }
      return parseConversationFile(file.path);
    },
    ctx ? { ctx } : {},
  );
  stopParsing?.();

  const stopFiltering = ctx ? startTiming(ctx, "filtering") : undefined;
  const conversations = parsed.filter((conv) => {
    if (!hasContent(conv)) {
      if (ctx) incrementCount(ctx, "empty_sessions");
      return false;
    }
    if (!isWithinDateRange(conv.startTime, options)) {
      if (ctx) incrementCount(ctx, "date_filtered");
      return false;
    }
    return true;
  });
  stopFiltering?.();

  if (ctx) {
    incrementCount(ctx, "conversations_loaded", conversations.length);
  }

  return conversations;
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

  conversations.sort((a, b) => compareTimestampsDesc(a.startTime, b.startTime));

  const limit = options.limit ?? DEFAULT_LIMITS.digest;
  const totalCount = conversations.length;
  const truncated = conversations.length > limit;

  return {
    conversations: conversations.slice(0, limit),
    totalCount,
    truncated,
  };
}

export async function getSession(
  sessionId: string,
  options: SearchOptions = {},
): Promise<Conversation | null> {
  const filePath = await findSessionFile(sessionId, options);
  if (!filePath) return null;
  return parseConversationFile(filePath);
}
