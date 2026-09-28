---
fail: [keeps-two-contexts]
---

<out>
Title: `--context` flag is not used when finding an attachable pod

The `--context` flag is not fully respected everywhere it should be. When the target is a higher level object, e.g. `service/my-svc`, a Deployment or ReplicaSet generates a randomized pod name per context, and the connection can fail:

```
Error: error upgrading connection: pods "my-app-abc123" not found
```

For now, a workaround is to set the context in the kubeconfig, by using `kubectl config`, [`kubectx`](https://github.com/ahmetb/kubectx/), etc.
</out>
