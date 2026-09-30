import assert from 'node:assert/strict';
import test from 'node:test';

import { transformData, validateTransformConfig } from '../dist/esm/engine/index.js';

test('pivot: validateTransformConfig 支持透视列维度与总计配置', () => {
  const validConfig = {
    dimensions: {
      categories: ['workshop'],
      columnCategories: ['status'],
      columnTimeBucket: {
        field: 'date',
        granularity: 'month',
      },
      indicatorsAsCol: true,
      rowTotals: { showGrandTotals: true, grandTotalLabel: '行总计' },
      columnTotals: { showGrandTotals: true, grandTotalLabel: '列总计' },
    },
    columns: [
      { type: 'aggregated', field: 'output_qty', agg: 'sum', label: '交付总件数' },
    ],
  };

  const res = validateTransformConfig(validConfig);
  const errors = res.issues.filter((i) => i.severity === 'error');
  assert.equal(errors.length, 0, '合法透视配置不应有 error');
  assert.equal(res.valid, true);
});

test('pivot: validateTransformConfig 拦截非法的 columnCategories 与 indicatorsAsCol', () => {
  const invalidConfig = {
    dimensions: {
      categories: ['workshop'],
      columnCategories: 'not_an_array',
      indicatorsAsCol: 'not_a_boolean',
    },
    columns: [
      { type: 'aggregated', field: 'output_qty', agg: 'sum' },
    ],
  };

  const res = validateTransformConfig(invalidConfig);
  assert.equal(res.valid, false);
  assert.ok(res.issues.some((i) => i.path === 'dimensions.columnCategories'), '应拦截非数组 columnCategories');
  assert.ok(res.issues.some((i) => i.path === 'dimensions.indicatorsAsCol'), '应拦截非布尔 indicatorsAsCol');
});

test('pivot: transformData 正确进行双向多维交叉分组透视与指标聚合', () => {
  const records = [
    { workshop: '车间A', status: '合格', output_qty: 100, defect_qty: 2 },
    { workshop: '车间A', status: '返工', output_qty: 10, defect_qty: 10 },
    { workshop: '车间A', status: '合格', output_qty: 50, defect_qty: 1 },
    { workshop: '车间B', status: '合格', output_qty: 200, defect_qty: 5 },
    { workshop: '车间B', status: '返工', output_qty: 30, defect_qty: 30 },
  ];

  const config = {
    headers: {
      workshop: '承制车间',
      status: '检验状态',
      output_qty: '交付件数',
    },
    dimensions: {
      categories: ['workshop'],
      columnCategories: ['status'],
    },
    columns: [
      { type: 'aggregated', field: 'output_qty', agg: 'sum', label: '总产出' },
      { type: 'aggregated', field: 'defect_qty', agg: 'sum', label: '总缺陷' },
      {
        type: 'computed',
        name: 'yield_rate',
        label: '良品率(%)',
        expression: '([SUM(output_qty)] - [SUM(defect_qty)]) / [SUM(output_qty)] * 100',
        precision: 1,
      },
    ],
  };

  const result = transformData(records, config);

  // 1. 验证元信息标明为双向交叉透视表
  assert.equal(result.meta.form, 'pivot');
  assert.equal(result.meta.isCrossTab, true);
  assert.equal(result.meta.inputRows, 5);

  // 2. 验证行与列交叉组合产生 4 组 (车间A-合格, 车间A-返工, 车间B-合格, 车间B-返工)
  assert.equal(result.data.length, 4);

  // 3. 验证车间A-合格交叉格数值累加
  const cellAQualified = result.data.find(
    (r) => r.workshop === '车间A' && r.status === '合格'
  );
  assert.ok(cellAQualified, '应存在 车间A-合格 交叉格');
  assert.equal(cellAQualified['SUM(output_qty)'], 150); // 100 + 50
  assert.equal(cellAQualified['SUM(defect_qty)'], 3);   // 2 + 1
  // 良品率: (150 - 3) / 150 * 100 = 98.0%
  assert.equal(cellAQualified['yield_rate'], 98);

  // 4. 验证底层明细挂载
  assert.equal(cellAQualified._rawRows?.length, 2);

  // 5. 验证列元数据完整性
  const colKeys = result.columns.map((c) => c.key);
  assert.ok(colKeys.includes('workshop'), '应包含行维度 workshop');
  assert.ok(colKeys.includes('status'), '应包含列维度 status');
  assert.ok(colKeys.includes('SUM(output_qty)'), '应包含指标 SUM(output_qty)');
  assert.ok(colKeys.includes('yield_rate'), '应包含计算列 yield_rate');
});

test('pivot: 仅配置行维度时向后兼容 (isCrossTab 为 false)', () => {
  const records = [
    { workshop: '车间A', output_qty: 100 },
    { workshop: '车间B', output_qty: 200 },
  ];

  const config = {
    dimensions: {
      categories: ['workshop'],
    },
    columns: [
      { type: 'aggregated', field: 'output_qty', agg: 'sum' },
    ],
  };

  const result = transformData(records, config);
  assert.equal(result.meta.form, 'pivot');
  assert.equal(result.meta.isCrossTab, false);
  assert.equal(result.data.length, 2);
});

test('pivot: 支持 columnTimeBucket 列时间周期分桶透视', () => {
  const records = [
    { workshop: '车间A', date: '2024-01-10', sales: 100 },
    { workshop: '车间A', date: '2024-01-20', sales: 200 },
    { workshop: '车间A', date: '2024-02-15', sales: 300 },
    { workshop: '车间B', date: '2024-01-12', sales: 400 },
  ];

  const config = {
    dimensions: {
      categories: ['workshop'],
      columnTimeBucket: {
        field: 'date',
        granularity: 'month',
      },
    },
    columns: [
      { type: 'aggregated', field: 'sales', agg: 'sum', label: '总销售' },
    ],
  };

  const result = transformData(records, config);
  assert.equal(result.meta.isCrossTab, true);
  // 车间A-2024-01, 车间A-2024-02, 车间B-2024-01
  assert.equal(result.data.length, 3);

  const cellAJan = result.data.find(r => r.workshop === '车间A' && r.date === '2024-01');
  assert.ok(cellAJan, '应存在 车间A-2024-01');
  assert.equal(cellAJan['SUM(sales)'], 300);
});

test('pivot: generateTableInstanceCsv 提取 2D 矩阵并正确注入 UTF-8 BOM', async () => {
  const { generateTableInstanceCsv } = await import('../dist/esm/ui/index.js');
  // 模拟一个 VTable 2D 表格实例
  const mockTable = {
    rowCount: 3,
    colCount: 3,
    getCellValue(c, r) {
      const grid = [
        ['车间', '2024-01', '2024-02'],
        ['一号车间,含逗号', '100', '200'],
        ['二号车间', '300', '400'],
      ];
      return grid[r]?.[c] ?? '';
    },
  };

  const csv = generateTableInstanceCsv(mockTable);
  assert.ok(csv.startsWith('\uFEFF'), '必须包含 UTF-8 BOM');
  assert.ok(csv.includes('"一号车间,含逗号"'), '含逗号的单元格应被引号安全转义');
  const lines = csv.split('\r\n');
  assert.equal(lines.length, 3);
  assert.equal(lines[0].replace(/^\uFEFF/, ''), '车间,2024-01,2024-02');
});

test('pivot: LivePreviewTable 组件导出且支持透视配置 props 传递', async () => {
  const { LivePreviewTable } = await import('../dist/esm/ui/index.js');
  assert.ok(typeof LivePreviewTable === 'function', 'LivePreviewTable 必须为有效 React 组件函数');
});


