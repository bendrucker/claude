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

export interface QueryParams {
  [key: string]: string | number | undefined;
}

export interface RunQueryOptions {
  refresh?: boolean;
  exec?: boolean;
  queryDir?: string;
}

export async function runSessionQuery<T = Record<string, unknown>>(
  queryScript: string,
  queryName: string,
  params: QueryParams = {},
  options: RunQueryOptions = {},
): Promise<T[]> {
  const args: string[] = [];
  if (options.refresh) args.push("--refresh");
  if (options.exec) args.push("--exec");
  if (options.queryDir) args.push("--query-dir", options.queryDir);
  if (!options.exec) args.push("--json");
  args.push(queryName);
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    args.push(`${key}=${value}`);
  }
  const proc = Bun.spawn([queryScript, ...args], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(`${queryScript} exited ${exitCode}: ${stderr.trim() || "no stderr"}`);
  }
  if (options.exec) return [];
  if (!stdout.trim()) return [];
  return JSON.parse(stdout, reviveBigints) as T[];
}

function reviveBigints(_key: string, value: unknown): unknown {
  if (typeof value === "string" && /^-?\d+$/.test(value)) {
    const n = Number(value);
    if (Number.isSafeInteger(n)) return n;
  }
  return value;
}

export async function execSessionQuery(
  queryScript: string,
  queryName: string,
  params: QueryParams = {},
  options: Omit<RunQueryOptions, "exec"> = {},
): Promise<void> {
  await runSessionQuery(queryScript, queryName, params, { ...options, exec: true });
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
