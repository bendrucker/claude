import { z } from "zod";
import { headingTexts, stripEmphasis } from "../../../scripts/markdown";
import { classifyPrHeading } from "../classifier";

// promptfoo loads this through a `javascript` assert, so it runs in promptfoo's
// node process rather than under bun. Extraction and classification are the same
// calls `score.ts` makes, so the assert flags exactly what the shipped hook does.

const Draft = z.object({ title: z.string(), body: z.string() });

export interface FlaggedHeading {
  text: string;
  signals: string[];
}

export function flaggedHeadings(body: string): FlaggedHeading[] {
  const flagged: FlaggedHeading[] = [];
  for (const text of headingTexts(body)) {
    const { flagged: isFlagged, signals } = classifyPrHeading(stripEmphasis(text));
    if (isFlagged) flagged.push({ text, signals });
  }
  return flagged;
}

export interface GradingResult {
  pass: boolean;
  score: number;
  reason: string;
}

/**
 * promptfoo passes the draft as the parsed object when the arm's structured
 * output held, and as its raw text when it did not.
 */
function draftOf(output: unknown): z.infer<typeof Draft> | null {
  const source = Draft.safeParse(output);
  if (source.success) return source.data;
  if (typeof output !== "string") return null;
  try {
    const retry = Draft.safeParse(JSON.parse(output));
    return retry.success ? retry.data : null;
  } catch {
    return null;
  }
}

export function gradeHeadings(output: unknown): GradingResult {
  const draft = draftOf(output);
  if (draft === null) {
    return { pass: false, score: 0, reason: "Output is not a { title, body } draft." };
  }

  const headings = headingTexts(draft.body);
  const flagged = flaggedHeadings(draft.body);

  if (flagged.length === 0) {
    return {
      pass: true,
      score: 1,
      reason: headings.length === 0 ? "No headings." : `${headings.length} headings, none flagged.`,
    };
  }

  const detail = flagged
    .map((heading) => `  "${heading.text}" · ${heading.signals.join("; ")}`)
    .join("\n");
  return {
    pass: false,
    score: 0,
    reason: `${flagged.length} of ${headings.length} headings read as sentences:\n${detail}`,
  };
}
