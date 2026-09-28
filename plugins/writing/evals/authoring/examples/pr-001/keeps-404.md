---
fail: [keeps-404]
---
<out>
Title: `slack_connection`: drop missing connections

This PR modifies the `pagerduty_slack_connection` resource to drop connections that are gone when read. All other errors should be reported to the user and abort the plan. I've borrowed the implementation already used in other resources, e.g., `pagerduty_service`.

### Expected Behavior

Terraform should successfully refresh/plan, removing the resource from state and planning to re-create it if it's still declared in the configuration.
</out>
