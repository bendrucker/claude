#include <pthread.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define NOINLINE __attribute__((noinline))
#define WORKERS 8
#define SLOTS 4096
#define JOURNAL 1024

typedef struct {
  int events;
  int journal_every;
  int route_rounds;
} config;

static config conf = {40000, 4, 600};
static pthread_mutex_t cache_lock = PTHREAD_MUTEX_INITIALIZER;
static pthread_mutex_t journal_lock = PTHREAD_MUTEX_INITIALIZER;
static uint32_t cache[SLOTS];
static uint32_t journal[JOURNAL];
static int journal_len;

static void load_config(const char *path) {
  FILE *f = fopen(path, "r");
  if (!f) return;
  char key[32];
  int value;
  while (fscanf(f, "%31s %d", key, &value) == 2) {
    if (!strcmp(key, "events")) conf.events = value;
    if (!strcmp(key, "journal_every")) conf.journal_every = value;
    if (!strcmp(key, "route_rounds")) conf.route_rounds = value;
  }
  fclose(f);
}

NOINLINE static uint32_t route_message(uint32_t id) {
  uint32_t h = id | 1;
  for (int i = 0; i < conf.route_rounds; i++) h = h * 2654435761u + (h >> 13);
  return h;
}

NOINLINE static uint32_t cache_get(uint32_t key) {
  pthread_mutex_lock(&cache_lock);
  uint32_t v = cache[key % SLOTS];
  cache[key % SLOTS] = v + key;
  pthread_mutex_unlock(&cache_lock);
  return v;
}

NOINLINE static void journal_append(uint32_t entry) {
  pthread_mutex_lock(&journal_lock);
  if (journal_len == JOURNAL) journal_len = 0;
  journal[journal_len++] = entry;
  uint32_t check = 0;
  for (int i = 0; i < journal_len; i++) check = check * 31 + journal[i];
  journal[0] ^= check & 1;
  pthread_mutex_unlock(&journal_lock);
}

static void *worker(void *arg) {
  uint32_t base = (uint32_t)(uintptr_t)arg * 1000003u;
  for (int e = 0; e < conf.events; e++) {
    uint32_t route = route_message(base + (uint32_t)e);
    uint32_t cached = cache_get(route);
    if (e % conf.journal_every == 0) journal_append(route ^ cached);
  }
  return NULL;
}

int main(int argc, char **argv) {
  load_config(argc > 1 ? argv[1] : "relayd.conf");
  pthread_t threads[WORKERS];
  for (int i = 0; i < WORKERS; i++) pthread_create(&threads[i], NULL, worker, (void *)(uintptr_t)i);
  for (int i = 0; i < WORKERS; i++) pthread_join(threads[i], NULL);
  printf("%d workers x %d events, journal %d\n", WORKERS, conf.events, journal_len);
  return 0;
}
