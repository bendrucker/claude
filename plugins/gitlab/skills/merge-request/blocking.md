# Blocking an MR

Prevent an MR from merging until another MR merges first. Uses the REST API since `glab mr` has no blocking subcommand.

```bash
# Block MR !10 until MR !5 merges
glab api projects/:id/merge_requests/10/blocks -X POST -f blocking_merge_request_iid=5

# List blocks on an MR
glab api projects/:id/merge_requests/10/blocks

# Remove a block
glab api projects/:id/merge_requests/10/blocks/<block-id> -X DELETE
```
