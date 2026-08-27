#!/usr/bin/env bun
import { cli } from "cleye";
import { parseIssue } from "./frontmatter";

// Mechanical scorer for the issue:refine rubric (see ../RUBRIC.md). Reads a
// refined issue artifact (YAML frontmatter + body) and reports rubric
// violations. Title and type come from the frontmatter; findings 1-5 scan the
// body only, so the frontmatter's relation URLs never trip the bare-reference
// or file:line checks. The judgment-call findings (jargon-in-context,
// over-structuring) are scored loosely here and left to the LLM judge in the
// A/B harness.

const argv = cli({
  name: "score",
  flags: {
    input: {
      type: String,
      description: "Path to a refined issue markdown file. Omit to read stdin.",
    },
    title: { type: String, description: "Override the title (default: frontmatter title)" },
    json: { type: Boolean, default: false, description: "Emit JSON instead of a human report" },
  },
});

const SEVERITY_WEIGHT = { critical: 3, minor: 1 } as const;
type Severity = keyof typeof SEVERITY_WEIGHT;

type Violation = {
  finding: number;
  severity: Severity;
  line: number;
  excerpt: string;
  message: string;
};

// Tunable word lists. These came out of the labeling and are meant to grow.
const JARGON = [
  "seam",
  "disposition",
  "leverage",
  "robust",
  "seamless",
  "utilize",
  "facilitate",
  "holistic",
  "synergy",
  "paradigm",
];
const MARKETING = [
  "blazing",
  "powerful",
  "cutting-edge",
  "world-class",
  "effortless",
  "delightful",
  "robustly",
  "reality",
];
const SMALL_WORDS = new Set([
  "a",
  "an",
  "the",
  "and",
  "but",
  "or",
  "nor",
  "for",
  "of",
  "in",
  "on",
  "to",
  "with",
  "vs",
  "via",
  "per",
  "at",
  "by",
  "as",
  "from",
  "into",
  "over",
  "under",
]);

const raw = argv.flags.input ? await Bun.file(argv.flags.input).text() : await Bun.stdin.text();
const { title: fmTitle, type, body } = parseIssue(raw);
const title = argv.flags.title ?? fmTitle;

// The frontmatter title has no line in the body; point title findings at the
// top of the file.
const TITLE_LINE = 1;

const lines = body.split("\n");
const headings = lines
  .map((l, i) => ({ line: i + 1, m: l.match(/^(#{1,6})\s+(.*\S)\s*$/) }))
  .filter((h): h is { line: number; m: RegExpMatchArray } => h.m != null)
  .map((h) => ({ line: h.line, level: (h.m[1] ?? "").length, text: h.m[2] ?? "" }));

const violations: Violation[] = [];
const add = (finding: number, severity: Severity, line: number, excerpt: string, message: string) =>
  violations.push({ finding, severity, line, excerpt, message });

// Finding 1: title-case noun-phrase headings. A body H1 is a defect on its own:
// the title lives in the frontmatter, so the body should never open one.
const stripCode = (s: string) => s.replace(/`[^`]*`/g, "").replace(/\[[^\]]*\]\([^)]*\)/g, "$&");
for (const h of headings) {
  if (h.level === 1) {
    add(
      1,
      "critical",
      h.line,
      h.text,
      "Body has an H1 heading. The title belongs in the frontmatter.",
    );
    continue;
  }
  const bare = h.text.replace(/^\d+[.)]\s*/, "");
  if (/,\s*(not|never|n't)\b/i.test(bare) || /\bn't\b/.test(bare)) {
    add(
      1,
      "critical",
      h.line,
      h.text,
      'Heading uses "X, not Y" antithesis. Make it a plain noun phrase.',
    );
    continue;
  }
  if (/[.?!]$/.test(bare))
    add(1, "minor", h.line, h.text, "Heading reads as a sentence. Use a noun phrase.");
  const words = stripCode(bare).split(/\s+/).filter(Boolean);
  const major = words.filter(
    (w) => /[a-z]/i.test(w) && !w.includes("`") && !/^[A-Z0-9_]+$/.test(w),
  );
  const lowerMajor = major
    .filter((w, i) => !SMALL_WORDS.has(w.toLowerCase()) || i === 0)
    .filter((w) => /^[a-z]/.test(w));
  if (lowerMajor.length)
    add(
      1,
      "minor",
      h.line,
      h.text,
      `Not title case (lowercase: ${lowerMajor.slice(0, 3).join(", ")}).`,
    );
}

// Finding 2: native links for issue/PR references; no bare numbers or raw URLs.
const linkTargets = new Set([...body.matchAll(/\]\(([^)]+)\)/g)].map((m) => m[1]));
lines.forEach((l, i) => {
  const noLinks = l.replace(/\[[^\]]*\]\([^)]*\)/g, "").replace(/`[^`]*`/g, "");
  for (const m of noLinks.matchAll(/\b[A-Z]{2,}-\d+\b/g))
    add(2, "critical", i + 1, m[0], "Bare tracker reference. Use a link that expands inline.");
  for (const m of noLinks.matchAll(/(?:^|\s)(#\d+|MR\s*!\d+|!\d+)\b/g))
    add(
      2,
      "critical",
      i + 1,
      m[1] ?? m[0],
      "Bare issue/PR number. Use a link that expands inline.",
    );
  for (const m of noLinks.matchAll(/https?:\/\/\S+/g)) {
    if (!linkTargets.has(m[0]))
      add(2, "minor", i + 1, m[0], "Raw URL pasted as text. Use a titled link or native relation.");
  }
});
const relatedHeading = headings.find((h) => /related issues/i.test(h.text));
if (relatedHeading)
  add(
    2,
    "minor",
    relatedHeading.line,
    relatedHeading.text,
    "Standalone Related Issues section. Prefer the tracker's native relations.",
  );

// Finding 3: no volatile line-number citations.
lines.forEach((l, i) => {
  for (const m of l.matchAll(/#L\d+(?:-L?\d+)?/g))
    add(
      3,
      "critical",
      i + 1,
      m[0],
      "Volatile line anchor. Cite the symbol and quote the lines inline.",
    );
  for (const m of l.matchAll(/\b[\w./-]+\.\w+:\d+(?:-\d+)?\b/g))
    add(
      3,
      "critical",
      i + 1,
      m[0],
      "Volatile file:line citation. Cite the symbol and quote the lines inline.",
    );
});

// Finding 4: jargon and marketing words.
lines.forEach((l, i) => {
  const lower = l.toLowerCase();
  for (const w of [...JARGON, ...MARKETING]) {
    const re = new RegExp(`\\b${w}\\b`, "i");
    if (re.test(lower))
      add(4, "minor", i + 1, w, `Jargon/marketing word "${w}". Use a plainer word.`);
  }
});

// Finding 5: over-structuring (heading density, thin option menus, filler heads).
const bodyWords = body.split(/\s+/).filter(Boolean).length;
const subHeadings = headings.filter((h) => h.level > 1).length;
const headingBudget = Math.max(4, Math.floor(bodyWords / 150));
if (subHeadings > headingBudget)
  add(
    5,
    "minor",
    1,
    `${subHeadings} headings / ${bodyWords} words`,
    `Over-structured: ${subHeadings} headings for ${bodyWords} words.`,
  );
const optionHeading = headings.find((h) => /\boption/i.test(h.text));
if (optionHeading)
  add(
    5,
    "minor",
    optionHeading.line,
    optionHeading.text,
    "Option menu. Prefer the chosen approach or goal + acceptance criteria.",
  );
const summaryHeading = headings.find((h) => h.level === 2 && /^summary$/i.test(h.text));
if (summaryHeading)
  add(
    5,
    "minor",
    summaryHeading.line,
    summaryHeading.text,
    "Summary heading is filler. The body opens with the summary prose directly.",
  );

// Finding 6: concise, sentence-case title from the frontmatter.
if (title) {
  if (title.length > 80)
    add(6, "minor", TITLE_LINE, title, `Title is ${title.length} chars. Keep it short.`);
  if (/\(.*\)/.test(title))
    add(6, "minor", TITLE_LINE, title, "Title carries a parenthetical. Trim it.");
  // Sentence case: only the first word and proper nouns capitalize. Skip the
  // first word, pure acronyms/numbers (CSV, 200), and small words. Title case
  // capitalizes every remaining content word, so flag only when two or more are
  // capitalized and none stays lowercase; a proper noun or two leaves lowercase
  // content words behind and reads as a sentence.
  const titleContent = stripCode(title)
    .split(/\s+/)
    .filter(Boolean)
    .slice(1)
    .filter((w) => /[a-z]/.test(w) && !/^\d/.test(w))
    .filter((w) => !SMALL_WORDS.has(w.toLowerCase()));
  const capitalized = titleContent.filter((w) => /^[A-Z]/.test(w));
  const lowercaseContent = titleContent.filter((w) => /^[a-z]/.test(w));
  if (capitalized.length >= 2 && lowercaseContent.length === 0)
    add(
      6,
      "minor",
      TITLE_LINE,
      title,
      `Title looks title-cased (${capitalized.slice(0, 3).join(", ")}). Use sentence case.`,
    );
}

const score = violations.reduce((s, v) => s + SEVERITY_WEIGHT[v.severity], 0);
const byFinding = violations.reduce<Record<number, number>>((m, v) => {
  m[v.finding] = (m[v.finding] ?? 0) + 1;
  return m;
}, {});

if (argv.flags.json) {
  console.log(JSON.stringify({ title, type, score, byFinding, violations }, null, 2));
} else {
  console.log(`Title: ${title || "(none)"}`);
  console.log(`Type:  ${type || "(none)"}`);
  console.log(`Score: ${score} (lower is better) · ${violations.length} violations\n`);
  for (const v of violations.sort(
    (a, b) => SEVERITY_WEIGHT[b.severity] - SEVERITY_WEIGHT[a.severity] || a.finding - b.finding,
  )) {
    console.log(
      `  [${v.severity}] finding ${v.finding} · L${v.line} · "${v.excerpt.slice(0, 60)}"`,
    );
    console.log(`      ${v.message}`);
  }
  if (!violations.length) console.log("  clean");
}
