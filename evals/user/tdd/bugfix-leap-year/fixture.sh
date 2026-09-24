#!/usr/bin/env bash
set -euo pipefail
mkdir -p src
cat > src/calendar.ts <<'TS'
function isLeapYear(year: number): boolean {
  return year % 4 === 0;
}

export function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}
TS
cat > src/calendar.test.ts <<'TS'
import { expect, test } from "bun:test";
import { daysInMonth } from "./calendar";

test("January has 31 days", () => {
  expect(daysInMonth(2023, 1)).toBe(31);
});

test("April has 30 days", () => {
  expect(daysInMonth(2023, 4)).toBe(30);
});

test("February has 29 days in 2024", () => {
  expect(daysInMonth(2024, 2)).toBe(29);
});
TS
