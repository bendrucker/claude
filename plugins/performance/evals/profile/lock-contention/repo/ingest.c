#include <pthread.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define NOINLINE __attribute__((noinline))
#define WORKERS 8
#define BUCKETS 2048

struct stats {
  pthread_mutex_t lock;
  uint64_t histogram[BUCKETS];
  uint64_t count;
  double p50, p99;
};

static struct stats stats = {.lock = PTHREAD_MUTEX_INITIALIZER};
static long items_per_worker;

NOINLINE static double score_item(uint64_t seed) {
  double x = (double)(seed % 1000) / 1000.0;
  for (int i = 0; i < 1400; i++) x = x * 3.7 * (1.0 - x) + 1e-9;
  return x;
}

NOINLINE static void percentile_refresh(struct stats *s) {
  uint64_t seen = 0;
  int p50 = -1;
  for (int b = 0; b < BUCKETS; b++) {
    seen += s->histogram[b];
    if (p50 < 0 && seen * 2 >= s->count) p50 = b;
    if (seen * 100 >= s->count * 99) {
      s->p99 = (double)b / BUCKETS;
      break;
    }
  }
  s->p50 = (double)p50 / BUCKETS;
}

NOINLINE static void stats_record(double score) {
  pthread_mutex_lock(&stats.lock);
  stats.histogram[(int)(score * (BUCKETS - 1))]++;
  stats.count++;
  percentile_refresh(&stats);
  pthread_mutex_unlock(&stats.lock);
}

static void *worker(void *arg) {
  uint64_t seed = (uintptr_t)arg * 2654435761u;
  for (long i = 0; i < items_per_worker; i++) {
    seed = seed * 6364136223846793005ULL + 1442695040888963407ULL;
    stats_record(score_item(seed >> 20));
  }
  return NULL;
}

int main(int argc, char **argv) {
  items_per_worker = argc > 1 ? atol(argv[1]) : 60000;
  pthread_t threads[WORKERS];
  for (uintptr_t i = 0; i < WORKERS; i++) pthread_create(&threads[i], NULL, worker, (void *)(i + 1));
  for (int i = 0; i < WORKERS; i++) pthread_join(threads[i], NULL);
  printf("%llu items, p50 %.3f, p99 %.3f\n", (unsigned long long)stats.count, stats.p50, stats.p99);
  return 0;
}
