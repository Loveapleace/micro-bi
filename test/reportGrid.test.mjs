import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildBiGrid,
  normalizeAxes,
  projectGroupedReport,
  projectPivotReport,
} from '../dist/esm/report/index.js';

// Section 6.2 & 7.4 规定的固定 5 条数据验收样例：
// 车间 A: 产线 1 (10, 2), 产线 2 (20, 4), 产线 3 (30, 6)
// 车间 B: 产线 1 (100, 20), 产线 2 (40, 8)
const sampleData = [
  { workshop: '车间A', line: '产线1', date: '2026-10-01', qty: 10, defect: 2 },
  { workshop: '车间A', line: '产线2', date: '2026-10-02', qty: 20, defect: 4 },
  { workshop: '车间A', line: '产线3', date: '2026-10-03', qty: 30, defect: 6 },
  { workshop: '车间B', line: '产线1', date: '2026-11-01', qty: 100, defect: 20 },
  { workshop: '车间B', line: '产线2', date: '2026-11-02', qty: 40, defect: 8 },
];

test('reportGrid: 分组报表多级层级合并与固定数据验收 (总计200, COUNT 5, 加权AVG 40, 不良数40, 不良率20%)', () => {
  const config = {
    dimensions: {
      categories: ['workshop', 'line'],
      rowTotals: {
        showGrandTotals: true,
        showSubTotals: true,
        grandTotalLabel: '总计',
        subTotalLabel: '小计',
      },
    },
    columns: [
      { type: 'aggregated', field: 'qty', agg: 'sum', label: '总产量' },
      { type: 'aggregated', field: 'qty', agg: 'count', label: '记录数' },
      { type: 'aggregated', field: 'qty', agg: 'avg', label: '平均产量' },
      { type: 'aggregated', field: 'defect', agg: 'sum', label: '不良数' },
      {
        type: 'computed',
        name: 'defect_rate',
        label: '不良率',
        expression: '[SUM(defect)] / [SUM(qty)] * 100',
      },
    ],
  };

  const grid = buildBiGrid(config, sampleData);

  assert.equal(grid.type, 'grouped');
  assert.ok(grid.rowCount > 0);
  assert.equal(grid.colCount, 7); // 2个维度 + 5个指标

  // 1. 验证表头 (Row 0)
  const headerRow = grid.cells.filter((c) => c.row === 0);
  assert.equal(headerRow[0]?.value, 'workshop');
  assert.equal(headerRow[1]?.value, 'line');
  assert.equal(headerRow[2]?.value, '总产量');
  assert.equal(headerRow[3]?.value, '记录数');
  assert.equal(headerRow[4]?.value, '平均产量');
  assert.equal(headerRow[5]?.value, '不良数');
  assert.equal(headerRow[6]?.value, '不良率');

  // 2. 验证父级受保护合并：车间A包含产线1、2、3，应该合并前3行数据
  // 注意：合并绝不能跨到车间B！
  const parentMerges = grid.merges.filter((m) => m.startCol === 0 && m.endCol === 0);
  assert.ok(parentMerges.length >= 2, '车间A与车间B分别有受保护的合并区间');
  for (const m of parentMerges) {
    assert.ok(m.startRow <= m.endRow);
  }

  // 3. 验证全局总计行（最后一行）的精确计算结果：
  const grandTotalRowIndex = grid.rowCount - 1;
  const grandCells = grid.cells.filter((c) => c.row === grandTotalRowIndex);
  assert.equal(grandCells[0]?.value, '总计');

  const grandQtySum = grandCells.find((c) => c.col === 2)?.value;
  const grandCount = grandCells.find((c) => c.col === 3)?.value;
  const grandQtyAvg = grandCells.find((c) => c.col === 4)?.value;
  const grandDefectSum = grandCells.find((c) => c.col === 5)?.value;
  const grandDefectRate = grandCells.find((c) => c.col === 6)?.value;

  assert.equal(grandQtySum, 200, '总产量必须精确等于 200');
  assert.equal(grandCount, 5, '记录数必须精确等于 5');
  assert.equal(grandQtyAvg, 40, '加权平均值必须精确等于 40 (杜绝直接平均求得 45)');
  assert.equal(grandDefectSum, 40, '不良数必须精确等于 40');
  assert.equal(grandDefectRate, 20, '不良率必须精确等于 20%');

  // 4. 验证小计行：车间 A 小计平均值
  // 4. 验证小计行：车间 A 小计平均值
  // 车间 A: 10 + 20 + 30 = 60, count = 3, avg = 20
  const subtotalACells = grid.cells.filter((c) => c.role === 'subtotal' && c.rowPath?.[0]?.memberKey === '车间A');
  const subtotalAQty = subtotalACells.find((c) => c.metricId === 'SUM(qty)' || c.metricId === '总产量' || (c.field === 'qty' && c.agg === 'sum'))?.value;
  const subtotalAAvg = subtotalACells.find((c) => c.metricId === 'AVG(qty)' || c.metricId === '平均产量' || (c.field === 'qty' && c.agg === 'avg'))?.value;
  assert.equal(subtotalAQty, 60);
  assert.equal(subtotalAAvg, 20);

  // 5. 验证车间 B: 100 + 40 = 140, count = 2, avg = 70
  const subtotalBCells = grid.cells.filter((c) => c.role === 'subtotal' && c.rowPath?.[0]?.memberKey === '车间B');
  const subtotalBQty = subtotalBCells.find((c) => c.metricId === 'SUM(qty)' || c.metricId === '总产量' || (c.field === 'qty' && c.agg === 'sum'))?.value;
  const subtotalBAvg = subtotalBCells.find((c) => c.metricId === 'AVG(qty)' || c.metricId === '平均产量' || (c.field === 'qty' && c.agg === 'avg'))?.value;
  assert.equal(subtotalBQty, 140);
  assert.equal(subtotalBAvg, 70);
});

test('reportGrid: 双向交叉透视表 (指标横向 indicatorsAsCol: true) 验收', () => {
  const config = {
    dimensions: {
      categories: ['workshop'],
      columnTimeBucket: {
        field: 'date',
        granularity: 'month',
        format: 'YYYY-MM',
      },
      indicatorsAsCol: true,
      rowTotals: { showGrandTotals: true, grandTotalLabel: '总计' },
      columnTotals: { showGrandTotals: true, grandTotalLabel: '总计' },
    },
    columns: [
      { type: 'aggregated', field: 'qty', agg: 'sum', label: '产量' },
      { type: 'aggregated', field: 'qty', agg: 'avg', label: '平均产量' },
      {
        type: 'computed',
        name: 'defect_rate',
        label: '不良率',
        expression: '[SUM(defect)] / [SUM(qty)] * 100',
      },
    ],
  };

  const grid = buildBiGrid(config, sampleData);

  assert.equal(grid.type, 'pivot');
  assert.ok(grid.rowCount >= 4);

  // 2个时间列成员 (2026-10, 2026-11) + 1个右侧总计组 = 3组 * 3指标 = 9列，再加上1列行维度 = 10列
  assert.equal(grid.colCount, 10);

  // 验证右下角 (角落总计):
  // 角落总计的指标位于最后一行（底部总计行）的最后 3 列
  const lastRow = grid.rowCount - 1;
  const cornerQtySum = grid.cells.find((c) => c.row === lastRow && c.col === 7)?.value;
  const cornerAvg = grid.cells.find((c) => c.row === lastRow && c.col === 8)?.value;
  const cornerRate = grid.cells.find((c) => c.row === lastRow && c.col === 9)?.value;

  assert.equal(cornerQtySum, 200, '交叉透视全表总产量为 200');
  assert.equal(cornerAvg, 40, '交叉透视全表加权平均产量为 40 (杜绝二次平均)');
  assert.equal(cornerRate, 20, '交叉透视全表不良率为 20%');
});

test('reportGrid: 双向交叉透视表 (指标纵向 indicatorsAsCol: false) 验收', () => {
  const config = {
    dimensions: {
      categories: ['workshop'],
      columnTimeBucket: {
        field: 'date',
        granularity: 'month',
        format: 'YYYY-MM',
      },
      indicatorsAsCol: false,
      rowTotals: { showGrandTotals: true, grandTotalLabel: '总计' },
      columnTotals: { showGrandTotals: true, grandTotalLabel: '总计' },
    },
    columns: [
      { type: 'aggregated', field: 'qty', agg: 'sum', label: '产量' },
      { type: 'aggregated', field: 'qty', agg: 'avg', label: '平均产量' },
      {
        type: 'computed',
        name: 'defect_rate',
        label: '不良率',
        expression: '[SUM(defect)] / [SUM(qty)] * 100',
      },
    ],
  };

  const grid = buildBiGrid(config, sampleData);

  assert.equal(grid.type, 'pivot');
  // 列数：行维度(1) + 指标列(1) + 列成员(2) + 右侧总计(1) = 5 列
  assert.equal(grid.colCount, 5);

  // 底部总计占用 3 行（每个指标 1 行）
  const totalQtyRow = grid.rowCount - 3;
  const totalAvgRow = grid.rowCount - 2;
  const totalRateRow = grid.rowCount - 1;

  // 右侧总计在 col = 4
  const cornerQty = grid.cells.find((c) => c.row === totalQtyRow && c.col === 4)?.value;
  const cornerAvg = grid.cells.find((c) => c.row === totalAvgRow && c.col === 4)?.value;
  const cornerRate = grid.cells.find((c) => c.row === totalRateRow && c.col === 4)?.value;

  assert.equal(cornerQty, 200, '指标纵向全表产量总计为 200');
  assert.equal(cornerAvg, 40, '指标纵向全表平均产量为 40');
  assert.equal(cornerRate, 20, '指标纵向全表不良率为 20%');
});

test('reportGrid: 空数据保护与结构完整性', () => {
  const config = {
    dimensions: {
      categories: ['workshop'],
    },
    columns: [
      { type: 'aggregated', field: 'qty', agg: 'sum', label: '总产量' },
      { type: 'aggregated', field: 'qty', agg: 'count', label: '记录数' },
    ],
  };

  const grid = buildBiGrid(config, []);
  assert.ok(grid.rowCount >= 1);
  assert.equal(grid.colCount, 3);
});

test('MBI-06: 指标身份与显示名称分离，同名标题互不覆盖且重命名保持指标ID稳定', () => {
  const records = [
    { g: 'A', qty: 10, cost: 2 },
    { g: 'A', qty: 20, cost: 4 },
  ];
  const columns = [
    { type: 'aggregated', field: 'qty', agg: 'sum', label: 'same' },
    { type: 'aggregated', field: 'cost', agg: 'sum', label: 'same' },
  ];
  const grid = buildBiGrid({ dimensions: { categories: ['g'] }, columns }, records);
  
  // 第一行为表头，第二行为分组A的数据行
  const dataRow = grid.cells.filter((c) => c.row === 1);
  const qtyCell = dataRow.find((c) => c.col === 1);
  const costCell = dataRow.find((c) => c.col === 2);

  assert.equal(qtyCell?.value, 30, 'SUM(qty) 必须精确等于 30');
  assert.equal(costCell?.value, 6, 'SUM(cost) 必须精确等于 6，杜绝因同名 label 被覆盖为 6');
  assert.notEqual(qtyCell?.metricId, costCell?.metricId, '两列 metricId 必须完全独立');
});

test('MBI-07: 无维度但包含 fixed 列时进入明细模式，输出全量事实行而非被折叠为单行', () => {
  const records = [
    { qty: 10, name: 'Item 1' },
    { qty: 20, name: 'Item 2' },
  ];
  const columns = [
    { type: 'fixed', field: 'name', label: '品名' },
    { type: 'fixed', field: 'qty', label: '数量' },
  ];
  const grid = buildBiGrid({ columns }, records);

  // 1 行表头 + 2 行明细数据 = 3 行
  assert.equal(grid.rowCount, 3, '无维度但含 fixed 列时必须保留全部 2 条明细数据');
  const row1Name = grid.cells.find((c) => c.row === 1 && c.col === 0)?.value;
  const row1Qty = grid.cells.find((c) => c.row === 1 && c.col === 1)?.value;
  const row2Name = grid.cells.find((c) => c.row === 2 && c.col === 0)?.value;
  const row2Qty = grid.cells.find((c) => c.row === 2 && c.col === 1)?.value;

  assert.equal(row1Name, 'Item 1');
  assert.equal(row1Qty, 10);
  assert.equal(row2Name, 'Item 2');
  assert.equal(row2Qty, 20);
});

test('MBI-08: 行级计算列依赖链顺序传递 (twice=[qty]*2, four=[twice]*2)', () => {
  const records = [
    { qty: 10 },
    { qty: 20 },
  ];
  const columns = [
    { type: 'aggregated', field: 'qty', agg: 'sum', label: '原值' },
    { type: 'computed', name: 'twice', label: '两倍', expression: '[qty] * 2', scope: 'row' },
    { type: 'computed', name: 'four', label: '四倍', expression: '[twice] * 2', scope: 'row' },
  ];
  const grid = buildBiGrid({ columns }, records);

  // 全局汇总行或明细行
  // qty: 10 + 20 = 30
  // twice: 20 + 40 = 60
  // four: 40 + 80 = 120
  const grandCells = grid.cells.filter((c) => c.row === 1);
  const qtyVal = grandCells.find((c) => c.col === 0)?.value;
  const twiceVal = grandCells.find((c) => c.col === 1)?.value;
  const fourVal = grandCells.find((c) => c.col === 2)?.value;

  assert.equal(qtyVal, 30);
  assert.equal(twiceVal, 60, 'twice 累计必须为 60');
  assert.equal(fourVal, 120, 'four 累计必须为 120 (依赖传递生效，杜绝得到 0)');
});

test('MBI-13: 包含斜杠与冒号等分隔符时绝不发生维度路径碰撞合并', () => {
  const records = [
    { a: 'x/b:y', b: 'z', c: 'ok', q: 1 },
    { a: 'x', b: 'y/b:z', c: 'ok', q: 2 },
  ];
  const config = {
    dimensions: {
      categories: ['a', 'b'],
      columnCategories: ['c'],
      rowTotals: { showGrandTotals: false },
      columnTotals: { showGrandTotals: false },
    },
    columns: [
      { type: 'aggregated', field: 'q', agg: 'sum', label: '数量' },
    ],
  };

  const grid = buildBiGrid(config, records);
  // 应生成 2 个行成员，而不是因为字符串拼接碰撞导致合并为 1 个
  // row 0: col dimension headers
  // row 1: metric headers
  // row 2: Record 1
  // row 3: Record 2
  assert.ok(grid.rowCount >= 4, `必须生成至少 4 行（含2个不同的数据行），实际为 ${grid.rowCount}`);
  
  const dataCells = grid.cells.filter((c) => c.role === 'metric-value');
  const values = dataCells.map((c) => c.value).sort();
  assert.deepEqual(values, [1, 2], '两个成员的值必须分别为 1 与 2，杜绝被错误累加为 3');
});

test('MBI-14: 双向透视多级行轴与多级列轴在 showSubTotals 开关开启后生成层级小计节点与正确数值', () => {
  const records = [
    { workshop: '车间A', line: '产线1', yr: '2026', qtr: 'Q1', qty: 10 },
    { workshop: '车间A', line: '产线2', yr: '2026', qtr: 'Q2', qty: 20 },
    { workshop: '车间A', line: '产线3', yr: '2026', qtr: 'Q2', qty: 30 },
    { workshop: '车间B', line: '产线1', yr: '2026', qtr: 'Q1', qty: 100 },
    { workshop: '车间B', line: '产线2', yr: '2026', qtr: 'Q2', qty: 40 },
  ];

  // 1. 关闭小计 (showSubTotals: false)
  const configOff = {
    dimensions: {
      categories: ['workshop', 'line'],
      columnCategories: ['yr', 'qtr'],
      rowTotals: { showGrandTotals: true, showSubTotals: false },
      columnTotals: { showGrandTotals: true, showSubTotals: false },
    },
    columns: [{ type: 'aggregated', field: 'qty', agg: 'sum', label: '产量' }],
  };
  const gridOff = buildBiGrid(configOff, records);

  // 2. 开启行轴小计与列轴小计 (showSubTotals: true)
  const configOn = {
    dimensions: {
      categories: ['workshop', 'line'],
      columnCategories: ['yr', 'qtr'],
      rowTotals: { showGrandTotals: true, showSubTotals: true, subTotalLabel: '小计' },
      columnTotals: { showGrandTotals: true, showSubTotals: true, subTotalLabel: '小计' },
    },
    columns: [{ type: 'aggregated', field: 'qty', agg: 'sum', label: '产量' }],
  };
  const gridOn = buildBiGrid(configOn, records);

  // 验证开启小计后行数与列数增加
  assert.ok(gridOn.rowCount > gridOff.rowCount, '开启行小计后行数必须增加（插入父级小计行）');
  assert.ok(gridOn.colCount > gridOff.colCount, '开启列小计后列数必须增加（插入父级小计列）');

  // 验证车间A小计行（车间A总计 10 + 20 + 30 = 60）
  const subtotalACells = gridOn.cells.filter(
    (c) => c.role === 'subtotal' && c.rowPath?.[0]?.memberKey === '车间A'
  );
  assert.ok(subtotalACells.length > 0, '车间A小计行必须存在且被赋予 subtotal 角色');
  const subtotalARowTotal = subtotalACells.find((c) => c.field === 'qty' && !c.columnPath)?.value;
  assert.equal(subtotalARowTotal, 60, '车间A行小计右侧总计必须精确等于 60');

  // 验证车间B小计行（车间B总计 100 + 40 = 140）
  const subtotalBCells = gridOn.cells.filter(
    (c) => c.role === 'subtotal' && c.rowPath?.[0]?.memberKey === '车间B'
  );
  assert.ok(subtotalBCells.length > 0, '车间B小计行必须存在且被赋予 subtotal 角色');
  const subtotalBRowTotal = subtotalBCells.find((c) => c.field === 'qty' && !c.columnPath)?.value;
  assert.equal(subtotalBRowTotal, 140, '车间B行小计右侧总计必须精确等于 140');

  // 验证列小计：2026年小计列（2026全量 200）
  const yrSubtotalCol = gridOn.cells.filter(
    (c) => c.role === 'subtotal' && c.columnPath?.[0]?.memberKey === '2026'
  );
  assert.ok(yrSubtotalCol.length > 0, '2026年列小计必须存在');

  // 验证全局总计与角落总计绝不重复累计小计（总计必须精确为 200，绝非 400）
  const grandCells = gridOn.cells.filter((c) => c.role === 'grand-total');
  const cornerCell = grandCells.find((c) => c.row === gridOn.rowCount - 1 && c.col === gridOn.colCount - 1);
  assert.equal(cornerCell?.value, 200, '角落总计必须为全量原始事实汇总 200，杜绝二次重复累加');

  // 3. 测试 indicatorsAsCol === false (指标纵向展开) 同样支持层级小计
  const configVertical = {
    dimensions: {
      categories: ['workshop', 'line'],
      columnCategories: ['yr', 'qtr'],
      indicatorsAsCol: false,
      rowTotals: { showGrandTotals: true, showSubTotals: true },
      columnTotals: { showGrandTotals: true, showSubTotals: true },
    },
    columns: [{ type: 'aggregated', field: 'qty', agg: 'sum', label: '产量' }],
  };
  const gridVertical = buildBiGrid(configVertical, records);
  const vertSubACells = gridVertical.cells.filter(
    (c) => c.role === 'subtotal' && c.rowPath?.[0]?.memberKey === '车间A'
  );
  assert.ok(vertSubACells.length > 0, '纵向指标透视下车间A小计同样生效');
  const vertSubATotal = vertSubACells.find((c) => c.field === 'qty' && typeof c.value === 'number' && !c.columnPath)?.value;
  assert.equal(vertSubATotal, 60, '纵向指标透视下车间A小计必须精确等于 60');
});


