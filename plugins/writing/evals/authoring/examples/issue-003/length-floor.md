---
fail: [length-floor, keeps-encoding, keeps-tracking-issue]
---
<out>
Title: integration_pagerduty_service_object: incorrect URL escaping causes 404s on read

As of version `2.8.0`, the following config will result in successful creation of a PagerDuty service object. On a subsequent refresh, Terraform will be unable to find the resource and prompt to create a replacement, which will fail due to conflict:

```tf
resource "datadog_integration_pagerduty_service_object" "foo" {
  service_name = "foo - bar"
  service_key  = "9876543210123456789"
}
```

This behavior 
</out>
