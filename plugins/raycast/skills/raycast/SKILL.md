---
name: raycast
description: >-
  Raycast extension development patterns and API. Use when working with @raycast/api imports,
  package.json files with Raycast commands/tools, npx ray commands, or building Raycast extensions
  with React and TypeScript.
user-invocable: false
---

# Raycast

## Project Structure

Commands map by name to `src/<name>.tsx`. Tools live in `src/tools/<name>.ts`. Use `.tsx` for UI commands, `.ts` for no-view commands and tools. Icons go in `assets/`. The `package.json` serves as both the npm manifest and the Raycast extension manifest.

See [references/manifest.md](references/manifest.md)

## Manifest

The `package.json` is a superset of npm's format with Raycast-specific fields: `commands`, `tools`, `preferences`, `platforms`, `categories`, `icon`, and `author`. Command modes are `view` (renders UI), `no-view` (runs silently), and `menu-bar` (menu bar extra).

See [references/manifest.md](references/manifest.md)

## Components

React-based UI with `@raycast/api`. Top-level views: `List`, `Grid`, `Detail`, `Form`. Wrap actions in `ActionPanel` with `Action` items. Always pass `isLoading` to top-level components. Use `List.EmptyView` for empty states.

See [references/components.md](references/components.md)

## Hooks

`@raycast/utils` provides data-fetching and state hooks: `useFetch` for URL fetching, `usePromise` and `useCachedPromise` for async functions with stale-while-revalidate caching, `useForm` for form validation, `useLocalStorage` for persistent state, and `useExec` for shell commands. Use `keepPreviousData` to prevent flickering during search.

See [references/hooks.md](references/hooks.md)

## AI Tools

Tools export a default async function with a typed `Input` parameter. JSDoc comments on the `Input` type teach the AI how to use the tool. Export a `confirmation` function for destructive operations. Configure `ai.instructions` in `package.json` for extension-level guidance.

See [references/ai-tools.md](references/ai-tools.md)

## Development

Bootstrap with `npx create-raycast-extension`. Install dependencies with `npm install`. Run `npm run dev` for development with hot reloading. Run `npm run build` to type-check and bundle. Run `npm run lint` for code style. Use npm (not yarn or pnpm) and commit `package-lock.json`.

## Store

Extensions require Apple Style Title Case for names. Icons must be 512x512 PNG. Screenshots should be 2000x1250 PNG. Include a `CHANGELOG.md`. Add a `README.md` if setup is required. Run `npm run publish` to submit.

See [references/store.md](references/store.md)
