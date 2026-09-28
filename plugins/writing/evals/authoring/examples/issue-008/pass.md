<out>
Title: `--context` flag is not used when finding an attachable pod

When calling the plugin with `--context`, the context setting does not propagate when attempting to find an attachable pod. Given a current context set via kubeconfig of `a`, and `--context b`, the resulting behavior is:

* Pod is found using context `a`
* Port forwarding connection is attempted with context `b`

When the pod is found using a higher level object, e.g. `service/my-svc`, both contexts may have the same objects. In this case, an attachable pod will be found in `a`, but attempts to connect to the named pod in `b` will likely fail since higher order controllers (Deployment/Replica Set) generate randomized pod names.

```
Error: error upgrading connection: pods "my-app-abc123" not found
```

For now, a workaround is to set the context in the kubeconfig, by using `kubectl config`, [`kubectx`](https://github.com/ahmetb/kubectx/), etc.
</out>
