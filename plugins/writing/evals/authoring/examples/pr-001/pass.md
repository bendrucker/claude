---
fail: []
---
<out>
Title: `slack_connection`: remove state on 404

This PR modifies the `pagerduty_slack_connection` resource to removes connections that are gone (404) when read. All other errors should be reported to the user and abort the plan. I've borrowed the implementation already used in other resources, e.g., `pagerduty_service`.

### Current Behavior

When a Slack connection is removed outside of Terraform, the plan fails at refresh:

```
Error: GET API call to https://app.pagerduty.com/integration-slack/workspaces/T03PBSXSU/connections/PX75ILE failed 404 Not Found. Code: 0, Errors: <nil>, Message: Not Found
```

### Expected Behavior

Terraform should successfully refresh/plan, removing the resource from state and planning to re-create it if it's still declared in the configuration.
</out>
