export interface TextRow {
  session_id: string;
  text: string;
}

export interface DeliverableRow {
  session_id: string;
  source_file: string | null;
  source_line: number | null;
  file_path: string | null;
  text: string;
}

export interface CorrectiveRow {
  session_id: string;
  project: string | null;
  timestamp: string;
  user_chars: number;
  user_text: string;
  user_source_file: string | null;
  user_source_line: number | null;
  matched_term: string;
  context_chars: number | null;
  context_snippet: string | null;
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
  prose_signal: boolean;
}

export interface ModelSummaryRow {
  model: string;
  text_items: number;
  messages: number;
  sessions: number;
  total_chars: number;
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
