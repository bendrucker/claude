import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { check, type Mismatch } from "./check";

async function suite(files: Record<string, string>): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), "check-"));
  await Promise.all(Object.entries(files).map(([p, body]) => Bun.write(join(dir, p), body)));
  return dir;
}

const graders = {
  "one/graders/short.md": "---\ntype: regex\npattern: '.{20,}'\nmatch: not_contains\n---\n",
  "one/graders/fact.md": "---\ntype: regex\npattern: '230 ?ms'\nflags: i\n---\n",
  "one/graders/judge.md": "---\ntype: llm\n---\nIs it good?\n",
  "one/graders/twice.md": "---\ntype: regex\npattern: 'p99'\nmatch: count:1\n---\n",
  "one/graders/trace.md": "---\ntype: regex\npattern: 'x'\ntarget: trace\n---\n",
};

test.each<{ name: string; example: string; expected: Mismatch[] }>([
  { name: "a good reply passes every regex", example: "p99 230ms", expected: [] },
  { name: "a declared failure fails", example: "---\nfail: [fact]\n---\np99 none", expected: [] },
  {
    name: "an undeclared failure is reported",
    example: "p99 fell to 230ms after the jitter change",
    expected: [{ example: "examples/one/good.md", grader: "short", expected: "pass" }],
  },
  {
    name: "a count grader fails on the wrong count",
    example: "p99 230ms p99",
    expected: [{ example: "examples/one/good.md", grader: "twice", expected: "pass" }],
  },
  {
    name: "a declared failure that passes is reported",
    example: "---\nfail: [fact]\n---\np99 230MS",
    expected: [{ example: "examples/one/good.md", grader: "fact", expected: "fail" }],
  },
])("$name", async ({ example, expected }) => {
  const dir = await suite({ ...graders, "examples/one/good.md": example });
  expect(await check(dir)).toEqual(expected);
});

test("rejects an example naming a grader the case lacks", async () => {
  const dir = await suite({ ...graders, "examples/one/bad.md": "---\nfail: [nope]\n---\n" });
  expect(check(dir)).rejects.toThrow("unknown graders: nope");
});
