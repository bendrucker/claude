# relayd

Routes messages across a pool of workers, caching each route and journaling a sample of them. `make` builds `build/relayd`, and running it with no arguments replays the load described in `relayd.conf`.
