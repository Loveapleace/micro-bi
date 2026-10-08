import test from 'node:test';
import assert from 'node:assert/strict';
import {
  scoreFieldForRole,
  matchSlot,
  inferSlotsForTemplate,
  buildTransformConfigFromSlots,
} from '../dist/esm/engine/slotMatcher.js';

test('slotMatcher: 能够识别典型业务字段的语义角色与置信度', () => {
  const workshopField = { key: 'workshop', label: '承制车间', type: 'text', detectedType: 'text', sampleValues: ['一车间', '二车间'] };
  const orderIdField = { key: 'order_id', label: '工单流水号', type: 'text', detectedType: 'text', sampleValues: ['ORD-001', 'ORD-002'] };
  const dateField = { key: 'plan_start_time', label: '计划投产时间', type: 'time', detectedType: 'time' };
  const qtyField = { key: 'output_qty', label: '交付总件数', type: 'number', detectedType: 'number' };
  const rateField = { key: 'yield_rate', label: '综合良品率(%)', type: 'number', detectedType: 'number' };

  // 1. 车间应高分匹配 entity_category，而工单流水号因惩罚项匹配分很低
  const shopScore = scoreFieldForRole(workshopField, 'entity_category');
  const idScore = scoreFieldForRole(orderIdField, 'entity_category');
  assert.ok(shopScore >= 80, `车间得分应较高, 实际: ${shopScore}`);
  assert.ok(idScore < 50, `流水号得分应较低, 实际: ${idScore}`);

  // 2. 时间匹配
  const timeScore = scoreFieldForRole(dateField, 'time');
  assert.ok(timeScore >= 90, `计划时间得分应极高, 实际: ${timeScore}`);

  // 3. 体量度量与比率度量区分
  const qtyVolScore = scoreFieldForRole(qtyField, 'volume_metric');
  const qtyRatioScore = scoreFieldForRole(qtyField, 'ratio_metric');
  assert.ok(qtyVolScore > qtyRatioScore, '件数应优先匹配体量度量');

  const rateRatioScore = scoreFieldForRole(rateField, 'ratio_metric');
  const rateVolScore = scoreFieldForRole(rateField, 'volume_metric');
  assert.ok(rateRatioScore > rateVolScore, '良率应优先匹配比率度量');
});

test('slotMatcher: matchSlot 自动选出最高置信度候选字段', () => {
  const fields = [
    { key: 'order_no', label: '工单号', type: 'text', detectedType: 'text' },
    { key: 'workshop', label: '承制车间', type: 'text', detectedType: 'text', sampleValues: ['A', 'B'] },
    { key: 'dept_name', label: '生产部门', type: 'text', detectedType: 'text', sampleValues: ['D1', 'D2'] },
  ];

  const result = matchSlot('row_entity', 'entity_category', '分析主体', fields);
  assert.ok(result.matchedField === 'workshop' || result.matchedField === 'dept_name', '应选出车间或部门');
  assert.notEqual(result.matchedField, 'order_no', '绝不能选工单号');
  assert.ok(result.confidence > 70);
});

test('slotMatcher: inferSlotsForTemplate 为月度趋势透视模板推断完整槽位', () => {
  const fields = [
    { key: 'order_id', label: '工单流水号', type: 'text', detectedType: 'text' },
    { key: 'workshop', label: '承制车间', type: 'text', detectedType: 'text', sampleValues: ['A', 'B'] },
    { key: 'plan_start_time', label: '计划投产时间', type: 'time', detectedType: 'time' },
    { key: 'output_qty', label: '交付总件数', type: 'number', detectedType: 'number' },
    { key: 'yield_rate', label: '综合良品率(%)', type: 'number', detectedType: 'number' },
    { key: 'defect_count', label: '缺陷数', type: 'number', detectedType: 'number' },
  ];

  const inferred = inferSlotsForTemplate('pivot_trend', fields);
  assert.equal(inferred.rowEntitySlot.matchedField, 'workshop');
  assert.equal(inferred.colTimeSlot.matchedField, 'plan_start_time');
  assert.equal(inferred.indicatorsAsCol, true);
  assert.ok(inferred.metricsSlots.length >= 2);

  // 生成 DSL 配置
  const config = buildTransformConfigFromSlots('pivot_trend', {
    rowEntityKey: inferred.rowEntitySlot.matchedField,
    colTimeKey: inferred.colTimeSlot.matchedField,
    colTimeGranularity: 'month',
    metricKeys: inferred.metricsSlots.map(s => s.matchedField).filter(Boolean),
  }, fields);

  assert.deepEqual(config.dimensions?.categories, ['workshop']);
  assert.equal(config.dimensions?.columnTimeBucket?.field, 'plan_start_time');
  assert.equal(config.dimensions?.columnTimeBucket?.granularity, 'month');
  assert.equal(config.dimensions?.indicatorsAsCol, true);
  assert.equal(config.dimensions?.rowTotals?.showGrandTotals, true);
  assert.equal(config.dimensions?.columnTotals?.showGrandTotals, true);
});

test('slotMatcher: 多指标体检透视模板默认纵向行展开 (indicatorsAsCol: false)', () => {
  const fields = [
    { key: 'workshop', label: '承制车间', type: 'text', detectedType: 'text' },
    { key: 'plan_start_time', label: '计划投产时间', type: 'time', detectedType: 'time' },
    { key: 'output_qty', label: '交付总件数', type: 'number', detectedType: 'number' },
    { key: 'yield_rate', label: '综合良品率(%)', type: 'number', detectedType: 'number' },
    { key: 'defect_count', label: '缺陷数', type: 'number', detectedType: 'number' },
  ];

  const inferred = inferSlotsForTemplate('pivot_multi_metric', fields);
  assert.equal(inferred.indicatorsAsCol, false);

  const config = buildTransformConfigFromSlots('pivot_multi_metric', {
    rowEntityKey: inferred.rowEntitySlot.matchedField,
    colTimeKey: inferred.colTimeSlot.matchedField,
    colTimeGranularity: 'month',
    metricKeys: inferred.metricsSlots.map(s => s.matchedField).filter(Boolean),
    indicatorsAsCol: false,
  }, fields);

  assert.equal(config.dimensions?.indicatorsAsCol, false);
});
