import type { PreToolUseHookInput, SyncHookJSONOutput } from "@bendrucker/claude-plugin-toolkit";

function hasBashCommand(input: unknown): input is { command: string } {
  return (
    typeof input === "object" &&
    input !== null &&
    "command" in input &&
    typeof (input as { command: unknown }).command === "string"
  );
}

const TEST_COUNT_PATTERN =
  /[Aa]dded [0-9]+ (unit |integration )?tests|[0-9]+ (unit |integration )?tests|[0-9]+ assertions|[0-9]+ pass(?:ed|es)?,\s*[0-9]+ fail/;

// A roll-call of green status checks (`all green`, `0 errors, 0 warnings`,
// `lint passes`, `npm run build` green) restates what the PR's status checks
// already show. This warns rather than denies: whether a check is in CI is a
// judgment the hook can't make, and a genuinely non-CI signal (a manual run, an
// intentional exclusion, a pre-existing warning) is worth keeping.
// Adjacency (only an adverb may sit between the check and its status word) keeps
// these off prose where the same words carry a different sense, e.g. "the tests
// already pass VARCHAR literals" (pass = the verb, not a status).
const CI_STATUS_PATTERNS: RegExp[] = [
  /\ball (?:checks? (?:pass|green)|green)\b/i,
  /\b0 errors?,?\s*0 warnings?\b/i,
  /\b(?:lint|types?|typecheck|type checking|build|tests?|checks?)\s+(?:all |also |now |is |are |was |were )?(?:pass(?:es|ed)?|green|clean)\b/i,
  /\b(?:pass(?:es|ed|ing)?|green|clean)\s+(?:in )?ci\b/i,
];

// Mirrors the writing plugin's "template on small document" detector: a full
// `## Changes` + `## Testing` scaffold on a body under this many words is
// over-structured. Reimplemented locally to avoid a cross-plugin import.
const SMALL_BODY_WORD_LIMIT = 150;

const AUTOLINK_REASON =
  "Commit SHAs and issue/MR refs (`#123`, `!45`) auto-link on GitHub/GitLab. Backticks render them as code and suppress the link. Write them bare.";

const CHANGES_HEADING_PATTERN = /^##\s+Changes\b/m;
const TESTING_HEADING_PATTERN = /^##\s+Testing\b/m;

// File-tour bullet: a `- **label:**` or `* **label:**` item whose bold label
// names a file rather than a concept. Captures the label so the path heuristic
// can inspect it.
const BOLD_LABEL_BULLET_PATTERN = /^\s*[-*]\s+\*\*([^*]+?)\*\*:/gm;

const FILE_EXTENSION_PATTERN =
  /\.(ts|tsx|js|jsx|mjs|cjs|json|md|txt|py|rb|go|rs|java|c|h|cpp|sh|yml|yaml|toml|css|html|sql)$/i;

function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

function looksLikeFilePath(label: string): boolean {
  const trimmed = label
    .trim()
    .replace(/^`+|`+$/g, "")
    .trim();
  if (trimmed.length === 0) return false;
  if (trimmed.includes("/")) return true;
  return FILE_EXTENSION_PATTERN.test(trimmed);
}

export function hasReflexiveScaffold(body: string): boolean {
  if (countWords(body) >= SMALL_BODY_WORD_LIMIT) return false;
  return CHANGES_HEADING_PATTERN.test(body) && TESTING_HEADING_PATTERN.test(body);
}

export function hasFileTourBullets(body: string): boolean {
  for (const match of body.matchAll(BOLD_LABEL_BULLET_PATTERN)) {
    const label = match[1];
    if (label && looksLikeFilePath(label)) return true;
  }
  return false;
}

export function hasCiStatusRollCall(body: string): boolean {
  return CI_STATUS_PATTERNS.some((pattern) => pattern.test(body));
}

// Prose density thresholds. A paragraph past MAX_SENTENCES_PER_PARAGRAPH runs
// more than one thread. A sentence past RUN_ON_CHARS is a wall. A sentence with
// COMMA_SPLICE_MIN_COMMAS commas past COMMA_SPLICE_MIN_CHARS is an enumeration
// that belongs in a list.
const RUN_ON_CHARS = 280;
const COMMA_SPLICE_MIN_COMMAS = 3;
const COMMA_SPLICE_MIN_CHARS = 220;
const MAX_SENTENCES_PER_PARAGRAPH = 4;

// Join the body into prose paragraphs, dropping fenced code, tables, headings,
// list items, and blockquotes so density is measured on prose alone.
function proseParagraphs(body: string): string[] {
  const paras: string[] = [];
  let buf: string[] = [];
  let inFence = false;
  const flush = () => {
    if (buf.length > 0) paras.push(buf.join(" ").trim());
    buf = [];
  };
  for (const line of body.split("\n")) {
    if (/^\s*```/.test(line)) {
      flush();
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    if (line.trim() === "" || /^\s*(#{1,6}\s|[-*]\s|\d+[.)]\s|\||>)/.test(line)) {
      flush();
      continue;
    }
    buf.push(line.trim());
  }
  flush();
  return paras.filter((p) => p.length > 0);
}

function splitSentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+(?=[A-Z`(])/).filter((s) => s.trim().length > 0);
}

export function hasRunOnProse(body: string): boolean {
  for (const para of proseParagraphs(body)) {
    const sentences = splitSentences(para);
    if (sentences.length > MAX_SENTENCES_PER_PARAGRAPH) return true;
    for (const sentence of sentences) {
      if (sentence.length > RUN_ON_CHARS) return true;
      const commas = (sentence.match(/,/g) ?? []).length;
      if (commas >= COMMA_SPLICE_MIN_COMMAS && sentence.length > COMMA_SPLICE_MIN_CHARS)
        return true;
    }
  }
  return false;
}

// Backticked hex run that could be a commit SHA. Only a filter: the git object
// database settles whether a candidate is a real commit.
const BACKTICKED_HEX_PATTERN = /`([0-9a-f]{7,40})`/g;

// Backticked issue/MR reference: `#123`, `!45`, or `owner/repo#12`. Digits-only
// after the sigil rules out CSS ids (`#main`) and code annotations. `@mentions`
// are deliberately excluded because they have legitimate uses in code and prose.
const BACKTICKED_REF_PATTERN = /`(?:[\w.-]+\/[\w.-]+)?[#!]\d+`/;

export function extractBacktickedHexCandidates(body: string): string[] {
  return Array.from(body.matchAll(BACKTICKED_HEX_PATTERN), (match) => match[1]).filter(
    (token): token is string => token !== undefined,
  );
}

export function hasBacktickedRef(body: string): boolean {
  return BACKTICKED_REF_PATTERN.test(body);
}

export function gitCommitVerifier(cwd: string): (sha: string) => Promise<boolean> {
  return async (sha) => {
    try {
      const proc = Bun.spawn(["git", "rev-parse", "--verify", "--quiet", `${sha}^{commit}`], {
        cwd,
        stdout: "ignore",
        stderr: "ignore",
      });
      return (await proc.exited) === 0;
    } catch {
      return false;
    }
  };
}

export async function findBacktickedCommits(
  candidates: string[],
  verify: (sha: string) => Promise<boolean>,
): Promise<string[]> {
  const results = await Promise.all(
    candidates.map(async (candidate) => ((await verify(candidate)) ? candidate : null)),
  );
  return results.filter((sha): sha is string => sha !== null);
}

export function extractBodyFilePath(command: string): string | null {
  const match = command.match(/--body-file[=\s]([^\s]+)/);
  return match?.[1] ?? null;
}

function warn(reasons: string[]): SyncHookJSONOutput {
  const intro =
    reasons.length === 1
      ? "PR body has a structural-slop pattern:"
      : "PR body has structural-slop patterns:";
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      additionalContext: `${intro}\n${reasons.map((reason) => `- ${reason}`).join("\n")}`,
    },
  };
}

function denyForTestCount(body: string): SyncHookJSONOutput | null {
  if (!TEST_COUNT_PATTERN.test(body)) {
    return null;
  }
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason:
        "Testing section should not mention test counts. Describe what is covered instead.",
    },
  };
}

function structuralReasons(body: string): string[] {
  const reasons: string[] = [];
  if (hasReflexiveScaffold(body)) {
    reasons.push(
      "Small PRs don't need a `## Changes` + `## Testing` scaffold. Length tracks substance. Use prose for a short change.",
    );
  }
  if (hasFileTourBullets(body)) {
    reasons.push(
      "Bullets shaped like `- **path/to/file**: ...` narrate a file tour. Describe the conceptual change instead of walking the diff file by file.",
    );
  }
  if (hasCiStatusRollCall(body)) {
    reasons.push(
      "The body states that lint, types, tests, or a build passed. The PR's status checks already show that. Drop it, unless the result is one CI won't post: a manual check CI doesn't run, an intentional exclusion, or a pre-existing warning you're leaving in place.",
    );
  }
  if (hasRunOnProse(body)) {
    reasons.push(
      "A prose paragraph runs long: over four sentences, a sentence past 280 characters, or several clauses stacked behind commas. Split the thread, or move an enumeration into a list.",
    );
  }
  if (hasBacktickedRef(body)) {
    reasons.push(AUTOLINK_REASON);
  }
  return reasons;
}

export function validateBody(body: string): SyncHookJSONOutput | null {
  const deny = denyForTestCount(body);
  if (deny) {
    return deny;
  }

  const reasons = structuralReasons(body);
  return reasons.length > 0 ? warn(reasons) : null;
}

export async function processInput(input: PreToolUseHookInput): Promise<SyncHookJSONOutput | null> {
  if (!hasBashCommand(input.tool_input)) {
    return null;
  }
  const { command } = input.tool_input;

  const bodyFilePath = extractBodyFilePath(command);
  if (!bodyFilePath) {
    return null;
  }

  const file = Bun.file(bodyFilePath);
  if (!(await file.exists())) {
    return null;
  }

  const body = await file.text();

  const deny = denyForTestCount(body);
  if (deny) {
    return deny;
  }

  const reasons = structuralReasons(body);

  const cwd = input.cwd ?? process.cwd();
  const candidates = extractBacktickedHexCandidates(body);
  const commits = await findBacktickedCommits(candidates, gitCommitVerifier(cwd));
  if (commits.length > 0 && !reasons.includes(AUTOLINK_REASON)) {
    reasons.push(AUTOLINK_REASON);
  }

  return reasons.length > 0 ? warn(reasons) : null;
}
