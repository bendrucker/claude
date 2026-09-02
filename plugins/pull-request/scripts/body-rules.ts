// The rules a PR body is held to, as a catalog. A deny carries a mechanical
// fix the body cannot argue its way out of. A warn is a judgment call, so the
// author gets the note and keeps the decision.

import type { SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import { headingCaseViolations } from "./heading-case";
import { LINKING_VERBS } from "./linguistics/heading";
import { countProseWords, headingTexts, linesOutsideFences, stripEmphasis } from "./markdown";
import {
  COMMA_SPLICE_MIN_CHARS,
  COMMA_SPLICE_MIN_COMMAS,
  hardWrappedParagraphs,
  hasClauseStacking,
  MAX_SENTENCES_PER_PARAGRAPH,
  NARRATION_TELLS,
  type NarrationTell,
  narrationTellSource,
  proseParagraphs,
  RUN_ON_CHARS,
  splitSentences,
  TITLE_LENGTH_LIMIT,
  type WrappedParagraph,
} from "./prose";
import { classifyPrHeading } from "./sentence-heading";

/** Facts about the repository the rules consult only when a body warrants it. */
export interface RepoContext {
  /** The repo is owned by the authenticated user, so the PR is self-reviewed. */
  personalRepo: () => Promise<boolean>;
  /** Whether a backticked hex run names a commit in the repo. */
  hasCommit: (sha: string) => Promise<boolean>;
}

export interface BodyContext extends RepoContext {
  /** Title the command sets, or null when it sets none. */
  title: string | null;
  /** Why the hook could not read the body, in which case the body rules see an empty one. */
  unreadable: string | null;
}

type Tier = "deny" | "warn";

interface RuleDef<Id extends string, Evidence> {
  id: Id;
  tier: Tier;
  /** Evidence the message is built from, or null when the rule does not apply. */
  detect: (body: string, context: BodyContext) => Evidence | null | Promise<Evidence | null>;
  message: (evidence: Evidence) => string;
}

interface Rule<Id extends string> {
  id: Id;
  tier: Tier;
  run: (body: string, context: BodyContext) => Promise<string | null>;
}

function rule<Id extends string, Evidence>(def: RuleDef<Id, Evidence>): Rule<Id> {
  return {
    id: def.id,
    tier: def.tier,
    run: async (body, context) => {
      const evidence = await def.detect(body, context);
      return evidence === null ? null : def.message(evidence);
    },
  };
}

function nonEmpty<T>(items: T[]): T[] | null {
  return items.length > 0 ? items : null;
}

const TEST_COUNT_PATTERN =
  /[Aa]dded [0-9]+ (unit |integration )?tests|[0-9]+ (unit |integration )?tests|[0-9]+ assertions|[0-9]+ pass(?:ed|es)?,\s*[0-9]+ fail/;

// Backticked issue/MR reference: `#123`, `!45`, or `owner/repo#12`. Digits-only
// after the sigil rules out CSS ids (`#main`) and code annotations. `@mentions`
// are excluded because they have legitimate uses in code and prose.
const BACKTICKED_REF_PATTERN = /`(?:[\w.-]+\/[\w.-]+)?[#!]\d+`/;

// Backticked hex run that could be a commit SHA. Only a filter: the git object
// database settles whether a candidate is a real commit.
const BACKTICKED_HEX_PATTERN = /`([0-9a-f]{7,40})`/g;

async function hasBacktickedCommit(body: string, context: BodyContext): Promise<boolean> {
  const candidates = Array.from(body.matchAll(BACKTICKED_HEX_PATTERN), (match) => match[1]).filter(
    (token): token is string => token !== undefined,
  );
  const verified = await Promise.all(candidates.map((sha) => context.hasCommit(sha)));
  return verified.some(Boolean);
}

// Two paragraphs is enough for the model to see the shape of the fix. Quoting
// every one of them would make the deny reason longer than the body.
const WRAP_EXAMPLE_LIMIT = 2;

function wrapReason(wrapped: WrappedParagraph[]): string {
  const shown = wrapped.slice(0, WRAP_EXAMPLE_LIMIT);
  const remaining = wrapped.length - shown.length;
  const examples = shown
    .map(({ raw, unwrapped }) => `Replace:\n${raw}\nwith:\n${unwrapped}`)
    .join("\n\n");
  const more =
    remaining > 0
      ? `\n\n${remaining} more wrapped paragraph${remaining === 1 ? "" : "s"} to fix the same way.`
      : "";
  return `Prose in the body is hard-wrapped at a fixed column. A PR body renders in a web UI that soft-wraps, so a hard wrap gains nothing and displays as a narrow column. Write one line per paragraph and one line per list item. This applies to the body only. A markdown file in the repo keeps its own wrapping convention, so a body sourced from one gets copied to a scratch file and unwrapped there.\n\n${examples}${more}`;
}

// Mirrors the writing plugin's "template on small document" detector: a full
// `## Changes` + `## Testing` scaffold on a body under this many words is
// over-structured. Reimplemented locally to avoid a cross-plugin import.
const SMALL_BODY_WORD_LIMIT = 150;
const CHANGES_HEADING_PATTERN = /^##\s+Changes\b/m;
const TESTING_HEADING_PATTERN = /^##\s+Testing\b/m;

function hasReflexiveScaffold(body: string): boolean {
  if (countProseWords(body) >= SMALL_BODY_WORD_LIMIT) return false;
  return CHANGES_HEADING_PATTERN.test(body) && TESTING_HEADING_PATTERN.test(body);
}

// File-tour bullet: a `- **label:**` or `* **label:**` item whose bold label
// names a file rather than a concept.
const BOLD_LABEL_BULLET_PATTERN = /^\s*[-*]\s+\*\*([^*]+?)\*\*:/gm;
const FILE_EXTENSION_PATTERN =
  /\.(ts|tsx|js|jsx|mjs|cjs|json|md|txt|py|rb|go|rs|java|c|h|cpp|sh|yml|yaml|toml|css|html|sql)$/i;

function looksLikeFilePath(label: string): boolean {
  const trimmed = label
    .trim()
    .replace(/^`+|`+$/g, "")
    .trim();
  if (trimmed.length === 0) return false;
  if (trimmed.includes("/")) return true;
  return FILE_EXTENSION_PATTERN.test(trimmed);
}

function hasFileTourBullets(body: string): boolean {
  for (const match of body.matchAll(BOLD_LABEL_BULLET_PATTERN)) {
    const label = match[1];
    if (label != null && label !== "" && looksLikeFilePath(label)) return true;
  }
  return false;
}

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

function hasRunOnProse(body: string): boolean {
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

const TELL_PATTERNS = NARRATION_TELLS.map(
  (tell) => [tell, new RegExp(narrationTellSource(tell), "i")] as const,
);

function findNarrationTells(body: string): NarrationTell[] {
  const prose = linesOutsideFences(body).join("\n");
  return TELL_PATTERNS.filter(([, pattern]) => pattern.test(prose)).map(([tell]) => tell);
}

interface SentenceHeading {
  text: string;
  signals: string[];
}

// The classifier's sentence-case signal restates what the AP title-case deny
// already reports, so a heading needs a shape signal beyond its casing to be
// worth a second note. A bare non-linking predicate verb is also too weak on
// its own here: deverbal noun compounds ("Future Work", "Bug Fixes", "Use
// Cases") hit it constantly, so the hook warns only when a linking verb or a
// second signal class confirms the sentence shape. The eval scorer keeps the
// raw classifier.
function isBareNonLinkingVerb(signal: string): boolean {
  const match = signal.match(/^predicate verb "(.+)"$/);
  return match !== null && !LINKING_VERBS.has(match[1] ?? "");
}

function sentenceShapedHeadings(body: string): SentenceHeading[] {
  const flagged: SentenceHeading[] = [];
  for (const text of headingTexts(body)) {
    const signals = classifyPrHeading(stripEmphasis(text)).signals.filter(
      (signal) => !signal.startsWith("sentence case"),
    );
    if (signals.length > 0 && !signals.every(isBareNonLinkingVerb)) {
      flagged.push({ text, signals });
    }
  }
  return flagged;
}

// A body past this length is a document. On a repo the author owns and merges
// alone, nobody is going to read it.
const PERSONAL_BODY_WORD_LIMIT = 450;

const RULES = [
  rule({
    id: "unreadable-body",
    tier: "deny",
    detect: (_body, context) => context.unreadable,
    message: (detail) =>
      `The hook cannot read ${detail}, so none of the body checks ran. Write the body to a file with a quoted heredoc (\`cat > <path> <<'EOF'\`), in the same call or its own, then pass that path: \`--body-file <path>\` on \`gh\`, \`--description-file <path>\` on \`glab\`.`,
  }),
  rule({
    id: "test-count",
    tier: "deny",
    detect: (body) => TEST_COUNT_PATTERN.test(body) || null,
    message: () =>
      "Testing section should not mention test counts. Describe what is covered instead.",
  }),
  rule({
    id: "heading-case",
    tier: "deny",
    detect: (body) => nonEmpty(headingCaseViolations(body)),
    message: (violations) => {
      const suggestions = violations
        .map((violation) => `"${violation.text}" → "${violation.suggested}"`)
        .join("; ");
      return `Section headings should use AP title case. Apply: ${suggestions}. A heading that is intentionally cased (proper noun, code identifier) can be reworded so it satisfies AP case.`;
    },
  }),
  rule({
    id: "backticked-ref",
    tier: "deny",
    detect: async (body, context) =>
      BACKTICKED_REF_PATTERN.test(body) || (await hasBacktickedCommit(body, context)) || null,
    message: () =>
      "Commit SHAs and issue/MR refs (`#123`, `!45`) auto-link on GitHub/GitLab. Backticks render them as code and suppress the link. Write them bare.",
  }),
  rule({
    id: "hard-wrap",
    tier: "deny",
    detect: (body) => nonEmpty(hardWrappedParagraphs(body)),
    message: wrapReason,
  }),
  rule({
    id: "reflexive-scaffold",
    tier: "warn",
    detect: (body) => hasReflexiveScaffold(body) || null,
    message: () =>
      "Small PRs don't need a `## Changes` + `## Testing` scaffold. Length tracks substance. Use prose for a short change.",
  }),
  rule({
    id: "file-tour",
    tier: "warn",
    detect: (body) => hasFileTourBullets(body) || null,
    message: () =>
      "Bullets shaped like `- **path/to/file**: ...` narrate a file tour. Describe the conceptual change instead of walking the diff file by file.",
  }),
  rule({
    id: "ci-status",
    tier: "warn",
    detect: (body) => CI_STATUS_PATTERNS.some((pattern) => pattern.test(body)) || null,
    message: () =>
      "The body states that lint, types, tests, or a build passed. The PR's status checks already show that. Drop it, unless the result is one CI won't post: a manual check CI doesn't run, an intentional exclusion, or a pre-existing warning you're leaving in place.",
  }),
  rule({
    id: "run-on-prose",
    tier: "warn",
    detect: (body) => hasRunOnProse(body) || null,
    message: () =>
      "A prose paragraph runs long: over four sentences, a sentence past 280 characters, or several clauses stacked behind commas. Split the thread, or move an enumeration into a list.",
  }),
  rule({
    id: "narration",
    tier: "warn",
    detect: (body) => nonEmpty(findNarrationTells(body)),
    message: (tells) => {
      const quoted = tells.map((tell) => `"${tell}"`).join(", ");
      return `The body narrates its own writing (${quoted}). A reader who was not in the session cannot tell a deliberate choice from an accidental one, and saying a fact is worth noting is not the same as stating it. Drop the framing and keep the fact.`;
    },
  }),
  rule({
    id: "sentence-heading",
    tier: "warn",
    detect: (body) => nonEmpty(sentenceShapedHeadings(body)),
    message: (headings) => {
      const detail = headings
        .map((heading) => `"${heading.text}" (${heading.signals.join("; ")})`)
        .join(", ");
      return `Headings read as sentences instead of labels: ${detail}. A heading names its section. Move the claim into the prose under it.`;
    },
  }),
  rule({
    id: "personal-length",
    tier: "warn",
    detect: async (body, context) => {
      const words = countProseWords(body);
      if (words <= PERSONAL_BODY_WORD_LIMIT) return null;
      return (await context.personalRepo()) ? words : null;
    },
    message: (words) =>
      `The body runs ${words} words on a repo you own and merge yourself. Nobody else is reading this. Keep what you would want on a bisect six months out and cut the rest.`,
  }),
  rule({
    id: "title-length",
    tier: "warn",
    detect: (_body, context) =>
      context.title !== null && context.title.length > TITLE_LENGTH_LIMIT ? context.title : null,
    message: (title) =>
      `The title runs ${title.length} characters. Under ${TITLE_LENGTH_LIMIT} keeps it readable in a PR list and in \`git log --oneline\`.`,
  }),
  rule({
    id: "title-clauses",
    tier: "warn",
    detect: (_body, context) =>
      context.title !== null && hasClauseStacking(context.title) ? context.title : null,
    message: () =>
      "The title enumerates several changes. Name the change the PR makes and leave the parts to the body.",
  }),
] as const;

export type RuleId = (typeof RULES)[number]["id"];

export interface RuleMatch {
  id: RuleId;
  tier: Tier;
  message: string;
}

export async function scanBody(
  body: string,
  context: Partial<BodyContext> = {},
): Promise<RuleMatch[]> {
  const full: BodyContext = {
    title: context.title ?? null,
    unreadable: context.unreadable ?? null,
    personalRepo: context.personalRepo ?? (() => Promise.resolve(false)),
    hasCommit: context.hasCommit ?? (() => Promise.resolve(false)),
  };
  const matches = await Promise.all(
    RULES.map(async (entry): Promise<RuleMatch | null> => {
      const message = await entry.run(body, full);
      return message === null ? null : { id: entry.id, tier: entry.tier, message };
    }),
  );
  return matches.filter((match): match is RuleMatch => match !== null);
}

// A reason carrying a correction spans several lines. Indenting its
// continuations under the marker keeps each reason one visually bounded item, so
// the next `- ` still reads as the next thing to fix.
function bullets(matches: RuleMatch[]): string {
  return matches.map(({ message }) => `- ${message.replaceAll("\n", "\n  ")}`).join("\n");
}

// A deny reason carries an exact fix, so the whole set is worth reporting at
// once: the model would otherwise rewrite the body, retry, and be blocked again
// by the next one. Warnings ride along on a deny for the same reason.
function decide(matches: RuleMatch[]): SyncHookJSONOutput | null {
  const denies = matches.filter((match) => match.tier === "deny");
  const warns = matches.filter((match) => match.tier === "warn");
  if (denies.length > 0) {
    const alsoWorth =
      warns.length > 0 ? `\nAlso worth addressing in the same edit:\n${bullets(warns)}` : "";
    return {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: `Fix the PR body before retrying:\n${bullets(denies)}${alsoWorth}`,
      },
    };
  }
  if (warns.length === 0) {
    return null;
  }
  const intro =
    warns.length === 1
      ? "This PR has a structural-slop pattern:"
      : "This PR has structural-slop patterns:";
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      additionalContext: `${intro}\n${bullets(warns)}`,
    },
  };
}

export async function validateBody(
  body: string,
  context: Partial<BodyContext> = {},
): Promise<SyncHookJSONOutput | null> {
  return decide(await scanBody(body, context));
}
