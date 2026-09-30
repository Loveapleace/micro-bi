/**
 * 聚合公式工具辅助函数与列类型双向流转器 (Formula & Column Transition Helpers)
 */
import type {
  ColumnConfig,
  FixedColumnConfig,
  AggregatedColumnConfig,
  FieldMeta,
  HeaderMapping,
  AggregationFunction,
  FieldDataType,
} from './types.js';

/**
 * 清除聚合标签中的聚合前缀（如 '求和(销售额)' -> '销售额'，'SUM(sales)' -> 'sales'）
 */
export function cleanAggregatedLabel(label: string | undefined, defaultField: string): string {
  if (!label) return defaultField;
  const cnMatch = label.match(/^(?:求和|平均|最小|最大|计数)\s*\(\s*(.+?)\s*\)$/);
  if (cnMatch && cnMatch[1]) {
    return cnMatch[1].trim();
  }
  const enMatch = label.match(/^(?:SUM|AVG|MIN|MAX|COUNT)\s*\(\s*(.+?)\s*\)$/i);
  if (enMatch && enMatch[1]) {
    return enMatch[1].trim();
  }
  return label;
}

/**
 * 格式化聚合标签（如 '销售额' + 'sum' -> '求和(销售额)'）
 */
export function formatAggregatedLabel(fieldLabel: string, agg: AggregationFunction): string {
  const cnPrefixes: Record<AggregationFunction, string> = {
    sum: '求和',
    avg: '平均',
    min: '最小',
    max: '最大',
    count: '计数',
  };
  const prefix = cnPrefixes[agg] || '求和';
  if (fieldLabel.startsWith(prefix) || fieldLabel.toUpperCase().startsWith(agg.toUpperCase())) {
    return fieldLabel;
  }
  return `${prefix}(${fieldLabel})`;
}

/**
 * 将聚合公式中的宏函数（如 [SUM(x)]、[AVG(x)]）解包还原为字段引用（如 [x]）
 */
export function unwrapAggregateFormulas(expression: string): string {
  if (!expression) return expression;
  // 匹配 [SUM(field)]、[AVG(field)]、[COUNT(field)]、[MIN(field)]、[MAX(field)] (不区分大小写)
  return expression.replace(/\[\s*(?:SUM|AVG|MIN|MAX|COUNT)\s*\(\s*([^)]+?)\s*\)\s*\]/gi, '[$1]');
}

/**
 * 将字段引用包装为聚合宏函数（如 [x] -> [SUM(x)]）
 */
export function wrapAggregateFormulas(
  expression: string,
  numericFields: ReadonlySet<string>
): string {
  if (!expression || numericFields.size === 0) return expression;
  return expression.replace(/\[\s*([^\]]+?)\s*\]/g, (match, fieldName) => {
    const trimmed = fieldName.trim();
    const upper = trimmed.toUpperCase();
    if (
      upper.startsWith('SUM(') ||
      upper.startsWith('AVG(') ||
      upper.startsWith('MIN(') ||
      upper.startsWith('MAX(') ||
      upper.startsWith('COUNT(')
    ) {
      return match;
    }
    if (numericFields.has(trimmed)) {
      return `[SUM(${trimmed})]`;
    }
    return match;
  });
}

/**
 * 将无维度固定原值列集合自动转换为聚合度量列集合
 * - 数字型固定列：转换为 'aggregated' (agg: 'sum')
 * - 非数字型固定列（且未被排除作为维度）：转换为 'aggregated' (agg: 'count')
 * - 动态计算列：公式表达式自动包装为 [SUM(x)]
 */
export function convertColumnsToAggregated(
  columns: readonly ColumnConfig[],
  fields?: readonly FieldMeta[] | undefined,
  options?: {
    readonly headers?: HeaderMapping | undefined;
    readonly excludeFields?: readonly string[] | undefined;
  } | undefined
): ColumnConfig[] {
  const numericFields = new Set<string>();
  const fieldTypeMap = new Map<string, FieldDataType>();
  const fieldLabelMap = new Map<string, string>();

  if (fields) {
    for (const f of fields) {
      fieldTypeMap.set(f.key, f.type);
      fieldLabelMap.set(f.key, f.label || f.key);
      if (f.type === 'number') {
        numericFields.add(f.key);
      }
    }
  }

  const excludeSet = new Set(options?.excludeFields ?? []);

  return columns.map((col) => {
    if (col.type === 'computed') {
      const wrappedExpr = wrapAggregateFormulas(col.expression, numericFields);
      return {
        ...col,
        expression: wrappedExpr,
      };
    }

    if (col.type === 'fixed') {
      // 若该字段已被显式声明为维度（如时间分桶或分组文本），保留 fixed 避免被重复统计
      if (excludeSet.has(col.field)) {
        return col;
      }

      const fType = fieldTypeMap.get(col.field);
      const isNumber = fType === 'number';
      const agg: AggregationFunction = isNumber ? 'sum' : 'count';

      const baseLabel =
        col.label ||
        options?.headers?.[col.field] ||
        fieldLabelMap.get(col.field) ||
        col.field;

      const newLabel = formatAggregatedLabel(baseLabel, agg);

      const aggCol: AggregatedColumnConfig = {
        type: 'aggregated',
        field: col.field,
        agg,
        label: newLabel,
      };
      return aggCol;
    }

    return col;
  });
}

/**
 * 将聚合度量列集合自动转换回固定原值列集合
 * - 聚合度量列：转换为 'fixed'，并自动还原表头标签（去除 '求和(...)' 等聚合前缀）
 * - 动态计算列：公式表达式自动解包（去除 [SUM(x)] 宏）
 */
export function convertColumnsToFixed(
  columns: readonly ColumnConfig[],
  fields?: readonly FieldMeta[] | undefined,
  options?: {
    readonly headers?: HeaderMapping | undefined;
  } | undefined
): ColumnConfig[] {
  const fieldLabelMap = new Map<string, string>();
  if (fields) {
    for (const f of fields) {
      fieldLabelMap.set(f.key, f.label || f.key);
    }
  }

  return columns.map((col) => {
    if (col.type === 'computed') {
      const unwrappedExpr = unwrapAggregateFormulas(col.expression);
      return {
        ...col,
        expression: unwrappedExpr,
      };
    }

    if (col.type === 'aggregated') {
      const defaultLabel =
        options?.headers?.[col.field] ||
        fieldLabelMap.get(col.field) ||
        col.field;

      const cleaned = cleanAggregatedLabel(col.label, defaultLabel);

      const fixedCol: FixedColumnConfig = {
        type: 'fixed',
        field: col.field,
        label: cleaned,
      };
      return fixedCol;
    }

    return col;
  });
}
