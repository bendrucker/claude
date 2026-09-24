`deploy prod` runs one process, top to bottom:

```text
main.ts
  loadProfile("prod")           # cluster prod-east
  deploy("prod", profile)
    buildImage()                # docker build, tag = short sha
    pushImage(tag, cluster)
    rollout(cluster, tag)       # returns the previous tag
    waitHealthy(cluster, 120)
      false → rollback(cluster, previous), throw
    announce("prod", tag)
```
