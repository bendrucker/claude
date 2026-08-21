---
name: github:attach
description: Upload a local image or video to GitHub and reference it so it renders inline in an issue, pull request, comment, or review. Use when attaching a screenshot, screen recording, or generated diagram to GitHub content, or when a body would otherwise link a local path the reader cannot open. Load before posting to uploads.github.com.
allowed-tools:
  - Bash(gh api:*)
  - Bash(gh repo view:*)
  - Bash(gh issue:*)
  - Bash(gh pr:*)
---

# Attachments

Images and video dropped into an issue or pull request on the web are served from a user-attachments store. `POST https://uploads.github.com/user-attachments/assets` puts a file there and answers with the URL to reference. The endpoint has no REST route and no documentation, so `gh api` reaches it by full URL. It is what the web uploader calls, and what `gh --attach` calls.

## Upload

`repository_id` takes the numeric REST id, which the REST repository route carries. The `id` field of `gh repo view --json id` is the GraphQL node id and fails here.

```bash
repo_id=$(gh api repos/{owner}/{repo} --jq .id)

gh api --method POST \
  "https://uploads.github.com/user-attachments/assets?repository_id=$repo_id&name=picker-wide.png&content_type=image/png" \
  --input ./picker-wide.png --jq .url
```

The response is `{"url": "https://github.com/user-attachments/assets/<uuid>"}`. `--input` sends the file's bytes unmodified, and `gh api` supplies the token, so nothing needs `gh auth token` by hand.

## File Types

Nine types upload, and the extension in `name` must agree with `content_type`. A mismatch fails validation naming both fields.

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

Anything else comes back as `content_type is not included in the list of allowed content types`. Logs, archives, and PDFs have no path here. Summarize a log into the body rather than attaching it. Images cap at 10 MB and video at 100 MB. The video ceiling varies by account plan. The server can refuse a file under that bound.

## Token and Access

The token needs write access to the repository named by `repository_id`. Read and triage answer 404. A permission problem arrives looking like a missing repository.

A classic PAT, a fine-grained PAT, and the OAuth token behind `gh auth token` all upload. `gh` refuses every other kind before sending, including a GitHub App installation token. That is what an Actions run gets as the default `GITHUB_TOKEN`. A workflow that attaches needs a PAT in its environment.

GitHub Enterprise Server has no upload host. github.com and ghe.com data-residency tenants have one.

## Reference

An image is ordinary markdown. Escape `\`, `[`, and `]` in alt text and replace newlines with spaces, or alt text carrying `](url)` closes the image early and repoints it.

```markdown
![Wide window](https://github.com/user-attachments/assets/<uuid>)
```

Video has no markdown syntax. GitHub renders a player when a bare asset URL is the whole of a paragraph. Give it its own line with a blank line on each side.

## Ordering

An upload cannot be undone, and an asset cannot be deleted. Upload once nothing is left that could cancel: after the editor closes, after the confirmation, after the body is final. An asset nothing references is stranded, unreachable, and permanent.

An asset takes the visibility of the repository it was uploaded against once something references it. Until then it answers 404 to everyone except an authenticated uploader. Opening the URL tells you nothing about whether the upload worked.

## The --attach Flag

`gh` is adding a repeatable `--attach` to `gh issue create`, `gh issue edit`, `gh issue comment`, `gh pr create`, `gh pr edit`, and `gh pr comment`. It posts to the same endpoint under the same limits.

```bash
gh issue comment 87 --body-file report.md --attach './picker-wide.png#The wide layout'
```

Alt text follows a `#`, and a video takes none. A body that already links the local path gets that reference rewritten to the uploaded URL. A body that does not gets the asset appended.

`gh issue comment --help` says whether the running build has it. Prefer it where it exists. The flag reaches those six commands only, so review comments, review bodies, discussions, releases, commit comments, and gists still upload first and write the URL into the body.
