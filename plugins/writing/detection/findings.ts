import { getExtension, isMarkdownFile } from "./paths";
import { scanAll } from "./scan";
import type { PatternTier } from "./tropes";

export interface Finding {
  line: number;
  col: number;
  category: string;
  tier: PatternTier;
  structural: boolean;
  message: string;
}

export interface FindOptions {
  filePath?: string;
  /** Apply the rules for a message sent once (PR, issue, comment, commit). */
  message?: boolean;
  /** Include the batch-only patterns. */
  batch?: boolean;
}

function isMarkdownText({ filePath, message }: FindOptions): boolean {
  if (message === true || filePath === undefined) return true;
  return isMarkdownFile(getExtension(filePath));
}

function contextFinding(
  category: string,
  message: string,
  position: { line: number; col: number },
): Finding {
  return { ...position, category, tier: "context", structural: false, message };
}

async function markdownFindings(text: string): Promise<Finding[]> {
  const [headings, numbering] = await Promise.all([import("./headings"), import("./numbering")]);
  const stepNumbers = await numbering.markdownNumberingFindings(text);
  return [
    ...headings
      .titleCaseFindings(text)
      .map((f) =>
        contextFinding("title case heading", `${f.message}. ${headings.TITLE_CASE_ADVICE}`, f),
      ),
    ...headings
      .boldHeadingFindings(text)
      .map((f) =>
        contextFinding("bold as heading", `${f.message}. ${headings.BOLD_HEADING_ADVICE}`, f),
      ),
    ...headings
      .sentenceHeadingFindings(text)
      .map((f) => contextFinding("sentence heading", f.message, f)),
    ...stepNumbers.map((f) => contextFinding("numbering", numbering.numberingMessage(f.text), f)),
  ];
}

// Every writing finding in `text`: tropes, plus heading and numbering checks
// when the text is markdown. Sorted by line, then column.
export async function findAll(text: string, options: FindOptions = {}): Promise<Finding[]> {
  const tropes = await scanAll(text, options.filePath, {
    message: options.message === true,
    batch: options.batch === true,
  });
  const findings: Finding[] = tropes.map(({ line, col, category, tier, structural, message }) => ({
    line,
    col,
    category,
    tier,
    structural,
    message,
  }));
  if (isMarkdownText(options)) findings.push(...(await markdownFindings(text)));

  return findings.toSorted((a, b) => (a.line === b.line ? a.col - b.col : a.line - b.line));
}
