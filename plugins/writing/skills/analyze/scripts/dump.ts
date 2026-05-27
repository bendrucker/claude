export interface TextRow {
  session_id: string;
  timestamp: string;
  role: "user" | "assistant";
  model: string | null;
  project_path: string | null;
  text: string;
  raw_text: string;
  is_subagent: boolean;
  is_system: boolean;
}

export interface DeliverableRow {
  session_id: string;
  text: string;
  role: "assistant";
}

export interface CorrectionRow {
  session_id: string;
  project: string | null;
  assistant_timestamp: string;
  user_timestamp: string;
  assistant_chars: number;
  user_chars: number;
  assistant_snippet: string;
  user_snippet: string;
}

export interface ModelSummaryRow {
  model: string;
  text_items: number;
  messages: number;
  sessions: number;
  total_chars: number;
  avg_chars_per_item: number;
}

export function serializeCorpus(rows: Array<{ text?: string }>): string {
  return rows
    .map((r) => r.text)
    .filter(Boolean)
    .join("\n\n\f\n\n");
}

export function totalChars(rows: Array<{ text?: string }>): number {
  return rows.reduce((sum, r) => sum + (r.text?.length ?? 0), 0);
}
