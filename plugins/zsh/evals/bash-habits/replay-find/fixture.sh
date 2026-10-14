#!/usr/bin/env bash
set -euo pipefail
mkdir -p src/store src/components src/lib src/api tests docs config scripts node_modules/widget-kit
printf '{\n  "name": "widgets",\n  "scripts": { "test": "vitest" }\n}\n' > package.json
printf '# Widgets\n\nA dashboard that counts widgets.\n' > README.md
cat > src/store/state.ts <<'TS'
export interface State {
  widgetCount: number;
  label: string;
}

export const initial: State = { widgetCount: 0, label: "widgets" };
TS
cat > src/store/actions.ts <<'TS'
import type { State } from "./state";

export const add = (s: State): State => ({ ...s, widgetCount: s.widgetCount + 1 });
export const reset = (s: State): State => ({ ...s, widgetCount: 0 });
TS
cat > src/components/Counter.tsx <<'TS'
import type { State } from "../store/state";

export function Counter({ state }: { state: State }) {
  return <span className="count">{state.widgetCount}</span>;
}
TS
cat > src/components/Summary.vue <<'VUE'
<script setup lang="ts">
defineProps<{ widgetCount: number }>();
</script>

<template>
  <p>{{ widgetCount }} widgets</p>
</template>
VUE
cat > src/api/serialize.ts <<'TS'
import type { State } from "../store/state";

export const toJson = (s: State) => JSON.stringify({ count: s.widgetCount, label: s.label });
TS
cat > src/lib/format.ts <<'TS'
export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
TS
for name in theme routes logger; do
  printf 'export const %s = {};\n' "$name" > "src/lib/$name.ts"
done
cat > tests/actions.test.ts <<'TS'
import { add, reset } from "../src/store/actions";
import { initial } from "../src/store/state";

test("add", () => expect(add(initial).widgetCount).toBe(1));
test("reset", () => expect(reset(add(initial)).widgetCount).toBe(0));
TS
cat > tests/format.test.ts <<'TS'
import { plural } from "../src/lib/format";

test("plural", () => expect(plural(2, "widget")).toBe("2 widgets"));
TS
printf '# State\n\n`widgetCount` holds the number of widgets on the dashboard.\n' > docs/state.md
printf '# API\n\nThe JSON payload exposes `count`, read from the store.\n' > docs/api.md
printf 'dashboard:\n  max_widgets: 50\n  show_widgetCount: true\n' > config/dashboard.yaml
printf 'logging:\n  level: info\n' > config/logging.yaml
printf '#!/bin/sh\ngrep -c widgetCount src/store/state.ts\n' > scripts/check.sh
printf 'module.exports = { widgetCount: () => 0 };\n' > node_modules/widget-kit/index.js
