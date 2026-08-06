import { expect, test } from "bun:test";
import {
  type NarrationTell,
  type ScoreOptions,
  type ScoreRow,
  scoreBody,
  scoreTitle,
} from "./score";

// The heading classifier is exercised on its own. These tables pin the scorer's
// wiring with a classifier that flags any heading ending in a question mark.
const stub: ScoreOptions = {
  classify: (heading) =>
    heading.endsWith("?") ? { flagged: true, signals: ["stub"] } : { flagged: false, signals: [] },
};

const RUN_ON = `${"alpha ".repeat(60)}end.`;
const COMMA_SPLICE = `${"beta ".repeat(44)}alpha, bravo, charlie, delta.`;
const FOUR_SENTENCES = "One thing. Two things. Three things. Four things.";
const FIVE_SENTENCES = `${FOUR_SENTENCES} Five things.`;

const FENCED = `Prose line here.

\`\`\`md
## Buried Heading
deliberately worth noting non-obvious
\`\`\`

Tail line.`;

type Metrics = Partial<
  Pick<
    ScoreRow,
    | "wordCount"
    | "headingCaseViolations"
    | "sentenceHeadings"
    | "longSentences"
    | "longParagraphs"
    | "narrationTells"
  >
> & { tells?: Partial<Record<NarrationTell, number>> };

test.each<{ name: string; body: string; expected: Metrics }>([
  {
    name: "clean body",
    body: "## Cache Invalidation\n\nThe cache now keys on the resolved path.\n",
    expected: {
      wordCount: 10,
      headingCaseViolations: 0,
      sentenceHeadings: 0,
      longSentences: 0,
      longParagraphs: 0,
      narrationTells: 0,
    },
  },
  {
    name: "lowercase heading word",
    body: "## Fixing the cache\n\nBody text.\n",
    expected: { headingCaseViolations: 1 },
  },
  {
    name: "sentence-shaped heading",
    body: "## Why Does This Happen?\n\nBody text.\n",
    expected: { sentenceHeadings: 1 },
  },
  {
    name: "h1 and inline hash are not headings",
    body: "# Title Line?\n\nA prose line about #123?\n",
    expected: { sentenceHeadings: 0 },
  },
  {
    name: "run-on sentence past 280 chars",
    body: `Intro.\n\n${RUN_ON}\n`,
    expected: { longSentences: 1 },
  },
  {
    name: "comma stack past 220 chars",
    body: `${COMMA_SPLICE}\n`,
    expected: { longSentences: 1 },
  },
  {
    name: "short sentence with commas is fine",
    body: "Alpha, bravo, charlie, delta.\n",
    expected: { longSentences: 0 },
  },
  {
    name: "list items are not prose sentences",
    body: `- ${RUN_ON}\n`,
    expected: { longSentences: 0 },
  },
  {
    name: "paragraph past the sentence budget",
    body: `${FIVE_SENTENCES}\n`,
    expected: { longParagraphs: 1, longSentences: 0 },
  },
  {
    name: "paragraph at the sentence budget",
    body: `${FOUR_SENTENCES}\n`,
    expected: { longParagraphs: 0 },
  },
  {
    name: "a long list is not a long paragraph",
    body: FIVE_SENTENCES.split(". ")
      .map((sentence) => `- ${sentence}`)
      .join("\n"),
    expected: { longParagraphs: 0 },
  },
  {
    name: "narration tells, case-insensitive",
    body: "Worth noting: the retry is deliberately non-obvious. The old path is left alone deliberately.\n",
    expected: {
      narrationTells: 5,
      tells: { "worth noting": 1, deliberately: 2, "non-obvious": 1, "left alone": 1 },
    },
  },
  {
    name: "tell words need boundaries",
    body: "The undeliberately-named flag stays.\n",
    expected: { narrationTells: 0 },
  },
  {
    name: "fenced code is excluded from every prose metric",
    body: FENCED,
    expected: { wordCount: 5, sentenceHeadings: 0, narrationTells: 0, headingCaseViolations: 0 },
  },
])("scoreBody: $name", ({ body, expected }) => {
  const row = scoreBody(body, undefined, stub);
  const { tells, ...scalars } = expected;
  expect(row).toMatchObject(scalars);
  for (const [tell, count] of Object.entries(tells ?? {})) {
    expect(row.narrationTellCounts[tell as NarrationTell]).toBe(count);
  }
});

test.each<{ name: string; title: string; over50: boolean; clauseStacking: boolean }>([
  {
    name: "plain title",
    title: "Score PR bodies deterministically",
    over50: false,
    clauseStacking: false,
  },
  {
    name: "past the length budget",
    title: "Score generated pull request bodies against the deterministic metric set",
    over50: true,
    clauseStacking: false,
  },
  {
    name: "comma before a conjunction",
    title: "Fix the cache, and drop the retry",
    over50: false,
    clauseStacking: true,
  },
  {
    name: "two commas",
    title: "Rework scoring, add tests, trim dead code",
    over50: false,
    clauseStacking: true,
  },
  {
    name: "colon plus comma",
    title: "score: rework the pipeline, then test it",
    over50: false,
    clauseStacking: true,
  },
])("scoreTitle: $name", ({ title, over50, clauseStacking }) => {
  expect(scoreTitle(title)).toEqual({ text: title, length: title.length, over50, clauseStacking });
});

test("scoreBody carries the title metrics and omits them when absent", () => {
  const body = "Body text.\n";
  expect(scoreBody(body, "Fix the cache, and drop the retry", stub).title).toMatchObject({
    clauseStacking: true,
  });
  expect(scoreBody(body, undefined, stub).title).toBeNull();
});

test("scoreBody defaults to the pr-heading classifier", () => {
  const row = scoreBody("## Why the Cache Misses Under Load\n\nBody text.\n");
  expect(row.sentenceHeadings).toBe(1);
  expect(row.sentenceHeadingDetail[0]?.text).toBe("Why the Cache Misses Under Load");
  expect(row.sentenceHeadingDetail[0]?.signals.length).toBeGreaterThan(0);
});

test("emphasis is stripped before a heading is classified", () => {
  const flagged: string[] = [];
  scoreBody("## **Why Does This Happen?**\n", undefined, {
    classify: (heading) => {
      flagged.push(heading);
      return { flagged: false, signals: [] };
    },
  });
  expect(flagged).toEqual(["Why Does This Happen?"]);
});
