---
fail: [keeps-workaround]
---

<out>
Title: `--context` flag is not used when finding an attachable pod

When calling the plugin with `--context`, the context setting does not propagate when attempting to find an attachable pod. Given a current context set via kubeconfig of `a`, and `--context b`, the pod is found using context `a`, but the port forwarding connection is attempted with context `b`. This mostly surfaces on a higher level object, e.g. `service/my-svc`, since a Deployment or ReplicaSet generates a randomized pod name per context:

```
Error: error upgrading connection: pods "my-app-abc123" not found
```
</out>
