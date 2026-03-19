import MiniSearch from "minisearch";
import { type Conversation, DISPLAY_LIMITS, MIN_TOKEN_LENGTH, RELEVANCE_WEIGHTS } from "./types";

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/\W+/)
    .filter((t) => t.length >= MIN_TOKEN_LENGTH);
}

interface ConversationDocument {
  id: string;
  summary: string;
  userMessages: string;
  assistantMessages: string;
  toolUses: string;
  toolResults: string;
}

function flattenConversation(conversation: Conversation): ConversationDocument {
  const userMessages: string[] = [];
  const assistantMessages: string[] = [];
  const toolUses: string[] = [];
  const toolResults: string[] = [];

  for (const msg of conversation.messages) {
    if (msg.role === "user") {
      userMessages.push(msg.content);
    } else {
      assistantMessages.push(msg.content);
    }
    for (const tool of msg.toolUses) {
      toolUses.push(`${tool.name} ${JSON.stringify(tool.input || {})}`);
    }
    for (const result of msg.toolResults) {
      toolResults.push(result.content);
    }
  }

  return {
    id: conversation.sessionId,
    summary: conversation.summary || "",
    userMessages: userMessages.join(" "),
    assistantMessages: assistantMessages.join(" "),
    toolUses: toolUses.join(" "),
    toolResults: toolResults.join(" "),
  };
}

function truncate(text: string, maxLen: number): string {
  return text.length > maxLen ? `${text.slice(0, maxLen)}...` : text;
}

export function calculateRelevanceScore(
  query: string,
  conversation: Conversation,
): { score: number; matchedContent: string[] } {
  const doc = flattenConversation(conversation);

  const index = new MiniSearch<ConversationDocument>({
    fields: ["summary", "userMessages", "assistantMessages", "toolUses", "toolResults"],
    tokenize,
    searchOptions: {
      tokenize,
      boost: {
        summary: RELEVANCE_WEIGHTS.summary,
        userMessages: RELEVANCE_WEIGHTS.userMessage,
        assistantMessages: RELEVANCE_WEIGHTS.assistantMessage,
        toolUses: RELEVANCE_WEIGHTS.toolUse,
        toolResults: RELEVANCE_WEIGHTS.toolResult,
      },
      combineWith: "OR",
    },
  });

  index.add(doc);
  const results = index.search(query);
  if (results.length === 0) return { score: 0, matchedContent: [] };

  const result = results[0]!;
  const matchedContent: string[] = [];
  const matchedFields = new Set(Object.values(result.match).flat());
  const maxLen = DISPLAY_LIMITS.contentPreview;

  for (const field of matchedFields) {
    if (field === "summary" && conversation.summary) {
      matchedContent.push(`Summary: ${conversation.summary}`);
    } else if (field === "userMessages") {
      for (const msg of conversation.messages) {
        if (msg.role === "user" && msg.content) {
          matchedContent.push(`user: ${truncate(msg.content, maxLen)}`);
        }
      }
    } else if (field === "assistantMessages") {
      for (const msg of conversation.messages) {
        if (msg.role === "assistant" && msg.content) {
          matchedContent.push(`assistant: ${truncate(msg.content, maxLen)}`);
        }
      }
    } else if (field === "toolUses") {
      for (const msg of conversation.messages) {
        for (const tool of msg.toolUses) {
          matchedContent.push(`Tool: ${tool.name}`);
        }
      }
    } else if (field === "toolResults") {
      for (const msg of conversation.messages) {
        for (const result of msg.toolResults) {
          matchedContent.push(`Result: ${truncate(result.content, maxLen)}`);
        }
      }
    }
  }

  return {
    score: result.score,
    matchedContent: matchedContent.slice(0, DISPLAY_LIMITS.matchedContent),
  };
}
