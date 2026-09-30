/**
 * 动态数据转换引擎核心类型定义。
 */
import type { DataRecord } from '../types.js';
export type { DataRecord };

/** 基础字段数据类型：时间、数字、文本 */
export type FieldDataType = 'time' | 'number' | 'text';

/** 字段表头映射字典：键名到业务人类可读表头展示名的映射 */
export type HeaderMapping = Readonly<Record<string, string>>;

/** 标准字段元数据模式 */
export interface FieldSchema {
  /** 字段在原始记录中的键名 */
  readonly key: string;
  /** 表头显示名称 */
  readonly label: string;
  /** 字段物理类型（可选，若未指定则通过算法自动探测） */
  readonly type?: FieldDataType | undefined;
}

/** 字段探查元数据信息 */
export interface FieldMeta {
  readonly key: string;
  readonly label: string;
  /** 最终生效的类型（若用户纠偏则为纠偏后类型） */
  readonly type: FieldDataType;
  /** 算法自动探测识别出的类型 */
  readonly detectedType: FieldDataType;
  /** 样本值列表（供 UI 展示提示） */
  readonly sampleValues?: readonly unknown[] | undefined;
}


/** 时间切片粒度 */
export type TimeGranularity = 'hour' | 'day' | 'week' | 'month' | 'quarter' | 'year' | 'custom';

/** 时间分桶聚合配置 */
export interface TimeBucketConfig {
  /** 目标时间字段键名 */
  readonly field: string;
  /** 分桶粒度 */
  readonly granularity: TimeGranularity;
  /** 自定义天数间隔（当 granularity 为 'custom' 时有效，默认 1） */
  readonly customIntervalDays?: number | undefined;
  /** 输出格式化掩码（如 'YYYY-MM-DD'、'YYYY-MM'） */
  readonly format?: string | undefined;
  /** 周起始日（0: 周日, 1: 周一，默认 1） */
  readonly weekStartsOn?: 0 | 1 | undefined;
}

/** 维度总计/小计展示配置 */
export interface DimensionTotalsConfig {
  /** 是否展示总计 (默认开启) */
  readonly showGrandTotals?: boolean | undefined;
  /** 是否展示层级小计 (多级维度时生效，默认关闭) */
  readonly showSubTotals?: boolean | undefined;
  /** 总计标签文本 (默认 "总计") */
  readonly grandTotalLabel?: string | undefined;
  /** 小计标签文本 (默认 "小计") */
  readonly subTotalLabel?: string | undefined;
}

/** 维度切片配置（支持单向行分组及双向交叉多维透视） */
export interface DimensionConfig {
  /** 行维度文本分组列表（向下展开），如 ['workshop', 'line'] */
  readonly categories?: readonly string[] | undefined;
  /** 行维度时间切片配置（向下展开） */
  readonly timeBucket?: TimeBucketConfig | undefined;
  /** 透视列维度文本分组列表（横向透视展开），如 ['status', 'quarter'] */
  readonly columnCategories?: readonly string[] | undefined;
  /** 透视列维度时间切片配置（横向透视展开） */
  readonly columnTimeBucket?: TimeBucketConfig | undefined;
  /** 指标排布方向：true 为指标平铺在列维度下方（横向展开，默认），false 为指标平铺在行维度下方（纵向展开） */
  readonly indicatorsAsCol?: boolean | undefined;
  /** 行总计/小计展示配置 */
  readonly rowTotals?: DimensionTotalsConfig | undefined;
  /** 列总计/小计展示配置 */
  readonly columnTotals?: DimensionTotalsConfig | undefined;
}

/** 基础聚合函数 */
export type AggregationFunction = 'sum' | 'avg' | 'min' | 'max' | 'count';

/** 固定原值列配置 */
export interface FixedColumnConfig {
  readonly type: 'fixed';
  /** 原数据字段名 */
  readonly field: string;
  /** 表头重命名（可选，默认同 field） */
  readonly label?: string | undefined;
}

/** 聚合度量列配置 */
export interface AggregatedColumnConfig {
  readonly type: 'aggregated';
  /** 目标度量字段名 */
  readonly field: string;
  /** 聚合方式 */
  readonly agg: AggregationFunction;
  /** 表头重命名（可选，默认如 '求和(销售额)'） */
  readonly label?: string | undefined;
}

/** 动态计算列配置 */
export interface ComputedColumnConfig {
  readonly type: 'computed';
  /** 动态列唯一标识键名 */
  readonly name: string;
  /** 表头显示名称 */
  readonly label: string;
  /**
   * 公式表达式。
   * 支持引用字段如 `[sales] - [cost]`、`IF([sales] > 1000, 'VIP', '普通')`、`[SUM(sales)] / [COUNT(id)]`。
   */
  readonly expression: string;
  /**
   * 计算阶段范围：
   * - 'row': 阶段 1 行级增强（在原始明细上执行）
   * - 'summary': 阶段 3 汇总后增强（在聚合结果上执行复合公式）
   * - 'auto': 自动推断（若引用了 SUM/AVG 等聚合函数或在 aggregate 模式则默认为 summary）
   */
  readonly scope?: 'row' | 'summary' | 'auto' | undefined;
  /** 数值结果保留的小数位数（可选） */
  readonly precision?: number | undefined;
}

/** 列配置统一联合类型 */
export type ColumnConfig =
  | FixedColumnConfig
  | AggregatedColumnConfig
  | ComputedColumnConfig;

/** 转换执行选项 */
export interface TransformOptions {
  /** 是否将 null/undefined 视作 0 进行数值计算（默认 true） */
  readonly nullAsZero?: boolean | undefined;
  /** 排序规则列表 */
  readonly sort?: readonly {
    readonly field: string;
    readonly order: 'asc' | 'desc';
  }[] | undefined;
}

/** 动态数据转换完整配置规范 (DSL Schema) */
export interface DynamicTransformConfig {
  /** 表头映射字典（可选，未传递时直接使用原始键名展示） */
  readonly headers?: HeaderMapping | undefined;
  /** 字段类型覆盖字典（键为字段名，值为指定的类型） */
  readonly fields?: Readonly<Record<string, FieldDataType>> | undefined;
  /** 维度与时间配置（配置后自动开启分组透视，未配置时为全量明细） */
  readonly dimensions?: DimensionConfig | undefined;
  /** 输出列定义 */
  readonly columns: readonly ColumnConfig[];
  /** 运行附加选项 */
  readonly options?: TransformOptions | undefined;
}

/** 转换后输出的列元信息 */
export interface OutputColumnMeta {
  readonly key: string;
  readonly title: string;
  readonly type: FieldDataType;
  /** 原始列配置类型 */
  readonly kind?: 'fixed' | 'aggregated' | 'computed' | 'dimension' | undefined;
  /** 聚合函数类型：'sum' | 'avg' | 'min' | 'max' | 'count' */
  readonly agg?: AggregationFunction | undefined;
  /** 原始物理字段名 (仅 fixed 或 aggregated 时有效) */
  readonly field?: string | undefined;
  /** 计算列公式表达式 */
  readonly expression?: string | undefined;
  /** 计算列精度 */
  readonly precision?: number | undefined;
}

/** 最终转换执行结果 */
export interface TransformResult {
  /** 转换后的数据记录列表 */
  readonly data: readonly DataRecord[];
  /** 导出的列结构列表（可直接给 Table columns 使用） */
  readonly columns: readonly OutputColumnMeta[];
  /** 运行诊断元信息 */
  readonly meta: {
    readonly form?: 'detail' | 'pivot' | 'summary' | undefined;
    /** 是否为双向交叉透视表（当存在列维度时为 true） */
    readonly isCrossTab?: boolean | undefined;
    readonly inputRows: number;
    readonly outputRows: number;
    readonly executionTimeMs: number;
    readonly dimensions?: DimensionConfig | undefined;
    readonly rawHeaders?: Record<string, string> | undefined;
  };
}
