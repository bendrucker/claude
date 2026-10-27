#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>

#define NOINLINE __attribute__((noinline))
#define TILE 256

NOINLINE static void render_tile(uint8_t *tile, int index) {
  for (int i = 0; i < TILE * TILE; i++) tile[i] = (uint8_t)(((i / 7) ^ index) & 0xF0);
}

NOINLINE static size_t rle_encode(const uint8_t *tile, uint8_t *out) {
  size_t o = 0;
  for (int i = 0; i < TILE * TILE;) {
    int run = 1;
    while (i + run < TILE * TILE && run < 255) {
      int same = 1;
      for (int k = 0; k <= run && same; k++) same = tile[i + k] == tile[i];
      if (!same) break;
      run++;
    }
    out[o++] = (uint8_t)run;
    out[o++] = tile[i];
    i += run;
  }
  return o;
}

NOINLINE static uint32_t crc_tile(const uint8_t *buf, size_t n) {
  uint32_t crc = 0xFFFFFFFF;
  for (size_t i = 0; i < n; i++) {
    crc ^= buf[i];
    for (int b = 0; b < 8; b++) crc = (crc >> 1) ^ (0xEDB88320 & -(crc & 1));
  }
  return ~crc;
}

int main(int argc, char **argv) {
  int tiles = argc > 1 ? atoi(argv[1]) : 1200;
  uint8_t *tile = malloc(TILE * TILE);
  uint8_t *out = malloc(TILE * TILE * 2);
  uint32_t crc = 0;
  size_t bytes = 0;
  for (int t = 0; t < tiles; t++) {
    render_tile(tile, t);
    size_t n = rle_encode(tile, out);
    crc ^= crc_tile(tile, TILE * TILE);
    bytes += n;
  }
  printf("%d tiles, %zu bytes, crc %08x\n", tiles, bytes, crc);
  free(tile);
  free(out);
  return 0;
}
