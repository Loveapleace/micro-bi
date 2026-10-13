import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import React from 'react';
import ReactDOMServer from 'react-dom/server.js';
import {
  transformData, getRecordKey, getSourceRowKey, cloneTransformRecord,
  formatTimeBucket,
} from '../dist/esm/engine/index.js';
import {
  createPivotAggregationRules, computeSummaryValues, LivePreviewTable, matchSliceValue,
} from '../dist/esm/ui/index.js';

const require = createRequire(import.meta.url);
const { Dataset } = require('../node_modules/@visactor/vtable/cjs/dataset/dataset.js');

const raw = [
  { workshop: 'A', status: 'ok', id: 'a1', x: 10, qty: 10, defect: 1 },
  { workshop: 'A', status: 'ok', id: 'a2', x: 20, qty: 20, defect: 2 },
  { workshop: 'A', status: 'bad', id: null, x: 30, qty: 30, defect: 3 },
  { workshop: 'B', status: 'ok', id: 'b1', x: 100, qty: 100, defect: 30 },
  { workshop: 'B', status: 'bad', id: 'b2', x: null, qty: 40, defect: 4 },
];
const columns = [
  { type: 'aggregated', field: 'id', agg: 'count' },
  ...['sum', 'avg', 'min', 'max'].map((agg) => ({ type: 'aggregated', field: 'x', agg })),
  { type: 'aggregated', field: 'qty', agg: 'sum' },
  { type: 'aggregated', field: 'defect', agg: 'sum' },
  { type: 'aggregated', field: 'status', agg: 'count' },
  { type: 'computed', name: 'rate', label: '缺陷率', expression: '[SUM(defect)] / [SUM(qty)] * 100', precision: 2 },
  { type: 'computed', name: 'squares', label: '平方和', expression: '[qty] * [qty]', scope: 'row' },
];

function pivotDataset(result, indicatorsAsCol = true, selected = result.columns.filter((col) => col.kind !== 'dimension')) {
  return new Dataset({
    aggregationRules: createPivotAggregationRules(selected, result.meta.rawHeaders, result.columns),
    totals: {
      row: { showGrandTotals: true, grandTotalLabel: 'Total' },
      column: { showGrandTotals: true, grandTotalLabel: 'Total' },
    },
  }, ['workshop'], ['status'], selected.map((col) => col.key), selected.map((col) => ({ indicatorKey: col.key })), indicatorsAsCol, result.data);
}

for (const indicatorsAsCol of [true, false]) {
  test(`pivot optimization: native VTable cells and totals agree with facts (${indicatorsAsCol ? 'columns' : 'rows'})`, () => {
    const config = { dimensions: { categories: ['workshop'], columnCategories: ['status'] }, columns };
    const result = transformData(raw, config);
    const dataset = pivotDataset(result, indicatorsAsCol);
    const cell = (row, col, key) => dataset.getAggregator([row], [col], key).value();
    assert.equal(cell('A', 'ok', 'COUNT(id)'), 2);
    assert.equal(cell('A', 'bad', 'COUNT(id)'), 0);
    assert.equal(cell('A', 'ok', 'SUM(x)'), 30);
    assert.equal(cell('A', 'ok', 'AVG(x)'), 15);
    assert.equal(cell('Total', 'Total', 'COUNT(id)'), 4);
    assert.equal(cell('Total', 'Total', 'SUM(x)'), 160);
    assert.equal(cell('Total', 'Total', 'AVG(x)'), 40);
    assert.equal(cell('Total', 'Total', 'MIN(x)'), 10);
    assert.equal(cell('Total', 'Total', 'MAX(x)'), 100);
    assert.equal(cell('A', 'Total', 'AVG(x)'), 20);
    assert.equal(cell('B', 'Total', 'AVG(x)'), 100);
    assert.equal(cell('Total', 'bad', 'AVG(x)'), 30);
    assert.ok(Math.abs(cell('Total', 'ok', 'AVG(x)') - 130 / 3) < 1e-10);
    assert.equal(cell('Total', 'Total', 'rate'), 20);
    assert.equal(cell('B', 'Total', 'rate'), 24.29);
    assert.equal(cell('Total', 'Total', 'squares'), 13000);
    assert.equal(cell('Total', 'Total', 'COUNT(status)'), 5);
    assert.equal(result.data.find((row) => row.workshop === 'A' && row.status === 'ok').status, 'ok');
    const rate = result.columns.find((col) => col.key === 'rate');
    const projected = pivotDataset(result, indicatorsAsCol, [rate]);
    assert.equal(projected.getAggregator(['Total'], ['Total'], 'rate').value(), 20);
  });
}

test('summary optimization: implicit formula dependencies and explicit row calculations survive totals', () => {
  const result = transformData(raw, {
    dimensions: { categories: ['workshop'] },
    columns: [columns.at(-2), columns.at(-1)],
  });
  const summary = computeSummaryValues(result.data, result.columns);
  assert.equal(summary.rate, 20);
  assert.equal(summary.squares, 13000);
  const clones = result.data.map((row) => cloneTransformRecord(row, { __summary_row_dim__: '汇总' }));
  assert.equal(computeSummaryValues(clones, result.columns).rate, 20);
  assert.ok(Array.isArray(clones[0]._rawRows));
  assert.equal(Object.keys(clones[0]).includes('_rawRows'), false);
});

test('summary optimization: zero counts and nonnumeric AVG inputs retain their own semantics', () => {
  const result = transformData([{ g: 'A', value: 10 }, { g: 'A', value: 'invalid' }, { g: 'B', value: null }], {
    dimensions: { categories: ['g'] },
    columns: ['count', 'avg', 'min'].map((agg) => ({ type: 'aggregated', field: 'value', agg })),
  });
  assert.equal(result.data[0]['AVG(value)'], 10);
  const totals = computeSummaryValues(result.data, result.columns);
  assert.equal(totals['AVG(value)'], 10);
  assert.equal(totals['COUNT(value)'], 2);
  assert.equal(totals['MIN(value)'], 10);
  assert.equal(computeSummaryValues([{ 'COUNT(value)': 0 }], [{ key: 'COUNT(value)', title: '次数', type: 'number', agg: 'count', field: 'value' }])['COUNT(value)'], 0);
});

for (const indicatorsAsCol of [true, false]) {
  test(`preview optimization: rendered pivot totals use weighted AVG and fact COUNT (${indicatorsAsCol})`, () => {
    const config = {
      dimensions: { categories: ['workshop'], columnCategories: ['status'], indicatorsAsCol },
      columns: [{ type: 'aggregated', field: 'id', agg: 'count' }, { type: 'aggregated', field: 'x', agg: 'avg' }],
    };
    const records = [
      { workshop: 'A', status: 'ok', id: 'a1', x: 10 },
      { workshop: 'A', status: 'ok', id: 'a2', x: 10 },
      { workshop: 'A', status: 'ok', id: 'a3', x: 10 },
      { workshop: 'B', status: 'ok', id: 'b1', x: 100 },
    ];
    const html = ReactDOMServer.renderToStaticMarkup(React.createElement(LivePreviewTable, { config, result: transformData(records, config) }));
    const body = html.match(/<tbody>([\s\S]*?)<\/tbody>/)[1];
    const rows = [...body.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)];
    const values = (row) => [...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)].map((match) => match[1].replace(/<[^>]*>/g, ''));
    if (indicatorsAsCol) assert.deepEqual(values(rows.at(-1)[1]).slice(-2), ['2', '55']);
    else {
      assert.equal(values(rows.at(-2)[1]).at(-1), '2');
      assert.equal(values(rows.at(-1)[1]).at(-1), '55');
    }
  });
}

test('data identity: JSON group keys do not collide on delimiter characters', () => {
  const result = transformData([{ a: 'x###b:y', b: 'z', v: 1 }, { a: 'x', b: 'y###b:z', v: 2 }], {
    dimensions: { categories: ['a', 'b'] }, columns: [{ type: 'aggregated', field: 'v', agg: 'sum' }],
  });
  assert.equal(result.data.length, 2);
  assert.notEqual(getRecordKey(result.data[0]), getRecordKey(result.data[1]));
  assert.equal(JSON.stringify(result.data).includes('pivot:'), false);
});

test('empty results: pivot schema and transform metadata survive zero matching records', () => {
  const config = { dimensions: { categories: ['workshop'], columnCategories: ['status'] }, columns: [{ type: 'aggregated', field: 'x', agg: 'avg' }] };
  const result = transformData([], config);
  assert.deepEqual(result.data, []);
  assert.equal(result.meta.isCrossTab, true);
  assert.equal(result.meta.form, 'pivot');
  assert.equal(result.meta.transformConfig, config);
  assert.deepEqual(result.columns.map((col) => col.key), ['workshop', 'status', 'AVG(x)']);
});

test('time buckets: natural weeks share keys across month/year boundaries and match both week starts', () => {
  for (const [start, end, weekStartsOn] of [['2026-10-05', '2026-10-11', 1], ['2026-09-28', '2026-10-04', 1], ['2026-12-28', '2027-01-03', 1], ['2026-10-04', '2026-10-10', 0]]) {
    const config = { field: 'date', granularity: 'week', weekStartsOn };
    const bucket = formatTimeBucket(start, config);
    assert.equal(formatTimeBucket(end, config), bucket);
    assert.equal(matchSliceValue(end, bucket), true);
  }
  const bucket = formatTimeBucket('2026-10-04', { field: 'date', granularity: 'week', weekStartsOn: 0 });
  assert.equal(matchSliceValue('2026-10-11', bucket), false);
  const milliseconds = new Date('2026-10-05T12:00:00').getTime();
  const expected = formatTimeBucket(milliseconds, { field: 'date', granularity: 'day' });
  assert.equal(formatTimeBucket(milliseconds / 1000, { field: 'date', granularity: 'day' }), expected);
  assert.equal(formatTimeBucket(String(milliseconds / 1000), { field: 'date', granularity: 'day' }), expected);
  assert.equal(matchSliceValue(milliseconds / 1000, expected), true);
});
