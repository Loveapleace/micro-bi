/**
 * 度量指标类型推断与判别工具 (metricUtils)
 * - 智能识别比率/百分比/千分比型指标
 * - 为 VChart Pareto 双 Y 轴分流与格式化提供依据
 */

/**
 * 判断指定度量指标是否属于比率/百分比/千分比型度量
 */
export function isRateOrRatioMetric(col: { key: string; title?: string }): boolean {
  const text = `${col.title || ''} ${col.key || ''}`.toLowerCase();
  if (text.includes('%') || text.includes('‰')) {
    return true;
  }
  // 英文特征词（按词或下划线边界匹配，严格避免误匹配 duration 等包含 ratio 子串的单词）
  if (/(?:^|[_ -])(ratio|rate|pct|percent|percentage)(?:[_ -]|$)/i.test(text)) {
    return true;
  }
  return /率|比率|占比|比例|百分比|千分比|达成率|完成率|合格率|良率|缺陷率|不良率/.test(text);
}

/**
 * 判断指定度量指标是否属于千分比(‰)型度量
 */
export function isPerMilleMetric(col: { key: string; title?: string }): boolean {
  const text = `${col.title || ''} ${col.key || ''}`.toLowerCase();
  if (text.includes('‰')) return true;
  return /(?:^|[_ -])(per_k|permille)(?:[_ -]|$)/i.test(text);
}
