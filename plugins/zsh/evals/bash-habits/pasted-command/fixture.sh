#!/usr/bin/env bash
set -euo pipefail
mkdir -p src/lib
cat > src/store.ts <<'TS'
export const state = { widgetCount: 0 };
TS
cat > src/lib/render.ts <<'TS'
import { state } from "../store";

export function render(): string {
  return `widgets: ${state.widgetCount}`;
}
TS
cat > src/index.ts <<'TS'
export { render } from "./lib/render";
TS
cat > src/notes.md <<'MD'
# Notes

`widgetCount` resets on reload.
MD
cat > src/README.md <<'MD'
The store tracks widgetCount for the renderer.
MD
