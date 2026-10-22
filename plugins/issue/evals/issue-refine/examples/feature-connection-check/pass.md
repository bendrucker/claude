---
fail: []
---
<issue>
---
title: Let users check whether an OAuth connection still works
type: feature
relations:
  related:
    - https://tracker.example.com/issue/TEAM-2440
---

A broken connection surfaces only when a chat fails mid-answer. Add `POST /api/oauth/connection/check`, which takes a connection id, calls the vendor, and returns ok or one of: token revoked, PKCE state expired, vendor error, timeout.

Out of scope: scheduled reprobing, and writing chat failures back to integration status.

The vendor [access policy](https://docs.example-vendor.com/access-policies#scopes) may filter per tool. Before choosing the probe, call a restricted-policy connection through both `call_tool` and `health`, and use whichever reports the failure.

## 🤖 Agent Context

- `VendorClient.call_tool` and `VendorClient.health` in `api/oauth/client.py`
</issue>
