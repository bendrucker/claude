#!/usr/bin/env bun
import { join } from "node:path";
import { Command } from "@commander-js/extra-typings";
import { serializeCase } from "../../../../../packages/evals/cases";

export const BUCKETS = ["skill", "grader", "reach", "floor"] as const;
export type Bucket = (typeof BUCKETS)[number];

export interface BucketCase {
  name: string;
  bucket: Bucket;
  split: "dev" | "holdout";
}

/** The hand-written `prompt.md` of each case sits beside the files this script writes. */
export const CASES: BucketCase[] = [
  { name: "bucket-skill-lead-line", bucket: "skill", split: "dev" },
  { name: "bucket-skill-hedged-limit", bucket: "skill", split: "holdout" },
  { name: "bucket-grader-key-order", bucket: "grader", split: "dev" },
  { name: "bucket-grader-negated", bucket: "grader", split: "holdout" },
  { name: "bucket-reach-no-skill-call", bucket: "reach", split: "dev" },
  { name: "bucket-reach-description-miss", bucket: "reach", split: "holdout" },
  { name: "bucket-floor-missing-input", bucket: "floor", split: "dev" },
  { name: "bucket-floor-hard-digest", bucket: "floor", split: "holdout" },
];

const CAUSES: Record<Bucket, { gloss: string; reason: string[] }> = {
  skill: {
    gloss:
      "The skill fired and the reply still breaks a rule it states, so a candidate can target it.",
    reason: [
      "broke",
      "breaks",
      "broken",
      "ignor",
      "violat",
      "disobey",
      "didn't follow",
      "did not follow",
      "not follow",
      "hedg",
      "contradict",
      "against the (rule|skill)",
      "skill (caused|failed)",
    ],
  },
  grader: {
    gloss: "The reply meets the intent and the grader failed it, so the fix is the grader.",
    reason: [
      "key order",
      "order of (the )?keys",
      "keys? (is|are) (serialized|written)",
      "anchored",
      "grader (is|was) (wrong|too|failing|broken|at fault)",
      "(regex|pattern) (is |was )?(too|wrong|misses|missed|doesn't|does not)",
      "negat",
      "ruled out",
      "rules out",
      "meets the intent",
      "intent",
      "(reply|output|behou?r) is (right|correct|fine)",
      "false (negative|fail)",
    ],
  },
  reach: {
    gloss: "The skill never fired, so the reply is the model's default.",
    reason: [
      "never (fired|fire|loaded|invoked|called|triggered)",
      "(did not|didn't|does not|doesn't|wasn't|was not) (fire|load|invoke|call|trigger)",
      "no `?skill`? call",
      "skill (never|didn't|did not|wasn't)",
      "model('s)? default",
      "description",
      "trigger",
      "0/6",
    ],
  },
  floor: {
    gloss: "The model cannot do it at this tier, and the stronger-model check fails too.",
    reason: [
      "(at|on) this tier",
      "(cannot|can't|could not|couldn't) (be )?(do|done|answer|know|compute|see|determine)",
      "stronger model",
      "larger model",
      "higher tier",
      "tier above",
      "scaling run",
      "beyond",
      "never provides",
      "not provided",
      "missing",
      "no copy",
      "without (the )?(ticket|tool|information)",
    ],
  },
};

const LINE = "^[\\s>*_#-]*bucket[*_\\s]*:[*_\\s`]*";
const ANY = BUCKETS.join("|");

/** A `Bucket:` line naming `bucket` with no later `Bucket:` line after it. */
export function lastBucket(bucket: Bucket): string {
  return String.raw`${LINE}(?:${bucket})\b(?![\s\S]*${LINE}(?:${ANY})\b)`;
}

const SYSTEM =
  "Nothing can be built or run in this session, and nobody answers while you work, so reply once. End the reply with one line naming the bucket: `Bucket: skill`, `Bucket: grader`, `Bucket: reach`, or `Bucket: floor`.";

export function caseYaml(c: BucketCase): string {
  return serializeCase({
    schema_version: "1.1",
    name: c.name,
    tags: ["bucket", c.split],
    plugins: ["../../.."],
    execution: {
      model: "claude-sonnet-5-5",
      max_turns: 4,
      timeout_seconds: 300,
      allowed_tools: ["Skill"],
      append_system_prompt: SYSTEM,
    },
  });
}

export function graders(c: BucketCase): Record<string, string> {
  const last = lastBucket(c.bucket);
  const cause = CAUSES[c.bucket];
  return {
    "bucket.md": [
      "---",
      "type: regex",
      `pattern: '${last}'`,
      "flags: im",
      "match: contains",
      "---",
      `The reply's last \`Bucket:\` line is \`${c.bucket}\`. ${cause.gloss}`,
      "",
    ].join("\n"),
    "reason.md": [
      "---",
      "type: regex",
      `pattern: '^(?<![\\s\\S])(?=[\\s\\S]*${last})(?=[\\s\\S]*(?:${cause.reason.join("|").replaceAll("'", "''")}))'`,
      "flags: im",
      "match: contains",
      "---",
      `The reply's last \`Bucket:\` line is \`${c.bucket}\` and its reason names the cause. ${cause.gloss}`,
      "",
    ].join("\n"),
  };
}

/** Every generated file of a case by path relative to the suite. */
export function files(c: BucketCase): Record<string, string> {
  const out: Record<string, string> = { [join(c.name, "case.yaml")]: caseYaml(c) };
  for (const [file, text] of Object.entries(graders(c))) out[join(c.name, "graders", file)] = text;
  return out;
}

export const program = new Command("gen-bucket.ts")
  .description("Write the case.yaml and graders of the hand-written bucket-* cases")
  .action(async () => {
    const suite = join(import.meta.dir, "..");
    await Promise.all(
      CASES.flatMap((c) =>
        Object.entries(files(c)).map(([f, text]) => Bun.write(join(suite, f), text)),
      ),
    );
    console.log(`wrote ${CASES.length} cases`);
  });

if (import.meta.main) await program.parseAsync();
