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

export interface SearchOptions {
  projectsDir?: string;
  before?: Date;
  after?: Date;
  project?: string;
  limit?: number;
}

/** Minimum token length to include in search indexing */
export const MIN_TOKEN_LENGTH = 3;

/** Relevance weight multipliers for different content sources */
export const RELEVANCE_WEIGHTS = {
  summary: 3.0,
  userMessage: 1.5,
  toolUse: 1.3,
  assistantMessage: 1.0,
} as const;

/** Content preview limits for search result display */
export const DISPLAY_LIMITS = {
  contentPreview: 200,
  matchedContent: 5,
  matchedContentDisplay: 3,
  matchedLineLength: 100,
} as const;

/** Default result limits */
export const DEFAULT_LIMITS = {
  search: 10,
  digest: 20,
} as const;
