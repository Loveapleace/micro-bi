import type { CellDefinition, CellFormatOptions, CellMergePolicyKind, CellTemplateDocumentV1, CellDataOperation } from './types.js';
import type { BiGridModel } from '../report/types.js';
import type { ConditionOperator, RuleOperand, RuleValueType } from './presentationTypes.js';
import { isEditableGeneratedText } from './guidedSource.js';

export interface CapabilityField { key: string; label?: string; type?: string | undefined; sample?: unknown }
export type AdvancedCellRole = 'dimension' | 'time-dimension' | 'measure' | 'formula' | 'detail' | 'static' | 'header' | 'total';
export type AdvancedCellTab = 'settings' | 'content' | 'rules' | 'merge';
export interface CellCapabilities {
  role: AdvancedCellRole;
  label: string;
  valueType: RuleValueType;
  fieldKey?: string | undefined;
  formatKeys: (keyof CellFormatOptions)[];
  /** 高级配置只编辑业务显示属性；普通数字/日期格式归Excel工具栏。 */
  advancedFormatKeys: (keyof CellFormatOptions)[];
  numericFormats: string[];
  canEditLiteral: boolean;
  canFollowRange: boolean;
  canEditAggregation: boolean;
  aggregations: CellDataOperation[];
  mergePolicies: CellMergePolicyKind[];
  canTargetField: boolean;
  canEditConditions: boolean;
  canStyleRow: boolean;
  tabs: {key:AdvancedCellTab;label:string}[];
}
export interface CapabilityContext {
  fields?: readonly CapabilityField[] | undefined;
  grid?: BiGridModel | undefined;
  contentReadOnly?: boolean | undefined;
}
export function metricAggregations(type: RuleValueType): CellDataOperation[] {
  return ['text','date','boolean'].includes(type)?['count']:['sum','avg','count','min','max'];
}

/** 空白源格没有高级配置对象；有绑定/公式但当前无结果的格子仍可配置。 */
export function canOpenCellAdvancedSettings(cell: CellDefinition | null | undefined): cell is CellDefinition {
  if (!cell) return false;
  if (isEditableGeneratedText(cell)) return false;
  const content = cell.content;
  if (content.kind === 'literal') return content.value !== null && content.value !== undefined && String(content.value).trim() !== '';
  if (content.kind === 'sheet-formula') return content.formula.trim() !== '';
  if (content.kind === 'business-formula') return content.expression.trim() !== '';
  return true;
}

/** 角色来自绑定和生成归属，值类型来自字段/实际结果；数字维度不自动成为指标。 */
export function getCellCapabilities(cell: CellDefinition, context: CapabilityContext = {}): CellCapabilities {
  const c = cell.content;
  const field = c.kind === 'field' ? context.fields?.find(f => f.key === c.fieldKey) : undefined;
  const sample = context.grid?.cells.find(g => g.sourceCellId === cell.id && g.value !== null && g.value !== undefined)?.value;
  let role: AdvancedCellRole;
  if (cell.id.startsWith('meas-rowtotal-') || c.kind === 'field' && c.role === 'total') role = 'total';
  else if (c.kind === 'business-formula' || c.kind === 'sheet-formula') role = 'formula';
  else if (c.kind === 'field') role = c.role.endsWith('dimension') ? c.timeBucket ? 'time-dimension' : 'dimension' : c.role === 'measure' ? 'measure' : 'detail';
  else role = cell.panelOwner && cell.id !== 'title' || context.contentReadOnly ? 'header' : 'static';
  const rawType = fieldValueType(field?.type, field?.sample);
  const valueType: RuleValueType = role === 'header' ? 'text' : role === 'time-dimension' ? 'date'
    : role === 'measure' || role === 'total' || c.kind === 'business-formula' ? 'number'
    : c.kind === 'literal' ? fieldValueType(undefined, c.value)
    : c.kind === 'sheet-formula' ? fieldValueType(undefined, sample)
    : rawType !== 'unknown' ? rawType : fieldValueType(undefined, sample);
  const isNumber = valueType === 'number';
  const businessCell=role!=='static'&&role!=='header';
  const formatKeys: (keyof CellFormatOptions)[] = businessCell ? ['emptyDisplay'] : [];
  if (isNumber && role !== 'static') formatKeys.push('numberFormat','format', 'precision', 'useGrouping', 'zeroDisplay', 'negativeFormat', 'prefix', 'suffix');
  if (isNumber && role !== 'dimension' && role !== 'static') formatKeys.push('scale');
  if (valueType === 'date' && role !== 'static') formatKeys.push('numberFormat','dateFormat');
  const aggregations = metricAggregations(rawType);
  const labels: Record<AdvancedCellRole, string> = { dimension: '分类维度', 'time-dimension': '时间维度', measure: '数值指标', formula: '公式结果', detail: '明细列', static: '静态内容', header: '生成表头', total: '总计 / 小计' };
  const mergePolicies:CellMergePolicyKind[]=['dimension', 'time-dimension'].includes(role) ? ['default', 'group-span', 'adjacent-equal', 'none']
    : ['measure', 'detail', 'total'].includes(role) ? ['default', 'adjacent-equal', 'none'] : [];
  const settingsLabels:Record<AdvancedCellRole,string>={dimension:'维度设置','time-dimension':'维度设置',measure:'指标设置',formula:'结果设置',detail:'明细设置',total:'汇总设置',static:'内容',header:'表头'};
  const tabs:CellCapabilities['tabs']=role==='static'?[{key:'content',label:'内容'},{key:'merge',label:'合并与范围'}]
    :role==='header'?[]:[
      {key:'settings',label:settingsLabels[role]},{key:'rules',label:'条件规则'},
      ...(mergePolicies.length?[{key:'merge' as const,label:'动态合并'}]:[]),
    ];
  return {
    role, label: labels[role], valueType, fieldKey: c.kind === 'field' ? c.fieldKey : undefined,
    formatKeys, advancedFormatKeys:businessCell?formatKeys.filter(k=>k==='emptyDisplay'||k==='scale'):[],
    numericFormats: isNumber && role !== 'static' ? role === 'dimension' ? ['number', 'decimal2', 'integer'] : ['number', 'decimal2', 'integer', 'percent', 'currency'] : [],
    canEditLiteral: role === 'static' && !context.contentReadOnly,
    canFollowRange: role === 'static' && c.kind === 'literal' && !context.contentReadOnly,
    canEditAggregation: role === 'measure', aggregations,
    mergePolicies,
    canTargetField: c.kind === 'field',
    canEditConditions:businessCell,canStyleRow:businessCell,tabs,
  };
}

export function fieldValueType(type?: string, sample?: unknown): RuleValueType {
  if (type && ['number', 'integer', 'float', 'decimal'].includes(type)) return 'number';
  if (type && ['date', 'time', 'datetime'].includes(type)) return 'date';
  if (type === 'boolean') return 'boolean';
  if (type && ['string', 'text'].includes(type)) return 'text';
  if (typeof sample === 'number' && Number.isFinite(sample)) return 'number';
  if (typeof sample === 'boolean') return 'boolean';
  if (sample instanceof Date) return 'date';
  if (typeof sample === 'string') return /^\d{4}[-/]\d{2}(?:[-/]\d{2})?(?:\b|T)/.test(sample) && dateComparable(sample) !== undefined ? 'date' : 'text';
  return 'unknown';
}

export function getOperandValueType(operand: RuleOperand, cell: CellDefinition, doc: CellTemplateDocumentV1, context: CapabilityContext = {}): RuleValueType {
  if (operand.kind === 'current') return operand.basis === 'text' ? 'text' : operand.basis === 'display-number' ? 'number' : getCellCapabilities(cell, context).valueType;
  if (operand.kind === 'literal') return operand.valueType === 'date' ? 'date' : fieldValueType(undefined, operand.value);
  if (operand.kind === 'metric') {
    const target = doc.cells.find(c => (c.content as any).metricId === operand.metricId);
    return target ? getCellCapabilities(target, context).valueType : 'unknown';
  }
  if (operand.agg) return 'number';
  const field = context.fields?.find(f => f.key === operand.field);
  const declared = fieldValueType(field?.type, field?.sample);
  if (declared !== 'unknown') return declared;
  const target = doc.cells.find(c => c.content.kind === 'field' && c.content.fieldKey === operand.field && c.content.timeBucket);
  return target ? 'date' : 'unknown';
}

export function conditionOperators(type: RuleValueType): ConditionOperator[] {
  const common: ConditionOperator[] = ['eq', 'ne', 'in', 'notIn', 'empty', 'notEmpty'];
  return type === 'number' || type === 'date' ? ['lt', 'lte', 'gt', 'gte', 'between', ...common]
    : type === 'text' ? [...common, 'contains', 'startsWith', 'endsWith'] : common;
}

/** 日历文字按UTC坐标比较，避免Node和浏览器时区差异；桶标签取周期起点。 */
export function dateComparable(value: unknown): number | undefined {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : undefined;
  if (typeof value !== 'string') return undefined;
  let text = value.trim().split(' ~ ')[0]!.replace(/ \(第\d+周\)$/, '');
  const quarter = /^(\d{4})-Q([1-4])$/.exec(text);
  if (quarter) text = `${quarter[1]}-${String((Number(quarter[2]) - 1) * 3 + 1).padStart(2, '0')}-01`;
  if (/^\d{4}$/.test(text)) text += '-01-01';
  if (/^\d{4}-\d{2}$/.test(text)) text += '-01';
  const match = /^(\d{4})[-/](\d{2})[-/](\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:?\d{2})?)?$/.exec(text);
  if (!match) return undefined;
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(n => Number(n || 0));
  const calendar = new Date(Date.UTC(year!, month! - 1, day!));
  if (calendar.getUTCFullYear() !== year || calendar.getUTCMonth() + 1 !== month || calendar.getUTCDate() !== day || hour! > 23 || minute! > 59 || second! > 59) return undefined;
  const normalized = `${match[1]}-${match[2]}-${match[3]}T${match[4] || '00'}:${match[5] || '00'}:${match[6] || '00'}${match[7] ? '.' + match[7] : ''}${match[8] || 'Z'}`;
  const result = Date.parse(normalized);
  return Number.isFinite(result) ? result : undefined;
}
