# Inspect or Recover a Merge Train

`glab` has no merge-train command, so use the API directly.

```bash
# Active train for the project
glab api "projects/:id/merge_trains?scope=active" | jq '.[] | {iid: .merge_request.iid, status, target_branch}'

# Clear a stuck entry, then re-arm
glab api --method DELETE "projects/:id/merge_trains/merge_requests/<iid>"
glab api --method POST  "projects/:id/merge_trains/merge_requests/<iid>" --raw-field auto_merge=true
```
