---
name: github:attach
description: Attach a local image or video to GitHub content so it renders inline in an issue, pull request, comment, or review. Use when attaching a screenshot, recording, or diagram to GitHub content.
allowed-tools:
  - Bash(gh api:*)
  - Bash(gh issue:*)
  - Bash(gh pr:*)
  - Bash(grep:*)
---

# Attachments

Images and video in issues and pull requests are served from a user-attachments store. `gh` 2.99.0 added a repeatable `--attach` flag that uploads to it from `gh issue create`, `gh issue edit`, `gh issue comment`, `gh pr create`, `gh pr edit`, and `gh pr comment`. Everything else uploads through the endpoint the flag wraps: review comments and pending reviews, discussions, releases, gists, GitHub Enterprise Server, and any `gh` older than 2.99.0.

`--attach` on this build: !`gh issue comment --help 2>/dev/null | grep -q -- '--attach' && echo present || echo absent`

Absent means this `gh` predates 2.99.0. Upgrade it (`brew upgrade gh`) or use the endpoint.

## The Flag

Write the body with the local path in the markdown, then name each file on the command. `gh` uploads it and rewrites the reference in place. The image lands where the prose put it. The alt text written in the body wins.

```bash
gh pr create --title "..." --body-file tmp/pr-body.md --attach ./picker.png --attach ./walkthrough.mp4
```

- A path is absolute or relative to the directory `gh` runs in.
- A file the body never references is appended to the end, in flag order, with the filename as alt text. Alt text follows the path after `#`: `--attach './picker.png#The wide layout'`.
- `gh pr edit` and `gh issue edit` without a body flag keep the existing body and append.
- Up to 50 files per command.
- When some uploads fail, the issue, pull request, or comment still lands with the ones that succeeded, its URL prints, and the exit status is non-zero. Read the output before retrying, or the retry duplicates the assets that did upload.
- The token needs write access to the repository.

## The Endpoint

`POST https://uploads.github.com/user-attachments/assets` has no REST route and no documentation, so `gh api` reaches it by full URL. `repository_id` takes the numeric REST id. `gh repo view --json id` returns the GraphQL node id, which fails here.

```bash
repo_id=$(gh api repos/{owner}/{repo} --jq .id)

gh api --method POST \
  "https://uploads.github.com/user-attachments/assets?repository_id=$repo_id&name=picker.png&content_type=image/png" \
  --input ./picker.png --jq .url
```

The response is `{"url": "https://github.com/user-attachments/assets/<uuid>"}`. The token needs write access to that repository. Read-only access answers 404, which makes a permission problem look like a missing repository.

An image is ordinary markdown, with `\`, `[`, and `]` escaped in the alt text.

```markdown
![Wide window](https://github.com/user-attachments/assets/<uuid>)
```

Video has no markdown syntax and no alt text. GitHub renders a player when a bare asset URL is the whole of a paragraph.

## File Types

Both paths accept the same list, and nothing outside it uploads. Logs, archives, and PDFs have no path here. On the endpoint, the extension in `name` must agree with `content_type`.

| Extension | `content_type` |
| --- | --- |
| `.png` | `image/png` |
| `.jpg`, `.jpeg` | `image/jpeg` |
| `.gif` | `image/gif` |
| `.webp` | `image/webp` |
| `.svg` | `image/svg+xml` |
| `.mp4` | `video/mp4` |
| `.mov` | `video/quicktime` |
| `.webm` | `video/webm` |

Images cap at 10 MB. Video caps at 100 MB on a paid plan and 10 MB on a free one.

## Ordering

An upload cannot be undone and an asset cannot be deleted. Upload once the body is final and nothing is left that could cancel. An asset nothing references is stranded and permanent, and it answers 404 until something references it, so opening the URL proves nothing about the upload.
