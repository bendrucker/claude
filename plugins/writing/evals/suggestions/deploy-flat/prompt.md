Here's my draft of our deploy doc. Save it as `docs/deploy.rst` and add a Rollback section that documents `./deploy.sh --rollback <sha>`, which redeploys the image built from that commit.

```rst
Deploying
=========

The ``deploy.sh`` script builds the image — then pushes it to the registry.

It might be worth noting that the script requires Docker 24 or newer.

Run it from the repository root in order to pick up ``.env``::

    ./deploy.sh --env staging

Images are tagged with the commit SHA.

The rollout gives every team a seamless deploy across all regions.

However, staging deploys skip the approval step.

Never run ``deploy.sh`` against production without ``--confirm``.
```
