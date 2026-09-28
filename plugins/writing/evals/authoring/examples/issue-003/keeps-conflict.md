---
fail: [keeps-conflict]
---
<out>
Title: integration_pagerduty_service_object: incorrect URL escaping causes 404s on read

As of version `2.8.0`, the following config will result in successful creation of a PagerDuty service object.

```tf
resource "datadog_integration_pagerduty_service_object" "foo" {
  service_name = "foo - bar"
  service_key  = "9876543210123456789"
}
```

`foo+-+bar` should be `foo%20-%20bar` and if correctly URL encoded Datadog will respond as expected.

This is tracked in https://github.com/DataDog/datadog-api-client-go/issues/333 which will be fixed by https://github.com/OpenAPITools/openapi-generator/pull/6618.
</out>
