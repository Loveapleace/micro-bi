/**
 * 默认简体中文语言包 (zh_CN)
 *
 * 核心机制：代码以中文作为基准 Key，因此中文无需维护冗余翻译字典，默认直接返回中文原文。
 * 保留 zh_CN 为空对象常量以兼容外部 `<DynamicDataLocaleProvider locale={zh_CN}>` 调用。
 */
import type { DynamicDataLocale } from './types.js';

export const zh_CN: DynamicDataLocale = {};
