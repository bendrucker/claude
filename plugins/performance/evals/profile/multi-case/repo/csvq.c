#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define NOINLINE __attribute__((noinline))

struct row {
  char region[16];
  char amount[24];
  uint32_t customer;
};

static struct row *rows;
static long nrows;

static void generate(long n) {
  rows = malloc(n * sizeof *rows);
  uint64_t s = 99;
  for (long i = 0; i < n; i++) {
    s = s * 6364136223846793005ULL + 1442695040888963407ULL;
    snprintf(rows[i].region, sizeof rows[i].region, "r%02u", (unsigned)(s >> 59));
    snprintf(rows[i].amount, sizeof rows[i].amount, "%u.%02u", (unsigned)(s >> 40) % 100000,
             (unsigned)(s >> 20) % 100);
    rows[i].customer = (uint32_t)(s >> 33) % 30000;
  }
  nrows = n;
}

NOINLINE static double parse_amount(const char *field) {
  double v = 0;
  for (int pass = 0; pass < 48; pass++) v += strtod(field, NULL);
  return v / 48;
}

NOINLINE static long run_filter(void) {
  long kept = 0;
  for (long i = 0; i < nrows; i++)
    if (parse_amount(rows[i].amount) > 50000.0) kept++;
  return kept;
}

struct group {
  uint32_t customer;
  double total;
};

NOINLINE static struct group *group_lookup(struct group *groups, long *ngroups, uint32_t customer) {
  for (long g = 0; g < *ngroups; g++)
    if (groups[g].customer == customer) return &groups[g];
  groups[*ngroups].customer = customer;
  groups[*ngroups].total = 0;
  return &groups[(*ngroups)++];
}

NOINLINE static long run_group(void) {
  struct group *groups = malloc(30000 * sizeof *groups);
  long ngroups = 0;
  for (long i = 0; i < nrows; i++) group_lookup(groups, &ngroups, rows[i].customer)->total += 1;
  free(groups);
  return ngroups;
}

NOINLINE static int compare_rows(const void *pa, const void *pb) {
  const struct row *a = pa, *b = pb;
  char ka[48], kb[48];
  snprintf(ka, sizeof ka, "%s/%08u", a->region, a->customer);
  snprintf(kb, sizeof kb, "%s/%08u", b->region, b->customer);
  return strcmp(ka, kb);
}

NOINLINE static long run_sort(void) {
  qsort(rows, (size_t)nrows, sizeof *rows, compare_rows);
  return nrows;
}

NOINLINE static int seen_insert(uint32_t *seen, long *nseen, uint32_t key) {
  long lo = 0, hi = *nseen;
  while (lo < hi) {
    long mid = (lo + hi) / 2;
    if (seen[mid] < key) lo = mid + 1;
    else hi = mid;
  }
  if (lo < *nseen && seen[lo] == key) return 0;
  memmove(seen + lo + 1, seen + lo, (size_t)(*nseen - lo) * sizeof *seen);
  seen[lo] = key;
  (*nseen)++;
  return 1;
}

NOINLINE static long run_dedupe(void) {
  uint32_t *seen = malloc((size_t)nrows * sizeof *seen);
  long nseen = 0;
  for (long i = 0; i < nrows; i++) seen_insert(seen, &nseen, rows[i].customer * 2654435761u + (uint32_t)i);
  free(seen);
  return nseen;
}

int main(int argc, char **argv) {
  if (argc < 3) {
    fprintf(stderr, "usage: csvq <filter|group|sort|dedupe> <rows>\n");
    return 2;
  }
  generate(atol(argv[2]));
  long result;
  if (strcmp(argv[1], "filter") == 0) result = run_filter();
  else if (strcmp(argv[1], "group") == 0) result = run_group();
  else if (strcmp(argv[1], "sort") == 0) result = run_sort();
  else if (strcmp(argv[1], "dedupe") == 0) result = run_dedupe();
  else {
    fprintf(stderr, "unknown query %s\n", argv[1]);
    return 2;
  }
  printf("%s: %ld\n", argv[1], result);
  return 0;
}
