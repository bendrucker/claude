#!/usr/bin/env bun

import { cli } from "cleye";
import { join } from "node:path";
import { table } from "table";
import type { ScoresFile } from "./score";

const root = join(import.meta.dirname, "..");

interface CommitLabel {
  repo: string;
  sha: string;
  grade: number;
  docsIntent: boolean;
  confidence: string;
}

interface SessionLabel {
  id: string;
  host: string;
  grade: number;
  docsIntent: boolean;
}

/** Ranks with ties averaged, as Spearman requires. */
function ranks(values: number[]): number[] {
  const order = values.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const out = Array.from({ length: values.length }, () => 0);
  let pos = 0;
  while (pos < order.length) {
    const value = order[pos]?.v;
    let end = pos;
    while (end + 1 < order.length && order[end + 1]?.v === value) end++;
    const rank = (pos + end) / 2 + 1;
    for (let k = pos; k <= end; k++) {
      const item = order[k];
      if (item) out[item.i] = rank;
    }
    pos = end + 1;
  }
  return out;
}

export function spearman(a: number[], b: number[]): number {
  if (a.length < 2) return NaN;
  const ra = ranks(a);
  const rb = ranks(b);
  const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
  const ma = mean(ra);
  const mb = mean(rb);
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < a.length; i++) {
    const x = (ra[i] ?? 0) - ma;
    const y = (rb[i] ?? 0) - mb;
    num += x * y;
    da += x ** 2;
    db += y ** 2;
  }
  const denom = Math.sqrt(da * db);
  return denom === 0 ? NaN : num / denom;
}

function prf(
  tp: number,
  fp: number,
  fn: number,
): { precision: number; recall: number; f1: number } {
  const precision = tp + fp === 0 ? NaN : tp / (tp + fp);
  const recall = tp + fn === 0 ? NaN : tp / (tp + fn);
  const f1 =
    Number.isNaN(precision) || Number.isNaN(recall) || precision + recall === 0
      ? NaN
      : (2 * precision * recall) / (precision + recall);
  return { precision, recall, f1 };
}

const fires = (tier: string) => tier === "report" || tier === "strong";

async function main(): Promise<void> {
  const argv = cli({
    name: "metrics",
    help: {
      description: "Compute eval metrics from scores.json plus labels, append to history.jsonl.",
    },
    flags: {
      scores: {
        type: String,
        description: "Path to the scores JSON from score.ts",
        default: join(root, "results", "scores.json"),
      },
      note: {
        type: String,
        description: "Tag for this run in history.jsonl",
      },
    },
  });

  const scores = (await Bun.file(argv.flags.scores).json()) as ScoresFile;
  const commitLabels = (await Bun.file(
    join(root, "labels", "commits.json"),
  ).json()) as CommitLabel[];
  const sessionLabels = (await Bun.file(
    join(root, "labels", "sessions.json"),
  ).json()) as SessionLabel[];
  const complaintIds = (await Bun.file(join(root, "labels", "complaints.json")).json()) as string[];

  const commitScores = new Map(scores.commits.map((c) => [`${c.repo}@${c.sha}`, c]));
  const commitUnits = commitLabels.flatMap((label) => {
    const row = commitScores.get(`${label.repo}@${label.sha}`);
    return row?.measurable && row.score ? [{ label, score: row.score }] : [];
  });

  const commitRho = spearman(
    commitUnits.map((u) => u.score.excessChars),
    commitUnits.map((u) => u.label.grade),
  );

  let ctp = 0;
  let cfp = 0;
  let cfn = 0;
  for (const { label, score } of commitUnits) {
    const positive = label.grade >= 2;
    const predicted = score.tier === "strong";
    if (predicted && positive) ctp++;
    else if (predicted && !positive) cfp++;
    else if (!predicted && positive) cfn++;
  }
  const commit = prf(ctp, cfp, cfn);

  const sessionUnits = sessionLabels.flatMap((label) => {
    const row = scores.sessions[label.id];
    return row?.measurable && row.score ? [{ label, score: row.score }] : [];
  });
  let stp = 0;
  let sfp = 0;
  let sfn = 0;
  for (const { label, score } of sessionUnits) {
    if (label.docsIntent) continue;
    const positive = label.grade >= 2;
    const predicted = fires(score.tier);
    if (predicted && positive) stp++;
    else if (predicted && !positive) sfp++;
    else if (!predicted && positive) sfn++;
  }
  const session = prf(stp, sfp, sfn);

  const measurableComplaints = complaintIds.filter((id) => scores.sessions[id]?.measurable);
  const complaintFired = measurableComplaints.filter((id) => {
    const score = scores.sessions[id]?.score;
    return score != null && fires(score.tier);
  });
  const complaintRecall =
    measurableComplaints.length === 0 ? NaN : complaintFired.length / measurableComplaints.length;

  const gradeZero = [
    ...commitUnits.filter((u) => u.label.grade === 0 && !u.label.docsIntent),
    ...sessionUnits.filter((u) => u.label.grade === 0 && !u.label.docsIntent),
  ];
  const falseFire0 =
    gradeZero.length === 0
      ? NaN
      : gradeZero.filter((u) => fires(u.score.tier)).length / gradeZero.length;

  const docsUnits = [
    ...commitUnits.filter((u) => u.label.docsIntent),
    ...sessionUnits.filter((u) => u.label.docsIntent),
  ];
  const docsPassLeak = docsUnits.filter((u) => fires(u.score.tier)).length;

  const metrics = {
    commitRho,
    commitPrecision: commit.precision,
    commitRecall: commit.recall,
    commitF1: commit.f1,
    sessionPrecision: session.precision,
    sessionRecall: session.recall,
    complaintRecall,
    falseFire0,
    docsPassLeak,
    objective: commitRho + session.precision,
  };
  const counts = {
    commitsMeasurable: commitUnits.length,
    commitsLabeled: commitLabels.length,
    sessionsMeasurable: sessionUnits.length,
    sessionsLabeled: sessionLabels.length,
    complaintsMeasurable: measurableComplaints.length,
    complaintsLabeled: complaintIds.length,
    gradeZeroUnits: gradeZero.length,
    docsIntentUnits: docsUnits.length,
  };

  const record = {
    at: new Date().toISOString(),
    note: argv.flags.note ?? null,
    metrics,
    counts,
  };
  const historyPath = join(root, "results", "history.jsonl");
  const existing = (await Bun.file(historyPath).exists()) ? await Bun.file(historyPath).text() : "";
  await Bun.write(historyPath, `${existing}${JSON.stringify(record)}\n`);

  const fmt = (n: number) => (Number.isNaN(n) ? "NaN" : n.toFixed(3));
  console.log(
    table([
      ["metric", "value", "constraint"],
      ["commitRho", fmt(commitRho), ""],
      ["commitPrecision (strong, grade>=2)", fmt(commit.precision), ""],
      ["commitRecall", fmt(commit.recall), ""],
      ["commitF1", fmt(commit.f1), ""],
      ["sessionPrecision (report+, grade>=2)", fmt(session.precision), ""],
      ["sessionRecall", fmt(session.recall), ""],
      ["complaintRecall", fmt(complaintRecall), ""],
      ["falseFire0", fmt(falseFire0), "<= 0.10"],
      ["docsPassLeak", String(docsPassLeak), "= 0"],
      ["objective (rho + sessionPrecision)", fmt(metrics.objective), ""],
    ]),
  );
  const noteSuffix = argv.flags.note ? `, note: ${argv.flags.note}` : "";
  console.log(
    `commits ${counts.commitsMeasurable}/${counts.commitsLabeled} measurable, sessions ${counts.sessionsMeasurable}/${counts.sessionsLabeled}, complaints ${counts.complaintsMeasurable}/${counts.complaintsLabeled}${noteSuffix}`,
  );
}

if (import.meta.main) {
  await main();
}
