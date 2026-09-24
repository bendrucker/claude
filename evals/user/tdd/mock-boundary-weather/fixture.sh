#!/usr/bin/env bash
set -euo pipefail
mkdir -p src
cat > src/format.ts <<'TS'
export function celsius(kelvin: number): string {
  return `${Math.round(kelvin - 273.15)}°C`;
}
TS
cat > src/weather.ts <<'TS'
import { celsius } from "./format";

interface Current {
  tempK: number;
  conditions: string;
}

export async function summary(city: string): Promise<string> {
  const res = await fetch(
    `https://api.weather.example/v1/current?city=${encodeURIComponent(city)}`,
  );
  const body = (await res.json()) as Current;
  return `${city}: ${body.conditions}, ${celsius(body.tempK)}`;
}
TS
