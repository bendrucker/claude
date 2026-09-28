---
fail: [keeps-pr-66094]
---
<out>
Title: Pod name retains random segments from Deployments

We noticed that `%{pod}` is meant to be the "friendly" name of an app, stripping out the randomized parts added by different controllers. A pod created by a `Deployment` on Kubernetes@1.11 is named like this:

```
app-556455c97c-k8tdx
```

The plugin assumes the pod name has 2 random parts when the second to last part is a numeric string (`is_number?(pod_parts[-2])`). However, this has not been the case for several recent versions of Kubernetes.

ReplicaSets are [named with a encoded version of the pod template hash](https://github.com/kubernetes/kubernetes/pull/51538), seemingly since k8s@1.8. Given our example above, there would be a ReplicaSet named `app-556455c97c`. Kubernetes is continuing to move forward in this direction, and future releases will encode the hash further so numeric detection won't hold.

We're still thinking about a better solution for stripping the dynamic parts with the metadata that the plugin receives but wanted to outline the problem in the mean time.
</out>
