#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define NOINLINE __attribute__((noinline))
#define BUCKETS 65536

static const char *reserved[] = {"admin", "root", "system", "daemon"};
#define NRESERVED (sizeof reserved / sizeof *reserved)

struct entry {
  uint64_t hash;
  unsigned count;
  struct entry *next;
};

static struct entry *table[BUCKETS];
static uint64_t reserved_hash[NRESERVED];

NOINLINE static uint64_t hash_key(const char *s, size_t n, uint64_t seed) {
  uint64_t h = 1469598103934665603ULL ^ seed;
  for (int round = 0; round < 6; round++)
    for (size_t i = 0; i < n; i++) {
      h ^= (unsigned char)s[i] + round;
      h *= 1099511628211ULL;
    }
  return h;
}

NOINLINE static int is_reserved(const char *key, size_t n) {
  for (size_t i = 0; i < NRESERVED; i++)
    if (hash_key(key, n, i) == reserved_hash[i]) return 1;
  return 0;
}

NOINLINE static void index_insert(const char *key, size_t n) {
  uint64_t h = hash_key(key, n, 0);
  struct entry **slot = &table[h % BUCKETS];
  for (struct entry *e = *slot; e != NULL; e = e->next)
    if (e->hash == h) {
      e->count++;
      return;
    }
  struct entry *e = malloc(sizeof *e);
  e->hash = h;
  e->count = 1;
  e->next = *slot;
  *slot = e;
}

NOINLINE static size_t next_line(char *buf, uint64_t *rng) {
  *rng = *rng * 6364136223846793005ULL + 1442695040888963407ULL;
  uint64_t key = (*rng >> 33) % 5000;
  size_t n = 24 + key % 24;
  for (size_t i = 0; i < n; i++) buf[i] = 'a' + (key * 31 + i * 7) % 26;
  buf[n] = 0;
  return n;
}

int main(int argc, char **argv) {
  long lines = argc > 1 ? atol(argv[1]) : 2000000;
  for (size_t i = 0; i < NRESERVED; i++)
    reserved_hash[i] = hash_key(reserved[i], strlen(reserved[i]), i);
  char buf[64];
  uint64_t rng = 42;
  long skipped = 0;
  for (long i = 0; i < lines; i++) {
    size_t n = next_line(buf, &rng);
    if (is_reserved(buf, n)) {
      skipped++;
      continue;
    }
    index_insert(buf, n);
  }
  unsigned long distinct = 0;
  for (int b = 0; b < BUCKETS; b++)
    for (struct entry *e = table[b]; e != NULL; e = e->next) distinct++;
  printf("%ld lines, %lu distinct keys, %ld reserved\n", lines, distinct, skipped);
  return 0;
}
