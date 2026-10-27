import type { PreToolUseHookInput } from "@anthropic-ai/claude-agent-sdk";
import { getExtension, isMarkdownFile } from "../detection/paths";
import {
  BOLD_HEADING_ADVICE,
  boldHeadingFindings,
  type HeadingFinding,
  sentenceHeadingFindings,
  TITLE_CASE_ADVICE,
  titleCaseFindings,
} from "../detection/headings";
import { editedContent } from "./io";
import type { HookFinding } from "./report";

// Reports the exact re-casing rather than just naming the heading, so the fix
// needs no second guess about which words AP lowercases.
export function checkTitleCase(content: string): string | null {
  return titleCaseFindings(content)[0]?.message ?? null;
}

export function checkBoldAsHeading(content: string): string | null {
  return boldHeadingFindings(content)[0]?.message ?? null;
}

export function checkSentenceHeading(content: string): string | null {
  return sentenceHeadingFindings(content)[0]?.message ?? null;
}

const MAX_GROUPED = 3;

function grouped(category: string, findings: HeadingFinding[], advice: string): HookFinding[] {
  if (findings.length === 0) return [];
  const listed = findings
    .slice(0, MAX_GROUPED)
    .map((finding) => finding.message)
    .join(". ");
  const rest = findings.length - MAX_GROUPED;
  const more = rest > 0 ? `. ${rest} more headings have the same problem` : "";
  return [{ category, tier: "context", message: `${listed}${more}. ${advice}` }];
}

export function check(input: PreToolUseHookInput): HookFinding[] {
  const edited = editedContent(input);
  if (!edited) return [];
  const { content, filePath } = edited;
  if (!isMarkdownFile(getExtension(filePath))) return [];

  return [
    ...grouped("title case heading", titleCaseFindings(content), TITLE_CASE_ADVICE),
    ...grouped("bold as heading", boldHeadingFindings(content), BOLD_HEADING_ADVICE),
    ...sentenceHeadingFindings(content).map(({ message }): HookFinding => ({
      category: "sentence heading",
      tier: "context",
      message,
    })),
  ];
}
