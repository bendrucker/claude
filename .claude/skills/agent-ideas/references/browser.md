# X Browser Fallback

`x-only` sources have no usable feed (RSS mirrors are dead or gated, proven this
session). After teleport, the local session has the Claude-in-Chrome extension,
so read these authors' recent posts directly from the browser.

## Which Authors

Read the `x-only` entries from `sources.ts` (their `xHandle` is the timeline to
open). As of this writing: Boris Cherny (`bcherny`), Dillon Mulroy
(`dillon_mulroy`), Dex Horthy (`dexhorthy`).

## Flow

1. Load the browser tools you need via `ToolSearch` (they are deferred):
   `select:mcp__claude-in-chrome__tabs_context_mcp,mcp__claude-in-chrome__tabs_create_mcp,mcp__claude-in-chrome__navigate,mcp__claude-in-chrome__get_page_text`.
2. Call `tabs_context_mcp` first to see the live browser state. Don't reuse tab
   IDs from another session.
3. For each handle, open `https://x.com/<handle>` in a new tab and read the page
   text. Pull the recent posts: text, permalink, and timestamp. Stay within the
   last ~8 days to match the feed window.
4. Mine the posts with the same bar and schema as the feed path (see the mining
   heuristics in [mining.md](mining.md)). Append the resulting cards to the
   keepers.

## Gotchas

- **The extension may not be connected.** If `tabs_context_mcp` errors or returns
  nothing, the browser isn't available. Skip the fallback, note which `x-only`
  authors went unread, and proceed with the feed-derived cards. Don't retry a
  dead extension in a loop.
- **No login, no timeline.** If x.com shows a logged-out wall, the timeline may
  be truncated or empty. Capture what's visible and note the gap rather than
  forcing it.
- **Don't trigger dialogs.** Avoid clicking anything that opens a browser modal;
  it blocks all further extension commands.
