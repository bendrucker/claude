import { spawn } from "node:child_process";

export interface TextRow {
  session_id: string;
  timestamp: string;
  role: "user" | "assistant";
  model: string | null;
  project_path: string | null;
  text: string;
  raw_text: string;
}

export interface PhraseLiftRow {
  role: "user" | "assistant";
  model: string | null;
  messages: number;
  total_chars: number;
  phrase_count: number;
  per_1m_chars: number | null;
  lift_vs_user: number | null;
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

export interface QueryParams {
  [key: string]: string | number | undefined;
}

export interface RunQueryOptions {
  refresh?: boolean;
}

const RECORD_SEPARATOR = "\n\n\f\n\n";

export async function runSessionQuery<T = Record<string, unknown>>(
  queryScript: string,
  queryName: string,
  params: QueryParams = {},
  options: RunQueryOptions = {},
): Promise<T[]> {
  const args: string[] = [];
  if (options.refresh) args.push("--refresh");
  args.push("--json");
  args.push(queryName);
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    args.push(`${key}=${value}`);
  }
  const output = await execCapture(queryScript, args);
  if (!output.trim()) return [];
  return JSON.parse(output) as T[];
}

function execCapture(script: string, args: string[]): Promise<string> {
  const child = spawn(script, args, { stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });
  return new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`${script} exited ${code}: ${stderr.trim() || "no stderr"}`));
        return;
      }
      resolve(stdout);
    });
  });
}

export function serializeCorpus(rows: Array<{ text?: string }>): string {
  const parts: string[] = [];
  for (const row of rows) {
    if (!row.text) continue;
    parts.push(row.text);
  }
  return parts.join(RECORD_SEPARATOR);
}

export function totalChars(rows: Array<{ text?: string }>): number {
  let total = 0;
  for (const row of rows) {
    if (row.text) total += row.text.length;
  }
  return total;
}
