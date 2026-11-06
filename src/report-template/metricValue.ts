import type { DataRecord } from '../engine/types.js';
import { evaluateFormula } from '../engine/formula/evaluator.js';
import { roundTo } from '../engine/summary.js';
import type { BusinessFormulaCellContent, FieldCellContent } from './types.js';

/** One aggregation implementation for report values and sort scores; formatting/conditional text never enters it. */
export function aggregateCellField(records: readonly DataRecord[], field: string, operation: string): any {
  if (operation === 'list') return records[0]?.[field] ?? null;
  if (operation === 'count') return records.length;
  if (operation === 'sum') return records.reduce((sum, record) => sum + (Number(record[field]) || 0), 0);
  const values = records.map(record => Number(record[field])).filter(value => !isNaN(value));
  if (!values.length) return null;
  if (operation === 'avg') return values.reduce((sum, value) => sum + value, 0) / values.length;
  if (operation === 'min') return values.reduce((a, b) => Math.min(a, b));
  if (operation === 'max') return values.reduce((a, b) => Math.max(a, b));
  return null;
}

export function evaluateCellMetric(content: FieldCellContent | BusinessFormulaCellContent, records: readonly DataRecord[]): any {
  if (content.kind === 'field') return aggregateCellField(records, content.fieldKey, content.operation);
  const context: Record<string, any> = {};
  for (const match of content.expression.matchAll(/\[([^\]]+)\]/g)) {
    const reference = match[1];
    if (!reference) continue;
    const aggregation = /^(SUM|AVG|MIN|MAX|COUNT)\((.+)\)$/i.exec(reference);
    const field = (aggregation?.[2] || reference).trim();
    const value = aggregateCellField(records, field, aggregation?.[1]?.toLowerCase() || 'sum');
    context[reference] = value;
    if (context[field] === undefined) context[field] = value;
  }
  const value = evaluateFormula(content.expression, context, { nullAsZero: true, divisionByZeroAsNull: true });
  return typeof value === 'number' && Number.isFinite(value)
    ? content.precision !== undefined ? roundTo(value, content.precision) : value : null;
}
