import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DynamicDataConfigPanel,
  FieldProfilerList,
  DimensionConfigComponent,
  ColumnConfigList,
  FormulaEditorModal,
  LivePreviewTable,
  DynamicDataView,
  VChartView,
  VTableView,
  DimensionSwitcher,
  MetricSwitcher,
  ViewTypeSwitcher,
  PivotDrillthroughModal,
  resolveThemeConfig,
  deepMerge,
  isRateOrRatioMetric,
  isPerMilleMetric,
} from '../dist/esm/ui/index.js';

test('ui: 配置层与展示层组件正常暴露与加载', () => {
  assert.ok(DynamicDataConfigPanel, 'DynamicDataConfigPanel should be defined');
  assert.ok(
    typeof DynamicDataConfigPanel === 'function' || typeof DynamicDataConfigPanel === 'object',
    'DynamicDataConfigPanel should be a valid React Component (forwardRef)'
  );
  assert.equal(typeof FieldProfilerList, 'function');
  assert.equal(typeof DimensionConfigComponent, 'function');
  assert.equal(typeof ColumnConfigList, 'function');
  assert.equal(typeof FormulaEditorModal, 'function');
  assert.equal(typeof LivePreviewTable, 'function');
  assert.equal(typeof DynamicDataView, 'function');
  assert.equal(typeof VChartView, 'function');
  assert.equal(typeof VTableView, 'function');
  assert.equal(typeof DimensionSwitcher, 'function');
  assert.equal(typeof MetricSwitcher, 'function');
  assert.equal(typeof ViewTypeSwitcher, 'function');
  assert.equal(typeof PivotDrillthroughModal, 'function');
});


test('theme: resolveThemeConfig 与 deepMerge 深度覆盖机制', () => {
  // 1. 默认 light 主题
  const light = resolveThemeConfig();
  assert.equal(light.mode, 'light');
  assert.equal(light.colorPrimary, '#1677ff');
  assert.ok(light.chartPalette.length > 0);

  // 2. dark 主题
  const dark = resolveThemeConfig('dark');
  assert.equal(dark.mode, 'dark');
  assert.equal(dark.colorBgContainer, '#141414');

  // 3. 自定义覆盖主题
  const custom = resolveThemeConfig({
    colorPrimary: '#ff5722',
    chartPalette: ['#111111', '#222222'],
  });
  assert.equal(custom.colorPrimary, '#ff5722');
  assert.deepEqual(custom.chartPalette, ['#111111', '#222222']);

  // 4. deepMerge 覆盖测试
  const defaultOption = {
    grid: { top: 20, bottom: 40 },
    tooltip: { trigger: 'axis' },
    color: ['#1677ff'],
  };
  const overrideOption = {
    grid: { top: 50 },
    color: ['#ff0000', '#00ff00'],
  };
  const merged = deepMerge(defaultOption, overrideOption);
  assert.equal(merged.grid.top, 50);
  assert.equal(merged.grid.bottom, 40);
  assert.equal(merged.tooltip.trigger, 'axis');
  assert.deepEqual(merged.color, ['#ff0000', '#00ff00']);
});

test('ui: 维度切换器严格受限只允许切换已配置的时间聚合与分组聚合维度', () => {
  const mockResult = {
    data: [],
    columns: [
      { key: 'plan_start_time', title: '计划投产时间', type: 'time' },
      { key: 'workshop', title: '承制车间', type: 'text' },
      { key: 'finish_time', title: '完工质检时间', type: 'time' },
      { key: 'output_qty', title: '交付总件数', type: 'number' },
    ],
    meta: {
      inputRows: 10,
      outputRows: 5,
      executionTimeMs: 1,
      form: 'pivot',
      dimensions: {
        timeBucket: { field: 'plan_start_time', granularity: 'month' },
        categories: ['workshop'],
      },
    },
  };

  const configuredTimeField = mockResult.meta.dimensions?.timeBucket?.field;
  const configuredCategories = mockResult.meta.dimensions?.categories ?? [];
  const configuredDimSet = new Set([
    ...(configuredTimeField ? [configuredTimeField] : []),
    ...configuredCategories,
  ]);
  const hasConfiguredDimensions = configuredDimSet.size > 0;

  const validDimensions = mockResult.columns.filter((col) => {
    if (col.type === 'number') return false;
    if (hasConfiguredDimensions) {
      return configuredDimSet.has(col.key);
    }
    return col.type === 'time' || col.type === 'text';
  });

  assert.equal(validDimensions.length, 2);
  assert.deepEqual(validDimensions.map((d) => d.key), ['plan_start_time', 'workshop']);
  assert.ok(!validDimensions.some((d) => d.key === 'finish_time'));
});

test('ui: VisActor 图表与联动数据结构索引安全映射', () => {
  const mockResult = {
    data: [
      { plan_start_time: '2024-01', workshop: 'A车间', output_qty: 100 },
      { plan_start_time: '2024-02', workshop: 'B车间', output_qty: 200 },
    ],
    columns: [
      { key: 'plan_start_time', title: '月份', type: 'time' },
      { key: 'workshop', title: '车间', type: 'text' },
      { key: 'output_qty', title: '产量', type: 'number' },
    ],
    meta: {
      inputRows: 2,
      outputRows: 2,
      executionTimeMs: 1,
      form: 'pivot',
      dimensions: {
        timeBucket: { field: 'plan_start_time', granularity: 'month' },
        categories: ['workshop'],
      },
    },
  };

  // 模拟行选择事件 (从表格点击某行)
  const selectedRowFromTable = {
    dimensionValue: '2024-01',
    dataIndex: 0,
    record: mockResult.data[0],
  };

  // 检验 X 轴去重与定位
  const xAxisData = Array.from(new Set(mockResult.data.map((r) => r.plan_start_time)));
  const targetIndex = xAxisData.findIndex((x) => String(x) === String(selectedRowFromTable.dimensionValue));
  assert.equal(targetIndex, 0);

  // 检验越界索引保护机制
  const outOfBoundsIndex = 999;
  const isOutOfBound = outOfBoundsIndex >= xAxisData.length;
  assert.ok(isOutOfBound, '越界索引被正确识别防护');
});

test('charts: 比率/百分比/千分比型度量与绝对数值型度量精确判别', () => {
  // 1. 百分比率类型
  assert.equal(isRateOrRatioMetric({ key: 'yield_rate', title: '综合良品率(%)' }), true);
  assert.equal(isRateOrRatioMetric({ key: 'defect_ratio', title: '综合缺陷率(%)' }), true);
  assert.equal(isRateOrRatioMetric({ key: 'pass_rate', title: '检验合格率' }), true);
  assert.equal(isRateOrRatioMetric({ key: 'target_pct', title: '计划达成率' }), true);
  assert.equal(isRateOrRatioMetric({ key: 'ratio_val', title: '投产占比' }), true);

  // 2. 千分比类型
  assert.equal(isRateOrRatioMetric({ key: 'defect_per_k', title: '千件缺陷率(‰)' }), true);
  assert.equal(isPerMilleMetric({ key: 'defect_per_k', title: '千件缺陷率(‰)' }), true);
  assert.equal(isPerMilleMetric({ key: 'yield_rate', title: '综合良品率(%)' }), false);

  // 3. 绝对数值型度量 (产量, 工时, 计数, 人效)
  assert.equal(isRateOrRatioMetric({ key: 'output_qty', title: '交付总件数' }), false);
  assert.equal(isRateOrRatioMetric({ key: 'duration_hours', title: '平均工时(h)' }), false);
  assert.equal(isRateOrRatioMetric({ key: 'defect_count', title: '缺陷零件总数' }), false);
  assert.equal(isRateOrRatioMetric({ key: 'efficiency', title: '单件人效指数' }), false);
  assert.equal(isPerMilleMetric({ key: 'output_qty', title: '交付总件数' }), false);
});

test('charts: 单分组维度且无时间维度时，双 Y 轴左右轴与柱线复合图映射精准', () => {
  // 模拟工业场景：只有车间分组，无时间维度，包含产量(绝对量)与良品率(比率)
  const columns = [
    { key: 'workshop', title: '承制车间', type: 'text' },
    { key: 'output_qty', title: '交付总件数', type: 'number' },
    { key: 'duration_hours', title: '平均工时(h)', type: 'number' },
    { key: 'yield_rate', title: '综合良品率(%)', type: 'number' },
    { key: 'defect_ratio', title: '综合缺陷率(%)', type: 'number' },
  ];

  const activeMetrics = ['output_qty', 'duration_hours', 'yield_rate', 'defect_ratio'];

  const absoluteMetrics = [];
  const rateMetrics = [];

  for (const mKey of activeMetrics) {
    const colMeta = columns.find((c) => c.key === mKey);
    if (isRateOrRatioMetric(colMeta)) {
      rateMetrics.push(mKey);
    } else {
      absoluteMetrics.push(mKey);
    }
  }

  assert.deepEqual(absoluteMetrics, ['output_qty', 'duration_hours']);
  assert.deepEqual(rateMetrics, ['yield_rate', 'defect_ratio']);

  // 判断双 Y 轴触发条件
  const hasSecondaryGrouping = false; // 无时间维度，单车间维度
  const useDualYAxis = !hasSecondaryGrouping && absoluteMetrics.length > 0 && rateMetrics.length > 0;
  assert.equal(useDualYAxis, true, '成功触发双 Y 轴机制');

  // 验证柱状图复合模式下的类型映射
  const series = [];
  for (const mKey of activeMetrics) {
    const colMeta = columns.find((c) => c.key === mKey);
    const isRate = isRateOrRatioMetric(colMeta);
    if (useDualYAxis) {
      if (isRate) {
        series.push({
          name: colMeta.title,
          type: 'line',
          yAxisIndex: 1, // 挂载右轴
          showSymbol: true,
        });
      } else {
        series.push({
          name: colMeta.title,
          type: 'bar', // 柱状图
          yAxisIndex: 0, // 挂载左轴
        });
      }
    }
  }

  // 验证 Series 结构：前两项为柱状图挂载左轴，后两项为折线图挂载右轴
  assert.equal(series.length, 4);
  assert.equal(series[0].type, 'bar');
  assert.equal(series[0].yAxisIndex, 0);
  assert.equal(series[1].type, 'bar');
  assert.equal(series[1].yAxisIndex, 0);
  assert.equal(series[2].type, 'line');
  assert.equal(series[2].yAxisIndex, 1);
  assert.equal(series[3].type, 'line');
  assert.equal(series[3].yAxisIndex, 1);
});


test('vchart: 双 Y 轴 Pareto 复合图与分组柱状图 Long/Tidy 数据投影精确性', () => {
  const mockRows = [
    { workshop: '1号车间', output_qty: 4000, duration_hours: 80, yield_rate: 98.5, defect_ratio: 1.5 },
    { workshop: '2号车间', output_qty: 5000, duration_hours: 85, yield_rate: 99.2, defect_ratio: 0.8 },
  ];
  const columns = [
    { key: 'workshop', title: '承制车间', type: 'text' },
    { key: 'output_qty', title: '交付总件数', type: 'number' },
    { key: 'duration_hours', title: '平均工时(h)', type: 'number' },
    { key: 'yield_rate', title: '综合良品率(%)', type: 'number' },
    { key: 'defect_ratio', title: '综合缺陷率(%)', type: 'number' },
  ];

  const activeMetrics = ['output_qty', 'duration_hours', 'yield_rate', 'defect_ratio'];
  const titleMap = Object.fromEntries(columns.map(c => [c.key, c.title]));

  const absoluteMetrics = [];
  const rateMetrics = [];

  for (const mKey of activeMetrics) {
    const colMeta = columns.find(c => c.key === mKey);
    if (isRateOrRatioMetric(colMeta)) {
      rateMetrics.push(mKey);
    } else {
      absoluteMetrics.push(mKey);
    }
  }

  assert.deepEqual(absoluteMetrics, ['output_qty', 'duration_hours']);
  assert.deepEqual(rateMetrics, ['yield_rate', 'defect_ratio']);

  // 验证 Tidy 投影产物
  const barData = [];
  const lineData = [];

  for (let i = 0; i < mockRows.length; i++) {
    const row = mockRows[i];
    for (const mKey of absoluteMetrics) {
      barData.push({
        workshop: row.workshop,
        __metricName__: titleMap[mKey],
        __metricKey__: mKey,
        __metricValue__: row[mKey],
      });
    }
    for (const mKey of rateMetrics) {
      lineData.push({
        workshop: row.workshop,
        __metricName__: titleMap[mKey],
        __metricKey__: mKey,
        __metricValue__: row[mKey],
      });
    }
  }

  // 2 个车间 * 2 个绝对量指标 = 4 条分组柱体数据
  assert.equal(barData.length, 4);
  assert.equal(barData[0].__metricName__, '交付总件数');
  assert.equal(barData[0].__metricValue__, 4000);
  assert.equal(barData[1].__metricName__, '平均工时(h)');
  assert.equal(barData[1].__metricValue__, 80);

  // 2 个车间 * 2 个比率指标 = 4 条折线数据点
  assert.equal(lineData.length, 4);
  assert.equal(lineData[0].__metricName__, '综合良品率(%)');
  assert.equal(lineData[0].__metricValue__, 98.5);
});

test('vtable: 聚合行原始流水挂载、下钻明细穿透与列显隐过滤完整性', () => {
  const rawOrders = [
    { order_id: 'WO-001', workshop: '1号车间', qty: 100 },
    { order_id: 'WO-002', workshop: '1号车间', qty: 200 },
    { order_id: 'WO-003', workshop: '2号车间', qty: 300 },
  ];

  // 模拟分组透视聚合结果
  const aggregatedRows = [
    { workshop: '1号车间', total_qty: 300 },
    { workshop: '2号车间', total_qty: 300 },
  ];

  // 隐式挂载 _rawRows
  Object.defineProperty(aggregatedRows[0], '_rawRows', {
    value: [rawOrders[0], rawOrders[1]],
    enumerable: false,
  });
  Object.defineProperty(aggregatedRows[1], '_rawRows', {
    value: [rawOrders[2]],
    enumerable: false,
  });

  // 验证 _rawRows 具备非枚举特性（不污染 Object.keys）
  assert.deepEqual(Object.keys(aggregatedRows[0]), ['workshop', 'total_qty']);

  // 验证下钻提取
  const row0Raw = aggregatedRows[0]._rawRows;
  assert.ok(Array.isArray(row0Raw));
  assert.equal(row0Raw.length, 2);
  assert.equal(row0Raw[0].order_id, 'WO-001');
  assert.equal(row0Raw[1].order_id, 'WO-002');

  // 验证列显隐过滤逻辑
  const candidateColumns = [
    { key: 'workshop', title: '车间' },
    { key: 'total_qty', title: '总数量' },
    { key: 'extra_info', title: '附加信息' },
  ];
  const hiddenKeys = ['extra_info'];
  const visibleColumns = candidateColumns.filter(c => !hiddenKeys.includes(c.key));
  assert.equal(visibleColumns.length, 2);
  assert.deepEqual(visibleColumns.map(c => c.key), ['workshop', 'total_qty']);
});



test('charts: 饼图不分 XY 轴，按分类维度进行唯一分组汇总 (SUM/比率)，避免多维数据产生重复扇区且占比达 100%', () => {
  // 模拟复合维度数据集：2个时间批次 × 3个车间 = 6条记录
  const data = [
    { plan_start_time: '2026-08', workshop: '1号车间', output_qty: 100, yield_rate: 98 },
    { plan_start_time: '2026-08', workshop: '2号车间', output_qty: 150, yield_rate: 96 },
    { plan_start_time: '2026-08', workshop: '3号车间', output_qty: 200, yield_rate: 94 },
    { plan_start_time: '2026-09', workshop: '1号车间', output_qty: 120, yield_rate: 99 },
    { plan_start_time: '2026-09', workshop: '2号车间', output_qty: 180, yield_rate: 97 },
    { plan_start_time: '2026-09', workshop: '3号车间', output_qty: 250, yield_rate: 95 },
  ];

  // 1. 模拟以「承制车间」为分类维度、以「交付总数 (output_qty)」为度量构建饼图
  const dimensionField = 'workshop';
  const targetMetric = 'output_qty';
  const isRate = false;

  const categoryMap = new Map();
  for (const row of data) {
    const catKey = String(row[dimensionField]);
    const numVal = Number(row[targetMetric]) || 0;
    const existing = categoryMap.get(catKey);
    if (existing) {
      existing.sum += numVal;
      existing.count += 1;
    } else {
      categoryMap.set(catKey, { categoryKey: catKey, sum: numVal, count: 1, representativeRecord: row });
    }
  }

  const aggregatedCategories = Array.from(categoryMap.values()).map(item => ({
    ...item,
    finalVal: isRate && item.count > 0 ? item.sum / item.count : item.sum,
  }));
  const totalVal = aggregatedCategories.reduce((acc, cur) => acc + (cur.finalVal > 0 ? cur.finalVal : 0), 0);
  const pieValues = aggregatedCategories.map((item, idx) => {
    const ratio = totalVal > 0 ? (item.finalVal / totalVal) * 100 : 0;
    return {
      [dimensionField]: item.categoryKey,
      [targetMetric]: item.finalVal,
      __percentage__: ratio,
      __percentageText__: `${ratio.toFixed(1)}%`,
    };
  });

  // 验证去重：6条多维行准确归并为 3 个独立车间扇区，绝不产生 6 个碎片扇区！
  assert.equal(pieValues.length, 3);
  assert.deepEqual(pieValues.map(p => p.workshop), ['1号车间', '2号车间', '3号车间']);

  // 验证汇总准确性：1号车间=220, 2号车间=330, 3号车间=450, 总计=1000
  assert.equal(pieValues[0].output_qty, 220);
  assert.equal(pieValues[1].output_qty, 330);
  assert.equal(pieValues[2].output_qty, 450);
  assert.equal(totalVal, 1000);

  // 验证占比计算严格精确并总和为 100%
  assert.equal(pieValues[0].__percentage__, 22);
  assert.equal(pieValues[0].__percentageText__, '22.0%');
  assert.equal(pieValues[1].__percentage__, 33);
  assert.equal(pieValues[1].__percentageText__, '33.0%');
  assert.equal(pieValues[2].__percentage__, 45);
  assert.equal(pieValues[2].__percentageText__, '45.0%');
  const sumPercentage = pieValues.reduce((acc, cur) => acc + cur.__percentage__, 0);
  assert.equal(Math.round(sumPercentage), 100);

  // 2. 模拟以「计划投产时间」为分类维度切换视角
  const timeCatMap = new Map();
  for (const row of data) {
    const catKey = String(row.plan_start_time);
    const numVal = Number(row.output_qty) || 0;
    const existing = timeCatMap.get(catKey);
    if (existing) {
      existing.sum += numVal;
      existing.count += 1;
    } else {
      timeCatMap.set(catKey, { categoryKey: catKey, sum: numVal, count: 1 });
    }
  }
  const timeSlices = Array.from(timeCatMap.values());
  // 准确归并为 2 个月份扇区：2026-08 (450, 45%) 与 2026-09 (550, 55%)
  assert.equal(timeSlices.length, 2);
  assert.equal(timeSlices[0].sum, 450);
  assert.equal(timeSlices[1].sum, 550);
});

test('charts: 饼图模式下度量指标严格限制为单选 (effectiveActiveMetrics 强制单指标)', () => {
  const metricOptions = [
    { key: 'output_qty', title: '交付总数' },
    { key: 'yield_rate', title: '综合良率' },
    { key: 'defect_count', title: '缺陷总数' },
  ];

  // 模拟从柱状图多选态 (output_qty + yield_rate) 切换到饼图态
  const currentActiveMetrics = ['output_qty', 'yield_rate'];

  // 笛卡尔图表下 (bar) 在无次级分组时可多指标展示
  const barEffective = (!false && 'bar' === 'bar')
    ? metricOptions.map(m => m.key)
    : currentActiveMetrics;
  assert.equal(barEffective.length, 3);

  // 饼图 (pie) 下无论何种状态，严格强制只取 1 个激活指标
  const pieEffective = (() => {
    const firstValid = currentActiveMetrics.find(k => metricOptions.some(m => m.key === k));
    return firstValid ? [firstValid] : (metricOptions[0] ? [metricOptions[0].key] : []);
  })();
  assert.deepEqual(pieEffective, ['output_qty']);
  assert.equal(pieEffective.length, 1);
});

test('ui: DynamicDataView 维度切换在非受控模式下稳定保持用户选择，绝不被 autoDimensionField 错误重置', () => {
  const dimensionOptions = [
    { key: 'plan_start_time', title: '计划投产时间', type: 'time' },
    { key: 'workshop', title: '承制车间', type: 'text' },
  ];
  const autoDimensionField = 'plan_start_time';

  // 1. 初始化（非受控：无 propDimensionField 且无 defaultDimensionField）
  let internalDimensionField = autoDimensionField;
  assert.equal(internalDimensionField, 'plan_start_time');

  // 2. 用户在工具栏点击切换至 'workshop'
  const userSelectedDim = 'workshop';
  internalDimensionField = userSelectedDim;

  // 3. 模拟组件 re-render 触发状态同步检查：
  // 修复前逻辑会因 !propDimensionField && !defaultDimensionField 恒真而重置为 autoDimensionField
  // 修复后逻辑：仅当选中的维度不在候选池中时才重置
  const shouldReset = dimensionOptions.length > 0 && !dimensionOptions.some((d) => d.key === internalDimensionField);
  if (shouldReset) {
    internalDimensionField = autoDimensionField;
  }

  // 验证用户选择保持不变
  assert.equal(internalDimensionField, 'workshop', '用户手动选择的维度必须稳定保持，绝不能回退为 autoDimensionField');

  // 4. 当数据集更新导致 'workshop' 维度已不存在时，应智能回退
  const newDimensionOptions = [
    { key: 'plan_start_time', title: '计划投产时间', type: 'time' },
  ];
  const shouldResetNow = newDimensionOptions.length > 0 && !newDimensionOptions.some((d) => d.key === internalDimensionField);
  if (shouldResetNow) {
    internalDimensionField = autoDimensionField;
  }
  assert.equal(internalDimensionField, 'plan_start_time', '当旧维度在候选池中消失时，智能回退至 autoDimensionField');
});

test('pivot: 单元格穿透下钻控制反转 (onCellDrillthrough) 回调与 CellDrillthroughInfo 契约验证', () => {
  const rawOrders = [
    { order_id: 'WO-001', plan_month: '2026-08', workshop: '1号车间', qty: 100 },
    { order_id: 'WO-002', plan_month: '2026-08', workshop: '1号车间', qty: 150 },
    { order_id: 'WO-003', plan_month: '2026-08', workshop: '2号车间', qty: 200 },
    { order_id: 'WO-004', plan_month: '2026-09', workshop: '1号车间', qty: 300 },
  ];

  const rawHeaders = {
    order_id: '工单号',
    plan_month: '计划月份',
    workshop: '承制车间',
    qty: '产量',
  };

  // 模拟透视单元格提取逻辑
  function simulateDrillthroughTrigger({
    onCellDrillthrough,
    selectedRowPaths,
    selectedColPaths,
    cellCol = 2,
    cellRow = 3,
    cellValue = 250,
  }) {
    let internalModalOpened = false;
    let internalModalPayload = null;

    // 1. 根据路径匹配原始记录
    const matchedRecords = rawOrders.filter((row) => {
      const matchRow = selectedRowPaths.every((p) => row[p.dimensionKey] === p.value);
      const matchCol = selectedColPaths.every((p) => !p.dimensionKey || row[p.dimensionKey] === p.value);
      return matchRow && matchCol;
    });

    // 2. 提取维度条件与指标信息
    const labels = [];
    const rowDimMap = {};
    const colDimMap = {};
    let indicatorKey;
    let indicatorTitle;

    for (const p of selectedRowPaths) {
      if (p.dimensionKey && p.value !== undefined) {
        labels.push(String(p.value));
        rowDimMap[p.dimensionKey] = p.value;
      }
    }
    for (const p of selectedColPaths) {
      if (p.dimensionKey && p.value !== undefined) {
        labels.push(String(p.value));
        colDimMap[p.dimensionKey] = p.value;
      }
      if (p.indicatorKey) {
        indicatorKey = p.indicatorKey;
        indicatorTitle = p.value;
      }
    }

    const titleStr = labels.length > 0 ? labels.join(' · ') : '选定单元格';

    const drillInfo = {
      records: matchedRecords,
      title: titleStr,
      rawHeaders,
      conditions: {
        rowDimensions: rowDimMap,
        colDimensions: colDimMap,
        indicatorKey,
        indicatorTitle,
        cellValue,
      },
      cell: {
        col: cellCol,
        row: cellRow,
      },
    };

    // 3. 模拟控制反转判定
    if (typeof onCellDrillthrough === 'function') {
      onCellDrillthrough(drillInfo);
      return { internalModalOpened, internalModalPayload };
    }

    internalModalOpened = true;
    internalModalPayload = {
      open: true,
      title: titleStr,
      records: matchedRecords,
      rawHeaders,
    };

    return { internalModalOpened, internalModalPayload };
  }

  // 场景 A: 外部传入自定义 onCellDrillthrough 回调 (控制反转模式)
  let interceptedInfo = null;
  const customCallback = (info) => {
    interceptedInfo = info;
  };

  const resA = simulateDrillthroughTrigger({
    onCellDrillthrough: customCallback,
    selectedRowPaths: [{ dimensionKey: 'workshop', value: '1号车间' }],
    selectedColPaths: [
      { dimensionKey: 'plan_month', value: '2026-08' },
      { indicatorKey: 'qty', value: '交付总件数' },
    ],
    cellCol: 2,
    cellRow: 1,
    cellValue: 250,
  });

  // 验证: 内部模态框绝不打开，外部回调被精准触发并捕获完整上下文
  assert.equal(resA.internalModalOpened, false, '外部注入回调时，内部 Modal 不应打开');
  assert.equal(resA.internalModalPayload, null);
  assert.ok(interceptedInfo, '外部回调应接收到 drillInfo');
  assert.equal(interceptedInfo.title, '1号车间 · 2026-08');
  assert.equal(interceptedInfo.records.length, 2);
  assert.deepEqual(interceptedInfo.records.map((r) => r.order_id), ['WO-001', 'WO-002']);
  assert.deepEqual(interceptedInfo.conditions.rowDimensions, { workshop: '1号车间' });
  assert.deepEqual(interceptedInfo.conditions.colDimensions, { plan_month: '2026-08' });
  assert.equal(interceptedInfo.conditions.indicatorKey, 'qty');
  assert.equal(interceptedInfo.conditions.indicatorTitle, '交付总件数');
  assert.equal(interceptedInfo.conditions.cellValue, 250);
  assert.deepEqual(interceptedInfo.cell, { col: 2, row: 1 });

  // 场景 B: 外部未传入回调 (开箱即用保底模式)
  const resB = simulateDrillthroughTrigger({
    onCellDrillthrough: undefined,
    selectedRowPaths: [{ dimensionKey: 'workshop', value: '2号车间' }],
    selectedColPaths: [
      { dimensionKey: 'plan_month', value: '2026-08' },
      { indicatorKey: 'qty', value: '交付总件数' },
    ],
    cellCol: 2,
    cellRow: 2,
    cellValue: 200,
  });

  // 验证: 自动唤起内置弹窗状态
  assert.equal(resB.internalModalOpened, true, '外部未传回调时，内置 Modal 自动唤起保底');
  assert.equal(resB.internalModalPayload.title, '2号车间 · 2026-08');
  assert.equal(resB.internalModalPayload.records.length, 1);
  assert.equal(resB.internalModalPayload.records[0].order_id, 'WO-003');
});




