---
fail: [keeps-example-pod]
---
<out>
Title: Pod name retains random segments from Deployments

We noticed that `%{pod}` is meant to be the "friendly" name of an app, stripping out the randomized parts added by different controllers.

The plugin assumes the pod name has 2 random parts when the second to last part is a numeric string (`is_number?(pod_parts[-2])`). However, this has not been the case for several recent versions of Kubernetes.

ReplicaSets are [named with a encoded version of the pod template hash](https://github.com/kubernetes/kubernetes/pull/51538), seemingly since k8s@1.8. Kubernetes is continuing to move forward in this direction and in a future release [pod template hashes themselves](https://github.com/kubernetes/kubernetes/pull/66094) will be encoded and no longer numeric.

We're still thinking about a better solution for stripping the dynamic parts with the metadata that the plugin receives but wanted to outline the problem in the mean time.
</out>
