import type { Comment } from "./types";

/**
 * Machine-meaningful comments the audit must never judge or trim. Directives
 * (lint suppressions, compiler pragmas, coverage markers), shebang lines, and
 * license headers carry instructions that tools read. Sending them to a judge
 * wastes tokens, and a mistrim breaks the build. Exemption is checked per line,
 * and one directive line exempts its whole coalesced comment: trimming the
 * prose around a suppression risks orphaning or deleting the directive.
 */

/**
 * Directive shapes matched at the start of a comment line, after its delimiter.
 * Grouped by ecosystem; extend here when a new tool's marker shows up.
 */
const DIRECTIVES: RegExp[] = [
  // JavaScript/TypeScript
  /^eslint-/i,
  /^biome-ignore\b/i,
  /^prettier-ignore\b/i,
  /^oxlint-(disable|enable)\b/i,
  /^oxfmt-ignore\b/i,
  /^@ts-(expect-error|ignore|nocheck|check)\b/,
  /^\/\s*<(reference|amd-module|amd-dependency)\b/,
  /^(istanbul|c8|v8)\s+ignore\b/i,
  /^#(region\b|endregion\b)/i,
  /^tslint:/,
  /^deno-lint-ignore\b/,
  /^[#@]__(PURE|NO_SIDE_EFFECTS)__\b/,
  /^webpack[A-Z]\w*\s*:/,
  /^@vite-ignore\b/,
  /^@license\b/,
  // Python
  /^noqa\b/i,
  /^type:\s*ignore\b/,
  /^(mypy|pylint|ruff|isort|pyright):/i,
  /^fmt:\s*(off|on)\b/,
  /^pragma:/i,
  /^nosec\b/i,
  /^-\*-/,
  // Go
  /^go:\w/,
  /^\+build\b/,
  /^nolint\b/i,
  /^lint:ignore\b/,
  // Ruby
  /^rubocop:/i,
  /^(frozen_string_literal|encoding|warn_indent):/,
  // Shell
  /^shellcheck\s/i,
  // C/C++/Java/Kotlin
  /^NOLINT/,
  /^clang-format\s+(off|on)\b/i,
  /^checkstyle:/i,
  /^NOPMD\b/,
  /^ktlint\b/i,
  /^LCOV_EXCL/,
  /^swiftlint:/,
  // Config and infrastructure
  /^yamllint\s+(disable|enable)/,
  /^tflint-ignore\b/,
  /^checkov:skip\b/,
  /^hadolint\s/,
  // Cross-tool
  /^nosemgrep\b/i,
  /^noinspection\b/,
  /^@formatter:/i,
];

/**
 * Directives whose delimiter is part of the marker, matched against the raw
 * line: ESLint's `/* global` and `/* exported` blocks (a `//` line saying
 * "global" is prose), cgo's `//export` (no space), and the `/*!` a minifier keeps.
 */
const RAW_DIRECTIVES: RegExp[] = [
  /^\s*\/\*\s*(globals?|exported)\s/,
  /^\s*\/\/export\s/,
  /^\s*\/\*!/,
];

/** Pragmas a tool reads only from the file's head docblock. */
const HEAD_PRAGMAS = /^@(vitest-environment|jest-environment|jsxImportSource|flow)\b/;

/** Leading comment delimiter and whitespace on one line, stripped before matching. */
const DELIMITER = /^\s*(?:\/\/|\/\*+|--|#|\*|;|"""|''')?\s*/;

const matchesLine = (text: string, patterns: RegExp[]): boolean =>
  text.split("\n").some((line) => {
    if (RAW_DIRECTIVES.some((pattern) => pattern.test(line))) return true;
    const stripped = line.replace(DELIMITER, "");
    return patterns.some((pattern) => pattern.test(stripped));
  });

/** True when any line of the comment text is a tool directive. */
export function isDirective(text: string): boolean {
  return matchesLine(text, DIRECTIVES);
}

/**
 * The shebang test the extractor and this gate must agree on. Grammars that
 * scope `#` comments scope the shebang too, so the extractor ends a comment run
 * at one; were the two definitions to diverge, a run would absorb the shebang
 * again and exempt the prose below it along with it.
 */
export function isShebangLine(line: string): boolean {
  return line.startsWith("#!");
}

export function isShebang(comment: Comment): boolean {
  return comment.startLine === 1 && isShebangLine(comment.text);
}

/** License headers and pragmas live in a file's first lines; the same words deeper down are prose. */
const HEAD_LINES = 5;

const LICENSE = /SPDX-License-Identifier|\bcopyright\b|\(c\)\s*\d{4}/i;

export function isLicenseHeader(comment: Comment): boolean {
  return comment.startLine <= HEAD_LINES && LICENSE.test(comment.text);
}

export function isHeadPragma(comment: Comment): boolean {
  return comment.startLine <= HEAD_LINES && matchesLine(comment.text, [HEAD_PRAGMAS]);
}

/** cgo compiles the comment directly above `import "C"` as C source. */
export function isCgoPreamble(comment: Comment, lines: readonly string[]): boolean {
  return lines[comment.endLine]?.trim() === 'import "C"';
}

/**
 * The collect-time gate: true when the comment must not reach the judge.
 * `lines` is the file's source, for exemptions that depend on the code below.
 */
export function isExemptComment(comment: Comment, lines: readonly string[] = []): boolean {
  return (
    isShebang(comment) ||
    isLicenseHeader(comment) ||
    isHeadPragma(comment) ||
    isDirective(comment.text) ||
    isCgoPreamble(comment, lines)
  );
}
