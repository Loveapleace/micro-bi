/**
 * 展示层主题与样式解析器 (Theme Tokens & Scoped Isolation)
 */
import type { ThemeConfig } from 'antd';
import { theme as antdTheme } from 'antd';
import type { ViewThemeConfig } from './types.js';

/** 默认调色板配色列表 */
export const DEFAULT_CHART_PALETTE: readonly string[] = [
  '#1677ff', // 科技蓝
  '#52c41a', // 生态绿
  '#fa8c16', // 活力橙
  '#722ed1', // 典雅紫
  '#13c2c2', // 清爽青
  '#eb2f96', // 浪漫粉
  '#faad14', // 明朗金
  '#f5222d', // 警示红
  '#2f54eb', // 深极蓝
  '#a0d911', // 极客绿
];

/** 深色模式调色板 */
export const DARK_CHART_PALETTE: readonly string[] = [
  '#3c89e8',
  '#49aa19',
  '#d87a16',
  '#642ab5',
  '#13a8a8',
  '#cb2b83',
  '#d89614',
  '#d32029',
  '#2b4acb',
  '#8bbb11',
];

export interface ResolvedThemeConfig {
  mode: 'light' | 'dark';
  colorPrimary: string;
  colorBgContainer: string;
  colorText: string;
  colorTextSecondary: string;
  colorBorder: string;
  chartPalette: string[];
}

/** 标准亮色主题 Token */
export const DEFAULT_LIGHT_THEME: ResolvedThemeConfig = {
  mode: 'light',
  colorPrimary: '#1677ff',
  colorBgContainer: '#ffffff',
  colorText: 'rgba(0, 0, 0, 0.88)',
  colorTextSecondary: 'rgba(0, 0, 0, 0.45)',
  colorBorder: '#f0f0f0',
  chartPalette: [...DEFAULT_CHART_PALETTE],
};

/** 标准深色主题 Token */
export const DEFAULT_DARK_THEME: ResolvedThemeConfig = {
  mode: 'dark',
  colorPrimary: '#1668dc',
  colorBgContainer: '#141414',
  colorText: 'rgba(255, 255, 255, 0.85)',
  colorTextSecondary: 'rgba(255, 255, 255, 0.45)',
  colorBorder: '#303030',
  chartPalette: [...DARK_CHART_PALETTE],
};

/** 解析并混合外部传入的主题配置 */
export function resolveThemeConfig(
  input?: 'light' | 'dark' | ViewThemeConfig
): ResolvedThemeConfig {
  if (!input || input === 'light') {
    return DEFAULT_LIGHT_THEME;
  }
  if (input === 'dark') {
    return DEFAULT_DARK_THEME;
  }

  const base = input.mode === 'dark' ? DEFAULT_DARK_THEME : DEFAULT_LIGHT_THEME;
  return {
    mode: input.mode ?? base.mode,
    colorPrimary: input.colorPrimary ?? base.colorPrimary,
    colorBgContainer: input.colorBgContainer ?? base.colorBgContainer,
    colorText: input.colorText ?? base.colorText,
    colorTextSecondary: input.colorTextSecondary ?? base.colorTextSecondary,
    colorBorder: input.colorBorder ?? base.colorBorder,
    chartPalette: input.chartPalette && input.chartPalette.length > 0
      ? [...input.chartPalette]
      : base.chartPalette,
  };
}

/** 转换为 Ant Design 5 ConfigProvider 识别的 Theme 对象 */
export function buildAntdTheme(themeConfig: ResolvedThemeConfig): ThemeConfig {
  const isDark = themeConfig.mode === 'dark';
  return {
    algorithm: isDark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
    token: {
      colorPrimary: themeConfig.colorPrimary,
      colorBgContainer: themeConfig.colorBgContainer,
      colorText: themeConfig.colorText,
      colorBorderSecondary: themeConfig.colorBorder,
      borderRadius: 6,
    },
  };
}

/**
 * 深度对象合并工具函数（外部选项覆盖优先）
 * 用于深度覆盖 VisActor options (VTable / VChart)
 */
export function deepMerge<T extends Record<string, any>>(target: T, source?: Record<string, any>): T {
  if (!source) return target;
  const result: Record<string, any> = Array.isArray(target) ? [...target] : { ...target };

  for (const key of Object.keys(source)) {
    const srcVal = source[key];
    const tgtVal = result[key];

    if (srcVal === undefined) continue;

    if (
      srcVal &&
      typeof srcVal === 'object' &&
      !Array.isArray(srcVal) &&
      tgtVal &&
      typeof tgtVal === 'object' &&
      !Array.isArray(tgtVal)
    ) {
      result[key] = deepMerge(tgtVal, srcVal);
    } else {
      result[key] = srcVal;
    }
  }

  return result as T;
}
