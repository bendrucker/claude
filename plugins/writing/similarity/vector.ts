// Vector and summary-statistic primitives shared by the feature vector, the
// standardizer, and the two distance families.

export interface Scaler {
  mean: number[];
  sd: number[];
}

export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  let total = 0;
  for (const value of values) total += value;
  return total / values.length;
}

export function standardDeviation(values: number[], center = mean(values)): number {
  if (values.length < 2) return 0;
  let sum = 0;
  for (const value of values) sum += (value - center) ** 2;
  return Math.sqrt(sum / (values.length - 1));
}

// Linear-interpolated quantile over an already-sorted ascending sample.
export function quantileOfSorted(sorted: number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  const position = Math.min(Math.max(fraction, 0), 1) * (sorted.length - 1);
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const low = sorted[lower] ?? 0;
  if (lower === upper) return low;
  return low + (position - lower) * ((sorted[upper] ?? low) - low);
}

export function median(values: number[]): number {
  return quantileOfSorted(
    values.toSorted((a, b) => a - b),
    0.5,
  );
}

// A zero-variance feature carries no information. Dividing by 1 avoids
// Infinity, leaving it at a constant offset.
export function fitScaler(rows: number[][]): Scaler {
  const width = rows[0]?.length ?? 0;
  const means: number[] = [];
  const sds: number[] = [];
  for (let i = 0; i < width; i++) {
    const column = rows.map((row) => row[i] ?? 0);
    const columnMean = mean(column);
    const sd = standardDeviation(column, columnMean);
    means.push(columnMean);
    sds.push(sd > 0 ? sd : 1);
  }
  return { mean: means, sd: sds };
}

export function standardize(row: number[], scaler: Scaler): number[] {
  return row.map((value, i) => (value - (scaler.mean[i] ?? 0)) / (scaler.sd[i] ?? 1));
}

export function centroid(rows: number[][]): number[] {
  const width = rows[0]?.length ?? 0;
  const result: number[] = [];
  for (let i = 0; i < width; i++) result.push(mean(rows.map((row) => row[i] ?? 0)));
  return result;
}

export function spread(rows: number[][]): number[] {
  const width = rows[0]?.length ?? 0;
  const result: number[] = [];
  for (let i = 0; i < width; i++) {
    const sd = standardDeviation(rows.map((row) => row[i] ?? 0));
    result.push(sd > 0 ? sd : 1);
  }
  return result;
}

export function euclidean(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += ((a[i] ?? 0) - (b[i] ?? 0)) ** 2;
  return Math.sqrt(sum);
}

// Ruzicka (weighted Jaccard) distance over relative frequencies. It beat cosine
// on char 3-gram profiles because it compares grams on shared magnitude, so a
// document that simply uses fewer distinct grams does not drift toward the
// centroid.
export function ruzicka(a: number[], b: number[]): number {
  let minimums = 0;
  let maximums = 0;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const left = a[i] ?? 0;
    const right = b[i] ?? 0;
    minimums += Math.min(left, right);
    maximums += Math.max(left, right);
  }
  if (maximums === 0) return 1;
  return 1 - minimums / maximums;
}

// Two-pole margin: positive when the input sits nearer the voice pole, negative
// when nearer the contrast pole, scaled by the mean of the two distances so the
// value is comparable across distance families with different units.
export function margin(voiceDistance: number, contrastDistance: number): number {
  const average = (voiceDistance + contrastDistance) / 2;
  if (average === 0) return 0;
  return (contrastDistance - voiceDistance) / average;
}
