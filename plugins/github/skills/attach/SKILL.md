---
name: github:attach
description: Upload a local image or video to GitHub and reference it so it renders inline in an issue, pull request, comment, or review. Use when attaching a screenshot, screen recording, or generated diagram to GitHub content, or when a body would otherwise link a local path the reader cannot open. Load before posting to uploads.github.com.
allowed-tools:
  - Bash(gh api:*)
  - Bash(gh issue:*)
  - Bash(gh pr:*)
  - Bash(grep:*)
---

# Attachments

Images and video in issues and pull requests are served from a user-attachments store. `POST https://uploads.github.com/user-attachments/assets` puts a file there and answers with the URL to reference. It has no REST route and no documentation, so `gh api` reaches it by full URL.

## Upload

`repository_id` takes the numeric REST id. `gh repo view --json id` returns the GraphQL node id, which fails here.

```bash
repo_id=$(gh api repos/{owner}/{repo} --jq .id)

gh api --method POST \
  "https://uploads.github.com/user-attachments/assets?repository_id=$repo_id&name=picker.png&content_type=image/png" \
  --input ./picker.png --jq .url
```

The response is `{"url": "https://github.com/user-attachments/assets/<uuid>"}`.

The token needs write access to that repository. Read-only access answers 404, which makes a permission problem look like a missing repository.

## File Types

The extension in `name` must agree with `content_type`, and nothing outside this list uploads. Logs, archives, and PDFs have no path here.

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

Images cap at 10 MB. Video caps at 100 MB or lower, depending on the account plan.

## Reference

An image is ordinary markdown, with `\`, `[`, and `]` escaped in the alt text.

```markdown
![Wide window](https://github.com/user-attachments/assets/<uuid>)
```

Video has no markdown syntax. GitHub renders a player when a bare asset URL is the whole of a paragraph.

## Ordering

An upload cannot be undone and an asset cannot be deleted. Upload once the body is final and nothing is left that could cancel. An asset nothing references is stranded and permanent, and it answers 404 until something references it, so opening the URL proves nothing about the upload.

## The --attach Flag

`--attach` on this build: !`gh issue comment --help 2>/dev/null | grep -q -- '--attach' && echo present || echo absent`

Absent means the upload above is the only way. Present means `--attach` replaces it for `gh issue create`, `gh issue edit`, `gh issue comment`, `gh pr create`, `gh pr edit`, and `gh pr comment`. It repeats, takes a path, and takes alt text after a `#`.

```bash
gh issue comment 87 --body-file report.md --attach './picker.png#The wide layout'
```

A body that already links the local path gets that reference rewritten. A body that does not gets the asset appended. Review comments, discussions, releases, and gists are out of the flag's reach and upload through the endpoint either way.
