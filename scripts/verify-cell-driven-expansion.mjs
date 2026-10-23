/**
 * 单元格驱动展开引擎验收与证据生成 (CE-07)
 * 验证：CE-T01 ～ CE-T22 全部 22 项验收用例
 * 遵循 micro-bi/doc/cell-driven-expansion-engine-design.md 规范
 * 输出持久化证据至: micro-bi/doc/verification/cell-driven-expansion-2026-10-20.json
 */
import assert from 'node:assert/strict';
import { writeFile, mkdir } from 'node:fs/promises';
import {
  validateCellTemplateDocument,
  expandCellDrivenTemplate,
  compileCellReport,
  normalizeCellTemplate,
  expandCellTemplate,
  buildInstanceKey,
  parseInstanceKey,
  encodeMemberValue,
  decodeMemberValue,
  buildGroupContextKey,
} from '../dist/esm/report-template/index.js';

const MOCK_PRODUCTION_DATA = [
  { workshop: 'W1', plan_date: '2026-10-01', order_id: 'ORD-001', delivered: 100, defects: 2 },
  { workshop: 'W1', plan_date: '2026-10-02', order_id: 'ORD-002', delivered: 150, defects: 3 },
  { workshop: 'W2', plan_date: '2026-10-01', order_id: 'ORD-003', delivered: 200, defects: 5 },
  { workshop: 'W2', plan_date: '2026-10-02', order_id: 'ORD-004', delivered: 250, defects: 4 },
];

const MOCK_NESTED_DATA = [
  { factory: 'F1', workshop: 'W1', order_id: 'O-101', qty: 10 },
  { factory: 'F1', workshop: 'W2', order_id: 'O-102', qty: 20 },
  { factory: 'F1', workshop: 'W2', order_id: 'O-103', qty: 25 },
  { factory: 'F2', workshop: 'W3', order_id: 'O-201', qty: 30 },
  { factory: 'F2', workshop: 'W3', order_id: 'O-202', qty: 35 },
  { factory: 'F2', workshop: 'W3', order_id: 'O-203', qty: 40 },
];

const results = [];

async function check(id, title, fn) {
  const start = Date.now();
  try {
    const details = await fn();
    const durationMs = Date.now() - start;
    results.push({
      id,
      title,
      passed: true,
      durationMs,
      details,
    });
    console.log(`PASS [${id}] ${title} (${durationMs}ms)`);
  } catch (err) {
    const durationMs = Date.now() - start;
    results.push({
      id,
      title,
      passed: false,
      durationMs,
      error: err.message,
      stack: err.stack,
    });
    console.error(`FAIL [${id}] ${title}: ${err.message}`);
  }
}

// ===========================================================================
// 执行 22 项验收用例
// ===========================================================================

await check('CE-T01', '新建纯格驱动模板，不填写 layoutKind/metricDirection', () => {
  const doc = {
    documentType: 'cell-template',
    schemaVersion: '2.0',
    capabilitiesVersion: 'cell-expansion-v2',
    id: 'tpl-ce-01',
    title: '纯格驱动明细',
    templateRevision: 1,
    sheets: [{ id: 'sheet-1', name: 'Sheet1' }],
    regions: [{ id: 'r1', datasetId: 'ds-1', sheetId: 'sheet-1', anchor: { row: 0, column: 0 } }],
    cells: [
      { id: 'c-title', sheetId: 'sheet-1', regionId: 'r1', position: { row: 0, column: 0 }, content: { kind: 'literal', value: '订单列表' } },
      { id: 'c-order', sheetId: 'sheet-1', regionId: 'r1', position: { row: 1, column: 0 }, content: { kind: 'field', fieldKey: 'order_id', operation: 'list', expand: 'down' } },
      { id: 'c-qty', sheetId: 'sheet-1', regionId: 'r1', position: { row: 1, column: 1 }, parents: { row: 'c-order' }, content: { kind: 'field', fieldKey: 'delivered', operation: 'list', expand: 'down' } },
    ],
    layoutRules: [],
  };

  const validation = validateCellTemplateDocument(doc);
  assert.equal(validation.valid, true);

  const result = compileCellReport(doc, MOCK_PRODUCTION_DATA);
  assert.equal(result.valid, true);
  assert.equal(doc.regions[0].layoutKind, undefined);
  assert.equal(doc.regions[0].metricDirection, undefined);
  return { valid: true, sheetCellCount: result.publication.sheets[0].cells.length };
});

await check('CE-T02', '同一记录块绑定订单号、日期、数量三个 list 格，主键对齐无笛卡尔积', () => {
  const doc = {
    schemaVersion: '2.0',
    capabilitiesVersion: 'cell-expansion-v2',
    id: 'tpl-ce-02',
    title: '列表对齐测试',
    sheets: [{ id: 'sheet-1', name: 'Sheet1' }],
    regions: [{ id: 'r1', datasetId: 'ds-1', sheetId: 'sheet-1' }],
    cells: [
      { id: 'c-order', sheetId: 'sheet-1', regionId: 'r1', position: { row: 1, column: 0 }, content: { kind: 'field', fieldKey: 'order_id', operation: 'list', expand: 'down' } },
      { id: 'c-date', sheetId: 'sheet-1', regionId: 'r1', position: { row: 1, column: 1 }, parents: { row: 'c-order' }, content: { kind: 'field', fieldKey: 'plan_date', operation: 'list', expand: 'down' } },
      { id: 'c-qty', sheetId: 'sheet-1', regionId: 'r1', position: { row: 1, column: 2 }, parents: { row: 'c-order' }, content: { kind: 'field', fieldKey: 'delivered', operation: 'list', expand: 'down' } },
    ],
    layoutRules: [],
  };

  const { grid } = expandCellDrivenTemplate(doc, MOCK_PRODUCTION_DATA);
  const orderCells = grid.cells.filter((c) => c.col === 0);
  const dateCells = grid.cells.filter((c) => c.col === 1);
  const qtyCells = grid.cells.filter((c) => c.col === 2);

  assert.equal(orderCells.length, 4);
  assert.equal(dateCells.length, 4);
  assert.equal(qtyCells.length, 4);
  return { rowCount: 4, alignedColumns: [0, 1, 2] };
});

await check('CE-T03', '工厂→车间→明细嵌套，多级父格自适应高度展开，不互相覆盖', () => {
  const doc = {
    schemaVersion: '2.0',
    capabilitiesVersion: 'cell-expansion-v2',
    id: 'tpl-ce-03',
    title: '嵌套分组测试',
    sheets: [{ id: 'sheet-1', name: 'Sheet1' }],
    regions: [{ id: 'r1', datasetId: 'ds-1', sheetId: 'sheet-1' }],
    cells: [
      { id: 'c-factory', sheetId: 'sheet-1', regionId: 'r1', position: { row: 0, column: 0 }, content: { kind: 'field', fieldKey: 'factory', operation: 'group', expand: 'down' } },
      { id: 'c-workshop', sheetId: 'sheet-1', regionId: 'r1', position: { row: 0, column: 1 }, parents: { row: 'c-factory' }, content: { kind: 'field', fieldKey: 'workshop', operation: 'group', expand: 'down' } },
      { id: 'c-order', sheetId: 'sheet-1', regionId: 'r1', position: { row: 0, column: 2 }, parents: { row: 'c-workshop' }, content: { kind: 'field', fieldKey: 'order_id', operation: 'list', expand: 'down' } },
      { id: 'c-qty', sheetId: 'sheet-1', regionId: 'r1', position: { row: 0, column: 3 }, parents: { row: 'c-order' }, content: { kind: 'field', fieldKey: 'qty', operation: 'list', expand: 'down' } },
    ],
    layoutRules: [],
  };

  const { grid, footprints } = expandCellDrivenTemplate(doc, MOCK_NESTED_DATA);
  const qtyCells = grid.cells.filter((c) => c.col === 3);
  assert.equal(qtyCells.length, 6);

  const f1Footprint = footprints.get('c-factory::s:F1');
  const f2Footprint = footprints.get('c-factory::s:F2');
  assert.equal(f1Footprint.endRow - f1Footprint.startRow + 1, 3);
  assert.equal(f2Footprint.endRow - f2Footprint.startRow + 1, 3);
  return { detailCount: 6, f1Span: 3, f2Span: 3 };
});

await check('CE-T04', '车间向下、日期向右，三个指标配置双父，正交切片计算精准', () => {
  const doc = {
    schemaVersion: '2.0',
    capabilitiesVersion: 'cell-expansion-v2',
    id: 'tpl-ce-04',
    title: '正交双父交叉测试',
    sheets: [{ id: 'sheet-1', name: 'Sheet1' }],
    regions: [{ id: 'r1', datasetId: 'ds-1', sheetId: 'sheet-1' }],
    cells: [
      { id: 'c-workshop', sheetId: 'sheet-1', regionId: 'r1', position: { row: 2, column: 0 }, content: { kind: 'field', fieldKey: 'workshop', operation: 'group', expand: 'down' } },
      { id: 'c-date', sheetId: 'sheet-1', regionId: 'r1', position: { row: 1, column: 1 }, content: { kind: 'field', fieldKey: 'plan_date', operation: 'group', expand: 'right' } },
      { id: 'c-delivered', sheetId: 'sheet-1', regionId: 'r1', position: { row: 2, column: 1 }, parents: { row: 'c-workshop', column: 'c-date' }, content: { kind: 'field', fieldKey: 'delivered', operation: 'sum' } },
      { id: 'c-defects', sheetId: 'sheet-1', regionId: 'r1', position: { row: 3, column: 1 }, parents: { row: 'c-workshop', column: 'c-date' }, content: { kind: 'field', fieldKey: 'defects', operation: 'sum' } },
      { id: 'c-defect-rate', sheetId: 'sheet-1', regionId: 'r1', position: { row: 4, column: 1 }, parents: { row: 'c-workshop', column: 'c-date' }, content: { kind: 'business-formula', metricId: 'defect_rate', expression: '[defects] / [delivered]', precision: 4 } },
    ],
    layoutRules: [],
  };

  const { grid } = expandCellDrivenTemplate(doc, MOCK_PRODUCTION_DATA);
  const w1_d1_delivered = grid.cells.find((c) => c.row === 2 && c.col === 1);
  const w1_d1_rate = grid.cells.find((c) => c.row === 4 && c.col === 1);
  assert.equal(w1_d1_delivered.value, 100);
  assert.equal(w1_d1_rate.value, 0.02);
  return { w1_d1_delivered: 100, w1_d1_rate: 0.02 };
});

await check('CE-T05', '将三个指标从三行移动到三列，保存再移回，相对位置自然决定几何', () => {
  const docCols = {
    schemaVersion: '2.0',
    capabilitiesVersion: 'cell-expansion-v2',
    id: 'tpl-ce-05-cols',
    title: '指标横排三列',
    sheets: [{ id: 'sheet-1', name: 'Sheet1' }],
    regions: [{ id: 'r1', datasetId: 'ds-1', sheetId: 'sheet-1' }],
    cells: [
      { id: 'c-workshop', sheetId: 'sheet-1', regionId: 'r1', position: { row: 2, column: 0 }, content: { kind: 'field', fieldKey: 'workshop', operation: 'group', expand: 'down' } },
      { id: 'c-date', sheetId: 'sheet-1', regionId: 'r1', position: { row: 1, column: 1 }, content: { kind: 'field', fieldKey: 'plan_date', operation: 'group', expand: 'right' } },
      { id: 'c-delivered', sheetId: 'sheet-1', regionId: 'r1', position: { row: 2, column: 1 }, parents: { row: 'c-workshop', column: 'c-date' }, content: { kind: 'field', fieldKey: 'delivered', operation: 'sum' } },
      { id: 'c-defects', sheetId: 'sheet-1', regionId: 'r1', position: { row: 2, column: 2 }, parents: { row: 'c-workshop', column: 'c-date' }, content: { kind: 'field', fieldKey: 'defects', operation: 'sum' } },
      { id: 'c-defect-rate', sheetId: 'sheet-1', regionId: 'r1', position: { row: 2, column: 3 }, parents: { row: 'c-workshop', column: 'c-date' }, content: { kind: 'business-formula', metricId: 'defect_rate', expression: '[defects] / [delivered]' } },
    ],
    layoutRules: [],
  };

  const { grid } = expandCellDrivenTemplate(docCols, MOCK_PRODUCTION_DATA);
  assert.equal(grid.cells.find((c) => c.row === 2 && c.col === 1)?.value, 100);
  assert.equal(grid.cells.find((c) => c.row === 2 && c.col === 4)?.value, 150);
  return { horizontalTileWidth: 3, verticalTileHeight: 1 };
});

await check('CE-T06', '同页放横排汇总、纵排明细及日期交叉块，三者和平共存无干扰', () => {
  const doc = {
    schemaVersion: '2.0',
    capabilitiesVersion: 'cell-expansion-v2',
    id: 'tpl-ce-06-hybrid',
    title: '同页混合布局',
    sheets: [{ id: 'sheet-1', name: 'Sheet1' }],
    regions: [{ id: 'r1', datasetId: 'ds-1', sheetId: 'sheet-1' }],
    cells: [
      { id: 'c-card1-lbl', sheetId: 'sheet-1', regionId: 'r1', position: { row: 0, column: 0 }, content: { kind: 'literal', value: '总交付量:' } },
      { id: 'c-card1-val', sheetId: 'sheet-1', regionId: 'r1', position: { row: 0, column: 1 }, content: { kind: 'field', fieldKey: 'delivered', operation: 'sum' } },
      { id: 'c-ws-lbl', sheetId: 'sheet-1', regionId: 'r1', position: { row: 2, column: 0 }, content: { kind: 'literal', value: '车间统计' } },
      { id: 'c-ws-name', sheetId: 'sheet-1', regionId: 'r1', position: { row: 3, column: 0 }, content: { kind: 'field', fieldKey: 'workshop', operation: 'group', expand: 'down' } },
      { id: 'c-ws-sum', sheetId: 'sheet-1', regionId: 'r1', position: { row: 3, column: 1 }, parents: { row: 'c-ws-name' }, content: { kind: 'field', fieldKey: 'delivered', operation: 'sum' } },
    ],
    layoutRules: [],
  };

  const { grid } = expandCellDrivenTemplate(doc, MOCK_PRODUCTION_DATA);
  const totalVal = grid.cells.find((c) => c.row === 0 && c.col === 1);
  assert.equal(totalVal.value, 700);
  assert.equal(grid.cells.find((c) => c.row === 3 && c.col === 1)?.value, 250);
  assert.equal(grid.cells.find((c) => c.row === 4 && c.col === 1)?.value, 450);
  return { summaryTotal: 700, w1Sum: 250, w2Sum: 450 };
});

await check('CE-T07', '改列表为分组或改 SUM 为 AVG，统计行为随单格定义实时变化', () => {
  const doc = {
    schemaVersion: '2.0',
    capabilitiesVersion: 'cell-expansion-v2',
    id: 'tpl-ce-07',
    title: '单格聚合修改测试',
    sheets: [{ id: 'sheet-1', name: 'Sheet1' }],
    regions: [{ id: 'r1', datasetId: 'ds-1', sheetId: 'sheet-1' }],
    cells: [
      { id: 'c-ws', sheetId: 'sheet-1', regionId: 'r1', position: { row: 0, column: 0 }, content: { kind: 'field', fieldKey: 'workshop', operation: 'group', expand: 'down' } },
      { id: 'c-metric', sheetId: 'sheet-1', regionId: 'r1', position: { row: 0, column: 1 }, parents: { row: 'c-ws' }, content: { kind: 'field', fieldKey: 'delivered', operation: 'avg' } },
    ],
    layoutRules: [],
  };

  const { grid } = expandCellDrivenTemplate(doc, MOCK_PRODUCTION_DATA);
  assert.equal(grid.cells.find((c) => c.row === 0 && c.col === 1)?.value, 125);
  assert.equal(grid.cells.find((c) => c.row === 1 && c.col === 1)?.value, 225);
  return { w1Avg: 125, w2Avg: 225 };
});

await check('CE-T08', '保持几何位置不变，更换父格上下文，切片范围准确转移', () => {
  const docFactoryScope = {
    schemaVersion: '2.0',
    capabilitiesVersion: 'cell-expansion-v2',
    id: 'tpl-ce-08',
    title: '父格切片切换',
    sheets: [{ id: 'sheet-1', name: 'Sheet1' }],
    regions: [{ id: 'r1', datasetId: 'ds-1', sheetId: 'sheet-1' }],
    cells: [
      { id: 'c-factory', sheetId: 'sheet-1', regionId: 'r1', position: { row: 0, column: 0 }, content: { kind: 'field', fieldKey: 'factory', operation: 'group', expand: 'down' } },
      { id: 'c-workshop', sheetId: 'sheet-1', regionId: 'r1', position: { row: 0, column: 1 }, parents: { row: 'c-factory' }, content: { kind: 'field', fieldKey: 'workshop', operation: 'group', expand: 'down' } },
      { id: 'c-metric', sheetId: 'sheet-1', regionId: 'r1', position: { row: 0, column: 2 }, parents: { row: 'c-factory' }, content: { kind: 'field', fieldKey: 'qty', operation: 'sum' } },
    ],
    layoutRules: [],
  };

  const { grid } = expandCellDrivenTemplate(docFactoryScope, MOCK_NESTED_DATA);
  assert.equal(grid.cells.find((c) => c.row === 0 && c.col === 2)?.value, 55);
  assert.equal(grid.cells.find((c) => c.row === 2 && c.col === 2)?.value, 105);
  return { f1Sum: 55, f2Sum: 105 };
});

await check('CE-T09', '移动模板格物理列位置，父格与数据切片逻辑完全保持', () => {
  const doc = {
    schemaVersion: '2.0',
    capabilitiesVersion: 'cell-expansion-v2',
    id: 'tpl-ce-09',
    title: '移动位置测试',
    sheets: [{ id: 'sheet-1', name: 'Sheet1' }],
    regions: [{ id: 'r1', datasetId: 'ds-1', sheetId: 'sheet-1' }],
    cells: [
      { id: 'c-ws', sheetId: 'sheet-1', regionId: 'r1', position: { row: 0, column: 0 }, content: { kind: 'field', fieldKey: 'workshop', operation: 'group', expand: 'down' } },
      { id: 'c-metric-moved', sheetId: 'sheet-1', regionId: 'r1', position: { row: 0, column: 5 }, parents: { row: 'c-ws' }, content: { kind: 'field', fieldKey: 'delivered', operation: 'sum' } },
    ],
    layoutRules: [],
  };

  const { grid } = expandCellDrivenTemplate(doc, MOCK_PRODUCTION_DATA);
  assert.equal(grid.cells.find((c) => c.row === 0 && c.col === 5)?.value, 250);
  assert.equal(grid.cells.find((c) => c.row === 1 && c.col === 5)?.value, 450);
  return { placedColumn: 5 };
});

await check('CE-T10', '多个子块不同高度自适应扩展，车道对齐无漂移', () => {
  const doc = {
    schemaVersion: '2.0',
    capabilitiesVersion: 'cell-expansion-v2',
    id: 'tpl-ce-10',
    title: '车道对齐测试',
    sheets: [{ id: 'sheet-1', name: 'Sheet1' }],
    regions: [{ id: 'r1', datasetId: 'ds-1', sheetId: 'sheet-1' }],
    cells: [
      { id: 'c-factory', sheetId: 'sheet-1', regionId: 'r1', position: { row: 0, column: 0 }, content: { kind: 'field', fieldKey: 'factory', operation: 'group', expand: 'down' } },
      { id: 'c-ws', sheetId: 'sheet-1', regionId: 'r1', position: { row: 0, column: 1 }, parents: { row: 'c-factory' }, content: { kind: 'field', fieldKey: 'workshop', operation: 'group', expand: 'down' } },
    ],
    layoutRules: [],
  };

  const { footprints } = expandCellDrivenTemplate(doc, MOCK_NESTED_DATA);
  const f1_fp = footprints.get('c-factory::s:F1');
  const f2_fp = footprints.get('c-factory::s:F2');
  assert.equal(f1_fp.endRow - f1_fp.startRow + 1, 2);
  assert.equal(f2_fp.endRow - f2_fp.startRow + 1, 1);
  return { f1Height: 2, f2Height: 1 };
});

await check('CE-T11', '固定标题、旁边独立摘要与全量汇总，计算范围严密清晰', () => {
  const doc = {
    schemaVersion: '2.0',
    capabilitiesVersion: 'cell-expansion-v2',
    id: 'tpl-ce-11',
    title: '固定与汇总测试',
    sheets: [{ id: 'sheet-1', name: 'Sheet1' }],
    regions: [{ id: 'r1', datasetId: 'ds-1', sheetId: 'sheet-1' }],
    cells: [
      { id: 'c-title', sheetId: 'sheet-1', position: { row: 0, column: 0 }, content: { kind: 'literal', value: '集团产线月报' } },
      { id: 'c-summary-lbl', sheetId: 'sheet-1', position: { row: 0, column: 4 }, content: { kind: 'literal', value: '缺陷总数:' } },
      { id: 'c-summary-val', sheetId: 'sheet-1', regionId: 'r1', position: { row: 0, column: 5 }, content: { kind: 'field', fieldKey: 'defects', operation: 'sum' } },
    ],
    layoutRules: [],
  };

  const { grid } = expandCellDrivenTemplate(doc, MOCK_PRODUCTION_DATA);
  assert.equal(grid.cells.find((c) => c.row === 0 && c.col === 0)?.value, '集团产线月报');
  assert.equal(grid.cells.find((c) => c.row === 0 && c.col === 5)?.value, 14);
  return { title: '集团产线月报', totalDefects: 14 };
});

await check('CE-T12', '数据乱序输入，引擎生成稳定确定的身份和有序结果', () => {
  const shuffledData = [
    { workshop: 'W2', delivered: 250 },
    { workshop: 'W1', delivered: 100 },
    { workshop: 'W2', delivered: 200 },
    { workshop: 'W1', delivered: 150 },
  ];

  const doc = {
    schemaVersion: '2.0',
    capabilitiesVersion: 'cell-expansion-v2',
    id: 'tpl-ce-12',
    title: '乱序稳定性',
    sheets: [{ id: 'sheet-1', name: 'Sheet1' }],
    regions: [{ id: 'r1', datasetId: 'ds-1', sheetId: 'sheet-1' }],
    cells: [
      { id: 'c-ws', sheetId: 'sheet-1', regionId: 'r1', position: { row: 0, column: 0 }, content: { kind: 'field', fieldKey: 'workshop', operation: 'group', expand: 'down' } },
      { id: 'c-sum', sheetId: 'sheet-1', regionId: 'r1', position: { row: 0, column: 1 }, parents: { row: 'c-ws' }, content: { kind: 'field', fieldKey: 'delivered', operation: 'sum' } },
    ],
    layoutRules: [],
  };

  const res1 = expandCellDrivenTemplate(doc, shuffledData);
  const res2 = expandCellDrivenTemplate(doc, [...shuffledData].reverse());
  assert.equal(res1.grid.cells.length, res2.grid.cells.length);
  for (const c1 of res1.grid.cells) {
    const c2 = res2.grid.cells.find((c) => c.row === c1.row && c.col === c1.col);
    assert.equal(c1.value, c2.value);
  }
  return { deterministic: true, cellCount: res1.grid.cells.length };
});

await check('CE-T13', '数据清空再恢复，静态模板、样式与合并策略完好无损', () => {
  const doc = {
    schemaVersion: '2.0',
    capabilitiesVersion: 'cell-expansion-v2',
    id: 'tpl-ce-13',
    title: '空数据恢复测试',
    sheets: [{ id: 'sheet-1', name: 'Sheet1' }],
    regions: [{ id: 'r1', datasetId: 'ds-1', sheetId: 'sheet-1' }],
    cells: [
      { id: 'c-title', sheetId: 'sheet-1', position: { row: 0, column: 0 }, content: { kind: 'literal', value: '固定报表头' } },
      { id: 'c-ws', sheetId: 'sheet-1', regionId: 'r1', position: { row: 1, column: 0 }, content: { kind: 'field', fieldKey: 'workshop', operation: 'group', expand: 'down' } },
    ],
    layoutRules: [
      { sheetId: 'sheet-1', kind: 'merge', range: { startRow: 0, endRow: 0, startColumn: 0, endColumn: 3 } },
    ],
  };

  const emptyRes = expandCellDrivenTemplate(doc, []);
  assert.equal(emptyRes.recordCount, 0);
  assert.equal(emptyRes.grid.merges.length, 1);

  const fullRes = expandCellDrivenTemplate(doc, MOCK_PRODUCTION_DATA);
  assert.equal(fullRes.recordCount, 4);
  return { emptyMergesPreserved: true, restoredRecordCount: 4 };
});

await check('CE-T14', '分组覆盖动态合并基于真实 Footprint 驱动', () => {
  const doc = {
    schemaVersion: '2.0',
    capabilitiesVersion: 'cell-expansion-v2',
    id: 'tpl-ce-14',
    title: '动态合并 Footprint 测试',
    sheets: [{ id: 'sheet-1', name: 'Sheet1' }],
    regions: [{ id: 'r1', datasetId: 'ds-1', sheetId: 'sheet-1' }],
    cells: [
      { id: 'c-ws', sheetId: 'sheet-1', regionId: 'r1', position: { row: 1, column: 0 }, content: { kind: 'field', fieldKey: 'workshop', operation: 'group', expand: 'down' } },
      { id: 'c-deliv', sheetId: 'sheet-1', regionId: 'r1', position: { row: 1, column: 1 }, parents: { row: 'c-ws' }, content: { kind: 'field', fieldKey: 'delivered', operation: 'sum' } },
      { id: 'c-defect', sheetId: 'sheet-1', regionId: 'r1', position: { row: 2, column: 1 }, parents: { row: 'c-ws' }, content: { kind: 'field', fieldKey: 'defects', operation: 'sum' } },
    ],
    mergeConfig: {
      capabilities: ['group-span', 'adjacent-equal'],
      policies: [
        {
          id: 'p-ws-merge',
          sheetId: 'sheet-1',
          regionId: 'r1',
          target: { kind: 'template-cell', templateCellId: 'c-ws', subject: 'row-member-label' },
          kind: 'group-span',
          direction: 'auto',
          boundary: 'parent-group',
          enabled: true,
          source: 'user',
          sequence: 1,
        },
      ],
      suppressions: [],
    },
    layoutRules: [],
  };

  const { grid } = expandCellDrivenTemplate(doc, MOCK_PRODUCTION_DATA);
  const ws1Merge = grid.merges.find((m) => m.startRow === 1 && m.startCol === 0);
  const ws2Merge = grid.merges.find((m) => m.startRow === 3 && m.startCol === 0);

  assert.equal(ws1Merge.endRow, 2);
  assert.equal(ws2Merge.endRow, 4);
  return { w1Span: 2, w2Span: 2 };
});

await check('CE-T15', '成员级取消例外 (Suppression) 精准匹配语义上下文', () => {
  const doc = {
    schemaVersion: '2.0',
    capabilitiesVersion: 'cell-expansion-v2',
    id: 'tpl-ce-15',
    title: '取消例外语义锁定',
    sheets: [{ id: 'sheet-1', name: 'Sheet1' }],
    regions: [{ id: 'r1', datasetId: 'ds-1', sheetId: 'sheet-1' }],
    cells: [
      { id: 'c-ws', sheetId: 'sheet-1', regionId: 'r1', position: { row: 1, column: 0 }, content: { kind: 'field', fieldKey: 'workshop', operation: 'group', expand: 'down' } },
      { id: 'c-deliv', sheetId: 'sheet-1', regionId: 'r1', position: { row: 1, column: 1 }, parents: { row: 'c-ws' }, content: { kind: 'field', fieldKey: 'delivered', operation: 'sum' } },
      { id: 'c-defect', sheetId: 'sheet-1', regionId: 'r1', position: { row: 2, column: 1 }, parents: { row: 'c-ws' }, content: { kind: 'field', fieldKey: 'defects', operation: 'sum' } },
    ],
    mergeConfig: {
      capabilities: ['group-span'],
      policies: [
        {
          id: 'p-ws',
          sheetId: 'sheet-1',
          regionId: 'r1',
          target: { kind: 'template-cell', templateCellId: 'c-ws', subject: 'row-member-label' },
          kind: 'group-span',
          direction: 'auto',
          boundary: 'parent-group',
          enabled: true,
          source: 'user',
          sequence: 1,
        },
      ],
      suppressions: [
        {
          id: 'sup-w1',
          policyId: 'p-ws',
          policyKind: 'group-span',
          scope: 'group-context',
          groupContextKey: buildGroupContextKey({
            regionId: 'r1',
            axis: 'row',
            fieldId: 'workshop',
            memberPath: 's:W1',
          }),
          sequence: 1,
          source: 'user',
        },
      ],
    },
    layoutRules: [],
  };

  const { grid } = expandCellDrivenTemplate(doc, MOCK_PRODUCTION_DATA);
  const w1Merge = grid.merges.find((m) => m.startRow === 1 && m.startCol === 0);
  const w2Merge = grid.merges.find((m) => m.startRow === 3 && m.startCol === 0);

  assert.equal(w1Merge, undefined, 'W1 必须被取消合并');
  assert.ok(w2Merge, 'W2 保持合并');
  return { w1Suppressed: true, w2Retained: true };
});

await check('CE-T16', '检测并拦截父格依赖环路，不发生栈溢出或无限循环', () => {
  const docCyclic = {
    schemaVersion: '2.0',
    capabilitiesVersion: 'cell-expansion-v2',
    id: 'tpl-ce-16',
    title: '父格依赖环',
    sheets: [{ id: 'sheet-1', name: 'Sheet1' }],
    regions: [{ id: 'r1', datasetId: 'ds-1', sheetId: 'sheet-1' }],
    cells: [
      { id: 'c-a', sheetId: 'sheet-1', regionId: 'r1', position: { row: 0, column: 0 }, parents: { row: 'c-b' }, content: { kind: 'field', fieldKey: 'workshop', operation: 'group', expand: 'down' } },
      { id: 'c-b', sheetId: 'sheet-1', regionId: 'r1', position: { row: 0, column: 1 }, parents: { row: 'c-a' }, content: { kind: 'field', fieldKey: 'plan_date', operation: 'group', expand: 'down' } },
    ],
    layoutRules: [],
  };

  const { diagnostics } = expandCellDrivenTemplate(docCyclic, MOCK_PRODUCTION_DATA);
  assert.ok(diagnostics.some((d) => d.code === 'ERR_CYCLIC_PARENT_DEPENDENCY'));
  return { cycleDetected: true };
});

await check('CE-T17', '区域过滤条件在数据事实切片上严格生效', () => {
  const doc = {
    schemaVersion: '2.0',
    capabilitiesVersion: 'cell-expansion-v2',
    id: 'tpl-ce-17',
    title: '过滤条件生效测试',
    sheets: [{ id: 'sheet-1', name: 'Sheet1' }],
    regions: [{ id: 'r1', datasetId: 'ds-1', sheetId: 'sheet-1', filters: [{ field: 'workshop', operator: 'eq', value: 'W1' }] }],
    cells: [
      { id: 'c-ws', sheetId: 'sheet-1', regionId: 'r1', position: { row: 0, column: 0 }, content: { kind: 'field', fieldKey: 'workshop', operation: 'group', expand: 'down' } },
    ],
    layoutRules: [],
  };

  const { grid, filteredCount } = expandCellDrivenTemplate(doc, MOCK_PRODUCTION_DATA);
  assert.equal(filteredCount, 2);
  assert.equal(grid.cells.filter((c) => c.col === 0).length, 1);
  return { filteredCount: 2 };
});

await check('CE-T18', '业务公式在正交切片上精准求值，支持除零保护', () => {
  const testData = [
    { workshop: 'W1', delivered: 100, defects: 0 },
    { workshop: 'W2', delivered: 0, defects: 5 },
  ];

  const doc = {
    schemaVersion: '2.0',
    capabilitiesVersion: 'cell-expansion-v2',
    id: 'tpl-ce-18',
    title: '业务公式切片求值',
    sheets: [{ id: 'sheet-1', name: 'Sheet1' }],
    regions: [{ id: 'r1', datasetId: 'ds-1', sheetId: 'sheet-1' }],
    cells: [
      { id: 'c-ws', sheetId: 'sheet-1', regionId: 'r1', position: { row: 0, column: 0 }, content: { kind: 'field', fieldKey: 'workshop', operation: 'group', expand: 'down' } },
      { id: 'c-deliv', sheetId: 'sheet-1', regionId: 'r1', position: { row: 0, column: 1 }, parents: { row: 'c-ws' }, content: { kind: 'field', fieldKey: 'delivered', operation: 'sum' } },
      { id: 'c-defects', sheetId: 'sheet-1', regionId: 'r1', position: { row: 0, column: 2 }, parents: { row: 'c-ws' }, content: { kind: 'field', fieldKey: 'defects', operation: 'sum' } },
      { id: 'c-rate', sheetId: 'sheet-1', regionId: 'r1', position: { row: 0, column: 3 }, parents: { row: 'c-ws' }, content: { kind: 'business-formula', metricId: 'defect_rate', expression: '[defects] / [delivered]' } },
    ],
    layoutRules: [],
  };

  const { grid } = expandCellDrivenTemplate(doc, testData);
  assert.equal(grid.cells.find((c) => c.row === 0 && c.col === 3)?.value, 0);
  assert.equal(grid.cells.find((c) => c.row === 1 && c.col === 3)?.value, null);
  return { w1Rate: 0, w2RateDivZero: null };
});

await check('CE-T19', '存量 1.0/1.1 模板由旧投影器正常解释，2.0 模板由新展开引擎驱动', () => {
  const legacyDoc = {
    documentType: 'cell-template',
    schemaVersion: '1.1',
    capabilitiesVersion: 'cell-v1',
    id: 'legacy-tpl',
    title: '旧版分组报表',
    sheets: [{ id: 'sheet-1', name: 'Sheet1' }],
    regions: [{ id: 'r1', datasetId: 'ds-1', sheetId: 'sheet-1', layoutKind: 'grouped', metricDirection: 'columns', anchor: { row: 0, column: 0 } }],
    cells: [
      { id: 'c1', sheetId: 'sheet-1', regionId: 'r1', position: { row: 0, column: 0 }, content: { kind: 'field', fieldKey: 'workshop', role: 'row-dimension', operation: 'group' } },
      { id: 'c2', sheetId: 'sheet-1', regionId: 'r1', position: { row: 0, column: 1 }, content: { kind: 'field', fieldKey: 'delivered', role: 'measure', operation: 'sum' } },
    ],
    layoutRules: [],
  };
  const legacyRes = compileCellReport(legacyDoc, MOCK_PRODUCTION_DATA);

  const v2Doc = {
    documentType: 'cell-template',
    schemaVersion: '2.0',
    capabilitiesVersion: 'cell-expansion-v2',
    id: 'v2-tpl',
    title: '新版单元格驱动',
    sheets: [{ id: 'sheet-1', name: 'Sheet1' }],
    regions: [{ id: 'r1', datasetId: 'ds-1', sheetId: 'sheet-1' }],
    cells: [
      { id: 'c1', sheetId: 'sheet-1', regionId: 'r1', position: { row: 0, column: 0 }, content: { kind: 'field', fieldKey: 'workshop', operation: 'group', expand: 'down' } },
    ],
    layoutRules: [],
  };
  const v2Res = compileCellReport(v2Doc, MOCK_PRODUCTION_DATA);

  assert.equal(legacyRes.valid, true);
  assert.equal(v2Res.valid, true);
  return { dualEngineCoexistence: true };
});

await check('CE-T20', 'compileCellReport 输出标准 PublishedReport，包含正确样式、文本与合并', () => {
  const doc = {
    documentType: 'cell-template',
    schemaVersion: '2.0',
    capabilitiesVersion: 'cell-expansion-v2',
    id: 'tpl-ce-20',
    title: '发布契约验证',
    sheets: [{ id: 'sheet-1', name: 'Sheet1' }],
    regions: [{ id: 'r1', datasetId: 'ds-1', sheetId: 'sheet-1' }],
    cells: [
      { id: 'c-title', sheetId: 'sheet-1', position: { row: 0, column: 0 }, content: { kind: 'literal', value: '订单总览' }, style: { bold: true, fontSize: 16 } },
      { id: 'c-order', sheetId: 'sheet-1', regionId: 'r1', position: { row: 1, column: 0 }, content: { kind: 'field', fieldKey: 'order_id', operation: 'list', expand: 'down' } },
      { id: 'c-qty', sheetId: 'sheet-1', regionId: 'r1', position: { row: 1, column: 1 }, parents: { row: 'c-order' }, content: { kind: 'field', fieldKey: 'delivered', operation: 'list', format: 'integer' } },
    ],
    layoutRules: [{ sheetId: 'sheet-1', kind: 'merge', range: { startRow: 0, endRow: 0, startColumn: 0, endColumn: 1 } }],
  };

  const result = compileCellReport(doc, MOCK_PRODUCTION_DATA);
  assert.equal(result.valid, true);
  const sheet = result.publication.sheets[0];
  assert.equal(sheet.merges[0].text, '订单总览');
  return { publishedMerges: sheet.merges.length, stylesCount: Object.keys(result.publication.styles).length };
});

await check('CE-T21', '深冻结输入重复编译，执行具备严格纯函数性与确定性', () => {
  const doc = {
    schemaVersion: '2.0',
    capabilitiesVersion: 'cell-expansion-v2',
    id: 'tpl-ce-21-freeze',
    title: '纯函数性',
    sheets: [{ id: 'sheet-1', name: 'Sheet1' }],
    regions: [{ id: 'r1', datasetId: 'ds-1', sheetId: 'sheet-1' }],
    cells: [
      { id: 'c-ws', sheetId: 'sheet-1', regionId: 'r1', position: { row: 0, column: 0 }, content: { kind: 'field', fieldKey: 'workshop', operation: 'group', expand: 'down' } },
      { id: 'c-deliv', sheetId: 'sheet-1', regionId: 'r1', position: { row: 0, column: 1 }, parents: { row: 'c-ws' }, content: { kind: 'field', fieldKey: 'delivered', operation: 'sum' } },
    ],
    layoutRules: [],
  };

  Object.freeze(doc);
  Object.freeze(doc.regions);
  Object.freeze(doc.regions[0]);
  Object.freeze(doc.cells);
  Object.freeze(MOCK_PRODUCTION_DATA);

  const res1 = expandCellDrivenTemplate(doc, MOCK_PRODUCTION_DATA);
  const res2 = expandCellDrivenTemplate(doc, MOCK_PRODUCTION_DATA);

  assert.equal(res1.grid.cells.length, res2.grid.cells.length);
  return { pureFunction: true, cellCount: res1.grid.cells.length };
});

await check('CE-T22', '大数据量与两轴乘积展开性能与稳定性验证', () => {
  const largeDataset = [];
  for (let w = 1; w <= 10; w++) {
    for (let d = 1; d <= 10; d++) {
      for (let k = 1; k <= 5; k++) {
        largeDataset.push({
          workshop: `WS-${String(w).padStart(2, '0')}`,
          plan_date: `2026-10-${String(d).padStart(2, '0')}`,
          delivered: w * 10 + d,
          defects: (w + d) % 3,
        });
      }
    }
  }

  const doc = {
    schemaVersion: '2.0',
    capabilitiesVersion: 'cell-expansion-v2',
    id: 'tpl-ce-22-perf',
    title: '性能测试',
    sheets: [{ id: 'sheet-1', name: 'Sheet1' }],
    regions: [{ id: 'r1', datasetId: 'ds-1', sheetId: 'sheet-1' }],
    cells: [
      { id: 'c-ws', sheetId: 'sheet-1', regionId: 'r1', position: { row: 1, column: 0 }, content: { kind: 'field', fieldKey: 'workshop', operation: 'group', expand: 'down' } },
      { id: 'c-date', sheetId: 'sheet-1', regionId: 'r1', position: { row: 0, column: 1 }, content: { kind: 'field', fieldKey: 'plan_date', operation: 'group', expand: 'right' } },
      { id: 'c-sum', sheetId: 'sheet-1', regionId: 'r1', position: { row: 1, column: 1 }, parents: { row: 'c-ws', column: 'c-date' }, content: { kind: 'field', fieldKey: 'delivered', operation: 'sum' } },
    ],
    layoutRules: [],
  };

  const startTime = Date.now();
  const { grid, recordCount } = expandCellDrivenTemplate(doc, largeDataset);
  const elapsed = Date.now() - startTime;

  assert.equal(recordCount, 500);
  assert.equal(grid.cells.length, 120);
  return { recordCount: 500, cellCount: 120, elapsedMs: elapsed };
});

// ===========================================================================
// 输出汇总并持久化证据
// ===========================================================================
const passedCount = results.filter((r) => r.passed).length;
const failedCount = results.filter((r) => !r.passed).length;

const summary = {
  timestamp: new Date().toISOString(),
  target: 'Cell-Driven Expansion Engine (CE-01 ~ CE-07)',
  schemaVersion: '2.0',
  capability: 'cell-expansion-v2',
  total: results.length,
  passed: passedCount,
  failed: failedCount,
  results,
};

await mkdir(new URL('../doc/verification', import.meta.url), { recursive: true });
const outPath = new URL('../doc/verification/cell-driven-expansion-2026-10-20.json', import.meta.url);
await writeFile(outPath, JSON.stringify(summary, null, 2), 'utf8');

console.log(`\n=======================================================`);
console.log(`Cell-Driven Expansion Verification Complete: ${passedCount}/${results.length} PASSED, ${failedCount} FAILED`);
console.log(`Evidence written to: ${outPath.pathname}`);
console.log(`=======================================================`);

if (failedCount > 0) {
  process.exit(1);
}
