# Browser

Profile a web app with the `agent-browser` CLI, which drives a real Chrome and records Chrome DevTools traces. Load an `agent-browser` skill for session and command details when one is installed, or read `agent-browser --help`.

## Record

```bash
agent-browser profiler start
# drive the scenario: navigate, click, type, scroll
agent-browser profiler stop tmp/profile/<name>.json
```

The file is a Chrome trace. The user opens it in the DevTools Performance panel or [Perfetto](https://ui.perfetto.dev). Pass `--categories` to narrow what the trace records when the file gets large.

For React apps, `agent-browser react renders` counts component renders, and `--json` gives a machine-readable count per component.

## Reading It

- Rank main-thread time by task type: scripting, style and layout, paint, idle. A main thread that stays busy longer than about 50 ms at a stretch blocks input.
- For animation or streaming UI, count frames over the budget (16.7 ms at 60 Hz) and report the worst ones.
- Network waterfalls answer load-time questions. The CPU profile answers interaction questions. Pick the one matching the scenario.

## Deterministic Signals

Browser wall time is noisy. Deterministic counts make better fast signals: renders per component, layout count, long tasks, DOM nodes, bytes transferred. Check each against wall time on the baseline before trusting it.

## Gotchas

- A development build (React dev mode, unminified bundles, profiling builds) inflates and reshapes the profile. Profile a production build, or say which build it was.
- Throttle the CPU through CDP (`Emulation.setCPUThrottlingRate`) to mimic slower user hardware. A fast laptop hides work that users feel.
- Extensions, an open DevTools panel, and a warm HTTP cache all change the result. Record in a clean profile with the cache state the scenario calls for.
