#!/usr/bin/env bun

import { cli } from "cleye";
import { resolveFamily, resolveLevel } from "./efforts";
import { load, resolvePlan, type Plan } from "./plan";
import { render } from "./render";

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

const argv = cli({
  name: "review-plan",
  parameters: ["[level]"],
  strictFlags: true,
  help: {
    description:
      "Resolve the review:code plan for a model and effort level: cell, caps, framing, and angle text.",
  },
  flags: {
    model: { type: String, description: "Active model id, e.g. claude-opus-5" },
    diffLines: { type: Number, description: "Changed lines in the range, for the finder budget" },
    noAngles: { type: Boolean, description: "Print the plan block only, without the angle text" },
    json: { type: Boolean, description: "Print the resolved plan as JSON" },
  },
});

const { model, diffLines, noAngles, json } = argv.flags;
if (model === undefined) fail("--model is required. Pass the active model id.");

const { efforts, angles } = await load();
const resolved = resolveLevel(argv._.level ?? "medium", efforts);
if (!resolved.ok) fail(resolved.reason);

const plan = ((): Plan => {
  try {
    return resolvePlan(efforts, angles, {
      family: resolveFamily(model, efforts),
      level: resolved.level,
      diffLines,
    });
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
})();

console.log(
  json === true ? JSON.stringify(plan, null, 2) : render(plan, { angles: noAngles !== true }),
);
