import type { z } from "zod";

const PREVIEW_LIMIT = 120;

function preview(text: string): string {
  const collapsed = text.replaceAll(/\s+/g, " ").trim();
  if (collapsed === "") return "(empty)";
  if (collapsed.length <= PREVIEW_LIMIT) return collapsed;
  return `${collapsed.slice(0, PREVIEW_LIMIT)}…`;
}

function formatPath(path: readonly PropertyKey[]): string {
  let formatted = "";
  for (const segment of path) {
    if (typeof segment === "number") {
      formatted = `${formatted}[${segment}]`;
    } else {
      formatted = formatted === "" ? String(segment) : `${formatted}.${String(segment)}`;
    }
  }
  return formatted;
}

function prettify(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = formatPath(issue.path);
      return path === "" ? `  ✖ ${issue.message}` : `  ✖ ${issue.message} → at ${path}`;
    })
    .join("\n");
}

/** A rejected boundary payload. `issues` is empty when the text was not JSON. */
export class DecodeError extends Error {
  readonly source: string;
  readonly issues: readonly z.core.$ZodIssue[];

  private constructor(source: string, message: string, issues: readonly z.core.$ZodIssue[]) {
    super(message);
    this.name = "DecodeError";
    this.source = source;
    this.issues = issues;
  }

  static syntax(source: string, text: string, cause: unknown): DecodeError {
    const detail = cause instanceof Error ? cause.message : String(cause);
    return new DecodeError(
      source,
      `${source}: invalid JSON: ${detail}\n  received: ${preview(text)}`,
      [],
    );
  }

  static invalid(source: string, error: z.ZodError): DecodeError {
    return new DecodeError(
      source,
      `${source} did not match its schema:\n${prettify(error)}`,
      error.issues,
    );
  }
}
