import type { PreToolUseHookInput, SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";

function hasBashCommand(input: unknown): input is { command: string } {
  return (
    typeof input === "object" &&
    input !== null &&
    "command" in input &&
    typeof (input as { command: unknown }).command === "string"
  );
}

const TEST_COUNT_PATTERN =
  /[Aa]dded [0-9]+ (unit |integration )?tests|[0-9]+ (unit |integration )?tests/;

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
