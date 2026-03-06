import { describe, expect, it } from "bun:test";
import { execSync } from "node:child_process";
import { join } from "node:path";

const pluginDir = join(import.meta.dirname, "..");

describe("GitHub fetch hook integration", () => {
  it("blocks GitHub repo fetch and shows gh command suggestion", () => {
    const output = execSync(
      `claude --plugin-dir ${pluginDir} --setting-sources local --allowedTools 'WebFetch' --print 'Fetch https://github.com/bendrucker/claude and show me the hook feedback without running any commands'`,
      { encoding: "utf-8", timeout: 60000 },
    ).toString();

    expect(output).toContain("gh repo view");
  }, 60000);
});
