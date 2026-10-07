---
type: regex
pattern: '<out>(?:(?!</out>)[\s\S])*?(kubectl config|kubectx).{0,80}(kubeconfig|context)|((kubeconfig|context).{0,80}(kubectl config|kubectx))'
flags: i
match: contains
---
The body keeps the workaround: setting the context directly in the kubeconfig via `kubectl config` or `kubectx`.
