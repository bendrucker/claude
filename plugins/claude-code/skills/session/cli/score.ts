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
  const { messages } = conversation;
  const byRole = (role: string) =>
    messages
      .filter((m) => m.role === role)
      .map((m) => m.content)
      .join(" ");

  return {
    id: conversation.sessionId,
    summary: conversation.summary || "",
    userMessages: byRole("user"),
    assistantMessages: byRole("assistant"),
    toolUses: messages
      .flatMap((m) => m.toolUses)
      .map((t) => `${t.name} ${JSON.stringify(t.input || {})}`)
      .join(" "),
    toolResults: messages
      .flatMap((m) => m.toolResults)
      .map((r) => r.content)
      .join(" "),
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

  const result = results[0];
  if (!result) return { score: 0, matchedContent: [] };
  const matchedTerms = new Set(Object.keys(result.match));
  const matchedFields = new Set(Object.values(result.match).flat());
  const matchedContent: string[] = [];
  const maxLen = DISPLAY_LIMITS.contentPreview;

  const containsMatch = (text: string) => tokenize(text).some((t) => matchedTerms.has(t));

  if (matchedFields.has("summary") && conversation.summary) {
    matchedContent.push(`Summary: ${conversation.summary}`);
  }

  const messageFieldByRole = { user: "userMessages", assistant: "assistantMessages" } as const;

  for (const msg of conversation.messages) {
    if (
      matchedFields.has(messageFieldByRole[msg.role]) &&
      msg.content &&
      containsMatch(msg.content)
    ) {
      matchedContent.push(`${msg.role}: ${truncate(msg.content, maxLen)}`);
    }
    if (matchedFields.has("toolUses")) {
      for (const tool of msg.toolUses) {
        const toolText = `${tool.name} ${JSON.stringify(tool.input || {})}`;
        if (containsMatch(toolText)) {
          matchedContent.push(`Tool: ${tool.name}`);
        }
      }
    }
    if (matchedFields.has("toolResults")) {
      for (const toolResult of msg.toolResults) {
        if (containsMatch(toolResult.content)) {
          matchedContent.push(`Result: ${truncate(toolResult.content, maxLen)}`);
        }
      }
    }
  }

  return {
    score: result.score,
    matchedContent: matchedContent.slice(0, DISPLAY_LIMITS.matchedContent),
  };
}
