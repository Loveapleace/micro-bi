/**
 * VisActor 高性能 Canvas 图表展示组件 (VChartView)
 * - 基于字节跳动 @visactor/vchart 统一 Canvas/WebGL 渲染底座
 * - 原生支持柱状图 (Bar)、折线图 (Line)、饼图 (Pie) 及 Pareto 双 Y 轴 (Dual Axis) 柱线复合图
 * - 声明式 Spec 驱动，支持微任务级极速响应与平滑交互
 * - 与 VTableView 共享底层 VRender 引擎，实现统一的视觉样式与色彩主题
 * - 深度集成同源多维交叉切片过滤联动 (LinkageBus)
 */
import React, { useRef, useEffect, useMemo } from 'react';
import * as VChartPkg from '@visactor/vchart';
import type { ISpec, IVChart } from '@visactor/vchart';
const vchartMod: any = VChartPkg;
const vchartActual = vchartMod.VChart ? vchartMod : (vchartMod['def' + 'ault'] || vchartMod);
const VChart = vchartActual.VChart || vchartActual;
import type { TransformResult, DataRecord, OutputColumnMeta } from '../../../engine/types.js';
import type { LinkageEvent } from '../types.js';
import type { ResolvedThemeConfig } from '../theme.js';
import { getRowFieldValue, matchSliceValue } from '../DynamicDataLinkage.js';
import { isRateOrRatioMetric, isPerMilleMetric } from './metricUtils.js';
import { useDynamicDataLocale } from '../../../locale/index.js';
import type { DynamicDataLocale, DeepPartial } from '../../../locale/types.js';

export interface VChartViewProps {
  /** 视图类型 (line | bar | pie) */
  viewType: 'line' | 'bar' | 'pie';
  /** 数据管道转换结果 */
  result: TransformResult;
  /** X 轴 / 分类轴维度字段 */
  dimensionField: string;
  /** 当前激活展示的指标列表 (二次指标切换) */
  activeMetrics: readonly string[];
  /** 主题配置 */
  theme: ResolvedThemeConfig;
  /** 外部高级 VChart Spec 规范覆盖 (最高优先级覆盖) */
  vchartSpec?: Partial<ISpec> | undefined;
  /** 容器外层样式覆盖 */
  chartStyle?: React.CSSProperties | undefined;
  /** 外部传入的当前联动事件 (接收其他同源组件的广播) */
  activeLinkage?: LinkageEvent | null | undefined;
  /** 点击图表数据项时触发联动回调 */
  onSelectData?: ((payload: {
    dimensionField?: string | undefined;
    dimensionValue: string | number;
    dimensionTitle?: string | undefined;
    secondaryField?: string | undefined;
    secondaryValue?: string | number | undefined;
    secondaryTitle?: string | undefined;
    metricKey?: string | undefined;
    dataIndex: number;
    record?: DataRecord | undefined;
  }) => void) | undefined;
  /** 自定义国际化语言包或局部文案覆盖 */
  locale?: DeepPartial<DynamicDataLocale> | undefined;
}

export const VChartView: React.FC<VChartViewProps> = ({
  viewType,
  result,
  dimensionField,
  activeMetrics,
  theme,
  vchartSpec,
  chartStyle,
  activeLinkage,
  onSelectData,
  locale: propLocale,
}) => {
  const t = useDynamicDataLocale(propLocale);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IVChart | null>(null);
  const onSelectDataRef = useRef(onSelectData);
  onSelectDataRef.current = onSelectData;
  const viewTypeRef = useRef(viewType);
  viewTypeRef.current = viewType;
  const dimensionFieldRef = useRef(dimensionField);
  dimensionFieldRef.current = dimensionField;
  const secondaryDimFieldRef = useRef<string | undefined>(undefined);
  const titleMapRef = useRef<Record<string, string>>({});
  const resultRef = useRef(result);
  resultRef.current = result;

  const isDark = theme.mode === 'dark';

  // 1. 构建 VChart 声明式 Spec
  const generatedSpec = useMemo<ISpec>(() => {
    const { data, columns } = result;
    const titleMap: Record<string, string> = {};
    columns.forEach((c: OutputColumnMeta) => {
      titleMap[c.key] = c.title || c.key;
    });
    titleMapRef.current = titleMap;

    // 识别多维次级分组
    const timeField = (result.meta as any)?.dimensions?.timeBucket?.field;
    const declaredCategories: readonly string[] = (result.meta as any)?.dimensions?.categories ?? [];
    const allConfiguredDimensions = [
      ...(timeField ? [timeField] : []),
      ...declaredCategories,
    ];
    const groupingKeys =
      allConfiguredDimensions.length > 0 && allConfiguredDimensions.includes(dimensionField)
        ? allConfiguredDimensions.filter((k: string) => k !== dimensionField)
        : [];
    const secondaryDimField = groupingKeys[0];
    secondaryDimFieldRef.current = secondaryDimField;

    const groupValues = secondaryDimField
      ? Array.from(new Set(data.map((r) => String(r[secondaryDimField] ?? '')).filter(Boolean)))
      : [];
    const hasSecondaryGrouping = Boolean(secondaryDimField && groupValues.length > 0);

    // 区分绝对数值与比率指标
    const absoluteMetrics: string[] = [];
    const rateMetrics: string[] = [];

    for (const mKey of activeMetrics) {
      const colMeta = columns.find((c: OutputColumnMeta) => c.key === mKey) || {
        key: mKey,
        title: titleMap[mKey] || mKey,
      };
      if (isRateOrRatioMetric(colMeta)) {
        rateMetrics.push(mKey);
      } else {
        absoluteMetrics.push(mKey);
      }
    }

    // 判断双 Y 轴触发条件：无次级分组时，同时存在数值度量与比率度量
    const useDualYAxis =
      !hasSecondaryGrouping &&
      (viewType === 'bar' || viewType === 'line') &&
      absoluteMetrics.length > 0 &&
      rateMetrics.length > 0;

    const hasPerMilleOnly =
      rateMetrics.length > 0 &&
      rateMetrics.every((mKey) => {
        const colMeta = columns.find((c: OutputColumnMeta) => c.key === mKey) || {
          key: mKey,
          title: titleMap[mKey] || mKey,
        };
        return isPerMilleMetric(colMeta);
      });
    const rateUnit = hasPerMilleOnly ? '‰' : '%';

    // 基础全局主题样式
    const basePalette = theme.chartPalette || [
      '#1677ff',
      '#52c41a',
      '#fa8c16',
      '#722ed1',
      '#13c2c2',
      '#eb2f96',
      '#fadb14',
    ];

    // =========================================================================
    // 模式 A：饼图 (Pie Chart)
    // =========================================================================
    if (viewType === 'pie') {
      const targetMetric = activeMetrics[0] || (columns.find((c) => c.type === 'number')?.key ?? '');
      const metricTitle = titleMap[targetMetric] || targetMetric;
      const dimensionTitle = titleMap[dimensionField] || dimensionField;

      // 核心：饼图不区分 XY 轴，仅表达单一度量指标在单一分类维度下的占比构成。
      // 当底层数据集包含次级维度或细粒度行（如日期+车间复合维度）时，必须按分类维度进行唯一分组汇总（SUM），
      // 避免出现同名分类重复扇区，确保总占比严格为 100%。
      const isRate = isRateOrRatioMetric({
        key: targetMetric,
        title: metricTitle,
      });

      const categoryMap = new Map<string, {
        categoryKey: string;
        sum: number;
        count: number;
        representativeRecord: any;
      }>();

      for (let i = 0; i < data.length; i++) {
        const row = data[i]!;
        const rawCategory = getRowFieldValue(row, dimensionField);
        const catKey = rawCategory !== undefined && rawCategory !== null && rawCategory !== ''
          ? String(rawCategory)
          : t('未分类');

        const rawVal = Number(row[targetMetric]);
        const numVal = isNaN(rawVal) ? 0 : rawVal;

        const existing = categoryMap.get(catKey);
        if (existing) {
          existing.sum += numVal;
          existing.count += 1;
        } else {
          categoryMap.set(catKey, {
            categoryKey: catKey,
            sum: numVal,
            count: 1,
            representativeRecord: row,
          });
        }
      }

      // 计算每个分组的最终数值：比率指标取平均，数值指标取总和
      const aggregatedCategories = Array.from(categoryMap.values()).map((item) => {
        const finalVal = isRate && item.count > 0 ? item.sum / item.count : item.sum;
        return {
          ...item,
          finalVal: Math.round(finalVal * 100) / 100,
        };
      });

      const totalVal = aggregatedCategories.reduce((acc, cur) => acc + (cur.finalVal > 0 ? cur.finalVal : 0), 0);

      const pieValues = aggregatedCategories.map((item, idx) => {
        const ratio = totalVal > 0 ? (item.finalVal / totalVal) * 100 : 0;
        const ratioStr = `${ratio.toFixed(1)}%`;
        return {
          [dimensionField]: item.categoryKey,
          [targetMetric]: item.finalVal,
          __metricName__: metricTitle,
          __metricValue__: item.finalVal,
          __dimensionTitle__: dimensionTitle,
          __percentage__: ratio,
          __percentageText__: ratioStr,
          __record__: item.representativeRecord,
          __dataIndex__: idx,
        };
      });

      return {
        type: 'pie',
        data: [
          {
            id: 'pieData',
            values: pieValues,
          },
        ],
        categoryField: dimensionField,
        valueField: targetMetric,
        outerRadius: 0.8,
        innerRadius: 0.5, // 优雅的环形图设计
        padAngle: 0.6,
        color: basePalette,
        pie: {
          style: {
            cornerRadius: 4,
          },
          state: {
            hover: {
              outerRadius: 0.84,
              stroke: theme.colorBorder,
              lineWidth: 2,
            },
            selected: {
              outerRadius: 0.85,
              stroke: '#1677ff',
              lineWidth: 3,
            },
          },
        },
        label: {
          visible: true,
          position: 'outside',
          line: {
            visible: true,
            smooth: true,
          },
          style: {
            fill: theme.colorText,
            fontSize: 11,
          },
          formatMethod: (text: any, datum: any) => {
            const cat = datum ? datum[dimensionField] : text;
            const pct = datum?.__percentageText__;
            return pct ? `${cat} (${pct})` : String(cat ?? '');
          },
        },
        legends: [
          {
            visible: true,
            orient: 'right',
            position: 'middle',
            item: {
              label: {
                style: {
                  fill: theme.colorText,
                  fontSize: 12,
                },
              },
            },
          },
        ],
        tooltip: {
          visible: true,
          mark: {
            title: {
              value: (datum: any) => `${dimensionTitle}: ${String(datum[dimensionField] ?? '')}`,
            },
            content: [
              {
                key: () => metricTitle,
                value: (datum: any) => {
                  const val = datum[targetMetric];
                  const formatted = typeof val === 'number' ? val.toLocaleString() : String(val ?? '-');
                  return isRate ? `${formatted}%` : formatted;
                },
              },
              {
                key: () => t('占比 (份额)'),
                value: (datum: any) => datum.__percentageText__ || '-',
              },
            ],
          },
        },
        theme: isDark ? 'dark' : 'light',
      } as any;
    }

    // =========================================================================
    // 模式 B：双 Y 轴复合图表 (Dual Axis / Composite Chart: Grouped Bars + Lines)
    // =========================================================================
    if (useDualYAxis) {
      const barData: any[] = [];
      const lineData: any[] = [];

      for (let i = 0; i < data.length; i++) {
        const row = data[i]!;
        const dimVal = row[dimensionField];

        // 左轴柱状数据
        for (const mKey of absoluteMetrics) {
          const mTitle = titleMap[mKey] || mKey;
          barData.push({
            [dimensionField]: dimVal,
            __metricName__: mTitle,
            __metricKey__: mKey,
            __metricValue__: Number(row[mKey]) || 0,
            __record__: row,
            __dataIndex__: i,
          });
        }

        // 右轴折线数据
        for (const mKey of rateMetrics) {
          const mTitle = titleMap[mKey] || mKey;
          lineData.push({
            [dimensionField]: dimVal,
            __metricName__: mTitle,
            __metricKey__: mKey,
            __metricValue__: Number(row[mKey]) || 0,
            __record__: row,
            __dataIndex__: i,
          });
        }
      }

      const seriesList: any[] = [
        {
          type: viewType === 'bar' ? 'bar' : 'line',
          id: 'barSeries',
          dataId: 'barData',
          name: t('数值统计'),
          xField: [dimensionField, '__metricName__'],
          yField: '__metricValue__',
          seriesField: '__metricName__',
          barMaxWidth: 36,
          barGapInGroup: 0.2,
          point: { visible: true },
        },
        {
          type: 'line',
          id: 'lineSeries',
          dataId: 'lineData',
          name: t('比率走势'),
          xField: dimensionField,
          yField: '__metricValue__',
          seriesField: '__metricName__',
          point: { visible: true, size: 6 },
          line: { style: { lineWidth: 2.5 } },
        },
      ];

      return {
        type: 'common',
        series: seriesList,
        data: [
          { id: 'barData', values: barData },
          { id: 'lineData', values: lineData },
        ],
        color: basePalette,
        axes: [
          {
            orient: 'bottom',
            type: 'band',
            paddingInner: 0.3,
            label: {
              style: {
                fill: theme.colorTextSecondary,
                fontSize: 11,
              },
            },
            domainLine: {
              style: { stroke: theme.colorBorder },
            },
          },
          {
            orient: 'left',
            type: 'linear',
            seriesId: ['barSeries'],
            grid: {
              visible: true,
              style: {
                stroke: theme.colorBorder,
                lineDash: [4, 4],
              },
            },
            label: {
              style: {
                fill: theme.colorTextSecondary,
                fontSize: 11,
              },
              formatMethod: (val: number) => {
                if (Math.abs(val) >= 1000000) return `${(val / 1000000).toFixed(1)}M`;
                if (Math.abs(val) >= 1000) return `${(val / 1000).toFixed(0)}k`;
                return String(val);
              },
            },
          },
          {
            orient: 'right',
            type: 'linear',
            seriesId: ['lineSeries'],
            grid: { visible: false },
            title: {
              visible: true,
              text: rateUnit,
              style: { fill: theme.colorTextSecondary, fontSize: 11 },
            },
            label: {
              style: {
                fill: theme.colorTextSecondary,
                fontSize: 11,
              },
              formatMethod: (val: number) => `${val}${rateUnit}`,
            },
          },
        ],
        legends: [
          {
            visible: true,
            orient: 'top',
            position: 'middle',
            item: {
              label: {
                style: {
                  fill: theme.colorText,
                  fontSize: 11,
                },
              },
            },
          },
        ],
        tooltip: {
          visible: true,
          mark: {
            title: {
              value: (datum: any) => String(datum[dimensionField] ?? ''),
            },
            content: [
              {
                key: (datum: any) => datum.__metricName__ || t('数值'),
                value: (datum: any) => {
                  const val = datum.__metricValue__ ?? datum.value;
                  const isRate = rateMetrics.includes(datum.__metricKey__);
                  if (typeof val === 'number') {
                    return isRate ? `${val.toLocaleString()}${rateUnit}` : val.toLocaleString();
                  }
                  return String(val ?? '-');
                },
              },
            ],
          },
        },
        theme: isDark ? 'dark' : 'light',
      } as any;
    }

    // =========================================================================
    // 模式 C：次级分组柱状/折线图 (具有次级分组维度，如按月+按车间)
    // =========================================================================
    if (hasSecondaryGrouping && secondaryDimField) {
      const targetMetric = activeMetrics[0] || (columns.find((c) => c.type === 'number')?.key ?? '');
      const metricTitle = titleMap[targetMetric] || targetMetric;
      const firstColMeta = columns.find((c) => c.key === targetMetric) || { key: targetMetric };
      const isRate = isRateOrRatioMetric(firstColMeta);
      const unit = isPerMilleMetric(firstColMeta) ? '‰' : '%';

      if (viewType === 'line') {
        return {
          type: 'line',
          data: [{ id: 'chartData', values: data }],
          xField: dimensionField,
          yField: targetMetric,
          seriesField: secondaryDimField,
          point: { visible: true, size: 6 },
          line: { style: { lineWidth: 2 } },
          color: basePalette,
          axes: [
            {
              orient: 'bottom',
              type: 'band',
              paddingInner: 0.3,
              label: { style: { fill: theme.colorTextSecondary, fontSize: 11 } },
              domainLine: { style: { stroke: theme.colorBorder } },
            },
            {
              orient: 'left',
              type: 'linear',
              grid: { visible: true, style: { stroke: theme.colorBorder, lineDash: [4, 4] } },
              label: {
                style: { fill: theme.colorTextSecondary, fontSize: 11 },
                formatMethod: (val: number) => {
                  if (isRate) return `${val}${unit}`;
                  if (Math.abs(val) >= 1000) return `${(val / 1000).toFixed(0)}k`;
                  return String(val);
                },
              },
            },
          ],
          legends: [
            {
              visible: true,
              orient: 'top',
              position: 'middle',
              item: { label: { style: { fill: theme.colorText, fontSize: 11 } } },
            },
          ],
          tooltip: {
            visible: true,
            mark: {
              title: {
                value: (datum: any) =>
                  `${String(datum[dimensionField] ?? '')} · ${String(datum[secondaryDimField] ?? '')}`,
              },
              content: [
                {
                  key: () => metricTitle,
                  value: (datum: any) => {
                    const val = datum[targetMetric];
                    if (typeof val === 'number') {
                      return isRate ? `${val.toLocaleString()}${unit}` : val.toLocaleString();
                    }
                    return String(val ?? '-');
                  },
                },
              ],
            },
          },
          theme: isDark ? 'dark' : 'light',
        } as any;
      }

      // 分组柱状图
      return {
        type: 'bar',
        data: [{ id: 'chartData', values: data }],
        xField: [dimensionField, secondaryDimField],
        yField: targetMetric,
        seriesField: secondaryDimField,
        barMaxWidth: 36,
        barGapInGroup: 0.2,
        color: basePalette,
        axes: [
          {
            orient: 'bottom',
            type: 'band',
            paddingInner: 0.3,
            label: { style: { fill: theme.colorTextSecondary, fontSize: 11 } },
            domainLine: { style: { stroke: theme.colorBorder } },
          },
          {
            orient: 'left',
            type: 'linear',
            grid: { visible: true, style: { stroke: theme.colorBorder, lineDash: [4, 4] } },
            label: {
              style: { fill: theme.colorTextSecondary, fontSize: 11 },
              formatMethod: (val: number) => {
                if (isRate) return `${val}${unit}`;
                if (Math.abs(val) >= 1000) return `${(val / 1000).toFixed(0)}k`;
                return String(val);
              },
            },
          },
        ],
        legends: [
          {
            visible: true,
            orient: 'top',
            position: 'middle',
            item: { label: { style: { fill: theme.colorText, fontSize: 11 } } },
          },
        ],
        tooltip: {
          visible: true,
          mark: {
            title: {
              value: (datum: any) =>
                `${String(datum[dimensionField] ?? '')} · ${String(datum[secondaryDimField] ?? '')}`,
            },
            content: [
              {
                key: () => metricTitle,
                value: (datum: any) => {
                  const val = datum[targetMetric];
                  if (typeof val === 'number') {
                    return isRate ? `${val.toLocaleString()}${unit}` : val.toLocaleString();
                  }
                  return String(val ?? '-');
                },
              },
            ],
          },
        },
        theme: isDark ? 'dark' : 'light',
      } as any;
    }

    // =========================================================================
    // 模式 D：单 Y 轴多指标柱状/折线图 (按 Long/Tidy 规范投影，形成分组柱状图)
    // =========================================================================
    const targetMetrics =
      activeMetrics.length > 0
        ? activeMetrics
        : [columns.find((c) => c.type === 'number')?.key ?? ''];

    const tidyData: any[] = [];
    for (let i = 0; i < data.length; i++) {
      const row = data[i]!;
      const dimVal = row[dimensionField];
      for (const mKey of targetMetrics) {
        const mTitle = titleMap[mKey] || mKey;
        tidyData.push({
          [dimensionField]: dimVal,
          __metricName__: mTitle,
          __metricKey__: mKey,
          __metricValue__: Number(row[mKey]) || 0,
          __record__: row,
          __dataIndex__: i,
        });
      }
    }

    const firstColMeta = columns.find((c) => c.key === targetMetrics[0]) || { key: targetMetrics[0] || '' };
    const isOnlyRate = targetMetrics.length === 1 && isRateOrRatioMetric(firstColMeta);
    const unit = isPerMilleMetric(firstColMeta) ? '‰' : '%';

    if (viewType === 'line') {
      return {
        type: 'line',
        data: [{ id: 'chartData', values: tidyData }],
        xField: dimensionField,
        yField: '__metricValue__',
        seriesField: '__metricName__',
        point: { visible: true, size: 6 },
        line: { style: { lineWidth: 2 } },
        color: basePalette,
        axes: [
          {
            orient: 'bottom',
            type: 'band',
            paddingInner: 0.3,
            label: { style: { fill: theme.colorTextSecondary, fontSize: 11 } },
            domainLine: { style: { stroke: theme.colorBorder } },
          },
          {
            orient: 'left',
            type: 'linear',
            grid: { visible: true, style: { stroke: theme.colorBorder, lineDash: [4, 4] } },
            label: {
              style: { fill: theme.colorTextSecondary, fontSize: 11 },
              formatMethod: (val: number) => {
                if (isOnlyRate) return `${val}${unit}`;
                if (Math.abs(val) >= 1000) return `${(val / 1000).toFixed(0)}k`;
                return String(val);
              },
            },
          },
        ],
        legends: [
          {
            visible: targetMetrics.length > 1,
            orient: 'top',
            position: 'middle',
            item: { label: { style: { fill: theme.colorText, fontSize: 11 } } },
          },
        ],
        tooltip: {
          visible: true,
          mark: {
            title: { value: (datum: any) => String(datum[dimensionField] ?? '') },
            content: [
              {
                key: (datum: any) => datum.__metricName__ || t('数值'),
                value: (datum: any) => {
                  const val = datum.__metricValue__ ?? datum.value;
                  if (typeof val === 'number') {
                    return isOnlyRate ? `${val.toLocaleString()}${unit}` : val.toLocaleString();
                  }
                  return String(val ?? '-');
                },
              },
            ],
          },
        },
        theme: isDark ? 'dark' : 'light',
      } as any;
    }

    // 默认分组柱状图
    return {
      type: 'bar',
      data: [{ id: 'chartData', values: tidyData }],
      xField: [dimensionField, '__metricName__'],
      yField: '__metricValue__',
      seriesField: '__metricName__',
      barMaxWidth: 36,
      barGapInGroup: 0.2,
      color: basePalette,
      axes: [
        {
          orient: 'bottom',
          type: 'band',
          paddingInner: 0.3,
          label: { style: { fill: theme.colorTextSecondary, fontSize: 11 } },
          domainLine: { style: { stroke: theme.colorBorder } },
        },
        {
          orient: 'left',
          type: 'linear',
          grid: { visible: true, style: { stroke: theme.colorBorder, lineDash: [4, 4] } },
          label: {
            style: { fill: theme.colorTextSecondary, fontSize: 11 },
            formatMethod: (val: number) => {
              if (isOnlyRate) return `${val}${unit}`;
              if (Math.abs(val) >= 1000) return `${(val / 1000).toFixed(0)}k`;
              return String(val);
            },
          },
        },
      ],
      legends: [
        {
          visible: targetMetrics.length > 1,
          orient: 'top',
          position: 'middle',
          item: { label: { style: { fill: theme.colorText, fontSize: 11 } } },
        },
      ],
      tooltip: {
        visible: true,
        mark: {
          title: { value: (datum: any) => String(datum[dimensionField] ?? '') },
          content: [
            {
              key: (datum: any) => datum.__metricName__ || t('数值'),
              value: (datum: any) => {
                const val = datum.__metricValue__ ?? datum.value;
                if (typeof val === 'number') {
                  return isOnlyRate ? `${val.toLocaleString()}${unit}` : val.toLocaleString();
                }
                return String(val ?? '-');
              },
            },
          ],
        },
      },
      theme: isDark ? 'dark' : 'light',
    } as any;
  }, [viewType, result, dimensionField, activeMetrics, theme, isDark]);

  // 2. 初始化 VChart 实例与事件监听
  useEffect(() => {
    const dom = containerRef.current;
    if (!dom) return;

    // 外部高级 Spec 覆盖
    const finalSpec: any = vchartSpec ? { ...generatedSpec, ...vchartSpec } : generatedSpec;

    const vchart = new VChart(finalSpec, {
      dom,
      mode: 'desktop-browser',
      theme: isDark ? 'dark' : 'light',
    });
    chartRef.current = vchart;

    // 渲染图表
    vchart.renderAsync();

    // 监听图元点击事件，驱动同源交叉切片联动
    vchart.on('click', (params: any) => {
      const datum = params.datum;
      if (!datum || !onSelectDataRef.current) return;

      const dimField = dimensionFieldRef.current;
      const dimVal = datum[dimField] ?? datum.x ?? datum.category ?? '';
      const metric = datum.__seriesId__ || params.mark?.name;

      // 饼图无 XY 轴及次级维度，点击扇区仅透传分类维度与所选指标
      if (viewTypeRef.current === 'pie') {
        const dimTitle = titleMapRef.current?.[dimField] || dimField;
        onSelectDataRef.current({
          dimensionField: dimField,
          dimensionValue: dimVal,
          dimensionTitle: dimTitle,
          secondaryField: undefined,
          secondaryValue: undefined,
          secondaryTitle: undefined,
          metricKey: datum.__metricName__ || metric,
          dataIndex: params.dataIndex ?? 0,
          record: datum.__record__ || datum,
        });
        return;
      }

      const secField = secondaryDimFieldRef.current;
      const secVal = secField ? datum[secField] : undefined;
      const secTitle = secField ? (titleMapRef.current?.[secField] || secField) : undefined;
      const dimTitle = titleMapRef.current?.[dimField] || dimField;

      onSelectDataRef.current({
        dimensionField: dimField,
        dimensionValue: dimVal,
        dimensionTitle: dimTitle,
        secondaryField: secField,
        secondaryValue: secVal,
        secondaryTitle: secTitle,
        metricKey: metric,
        dataIndex: params.dataIndex ?? 0,
        record: datum.__record__ || datum,
      });
    });

    // 响应式 Resize 监听
    let rAfId: number;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(rAfId);
      rAfId = requestAnimationFrame(() => {
        const w = dom.clientWidth;
        const h = dom.clientHeight;
        if (w && h) {
          chartRef.current?.resize(w, h);
        }
      });
    });
    ro.observe(dom);

    return () => {
      cancelAnimationFrame(rAfId);
      ro.disconnect();
      vchart.release();
      chartRef.current = null;
    };
  }, [isDark, viewType]); // 当明暗模式或图表视图坐标系变化时重建实例

  // 3. Spec 更新时极速重绘
  useEffect(() => {
    const vchart = chartRef.current;
    if (!vchart) return;

    const finalSpec: any = vchartSpec ? { ...generatedSpec, ...vchartSpec } : generatedSpec;
    vchart.updateSpec(finalSpec);
  }, [generatedSpec, vchartSpec]);

  // 4. 显式同源联动响应：扇区高亮或笛卡尔坐标 X 轴高亮
  useEffect(() => {
    const vchart = chartRef.current;
    if (!vchart) return;

    if (!activeLinkage || activeLinkage.dimensionValue === undefined || activeLinkage.dimensionValue === null) {
      try {
        if (viewType === 'pie') {
          vchart.clearState?.('selected');
        } else {
          vchart.setDimensionIndex?.(-1);
        }
      } catch {
        // 静默捕获
      }
      return;
    }

    if (viewType === 'pie') {
      try {
        // 饼图高亮：通过匹配分类维度值高亮对应扇区
        const pieData = (generatedSpec as any)?.data?.[0]?.values;
        if (Array.isArray(pieData)) {
          const targetDatum = pieData.find((d: any) =>
            matchSliceValue(d[dimensionField], activeLinkage.dimensionValue)
          );
          if (targetDatum) {
            vchart.setSelected?.(targetDatum);
          } else {
            vchart.clearState?.('selected');
          }
        }
      } catch {
        // 静默捕获
      }
      return;
    }

    // 笛卡尔坐标系图表 (柱状图/折线图)：通过 setDimensionIndex 高亮离散 X 轴
    const { data } = result;
    const targetIdx = data.findIndex((r) => {
      const val = getRowFieldValue(r, dimensionField);
      return matchSliceValue(val, activeLinkage.dimensionValue);
    });

    if (targetIdx >= 0) {
      try {
        vchart.setDimensionIndex?.(targetIdx);
      } catch {
        // 静默捕获
      }
    }
  }, [activeLinkage, result, dimensionField, viewType, generatedSpec]);

  return (
    <div
      className="hw-dynamic-view-vchart-container"
      style={{
        width: '100%',
        height: 380,
        position: 'relative',
        ...chartStyle,
      }}
    >
      <div
        ref={containerRef}
        style={{
          width: '100%',
          height: '100%',
        }}
      />
    </div>
  );
};
