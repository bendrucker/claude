---
fail: [keeps-recreate]
---
<out>
Title: `slack_connection`: remove state on 404

This PR modifies the `pagerduty_slack_connection` resource to remove connections that are gone (404) when read. All other errors should be reported to the user and abort the plan. I've borrowed the implementation already used in other resources, e.g., `pagerduty_service`.
</out>
