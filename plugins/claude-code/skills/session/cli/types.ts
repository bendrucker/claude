export interface DigestRow {
  readonly session_id: string;
  readonly summary: string | null;
  readonly start_time: string | null;
  readonly end_time: string | null;
  readonly duration_minutes: number | null;
  readonly project_path: string | null;
  readonly git_branch: string | null;
  readonly user_messages: number;
  readonly assistant_messages: number;
}

export interface SearchRow {
  readonly session_id: string;
  readonly summary: string | null;
  readonly start_time: string | null;
  readonly end_time: string | null;
  readonly project_path: string | null;
  readonly git_branch: string | null;
}

export interface StatsRow {
  readonly tool_name: string;
  readonly uses: number;
  readonly errors: number;
  readonly error_rate_pct: number;
  readonly total_sessions: number;
  readonly total_tool_uses: number;
  readonly total_errors: number;
}

export interface ErrorRow {
  readonly error_content: string;
  readonly tool_name: string;
  readonly session_id: string;
  readonly project_path: string | null;
  readonly timestamp: string | null;
  readonly error_type: string;
}

export interface ErrorAggregate {
  readonly content: string;
  readonly count: number;
  readonly examples: readonly {
    readonly tool_name: string;
    readonly session_id: string;
    readonly project_path: string | null;
  }[];
}
