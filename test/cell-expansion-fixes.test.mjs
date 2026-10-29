import test from 'node:test';
import assert from 'node:assert/strict';
import { expandCellDrivenTemplate } from '../dist/esm/report-template/cellExpansionEngine.js';

test('Fix 1: Static cell shift propagation pushes table footer down without collision', () => {
  const doc = {
    schemaVersion: '2.0',
    capabilitiesVersion: 'cell-expansion-v2',
    id: 'test-shift-propagation',
    title: '静态格推移测试',
    sheets: [{ id: 'sheet-1', name: 'Sheet1' }],
    regions: [{ id: 'r1', datasetId: 'ds-1', sheetId: 'sheet-1' }],
    cells: [
      // 标题 (row 0)
      { id: 'c-title', sheetId: 'sheet-1', position: { row: 0, column: 0 }, content: { kind: 'literal', value: '报表标题' } },
      // 行维度驱动格 (row 1, 展开 3 行)
      { id: 'c-dept', sheetId: 'sheet-1', regionId: 'r1', position: { row: 1, column: 0 }, content: { kind: 'field', fieldKey: 'dept', operation: 'group', expand: 'down' } },
      { id: 'c-sales', sheetId: 'sheet-1', regionId: 'r1', position: { row: 1, column: 1 }, parents: { row: 'c-dept' }, content: { kind: 'field', fieldKey: 'sales', operation: 'sum' } },
      // 静态表尾 (原始模板位置 row 2, column 0)
      { id: 'c-footer', sheetId: 'sheet-1', regionId: 'r1', position: { row: 2, column: 0 }, content: { kind: 'literal', value: '制表人: 张三' } },
    ],
    layoutRules: [],
  };

  const data = [
    { dept: '研发部', sales: 100 },
    { dept: '销售部', sales: 200 },
    { dept: '运营部', sales: 300 },
  ];

  const result = expandCellDrivenTemplate(doc, data);
  // 无碰撞错误
  const collisions = result.diagnostics.filter((d) => d.code === 'ERR_REGION_CELL_COLLISION');
  assert.equal(collisions.length, 0, 'No collision error should be generated');

  // 展开后行维度占据 row 1, 2, 3
  const depts = result.grid.cells.filter((c) => c.role === 'dimension-member');
  assert.equal(depts.length, 3);
  assert.deepEqual(depts.map((c) => c.row).sort((a, b) => a - b), [1, 2, 3]);

  // 表尾被自动推移到 row 4
  const footerCell = result.grid.cells.find((c) => c.value === '制表人: 张三');
  assert.ok(footerCell, 'Footer cell exists');
  assert.equal(footerCell.row, 4, 'Footer cell row must be pushed from 2 to 4');
});

test('Fix 3: Preserves design-time cell merge spans in footprints', () => {
  const doc = {
    schemaVersion: '2.0',
    capabilitiesVersion: 'cell-expansion-v2',
    id: 'test-merge-span',
    title: '合并跨度保留',
    sheets: [{ id: 'sheet-1', name: 'Sheet1' }],
    regions: [{ id: 'r1', datasetId: 'ds-1', sheetId: 'sheet-1' }],
    cells: [
      { id: 'c-prod', sheetId: 'sheet-1', regionId: 'r1', position: { row: 1, column: 0 }, content: { kind: 'field', fieldKey: 'product', operation: 'group', expand: 'down' } },
    ],
    layoutRules: [
      { sheetId: 'sheet-1', kind: 'merge', range: { startRow: 1, startColumn: 0, endRow: 1, endColumn: 2 } }, // 跨3列 (0, 1, 2)
    ],
  };

  const data = [{ product: 'Widget A' }];
  const result = expandCellDrivenTemplate(doc, data);

  const fp = result.footprints.get('c-prod::Widget A');
  assert.ok(fp);
  assert.equal(fp.startCol, 0);
  assert.equal(fp.endCol, 2, 'Footprint merge endCol must retain the 3-column template merge span');
});

test('Fix 4: Record intersection matches primary key across shallow copies', () => {
  const doc = {
    schemaVersion: '2.0',
    capabilitiesVersion: 'cell-expansion-v2',
    id: 'test-pk-intersect',
    title: '跨浅拷贝主键交集计算',
    sheets: [{ id: 'sheet-1', name: 'Sheet1' }],
    regions: [{ id: 'r1', datasetId: 'ds-1', sheetId: 'sheet-1' }],
    cells: [
      { id: 'c-r', sheetId: 'sheet-1', regionId: 'r1', position: { row: 1, column: 0 }, content: { kind: 'field', fieldKey: 'city', operation: 'group', expand: 'down' } },
      { id: 'c-c', sheetId: 'sheet-1', regionId: 'r1', position: { row: 0, column: 1 }, content: { kind: 'field', fieldKey: 'quarter', operation: 'group', expand: 'right' } },
      { id: 'c-val', sheetId: 'sheet-1', regionId: 'r1', position: { row: 1, column: 1 }, parents: { row: 'c-r', column: 'c-c' }, content: { kind: 'field', fieldKey: 'amount', operation: 'sum' } },
    ],
  };

  // 记录拥有相同 id 键
  const data = [
    { id: '101', city: '北京', quarter: 'Q1', amount: 50 },
    { id: '102', city: '北京', quarter: 'Q2', amount: 80 },
  ];

  const result = expandCellDrivenTemplate(doc, data);
  const q1Val = result.grid.cells.find((c) => c.row === 1 && c.col === 1 && c.role === 'metric-value');
  assert.ok(q1Val);
  assert.equal(q1Val.value, 50);
});

test('Fix 5: AVG and MIN return null when group records are empty instead of falsifying 0', () => {
  const doc = {
    schemaVersion: '2.0',
    capabilitiesVersion: 'cell-expansion-v2',
    id: 'test-empty-avg-min',
    title: '空组语义正确性',
    sheets: [{ id: 'sheet-1', name: 'Sheet1' }],
    regions: [{ id: 'r1', datasetId: 'ds-1', sheetId: 'sheet-1' }],
    cells: [
      { id: 'c-city', sheetId: 'sheet-1', regionId: 'r1', position: { row: 1, column: 0 }, content: { kind: 'field', fieldKey: 'city', operation: 'group', expand: 'down' } },
      { id: 'c-q', sheetId: 'sheet-1', regionId: 'r1', position: { row: 0, column: 1 }, content: { kind: 'field', fieldKey: 'quarter', operation: 'group', expand: 'right' } },
      { id: 'c-avg', sheetId: 'sheet-1', regionId: 'r1', position: { row: 1, column: 1 }, parents: { row: 'c-city', column: 'c-q' }, content: { kind: 'field', fieldKey: 'score', operation: 'avg' } },
    ],
  };

  // 广州在 Q2 没有记录
  const data = [
    { city: '北京', quarter: 'Q1', score: 90 },
    { city: '广州', quarter: 'Q1', score: 80 },
    { city: '北京', quarter: 'Q2', score: 95 },
  ];

  const result = expandCellDrivenTemplate(doc, data);
  // 广州 (row 2), Q2 (col 2)
  const emptyAvgCell = result.grid.cells.find((c) => c.row === 2 && c.col === 2 && c.role === 'metric-value');
  assert.ok(emptyAvgCell);
  assert.equal(emptyAvgCell.value, null, 'Empty group average must be null, not 0');
  assert.equal(emptyAvgCell.displayText, '', 'Null average must render empty text');
});

test('Fix 6: Multi-region scope isolation prevents cross-table parent adsorption', () => {
  const doc = {
    schemaVersion: '2.0',
    capabilitiesVersion: 'cell-expansion-v2',
    id: 'test-region-isolation',
    title: '多区域严格隔离',
    sheets: [{ id: 'sheet-1', name: 'Sheet1' }],
    regions: [
      { id: 'r1', datasetId: 'ds-1', sheetId: 'sheet-1' },
      { id: 'r2', datasetId: 'ds-2', sheetId: 'sheet-1' },
    ],
    cells: [
      // 区域 1：位于左侧
      { id: 'c-r1-driver', sheetId: 'sheet-1', regionId: 'r1', position: { row: 1, column: 0 }, content: { kind: 'field', fieldKey: 'dept', operation: 'group', expand: 'down' } },
      { id: 'c-r1-val', sheetId: 'sheet-1', regionId: 'r1', position: { row: 1, column: 1 }, parents: { row: 'default', column: null }, content: { kind: 'field', fieldKey: 'sales', operation: 'sum' } },
      // 区域 2：位于右侧
      { id: 'c-r2-val', sheetId: 'sheet-1', regionId: 'r2', position: { row: 1, column: 4 }, parents: { row: 'default', column: null }, content: { kind: 'literal', value: '区域2独立卡片' } },
    ],
  };

  const data = [{ dept: 'Tech', sales: 100 }];
  const result = expandCellDrivenTemplate(doc, data);

  // 区域2的单元格绝对不能吸附到区域1的驱动格上
  const bR2 = result.grid.bindings.find((b) => b.templateCellId === 'c-r2-val');
  assert.ok(bR2);
  assert.equal(bR2.semantic.role, 'custom');
});

test('Fix 9: Natural sort correctly orders alphanumeric keys (1, 2, 10 instead of 1, 10, 2)', () => {
  const doc = {
    schemaVersion: '2.0',
    capabilitiesVersion: 'cell-expansion-v2',
    id: 'test-natural-sort',
    title: '自然序测试',
    sheets: [{ id: 'sheet-1', name: 'Sheet1' }],
    regions: [{ id: 'r1', datasetId: 'ds-1', sheetId: 'sheet-1' }],
    cells: [
      { id: 'c-month', sheetId: 'sheet-1', regionId: 'r1', position: { row: 0, column: 0 }, content: { kind: 'field', fieldKey: 'month', operation: 'group', expand: 'down' } },
    ],
  };

  const data = [
    { month: '10月' },
    { month: '1月' },
    { month: '2月' },
  ];

  const result = expandCellDrivenTemplate(doc, data);
  const rows = result.grid.cells.filter((c) => c.role === 'dimension-member').map((c) => c.value);
  assert.deepEqual(rows, ['1月', '2月', '10月'], 'Natural sort must place 2月 before 10月');
});

test('Fix 10: Sheet formula evaluates coordinate references like =A1+B1 and =SUM(A1:A3)', () => {
  const doc = {
    schemaVersion: '2.0',
    capabilitiesVersion: 'cell-expansion-v2',
    id: 'test-sheet-formula-coords',
    title: '表格公式坐标解析测试',
    sheets: [{ id: 'sheet-1', name: 'Sheet1' }],
    regions: [{ id: 'r1', datasetId: 'ds-1', sheetId: 'sheet-1' }],
    cells: [
      // A1 (row 0, col 0) = 100
      { id: 'c-a1', sheetId: 'sheet-1', position: { row: 0, column: 0 }, content: { kind: 'literal', value: 100 } },
      // B1 (row 0, col 1) = 200
      { id: 'c-b1', sheetId: 'sheet-1', position: { row: 0, column: 1 }, content: { kind: 'literal', value: 200 } },
      // C1 (row 0, col 2) = =A1+B1
      { id: 'c-c1', sheetId: 'sheet-1', position: { row: 0, column: 2 }, content: { kind: 'sheet-formula', formula: '=A1+B1' } },
      // A2 (row 1, col 0) = 300
      { id: 'c-a2', sheetId: 'sheet-1', position: { row: 1, column: 0 }, content: { kind: 'literal', value: 300 } },
      // D1 (row 0, col 3) = =SUM(A1:A2)
      { id: 'c-d1', sheetId: 'sheet-1', position: { row: 0, column: 3 }, content: { kind: 'sheet-formula', formula: '=SUM(A1:A2)' } },
    ],
  };

  const result = expandCellDrivenTemplate(doc, []);
  const c1 = result.grid.cells.find((c) => c.row === 0 && c.col === 2);
  assert.ok(c1);
  assert.equal(c1.value, 300, '=A1+B1 must evaluate to 300');

  const d1 = result.grid.cells.find((c) => c.row === 0 && c.col === 3);
  assert.ok(d1);
  assert.equal(d1.value, 400, '=SUM(A1:A2) must evaluate to 100+300=400');
});
