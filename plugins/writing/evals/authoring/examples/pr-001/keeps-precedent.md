---
fail: [keeps-precedent]
---
<out>
Title: `slack_connection`: remove state on 404

This PR modifies the `pagerduty_slack_connection` resource to remove connections that are gone (404) when read. All other errors should be reported to the user and abort the plan.

### Expected Behavior

Terraform should successfully refresh/plan, removing the resource from state and planning to re-create it if it's still declared in the configuration.
</out>
