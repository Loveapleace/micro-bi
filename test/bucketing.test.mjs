import assert from 'node:assert/strict';
import test from 'node:test';

import { formatTimeBucket } from '../dist/esm/index.js';

test('bucketing: 小时、日、月、季度、年分桶', () => {
  const dateStr = '2026-09-22T15:29:43';

  assert.equal(
    formatTimeBucket(dateStr, { field: 'date', granularity: 'hour' }),
    '2026-09-22 15:00'
  );

  assert.equal(
    formatTimeBucket(dateStr, { field: 'date', granularity: 'day' }),
    '2026-09-22'
  );

  assert.equal(
    formatTimeBucket(dateStr, { field: 'date', granularity: 'month' }),
    '2026-09'
  );

  assert.equal(
    formatTimeBucket(dateStr, { field: 'date', granularity: 'quarter' }),
    '2026-Q3'
  );

  assert.equal(
    formatTimeBucket(dateStr, { field: 'date', granularity: 'year' }),
    '2026'
  );
});

test('bucketing: 自然周分桶 (周一为起始日)', () => {
  // 2026-09-22 是周二，所在周的周一是 2026-09-21
  const dateStr = '2026-09-22';
  const bucket = formatTimeBucket(dateStr, {
    field: 'date',
    granularity: 'week',
    format: 'YYYY-MM-DD',
    weekStartsOn: 1,
  });
  assert.equal(bucket, '2026-09-21');
});

test('bucketing: 自定义区间天数分桶', () => {
  const dateStr = '2026-09-22';
  const bucket = formatTimeBucket(dateStr, {
    field: 'date',
    granularity: 'custom',
    customIntervalDays: 7,
  });
  assert.match(bucket, /^\d{4}-\d{2}-\d{2} ~ \d{4}-\d{2}-\d{2}$/);
});

test('bucketing: 容错无效时间', () => {
  assert.equal(formatTimeBucket(null, { field: 'd', granularity: 'day' }), '(无时间)');
  assert.equal(formatTimeBucket('not-a-date', { field: 'd', granularity: 'day' }), '(无效时间)');
});
