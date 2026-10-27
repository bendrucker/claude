#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define NOINLINE __attribute__((noinline))

struct job {
  uint64_t id;
  uint32_t priority;
  uint32_t attempts;
  char payload[48];
};

struct queue {
  struct job *jobs;
  size_t len, cap;
};

NOINLINE static void queue_push(struct queue *q, const struct job *j) {
  if (q->len == q->cap) {
    q->cap = q->cap ? q->cap * 2 : 1024;
    q->jobs = realloc(q->jobs, q->cap * sizeof *q->jobs);
  }
  q->jobs[q->len++] = *j;
}

NOINLINE static struct job queue_pop(struct queue *q) {
  struct job head = q->jobs[0];
  memmove(q->jobs, q->jobs + 1, (q->len - 1) * sizeof *q->jobs);
  q->len--;
  return head;
}

NOINLINE static uint64_t run_job(const struct job *j) {
  uint64_t h = j->id;
  for (int i = 0; i < 12000; i++) h = (h ^ (uint64_t)j->payload[i % 48]) * 0x100000001b3ULL;
  return h;
}

int main(int argc, char **argv) {
  long n = argc > 1 ? atol(argv[1]) : 50000;
  struct queue q = {0};
  for (long i = 0; i < n; i++) {
    struct job j = {.id = (uint64_t)i, .priority = (uint32_t)(i % 7)};
    snprintf(j.payload, sizeof j.payload, "job-%ld", i);
    queue_push(&q, &j);
  }
  uint64_t digest = 0;
  long done = 0;
  while (q.len > 0) {
    struct job j = queue_pop(&q);
    digest ^= run_job(&j);
    done++;
  }
  printf("%ld jobs, digest %016llx\n", done, (unsigned long long)digest);
  free(q.jobs);
  return 0;
}
