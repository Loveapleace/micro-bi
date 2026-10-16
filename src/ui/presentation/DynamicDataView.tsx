/**
 * 展示层统一可视化门面组件 (DynamicDataView)
 * - 接收底层标准 TransformResult
 * - 提供 Table / Line / Bar / Pie 多视图无缝切换
 * - 展示态二次指标切换（轻量级零拷贝投影）
 * - 第三方宿主样式隔离与全覆盖能力 (className / style / vchartSpec / vtableOption)
 */
import React, { useState, useMemo, useCallback } from 'react';
import { Card, Space, Typography, ConfigProvider, Spin, Button, Tooltip, Tag, Result, message } from 'antd';
import type { TransformResult, DataRecord, OutputColumnMeta } from '../../engine/types.js';
import type {
  DynamicDataViewProps,
  DynamicDataViewType,
  MetricOption,
  DimensionOption,
} from './types.js';
import { resolveThemeConfig, buildAntdTheme } from './theme.js';
import { MetricSwitcher } from './toolbar/MetricSwitcher.js';
import { DimensionSwitcher } from './toolbar/DimensionSwitcher.js';
import { ViewTypeSwitcher } from './toolbar/ViewTypeSwitcher.js';
import { VTableView } from './table/VTableView.js';
import { VChartView } from './charts/VChartView.js';
import { ReportTableView } from './report/ReportTableView.js';
import { useDynamicDataLocale, type ViewLocale } from '../../locale/index.js';

interface ViewErrorBoundaryProps {
  children: React.ReactNode;
  t?: ((text: string, params?: Record<string, string | number>) => string) | undefined;
}

interface ViewErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class ViewErrorBoundary extends React.Component<ViewErrorBoundaryProps, ViewErrorBoundaryState> {
  constructor(props: ViewErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ViewErrorBoundaryState {
    return { hasError: true, error };
  }

  override componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('[DynamicDataView] View render error caught by ErrorBoundary:', error, errorInfo);
  }

  override render() {
    if (this.state.hasError) {
      const translate = this.props.t || ((s: string) => s);
      return (
        <div style={{ padding: 24, textAlign: 'center' }}>
          <Result
            status="warning"
            title={translate('视图渲染异常')}
            subTitle={this.state.error?.message || translate('图表渲染组件发生内部异常，您可以尝试切换视图或重试。')}
            extra={
              <Button type="primary" onClick={() => this.setState({ hasError: false, error: null })}>
                {translate('重试渲染')}
              </Button>
            }
          />
        </div>
      );
    }
    return this.props.children;
  }
}

const { Text } = Typography;

export const DynamicDataView: React.FC<DynamicDataViewProps> = ({
  result,
  publishedReport,
  viewType: controlledViewType,
  defaultViewType = 'table',
  onViewTypeChange,
  allowViewSwitch = true,

  dimensionField: propDimensionField,
  defaultDimensionField,
  onDimensionChange,
  allowDimensionSwitch = true,

  activeMetrics: controlledActiveMetrics,
  defaultActiveMetrics,
  onMetricChange,
  allowMetricSwitch = true,
  metricSelectionMode = 'single',

  theme: propTheme,
  locale: propLocale,
  style,
  className,

  chartStyle,
  vchartSpec,
  tableStyle,
  vtableOption,
  showSummaryRow,
  mergeCells,
  showDataBars,
  frozenColumnKeys,
  rightFrozenColumnKeys,

  loading = false,
  title,
  extra,
  tableFeatures = true,
  onRowSelect,
}) => {

  // 1. 主题、国际化与样式解析
  const t = useDynamicDataLocale(propLocale);
  const themeConfig = useMemo(() => resolveThemeConfig(propTheme), [propTheme]);
  const antdThemeConfig = useMemo(() => buildAntdTheme(themeConfig), [themeConfig]);
  const isDark = themeConfig.mode === 'dark';

  // 2. 字段推断：候选度量指标与维度字段列表
  const { metricOptions, dimensionOptions, autoDimensionField } = useMemo(() => {
    const metrics: MetricOption[] = [];
    const dimensions: DimensionOption[] = [];
    let autoDim: string = '';

    if (result && result.columns) {
      // 提取配置中显式声明的时间聚合与分组聚合维度
      const configuredTimeField = (result.meta as any)?.dimensions?.timeBucket?.field;
      const configuredCategories: readonly string[] =
        (result.meta as any)?.dimensions?.categories ?? [];
      const configuredDimensions: string[] = [
        ...(configuredTimeField ? [configuredTimeField] : []),
        ...configuredCategories,
      ];
      const configuredDimSet = new Set(configuredDimensions);
      const hasConfiguredDimensions = configuredDimSet.size > 0;

      result.columns.forEach((col: OutputColumnMeta) => {
        if (col.type === 'number') {
          metrics.push({
            key: col.key,
            title: col.title,
            type: col.type,
          });
        } else if (hasConfiguredDimensions) {
          // 聚合/透视模式：严格只允许真正参与了时间聚合或分组聚合的维度进入候选池
          if (configuredDimSet.has(col.key)) {
            dimensions.push({
              key: col.key,
              title: col.title,
              type: col.type,
            });
          }
        } else if (col.type === 'time' || col.type === 'text') {
          // 未配置维度的全量明细模式：所有时间与分类文本列均可作为明细观察轴
          dimensions.push({
            key: col.key,
            title: col.title,
            type: col.type,
          });
        }
      });

      // 降级兜底：若无明确的维度，且为全量明细，则将首列加入维度池
      if (dimensions.length === 0 && result.columns.length > 0) {
        const firstCol = result.columns[0];
        if (firstCol) {
          dimensions.push({
            key: firstCol.key,
            title: firstCol.title,
            type: firstCol.type === 'number' ? 'number' : 'text',
          });
        }
      }

      // X 轴自动推断优先级瀑布流：
      // 1. 首个 time 类型时间字段
      // 2. 首个 text 类型离散分类字段
      // 3. 结果集第一列
      const firstTime = dimensions.find((d) => d.type === 'time');
      const firstText = dimensions.find((d) => d.type === 'text');
      if (firstTime) {
        autoDim = firstTime.key;
      } else if (firstText) {
        autoDim = firstText.key;
      } else if (dimensions[0]) {
        autoDim = dimensions[0].key;
      } else if (result.columns[0]) {
        autoDim = result.columns[0].key;
      }
    }

    return {
      metricOptions: metrics,
      dimensionOptions: dimensions,
      autoDimensionField: autoDim,
    };
  }, [result]);

  // 3. 维度字段状态管理（受控与非受控双模驱动）
  const initialDefaultDimension = useMemo(() => {
    if (defaultDimensionField && dimensionOptions.some((d) => d.key === defaultDimensionField)) {
      return defaultDimensionField;
    }
    if (propDimensionField && dimensionOptions.some((d) => d.key === propDimensionField)) {
      return propDimensionField;
    }
    return autoDimensionField;
  }, [defaultDimensionField, propDimensionField, autoDimensionField, dimensionOptions]);

  const [internalDimensionField, setInternalDimensionField] = useState<string>(initialDefaultDimension);

  // 当外部显式更新了 propDimensionField 时同步内部状态
  React.useEffect(() => {
    if (propDimensionField && dimensionOptions.some((d) => d.key === propDimensionField)) {
      setInternalDimensionField(propDimensionField);
    }
  }, [propDimensionField, dimensionOptions]);

  // 当未显式受控时，仅当当前选中的维度已不在候选池中时，智能回退至 autoDimensionField，避免用户手动切换被错误覆盖
  React.useEffect(() => {
    if (dimensionOptions.length > 0 && !dimensionOptions.some((d) => d.key === internalDimensionField)) {
      setInternalDimensionField(autoDimensionField);
    }
  }, [autoDimensionField, dimensionOptions, internalDimensionField]);

  // 校验当前 internalDimensionField 是否存在于当前候选维度中，若不存在则智能回退至自动探测字段
  const effectiveDimensionField = useMemo(() => {
    if (internalDimensionField && dimensionOptions.some((d) => d.key === internalDimensionField)) {
      return internalDimensionField;
    }
    return autoDimensionField;
  }, [internalDimensionField, autoDimensionField, dimensionOptions]);

  const handleDimensionChange = useCallback(
    (newDim: string) => {
      // 无论外部是否传递 propDimensionField，内部均响应更新以驱动 UI 实时刷新
      setInternalDimensionField(newDim);
      onDimensionChange?.(newDim);
    },
    [onDimensionChange]
  );

  // 4. 受控与非受控视图形态管理
  // 判定当前数据管道是否为双向交叉透视表 (Cross-Tab Pivot)
  const isCrossTab = Boolean((result?.meta as any)?.isCrossTab);

  const [internalViewType, setInternalViewType] = useState<DynamicDataViewType>(defaultViewType);
  const currentViewType = controlledViewType !== undefined ? controlledViewType : internalViewType;
  // 双向交叉透视模式下强制锁定为 table，杜绝通用图表因多维矩阵产生重叠与折返
  const effectiveViewType: DynamicDataViewType = isCrossTab ? 'table' : currentViewType;

  // 外部 defaultViewType 更新时响应同步
  React.useEffect(() => {
    if (defaultViewType) {
      setInternalViewType(defaultViewType);
    }
  }, [defaultViewType]);

  // 当外部配置变更为双向交叉透视且当前不是表格时，平滑回退至 table
  React.useEffect(() => {
    if (isCrossTab && currentViewType !== 'table') {
      if (controlledViewType === undefined) {
        setInternalViewType('table');
      }
      onViewTypeChange?.('table');
    }
  }, [isCrossTab, currentViewType, controlledViewType, onViewTypeChange]);

  const handleViewTypeChange = useCallback(
    (newType: DynamicDataViewType) => {
      if (isCrossTab && newType !== 'table') {
        return;
      }
      if (controlledViewType === undefined) {
        setInternalViewType(newType);
      }
      onViewTypeChange?.(newType);
    },
    [isCrossTab, controlledViewType, onViewTypeChange]
  );

  // 4. 展示态二次指标切换（受控与非受控）
  const initialDefaultMetrics = useMemo(() => {
    if (defaultActiveMetrics && defaultActiveMetrics.length > 0) {
      return defaultActiveMetrics;
    }
    // 默认取前一个或全部数值列
    const firstMetric = metricOptions[0];
    if (firstMetric) {
      return [firstMetric.key];
    }
    return [];
  }, [defaultActiveMetrics, metricOptions]);

  const [internalActiveMetrics, setInternalActiveMetrics] = useState<string[]>(initialDefaultMetrics);
  const currentActiveMetrics = controlledActiveMetrics !== undefined
    ? controlledActiveMetrics
    : internalActiveMetrics;

  // 提取配置中显式声明的时间聚合与分组聚合维度
  const { hasSecondaryGrouping } = useMemo(() => {
    const configuredTimeField = (result?.meta as any)?.dimensions?.timeBucket?.field;
    const configuredCategories: readonly string[] =
      (result?.meta as any)?.dimensions?.categories ?? [];
    const configuredDimensions: string[] = [
      ...(configuredTimeField ? [configuredTimeField] : []),
      ...configuredCategories,
    ];
    const secondaryDims = configuredDimensions.filter((k) => k !== effectiveDimensionField);
    return {
      hasSecondaryGrouping: secondaryDims.length > 0,
    };
  }, [result, effectiveDimensionField]);

  // 动态校验当前激活的指标：若配置变更导致旧指标不存在，智能重定向到当前有效指标池
  const effectiveActiveMetrics = useMemo(() => {
    if (metricOptions.length === 0) return [];
    if (controlledActiveMetrics !== undefined) {
      const valid = controlledActiveMetrics.filter((k) => metricOptions.some((m) => m.key === k));
      // 饼图不分 XY 轴，仅表达单一度量指标在分类维度间的占比构成，不支持多指标叠加，受控时也严格截断为单指标
      if (effectiveViewType === 'pie') {
        return valid.length > 0 ? [valid[0]!] : (metricOptions[0] ? [metricOptions[0].key] : []);
      }
      return valid.length > 0 ? valid : metricOptions.map((m) => m.key);
    }
    // 饼图视图下：必须强制单指标，表示该指标在不同分类维度间的占比构成
    if (effectiveViewType === 'pie') {
      const firstValid = currentActiveMetrics.find((k) => metricOptions.some((m) => m.key === k));
      return firstValid ? [firstValid] : (metricOptions[0] ? [metricOptions[0].key] : []);
    }
    // 表格视图下，若未外部显式受控，默认激活全部度量指标（与配置面板即时预览保持 100% 对齐）
    if (effectiveViewType === 'table') {
      return metricOptions.map((m) => m.key);
    }
    // 当处于柱状图/折线图且不存在次级分组维度时，度量指标全部激活并由 VisActor 双 Y 轴与 Legend 承载展示与过滤
    if (!hasSecondaryGrouping && (effectiveViewType === 'bar' || effectiveViewType === 'line')) {
      return metricOptions.map((m) => m.key);
    }
    const valid = currentActiveMetrics.filter((k) => metricOptions.some((m) => m.key === k));
    if (valid.length > 0) return valid;
    return metricOptions[0] ? [metricOptions[0].key] : [];
  }, [controlledActiveMetrics, currentActiveMetrics, metricOptions, hasSecondaryGrouping, effectiveViewType]);


  const handleMetricChange = useCallback(
    (newMetrics: string[]) => {
      if (controlledActiveMetrics === undefined) {
        setInternalActiveMetrics(newMetrics);
      }
      onMetricChange?.(newMetrics);
    },
    [controlledActiveMetrics, onMetricChange]
  );


  // 3. 容器基础样式与外部覆盖合并 (外部 style / className 最高优先级)
  const containerStyle: React.CSSProperties = {
    backgroundColor: themeConfig.colorBgContainer,
    borderRadius: 8,
    border: `1px solid ${themeConfig.colorBorder}`,
    boxShadow: isDark ? '0 2px 8px rgba(0,0,0,0.45)' : '0 2px 8px rgba(0,0,0,0.06)',
    transition: 'all 0.3s cubic-bezier(0.645, 0.045, 0.355, 1)',
    ...style,
  };

  const containerClassName = [
    'hw-dynamic-view',
    isDark ? 'hw-dynamic-view-dark' : 'hw-dynamic-view-light',
    className || '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <ConfigProvider theme={antdThemeConfig}>
      <div className={containerClassName} style={containerStyle}>
        <Spin spinning={loading}>
          {/* 头部卡片操作栏 */}
          <div
            className="hw-dynamic-view-header"
            style={{
              padding: '8px 16px',
              borderBottom: `1px solid ${themeConfig.colorBorder}`,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 12,
              height: 48,
              minHeight: 48,
              maxHeight: 48,
              boxSizing: 'border-box',
              overflow: 'hidden',
            }}
          >
            {/* 标题与同源标识区 */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                flex: 1,
                minWidth: 0,
                overflow: 'hidden',
              }}
            >
              {title && (
                <div
                  style={{
                    fontWeight: 600,
                    fontSize: 14,
                    color: themeConfig.colorText,
                    marginRight: 4,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    flexShrink: 1,
                  }}
                >
                  {title}
                </div>
              )}
            </div>

            {/* 固定位置：视图形态切换器与扩展操作槽 (常驻右上角，表格或图表形态下位置绝对恒定不偏移) */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                flexShrink: 0,
              }}
            >
              {allowViewSwitch && (
                <ViewTypeSwitcher
                  value={effectiveViewType}
                  onChange={handleViewTypeChange}
                  disabledTypes={isCrossTab ? ['bar', 'line', 'pie'] : []}
                  disabledTooltip={
                    isCrossTab
                      ? t('双向交叉透视仅支持表格视图，图表适用于单向分组模式')
                      : undefined
                  }
                />
              )}
              {extra}
            </div>
          </div>

          {/* 次级图表探索工具条 (仅在图表形态下且存在维度/指标切换项时呈现，独立承载，绝对不挤压主操作栏) */}
          {effectiveViewType !== 'table' &&
            ((allowDimensionSwitch && dimensionOptions.length > 1) ||
              (allowMetricSwitch &&
                metricOptions.length > 0 &&
                (hasSecondaryGrouping || effectiveViewType === 'pie'))) && (
              <div
                className="hw-dynamic-view-chart-toolbar"
                style={{
                  padding: '8px 16px',
                  borderBottom: `1px solid ${themeConfig.colorBorder}`,
                  backgroundColor: isDark ? 'rgba(255, 255, 255, 0.02)' : 'rgba(0, 0, 0, 0.015)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  flexWrap: 'wrap',
                }}
              >
                {/* 展示态维度切换器 */}
                {allowDimensionSwitch && dimensionOptions.length > 1 && (
                  <DimensionSwitcher
                    options={dimensionOptions}
                    activeDimension={effectiveDimensionField}
                    onChange={handleDimensionChange}
                    viewType={effectiveViewType}
                  />
                )}

                {/* 展示态二次指标切换器 */}
                {allowMetricSwitch &&
                  metricOptions.length > 0 &&
                  (hasSecondaryGrouping || effectiveViewType === 'pie') && (
                    <MetricSwitcher
                      options={metricOptions}
                      activeMetrics={effectiveActiveMetrics}
                      onChange={handleMetricChange}
                      mode={effectiveViewType === 'pie' ? 'single' : metricSelectionMode}
                      viewType={effectiveViewType}
                      colorPrimary={themeConfig.colorPrimary}
                    />
                  )}
              </div>
            )}

          {/* 主体呈现区 */}
          <div
            className="hw-dynamic-view-body"
            style={{
              padding: 16,
              minHeight: 280,
            }}
          >
            <ViewErrorBoundary key={effectiveViewType} t={t}>
              {effectiveViewType === 'table' ? (
                publishedReport ? (
                  <ReportTableView
                    report={publishedReport}
                    height={tableStyle?.height || 360}
                    style={tableStyle}
                  />
                ) : (
                  <VTableView
                    result={result}
                    dimensionField={effectiveDimensionField}
                    activeMetrics={controlledActiveMetrics !== undefined ? effectiveActiveMetrics : undefined}
                    theme={themeConfig}
                    tableFeatures={tableFeatures}
                    vtableOption={vtableOption}
                    showSummaryRow={showSummaryRow}
                    mergeCells={mergeCells}
                    showDataBars={showDataBars}
                    frozenColumnKeys={frozenColumnKeys}
                    rightFrozenColumnKeys={rightFrozenColumnKeys}
                    style={tableStyle}
                    locale={t.locale}
                    onRowSelect={onRowSelect}
                  />
                )
              ) : (
                <VChartView
                  viewType={effectiveViewType}
                  result={result}
                  dimensionField={effectiveDimensionField}
                  activeMetrics={effectiveActiveMetrics}
                  theme={themeConfig}
                  vchartSpec={vchartSpec}
                  chartStyle={chartStyle}
                  locale={t.locale}
                />
              )}
            </ViewErrorBoundary>
          </div>
        </Spin>
      </div>
    </ConfigProvider>
  );
};
