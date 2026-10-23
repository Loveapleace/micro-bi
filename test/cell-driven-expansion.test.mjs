import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateCellTemplateDocument,
  expandCellDrivenTemplate,
  compileCellReport,
  normalizeCellTemplate,
  expandCellTemplate,
  buildInstanceKey,
  parseInstanceKey,
  encodeMemberValue,
  buildGroupContextKey,
} from '../dist/esm/report-template/index.js';

// ---------------------------------------------------------------------------
// 基础夹具数据集
// ---------------------------------------------------------------------------
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

// ===========================================================================
// CE-T01: 新建纯格驱动模板，不填写 layoutKind/metricDirection
// ===========================================================================
test('CE-T01: 新建纯格驱动模板，不填写 layoutKind/metricDirection', () => {
  const doc = {
    documentType: 'cell-template',
    schemaVersion: '2.0',
    capabilitiesVersion: 'cell-expansion-v2',
    id: 'tpl-ce-01',
    title: '纯格驱动明细',
    templateRevision: 1,
    sheets: [{ id: 'sheet-1', name: 'Sheet1' }],
    regions: [
      {
        id: 'r1',
        datasetId: 'ds-1',
        sheetId: 'sheet-1',
        anchor: { row: 0, column: 0 },
        // 无 layoutKind，无 metricDirection
      },
    ],
    cells: [
      {
        id: 'c-title',
        sheetId: 'sheet-1',
        regionId: 'r1',
        position: { row: 0, column: 0 },
        content: { kind: 'literal', value: '订单列表' },
      },
      {
        id: 'c-order',
        sheetId: 'sheet-1',
        regionId: 'r1',
        position: { row: 1, column: 0 },
        content: { kind: 'field', fieldKey: 'order_id', operation: 'list', expand: 'down' },
      },
      {
        id: 'c-qty',
        sheetId: 'sheet-1',
        regionId: 'r1',
        position: { row: 1, column: 1 },
        parents: { row: 'c-order' },
        content: { kind: 'field', fieldKey: 'delivered', operation: 'list', expand: 'down' },
      },
    ],
    layoutRules: [],
  };

  const validation = validateCellTemplateDocument(doc);
  assert.equal(validation.valid, true, '校验必须通过');

  const result = compileCellReport(doc, MOCK_PRODUCTION_DATA);
  assert.equal(result.valid, true);
  assert.equal(result.publication.sheets.length, 1);
  const sheet = result.publication.sheets[0];
  assert.ok(sheet.cells.length >= 8); // 标题 + 4条订单号 + 4条交付量

  // 验证原模板未被注入默认的 layoutKind 或 metricDirection
  assert.equal(doc.regions[0].layoutKind, undefined);
  assert.equal(doc.regions[0].metricDirection, undefined);
});

// ===========================================================================
// CE-T02: 同一记录块绑定订单号、日期、数量三个 list 格
// ===========================================================================
test('CE-T02: 同一记录块绑定订单号、日期、数量三个 list 格，主键对齐无笛卡尔积', () => {
  const doc = {
    schemaVersion: '2.0',
    capabilitiesVersion: 'cell-expansion-v2',
    id: 'tpl-ce-02',
    title: '列表对齐测试',
    sheets: [{ id: 'sheet-1', name: 'Sheet1' }],
    regions: [{ id: 'r1', datasetId: 'ds-1', sheetId: 'sheet-1' }],
    cells: [
      {
        id: 'c-order',
        sheetId: 'sheet-1',
        regionId: 'r1',
        position: { row: 1, column: 0 },
        content: { kind: 'field', fieldKey: 'order_id', operation: 'list', expand: 'down' },
      },
      {
        id: 'c-date',
        sheetId: 'sheet-1',
        regionId: 'r1',
        position: { row: 1, column: 1 },
        parents: { row: 'c-order' },
        content: { kind: 'field', fieldKey: 'plan_date', operation: 'list', expand: 'down' },
      },
      {
        id: 'c-qty',
        sheetId: 'sheet-1',
        regionId: 'r1',
        position: { row: 1, column: 2 },
        parents: { row: 'c-order' },
        content: { kind: 'field', fieldKey: 'delivered', operation: 'list', expand: 'down' },
      },
    ],
    layoutRules: [],
  };

  const { grid } = expandCellDrivenTemplate(doc, MOCK_PRODUCTION_DATA);

  // 4 条数据，应展开为恰好 4 行数据，列 0、1、2 相互对齐
  const orderCells = grid.cells.filter((c) => c.col === 0);
  const dateCells = grid.cells.filter((c) => c.col === 1);
  const qtyCells = grid.cells.filter((c) => c.col === 2);

  assert.equal(orderCells.length, 4, '订单号生成 4 行');
  assert.equal(dateCells.length, 4, '日期生成 4 行');
  assert.equal(qtyCells.length, 4, '交付量生成 4 行');

  for (let i = 0; i < 4; i++) {
    const expected = MOCK_PRODUCTION_DATA[i];
    const oc = orderCells.find((c) => c.row === 1 + i);
    const dc = dateCells.find((c) => c.row === 1 + i);
    const qc = qtyCells.find((c) => c.row === 1 + i);
    assert.equal(oc.value, expected.order_id);
    assert.equal(dc.value, expected.plan_date);
    assert.equal(qc.value, expected.delivered);
  }
});

// ===========================================================================
// CE-T03: 工厂→车间→明细嵌套，子记录数量不同
// ===========================================================================
test('CE-T03: 工厂→车间→明细嵌套，多级父格自适应高度展开，不互相覆盖', () => {
  const doc = {
    schemaVersion: '2.0',
    capabilitiesVersion: 'cell-expansion-v2',
    id: 'tpl-ce-03',
    title: '嵌套分组测试',
    sheets: [{ id: 'sheet-1', name: 'Sheet1' }],
    regions: [{ id: 'r1', datasetId: 'ds-1', sheetId: 'sheet-1' }],
    cells: [
      {
        id: 'c-factory',
        sheetId: 'sheet-1',
        regionId: 'r1',
        position: { row: 0, column: 0 },
        content: { kind: 'field', fieldKey: 'factory', operation: 'group', expand: 'down' },
      },
      {
        id: 'c-workshop',
        sheetId: 'sheet-1',
        regionId: 'r1',
        position: { row: 0, column: 1 },
        parents: { row: 'c-factory' },
        content: { kind: 'field', fieldKey: 'workshop', operation: 'group', expand: 'down' },
      },
      {
        id: 'c-order',
        sheetId: 'sheet-1',
        regionId: 'r1',
        position: { row: 0, column: 2 },
        parents: { row: 'c-workshop' },
        content: { kind: 'field', fieldKey: 'order_id', operation: 'list', expand: 'down' },
      },
      {
        id: 'c-qty',
        sheetId: 'sheet-1',
        regionId: 'r1',
        position: { row: 0, column: 3 },
        parents: { row: 'c-order' },
        content: { kind: 'field', fieldKey: 'qty', operation: 'list', expand: 'down' },
      },
    ],
    layoutRules: [],
  };

  const { grid, footprints } = expandCellDrivenTemplate(doc, MOCK_NESTED_DATA);

  // F1 下有 W1 (1条) + W2 (2条) = 3条；F2 下有 W3 (3条) = 3条；总共 6 条明细
  const qtyCells = grid.cells.filter((c) => c.col === 3);
  assert.equal(qtyCells.length, 6, '共 6 行明细');

  // 检查工厂 Footprint
  const f1Footprint = footprints.get('c-factory::s:F1');
  const f2Footprint = footprints.get('c-factory::s:F2');

  assert.ok(f1Footprint);
  assert.equal(f1Footprint.startRow, 0);
  assert.equal(f1Footprint.endRow, 2); // 占 3 行 (0, 1, 2)

  assert.ok(f2Footprint);
  assert.equal(f2Footprint.startRow, 3);
  assert.equal(f2Footprint.endRow, 5); // 占 3 行 (3, 4, 5)
});

// ===========================================================================
// CE-T04: 车间向下、日期向右，三个聚合/公式格配置双父
// ===========================================================================
test('CE-T04: 车间向下、日期向右，三个指标配置双父，正交切片计算精准', () => {
  const doc = {
    schemaVersion: '2.0',
    capabilitiesVersion: 'cell-expansion-v2',
    id: 'tpl-ce-04',
    title: '正交双父交叉测试',
    sheets: [{ id: 'sheet-1', name: 'Sheet1' }],
    regions: [{ id: 'r1', datasetId: 'ds-1', sheetId: 'sheet-1' }],
    cells: [
      {
        id: 'c-workshop',
        sheetId: 'sheet-1',
        regionId: 'r1',
        position: { row: 2, column: 0 },
        content: { kind: 'field', fieldKey: 'workshop', operation: 'group', expand: 'down' },
      },
      {
        id: 'c-date',
        sheetId: 'sheet-1',
        regionId: 'r1',
        position: { row: 1, column: 1 },
        content: { kind: 'field', fieldKey: 'plan_date', operation: 'group', expand: 'right' },
      },
      {
        id: 'c-delivered',
        sheetId: 'sheet-1',
        regionId: 'r1',
        position: { row: 2, column: 1 },
        parents: { row: 'c-workshop', column: 'c-date' },
        content: { kind: 'field', fieldKey: 'delivered', operation: 'sum' },
      },
      {
        id: 'c-defects',
        sheetId: 'sheet-1',
        regionId: 'r1',
        position: { row: 3, column: 1 },
        parents: { row: 'c-workshop', column: 'c-date' },
        content: { kind: 'field', fieldKey: 'defects', operation: 'sum' },
      },
      {
        id: 'c-defect-rate',
        sheetId: 'sheet-1',
        regionId: 'r1',
        position: { row: 4, column: 1 },
        parents: { row: 'c-workshop', column: 'c-date' },
        content: { kind: 'business-formula', metricId: 'defect_rate', expression: '[defects] / [delivered]', precision: 4 },
      },
    ],
    layoutRules: [],
  };

  const { grid } = expandCellDrivenTemplate(doc, MOCK_PRODUCTION_DATA);

  // 车间有 W1, W2；日期有 10-01, 10-02
  // 车间原型高度：行 2, 3, 4 跨 3 行。W1 占行 2,3,4；W2 占行 5,6,7
  // 日期原型宽度：列 1 跨 1 列。10-01 占列 1；10-02 占列 2

  // W1 (row 2..4), 10-01 (col 1): delivered = 100, defects = 2, rate = 0.02
  const w1_d1_delivered = grid.cells.find((c) => c.row === 2 && c.col === 1);
  const w1_d1_defects = grid.cells.find((c) => c.row === 3 && c.col === 1);
  const w1_d1_rate = grid.cells.find((c) => c.row === 4 && c.col === 1);

  assert.equal(w1_d1_delivered.value, 100);
  assert.equal(w1_d1_defects.value, 2);
  assert.equal(w1_d1_rate.value, 0.02);

  // W2 (row 5..7), 10-02 (col 2): delivered = 250, defects = 4, rate = 4/250 = 0.016
  const w2_d2_delivered = grid.cells.find((c) => c.row === 5 && c.col === 2);
  const w2_d2_defects = grid.cells.find((c) => c.row === 6 && c.col === 2);
  const w2_d2_rate = grid.cells.find((c) => c.row === 7 && c.col === 2);

  assert.equal(w2_d2_delivered.value, 250);
  assert.equal(w2_d2_defects.value, 4);
  assert.equal(w2_d2_rate.value, 0.016);
});

// ===========================================================================
// CE-T05: 将三个指标从三行移动到三列，保存再移回
// ===========================================================================
test('CE-T05: 将三个指标从三行移动到三列，保存再移回，相对位置自然决定几何', () => {
  // 横排三列模板：指标分别位于 (row 2, col 1), (row 2, col 2), (row 2, col 3)
  const docCols = {
    schemaVersion: '2.0',
    capabilitiesVersion: 'cell-expansion-v2',
    id: 'tpl-ce-05-cols',
    title: '指标横排三列',
    sheets: [{ id: 'sheet-1', name: 'Sheet1' }],
    regions: [{ id: 'r1', datasetId: 'ds-1', sheetId: 'sheet-1' }],
    cells: [
      {
        id: 'c-workshop',
        sheetId: 'sheet-1',
        regionId: 'r1',
        position: { row: 2, column: 0 },
        content: { kind: 'field', fieldKey: 'workshop', operation: 'group', expand: 'down' },
      },
      {
        id: 'c-date',
        sheetId: 'sheet-1',
        regionId: 'r1',
        position: { row: 1, column: 1 },
        content: { kind: 'field', fieldKey: 'plan_date', operation: 'group', expand: 'right' },
      },
      {
        id: 'c-delivered',
        sheetId: 'sheet-1',
        regionId: 'r1',
        position: { row: 2, column: 1 },
        parents: { row: 'c-workshop', column: 'c-date' },
        content: { kind: 'field', fieldKey: 'delivered', operation: 'sum' },
      },
      {
        id: 'c-defects',
        sheetId: 'sheet-1',
        regionId: 'r1',
        position: { row: 2, column: 2 },
        parents: { row: 'c-workshop', column: 'c-date' },
        content: { kind: 'field', fieldKey: 'defects', operation: 'sum' },
      },
      {
        id: 'c-defect-rate',
        sheetId: 'sheet-1',
        regionId: 'r1',
        position: { row: 2, column: 3 },
        parents: { row: 'c-workshop', column: 'c-date' },
        content: { kind: 'business-formula', metricId: 'defect_rate', expression: '[defects] / [delivered]' },
      },
    ],
    layoutRules: [],
  };

  const { grid } = expandCellDrivenTemplate(docCols, MOCK_PRODUCTION_DATA);

  // 车间 W1 高度为 1 行（row 2）；W2 高度为 1 行（row 3）
  // 日期 10-01 宽度为 3 列（col 1, 2, 3）；日期 10-02 宽度为 3 列（col 4, 5, 6）
  const w1_cell = grid.cells.find((c) => c.row === 2 && c.col === 0);
  const w2_cell = grid.cells.find((c) => c.row === 3 && c.col === 0);
  assert.equal(w1_cell.value, 'W1');
  assert.equal(w2_cell.value, 'W2');

  // 10-01 的交付在 (2, 1)，缺陷在 (2, 2)，缺陷率在 (2, 3)
  assert.equal(grid.cells.find((c) => c.row === 2 && c.col === 1)?.value, 100);
  assert.equal(grid.cells.find((c) => c.row === 2 && c.col === 2)?.value, 2);
  assert.equal(grid.cells.find((c) => c.row === 2 && c.col === 3)?.value, 0.02);

  // 10-02 的交付在 (2, 4)，缺陷在 (2, 5)，缺陷率在 (2, 6)
  assert.equal(grid.cells.find((c) => c.row === 2 && c.col === 4)?.value, 150);
  assert.equal(grid.cells.find((c) => c.row === 2 && c.col === 5)?.value, 3);
  assert.equal(grid.cells.find((c) => c.row === 2 && c.col === 6)?.value, 0.02);
});

// ===========================================================================
// CE-T06: 同页放横排摘要、纵排明细及日期交叉块
// ===========================================================================
test('CE-T06: 同页放横排汇总、纵排明细及日期交叉块，三者和平共存无干扰', () => {
  const doc = {
    schemaVersion: '2.0',
    capabilitiesVersion: 'cell-expansion-v2',
    id: 'tpl-ce-06-hybrid',
    title: '同页混合布局',
    sheets: [{ id: 'sheet-1', name: 'Sheet1' }],
    regions: [{ id: 'r1', datasetId: 'ds-1', sheetId: 'sheet-1' }],
    cells: [
      // 块 1：横排摘要卡片 (row 0)
      {
        id: 'c-card1-lbl',
        sheetId: 'sheet-1',
        regionId: 'r1',
        position: { row: 0, column: 0 },
        content: { kind: 'literal', value: '总交付量:' },
      },
      {
        id: 'c-card1-val',
        sheetId: 'sheet-1',
        regionId: 'r1',
        position: { row: 0, column: 1 },
        content: { kind: 'field', fieldKey: 'delivered', operation: 'sum' },
      },
      // 块 2：纵向车间汇总 (row 3..4)
      {
        id: 'c-ws-lbl',
        sheetId: 'sheet-1',
        regionId: 'r1',
        position: { row: 2, column: 0 },
        content: { kind: 'literal', value: '车间统计' },
      },
      {
        id: 'c-ws-name',
        sheetId: 'sheet-1',
        regionId: 'r1',
        position: { row: 3, column: 0 },
        content: { kind: 'field', fieldKey: 'workshop', operation: 'group', expand: 'down' },
      },
      {
        id: 'c-ws-sum',
        sheetId: 'sheet-1',
        regionId: 'r1',
        position: { row: 3, column: 1 },
        parents: { row: 'c-ws-name' },
        content: { kind: 'field', fieldKey: 'delivered', operation: 'sum' },
      },
    ],
    layoutRules: [],
  };

  const { grid } = expandCellDrivenTemplate(doc, MOCK_PRODUCTION_DATA);

  // 验证总交付量 = 100 + 150 + 200 + 250 = 700
  const totalVal = grid.cells.find((c) => c.row === 0 && c.col === 1);
  assert.equal(totalVal.value, 700);

  // 验证车间分组统计：W1 = 250, W2 = 450
  const w1_row = grid.cells.find((c) => c.row === 3 && c.col === 0);
  const w1_sum = grid.cells.find((c) => c.row === 3 && c.col === 1);
  assert.equal(w1_row.value, 'W1');
  assert.equal(w1_sum.value, 250);

  const w2_row = grid.cells.find((c) => c.row === 4 && c.col === 0);
  const w2_sum = grid.cells.find((c) => c.row === 4 && c.col === 1);
  assert.equal(w2_row.value, 'W2');
  assert.equal(w2_sum.value, 450);
});

// ===========================================================================
// CE-T07: 改列表为分组，或改 SUM 为 AVG，仅改单格配置
// ===========================================================================
test('CE-T07: 改列表为分组或改 SUM 为 AVG，统计行为随单格定义实时变化', () => {
  const doc = {
    schemaVersion: '2.0',
    capabilitiesVersion: 'cell-expansion-v2',
    id: 'tpl-ce-07',
    title: '单格聚合修改测试',
    sheets: [{ id: 'sheet-1', name: 'Sheet1' }],
    regions: [{ id: 'r1', datasetId: 'ds-1', sheetId: 'sheet-1' }],
    cells: [
      {
        id: 'c-ws',
        sheetId: 'sheet-1',
        regionId: 'r1',
        position: { row: 0, column: 0 },
        content: { kind: 'field', fieldKey: 'workshop', operation: 'group', expand: 'down' },
      },
      {
        id: 'c-metric',
        sheetId: 'sheet-1',
        regionId: 'r1',
        position: { row: 0, column: 1 },
        parents: { row: 'c-ws' },
        content: { kind: 'field', fieldKey: 'delivered', operation: 'avg' },
      },
    ],
    layoutRules: [],
  };

  const { grid } = expandCellDrivenTemplate(doc, MOCK_PRODUCTION_DATA);

  // W1 的 delivered 均值: (100 + 150) / 2 = 125
  // W2 的 delivered 均值: (200 + 250) / 2 = 225
  const w1_avg = grid.cells.find((c) => c.row === 0 && c.col === 1);
  const w2_avg = grid.cells.find((c) => c.row === 1 && c.col === 1);

  assert.equal(w1_avg.value, 125);
  assert.equal(w2_avg.value, 225);
});

// ===========================================================================
// CE-T08: 保持几何位置不变，更换父格上下文
// ===========================================================================
test('CE-T08: 保持几何位置不变，更换父格上下文，切片范围准确转移', () => {
  // 模板：A0 为工厂分组，B0 为车间分组，C0 为度量。
  // 若度量 parents.row 指向 B0 (车间)，则按车间切片；若改为指向 A0 (工厂)，则按工厂汇总
  const docFactoryScope = {
    schemaVersion: '2.0',
    capabilitiesVersion: 'cell-expansion-v2',
    id: 'tpl-ce-08',
    title: '父格切片切换',
    sheets: [{ id: 'sheet-1', name: 'Sheet1' }],
    regions: [{ id: 'r1', datasetId: 'ds-1', sheetId: 'sheet-1' }],
    cells: [
      {
        id: 'c-factory',
        sheetId: 'sheet-1',
        regionId: 'r1',
        position: { row: 0, column: 0 },
        content: { kind: 'field', fieldKey: 'factory', operation: 'group', expand: 'down' },
      },
      {
        id: 'c-workshop',
        sheetId: 'sheet-1',
        regionId: 'r1',
        position: { row: 0, column: 1 },
        parents: { row: 'c-factory' },
        content: { kind: 'field', fieldKey: 'workshop', operation: 'group', expand: 'down' },
      },
      {
        id: 'c-metric',
        sheetId: 'sheet-1',
        regionId: 'r1',
        position: { row: 0, column: 2 },
        // 直接跟随根工厂！
        parents: { row: 'c-factory' },
        content: { kind: 'field', fieldKey: 'qty', operation: 'sum' },
      },
    ],
    layoutRules: [],
  };

  const { grid } = expandCellDrivenTemplate(docFactoryScope, MOCK_NESTED_DATA);

  // F1 的总 qty: 10 + 20 + 25 = 55 (行 0)
  // F2 的总 qty: 30 + 35 + 40 = 105 (行 2)
  const f1_metric = grid.cells.find((c) => c.row === 0 && c.col === 2);
  const f2_metric = grid.cells.find((c) => c.row === 2 && c.col === 2);

  assert.equal(f1_metric.value, 55);
  assert.equal(f2_metric.value, 105);
});

// ===========================================================================
// CE-T09: 移动模板格但不改父格
// ===========================================================================
test('CE-T09: 移动模板格物理列位置，父格与数据切片逻辑完全保持', () => {
  const doc = {
    schemaVersion: '2.0',
    capabilitiesVersion: 'cell-expansion-v2',
    id: 'tpl-ce-09',
    title: '移动位置测试',
    sheets: [{ id: 'sheet-1', name: 'Sheet1' }],
    regions: [{ id: 'r1', datasetId: 'ds-1', sheetId: 'sheet-1' }],
    cells: [
      {
        id: 'c-ws',
        sheetId: 'sheet-1',
        regionId: 'r1',
        position: { row: 0, column: 0 },
        content: { kind: 'field', fieldKey: 'workshop', operation: 'group', expand: 'down' },
      },
      {
        id: 'c-metric-moved',
        sheetId: 'sheet-1',
        regionId: 'r1',
        // 移至第 5 列 (col: 5)
        position: { row: 0, column: 5 },
        parents: { row: 'c-ws' },
        content: { kind: 'field', fieldKey: 'delivered', operation: 'sum' },
      },
    ],
    layoutRules: [],
  };

  const { grid } = expandCellDrivenTemplate(doc, MOCK_PRODUCTION_DATA);

  // 单元格应渲染在 col: 5，值依然正确
  const w1_moved = grid.cells.find((c) => c.row === 0 && c.col === 5);
  const w2_moved = grid.cells.find((c) => c.row === 1 && c.col === 5);

  assert.equal(w1_moved.value, 250);
  assert.equal(w2_moved.value, 450);
});

// ===========================================================================
// CE-T10: 多个子块同时变高/变宽
// ===========================================================================
test('CE-T10: 多个子块不同高度自适应扩展，车道对齐无漂移', () => {
  const doc = {
    schemaVersion: '2.0',
    capabilitiesVersion: 'cell-expansion-v2',
    id: 'tpl-ce-10',
    title: '车道对齐测试',
    sheets: [{ id: 'sheet-1', name: 'Sheet1' }],
    regions: [{ id: 'r1', datasetId: 'ds-1', sheetId: 'sheet-1' }],
    cells: [
      {
        id: 'c-factory',
        sheetId: 'sheet-1',
        regionId: 'r1',
        position: { row: 0, column: 0 },
        content: { kind: 'field', fieldKey: 'factory', operation: 'group', expand: 'down' },
      },
      {
        id: 'c-ws',
        sheetId: 'sheet-1',
        regionId: 'r1',
        position: { row: 0, column: 1 },
        parents: { row: 'c-factory' },
        content: { kind: 'field', fieldKey: 'workshop', operation: 'group', expand: 'down' },
      },
    ],
    layoutRules: [],
  };

  const { grid, footprints } = expandCellDrivenTemplate(doc, MOCK_NESTED_DATA);

  // F1 下有两个车间 W1, W2，故 F1 占 2 行
  // F2 下有一个车间 W3，故 F2 占 1 行
  const f1_fp = footprints.get('c-factory::s:F1');
  const f2_fp = footprints.get('c-factory::s:F2');

  assert.equal(f1_fp.endRow - f1_fp.startRow + 1, 2);
  assert.equal(f2_fp.endRow - f2_fp.startRow + 1, 1);
});

// ===========================================================================
// CE-T11: 组内小计、块后总计、固定标题和旁边摘要
// ===========================================================================
test('CE-T11: 固定标题、旁边独立摘要与全量汇总，计算范围严密清晰', () => {
  const doc = {
    schemaVersion: '2.0',
    capabilitiesVersion: 'cell-expansion-v2',
    id: 'tpl-ce-11',
    title: '固定与汇总测试',
    sheets: [{ id: 'sheet-1', name: 'Sheet1' }],
    regions: [{ id: 'r1', datasetId: 'ds-1', sheetId: 'sheet-1' }],
    cells: [
      // 固定标题
      {
        id: 'c-title',
        sheetId: 'sheet-1',
        position: { row: 0, column: 0 },
        content: { kind: 'literal', value: '集团产线月报' },
      },
      // 旁边独立摘要
      {
        id: 'c-summary-lbl',
        sheetId: 'sheet-1',
        position: { row: 0, column: 4 },
        content: { kind: 'literal', value: '缺陷总数:' },
      },
      {
        id: 'c-summary-val',
        sheetId: 'sheet-1',
        regionId: 'r1',
        position: { row: 0, column: 5 },
        content: { kind: 'field', fieldKey: 'defects', operation: 'sum' },
      },
    ],
    layoutRules: [],
  };

  const { grid } = expandCellDrivenTemplate(doc, MOCK_PRODUCTION_DATA);

  const titleCell = grid.cells.find((c) => c.row === 0 && c.col === 0);
  assert.equal(titleCell.value, '集团产线月报');

  const defectSum = grid.cells.find((c) => c.row === 0 && c.col === 5);
  // 2 + 3 + 5 + 4 = 14
  assert.equal(defectSum.value, 14);
});

// ===========================================================================
// CE-T12: 数据增删、乱序、分组排序、列成员增删
// ===========================================================================
test('CE-T12: 数据乱序输入，引擎生成稳定确定的身份和有序结果', () => {
  // 乱序数据
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
      {
        id: 'c-ws',
        sheetId: 'sheet-1',
        regionId: 'r1',
        position: { row: 0, column: 0 },
        content: { kind: 'field', fieldKey: 'workshop', operation: 'group', expand: 'down' },
      },
      {
        id: 'c-sum',
        sheetId: 'sheet-1',
        regionId: 'r1',
        position: { row: 0, column: 1 },
        parents: { row: 'c-ws' },
        content: { kind: 'field', fieldKey: 'delivered', operation: 'sum' },
      },
    ],
    layoutRules: [],
  };

  const res1 = expandCellDrivenTemplate(doc, shuffledData);
  const res2 = expandCellDrivenTemplate(doc, [...shuffledData].reverse());

  // 两次生成的单元格数量、内容和坐标应当完全一致
  assert.equal(res1.grid.cells.length, res2.grid.cells.length);
  for (const c1 of res1.grid.cells) {
    const c2 = res2.grid.cells.find((c) => c.row === c1.row && c.col === c1.col);
    assert.ok(c2);
    assert.equal(c1.value, c2.value);
  }
});

// ===========================================================================
// CE-T13: 清空数据再恢复，保留/隐藏空块两种配置
// ===========================================================================
test('CE-T13: 数据清空再恢复，静态模板、样式与合并策略完好无损', () => {
  const doc = {
    schemaVersion: '2.0',
    capabilitiesVersion: 'cell-expansion-v2',
    id: 'tpl-ce-13',
    title: '空数据恢复测试',
    sheets: [{ id: 'sheet-1', name: 'Sheet1' }],
    regions: [{ id: 'r1', datasetId: 'ds-1', sheetId: 'sheet-1' }],
    cells: [
      {
        id: 'c-title',
        sheetId: 'sheet-1',
        position: { row: 0, column: 0 },
        content: { kind: 'literal', value: '固定报表头' },
      },
      {
        id: 'c-ws',
        sheetId: 'sheet-1',
        regionId: 'r1',
        position: { row: 1, column: 0 },
        content: { kind: 'field', fieldKey: 'workshop', operation: 'group', expand: 'down' },
      },
    ],
    layoutRules: [
      { sheetId: 'sheet-1', kind: 'merge', range: { startRow: 0, endRow: 0, startColumn: 0, endColumn: 3 } },
    ],
  };

  // 1. 空数据集展开
  const emptyRes = expandCellDrivenTemplate(doc, []);
  assert.equal(emptyRes.recordCount, 0);
  const titleCell = emptyRes.grid.cells.find((c) => c.row === 0 && c.col === 0);
  assert.equal(titleCell.value, '固定报表头');
  assert.equal(emptyRes.grid.merges.length, 1);

  // 2. 恢复数据集展开
  const fullRes = expandCellDrivenTemplate(doc, MOCK_PRODUCTION_DATA);
  assert.equal(fullRes.recordCount, 4);
  assert.ok(fullRes.grid.cells.some((c) => c.value === 'W1'));
});

// ===========================================================================
// CE-T14: 分组覆盖与横纵同值，局部横纵重排后往返
// ===========================================================================
test('CE-T14: 分组覆盖动态合并基于真实 Footprint 驱动', () => {
  // 模板：车间竖向展开，指标分 2 行（行 1: 交付量，行 2: 缺陷数）
  const doc = {
    schemaVersion: '2.0',
    capabilitiesVersion: 'cell-expansion-v2',
    id: 'tpl-ce-14',
    title: '动态合并 Footprint 测试',
    sheets: [{ id: 'sheet-1', name: 'Sheet1' }],
    regions: [{ id: 'r1', datasetId: 'ds-1', sheetId: 'sheet-1' }],
    cells: [
      {
        id: 'c-ws',
        sheetId: 'sheet-1',
        regionId: 'r1',
        position: { row: 1, column: 0 },
        content: { kind: 'field', fieldKey: 'workshop', operation: 'group', expand: 'down' },
      },
      {
        id: 'c-deliv',
        sheetId: 'sheet-1',
        regionId: 'r1',
        position: { row: 1, column: 1 },
        parents: { row: 'c-ws' },
        content: { kind: 'field', fieldKey: 'delivered', operation: 'sum' },
      },
      {
        id: 'c-defect',
        sheetId: 'sheet-1',
        regionId: 'r1',
        position: { row: 2, column: 1 },
        parents: { row: 'c-ws' },
        content: { kind: 'field', fieldKey: 'defects', operation: 'sum' },
      },
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

  // W1 包含行 1 和行 2（共 2 行）；W2 包含行 3 和行 4（共 2 行）
  const ws1Merge = grid.merges.find((m) => m.startRow === 1 && m.startCol === 0);
  const ws2Merge = grid.merges.find((m) => m.startRow === 3 && m.startCol === 0);

  assert.ok(ws1Merge, 'W1 合并范围应存在');
  assert.equal(ws1Merge.endRow, 2);
  assert.equal(ws1Merge.endCol, 0);

  assert.ok(ws2Merge, 'W2 合并范围应存在');
  assert.equal(ws2Merge.endRow, 4);
  assert.equal(ws2Merge.endCol, 0);
});

// ===========================================================================
// CE-T15: 新增指标、插入明细、移走被取消成员再恢复
// ===========================================================================
test('CE-T15: 成员级取消例外 (Suppression) 精准匹配语义上下文', () => {
  const doc = {
    schemaVersion: '2.0',
    capabilitiesVersion: 'cell-expansion-v2',
    id: 'tpl-ce-15',
    title: '取消例外语义锁定',
    sheets: [{ id: 'sheet-1', name: 'Sheet1' }],
    regions: [{ id: 'r1', datasetId: 'ds-1', sheetId: 'sheet-1' }],
    cells: [
      {
        id: 'c-ws',
        sheetId: 'sheet-1',
        regionId: 'r1',
        position: { row: 1, column: 0 },
        content: { kind: 'field', fieldKey: 'workshop', operation: 'group', expand: 'down' },
      },
      {
        id: 'c-deliv',
        sheetId: 'sheet-1',
        regionId: 'r1',
        position: { row: 1, column: 1 },
        parents: { row: 'c-ws' },
        content: { kind: 'field', fieldKey: 'delivered', operation: 'sum' },
      },
      {
        id: 'c-defect',
        sheetId: 'sheet-1',
        regionId: 'r1',
        position: { row: 2, column: 1 },
        parents: { row: 'c-ws' },
        content: { kind: 'field', fieldKey: 'defects', operation: 'sum' },
      },
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
      // 显式排除 W1
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

  // W1 (行 1..2) 被取消合并；W2 (行 3..4) 依然保持合并
  const w1Merge = grid.merges.find((m) => m.startRow === 1 && m.startCol === 0);
  const w2Merge = grid.merges.find((m) => m.startRow === 3 && m.startCol === 0);

  assert.equal(w1Merge, undefined, 'W1 合并必须被排除');
  assert.ok(w2Merge, 'W2 合并必须保留');
});

// ===========================================================================
// CE-T16: 父格环、公式环、跟随定位环、跨关系混合环
// ===========================================================================
test('CE-T16: 检测并拦截父格依赖环路，不发生栈溢出或无限循环', () => {
  const docCyclic = {
    schemaVersion: '2.0',
    capabilitiesVersion: 'cell-expansion-v2',
    id: 'tpl-ce-16',
    title: '父格依赖环',
    sheets: [{ id: 'sheet-1', name: 'Sheet1' }],
    regions: [{ id: 'r1', datasetId: 'ds-1', sheetId: 'sheet-1' }],
    cells: [
      {
        id: 'c-a',
        sheetId: 'sheet-1',
        regionId: 'r1',
        position: { row: 0, column: 0 },
        parents: { row: 'c-b' }, // A 依赖 B
        content: { kind: 'field', fieldKey: 'workshop', operation: 'group', expand: 'down' },
      },
      {
        id: 'c-b',
        sheetId: 'sheet-1',
        regionId: 'r1',
        position: { row: 0, column: 1 },
        parents: { row: 'c-a' }, // B 依赖 A (环路!)
        content: { kind: 'field', fieldKey: 'plan_date', operation: 'group', expand: 'down' },
      },
    ],
    layoutRules: [],
  };

  const { diagnostics } = expandCellDrivenTemplate(docCyclic, MOCK_PRODUCTION_DATA);

  assert.ok(diagnostics.length > 0);
  assert.ok(diagnostics.some((d) => d.code === 'ERR_CYCLIC_PARENT_DEPENDENCY'));
});

// ===========================================================================
// CE-T17: 过滤条件在事实记录切片上正确生效
// ===========================================================================
test('CE-T17: 区域过滤条件在数据事实切片上严格生效', () => {
  const doc = {
    schemaVersion: '2.0',
    capabilitiesVersion: 'cell-expansion-v2',
    id: 'tpl-ce-17',
    title: '过滤条件生效测试',
    sheets: [{ id: 'sheet-1', name: 'Sheet1' }],
    regions: [
      {
        id: 'r1',
        datasetId: 'ds-1',
        sheetId: 'sheet-1',
        filters: [{ field: 'workshop', operator: 'eq', value: 'W1' }],
      },
    ],
    cells: [
      {
        id: 'c-ws',
        sheetId: 'sheet-1',
        regionId: 'r1',
        position: { row: 0, column: 0 },
        content: { kind: 'field', fieldKey: 'workshop', operation: 'group', expand: 'down' },
      },
    ],
    layoutRules: [],
  };

  const { grid, filteredCount } = expandCellDrivenTemplate(doc, MOCK_PRODUCTION_DATA);

  assert.equal(filteredCount, 2, '过滤后仅余 2 条 W1 记录');
  const wsCells = grid.cells.filter((c) => c.col === 0);
  assert.equal(wsCells.length, 1);
  assert.equal(wsCells[0].value, 'W1');
});

// ===========================================================================
// CE-T18: 业务公式引用多实例格和组/全量汇总
// ===========================================================================
test('CE-T18: 业务公式在正交切片上精准求值，支持除零保护', () => {
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
      {
        id: 'c-ws',
        sheetId: 'sheet-1',
        regionId: 'r1',
        position: { row: 0, column: 0 },
        content: { kind: 'field', fieldKey: 'workshop', operation: 'group', expand: 'down' },
      },
      {
        id: 'c-deliv',
        sheetId: 'sheet-1',
        regionId: 'r1',
        position: { row: 0, column: 1 },
        parents: { row: 'c-ws' },
        content: { kind: 'field', fieldKey: 'delivered', operation: 'sum' },
      },
      {
        id: 'c-defects',
        sheetId: 'sheet-1',
        regionId: 'r1',
        position: { row: 0, column: 2 },
        parents: { row: 'c-ws' },
        content: { kind: 'field', fieldKey: 'defects', operation: 'sum' },
      },
      {
        id: 'c-rate',
        sheetId: 'sheet-1',
        regionId: 'r1',
        position: { row: 0, column: 3 },
        parents: { row: 'c-ws' },
        content: { kind: 'business-formula', metricId: 'defect_rate', expression: '[defects] / [delivered]' },
      },
    ],
    layoutRules: [],
  };

  const { grid } = expandCellDrivenTemplate(doc, testData);

  // W1 (row 0): 0 / 100 = 0
  const w1_rate = grid.cells.find((c) => c.row === 0 && c.col === 3);
  assert.equal(w1_rate.value, 0);

  // W2 (row 1): 5 / 0 -> 除零保护，返回 null，不崩溃
  const w2_rate = grid.cells.find((c) => c.row === 1 && c.col === 3);
  assert.equal(w2_rate.value, null);
});

// ===========================================================================
// CE-T19: 旧 1.0/1.1 不同表型模板迁移、重复迁移、reader 降级
// ===========================================================================
test('CE-T19: 存量 1.0/1.1 模板由旧投影器正常解释，2.0 模板由新展开引擎驱动', () => {
  // 1.1 存量分组模板
  const legacyDoc = {
    documentType: 'cell-template',
    schemaVersion: '1.1',
    capabilitiesVersion: 'cell-v1',
    id: 'legacy-tpl',
    title: '旧版分组报表',
    sheets: [{ id: 'sheet-1', name: 'Sheet1' }],
    regions: [
      {
        id: 'r1',
        datasetId: 'ds-1',
        sheetId: 'sheet-1',
        layoutKind: 'grouped',
        metricDirection: 'columns',
        anchor: { row: 0, column: 0 },
      },
    ],
    cells: [
      {
        id: 'c1',
        sheetId: 'sheet-1',
        regionId: 'r1',
        position: { row: 0, column: 0 },
        content: { kind: 'field', fieldKey: 'workshop', role: 'row-dimension', operation: 'group' },
      },
      {
        id: 'c2',
        sheetId: 'sheet-1',
        regionId: 'r1',
        position: { row: 0, column: 1 },
        content: { kind: 'field', fieldKey: 'delivered', role: 'measure', operation: 'sum' },
      },
    ],
    layoutRules: [],
  };

  const legacyRes = compileCellReport(legacyDoc, MOCK_PRODUCTION_DATA);
  assert.equal(legacyRes.valid, true);
  assert.ok(legacyRes.publication.sheets[0].cells.length > 0);

  // 2.0 新格驱动模板
  const v2Doc = {
    documentType: 'cell-template',
    schemaVersion: '2.0',
    capabilitiesVersion: 'cell-expansion-v2',
    id: 'v2-tpl',
    title: '新版单元格驱动',
    sheets: [{ id: 'sheet-1', name: 'Sheet1' }],
    regions: [{ id: 'r1', datasetId: 'ds-1', sheetId: 'sheet-1' }],
    cells: [
      {
        id: 'c1',
        sheetId: 'sheet-1',
        regionId: 'r1',
        position: { row: 0, column: 0 },
        content: { kind: 'field', fieldKey: 'workshop', operation: 'group', expand: 'down' },
      },
    ],
    layoutRules: [],
  };

  const v2Res = compileCellReport(v2Doc, MOCK_PRODUCTION_DATA);
  assert.equal(v2Res.valid, true);
  assert.ok(v2Res.publication.sheets[0].cells.length > 0);
});

// ===========================================================================
// CE-T20: 真实主应用发布模型与 VTable 中性模型完全一致
// ===========================================================================
test('CE-T20: compileCellReport 输出标准 PublishedReport，包含正确样式、文本与合并', () => {
  const doc = {
    documentType: 'cell-template',
    schemaVersion: '2.0',
    capabilitiesVersion: 'cell-expansion-v2',
    id: 'tpl-ce-20',
    title: '发布契约验证',
    sheets: [{ id: 'sheet-1', name: 'Sheet1' }],
    regions: [{ id: 'r1', datasetId: 'ds-1', sheetId: 'sheet-1' }],
    cells: [
      {
        id: 'c-title',
        sheetId: 'sheet-1',
        position: { row: 0, column: 0 },
        content: { kind: 'literal', value: '订单总览' },
        style: { bold: true, fontSize: 16, color: '#1677ff' },
      },
      {
        id: 'c-order',
        sheetId: 'sheet-1',
        regionId: 'r1',
        position: { row: 1, column: 0 },
        content: { kind: 'field', fieldKey: 'order_id', operation: 'list', expand: 'down' },
      },
      {
        id: 'c-qty',
        sheetId: 'sheet-1',
        regionId: 'r1',
        position: { row: 1, column: 1 },
        parents: { row: 'c-order' },
        content: { kind: 'field', fieldKey: 'delivered', operation: 'list', format: 'integer' },
      },
    ],
    layoutRules: [
      { sheetId: 'sheet-1', kind: 'merge', range: { startRow: 0, endRow: 0, startColumn: 0, endColumn: 1 } },
    ],
  };

  const result = compileCellReport(doc, MOCK_PRODUCTION_DATA);
  assert.equal(result.valid, true);

  const pub = result.publication;
  assert.equal(pub.version, '1.0');
  assert.equal(pub.sheets.length, 1);

  const sheet = pub.sheets[0];
  assert.equal(sheet.merges.length, 1);
  assert.equal(sheet.merges[0].startRow, 0);
  assert.equal(sheet.merges[0].text, '订单总览');

  // 验证标题样式成功注册
  const titleCell = sheet.cells.find((c) => c.r === 0 && c.c === 0);
  assert.ok(titleCell.styleId);
  const styleObj = pub.styles[titleCell.styleId];
  assert.equal(styleObj.bold, true);
  assert.equal(styleObj.fontSize, 16);
});

// ===========================================================================
// CE-T21: 深冻结模板重复编译，StrictMode 重复计算，晚返回结果
// ===========================================================================
test('CE-T21: 深冻结输入重复编译，执行具备严格纯函数性与确定性', () => {
  const doc = {
    schemaVersion: '2.0',
    capabilitiesVersion: 'cell-expansion-v2',
    id: 'tpl-ce-21-freeze',
    title: '纯函数性',
    sheets: [{ id: 'sheet-1', name: 'Sheet1' }],
    regions: [{ id: 'r1', datasetId: 'ds-1', sheetId: 'sheet-1' }],
    cells: [
      {
        id: 'c-ws',
        sheetId: 'sheet-1',
        regionId: 'r1',
        position: { row: 0, column: 0 },
        content: { kind: 'field', fieldKey: 'workshop', operation: 'group', expand: 'down' },
      },
      {
        id: 'c-deliv',
        sheetId: 'sheet-1',
        regionId: 'r1',
        position: { row: 0, column: 1 },
        parents: { row: 'c-ws' },
        content: { kind: 'field', fieldKey: 'delivered', operation: 'sum' },
      },
    ],
    layoutRules: [],
  };

  // 深冻结
  Object.freeze(doc);
  Object.freeze(doc.regions);
  Object.freeze(doc.regions[0]);
  Object.freeze(doc.cells);
  Object.freeze(MOCK_PRODUCTION_DATA);

  // 连续编译两次
  const res1 = expandCellDrivenTemplate(doc, MOCK_PRODUCTION_DATA);
  const res2 = expandCellDrivenTemplate(doc, MOCK_PRODUCTION_DATA);

  assert.equal(res1.grid.cells.length, res2.grid.cells.length);
  assert.deepEqual(
    res1.grid.cells.map((c) => ({ r: c.row, c: c.col, v: c.value })),
    res2.grid.cells.map((c) => ({ r: c.row, c: c.col, v: c.value }))
  );
});

// ===========================================================================
// CE-T22: 测试大数据、两轴成员乘积和深层重复上限
// ===========================================================================
test('CE-T22: 大数据量与两轴乘积展开性能与稳定性验证', () => {
  // 生成 10 个车间 x 10 个日期 x 每组 5 条明细 = 500 条数据
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
      {
        id: 'c-ws',
        sheetId: 'sheet-1',
        regionId: 'r1',
        position: { row: 1, column: 0 },
        content: { kind: 'field', fieldKey: 'workshop', operation: 'group', expand: 'down' },
      },
      {
        id: 'c-date',
        sheetId: 'sheet-1',
        regionId: 'r1',
        position: { row: 0, column: 1 },
        content: { kind: 'field', fieldKey: 'plan_date', operation: 'group', expand: 'right' },
      },
      {
        id: 'c-sum',
        sheetId: 'sheet-1',
        regionId: 'r1',
        position: { row: 1, column: 1 },
        parents: { row: 'c-ws', column: 'c-date' },
        content: { kind: 'field', fieldKey: 'delivered', operation: 'sum' },
      },
    ],
    layoutRules: [],
  };

  const startTime = Date.now();
  const { grid, recordCount } = expandCellDrivenTemplate(doc, largeDataset);
  const elapsed = Date.now() - startTime;

  assert.equal(recordCount, 500);
  // 10 车间 x 10 日期 = 100 个交叉格 + 10 车间标签 + 10 日期标签 = 120 格
  assert.equal(grid.cells.length, 120);
  assert.ok(elapsed < 200, `展开 500 条数据耗时应 < 200ms，实测: ${elapsed}ms`);
});
