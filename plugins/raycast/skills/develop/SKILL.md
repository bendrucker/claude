---
name: raycast:develop
description: Run, launch, and preview a Raycast extension. Use to start the dev server, build or lint an extension, or open one of its commands in Raycast to see a change working.
---

# Develop

Work from the extension directory, the one holding the `package.json` with a `commands` array. `ray` is not installed globally, so every command goes through `npm run`.

## Dev Server

Start `npm run dev` in the background. It compiles, imports the extension into Raycast when it is not already there, pins it to the top of root search, hot-reloads on save, and prints logs to its output. It has no non-interactive mode, so leave it running for the session and read its output after each change.

Compile and runtime errors land in that output while the process keeps running, so a healthy exit code proves nothing. Read the output.

## Checks

`npm run build` type-checks and bundles the distribution build. `npm run lint` checks style, and `npm run fix-lint` applies what it can fix.

## Launching a Command

```bash
open 'raycast://extensions/<author>/<extension>/<command>?launchType=userInitiated'
```

`<author>` is the manifest's `owner`, falling back to `author`. `<extension>` is the manifest `name`. `<command>` is the `name` of the entry in `commands`. `launchType=background` runs a no-view command without opening the window. Pass `arguments=` or `context=` as URL-encoded JSON to preload a command's input.

## Reporting

Say what compiled, what launched, and what to look at in the Raycast window. The window itself belongs to the human: no screenshots, no driving the UI.
