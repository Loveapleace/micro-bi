import type { AggregationFunction } from './types.js';

export interface MetricAccumulator {
  sum: number;
  count: number;
  numericCount: number;
  min: number;
  max: number;
}

export function createMetricAccumulator(): MetricAccumulator {
  return { sum: 0, count: 0, numericCount: 0, min: Infinity, max: -Infinity };
}

export function accumulateMetric(acc: MetricAccumulator, value: unknown): void {
  if (value === null || value === undefined || value === '') return;
  acc.count += 1;
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(number)) return;
  acc.sum += number;
  acc.numericCount += 1;
  acc.min = Math.min(acc.min, number);
  acc.max = Math.max(acc.max, number);
}

export function mergeMetricAccumulator(target: MetricAccumulator, source: MetricAccumulator): void {
  target.sum += source.sum;
  target.count += source.count;
  target.numericCount += source.numericCount;
  target.min = Math.min(target.min, source.min);
  target.max = Math.max(target.max, source.max);
}

export function getAggregatedValue(acc: MetricAccumulator, agg: AggregationFunction): number {
  switch (agg) {
    case 'sum': return acc.sum;
    case 'count': return acc.count;
    case 'avg': return acc.numericCount > 0 ? acc.sum / acc.numericCount : 0;
    case 'min': return acc.min === Infinity ? 0 : acc.min;
    case 'max': return acc.max === -Infinity ? 0 : acc.max;
  }
}
