import React, { createContext, useContext, useMemo } from 'react';
import type { DynamicDataLocale, DynamicDataTranslator } from './types.js';
import { zh_CN } from './zh_CN.js';
import { formatMessage } from './utils.js';

export const DynamicDataLocaleContext = createContext<DynamicDataLocale>(zh_CN);

export interface DynamicDataLocaleProviderProps {
  /** 语言包配置 (如 en_US 或自定义 Record<string, string>) */
  locale?: Record<string, string | undefined> | undefined;
  /** 等同于 locale，提供类 React Context Provider 的 value prop 支持 */
  value?: Record<string, string | undefined> | undefined;
  children: React.ReactNode;
}

/**
 * 动态数据组件全局国际化 Provider 容器
 */
export const DynamicDataLocaleProvider: React.FC<DynamicDataLocaleProviderProps> = ({
  locale,
  value,
  children,
}) => {
  const parentLocale = useContext(DynamicDataLocaleContext);
  const target = locale ?? value;
  const mergedLocale = useMemo<DynamicDataLocale>(() => {
    if (!target) return parentLocale;
    const next: DynamicDataLocale = { ...parentLocale };
    for (const [k, v] of Object.entries(target)) {
      if (v !== undefined) {
        next[k] = v;
      }
    }
    return next;
  }, [parentLocale, target]);

  return (
    <DynamicDataLocaleContext.Provider value={mergedLocale}>
      {children}
    </DynamicDataLocaleContext.Provider>
  );
};

/**
 * 获取当前生效的国际化翻译函数与字典
 *
 * 核心机制：
 * 1. 中文直接作为 Key：t('添加固定列')
 * 2. 自动支持参数模版替换：t('总计 (共 {count} 项)', { count: 10 })
 * 3. 极速容错兜底：若目标语言缺失对应翻译，直接返回中文原文本，绝不空白或抛错
 * 4. 兼容性：既可直接调用 t('文本')，也可解构 const { t } = useDynamicDataLocale()
 */
export function useDynamicDataLocale(
  componentOverride?: Record<string, string | undefined> | undefined
): DynamicDataTranslator {
  const contextLocale = useContext(DynamicDataLocaleContext);

  return useMemo(() => {
    let activeLocale = contextLocale;
    if (componentOverride) {
      activeLocale = { ...contextLocale };
      for (const [k, v] of Object.entries(componentOverride)) {
        if (v !== undefined) {
          activeLocale[k] = v;
        }
      }
    }

    const translate = (text: string, params?: Record<string, string | number>): string => {
      const template = activeLocale[text] ?? text;
      return params ? formatMessage(template, params) : template;
    };

    (translate as any).locale = activeLocale;
    (translate as any).t = translate;

    return translate as unknown as DynamicDataTranslator;
  }, [contextLocale, componentOverride]);
}
