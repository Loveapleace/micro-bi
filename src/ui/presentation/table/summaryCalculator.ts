/**
 * 表格全局总计行智能度量计算模块 (summaryCalculator)
 * 兼容层：逻辑已迁移至 @micro-bi/engine/summary，此处仅作重导出以保持既有调用方兼容。
 */
export {
  collectAggregates,
  roundTo,
  inferColumnAggType,
  computeSummaryValues,
  createPivotAggregationRules,
} from '../../../engine/summary.js';
