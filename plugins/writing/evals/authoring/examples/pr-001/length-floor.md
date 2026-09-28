---
fail: [length-floor, keeps-precedent, keeps-recreate]
---
<out>
Title: `slack_connection`: remove state on 404

This PR modifies the `pagerduty_slack_connection` resource to removes connections that are gone (404) when read.
</out>
