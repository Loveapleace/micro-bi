/**
 * 动态数据组件国际化语言包类型定义
 *
 * 核心设计：中文为 Key，目标语言文本为 Value。
 * 默认无需维护中文语言包；若目标语言缺失某条翻译，直接回退显示中文原句。
 */
export type DynamicDataLocale = Record<string, string>;

/** 递归部分类型别名，保证向后兼容 */
export type DeepPartial<T> = { [P in keyof T]?: T[P] };

/** 翻译执行函数签名 */
export interface DynamicDataTranslator {
  (text: string, params?: Record<string, string | number>): string;
  readonly locale: DynamicDataLocale;
  readonly t: DynamicDataTranslator;
}

/** 兼容旧版各模块类型导出，统一指向 Record<string, string> */
export type TableLocale = Record<string, string>;
export type ChartLocale = Record<string, string>;
export type ViewLocale = Record<string, string>;
export type ToolbarLocale = Record<string, string>;
export type EngineLocale = Record<string, string>;
export type ConfigLocale = Record<string, string>;
