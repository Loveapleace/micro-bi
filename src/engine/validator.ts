/**
 * 动态数据转换 DSL 配置合法性校验器 (Transform DSL Validator)
 *
 * 全面校验：
 * 1. JSON 结构合法性与根节点规范
 * 2. 输出列 (columns) 配置契约 (fixed / aggregated / computed)
 * 3. 动态计算列公式表达式的词法与语法 AST 校验
 * 4. 维度切片 (dimensions.timeBucket 与 categories) 配置规范
 * 5. 与当前数据集字段的契约兼容性提示
 */
import type { ValidationIssue, ValidationResult } from '../types.js';
import type {
  DynamicTransformConfig,
  FieldMeta,
} from './types.js';
import { parseFormula, extractReferencedFields } from './formula/parser.js';

export interface ExtendedValidationIssue extends ValidationIssue {
  readonly severity?: 'error' | 'warning' | undefined;
}

export interface ConfigValidationResult extends ValidationResult {
  readonly valid: boolean;
  readonly issues: readonly ExtendedValidationIssue[];
  readonly parsedConfig?: DynamicTransformConfig | undefined;
}

const VALID_COLUMN_TYPES = new Set(['fixed', 'aggregated', 'computed']);
const VALID_AGG_FUNCTIONS = new Set(['sum', 'avg', 'min', 'max', 'count']);
const VALID_GRANULARITIES = new Set([
  'hour',
  'day',
  'week',
  'month',
  'quarter',
  'year',
  'custom',
]);
const VALID_FIELD_TYPES = new Set(['number', 'text', 'time']);

/**
 * 校验 DSL 转换配置的完整性与合法性
 *
 * @param rawInput 待校验的对象或 JSON 字符串
 * @param availableFields 当前数据源中的有效字段元信息列表 (可选，用于兼容性对比)
 */
export function validateTransformConfig(
  rawInput: unknown,
  availableFields?: readonly FieldMeta[] | undefined
): ConfigValidationResult {
  const issues: ExtendedValidationIssue[] = [];
  let parsed: any = rawInput;

  // 1. 如果传入的是字符串，尝试 JSON 反序列化
  if (typeof rawInput === 'string') {
    const trimmed = rawInput.trim();
    if (!trimmed) {
      return {
        valid: false,
        issues: [
          {
            path: 'root',
            message: '配置内容不能为空',
            severity: 'error',
          },
        ],
      };
    }
    try {
      parsed = JSON.parse(trimmed);
    } catch (err: any) {
      return {
        valid: false,
        issues: [
          {
            path: 'json',
            message: `JSON 语法解析失败: ${err?.message || '格式不合法'}`,
            severity: 'error',
          },
        ],
      };
    }
  }

  // 2. 根对象合法性校验
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return {
      valid: false,
      issues: [
        {
          path: 'root',
          message: '配置根节点必须是有效的 JSON 对象',
          severity: 'error',
        },
      ],
    };
  }

  const availableFieldMap = availableFields
    ? new Map(availableFields.map((f) => [f.key, f]))
    : null;

  // 3. columns 列列表校验 (必选字段)
  if (!('columns' in parsed)) {
    issues.push({
      path: 'columns',
      message: '缺少必需的 "columns" 输出列配置列表',
      severity: 'error',
    });
  } else if (!Array.isArray(parsed.columns)) {
    issues.push({
      path: 'columns',
      message: '"columns" 必须为数组',
      severity: 'error',
    });
  } else if (parsed.columns.length === 0) {
    issues.push({
      path: 'columns',
      message: '"columns" 列配置列表不能为空，至少需包含一列',
      severity: 'warning',
    });
  } else {
    parsed.columns.forEach((col: any, index: number) => {
      const colPath = `columns[${index}]`;
      if (typeof col !== 'object' || col === null || Array.isArray(col)) {
        issues.push({
          path: colPath,
          message: `列配置必须是有效对象`,
          severity: 'error',
        });
        return;
      }

      if (!VALID_COLUMN_TYPES.has(col.type)) {
        issues.push({
          path: `${colPath}.type`,
          message: `未知列类型 "${col.type}"，必须为 fixed、aggregated 或 computed`,
          severity: 'error',
        });
        return;
      }

      // (1) fixed 固定原值列
      if (col.type === 'fixed') {
        if (!col.field || typeof col.field !== 'string') {
          issues.push({
            path: `${colPath}.field`,
            message: `固定列必须指定目标字段名 field`,
            severity: 'error',
          });
        } else if (availableFieldMap && !availableFieldMap.has(col.field)) {
          issues.push({
            path: `${colPath}.field`,
            message: `字段 "${col.field}" 在当前数据集中不存在，可能影响取值`,
            severity: 'warning',
          });
        }
      }

      // (2) aggregated 聚合度量列
      if (col.type === 'aggregated') {
        if (!col.field || typeof col.field !== 'string') {
          issues.push({
            path: `${colPath}.field`,
            message: `聚合度量列必须指定目标字段名 field`,
            severity: 'error',
          });
        } else if (availableFieldMap && !availableFieldMap.has(col.field)) {
          issues.push({
            path: `${colPath}.field`,
            message: `聚合字段 "${col.field}" 在当前数据集中不存在`,
            severity: 'warning',
          });
        }

        if (!col.agg || !VALID_AGG_FUNCTIONS.has(col.agg)) {
          issues.push({
            path: `${colPath}.agg`,
            message: `聚合函数 "${col.agg}" 无效，支持的值为 sum, avg, min, max, count`,
            severity: 'error',
          });
        }
      }

      // (3) computed 动态计算列
      if (col.type === 'computed') {
        if (!col.name || typeof col.name !== 'string') {
          issues.push({
            path: `${colPath}.name`,
            message: `计算列必须指定唯一标识名称 name`,
            severity: 'error',
          });
        }
        if (!col.expression || typeof col.expression !== 'string' || !col.expression.trim()) {
          issues.push({
            path: `${colPath}.expression`,
            message: `计算列 "${col.name || index}" 必须提供公式表达式 expression`,
            severity: 'error',
          });
        } else {
          // 公式语法 AST 校验与引用字段检查
          try {
            const ast = parseFormula(col.expression);
            if (availableFieldMap) {
              const refFields = extractReferencedFields(ast);
              for (const ref of refFields) {
                // 排除聚合宏包装
                const cleanRef = ref.replace(/^(?:SUM|AVG|MIN|MAX|COUNT)\s*\((.+)\)$/i, '$1').trim();
                if (!availableFieldMap.has(cleanRef) && !availableFieldMap.has(ref)) {
                  issues.push({
                    path: `${colPath}.expression`,
                    message: `计算列 "${col.name || index}" 引用的字段 "${ref}" 在当前数据集中不存在`,
                    severity: 'warning',
                  });
                }
              }
            }
          } catch (err: any) {
            issues.push({
              path: `${colPath}.expression`,
              message: `计算列 "${col.name || index}" ${err.message || '公式语法错误'}`,
              severity: 'error',
            });
          }
        }

        if (col.precision !== undefined && col.precision !== null) {
          if (
            typeof col.precision !== 'number' ||
            col.precision < 0 ||
            !Number.isInteger(col.precision)
          ) {
            issues.push({
              path: `${colPath}.precision`,
              message: `计算列 "${col.name || index}" 小数精度 precision 必须是非负整数`,
              severity: 'error',
            });
          }
        }
      }
    });
  }

  // 4. dimensions 维度切片校验 (可选字段)
  if (parsed.dimensions !== undefined && parsed.dimensions !== null) {
    if (typeof parsed.dimensions !== 'object' || Array.isArray(parsed.dimensions)) {
      issues.push({
        path: 'dimensions',
        message: '"dimensions" 必须为对象',
        severity: 'error',
      });
    } else {
      const { timeBucket, categories } = parsed.dimensions;

      // timeBucket 校验
      if (timeBucket !== undefined && timeBucket !== null) {
        if (typeof timeBucket !== 'object' || Array.isArray(timeBucket)) {
          issues.push({
            path: 'dimensions.timeBucket',
            message: '"timeBucket" 必须为对象',
            severity: 'error',
          });
        } else {
          if (!timeBucket.field || typeof timeBucket.field !== 'string') {
            issues.push({
              path: 'dimensions.timeBucket.field',
              message: '时间分桶必须指定目标时间字段 field',
              severity: 'error',
            });
          } else if (availableFieldMap && !availableFieldMap.has(timeBucket.field)) {
            issues.push({
              path: 'dimensions.timeBucket.field',
              message: `时间分桶字段 "${timeBucket.field}" 在当前数据集中不存在`,
              severity: 'warning',
            });
          }

          if (!timeBucket.granularity || !VALID_GRANULARITIES.has(timeBucket.granularity)) {
            issues.push({
              path: 'dimensions.timeBucket.granularity',
              message: `时间粒度 "${timeBucket.granularity}" 无效，支持的值为 hour, day, week, month, quarter, year, custom`,
              severity: 'error',
            });
          }
        }
      }

      // categories 校验
      if (categories !== undefined && categories !== null) {
        if (!Array.isArray(categories)) {
          issues.push({
            path: 'dimensions.categories',
            message: '"categories" 必须为字符串数组',
            severity: 'error',
          });
        } else {
          categories.forEach((cat: any, cIdx: number) => {
            if (typeof cat !== 'string' || !cat.trim()) {
              issues.push({
                path: `dimensions.categories[${cIdx}]`,
                message: `分类维度必须为非空字符串`,
                severity: 'error',
              });
            } else if (availableFieldMap && !availableFieldMap.has(cat)) {
              issues.push({
                path: `dimensions.categories[${cIdx}]`,
                message: `分类维度 "${cat}" 在当前数据集中不存在`,
                severity: 'warning',
              });
            }
          });
        }
      }

      // columnTimeBucket 列透视时间分桶校验
      const columnTimeBucket = parsed.dimensions.columnTimeBucket;
      if (columnTimeBucket !== undefined && columnTimeBucket !== null) {
        if (typeof columnTimeBucket !== 'object' || Array.isArray(columnTimeBucket)) {
          issues.push({
            path: 'dimensions.columnTimeBucket',
            message: '"columnTimeBucket" 必须为对象',
            severity: 'error',
          });
        } else {
          if (!columnTimeBucket.field || typeof columnTimeBucket.field !== 'string') {
            issues.push({
              path: 'dimensions.columnTimeBucket.field',
              message: '列时间分桶必须指定目标时间字段 field',
              severity: 'error',
            });
          } else if (availableFieldMap && !availableFieldMap.has(columnTimeBucket.field)) {
            issues.push({
              path: 'dimensions.columnTimeBucket.field',
              message: `列时间分桶字段 "${columnTimeBucket.field}" 在当前数据集中不存在`,
              severity: 'warning',
            });
          }

          if (!columnTimeBucket.granularity || !VALID_GRANULARITIES.has(columnTimeBucket.granularity)) {
            issues.push({
              path: 'dimensions.columnTimeBucket.granularity',
              message: `列时间粒度 "${columnTimeBucket.granularity}" 无效，支持的值为 hour, day, week, month, quarter, year, custom`,
              severity: 'error',
            });
          }
        }
      }

      // columnCategories 列透视分类维度校验
      const columnCategories = parsed.dimensions.columnCategories;
      if (columnCategories !== undefined && columnCategories !== null) {
        if (!Array.isArray(columnCategories)) {
          issues.push({
            path: 'dimensions.columnCategories',
            message: '"columnCategories" 必须为字符串数组',
            severity: 'error',
          });
        } else {
          columnCategories.forEach((cat: any, cIdx: number) => {
            if (typeof cat !== 'string' || !cat.trim()) {
              issues.push({
                path: `dimensions.columnCategories[${cIdx}]`,
                message: `列分类维度必须为非空字符串`,
                severity: 'error',
              });
            } else if (availableFieldMap && !availableFieldMap.has(cat)) {
              issues.push({
                path: `dimensions.columnCategories[${cIdx}]`,
                message: `列分类维度 "${cat}" 在当前数据集中不存在`,
                severity: 'warning',
              });
            }
          });
        }
      }

      // indicatorsAsCol 校验
      const indicatorsAsCol = parsed.dimensions.indicatorsAsCol;
      if (indicatorsAsCol !== undefined && indicatorsAsCol !== null && typeof indicatorsAsCol !== 'boolean') {
        issues.push({
          path: 'dimensions.indicatorsAsCol',
          message: '"indicatorsAsCol" 必须为布尔值',
          severity: 'error',
        });
      }
    }
  }

  // 5. fields 字段类型覆盖校验 (可选字段)
  if (parsed.fields !== undefined && parsed.fields !== null) {
    if (typeof parsed.fields !== 'object' || Array.isArray(parsed.fields)) {
      issues.push({
        path: 'fields',
        message: '"fields" 必须为字典对象',
        severity: 'error',
      });
    } else {
      for (const [fKey, fType] of Object.entries(parsed.fields)) {
        if (!VALID_FIELD_TYPES.has(fType as string)) {
          issues.push({
            path: `fields.${fKey}`,
            message: `字段类型覆盖 "${fType}" 无效，仅支持 number, text, time`,
            severity: 'error',
          });
        }
      }
    }
  }

  const hasErrors = issues.some((i) => i.severity === 'error');

  return {
    valid: !hasErrors,
    issues,
    parsedConfig: !hasErrors ? (parsed as DynamicTransformConfig) : undefined,
  };
}
