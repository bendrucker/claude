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
    it("accepts a well-formed login screen", async () => {
      const svg = await loadAsset("login-screen");
      const violations = validate(svg);
      expect(violations).toHaveLength(0);
    });

    it("accepts nested groups within bounds", async () => {
      const svg = await loadAsset("nested-groups");
      const violations = validate(svg);
      expect(violations).toHaveLength(0);
    });

    it("accepts a two-column layout", async () => {
      const svg = await loadAsset("two-column");
      const violations = validate(svg);
      expect(violations).toHaveLength(0);
    });

    it("accepts a grid layout", async () => {
      const svg = await loadAsset("grid");
      const violations = validate(svg);
      expect(violations).toHaveLength(0);
    });

    it("accepts a table layout", async () => {
      const svg = await loadAsset("table");
      const violations = validate(svg);
      expect(violations).toHaveLength(0);
    });

    it("accepts a form layout", async () => {
      const svg = await loadAsset("form");
      const violations = validate(svg);
      expect(violations).toHaveLength(0);
    });

    it("accepts a modal dialog", async () => {
      const svg = await loadAsset("modal");
      const violations = validate(svg);
      expect(violations).toHaveLength(0);
    });
  });

  describe("invalid fixtures", () => {
    it("rejects SVG without width/height attributes", async () => {
      const svg = await loadFixture("missing-dimensions");
      const violations = validate(svg);

      expect(violations).toHaveLength(1);
      expect(findViolation(violations, "missing-dimensions")).toBeDefined();
    });

    it("detects elements extending outside canvas", async () => {
      const svg = await loadFixture("element-out-of-bounds");
      const violations = validate(svg);

      expect(violations.length).toBeGreaterThan(0);
      expect(findViolation(violations, "out-of-bounds")).toBeDefined();
    });

    it("detects overlapping sibling elements", async () => {
      const svg = await loadFixture("overlapping-elements");
      const violations = validate(svg);

      expect(violations.length).toBeGreaterThan(0);
      expect(findViolation(violations, "overlap")).toBeDefined();
    });

    it("detects text extending outside container", async () => {
      const svg = await loadFixture("text-outside-container");
      const violations = validate(svg);

      expect(violations.length).toBeGreaterThan(0);
      expect(findViolation(violations, "out-of-bounds")).toBeDefined();
    });

    it("detects group extending outside canvas", async () => {
      const svg = await loadFixture("group-out-of-bounds");
      const violations = validate(svg);

      expect(violations.length).toBeGreaterThan(0);
      expect(findViolation(violations, "out-of-bounds")).toBeDefined();
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
  it("accepts circle within bounds", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">
      <circle cx="50" cy="50" r="40" fill="none" stroke="black"/>
    </svg>`;
    const violations = validate(svg);
    expect(violations).toHaveLength(0);
  });

  it("detects circle out of bounds", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">
      <circle cx="50" cy="50" r="60" fill="none" stroke="black"/>
    </svg>`;
    const violations = validate(svg);
    expect(findViolation(violations, "out-of-bounds")).toBeDefined();
  });

  it("accepts ellipse within bounds", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">
      <ellipse cx="50" cy="50" rx="40" ry="30" fill="none" stroke="black"/>
    </svg>`;
    const violations = validate(svg);
    expect(violations).toHaveLength(0);
  });

  it("detects ellipse out of bounds", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">
      <ellipse cx="50" cy="50" rx="60" ry="30" fill="none" stroke="black"/>
    </svg>`;
    const violations = validate(svg);
    expect(findViolation(violations, "out-of-bounds")).toBeDefined();
  });
});
