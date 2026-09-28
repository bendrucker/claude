---
fail: [keeps-controller-cause]
---

<out>
Title: `--context` flag is not used when finding an attachable pod

When calling the plugin with `--context`, the context setting does not propagate when attempting to find an attachable pod. Given a current context set via kubeconfig of `a`, and `--context b`, the pod is found using context `a`, but the port forwarding connection is attempted with context `b`:

```
Error: error upgrading connection: pods "my-app-abc123" not found
```

For now, a workaround is to set the context in the kubeconfig, by using `kubectl config`, [`kubectx`](https://github.com/ahmetb/kubectx/), etc.
</out>
