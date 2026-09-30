import assert from 'node:assert/strict';
import test from 'node:test';

import {
  transformData,
  profileDataset,
  metricTemplateRegistry,
} from '../dist/esm/index.js';

const sampleRecords = [
  { order_id: 'O1', date: '2026-09-01', category: '电子', sales: 1000, cost: 600 },
  { order_id: 'O2', date: '2026-09-05', category: '电子', sales: 2000, cost: 1200 },
  { order_id: 'O3', date: '2026-09-10', category: '服饰', sales: 500, cost: 200 },
  { order_id: 'O4', date: '2026-10-02', category: '电子', sales: 1500, cost: 900 },
];

test('profiler: 智能推断字段类型', () => {
  const meta = profileDataset(sampleRecords);
  const byKey = Object.fromEntries(meta.map((m) => [m.key, m.type]));

  assert.equal(byKey['date'], 'time');
  assert.equal(byKey['sales'], 'number');
  assert.equal(byKey['cost'], 'number');
  assert.equal(byKey['category'], 'text');
  assert.equal(byKey['order_id'], 'text');
});

test('pipeline: 无维度时自动作为全量明细输出与逐行计算', () => {
  const result = transformData(sampleRecords, {
    columns: [
      { type: 'fixed', field: 'order_id' },
      { type: 'fixed', field: 'sales' },
      { type: 'fixed', field: 'cost' },
      {
        type: 'computed',
        name: 'profit',
        label: '利润',
        expression: '[sales] - [cost]',
      },
      {
        type: 'computed',
        name: 'level',
        label: '大额标记',
        expression: 'IF([sales] >= 1500, "大额订单", "普通订单")',
      },
    ],
  });

  assert.equal(result.data.length, 4);
  assert.equal(result.data[0].profit, 400);
  assert.equal(result.data[1].profit, 800);
  assert.equal(result.data[0].level, '普通订单');
  assert.equal(result.data[1].level, '大额订单');
  assert.equal(result.meta.inputRows, 4);
  assert.equal(result.meta.outputRows, 4);
});

test('pipeline: 配置维度时自动执行分组透视汇总', () => {
  const result = transformData(sampleRecords, {
    dimensions: {
      timeBucket: { field: 'date', granularity: 'month' },
      categories: ['category'],
    },
    columns: [
      { type: 'aggregated', field: 'sales', agg: 'sum', label: '总销售额' },
      { type: 'aggregated', field: 'cost', agg: 'sum', label: '总成本' },
      {
        type: 'computed',
        name: 'profit',
        label: '毛利',
        expression: '[SUM(sales)] - [SUM(cost)]',
        precision: 2,
      },
      {
        type: 'computed',
        name: 'profit_rate',
        label: '毛利率',
        expression: 'IF([SUM(sales)] > 0, ([SUM(sales)] - [SUM(cost)]) / [SUM(sales)], 0)',
        precision: 4,
      },
    ],
  });

  // 预期产生 3 组：2026-09 电子 (sales=3000, cost=1800), 2026-09 服饰 (sales=500, cost=200), 2026-10 电子 (sales=1500, cost=900)
  assert.equal(result.data.length, 3);

  const sepElectronics = result.data.find(
    (r) => r.date === '2026-09' && r.category === '电子'
  );
  assert.ok(sepElectronics);
  assert.equal(sepElectronics['SUM(sales)'], 3000);
  assert.equal(sepElectronics['SUM(cost)'], 1800);
  assert.equal(sepElectronics.profit, 1200);
  assert.equal(sepElectronics.profit_rate, 0.4);
});

test('pipeline: 未配置维度但配置度量时自动折叠为全局汇总单行', () => {
  const result = transformData(sampleRecords, {
    columns: [
      { type: 'aggregated', field: 'sales', agg: 'sum', label: '全店销售总额' },
      { type: 'aggregated', field: 'cost', agg: 'sum', label: '全店采购总额' },
      {
        type: 'computed',
        name: 'total_profit',
        label: '总利润',
        expression: '[sales] - [cost]', // 验证直接用 [sales] 取到汇总值
      },
    ],
  });

  // 全局聚合只有 1 行
  assert.equal(result.data.length, 1);
  assert.equal(result.data[0]['SUM(sales)'], 5000);
  assert.equal(result.data[0]['SUM(cost)'], 2900);
  assert.equal(result.data[0].total_profit, 2100);
});

test('template: 行业指标模板热插拔应用', () => {
  const template = metricTemplateRegistry.require('retail:gross_profit');
  const cols = template.createColumns({ sales: 'sales', cost: 'cost' });

  assert.equal(cols.length, 4);
  assert.equal(cols[0].type, 'aggregated');
  assert.equal(cols[2].type, 'computed');

  const result = transformData(sampleRecords, {
    dimensions: {
      categories: ['category'],
    },
    columns: cols,
  });

  assert.equal(result.data.length, 2); // 电子、服饰
  const elec = result.data.find((r) => r.category === '电子');
  assert.ok(elec);
  assert.equal(elec['SUM(sales)'], 4500);
  assert.equal(elec['SUM(cost)'], 2700);
  assert.equal(elec.gross_profit, 1800);
});

test('headers: 传递表头映射与未传递时降级回退', () => {
  // 1. 传递 headers 映射
  const headers = {
    sales: '销售额',
    cost: '成本',
    category: '商品类目',
  };
  const metaWithHeaders = profileDataset(sampleRecords, { headers });
  const labelMap = Object.fromEntries(metaWithHeaders.map((m) => [m.key, m.label]));
  assert.equal(labelMap['sales'], '销售额');
  assert.equal(labelMap['cost'], '成本');
  assert.equal(labelMap['category'], '商品类目');
  // 未在 headers 中定义的字段，确定性降级为原始 key
  assert.equal(labelMap['order_id'], 'order_id');

  // 2. 未传递 headers，全部降级为原始 key
  const metaWithoutHeaders = profileDataset(sampleRecords);
  const fallbackMap = Object.fromEntries(metaWithoutHeaders.map((m) => [m.key, m.label]));
  assert.equal(fallbackMap['sales'], 'sales');
  assert.equal(fallbackMap['order_id'], 'order_id');

  // 3. pipeline 输出列继承 headers 映射
  const transformed = transformData(sampleRecords, {
    headers,
    dimensions: {
      categories: ['category'],
    },
    columns: [
      { type: 'fixed', field: 'order_id' },
      { type: 'aggregated', field: 'sales', agg: 'sum' },
    ],
  });
  const titles = Object.fromEntries(transformed.columns.map((c) => [c.key, c.title]));
  assert.equal(titles['category'], '商品类目');
  assert.equal(titles['order_id'], 'order_id');
  assert.equal(titles['SUM(sales)'], 'SUM(销售额)');
});

test('pipeline: 参与计算的字段未在表格列中展示时，计算仍能正常取值', () => {
  const headers = {
    sales: '销售额',
    cost: '成本',
    category: '品类',
  };

  // 1. 聚合分组：columns 中完全不放 sales 和 cost，只放计算列 profit
  const aggResult = transformData(sampleRecords, {
    headers,
    dimensions: {
      categories: ['category'],
    },
    columns: [
      {
        type: 'computed',
        name: 'profit',
        label: '毛利额',
        expression: '[SUM(sales)] - [SUM(cost)]',
      },
      {
        type: 'computed',
        name: 'profit_by_label',
        label: '按中文标签求毛利',
        expression: '[销售额] - [成本]',
      },
    ],
  });

  // 验证输出列中仅包含维度列品类和两列计算列，没有 sales 和 cost
  const colKeys = aggResult.columns.map((c) => c.key);
  assert.deepEqual(colKeys, ['category', 'profit', 'profit_by_label']);

  // 验证数据正确参与了计算：
  // 电子: sales=1000+2000+1500=4500, cost=600+1200+900=2700 => profit=1800
  const elec = aggResult.data.find((r) => r.category === '电子');
  assert.ok(elec);
  assert.equal(elec.profit, 1800);
  assert.equal(elec.profit_by_label, 1800);

  // 服饰: sales=500, cost=200 => profit=300
  const cloth = aggResult.data.find((r) => r.category === '服饰');
  assert.ok(cloth);
  assert.equal(cloth.profit, 300);
  assert.equal(cloth.profit_by_label, 300);

  // 2. 明细模式：无维度，columns 中只有 order_id 和 profit，没有 sales 和 cost
  const flatResult = transformData(sampleRecords, {
    headers,
    columns: [
      { type: 'fixed', field: 'order_id' },
      {
        type: 'computed',
        name: 'profit',
        label: '毛利额',
        expression: '[sales] - [cost]',
      },
    ],
  });
  const flatColKeys = flatResult.columns.map((c) => c.key);
  assert.deepEqual(flatColKeys, ['order_id', 'profit']);
  assert.equal(flatResult.data[0].profit, 400); // 1000 - 600
  assert.equal(flatResult.data[1].profit, 800); // 2000 - 1200
});

test('pipeline: 聚合累加器中 NULL 值严格跳过，绝不污染 MIN、COUNT、AVG', () => {
  const recordsWithNulls = [
    { group: 'A', value: 100 },
    { group: 'A', value: 200 },
    { group: 'A', value: null },
    { group: 'A', value: 500 },
  ];

  const result = transformData(recordsWithNulls, {
    dimensions: {
      categories: ['group'],
    },
    columns: [
      { type: 'aggregated', field: 'value', agg: 'min', label: '最小值' },
      { type: 'aggregated', field: 'value', agg: 'max', label: '最大值' },
      { type: 'aggregated', field: 'value', agg: 'count', label: '有效计数' },
      { type: 'aggregated', field: 'value', agg: 'avg', label: '平均值' },
      { type: 'aggregated', field: 'value', agg: 'sum', label: '总和' },
    ],
  });

  assert.equal(result.data.length, 1);
  const rowA = result.data[0];
  // 验证 MIN 必须为 100，绝不能被 null 转 0 污染为 0！
  assert.equal(rowA['MIN(value)'], 100);
  assert.equal(rowA['MAX(value)'], 500);
  // 验证 COUNT 必须为 3，绝不能把 null 算作一条有效数值！
  assert.equal(rowA['COUNT(value)'], 3);
  // 验证 SUM 为 800
  assert.equal(rowA['SUM(value)'], 800);
  // 验证 AVG 必须为 800 / 3 = 266.666...，绝不能按 800 / 4 计算！
  assert.ok(Math.abs(Number(rowA['AVG(value)']) - (800 / 3)) < 0.001);
});

test('pipeline: 仅配置时间分桶且单桶多条记录时，SUM/AVG/MIN/MAX/COUNT 计算精准且互不相同', () => {
  const multiRecordDays = [
    { timestamp: '2026-08-01 08:00:00', spindle_speed: 3200 },
    { timestamp: '2026-08-01 12:00:00', spindle_speed: 4100 },
    { timestamp: '2026-08-01 16:30:00', spindle_speed: 2800 },
  ];

  const result = transformData(multiRecordDays, {
    dimensions: {
      timeBucket: { field: 'timestamp', granularity: 'day' },
    },
    columns: [
      { type: 'aggregated', field: 'spindle_speed', agg: 'sum', label: '总转速' },
      { type: 'aggregated', field: 'spindle_speed', agg: 'avg', label: '平均转速' },
      { type: 'aggregated', field: 'spindle_speed', agg: 'min', label: '最小转速' },
      { type: 'aggregated', field: 'spindle_speed', agg: 'max', label: '最大转速' },
      { type: 'aggregated', field: 'spindle_speed', agg: 'count', label: '采样数' },
    ],
  });

  assert.equal(result.data.length, 1);
  const row = result.data[0];

  assert.equal(row.timestamp, '2026-08-01');
  assert.equal(row['SUM(spindle_speed)'], 10100);
  assert.equal(row['AVG(spindle_speed)'], 10100 / 3);
  assert.equal(row['MIN(spindle_speed)'], 2800);
  assert.equal(row['MAX(spindle_speed)'], 4100);
  assert.equal(row['COUNT(spindle_speed)'], 3);

  // 验证自定义标签也准确挂载了对应的聚合值，绝非被 finalSum 锁定
  assert.equal(row['总转速'], 10100);
  assert.equal(row['平均转速'], 10100 / 3);
  assert.equal(row['最小转速'], 2800);
  assert.equal(row['最大转速'], 4100);
  assert.equal(row['采样数'], 3);

  // 确认求和、平均、最大、最小值互不相同
  assert.notEqual(row['总转速'], row['平均转速']);
  assert.notEqual(row['平均转速'], row['最大转速']);
  assert.notEqual(row['最小转速'], row['最大转速']);
});

test('pipeline: summaryRow[aggCol.label] 正确赋值为用户选定的聚合函数值，不被 finalSum 锁定', () => {
  const records = [
    { date: '2026-08-01', qty: 100 },
    { date: '2026-08-01', qty: 300 },
  ];

  const result = transformData(records, {
    headers: { qty: '交付件数' },
    dimensions: {
      timeBucket: { field: 'date', granularity: 'day' },
    },
    columns: [
      // 用户将 '交付件数' 设置为了 avg 聚合，label 命名与中文表头一致
      { type: 'aggregated', field: 'qty', agg: 'avg', label: '交付件数' },
    ],
  });

  assert.equal(result.data.length, 1);
  const row = result.data[0];
  // 预期交付件数应为 (100 + 300) / 2 = 200，绝非 finalSum (400)
  assert.equal(row['AVG(qty)'], 200);
  assert.equal(row['交付件数'], 200);
  assert.equal(row.qty, 200);
});

