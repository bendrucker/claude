# tiles

Builds the map tile cache with `tilecut`, which the maps team ships as a signed binary in `vendor/bin/`. Its source isn't in this repo and we can't rebuild it. `vendor/bin/tilecut` with no arguments cuts the standard 1,200-tile region.
