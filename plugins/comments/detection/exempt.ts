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
  /^(istanbul|c8|v8)\s+ignore\b/i,
  /^#(region\b|endregion\b)/i,
  // Python
  /^noqa\b/i,
  /^type:\s*ignore\b/,
  /^(mypy|pylint|ruff|isort):/i,
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
  // Cross-tool
  /^nosemgrep\b/i,
  /^noinspection\b/,
  /^@formatter:/i,
];

/** Leading comment delimiter and whitespace on one line, stripped before matching. */
const DELIMITER = /^\s*(?:\/\/|\/\*|--|#|\*|;|"""|''')?\s*/;

/** True when any line of the comment text is a tool directive. */
export function isDirective(text: string): boolean {
  return text.split("\n").some((line) => {
    const stripped = line.replace(DELIMITER, "");
    return DIRECTIVES.some((pattern) => pattern.test(stripped));
  });
}

export function isShebang(comment: Comment): boolean {
  return comment.startLine === 1 && comment.text.startsWith("#!");
}

/** A license header lives in a file's first lines; the same words deeper down are prose. */
const LICENSE_HEAD_LINES = 5;

const LICENSE = /SPDX-License-Identifier|\bcopyright\b|\(c\)\s*\d{4}/i;

export function isLicenseHeader(comment: Comment): boolean {
  return comment.startLine <= LICENSE_HEAD_LINES && LICENSE.test(comment.text);
}

/** The collect-time gate: true when the comment must not reach the judge. */
export function isExemptComment(comment: Comment): boolean {
  return isShebang(comment) || isLicenseHeader(comment) || isDirective(comment.text);
}
