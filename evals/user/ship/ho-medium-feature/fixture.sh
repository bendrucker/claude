#!/usr/bin/env bash
set -euo pipefail
git init -q -b main
echo "/.*" >> .git/info/exclude
git config user.name "Ben Drucker"
git config user.email bvdrucker@gmail.com
git config commit.gpgsign false
git init -q --bare .origin.git
git remote add origin "$PWD/.origin.git"
mkdir -p src test
cat > package.json <<'JSON'
{ "name": "csvlite", "type": "module", "scripts": { "test": "bun test" } }
JSON
cat > src/row.ts <<'TS'
export function splitRow(line: string): string[] {
  return line.split(",");
}
TS
cat > src/parse.ts <<'TS'
import { splitRow } from "./row";

export function parse(text: string): string[][] {
  return text.split("\n").filter(Boolean).map(splitRow);
}
TS
git add -A && git commit -qm "csvlite: naive parser"
git push -qu origin main
git switch -qc quoted-fields
cat > src/row.ts <<'TS'
export function splitRow(line: string, delimiter = ","): string[] {
  const fields: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted && c === '"' && line[i + 1] === '"') {
      field += '"';
      i++;
    } else if (c === '"') {
      quoted = !quoted;
    } else if (c === delimiter && !quoted) {
      fields.push(field);
      field = "";
    } else {
      field += c;
    }
  }
  fields.push(field);
  return fields;
}
TS
cat > src/parse.ts <<'TS'
import { splitRow } from "./row";

export interface ParseOptions {
  delimiter?: string;
  header?: boolean;
}

export function parse(text: string, { delimiter = ",", header = false }: ParseOptions = {}): string[][] {
  const rows = text.split(/\r?\n/).filter(Boolean).map((line) => splitRow(line, delimiter));
  return header ? rows.slice(1) : rows;
}
TS
cat > test/parse.test.ts <<'TS'
import { expect, test } from "bun:test";
import { parse } from "../src/parse";

test("keeps delimiters and escaped quotes inside quoted fields", () => {
  expect(parse('a,"b,c","say ""hi"""')).toEqual([["a", "b,c", 'say "hi"']]);
});

test("skips the header row and honors another delimiter", () => {
  expect(parse("x;y\r\n1;2", { delimiter: ";", header: true })).toEqual([["1", "2"]]);
});
TS
git add -A && git commit -qm "csvlite: quoted fields, delimiters, and headers"
