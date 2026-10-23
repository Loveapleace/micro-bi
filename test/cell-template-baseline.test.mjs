import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  validateCellTemplateDocument,
  normalizeCellTemplate,
  expandCellTemplate,
  compileCellReport,
  buildInstanceKey,
  parseInstanceKey,
  encodeMemberValue,
} from '../dist/esm/report-template/index.js';

// D0 数据集 (来自规范文档第 6.1 节)
const D0_DATA = [
  { id: 'a1', workshop: 'A', line: 'L1', date: '2026-10-01', qty: 10, defect: 1 },
  { id: 'a2', workshop: 'A', line: 'L2', date: '2026-10-02', qty: 20, defect: 2 },
  { id: 'a3', workshop: 'A', line: 'L1', date: '2026-11-01', qty: 30, defect: 3 },
  { id: 'b1', workshop: 'B', line: 'L1', date: '2026-10-03', qty: 100, defect: 30 },
  { id: 'b2', workshop: 'B', line: 'L2', date: '2026-11-02', qty: 40, defect: 4 },
];

test('Identity: encodeMemberValue distinguishes types', () => {
  assert.equal(encodeMemberValue(1), 'n:1');
  assert.equal(encodeMemberValue('1'), 's:1');
  assert.notEqual(encodeMemberValue(1), encodeMemberValue('1'));
  assert.equal(encodeMemberValue(null), '__NULL__');
  assert.equal(encodeMemberValue(undefined), '__UNDEFINED__');

  const key = buildInstanceKey({
    templateCellId: 'c1',
    regionId: 'r1',
    rowPath: 'A',
    columnPath: '2026-10',
    metricId: 'm_sum_qty',
    role: 'measure',
  });
  const parsed = parseInstanceKey(key);
  assert.ok(parsed);
  assert.equal(parsed.templateCellId, 'c1');
  assert.equal(parsed.regionId, 'r1');
  assert.equal(parsed.rowPath, 'A');
  assert.equal(parsed.columnPath, '2026-10');
  assert.equal(parsed.metricId, 'm_sum_qty');
});

test('Validator: catches schema and constraint violations', () => {
  // 1. 无效 documentType
  const invalidType = {
    documentType: 'unknown',
    schemaVersion: '1.0',
    id: 't1',
    title: 'Test',
    templateRevision: 1,
    sheets: [{ id: 's1', name: 'Sheet1' }],
    regions: [],
    cells: [],
    layoutRules: [],
    styleRules: [],
    conditionalRules: [],
    instanceOverrides: [],
    orphanedEdits: [],
    capabilitiesVersion: 'cell-v1',
  };
  const res1 = validateCellTemplateDocument(invalidType);
  assert.equal(res1.valid, false);
  assert.ok(res1.diagnostics.some((d) => d.code === 'ERR_INVALID_DOC_TYPE'));

  // 2. 首版超过 1 个活动数据区域
  const multiRegion = {
    ...invalidType,
    documentType: 'cell-template',
    regions: [
      { id: 'r1', datasetId: 'd1', layoutKind: 'detail', sheetId: 's1', anchor: { row: 0, column: 0 }, metricDirection: 'columns', filters: [] },
      { id: 'r2', datasetId: 'd2', layoutKind: 'grouped', sheetId: 's1', anchor: { row: 10, column: 0 }, metricDirection: 'columns', filters: [] },
    ],
  };
  const res2 = validateCellTemplateDocument(multiRegion);
  assert.equal(res2.valid, false);
  assert.ok(res2.diagnostics.some((d) => d.code === 'ERR_MULTIPLE_REGIONS_UNSUPPORTED'));

  // 3. 循环父格
  const cyclic = {
    ...invalidType,
    documentType: 'cell-template',
    regions: [
      { id: 'r1', datasetId: 'd1', layoutKind: 'pivot', sheetId: 's1', anchor: { row: 0, column: 0 }, metricDirection: 'columns', filters: [] },
    ],
    cells: [
      { id: 'c1', sheetId: 's1', regionId: 'r1', position: { row: 0, column: 0 }, content: { kind: 'field', fieldId: 'f1', fieldKey: 'k1', role: 'row-dimension', operation: 'group', expand: 'down' }, parents: { row: 'c2', column: null } },
      { id: 'c2', sheetId: 's1', regionId: 'r1', position: { row: 1, column: 0 }, content: { kind: 'field', fieldId: 'f2', fieldKey: 'k2', role: 'row-dimension', operation: 'group', expand: 'down' }, parents: { row: 'c1', column: null } },
    ],
  };
  const res3 = validateCellTemplateDocument(cyclic);
  assert.equal(res3.valid, false);
  assert.ok(res3.diagnostics.some((d) => d.code === 'ERR_CYCLIC_PARENT_DEPENDENCY'));
});

test('D0 Detail Template: expands to 5 records with accurate projection', () => {
  const detailDoc = {
    documentType: 'cell-template',
    schemaVersion: '1.0',
    id: 'd0-detail',
    title: 'D0 明细报表',
    templateRevision: 1,
    sheets: [{ id: 'sheet-1', name: '明细' }],
    regions: [
      {
        id: 'r1',
        datasetId: 'production',
        layoutKind: 'detail',
        sheetId: 'sheet-1',
        anchor: { row: 0, column: 0 },
        metricDirection: 'columns',
        filters: [],
      },
    ],
    cells: [
      {
        id: 'c-id',
        sheetId: 'sheet-1',
        regionId: 'r1',
        position: { row: 0, column: 0 },
        content: { kind: 'field', fieldId: 'f-id', fieldKey: 'id', role: 'detail-column', operation: 'list', expand: 'down', displayName: '编号' },
        parents: { row: null, column: null },
      },
      {
        id: 'c-ws',
        sheetId: 'sheet-1',
        regionId: 'r1',
        position: { row: 0, column: 1 },
        content: { kind: 'field', fieldId: 'f-workshop', fieldKey: 'workshop', role: 'detail-column', operation: 'list', expand: 'down', displayName: '车间' },
        parents: { row: null, column: null },
      },
      {
        id: 'c-qty',
        sheetId: 'sheet-1',
        regionId: 'r1',
        position: { row: 0, column: 2 },
        content: { kind: 'field', fieldId: 'f-qty', fieldKey: 'qty', role: 'detail-column', operation: 'list', expand: 'down', displayName: '交付量' },
        parents: { row: null, column: null },
      },
    ],
    layoutRules: [],
    styleRules: [],
    conditionalRules: [],
    instanceOverrides: [],
    orphanedEdits: [],
    capabilitiesVersion: 'cell-v1',
  };

  const plan = normalizeCellTemplate(detailDoc);
  assert.ok(plan);
  assert.equal(plan.detailColumns.length, 3);

  const { grid } = expandCellTemplate(detailDoc, plan, D0_DATA);
  assert.equal(grid.type, 'detail');
  // Header row + 5 data rows = 6 rows
  const idValues = grid.cells.filter((c) => c.col === 0 && c.row > 0).map((c) => c.value);
  assert.deepEqual(idValues, ['a1', 'a2', 'a3', 'b1', 'b2']);

  const qtyValues = grid.cells.filter((c) => c.col === 2 && c.row > 0).map((c) => c.value);
  assert.deepEqual(qtyValues, [10, 20, 30, 100, 40]);

  // Compile check
  const comp = compileCellReport(detailDoc, D0_DATA);
  assert.equal(comp.valid, true);
  assert.equal(comp.publication.sheets[0].cells.length, grid.cells.length);
});

test('D0 Grouped Template: computes SUM=200, AVG=40, A=60, B=140', () => {
  const groupedDoc = {
    documentType: 'cell-template',
    schemaVersion: '1.0',
    id: 'd0-grouped',
    title: 'D0 分组报表',
    templateRevision: 1,
    sheets: [{ id: 'sheet-1', name: '车间汇总' }],
    regions: [
      {
        id: 'r1',
        datasetId: 'production',
        layoutKind: 'grouped',
        sheetId: 'sheet-1',
        anchor: { row: 0, column: 0 },
        metricDirection: 'columns',
        filters: [],
        rowTotals: { showGrandTotals: true, label: '总计' },
      },
    ],
    cells: [
      {
        id: 'c-workshop',
        sheetId: 'sheet-1',
        regionId: 'r1',
        position: { row: 1, column: 0 },
        content: { kind: 'field', fieldId: 'f-workshop', fieldKey: 'workshop', role: 'row-dimension', operation: 'group', expand: 'down', displayName: '车间' },
        parents: { row: null, column: null },
      },
      {
        id: 'c-sum-qty',
        sheetId: 'sheet-1',
        regionId: 'r1',
        position: { row: 1, column: 1 },
        content: { kind: 'field', fieldId: 'f-qty', fieldKey: 'qty', role: 'measure', metricId: 'm-qty-sum', operation: 'sum', expand: 'inherit', displayName: '交付总量' },
        parents: { row: 'c-workshop', column: null },
      },
      {
        id: 'c-avg-qty',
        sheetId: 'sheet-1',
        regionId: 'r1',
        position: { row: 1, column: 2 },
        content: { kind: 'field', fieldId: 'f-qty', fieldKey: 'qty', role: 'measure', metricId: 'm-qty-avg', operation: 'avg', expand: 'inherit', displayName: '平均交付量' },
        parents: { row: 'c-workshop', column: null },
      },
    ],
    layoutRules: [],
    styleRules: [],
    conditionalRules: [],
    instanceOverrides: [],
    orphanedEdits: [],
    capabilitiesVersion: 'cell-v1',
  };

  const comp = compileCellReport(groupedDoc, D0_DATA);
  assert.equal(comp.valid, true);

  const cells = comp.publication.sheets[0].cells;
  // A row: sum=60, avg=20 (10+20+30 / 3 = 20)
  // B row: sum=140, avg=70 (100+40 / 2 = 70)
  // Grand total: sum=200, avg=40 (200 / 5 = 40, not (20+70)/2 = 45!)
  const grandTotalRow = cells.find((c) => c.v === '总计');
  assert.ok(grandTotalRow, 'Should have grand total row');

  const totalSumCell = cells.find((c) => c.r === grandTotalRow.r && c.c === 1);
  assert.ok(totalSumCell);
  assert.equal(Number(totalSumCell.v), 200, 'SUM(qty) grand total must be 200');

  const totalAvgCell = cells.find((c) => c.r === grandTotalRow.r && c.c === 2);
  assert.ok(totalAvgCell);
  assert.equal(Number(totalAvgCell.v), 40, 'AVG(qty) grand total must be 40 (re-calculated from base facts, not averaged from 20 and 70)');
});

test('D0 Pivot Template: computes Workshop x Month cross-tabulation', () => {
  const pivotDoc = {
    documentType: 'cell-template',
    schemaVersion: '1.0',
    id: 'd0-pivot',
    title: 'D0 交叉报表',
    templateRevision: 1,
    sheets: [{ id: 'sheet-1', name: '交叉' }],
    regions: [
      {
        id: 'r1',
        datasetId: 'production',
        layoutKind: 'pivot',
        sheetId: 'sheet-1',
        anchor: { row: 0, column: 0 },
        metricDirection: 'columns',
        filters: [],
        rowTotals: { showGrandTotals: true, label: '行总计' },
        columnTotals: { showGrandTotals: true, label: '列总计' },
      },
    ],
    cells: [
      {
        id: 'c-workshop',
        sheetId: 'sheet-1',
        regionId: 'r1',
        position: { row: 1, column: 0 },
        content: { kind: 'field', fieldId: 'f-workshop', fieldKey: 'workshop', role: 'row-dimension', operation: 'group', expand: 'down', displayName: '车间' },
        parents: { row: null, column: null },
      },
      {
        id: 'c-month',
        sheetId: 'sheet-1',
        regionId: 'r1',
        position: { row: 0, column: 1 },
        content: {
          kind: 'field',
          fieldId: 'f-date',
          fieldKey: 'date',
          role: 'column-dimension',
          operation: 'group',
          expand: 'right',
          timeBucket: { granularity: 'month' },
          displayName: '月份',
        },
        parents: { row: null, column: null },
      },
      {
        id: 'c-qty',
        sheetId: 'sheet-1',
        regionId: 'r1',
        position: { row: 1, column: 1 },
        content: { kind: 'field', fieldId: 'f-qty', fieldKey: 'qty', role: 'measure', metricId: 'm-qty-sum', operation: 'sum', expand: 'inherit', displayName: '交付量' },
        parents: { row: 'c-workshop', column: 'c-month' },
      },
    ],
    layoutRules: [],
    styleRules: [],
    conditionalRules: [],
    instanceOverrides: [],
    orphanedEdits: [],
    capabilitiesVersion: 'cell-v1',
  };

  const comp = compileCellReport(pivotDoc, D0_DATA);
  assert.equal(comp.valid, true);

  const sheet = comp.publication.sheets[0];
  // 查找 A 和 B 的行
  const aCell = sheet.cells.find((c) => c.v === 'A');
  const bCell = sheet.cells.find((c) => c.v === 'B');
  assert.ok(aCell, 'A row exists');
  assert.ok(bCell, 'B row exists');

  // A 行数据：10月=10+20=30, 11月=30, 行总计=60
  const aValues = sheet.cells.filter((c) => c.r === aCell.r && typeof c.v === 'number').map((c) => c.v);
  assert.ok(aValues.includes(30), 'A has month value 30');
  assert.ok(aValues.includes(60), 'A row total is 60');

  // B 行数据：10月=100, 11月=40, 行总计=140
  const bValues = sheet.cells.filter((c) => c.r === bCell.r && typeof c.v === 'number').map((c) => c.v);
  assert.ok(bValues.includes(100), 'B has Oct value 100');
  assert.ok(bValues.includes(40), 'B has Nov value 40');
  assert.ok(bValues.includes(140), 'B row total is 140');
});
