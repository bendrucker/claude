---
fail: [length-floor, keeps-since-1-8, keeps-pr-51538, keeps-pr-66094]
---
<out>
Title: Pod name retains random segments from Deployments

We noticed that `%{pod}` is meant to be the "friendly" name of an app, stripping out the randomized parts added by different controllers. A pod created by a `Deployment` on Kubernetes@1.11 is named like this:

```
app-556455c97c-k8tdx
```

The plugin assumes the pod name has 2 random parts when the second to last part is a numeric string (`is_number?(pod_parts[-2])`). 
</out>
