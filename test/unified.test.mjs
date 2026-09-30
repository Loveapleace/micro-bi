import assert from 'node:assert/strict';
import test from 'node:test';

import {
  unwrapAggregateFormulas,
  wrapAggregateFormulas,
  cleanAggregatedLabel,
  formatAggregatedLabel,
  convertColumnsToAggregated,
  convertColumnsToFixed,
  transformData,
  metricTemplateRegistry,
} from '../dist/esm/index.js';

test('formulaHelper: unwrapAggregateFormulas 正确还原行级公式', () => {
  assert.equal(
    unwrapAggregateFormulas('[SUM(sales)] - [SUM(cost)]'),
    '[sales] - [cost]'
  );

  assert.equal(
    unwrapAggregateFormulas('IF([SUM(sales)] > 1000, [AVG(margin)] * 100, [MIN(loss)])'),
    'IF([sales] > 1000, [margin] * 100, [loss])'
  );

  assert.equal(
    unwrapAggregateFormulas('[COUNT(order_id)] + [MAX(score)]'),
    '[order_id] + [score]'
  );
});

test('formulaHelper: wrapAggregateFormulas 正确包装聚合公式', () => {
  const numericFields = new Set(['sales', 'cost']);

  assert.equal(
    wrapAggregateFormulas('[sales] - [cost]', numericFields),
    '[SUM(sales)] - [SUM(cost)]'
  );

  assert.equal(
    wrapAggregateFormulas('[SUM(sales)] - [cost]', numericFields),
    '[SUM(sales)] - [SUM(cost)]'
  );
});

test('unified: 同一公式 [sales] - [cost] 在明细与透视中均可无缝执行', () => {
  const sampleData = [
    { region: '华东', sales: 1000, cost: 600 },
    { region: '华东', sales: 2000, cost: 1200 },
    { region: '华北', sales: 500, cost: 200 },
  ];

  // 1. 无维度：明细形态，逐行计算毛利
  const detailResult = transformData(sampleData, {
    columns: [
      { type: 'fixed', field: 'region' },
      { type: 'fixed', field: 'sales' },
      { type: 'fixed', field: 'cost' },
      {
        type: 'computed',
        name: 'profit',
        label: '毛利额',
        expression: '[sales] - [cost]',
      },
    ],
  });
  assert.equal(detailResult.data.length, 3);
  assert.equal(detailResult.data[0].profit, 400); // 1000 - 600
  assert.equal(detailResult.data[1].profit, 800); // 2000 - 1200
  assert.equal(detailResult.data[2].profit, 300); // 500 - 200

  // 2. 有维度：透视汇总形态，无需更改公式，[sales] - [cost] 依然直接计算出分组汇总毛利！
  const pivotResult = transformData(sampleData, {
    dimensions: {
      categories: ['region'],
    },
    columns: [
      { type: 'aggregated', field: 'sales', agg: 'sum' },
      { type: 'aggregated', field: 'cost', agg: 'sum' },
      {
        type: 'computed',
        name: 'profit',
        label: '毛利额',
        expression: '[sales] - [cost]',
      },
    ],
  });
  assert.equal(pivotResult.data.length, 2);
  const east = pivotResult.data.find((r) => r.region === '华东');
  assert.ok(east);
  assert.equal(east['SUM(sales)'], 3000);
  assert.equal(east['SUM(cost)'], 1800);
  assert.equal(east.profit, 1200); // 3000 - 1800

  const north = pivotResult.data.find((r) => r.region === '华北');
  assert.ok(north);
  assert.equal(north.profit, 300); // 500 - 200
});

test('unified: 行业模板无 mode 约束，一键应用', () => {
  const template = metricTemplateRegistry.get('retail:gross_profit');
  assert.ok(template);

  const cols = template.createColumns({ sales: 'sales', cost: 'cost' });
  assert.equal(cols.length, 4);

  const sampleData = [
    { sales: 1000, cost: 600 },
    { sales: 2000, cost: 1200 },
  ];

  // 全局汇总应用模板
  const result = transformData(sampleData, {
    columns: cols,
  });

  assert.equal(result.data.length, 1);
  assert.equal(result.data[0]['SUM(sales)'], 3000);
  assert.equal(result.data[0]['SUM(cost)'], 1800);
  assert.equal(result.data[0].gross_profit, 1200);
  assert.equal(result.data[0].gross_margin_rate, 40);
});

test('unified: 截图场景实测：无维度但包含固定列与度量时，智能裁定为明细表（保留全量行，固定列不为空，度量降级为行原值）', () => {
  const records = [
    { order_date: '2024-03-01', region: '华东', sales: 12000, cost: 8000, quantity: 15 },
    { order_date: '2024-03-02', region: '华北', sales: 8500, cost: 5000, quantity: 10 },
    { order_date: '2024-03-03', region: '华南', sales: 20000, cost: 13000, quantity: 25 },
  ];

  // 模拟用户截图中的配置：
  // 1. 无任何维度 (dimensions 为空)
  // 2. 补充了两个固定原值列：order_date, region
  // 3. 原有聚合度量保留：sales, cost, quantity
  // 4. 计算列：[SUM(sales)] - [SUM(cost)]
  const result = transformData(records, {
    columns: [
      { type: 'fixed', field: 'order_date', label: '下单时间' },
      { type: 'fixed', field: 'region', label: '所属大区' },
      { type: 'aggregated', field: 'sales', agg: 'sum', label: '销售总额' },
      { type: 'aggregated', field: 'cost', agg: 'sum', label: '采购成本' },
      { type: 'aggregated', field: 'quantity', agg: 'sum', label: '出货件数' },
      {
        type: 'computed',
        name: 'profit',
        label: '综合毛利额',
        expression: '[SUM(sales)] - [SUM(cost)]',
      },
    ],
  });

  // 1. 验证输出行数为 3（绝不是折叠后的 1 行！）
  assert.equal(result.data.length, 3);
  assert.equal(result.meta.form, 'detail');

  // 2. 验证固定列必须有值，绝不能为 undefined / null / '-'
  assert.equal(result.data[0].order_date, '2024-03-01');
  assert.equal(result.data[0].region, '华东');
  assert.equal(result.data[1].order_date, '2024-03-02');
  assert.equal(result.data[1].region, '华北');
  assert.equal(result.data[2].order_date, '2024-03-03');
  assert.equal(result.data[2].region, '华南');

  // 3. 验证度量列取当前行的值
  assert.equal(result.data[0]['SUM(sales)'], 12000);
  assert.equal(result.data[0]['SUM(cost)'], 8000);
  assert.equal(result.data[0]['SUM(quantity)'], 15);

  // 4. 验证逐行毛利计算结果正确
  assert.equal(result.data[0].profit, 4000); // 12000 - 8000
  assert.equal(result.data[1].profit, 3500); // 8500 - 5000
  assert.equal(result.data[2].profit, 7000); // 20000 - 13000
});

test('conversion: cleanAggregatedLabel 与 formatAggregatedLabel 标签前缀处理', () => {
  assert.equal(cleanAggregatedLabel('求和(交付总件数)', 'output_qty'), '交付总件数');
  assert.equal(cleanAggregatedLabel('平均(主轴温度)', 'temp'), '主轴温度');
  assert.equal(cleanAggregatedLabel('计数(工单号)', 'order_code'), '工单号');
  assert.equal(cleanAggregatedLabel('SUM(sales)', 'sales'), 'sales');
  assert.equal(cleanAggregatedLabel('销售总额', 'sales'), '销售总额');

  assert.equal(formatAggregatedLabel('销售额', 'sum'), '求和(销售额)');
  assert.equal(formatAggregatedLabel('求和(销售额)', 'sum'), '求和(销售额)'); // 防重复
  assert.equal(formatAggregatedLabel('设备编号', 'count'), '计数(设备编号)');
});

test('conversion: convertColumnsToAggregated 无维度固定列自动转换为聚合度量', () => {
  const fields = [
    { key: 'order_code', label: '工单号', type: 'text', detectedType: 'text' },
    { key: 'workshop', label: '车间', type: 'text', detectedType: 'text' },
    { key: 'output_qty', label: '出货数量', type: 'number', detectedType: 'number' },
    { key: 'defect_count', label: '缺陷数', type: 'number', detectedType: 'number' },
  ];

  const fixedCols = [
    { type: 'fixed', field: 'order_code', label: '工单号' },
    { type: 'fixed', field: 'output_qty', label: '出货数量' },
    { type: 'fixed', field: 'defect_count', label: '缺陷数' },
    {
      type: 'computed',
      name: 'defect_ratio',
      label: '缺陷率',
      expression: '[defect_count] / [output_qty]',
    },
  ];

  // 假设用户将 workshop 设置为维度（排除不在转换之列）
  const aggCols = convertColumnsToAggregated(fixedCols, fields, {
    excludeFields: ['workshop'],
  });

  // 1. 验证数量不变
  assert.equal(aggCols.length, 4);

  // 2. 验证数值列转换为 sum 聚合度量
  const outputQtyCol = aggCols.find((c) => c.field === 'output_qty');
  assert.equal(outputQtyCol?.type, 'aggregated');
  assert.equal(outputQtyCol?.agg, 'sum');
  assert.equal(outputQtyCol?.label, '求和(出货数量)');

  const defectCol = aggCols.find((c) => c.field === 'defect_count');
  assert.equal(defectCol?.type, 'aggregated');
  assert.equal(defectCol?.agg, 'sum');
  assert.equal(defectCol?.label, '求和(缺陷数)');

  // 3. 验证非数值固定列转换为 count 聚合度量
  const orderCodeCol = aggCols.find((c) => c.field === 'order_code');
  assert.equal(orderCodeCol?.type, 'aggregated');
  assert.equal(orderCodeCol?.agg, 'count');
  assert.equal(orderCodeCol?.label, '计数(工单号)');

  // 4. 验证计算列公式被自动包装
  const computedCol = aggCols.find((c) => c.name === 'defect_ratio');
  assert.equal(computedCol?.expression, '[SUM(defect_count)] / [SUM(output_qty)]');
});

test('conversion: convertColumnsToFixed 聚合度量自动还原为固定原值', () => {
  const fields = [
    { key: 'order_code', label: '工单号', type: 'text', detectedType: 'text' },
    { key: 'output_qty', label: '出货数量', type: 'number', detectedType: 'number' },
    { key: 'defect_count', label: '缺陷数', type: 'number', detectedType: 'number' },
  ];

  const aggCols = [
    { type: 'aggregated', field: 'order_code', agg: 'count', label: '计数(工单号)' },
    { type: 'aggregated', field: 'output_qty', agg: 'sum', label: '求和(出货数量)' },
    { type: 'aggregated', field: 'defect_count', agg: 'sum', label: '求和(缺陷数)' },
    {
      type: 'computed',
      name: 'defect_ratio',
      label: '缺陷率',
      expression: '[SUM(defect_count)] / [SUM(output_qty)]',
    },
  ];

  const fixedCols = convertColumnsToFixed(aggCols, fields);

  assert.equal(fixedCols.length, 4);

  // 1. 验证聚合列转为 fixed 且标签被净化还原
  const outputQtyCol = fixedCols.find((c) => c.field === 'output_qty');
  assert.equal(outputQtyCol?.type, 'fixed');
  assert.equal(outputQtyCol?.label, '出货数量');

  const defectCol = fixedCols.find((c) => c.field === 'defect_count');
  assert.equal(defectCol?.type, 'fixed');
  assert.equal(defectCol?.label, '缺陷数');

  const orderCodeCol = fixedCols.find((c) => c.field === 'order_code');
  assert.equal(orderCodeCol?.type, 'fixed');
  assert.equal(orderCodeCol?.label, '工单号');

  // 2. 验证计算列公式被自动解包
  const computedCol = fixedCols.find((c) => c.name === 'defect_ratio');
  assert.equal(computedCol?.expression, '[defect_count] / [output_qty]');
});

test('conversion: 双向往返转换具备对称幂等性 (Round-trip Idempotence)', () => {
  const fields = [
    { key: 'sales', label: '销售额', type: 'number', detectedType: 'number' },
    { key: 'cost', label: '采购成本', type: 'number', detectedType: 'number' },
  ];

  const originalFixedCols = [
    { type: 'fixed', field: 'sales', label: '销售额' },
    { type: 'fixed', field: 'cost', label: '采购成本' },
    { type: 'computed', name: 'profit', label: '利润', expression: '[sales] - [cost]' },
  ];

  // 固定列 -> 聚合列
  const aggregated = convertColumnsToAggregated(originalFixedCols, fields);
  // 聚合列 -> 恢复固定列
  const restoredFixed = convertColumnsToFixed(aggregated, fields);

  assert.deepEqual(restoredFixed, originalFixedCols);
});


