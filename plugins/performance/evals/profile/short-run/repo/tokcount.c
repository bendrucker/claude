#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define NOINLINE __attribute__((noinline))
#define MAXTOK 200000

struct token {
  uint32_t start, len;
  uint8_t kind;
};

static struct token tokens[MAXTOK];

NOINLINE static size_t tokenize(const char *src, size_t n) {
  size_t count = 0;
  for (size_t i = 0; i < n && count < MAXTOK;) {
    while (i < n && (src[i] == ' ' || src[i] == '\n')) i++;
    size_t start = i;
    while (i < n && src[i] != ' ' && src[i] != '\n') {
      for (const char *p = "(){}[];,.:"; *p; p++)
        if (src[i] == *p) goto end;
      i++;
    }
  end:
    if (i == start) i++;
    tokens[count].start = (uint32_t)start;
    tokens[count].len = (uint32_t)(i - start);
    count++;
  }
  return count;
}

NOINLINE static unsigned classify(const char *src, size_t count) {
  static const char *keywords[] = {"if", "else", "for", "while", "return", "struct",
                                   "static", "const", "int", "char", "void", "size_t"};
  unsigned kw = 0;
  for (size_t t = 0; t < count; t++) {
    tokens[t].kind = 0;
    for (size_t k = 0; k < sizeof keywords / sizeof *keywords; k++)
      if (strlen(keywords[k]) == tokens[t].len &&
          memcmp(keywords[k], src + tokens[t].start, tokens[t].len) == 0) {
        tokens[t].kind = 1;
        kw++;
        break;
      }
  }
  return kw;
}

int main(int argc, char **argv) {
  if (argc < 2) {
    fprintf(stderr, "usage: tokcount <file>\n");
    return 2;
  }
  FILE *f = fopen(argv[1], "rb");
  if (f == NULL) {
    perror(argv[1]);
    return 1;
  }
  static char src[1 << 22];
  size_t n = fread(src, 1, sizeof src, f);
  fclose(f);
  size_t count = tokenize(src, n);
  unsigned kw = classify(src, count);
  printf("%zu tokens, %u keywords\n", count, kw);
  return 0;
}
