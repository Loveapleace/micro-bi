import assert from 'node:assert/strict';
import test from 'node:test';
import { validateTransformConfig } from '../dist/esm/index.js';

test('validator: 空输入或非对象输入被拒绝', () => {
  const r1 = validateTransformConfig('');
  assert.equal(r1.valid, false);
  assert.equal(r1.issues[0]?.path, 'root');

  const r2 = validateTransformConfig('   ');
  assert.equal(r2.valid, false);

  const r3 = validateTransformConfig('12345');
  assert.equal(r3.valid, false);

  const r4 = validateTransformConfig('["array"]');
  assert.equal(r4.valid, false);
});

test('validator: 畸形 JSON 字符串报错精确捕获', () => {
  const res = validateTransformConfig('{"columns": [}');
  assert.equal(res.valid, false);
  assert.equal(res.issues[0]?.path, 'json');
  assert.ok(res.issues[0]?.message.includes('JSON 语法解析失败'));
});

test('validator: columns 结构完整性校验', () => {
  // 缺少 columns
  const r1 = validateTransformConfig({});
  assert.equal(r1.valid, false);
  assert.ok(r1.issues.some((i) => i.path === 'columns'));

  // columns 不是数组
  const r2 = validateTransformConfig({ columns: 'not_array' });
  assert.equal(r2.valid, false);

  // 列类型非法
  const r3 = validateTransformConfig({
    columns: [{ type: 'unknown_type', field: 'sales' }],
  });
  assert.equal(r3.valid, false);
  assert.ok(r3.issues.some((i) => i.path === 'columns[0].type'));

  // 固定列缺少 field
  const r4 = validateTransformConfig({
    columns: [{ type: 'fixed' }],
  });
  assert.equal(r4.valid, false);
  assert.ok(r4.issues.some((i) => i.path === 'columns[0].field'));

  // 聚合度量缺少 agg 或 agg 非法
  const r5 = validateTransformConfig({
    columns: [{ type: 'aggregated', field: 'sales', agg: 'illegal_agg' }],
  });
  assert.equal(r5.valid, false);
  assert.ok(r5.issues.some((i) => i.path === 'columns[0].agg'));
});

test('validator: 计算列公式语法 AST 校验', () => {
  // 公式语法错误 (括号未闭合)
  const r1 = validateTransformConfig({
    columns: [
      {
        type: 'computed',
        name: 'profit',
        expression: 'ROUND([sales] - [cost]',
      },
    ],
  });
  assert.equal(r1.valid, false);
  assert.ok(r1.issues.some((i) => i.path === 'columns[0].expression'));

  // 合法公式语法
  const r2 = validateTransformConfig({
    columns: [
      {
        type: 'computed',
        name: 'profit',
        expression: 'IF([sales] > 100, ROUND([sales] * 0.8, 2), 0)',
        precision: 2,
      },
    ],
  });
  assert.equal(r2.valid, true);
  assert.equal(r2.issues.length, 0);
  assert.ok(r2.parsedConfig);
});

test('validator: 维度切片合法性校验', () => {
  // 时间分桶粒度非法
  const r1 = validateTransformConfig({
    dimensions: {
      timeBucket: {
        field: 'created_at',
        granularity: 'century', // 非法粒度
      },
    },
    columns: [{ type: 'fixed', field: 'id' }],
  });
  assert.equal(r1.valid, false);
  assert.ok(r1.issues.some((i) => i.path === 'dimensions.timeBucket.granularity'));

  // 合法时间分桶与分类维度
  const r2 = validateTransformConfig({
    dimensions: {
      timeBucket: {
        field: 'created_at',
        granularity: 'month',
      },
      categories: ['workshop', 'line'],
    },
    columns: [{ type: 'fixed', field: 'id' }],
  });
  assert.equal(r2.valid, true);
  assert.equal(r2.issues.length, 0);
});

test('validator: 数据集字段兼容性比对警示', () => {
  const availableFields = [
    { key: 'plan_start_time', label: '计划投产时间', type: 'time' },
    { key: 'workshop', label: '车间', type: 'text' },
    { key: 'output_qty', label: '交付总数', type: 'number' },
  ];

  // 配置引用了当前数据集中不存在的未知字段
  const res = validateTransformConfig(
    {
      dimensions: {
        categories: ['non_existent_category'],
      },
      columns: [
        { type: 'aggregated', field: 'output_qty', agg: 'sum' },
        { type: 'fixed', field: 'ghost_column' },
      ],
    },
    availableFields
  );

  // 格式合法，但应产生 warning 告警
  assert.equal(res.valid, true);
  assert.ok(res.issues.some((i) => i.severity === 'warning' && i.message.includes('non_existent_category')));
  assert.ok(res.issues.some((i) => i.severity === 'warning' && i.message.includes('ghost_column')));
});
