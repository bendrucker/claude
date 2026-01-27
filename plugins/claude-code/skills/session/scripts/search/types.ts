export interface ToolUse {
  readonly id: string;
  readonly name: string;
  readonly input?: Record<string, unknown>;
}

export interface ToolResult {
  readonly toolUseId: string;
  readonly content: string;
  readonly isError: boolean;
}

export interface ThinkingBlock {
  readonly content: string;
}

export interface HookEvent {
  readonly hookName: string;
  readonly hookEvent: string;
  readonly command: string;
  readonly toolUseId: string;
  readonly timestamp: Date | null;
}

export interface Message {
  readonly role: "user" | "assistant";
  readonly content: string;
  readonly toolUses: readonly ToolUse[];
  readonly toolResults: readonly ToolResult[];
  readonly thinking: readonly ThinkingBlock[];
  readonly timestamp?: string;
}

export interface Conversation {
  readonly sessionId: string;
  readonly projectPath: string | null;
  readonly projectName: string | null;
  readonly filePath: string;
  readonly messages: readonly Message[];
  readonly hookEvents: readonly HookEvent[];
  readonly summary: string | null;
  readonly startTime: Date | null;
  readonly endTime: Date | null;
  readonly durationMinutes: number | null;
  readonly gitBranch: string | null;
}

export interface SearchResult {
  readonly conversation: Conversation;
  readonly score: number;
  readonly matchedContent: readonly string[];
}

export interface DigestResult {
  conversations: Conversation[];
  totalCount: number;
  truncated: boolean;
}

export interface ProjectStats {
  readonly projectPath: string;
  readonly projectName: string;
  readonly sessionCount: number;
  readonly totalMinutes: number;
  readonly firstSession: Date | null;
  readonly lastSession: Date | null;
}

export type ErrorType = "rejection" | "failure";

export interface SearchOptions {
  projectsDir?: string;
  before?: Date;
  after?: Date;
  project?: string;
  limit?: number;
  errorType?: ErrorType;
}

/** Minimum token length to match during search */
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
