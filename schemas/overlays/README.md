# Schema overlays

Some schemas in this repo describe formats that Claude Code (Anthropic) owns and
publishes upstream on [SchemaStore](https://www.schemastore.org). For those we
keep **only our edits** — the parts not (yet) upstream — as an
[RFC 6902](https://datatracker.ietf.org/doc/html/rfc6902) JSON Patch
(`<name>.patch.json`). The upstream base is **fetched live and merged with the
overlay in memory at validation time**; the full schema is never vendored or
generated to disk.

[`sources.json`](sources.json) is the registry tying each name to its upstream
URL and patch. `loadOverlaySchema` in
[`packages/validate/overlay.ts`](../../packages/validate/overlay.ts) fetches the
base and applies the patch, and the validators reference a schema by name
(`{ overlay: "settings" }`).

Schemas with **no** upstream (`hook`, `plugin-hook`) are hand-authored directly
in `schemas/` and have no patch here.

## Commands

- **`bun run schemas check`** — CI guard. Fetches current upstream, fails if an
  overlay no longer applies (upstream restructured a path the patch targets) or
  if an overlay op is already in upstream (absorbed — drop the op).
- **`check`** also warns, without failing, when an `add` op targets a path
  upstream now defines with a different value. RFC 6902 `add` overwrites
  silently, so the op replaces upstream's definition. Narrowing upstream this
  way can be deliberate (see `marketplace.patch.json`), so the warning asks for
  a decision rather than failing: confirm the override or drop the op.

## Editing

- To add a field upstream doesn't model yet, add an `add` op to the patch. When
  upstream catches up, `check` flags it so it can be removed and the upstream
  definition takes over.
- A patch may be empty (`[]`) when we adopt upstream wholesale with no edits
  (e.g. `plugin`), keeping the entry only so the config validates against
  upstream.

## Trade-off

Fetching upstream at call time keeps the repo to just our diff, but means
validation (and `check`) require network access to SchemaStore. CI already
fetched these schemas, so this is no new dependency. If pinning to a vendored
snapshot is ever needed for reproducibility, add the base back and read it
instead of fetching.
