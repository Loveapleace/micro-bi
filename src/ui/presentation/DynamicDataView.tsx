/**
 * 展示层统一可视化门面组件 (DynamicDataView)
 * - 接收底层标准 TransformResult
 * - 提供 Table / Line / Bar / Pie 多视图无缝切换
 * - 严格显式契约 datasetId 的同源跨组件数据联动
 * - 展示态二次指标切换（轻量级零拷贝投影）
 * - 第三方宿主样式隔离与全覆盖能力 (className / style / vchartSpec / vtableOption)
 */
import React, { useState, useMemo, useRef, useCallback } from 'react';
import { Card, Space, Typography, ConfigProvider, Spin, Button, Tooltip, Tag, Result, message } from 'antd';
import { ClearOutlined, LinkOutlined } from '@ant-design/icons';
import type { TransformResult, DataRecord, OutputColumnMeta } from '../../engine/types.js';
import { transformData } from '../../engine/pipeline.js';
import type {
  DynamicDataViewProps,
  DynamicDataViewType,
  MetricOption,
  DimensionOption,
  LinkageEvent,
  LinkageFilterSlice,
} from './types.js';
import { resolveThemeConfig, buildAntdTheme } from './theme.js';
import { useDynamicDataLinkage, getRowFieldValue, matchSliceValue } from './DynamicDataLinkage.js';
import { MetricSwitcher } from './toolbar/MetricSwitcher.js';
import { DimensionSwitcher } from './toolbar/DimensionSwitcher.js';
import { ViewTypeSwitcher } from './toolbar/ViewTypeSwitcher.js';
import { VTableView } from './table/VTableView.js';
import { VChartView } from './charts/VChartView.js';
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
  rawDataset,
  transformConfig,
  datasetId,
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
  frozenColumnKeys,
  rightFrozenColumnKeys,

  linkage = true,
  linkageMode = 'filter',
  allowEmitLinkage = true,
  allowReceiveLinkage = true,
  onLinkageChange,

  loading = false,
  title,
  extra,
  tableFeatures = true,
}) => {
  // 生成组件稳定内部唯一 ID（用于防自环广播）
  const viewIdRef = useRef<string>(`view_${Math.random().toString(36).substring(2, 9)}`);
  const viewId = viewIdRef.current;

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
  const [internalViewType, setInternalViewType] = useState<DynamicDataViewType>(defaultViewType);
  const currentViewType = controlledViewType !== undefined ? controlledViewType : internalViewType;

  // 外部 defaultViewType 更新时响应同步
  React.useEffect(() => {
    if (defaultViewType) {
      setInternalViewType(defaultViewType);
    }
  }, [defaultViewType]);

  const handleViewTypeChange = useCallback(
    (newType: DynamicDataViewType) => {
      if (controlledViewType === undefined) {
        setInternalViewType(newType);
      }
      onViewTypeChange?.(newType);
    },
    [controlledViewType, onViewTypeChange]
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
      if (currentViewType === 'pie') {
        return valid.length > 0 ? [valid[0]!] : (metricOptions[0] ? [metricOptions[0].key] : []);
      }
      return valid.length > 0 ? valid : metricOptions.map((m) => m.key);
    }
    // 饼图视图下：必须强制单指标，表示该指标在不同分类维度间的占比构成
    if (currentViewType === 'pie') {
      const firstValid = currentActiveMetrics.find((k) => metricOptions.some((m) => m.key === k));
      return firstValid ? [firstValid] : (metricOptions[0] ? [metricOptions[0].key] : []);
    }
    // 表格视图下，若未外部显式受控，默认激活全部度量指标（与配置面板即时预览保持 100% 对齐）
    if (currentViewType === 'table') {
      return metricOptions.map((m) => m.key);
    }
    // 当处于柱状图/折线图且不存在次级分组维度时，度量指标全部激活并由 VisActor 双 Y 轴与 Legend 承载展示与过滤
    if (!hasSecondaryGrouping && (currentViewType === 'bar' || currentViewType === 'line')) {
      return metricOptions.map((m) => m.key);
    }
    const valid = currentActiveMetrics.filter((k) => metricOptions.some((m) => m.key === k));
    if (valid.length > 0) return valid;
    return metricOptions[0] ? [metricOptions[0].key] : [];
  }, [controlledActiveMetrics, currentActiveMetrics, metricOptions, hasSecondaryGrouping, currentViewType]);


  const handleMetricChange = useCallback(
    (newMetrics: string[]) => {
      if (controlledActiveMetrics === undefined) {
        setInternalActiveMetrics(newMetrics);
      }
      onMetricChange?.(newMetrics);
    },
    [controlledActiveMetrics, onMetricChange]
  );

  // 5. 显式同源数据联动逻辑 (严格依赖 datasetId 显式契约)
  const {
    activeEvent,
    activeSlices,
    toggleSlice,
    removeSlice,
    clearSlices,
    emitLinkage,
    isLinked,
  } = useDynamicDataLinkage(
    datasetId,
    viewId,
    linkage !== false
  );

  // 当外部需要感知联动事件时触发回调
  React.useEffect(() => {
    onLinkageChange?.(activeEvent);
  }, [activeEvent, onLinkageChange]);

  // 处理图表点击触发切片联动
  const handleChartDataSelect = useCallback(
    (payload: {
      dimensionValue: string | number;
      dimensionField?: string | undefined;
      dimensionTitle?: string | undefined;
      secondaryField?: string | undefined;
      secondaryValue?: string | number | undefined;
      secondaryTitle?: string | undefined;
      metricKey?: string | undefined;
      dataIndex: number;
      record?: DataRecord | undefined;
    }) => {
      if (!isLinked || !allowEmitLinkage) return;

      // 智能识别点击的切片字段：
      // 如果柱子或点来自次级分组维度（例如按承制车间分组的柱子），点击即切片该承制车间！
      // 否则切片主维度（如月份时间）
      const hasSecondary = Boolean(payload.secondaryField && payload.secondaryValue !== undefined && payload.secondaryValue !== null && payload.secondaryValue !== '');
      const field = hasSecondary
        ? payload.secondaryField!
        : payload.dimensionField || effectiveDimensionField;
      const val = hasSecondary
        ? payload.secondaryValue!
        : payload.dimensionValue;

      if (!field || val === undefined || val === null || val === '') return;

      const title =
        (hasSecondary ? payload.secondaryTitle : payload.dimensionTitle) ||
        dimensionOptions.find((d) => d.key === field)?.title ||
        result.columns?.find((c) => c.key === field)?.title ||
        field;

      toggleSlice({
        field,
        fieldTitle: title,
        value: val,
        record: payload.record,
      });

      const isAlreadyActive = activeSlices.some((s) => s.field === field && String(s.value) === String(val));
      if (isAlreadyActive) {
        message.info(t('已取消按 {title} 联动过滤', { title }));
      } else {
        message.success(t('已按 {title} = {val} 触发全图表联动', { title, val }));
      }
    },
    [isLinked, allowEmitLinkage, effectiveDimensionField, dimensionOptions, result.columns, toggleSlice, activeSlices, t]
  );

  // 处理表格行或单元格点击触发切片联动
  const handleTableRowSelect = useCallback(
    (record: DataRecord, index: number, colField?: string) => {
      if (!isLinked || !allowEmitLinkage) return;

      // 智能判定点击字段：
      // 1. 若用户点击了具体的离散分类/时间维度单元格（如点击了「承制车间」列），精准以该维度进行切片！
      // 2. 若点击了度量数值列或未明确列，以当前卡片的主分类维度（effectiveDimensionField）进行切片
      const colMeta = colField
        ? result.columns?.find((c) => c.key === colField || c.field === colField)
        : undefined;
      const isDimensionCol = colMeta ? colMeta.type !== 'number' : false;
      const field = (isDimensionCol && colField)
        ? colField
        : effectiveDimensionField || (result.columns && result.columns[0]?.key);
      if (!field) return;

      const rawVal = getRowFieldValue(
        record,
        field,
        transformConfig?.headers || (result.meta as any)?.rawHeaders
      );
      const val =
        typeof rawVal === 'string' || typeof rawVal === 'number'
          ? rawVal
          : rawVal === null
          ? null
          : undefined;

      if (val === undefined || val === null || val === '') return;

      const title =
        colMeta?.title ||
        dimensionOptions.find((d) => d.key === field)?.title ||
        result.columns?.find((c) => c.key === field)?.title ||
        (transformConfig?.headers && transformConfig.headers[field]) ||
        field;

      toggleSlice({
        field,
        fieldTitle: title,
        value: val,
        record,
      });

      const isAlreadyActive = activeSlices.some(
        (s) => s.field === field && (String(s.value) === String(val) || matchSliceValue(s.value, val))
      );
      if (isAlreadyActive) {
        message.info(t('已取消按 {title} 联动过滤', { title }));
      } else {
        message.success(t('已按 {title} = {val} 触发全图表联动', { title, val }));
      }
    },
    [isLinked, allowEmitLinkage, effectiveDimensionField, result.columns, result.meta, dimensionOptions, toggleSlice, activeSlices, transformConfig, t]
  );

  // 计算外部生效切片以及动态切片重算结果 (Cross-Filtering)
  const externalSlices = useMemo(() => {
    if (!isLinked || !allowReceiveLinkage || linkageMode !== 'filter') {
      return [];
    }
    // 过滤出由其他视图发射的切片，防止自环过滤导致自身图表元素全部消失
    return activeSlices.filter((s) => s.sourceViewId !== viewId);
  }, [isLinked, allowReceiveLinkage, linkageMode, activeSlices, viewId]);

  const effectiveResult = useMemo(() => {
    if (externalSlices.length === 0) {
      return result;
    }

    // 方案 1: 内存级底层明细事实记录动态重聚合 (首选高保真方案)
    // 若宿主传入了 rawDataset 与 transformConfig，则在 raw 数据层做多维切片过滤，
    // 并完整重新走一遍 transformData 引擎管线。这样聚合度量（如 AVG 加权平均）、
    // 计算列（如不良率%、达成率%）、总计行等全部依据切片后数据重新精确计算，100% 严谨。
    if (rawDataset && rawDataset.length > 0 && transformConfig) {
      try {
        const headers = transformConfig.headers || (result.meta as any)?.rawHeaders;
        const filteredRaw = rawDataset.filter((row) =>
          externalSlices.every((slice) => {
            const val = getRowFieldValue(row, slice.field, headers);
            return matchSliceValue(val, slice.value);
          })
        );
        const res = transformData(filteredRaw, transformConfig);
        // 如果切片后为 0 行，保留原 result 的 columns 定义，防止表格表头结构坍塌丢失
        if (res.columns.length === 0 && result.columns && result.columns.length > 0) {
          return {
            ...res,
            columns: result.columns,
          };
        }
        return res;
      } catch (err) {
        console.warn('[DynamicDataView] Raw transform recalculation failed, fallback to result data filter:', err);
      }
    }

    // 方案 2: 降级方案 - 若未提供 rawDataset，直接在 result.data 上进行切片过滤
    if (result && result.data) {
      const headers = transformConfig?.headers || (result.meta as any)?.rawHeaders;
      const filteredRows = result.data.filter((row) =>
        externalSlices.every((slice) => {
          const val = getRowFieldValue(row, slice.field, headers);
          if (val === undefined) {
            return true;
          }
          return matchSliceValue(val, slice.value);
        })
      );
      return {
        ...result,
        data: filteredRows,
      };
    }

    return result;
  }, [result, rawDataset, transformConfig, externalSlices]);

  // 6. 容器基础样式与外部覆盖合并 (外部 style / className 最高优先级)
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
    isLinked ? 'hw-dynamic-view-linked-ready' : '',
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
              padding: '10px 16px',
              borderBottom: `1px solid ${themeConfig.colorBorder}`,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 12,
              minHeight: 48,
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
              {isLinked && (
                <Tooltip title={t('所属工业数据集: {id}（点击右侧切片可进行联动过滤）', { id: datasetId || '' })}>
                  <Tag
                    color="processing"
                    icon={<LinkOutlined />}
                    style={{
                      margin: 0,
                      fontSize: 11,
                      flexShrink: 0,
                      maxWidth: 160,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      verticalAlign: 'bottom',
                    }}
                  >
                    {datasetId}
                  </Tag>
                </Tooltip>
              )}
              {isLinked && activeSlices.length > 0 && (
                <Space size={4} wrap style={{ flexShrink: 0 }}>
                  {activeSlices.map((slice) => {
                    const isSelf = slice.sourceViewId === viewId;
                    return (
                      <Tag
                        key={slice.field}
                        color={isSelf ? 'blue' : 'orange'}
                        closable
                        onClose={(e) => {
                          e.preventDefault();
                          removeSlice(slice.field);
                        }}
                        style={{ margin: 0, fontSize: 11, display: 'inline-flex', alignItems: 'center' }}
                      >
                        <span>
                          {slice.fieldTitle || slice.field}: <b>{String(slice.value)}</b>
                        </span>
                        {isSelf && <span style={{ opacity: 0.7, marginLeft: 3, fontSize: 10 }}>{t('(当前视图)')}</span>}
                      </Tag>
                    );
                  })}
                  <Tooltip title={t('重置当前看板专属维度切片')}>
                    <Button
                      type="text"
                      size="small"
                      icon={<ClearOutlined />}
                      onClick={clearSlices}
                      style={{ padding: '0 4px', height: 22, color: themeConfig.colorTextSecondary }}
                    />
                  </Tooltip>
                </Space>
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
                  value={currentViewType}
                  onChange={handleViewTypeChange}
                />
              )}
              {extra}
            </div>
          </div>

          {/* 次级图表探索工具条 (仅在图表形态下且存在维度/指标切换项时呈现，独立承载，绝对不挤压主操作栏) */}
          {currentViewType !== 'table' &&
            ((allowDimensionSwitch && dimensionOptions.length > 1) ||
              (allowMetricSwitch &&
                metricOptions.length > 0 &&
                (hasSecondaryGrouping || currentViewType === 'pie'))) && (
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
                    viewType={currentViewType}
                  />
                )}

                {/* 展示态二次指标切换器 */}
                {allowMetricSwitch &&
                  metricOptions.length > 0 &&
                  (hasSecondaryGrouping || currentViewType === 'pie') && (
                    <MetricSwitcher
                      options={metricOptions}
                      activeMetrics={effectiveActiveMetrics}
                      onChange={handleMetricChange}
                      mode={currentViewType === 'pie' ? 'single' : metricSelectionMode}
                      viewType={currentViewType}
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
            {/* 联动切片显著指示条 (Cross-Filter Status Bar) */}
            {isLinked && activeSlices.length > 0 && (
              <div
                style={{
                  marginBottom: 12,
                  padding: '6px 12px',
                  backgroundColor: themeConfig.mode === 'dark' ? 'rgba(22, 119, 255, 0.12)' : '#e6f4ff',
                  border: `1px solid ${themeConfig.mode === 'dark' ? '#1765ad' : '#91caff'}`,
                  borderRadius: 6,
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: 8,
                }}
              >
                <Space size={6} wrap align="center">
                  <Tag color="processing" icon={<LinkOutlined />} style={{ margin: 0, fontSize: 11 }}>
                    {t('同源联动切片生效中')}
                  </Tag>
                  <span style={{ fontSize: 12, color: themeConfig.colorText }}>
                    {externalSlices.length > 0
                      ? t('依据 {slices} 过滤中', {
                          slices: externalSlices.map((s) => `【${s.fieldTitle || s.field}: ${String(s.value)}】`).join(' + '),
                        })
                      : t('正在向同源其他分析看板广播过滤切片')}
                  </span>
                  {activeSlices.map((slice) => {
                    const isSelf = slice.sourceViewId === viewId;
                    return (
                      <Tag
                        key={slice.field}
                        color={isSelf ? 'blue' : 'orange'}
                        closable
                        onClose={(e) => {
                          e.preventDefault();
                          removeSlice(slice.field);
                        }}
                        style={{ margin: 0, fontSize: 12 }}
                      >
                        <b>{slice.fieldTitle || slice.field}</b>: {String(slice.value)}
                        {isSelf && <span style={{ opacity: 0.7, marginLeft: 4, fontSize: 11 }}>{t('(当前视图)')}</span>}
                      </Tag>
                    );
                  })}
                </Space>
                <Button
                  size="small"
                  type="link"
                  onClick={clearSlices}
                  style={{ padding: 0, fontSize: 12 }}
                >
                  {t('清除全部')}
                </Button>
              </div>
            )}

            <ViewErrorBoundary key={currentViewType} t={t}>
              {currentViewType === 'table' ? (
                <VTableView
                  result={effectiveResult}
                  dimensionField={effectiveDimensionField}
                  activeMetrics={controlledActiveMetrics !== undefined ? effectiveActiveMetrics : undefined}
                  theme={themeConfig}
                  activeLinkage={activeEvent}
                  activeSlices={activeSlices}
                  onRowSelect={handleTableRowSelect}
                  tableFeatures={tableFeatures}
                  vtableOption={vtableOption}
                  frozenColumnKeys={frozenColumnKeys}
                  rightFrozenColumnKeys={rightFrozenColumnKeys}
                  style={tableStyle}
                  locale={t.locale}
                />
              ) : (
                <VChartView
                  viewType={currentViewType}
                  result={effectiveResult}
                  dimensionField={effectiveDimensionField}
                  activeMetrics={effectiveActiveMetrics}
                  theme={themeConfig}
                  vchartSpec={vchartSpec}
                  chartStyle={chartStyle}
                  activeLinkage={activeEvent}
                  onSelectData={handleChartDataSelect}
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
