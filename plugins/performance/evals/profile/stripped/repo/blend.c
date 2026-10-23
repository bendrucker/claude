#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>

#define NOINLINE __attribute__((noinline))
#define WIDTH 1024

static uint16_t gamma_table[4096];

NOINLINE static void build_gamma(void) {
  for (int i = 0; i < 4096; i++) gamma_table[i] = (uint16_t)((i * i) >> 12);
}

NOINLINE static void mix_rows(const uint16_t *a, const uint16_t *b, uint16_t *out, unsigned alpha) {
  for (int i = 0; i < WIDTH; i++) out[i] = (uint16_t)((a[i] * alpha + b[i] * (256 - alpha)) >> 8);
}

NOINLINE static uint64_t tone_map(uint16_t *row, unsigned exposure) {
  uint64_t sum = 0;
  for (int i = 0; i < WIDTH; i++) {
    unsigned v = row[i] * exposure / (row[i] + 97);
    v = v * 3 / (v % 13 + 5) + v / (row[i] % 7 + 1);
    row[i] = gamma_table[v & 4095];
    sum += row[i];
  }
  return sum;
}

int main(int argc, char **argv) {
  int frames = argc > 1 ? atoi(argv[1]) : 8000;
  build_gamma();
  uint16_t *a = malloc(WIDTH * sizeof *a), *b = malloc(WIDTH * sizeof *b),
           *out = malloc(WIDTH * sizeof *out);
  for (int i = 0; i < WIDTH; i++) {
    a[i] = (uint16_t)(i * 37 % 4096);
    b[i] = (uint16_t)(i * 91 % 4096);
  }
  uint64_t total = 0;
  for (int f = 0; f < frames; f++)
    for (int row = 0; row < 64; row++) {
      for (int pass = 0; pass < 6; pass++) mix_rows(a, b, out, (unsigned)(f + row + pass) & 255);
      total += tone_map(out, 4000 + (unsigned)row);
    }
  printf("%d frames, luminance %llu\n", frames, (unsigned long long)total);
  return 0;
}
