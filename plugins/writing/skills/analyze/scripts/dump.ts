import { z } from "zod";

// DuckDB hands TIMESTAMP columns back as Date. Reports render the ISO form.
const Timestamp = z
  .union([z.string(), z.date()])
  .transform((value) => (typeof value === "string" ? value : value.toISOString()));

export const TextRow = z.object({
  session_id: z.string(),
  text: z.string(),
});
export type TextRow = z.infer<typeof TextRow>;

export const DeliverableRow = z.object({
  session_id: z.string(),
  source_file: z.string().nullable(),
  source_line: z.number().nullable(),
  file_path: z.string().nullable(),
  text: z.string(),
});
export type DeliverableRow = z.infer<typeof DeliverableRow>;

export const CorrectiveRow = z.object({
  session_id: z.string(),
  project: z.string().nullable(),
  timestamp: Timestamp,
  user_chars: z.number(),
  user_text: z.string(),
  user_source_file: z.string().nullable(),
  user_source_line: z.number().nullable(),
  matched_term: z.string(),
  context_chars: z.number().nullable(),
  context_snippet: z.string().nullable(),
});
export type CorrectiveRow = z.infer<typeof CorrectiveRow>;

export const CorrectionRow = z.object({
  session_id: z.string(),
  project: z.string().nullable(),
  assistant_timestamp: Timestamp,
  user_timestamp: Timestamp,
  assistant_chars: z.number(),
  user_chars: z.number(),
  assistant_snippet: z.string(),
  user_snippet: z.string(),
  prose_signal: z.boolean(),
});
export type CorrectionRow = z.infer<typeof CorrectionRow>;

export const ModelSummaryRow = z.object({
  model: z.string(),
  text_items: z.number(),
  messages: z.number(),
  sessions: z.number(),
  total_chars: z.number(),
});
export type ModelSummaryRow = z.infer<typeof ModelSummaryRow>;

export function serializeCorpus(rows: { text?: string }[]): string {
  return rows
    .map((r) => r.text)
    .filter(Boolean)
    .join("\n\n\f\n\n");
}

export function totalChars(rows: { text?: string }[]): number {
  return rows.reduce((sum, r) => sum + (r.text?.length ?? 0), 0);
}
