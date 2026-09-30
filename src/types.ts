/**
 * 动态数据核心类型定义。
 *
 * 本文件只包含类型，不产生任何运行时代码，可被安全地 `import type` 引入。
 */

/** 动态数据记录的统一形态：字符串键到任意值的映射。 */
export type DataRecord = Record<string, unknown>;

/** 数据源 / 适配器 / 转换器的唯一标识。 */
export type DataSourceId = string;

/** 显式的可空语义容器。 */
export type Maybe<T> = T | null | undefined;

/**
 * 可被注册表管理的最小契约。
 *
 * 任何需要按 id 查找的实现都应满足该接口。
 */
export interface Identifiable {
  readonly id: string;
}

/**
 * 数据源适配器：把一种外部原始数据接入统一模型。
 *
 * @typeParam TRaw    外部原始数据的形态
 * @typeParam TRecord 归一化之后的统一记录形态
 */
export interface DataSourceAdapter<TRaw = unknown, TRecord extends DataRecord = DataRecord>
  extends Identifiable {
  /** 人类可读名称，用于调试与展示。 */
  readonly name: string;
  /** 读取原始数据集合。 */
  fetch(): Promise<readonly TRaw[]>;
  /** 将单条原始数据归一化为统一记录。 */
  normalize(raw: TRaw): TRecord;
}

/** 单条数据校验问题。 */
export interface ValidationIssue {
  /** 出问题的字段路径，例如 `meta.tags[0]`。 */
  readonly path: string;
  /** 问题描述。 */
  readonly message: string;
}

/** 数据校验结果。 */
export interface ValidationResult {
  /** 是否通过校验。 */
  readonly valid: boolean;
  /** 全部问题项，通过校验时为空数组。 */
  readonly issues: readonly ValidationIssue[];
}
