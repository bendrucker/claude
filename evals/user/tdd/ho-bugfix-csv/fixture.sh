#!/usr/bin/env bash
set -euo pipefail
mkdir -p src
cat > src/csv.ts <<'TS'
function splitFields(line: string): string[] {
  return line.split(",");
}

export function parseCsvLine(line: string): string[] {
  return splitFields(line).map((field) => field.replace(/^"|"$/g, ""));
}
TS
cat > src/csv.test.ts <<'TS'
import { expect, test } from "bun:test";
import { parseCsvLine } from "./csv";

test("splits plain fields", () => {
  expect(parseCsvLine("a,b,c")).toEqual(["a", "b", "c"]);
});
TS
