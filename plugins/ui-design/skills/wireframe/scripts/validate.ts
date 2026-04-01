import { DOMParser, type Element as XmlElement } from "@xmldom/xmldom";

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Violation {
  element: string;
  issue: string;
  details: string;
}

export interface ValidationResult {
  file: string;
  violations: Violation[];
}

type Transform = { x: number; y: number };

function attr(el: XmlElement, name: string, fallback = 0): number {
  return Number.parseFloat(el.getAttribute(name) || String(fallback));
}

function getBounds(el: XmlElement, t: Transform = { x: 0, y: 0 }): Bounds | null {
  switch (el.tagName) {
    case "rect":
      return {
        x: t.x + attr(el, "x"),
        y: t.y + attr(el, "y"),
        width: attr(el, "width"),
        height: attr(el, "height"),
      };

    case "text": {
      const x = t.x + attr(el, "x");
      const y = t.y + attr(el, "y");
      const fontSize = attr(el, "font-size", 16);
      const estimatedWidth = (el.textContent || "").length * fontSize * 0.6;
      const anchor = el.getAttribute("text-anchor") || "start";

      let adjustedX = x;
      if (anchor === "middle") {
        adjustedX = x - estimatedWidth / 2;
      } else if (anchor === "end") {
        adjustedX = x - estimatedWidth;
      }

      return {
        x: adjustedX,
        y: y - fontSize,
        width: estimatedWidth,
        height: fontSize * 1.2,
      };
    }

    case "circle": {
      const cx = t.x + attr(el, "cx");
      const cy = t.y + attr(el, "cy");
      const r = attr(el, "r");
      return { x: cx - r, y: cy - r, width: r * 2, height: r * 2 };
    }

    case "ellipse": {
      const cx = t.x + attr(el, "cx");
      const cy = t.y + attr(el, "cy");
      const rx = attr(el, "rx");
      const ry = attr(el, "ry");
      return { x: cx - rx, y: cy - ry, width: rx * 2, height: ry * 2 };
    }

    default:
      return null;
  }
}

function parseTransform(transform: string | null): Transform {
  if (!transform) return { x: 0, y: 0 };
  const match = transform.match(/translate\(\s*([\d.-]+)\s*,\s*([\d.-]+)\s*\)/);
  if (!match?.[1] || !match[2]) return { x: 0, y: 0 };
  return { x: Number.parseFloat(match[1]), y: Number.parseFloat(match[2]) };
}

function applyTransform(parent: Transform, child: Transform): Transform {
  return { x: parent.x + child.x, y: parent.y + child.y };
}

function getElementChildren(el: XmlElement): XmlElement[] {
  return Array.from(el.childNodes).filter((n): n is XmlElement => n.nodeType === 1);
}

function getElementId(el: XmlElement, index: number): string {
  const id = el.getAttribute("id");
  if (id) return `#${id}`;
  const tag = el.tagName;
  if (tag === "text" && el.textContent) {
    return `<text>"${el.textContent.slice(0, 20)}"`;
  }
  return `<${tag}>[${index}]`;
}

function boundsContain(parent: Bounds, child: Bounds): boolean {
  return (
    child.x >= parent.x &&
    child.y >= parent.y &&
    child.x + child.width <= parent.x + parent.width &&
    child.y + child.height <= parent.y + parent.height
  );
}

function boundsOverlap(a: Bounds, b: Bounds): boolean {
  return !(
    a.x + a.width <= b.x ||
    b.x + b.width <= a.x ||
    a.y + a.height <= b.y ||
    b.y + b.height <= a.y
  );
}

function boundsEqual(a: Bounds, b: Bounds): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

function isContainer(el: XmlElement): boolean {
  if (el.tagName !== "rect") return false;
  const fill = el.getAttribute("fill");
  return !fill || fill === "none";
}

interface ChildInfo {
  el: XmlElement;
  bounds: Bounds;
  index: number;
  isBackground: boolean;
}

function validateGroup(
  group: XmlElement,
  parentBounds: Bounds | null,
  parentTransform: Transform,
  violations: Violation[],
): void {
  const currentTransform = applyTransform(
    parentTransform,
    parseTransform(group.getAttribute("transform")),
  );
  const children = getElementChildren(group);
  const childBounds: ChildInfo[] = [];

  for (const [i, child] of children.entries()) {
    const bounds =
      child.tagName === "g"
        ? getGroupBounds(child, currentTransform)
        : getBounds(child, currentTransform);

    if (!bounds) continue;

    if (parentBounds && !boundsContain(parentBounds, bounds)) {
      const details =
        child.tagName === "g"
          ? "Group extends outside parent container"
          : `Element at (${bounds.x}, ${bounds.y}) size ${bounds.width}x${bounds.height} extends outside parent`;
      violations.push({ element: getElementId(child, i), issue: "out-of-bounds", details });
    }

    if (child.tagName === "g") {
      validateGroup(child, bounds || parentBounds, currentTransform, violations);
    }

    const isBackground = parentBounds ? boundsEqual(bounds, parentBounds) : false;
    childBounds.push({ el: child, bounds, index: i, isBackground });
  }

  checkOverlaps(childBounds, violations);
}

function checkOverlaps(childBounds: ChildInfo[], violations: Violation[]): void {
  for (const [i, a] of childBounds.entries()) {
    for (const b of childBounds.slice(i + 1)) {
      if (a.isBackground || b.isBackground) continue;
      if (!boundsOverlap(a.bounds, b.bounds)) continue;
      if (isContainer(a.el) || isContainer(b.el)) continue;

      violations.push({
        element: getElementId(a.el, a.index),
        issue: "overlap",
        details: `Overlaps with ${getElementId(b.el, b.index)}`,
      });
    }
  }
}

function getGroupBounds(group: XmlElement, parentTransform: Transform): Bounds | null {
  const currentTransform = applyTransform(
    parentTransform,
    parseTransform(group.getAttribute("transform")),
  );
  const children = getElementChildren(group);

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const child of children) {
    const bounds =
      child.tagName === "g"
        ? getGroupBounds(child, currentTransform)
        : getBounds(child, currentTransform);

    if (bounds) {
      minX = Math.min(minX, bounds.x);
      minY = Math.min(minY, bounds.y);
      maxX = Math.max(maxX, bounds.x + bounds.width);
      maxY = Math.max(maxY, bounds.y + bounds.height);
    }
  }

  if (minX === Number.POSITIVE_INFINITY) return null;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export function validate(svgContent: string): Violation[] {
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgContent, "image/svg+xml");
  const svg = doc.documentElement;
  const violations: Violation[] = [];

  if (!svg) {
    violations.push({ element: "<svg>", issue: "parse-error", details: "Failed to parse SVG" });
    return violations;
  }

  const width = Number.parseFloat(svg.getAttribute("width") || "0");
  const height = Number.parseFloat(svg.getAttribute("height") || "0");

  if (!width || !height) {
    violations.push({
      element: "<svg>",
      issue: "missing-dimensions",
      details: "SVG must have explicit width and height attributes",
    });
    return violations;
  }

  const svgBounds: Bounds = { x: 0, y: 0, width, height };
  validateGroup(svg, svgBounds, { x: 0, y: 0 }, violations);

  return violations;
}

export async function validateFile(file: string): Promise<ValidationResult> {
  const content = await Bun.file(file).text();
  return { file, violations: validate(content) };
}

export async function validateFiles(files: string[]): Promise<ValidationResult[]> {
  return Promise.all(files.map(validateFile));
}

async function main() {
  const files = process.argv.slice(2);
  if (files.length === 0) {
    console.error("Usage: bun validate.ts <svg-file> [svg-file...]");
    process.exit(1);
  }

  const results = await validateFiles(files);
  let hasErrors = false;

  for (const { file, violations } of results) {
    if (violations.length === 0) {
      console.log(`✓ ${file}: No layout violations found`);
    } else {
      hasErrors = true;
      console.log(`✗ ${file}: Found ${violations.length} violation(s):\n`);
      for (const v of violations) {
        console.log(`  ${v.element}: ${v.issue}`);
        console.log(`    ${v.details}\n`);
      }
    }
  }

  process.exit(hasErrors ? 1 : 0);
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("/bun")) {
  main().catch((error) => {
    console.error("Error:", error.message);
    process.exit(1);
  });
}
