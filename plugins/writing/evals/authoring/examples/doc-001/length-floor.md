---
fail: [length-floor, keeps-orphan-risk, keeps-term-reconcile, keeps-grace-period]
---
<out># terraform-apply-timeout

> Demonstrates how Terraform behaves when it is interrupted before completion

## Reproduction

### Module

The module in this repository includes:

* `null_resource`, which will apply effectively instantly
* `time_sleep`, which is configured to take 1 minute to create

This provides a module that can be interrupted, with one completed resource and one incomplete. Sending the relevant signal after a delay is implemented using [`timeout`](https://man7.org/linux/man-pages/man1/timeout.1.html).

### Apply

At the start of an apply, Terraform writes the _resources_ to the state file. This records the declared resources and key statically evaluable properties, namely:

* `type`
* `name`
* `provider`

However, at this stage, the `instances` for the resources are unchanged and will be empty for new objects. Given the two resources in this module, `.resources[*]` has t
</out>
