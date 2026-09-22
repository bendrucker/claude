import { describe, expect, test } from "bun:test";
import { isDirective, isExemptComment, isLicenseHeader, isShebang } from "./exempt";
import type { Comment } from "./types";

function comment(text: string, startLine = 10): Comment {
  const lines = text.split("\n");
  return {
    kind: "line",
    text,
    startLine,
    endLine: startLine + lines.length - 1,
    startColumn: 0,
    endColumn: lines.at(-1)?.length ?? 0,
  };
}

describe("isDirective", () => {
  test.each([
    "// eslint-disable-next-line no-console",
    "/* eslint-disable */",
    "// biome-ignore lint/suspicious/noExplicitAny: legacy",
    "// prettier-ignore",
    "// @ts-expect-error upstream types lag",
    "// @ts-nocheck",
    "/* istanbul ignore next */",
    "/* c8 ignore start */",
    "//#region setup",
    "// #endregion",
    "# noqa: E501",
    "# type: ignore[arg-type]",
    "# mypy: disallow-untyped-defs",
    "# pylint: disable=too-many-locals",
    "# ruff: noqa",
    "# isort: skip_file",
    "# fmt: off",
    "# pragma: no cover",
    "# nosec B608",
    "# -*- coding: utf-8 -*-",
    "//go:generate mockgen",
    "//go:build linux",
    "// +build linux",
    "//nolint:errcheck",
    "//lint:ignore U1000 kept for cgo",
    "# rubocop:disable Metrics/AbcSize",
    "# frozen_string_literal: true",
    "# shellcheck disable=SC2086",
    "// NOLINTNEXTLINE(readability)",
    "// clang-format off",
    "// CHECKSTYLE:OFF",
    "// NOPMD",
    "// ktlint-disable no-wildcard-imports",
    "// LCOV_EXCL_LINE",
    "# nosemgrep",
    "// noinspection SpellCheckingInspection",
    "// @formatter:off",
    '/// <reference types="vite/client" />',
    "/* global window, document */",
    "/* exported main */",
    "//export GoCallback",
    "# pyright: ignore[reportGeneralTypeIssues]",
    "// tslint:disable-next-line",
    "// deno-lint-ignore no-explicit-any",
    "// swiftlint:disable line_length",
    "# yamllint disable-line rule:line-length",
    "# tflint-ignore: terraform_unused_declarations",
    "# checkov:skip=CKV_AWS_20: public bucket",
    "# hadolint ignore=DL3008",
    "/*#__PURE__*/",
    '/* webpackChunkName: "admin" */',
    "/* @vite-ignore */",
    "/*! lib v1.0 | MIT */",
    "/**\n * @license MIT\n */",
  ])("matches %s", (text) => {
    expect(isDirective(text)).toBe(true);
  });

  test.each([
    "// increments the retry counter",
    "# because the API paginates at 100",
    "// TODO(ENG-1234): drop once the backfill lands",
    "# the linter flags this pattern, so we restructure the loop",
    "// regional failover requires a second bucket",
    "-- pragma comments are documented in the runbook",
    "// global state is reset between tests",
    "// export the handler so the router can find it",
    "// @flow is enabled in the file header",
  ])("passes prose %s", (text) => {
    expect(isDirective(text)).toBe(false);
  });

  test("one directive line exempts a coalesced block", () => {
    const text = "// upstream types lag the runtime\n// @ts-expect-error";
    expect(isDirective(text)).toBe(true);
  });
});

describe("isShebang", () => {
  test("matches #! on line 1 only", () => {
    expect(isShebang(comment("#!/usr/bin/env bun", 1))).toBe(true);
    expect(isShebang(comment("#!/usr/bin/env bun", 3))).toBe(false);
    expect(isShebang(comment("# not a shebang", 1))).toBe(false);
  });
});

describe("isLicenseHeader", () => {
  test.each([
    "// SPDX-License-Identifier: MIT",
    "/* Copyright 2024 Acme Corp */",
    "# copyright (c) 2020 the authors",
  ])("matches %s in the file head", (text) => {
    expect(isLicenseHeader(comment(text, 1))).toBe(true);
  });

  test("the same words deeper in the file are prose", () => {
    expect(isLicenseHeader(comment("// Copyright headers are added by CI", 40))).toBe(false);
  });

  test("a head comment without license words is not exempt", () => {
    expect(isLicenseHeader(comment("// entrypoint for the audit CLI", 1))).toBe(false);
  });
});

describe("isExemptComment", () => {
  test("ordinary comments are judged", () => {
    expect(isExemptComment(comment("// retries twice because the API flakes"))).toBe(false);
  });

  test("directives, shebangs, and license headers are exempt", () => {
    expect(isExemptComment(comment("# noqa"))).toBe(true);
    expect(isExemptComment(comment("#!/bin/sh", 1))).toBe(true);
    expect(isExemptComment(comment("// SPDX-License-Identifier: MIT", 1))).toBe(true);
  });

  test.each<{ name: string; target: Comment; lines?: string[]; exempt: boolean }>([
    { name: "a head pragma", target: comment("/** @jest-environment jsdom */", 1), exempt: true },
    { name: "a flow pragma", target: comment("// @flow strict", 2), exempt: true },
    { name: "a pragma below the head", target: comment("// @flow strict", 40), exempt: false },
    {
      name: 'a cgo preamble above import "C"',
      target: comment("// #include <stdlib.h>", 3),
      lines: ["package main", "", "// #include <stdlib.h>", 'import "C"'],
      exempt: true,
    },
    {
      name: "a comment above an ordinary import",
      target: comment("// the formatter", 3),
      lines: ["package main", "", "// the formatter", 'import "fmt"'],
      exempt: false,
    },
  ])("$name", ({ target, lines, exempt }) => {
    expect(isExemptComment(target, lines)).toBe(exempt);
  });
});
