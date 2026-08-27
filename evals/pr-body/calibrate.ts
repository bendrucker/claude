import { join } from "node:path";
import { z } from "zod";
import { decodeFile } from "../../packages/decode/index";
import { classifyPrHeading } from "./classifier";

const Label = z.looseObject({
  text: z.string(),
  verdict: z.enum(["good", "bad", "skip"]).nullable(),
});

const labels = await decodeFile(z.array(Label), join(import.meta.dirname, "labels.json"));

const labeled = labels.filter((l) => l.verdict === "good" || l.verdict === "bad");

let tp = 0; // bad, flagged
let fp = 0; // good but flagged
let tn = 0; // good, passed
let fn = 0; // bad but missed

const falsePositives: { text: string; signals: string[] }[] = [];
const falseNegatives: { text: string; signals: string[] }[] = [];

for (const item of labeled) {
  const { flagged, signals } = classifyPrHeading(item.text);
  const isBad = item.verdict === "bad";
  if (isBad && flagged) tp++;
  else if (isBad && !flagged) {
    fn++;
    falseNegatives.push({ text: item.text, signals });
  } else if (!isBad && flagged) {
    fp++;
    falsePositives.push({ text: item.text, signals });
  } else tn++;
}

const precision = tp / (tp + fp) || 0;
const recall = tp / (tp + fn) || 0;
const f1 = (2 * precision * recall) / (precision + recall) || 0;
const accuracy = (tp + tn) / labeled.length;

console.log(`Labeled items: ${labeled.length}`);
console.log(
  `  bad: ${labeled.filter((l) => l.verdict === "bad").length}  good: ${labeled.filter((l) => l.verdict === "good").length}`,
);
console.log("");
console.log("Confusion matrix (flagged=bad):");
console.log(`  TP (bad, flagged)   : ${tp}`);
console.log(`  FP (good, flagged)  : ${fp}`);
console.log(`  TN (good, passed)   : ${tn}`);
console.log(`  FN (bad, missed)    : ${fn}`);
console.log("");
console.log(`Precision : ${precision.toFixed(3)}`);
console.log(`Recall    : ${recall.toFixed(3)}`);
console.log(`F1        : ${f1.toFixed(3)}`);
console.log(`Accuracy  : ${accuracy.toFixed(3)}`);
console.log("");

console.log(`FALSE POSITIVES (good items flagged) — ${falsePositives.length}:`);
for (const fpItem of falsePositives) {
  console.log(`  "${fpItem.text}"`);
  console.log(`      signals: ${fpItem.signals.join(", ")}`);
}
console.log("");

console.log(`FALSE NEGATIVES (bad items missed, no lexical tell) — ${falseNegatives.length}:`);
for (const fnItem of falseNegatives) {
  console.log(`  "${fnItem.text}"`);
  console.log(
    `      signals fired: ${fnItem.signals.length ? fnItem.signals.join(", ") : "(none)"}`,
  );
}
