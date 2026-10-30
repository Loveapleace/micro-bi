/**
 * 展示层组件公共类型定义 (VisActor 纯 Canvas 渲染底座: VTable + VChart)
 */
import type { CSSProperties, ReactNode } from 'react';
import type { TransformResult, DataRecord, OutputColumnMeta, DynamicTransformConfig } from '../../engine/types.js';
import type { DynamicDataLocale, DeepPartial } from '../../locale/types.js';
import type { PublishedReport } from '../../report/types.js';

/** 支持的可视化展示形态 */
export type DynamicDataViewType = 'table' | 'line' | 'bar' | 'pie';

/** 样式与主题配置 Token */
export interface ViewThemeConfig {
  /** 整体明暗模式 */
  mode?: 'light' | 'dark' | undefined;
  /** 品牌主题色，默认 #1677ff */
  colorPrimary?: string | undefined;
  /** 卡片与容器背景色 */
  colorBgContainer?: string | undefined;
  /** 主文本颜色 */
  colorText?: string | undefined;
  /** 次级文本颜色 */
  colorTextSecondary?: string | undefined;
  /** 边框与分割线颜色 */
  colorBorder?: string | undefined;
  /** 图表调色板系列颜色列表 */
  chartPalette?: string[] | undefined;
}



/** 展示层核心组件 Props */
export interface DynamicDataViewProps {
  /** 管道引擎计算输出的标准结果 (TransformResult) */
  result: TransformResult;

  /** 可选的已发布报表模型输入 (MBI-16: 若提供且为表格视图，优先使用 ReportTableView 进行精确呈现) */
  publishedReport?: PublishedReport | undefined;
  queryDrillDetails?: import('../../report/drillTypes.js').DrillQuery | undefined;

  /** 点击表格行或单元格回调 */
  onRowSelect?: ((record: DataRecord, index: number, colField?: string | undefined) => void) | undefined;

  /** 当前视图形态：'table' | 'line' | 'bar' | 'pie'，默认 'table' */
  viewType?: DynamicDataViewType | undefined;
  /** 默认初始视图形态（非受控） */
  defaultViewType?: DynamicDataViewType | undefined;
  /** 视图切换回调 */
  onViewTypeChange?: ((type: DynamicDataViewType) => void) | undefined;
  /** 是否展示头部视图切换切换器，默认 true */
  allowViewSwitch?: boolean | undefined;

  /**
   * 图表维度字段键名（作为 X 轴或分类轴，受控）
   * 若缺省，由组件基于列推断优先级自动选取
   */
  dimensionField?: string | undefined;
  /** 默认初始激活的维度字段名（非受控） */
  defaultDimensionField?: string | undefined;
  /** 维度切换回调 (当用户在工具栏切换 X 轴维度时触发) */
  onDimensionChange?: ((dimension: string) => void) | undefined;
  /** 是否允许在工具栏切换 X 轴维度（当候选维度大于 1 个时生效），默认 true */
  allowDimensionSwitch?: boolean | undefined;

  /** 当前激活展示的度量指标字段名列表（展示态二次指标切换） */
  activeMetrics?: string[] | undefined;
  /** 默认初始激活的指标字段名列表（非受控，默认取首个数值列） */
  defaultActiveMetrics?: string[] | undefined;
  /** 指标切换回调 */
  onMetricChange?: ((metrics: string[]) => void) | undefined;
  /** 是否允许在工具栏切换度量指标，默认 true */
  allowMetricSwitch?: boolean | undefined;
  /**
   * 指标选择模式：
   * - 'single': 单选聚焦模式（默认，用于聚焦单个核心业务指标）
   * - 'multiple': 多选对比模式（用于折线对比或分组柱状图）
   */
  metricSelectionMode?: ('single' | 'multiple') | undefined;

  /** 样式主题配置（支持 'light' | 'dark' 简写或完整 ViewThemeConfig 对象） */
  theme?: ('light' | 'dark' | ViewThemeConfig) | undefined;
  /** 国际化语言包配置（支持传入内置 zh_CN / en_US 或任意局部词条覆盖） */
  locale?: DeepPartial<DynamicDataLocale> | undefined;
  /** 根容器样式（外部覆盖优先） */
  style?: CSSProperties | undefined;
  /** 根容器类名（外部覆盖优先） */
  className?: string | undefined;

  /** 图表容器外层样式覆盖 */
  chartStyle?: CSSProperties | undefined;

  /**
   * VisActor VChart 高级 Spec 规范覆盖
   */
  vchartSpec?: Record<string, any> | undefined;

  /** 表格容器外层样式覆盖 */
  tableStyle?: CSSProperties | undefined;

  /**
   * VisActor VTable 高级配置覆盖
   */
  vtableOption?: Record<string, any> | undefined;

  /** 是否由外部强制控制总计行显示 */
  showSummaryRow?: boolean | undefined;
  /**
   * 是否由外部强制控制相邻同类单元格合并显示
   * @deprecated 仅用于传统 VTableView legacy 纯表格模式；报表模式 (publishedReport) 下无效，合并完全跟随 Excel/Univer 工作表定义。
   */
  mergeCells?: boolean | undefined;
  /** 是否由外部强制控制微型数据条显示 */
  showDataBars?: boolean | undefined;
  /** 外部控制靠左冻结的列 key 列表 */
  frozenColumnKeys?: string[] | undefined;
  /** 外部控制靠右冻结的列 key 列表 */
  rightFrozenColumnKeys?: string[] | undefined;

  /** 是否处于加载中状态 */
  loading?: boolean | undefined;
  /** 自定义卡片标题 */
  title?: ReactNode | undefined;
  /** 自定义卡片右上角附加操作区 */
  extra?: ReactNode | undefined;

  /**
   * 表格高阶交互增强特性开关
   * - 传 true 开启所有增强特性
   * - 传 false 关闭所有增强特性
   * - 传 TableFeatureConfig 细粒度开启特定特性
   * 默认全部特性开启
   */
  tableFeatures?: boolean | TableFeatureConfig | undefined;
}

/** 表格高阶交互功能增强配置 */
export interface TableFeatureConfig {
  /** 是否启用表头下拉操作菜单（排序、冻结列、数据条等），默认 true */
  headerMenu?: boolean | undefined;
  /** 是否启用表头 Excel 风格筛选器（分类勾选搜索、数值区间），默认 true */
  filterDropdown?: boolean | undefined;
  /** 是否启用底部汇总行 (Total/Summary Row)，默认 true */
  summaryRow?: boolean | undefined;
  /** 是否启用单元格微型数据条 (Data Bars)，默认 true */
  dataBars?: boolean | undefined;
  /** 是否启用导出 (Excel/CSV/TSV)，默认 true */
  export?: boolean | undefined;
  /** 是否支持表格全屏沉浸模式，默认 true */
  fullscreen?: boolean | undefined;
  /** 是否支持列显隐控制面板，默认 true */
  columnVisibility?: boolean | undefined;
  /**
   * 是否支持同类相邻维度单元格自动合并 (如时间分桶、分类维度)，默认 true
   * @deprecated 仅用于传统 VTableView legacy 纯表格模式；报表模式 (publishedReport) 下无效，合并完全跟随 Excel/Univer 工作表定义。
   */
  mergeCells?: boolean | undefined;
  /** 是否支持鼠标直接在 Canvas 上拖拽调整列宽，默认 true */
  columnResize?: boolean | undefined;
  /** 是否支持直接在 Canvas 表头上拖拽列排序调序，默认 true */
  dragOrder?: boolean | undefined;
}

/** 指标元信息简化结构 */
export interface MetricOption {
  key: string;
  title: string;
  type: string;
}

/** 维度元信息结构 */
export interface DimensionOption {
  key: string;
  title: string;
  type: 'time' | 'text' | 'number';
}

