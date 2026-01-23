import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";

describe.skipIf(!process.env.INTEGRATION)("GitHub fetch hook integration", () => {
  it("blocks GitHub repo fetch and shows gh command suggestion", () => {
    const output = execSync(
      `claude --allowedTools 'WebFetch' --print 'Fetch https://github.com/bendrucker/deployments and show me the hook feedback without running any commands'`,
      { encoding: "utf-8", timeout: 60000 },
    ).toString();

    expect(output).toContain("gh repo view");
  }, 60000);
});
