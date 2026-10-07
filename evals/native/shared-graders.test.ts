import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { shareGraders, sharedFor } from "./shared-graders";

const shared = { fired: ["*"], created: ["pr-*"] };

test.each<{ name: string; expected: string[] }>([
  { name: "pr-001", expected: ["fired", "created"] },
  { name: "doc-001", expected: ["fired"] },
])("sharedFor($name)", ({ name, expected }) => {
  expect(sharedFor(shared, name)).toEqual(expected);
});

async function suite(files: Record<string, string>): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), "shared-"));
  await Promise.all(Object.entries(files).map(([p, body]) => Bun.write(join(dir, p), body)));
  return dir;
}

test("shareGraders copies matching graders into cases without their own", async () => {
  const dir = await suite({
    "graders/fired.md": "suite fired",
    "graders/created.md": "suite created",
    "pr-001/case.yaml": "",
    "pr-002/case.yaml": "",
    "pr-002/graders/fired.md": "case fired",
    "doc-001/case.yaml": "",
    "examples/pr-001/pass.md": "",
  });
  await shareGraders(dir, shared);
  const read = (p: string) => Bun.file(join(dir, p)).text();
  expect(await read("pr-001/graders/fired.md")).toBe("suite fired");
  expect(await read("pr-001/graders/created.md")).toBe("suite created");
  expect(await read("pr-002/graders/fired.md")).toBe("case fired");
  expect(await Bun.file(join(dir, "doc-001/graders/created.md")).exists()).toBe(false);
  expect(await Bun.file(join(dir, "examples/graders/fired.md")).exists()).toBe(false);
  expect(await Bun.file(join(dir, "graders/fired.md")).exists()).toBe(false);
});

test("shareGraders rejects a grader suite.yaml names but the suite lacks", async () => {
  const dir = await suite({ "pr-001/case.yaml": "" });
  expect(shareGraders(dir, { gone: ["*"] })).rejects.toThrow("missing grader: gone");
});
