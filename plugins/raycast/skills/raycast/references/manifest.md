# Manifest

The `package.json` is both the npm manifest and the Raycast extension manifest.

## Required Extension Fields

- **name**: Unique identifier, used in Store URL
- **title**: Display name in Store and preferences
- **description**: Full description shown in Store
- **icon**: PNG file (512x512) in `assets/`, supports `icon@dark.png` for themes
- **author**: Raycast Store username
- **platforms**: `["macOS"]`, `["Windows"]`, or `["macOS", "Windows"]`
- **categories**: Array from: Applications, Communication, Data, Design Tools, Developer Tools, Documentation, Finance, Fun, Media, News, Productivity, Security, System, Web, Other
- **license**: `"MIT"`
- **commands**: Array of command objects

## Command Properties

```json
{
  "name": "search",
  "title": "Search Items",
  "description": "Search all items by keyword",
  "mode": "view",
  "keywords": ["find", "lookup"],
  "arguments": [
    {
      "name": "query",
      "type": "text",
      "placeholder": "Search query",
      "required": true
    }
  ],
  "preferences": [
    {
      "name": "apiKey",
      "title": "API Key",
      "description": "Your API key",
      "type": "password",
      "required": true
    }
  ]
}
```

- **name**: Maps to `src/<name>.tsx` entry file
- **title**: Display name in root search
- **mode**: `"view"` (renders UI), `"no-view"` (runs silently), `"menu-bar"` (menu bar extra)
- **interval**: Background refresh for no-view/menu-bar (e.g., `"1m"`, `"12h"`, `"1d"`)
- **arguments**: Inline inputs, types: `"text"`, `"password"`, `"dropdown"`
- **preferences**: Stored settings, types: `"textfield"`, `"password"`, `"checkbox"`, `"dropdown"`, `"appPicker"`, `"file"`, `"directory"`

## Tools Manifest

```json
{
  "tools": [
    {
      "name": "get-items",
      "title": "Get Items",
      "description": "Retrieve all items from the database"
    }
  ]
}
```

Each tool maps to `src/tools/<name>.ts`.

## AI Configuration

```json
{
  "ai": {
    "instructions": "Always confirm before deleting items",
    "evals": [
      {
        "input": "@my-ext list all items",
        "mocks": {
          "get-items": [{ "id": "1", "title": "Item 1" }]
        },
        "expected": [{ "callsTool": "get-items" }]
      }
    ]
  }
}
```

Move lengthy AI config to a separate `ai.yaml` or `ai.json5` file alongside `package.json`.

## Complete Example

```json
{
  "name": "github-links",
  "title": "GitHub Formatter",
  "description": "Format GitHub PRs and issues as markdown links",
  "icon": "icon.png",
  "author": "your_username",
  "platforms": ["macOS"],
  "categories": ["Developer Tools", "Productivity"],
  "license": "MIT",
  "commands": [
    {
      "name": "format-link",
      "title": "Format PR Link",
      "description": "Convert a GitHub PR URL to a markdown link",
      "mode": "view"
    },
    {
      "name": "sync",
      "title": "Sync PRs",
      "description": "Background sync of pull requests",
      "mode": "no-view",
      "interval": "5m"
    }
  ],
  "tools": [
    {
      "name": "get-prs",
      "title": "Get Pull Requests",
      "description": "Fetch open PRs from a repository"
    }
  ],
  "preferences": [
    {
      "name": "token",
      "title": "GitHub Token",
      "description": "Personal access token",
      "type": "password",
      "required": true
    }
  ],
  "ai": {
    "instructions": "Format PRs as [#number title](url)"
  },
  "dependencies": {
    "@raycast/api": "^1.93.0",
    "@raycast/utils": "^1.19.0"
  },
  "devDependencies": {
    "@raycast/eslint-config": "^1.0.11",
    "typescript": "^5.7.0"
  }
}
```
