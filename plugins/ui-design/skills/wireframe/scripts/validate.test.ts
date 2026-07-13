import { describe, expect, it } from "bun:test";
import path from "node:path";

import { type Violation, validate, validateFile, validateFiles } from "./validate";

const assetsDir = path.join(import.meta.dirname, "..", "assets");
const fixturesDir = path.join(import.meta.dirname, "fixtures");

async function loadAsset(name: string): Promise<string> {
  return Bun.file(path.join(assetsDir, `${name}.svg`)).text();
}

async function loadFixture(name: string): Promise<string> {
  return Bun.file(path.join(fixturesDir, `${name}.svg`)).text();
}

function findViolation(violations: Violation[], issue: string): Violation | undefined {
  return violations.find((v) => v.issue === issue);
}

describe("validate", () => {
  describe("example assets", () => {
    it.each([
      "login-screen",
      "nested-groups",
      "two-column",
      "grid",
      "table",
      "form",
      "modal",
    ])("accepts %s", async (name) => {
      const svg = await loadAsset(name);
      const violations = validate(svg);
      expect(violations).toHaveLength(0);
    });
  });

  describe("invalid fixtures", () => {
    it.each<{ name: string; fixture: string; issue: string; exactCount?: number }>([
      {
        name: "missing width/height attributes",
        fixture: "missing-dimensions",
        issue: "missing-dimensions",
        exactCount: 1,
      },
      {
        name: "element extending outside canvas",
        fixture: "element-out-of-bounds",
        issue: "out-of-bounds",
      },
      { name: "overlapping sibling elements", fixture: "overlapping-elements", issue: "overlap" },
      {
        name: "text extending outside container",
        fixture: "text-outside-container",
        issue: "out-of-bounds",
      },
      {
        name: "group extending outside canvas",
        fixture: "group-out-of-bounds",
        issue: "out-of-bounds",
      },
    ])("detects $name", async ({ fixture, issue, exactCount }) => {
      const svg = await loadFixture(fixture);
      const violations = validate(svg);

      if (exactCount !== undefined) {
        expect(violations).toHaveLength(exactCount);
      } else {
        expect(violations.length).toBeGreaterThan(0);
      }
      expect(findViolation(violations, issue)).toBeDefined();
    });
  });
});

describe("validateFiles", () => {
  it("validates multiple files concurrently", async () => {
    const files = [
      path.join(assetsDir, "login-screen.svg"),
      path.join(assetsDir, "nested-groups.svg"),
      path.join(fixturesDir, "missing-dimensions.svg"),
    ];

    const results = await validateFiles(files);

    expect(results).toHaveLength(3);
    expect(results[0]?.violations).toHaveLength(0);
    expect(results[1]?.violations).toHaveLength(0);
    expect(results[2]?.violations.length).toBeGreaterThan(0);
  });

  it("rejects on file not found", async () => {
    await expect(validateFile("/nonexistent/file.svg")).rejects.toThrow();
  });
});

describe("circle and ellipse elements", () => {
  it.each<{ name: string; svg: string; expectViolation: boolean }>([
    {
      name: "circle within bounds",
      svg: `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">
      <circle cx="50" cy="50" r="40" fill="none" stroke="black"/>
    </svg>`,
      expectViolation: false,
    },
    {
      name: "circle out of bounds",
      svg: `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">
      <circle cx="50" cy="50" r="60" fill="none" stroke="black"/>
    </svg>`,
      expectViolation: true,
    },
    {
      name: "ellipse within bounds",
      svg: `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">
      <ellipse cx="50" cy="50" rx="40" ry="30" fill="none" stroke="black"/>
    </svg>`,
      expectViolation: false,
    },
    {
      name: "ellipse out of bounds",
      svg: `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">
      <ellipse cx="50" cy="50" rx="60" ry="30" fill="none" stroke="black"/>
    </svg>`,
      expectViolation: true,
    },
  ])("$name", ({ svg, expectViolation }) => {
    const violations = validate(svg);
    if (expectViolation) {
      expect(findViolation(violations, "out-of-bounds")).toBeDefined();
    } else {
      expect(violations).toHaveLength(0);
    }
  });
});
