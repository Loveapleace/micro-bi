/**
 * 字段类型智能探测器 (Field Profiler)
 *
 * 扫描样本数据，自动分析并将字段分类为：time (时间)、number (数字)、text (文本)。
 */
import type { DataRecord } from '../types.js';
import type { FieldDataType, FieldMeta, HeaderMapping } from './types.js';

/** 数据探查配置选项 */
export interface ProfileDatasetOptions {
  /** 表头与数据键名映射字典（如 { sales: '销售额', cost: '成本' }） */
  readonly headers?: HeaderMapping | undefined;
  /** 字段类型手动纠偏字典 */
  readonly userOverrides?: Readonly<Record<string, FieldDataType>> | undefined;
  /** 采样限制行数，默认 100 */
  readonly sampleLimit?: number | undefined;
}

const ISO_DATE_PATTERN = /^\d{4}[-/.]\d{1,2}([-/.]\d{1,2})?([ T]\d{1,2}:\d{1,2}(:\d{1,2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/;
// 合理的时间戳范围（毫秒：2000-01-01 到 2100-01-01）
const MIN_TIMESTAMP_MS = 946684800000;
const MAX_TIMESTAMP_MS = 4102444800000;

/**
 * 判断单项值是否符合日期时间特征
 */
export function isLikelyDateValue(value: unknown): boolean {
  if (value instanceof Date) {
    return !Number.isNaN(value.getTime());
  }

  if (typeof value === 'number') {
    // 若为 13 位毫秒时间戳或 10 位秒级时间戳
    if (value >= MIN_TIMESTAMP_MS && value <= MAX_TIMESTAMP_MS) {
      return true;
    }
    const inSeconds = value * 1000;
    if (inSeconds >= MIN_TIMESTAMP_MS && inSeconds <= MAX_TIMESTAMP_MS) {
      return true;
    }
    return false;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return false;
    if (ISO_DATE_PATTERN.test(trimmed)) {
      const parsed = Date.parse(trimmed);
      return !Number.isNaN(parsed);
    }
  }

  return false;
}

/**
 * 判断单项值是否为纯数字或可安全解析的数字
 */
export function isLikelyNumericValue(value: unknown): boolean {
  if (typeof value === 'number') {
    return Number.isFinite(value);
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return false;
    // 纯数字或带千分位数字，但排除纯日期格式
    if (ISO_DATE_PATTERN.test(trimmed)) {
      return false;
    }
    const clean = trimmed.replace(/,/g, '');
    const num = Number(clean);
    return !Number.isNaN(num) && Number.isFinite(num);
  }
  return false;
}

/**
 * 分析给定的值集合，综合判定该字段的主导类型
 */
export function detectFieldType(values: readonly unknown[]): FieldDataType {
  const nonNulls = values.filter((v) => v !== null && v !== undefined && v !== '');
  if (nonNulls.length === 0) {
    return 'text';
  }

  let dateMatchCount = 0;
  let numberMatchCount = 0;

  for (const val of nonNulls) {
    if (isLikelyDateValue(val)) {
      dateMatchCount += 1;
    } else if (isLikelyNumericValue(val)) {
      numberMatchCount += 1;
    }
  }

  const total = nonNulls.length;
  // 若 80% 以上样本符合时间特征，推断为时间
  if (dateMatchCount / total >= 0.8) {
    return 'time';
  }
  // 若 85% 以上样本符合数字特征，推断为数字
  if (numberMatchCount / total >= 0.8) {
    return 'number';
  }

  return 'text';
}

/**
 * 扫描记录集前 N 条样本，自动生成字段元数据分析报告。
 *
 * @param records 原始记录数组
 * @param optionsOrOverrides 用户手动纠偏覆盖字典 或 完整 ProfileDatasetOptions 配置
 * @param sampleLimit 采样上限行数，默认 100
 * @param headersParam 表头映射字典（可选）
 */
export function profileDataset(
  records: readonly DataRecord[],
  optionsOrOverrides?: Readonly<Record<string, FieldDataType>> | ProfileDatasetOptions,
  sampleLimit = 100,
  headersParam?: HeaderMapping
): readonly FieldMeta[] {
  if (!records || records.length === 0) {
    return [];
  }

  let headers: HeaderMapping | undefined = headersParam;
  let userOverrides: Readonly<Record<string, FieldDataType>> | undefined;
  let limit = sampleLimit;

  if (optionsOrOverrides && typeof optionsOrOverrides === 'object') {
    if ('headers' in optionsOrOverrides || 'userOverrides' in optionsOrOverrides || 'sampleLimit' in optionsOrOverrides) {
      const opts = optionsOrOverrides as ProfileDatasetOptions;
      headers = opts.headers ?? headers;
      userOverrides = opts.userOverrides;
      limit = opts.sampleLimit ?? sampleLimit;
    } else {
      // 传入的是普通键值对象，判断值是否为物理类型
      const entries = Object.entries(optionsOrOverrides as Record<string, string>);
      const isOverrideMap = entries.length > 0 && entries.every(([, v]) => v === 'time' || v === 'number' || v === 'text');
      if (isOverrideMap) {
        userOverrides = optionsOrOverrides as Readonly<Record<string, FieldDataType>>;
      } else {
        // 作为 headers 字典传递
        headers = optionsOrOverrides as HeaderMapping;
      }
    }
  }

  const sampleSlice = records.slice(0, limit);
  // 提取出现过的全部字段名，保持出现顺序
  const keyMap = new Map<string, unknown[]>();

  for (const row of sampleSlice) {
    for (const [k, v] of Object.entries(row)) {
      let bucket = keyMap.get(k);
      if (!bucket) {
        bucket = [];
        keyMap.set(k, bucket);
      }
      if (bucket.length < 5 && v !== null && v !== undefined && v !== '') {
        bucket.push(v);
      }
    }
  }

  const result: FieldMeta[] = [];

  for (const [key, samples] of keyMap.entries()) {
    // 收集所有用于检测的值
    const allValuesForKey: unknown[] = [];
    for (const row of sampleSlice) {
      if (key in row) {
        allValuesForKey.push(row[key]);
      }
    }

    const detected = detectFieldType(allValuesForKey);
    const effective = userOverrides?.[key] ?? detected;
    const label = headers?.[key] ?? key;

    result.push({
      key,
      label,
      detectedType: detected,
      type: effective,
      sampleValues: samples,
    });
  }

  return result;
}
