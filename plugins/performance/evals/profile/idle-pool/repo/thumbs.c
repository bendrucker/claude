#include <pthread.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <time.h>

#define NOINLINE __attribute__((noinline))
#define POOL 6
#define WIDTH 512

static pthread_mutex_t queue_lock = PTHREAD_MUTEX_INITIALIZER;
static pthread_cond_t queue_ready = PTHREAD_COND_INITIALIZER;
static int queue_closed;
static volatile int flushes;

static void *pool_worker(void *arg) {
  (void)arg;
  pthread_mutex_lock(&queue_lock);
  while (!queue_closed) pthread_cond_wait(&queue_ready, &queue_lock);
  pthread_mutex_unlock(&queue_lock);
  return NULL;
}

static void *metrics_flusher(void *arg) {
  (void)arg;
  struct timespec interval = {0, 50 * 1000 * 1000};
  while (!queue_closed) {
    nanosleep(&interval, NULL);
    flushes++;
  }
  return NULL;
}

NOINLINE static void decode_block(uint8_t *px, uint64_t seed) {
  uint32_t state = (uint32_t)seed | 1;
  for (int i = 0; i < WIDTH * WIDTH; i++) {
    state ^= state << 13;
    state ^= state >> 17;
    state ^= state << 5;
    px[i] = (uint8_t)(state % 251);
  }
}

NOINLINE static void downscale(const uint8_t *px, uint8_t *out) {
  for (int y = 0; y < WIDTH / 4; y++)
    for (int x = 0; x < WIDTH / 4; x++) {
      unsigned sum = 0;
      for (int dy = 0; dy < 4; dy++)
        for (int dx = 0; dx < 4; dx++) sum += px[(y * 4 + dy) * WIDTH + x * 4 + dx];
      out[y * (WIDTH / 4) + x] = (uint8_t)(sum / 16);
    }
}

NOINLINE static uint32_t checksum(const uint8_t *out, size_t n) {
  uint32_t a = 1, b = 0;
  for (size_t i = 0; i < n; i++) {
    a = (a + out[i]) % 65521;
    b = (b + a) % 65521;
  }
  return (b << 16) | a;
}

int main(int argc, char **argv) {
  int images = argc > 1 ? atoi(argv[1]) : 2400;
  pthread_t pool[POOL], flusher;
  for (int i = 0; i < POOL; i++) pthread_create(&pool[i], NULL, pool_worker, NULL);
  pthread_create(&flusher, NULL, metrics_flusher, NULL);

  uint8_t *px = malloc(WIDTH * WIDTH);
  uint8_t out[(WIDTH / 4) * (WIDTH / 4)];
  uint32_t total = 0;
  for (int i = 0; i < images; i++) {
    decode_block(px, (uint64_t)i * 7919);
    downscale(px, out);
    total ^= checksum(out, sizeof out);
  }

  pthread_mutex_lock(&queue_lock);
  queue_closed = 1;
  pthread_cond_broadcast(&queue_ready);
  pthread_mutex_unlock(&queue_lock);
  for (int i = 0; i < POOL; i++) pthread_join(pool[i], NULL);
  pthread_join(flusher, NULL);
  printf("%d thumbnails, checksum %08x\n", images, total);
  free(px);
  return 0;
}
