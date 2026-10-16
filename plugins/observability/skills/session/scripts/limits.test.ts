import { expect, test } from "bun:test";
import { join } from "node:path";

const resourcesDir = join(import.meta.dirname, "..", "resources");

async function statements(name: string): Promise<string> {
  const text = await Bun.file(join(resourcesDir, name)).text();
  return text
    .split("\n")
    .filter((line) => line.trim() !== "" && !line.startsWith("--"))
    .join("\n");
}

test("extensions.sql carries limits.sql unchanged", async () => {
  expect(await statements("extensions.sql")).toContain(await statements("limits.sql"));
});
