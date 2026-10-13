import type { DataRecord } from '../types.js';
import type { MetricAccumulator } from './aggregation.js';

interface RecordMetadata {
  readonly rowKey: string;
  readonly sourceRowKey?: string;
  readonly aggregates?: ReadonlyMap<string, MetricAccumulator>;
}

// Metadata stays out of business fields and JSON exports.
const metadata = new WeakMap<DataRecord, RecordMetadata>();

export function setRecordMetadata(record: DataRecord, value: RecordMetadata): void {
  metadata.set(record, value);
}

export function getRecordKey(record: DataRecord, fallbackIndex?: number): string | undefined {
  const stored = metadata.get(record);
  if (stored) return stored.rowKey;
  const key = record.id ?? record.key;
  return key !== undefined && key !== null
    ? String(key)
    : fallbackIndex !== undefined ? String(fallbackIndex) : undefined;
}

export function getSourceRowKey(record: DataRecord): string | undefined {
  return metadata.get(record)?.sourceRowKey;
}

export function getRecordAggregates(record: DataRecord): ReadonlyMap<string, MetricAccumulator> | undefined {
  return metadata.get(record)?.aggregates;
}

export function cloneTransformRecord(record: DataRecord, extra: DataRecord): DataRecord {
  const clone = { ...record, ...extra };
  const stored = metadata.get(record);
  if (stored) metadata.set(clone, stored);
  const rawRows = Object.getOwnPropertyDescriptor(record, '_rawRows');
  if (rawRows) Object.defineProperty(clone, '_rawRows', rawRows);
  return clone;
}
