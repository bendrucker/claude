import { type Conversation, DISPLAY_LIMITS, MIN_TOKEN_LENGTH, RELEVANCE_WEIGHTS } from "./types";

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/\W+/)
    .filter((t) => t.length >= MIN_TOKEN_LENGTH);
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
