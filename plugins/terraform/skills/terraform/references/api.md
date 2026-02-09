# TFC API Reference

Endpoints that supplement the MCP server's capabilities. All requests require `Authorization: Bearer $TFE_TOKEN` and `Content-Type: application/vnd.api+json` headers unless noted.

## Applies

```
GET /api/v2/applies/{apply-id}
```

Response (relevant fields):

```json
{
  "data": {
    "id": "apply-abc123",
    "type": "applies",
    "attributes": {
      "status": "finished",
      "log-read-url": "https://archivist.terraform.io/v1/object/...",
      "resource-additions": 1,
      "resource-changes": 0,
      "resource-destructions": 0
    }
  }
}
```

## Plans

```
GET /api/v2/plans/{plan-id}
```

Response (relevant fields):

```json
{
  "data": {
    "id": "plan-abc123",
    "type": "plans",
    "attributes": {
      "status": "finished",
      "log-read-url": "https://archivist.terraform.io/v1/object/...",
      "resource-additions": 1,
      "resource-changes": 0,
      "resource-destructions": 0
    }
  }
}
```

## Log Retrieval

The `log-read-url` from applies and plans is a pre-signed archivist URL. Fetch it directly with no auth headers:

```bash
curl -s "https://archivist.terraform.io/v1/object/..."
```

Returns raw text output (the same format as `terraform apply` or `terraform plan` terminal output).

## Run Relationships

`get_run_details` from the MCP server returns relationships that map to these API endpoints:

- `relationships.apply.data.id` → use with `/api/v2/applies/{id}`
- `relationships.plan.data.id` → use with `/api/v2/plans/{id}`

## Base URL

All API paths are relative to `https://app.terraform.io`. For Terraform Enterprise, substitute your instance hostname.
