---
fail: []
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

This behavior also applies to existing state, and means if you have whitespace in service objects you have to pin to 2.7. Debug logs reveal the issue:

```
-----------------------------------------------------
2020/06/10 18:45:57 [DEBUG] Datadog API Request Details:
---[ REQUEST ]---------------------------------------
GET /api/v1/integration/pagerduty/configuration/services/foo+-+bar HTTP/1.1
Host: api.datadoghq.com
User-Agent: datadog-api-client-go/1.0.0-beta.4 (go go1.14.3; os darwin; arch amd64)
Accept: application/json
Dd-Operation-Id: GetPagerDutyIntegrationService
Accept-Encoding: gzip
```

`foo+-+bar` should be `foo%20-%20bar` and if correctly URL encoded Datadog will respond as expected.

This is tracked in https://github.com/DataDog/datadog-api-client-go/issues/333 which will be fixed by https://github.com/OpenAPITools/openapi-generator/pull/6618. Opening the issue here to track the release of a fix and in case others should stumble onto the same problem.
</out>
