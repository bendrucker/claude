The level lookup is case-sensitive. `levels` has lowercase keys, so `LOG_LEVEL=DEBUG` finds nothing and falls back to info. `LOG_LEVEL=debug` works.
