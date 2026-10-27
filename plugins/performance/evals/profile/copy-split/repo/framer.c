#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define NOINLINE __attribute__((noinline))
#define FRAME 4096
#define STAGING (FRAME * 8)
#define RECENT 2048

typedef struct {
  int frames;
  int log_entries;
  int checksum_rounds;
} config;

static config load_config(const char *path) {
  config c = {20000, 6000, 3};
  FILE *f = fopen(path, "r");
  if (!f) return c;
  char key[32];
  int value;
  while (fscanf(f, "%31s %d", key, &value) == 2) {
    if (!strcmp(key, "frames")) c.frames = value;
    if (!strcmp(key, "log_entries")) c.log_entries = value;
    if (!strcmp(key, "checksum_rounds")) c.checksum_rounds = value;
  }
  fclose(f);
  return c;
}

NOINLINE static uint32_t encode_frame(uint8_t *dst, const uint8_t *src, int rounds) {
  memcpy(dst, src, STAGING);
  uint32_t sum = 0;
  for (int r = 0; r < rounds; r++)
    for (int i = 0; i < FRAME; i++) sum = (sum << 1 | sum >> 31) ^ dst[i];
  return sum;
}

NOINLINE static uint32_t compact_log(uint32_t *log, int *len, int cap, uint32_t entry) {
  if (*len == cap) {
    memmove(log, log + 1, (size_t)(cap - 1) * sizeof *log);
    (*len)--;
  }
  log[(*len)++] = entry;
  uint32_t h = 0;
  for (int i = *len > RECENT ? *len - RECENT : 0; i < *len; i++) h = h * 31 + log[i];
  return h;
}



int main(int argc, char **argv) {
  config c = load_config(argc > 1 ? argv[1] : "framer.conf");
  uint8_t *src = malloc(STAGING), *dst = malloc(STAGING);
  for (int i = 0; i < STAGING; i++) src[i] = (uint8_t)(i * 31);
  uint32_t *log = malloc((size_t)c.log_entries * sizeof *log);
  int len = 0;
  uint32_t digest = 0;
  for (int f = 0; f < c.frames; f++) {
    src[f % FRAME] ^= (uint8_t)f;
    uint32_t sum = encode_frame(dst, src, c.checksum_rounds);
    digest ^= sum;
    digest += compact_log(log, &len, c.log_entries, sum);
  }
  printf("%d frames, digest %08x, log %d\n", c.frames, digest, len);
  return 0;
}
