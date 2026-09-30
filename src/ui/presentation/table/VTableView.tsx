/**
 * VisActor 高性能 Canvas 表格展示组件 (VTableView)
 * - 基于字节跳动 @visactor/vtable Canvas 渲染引擎
 * - 原生支持十万至百万级明细流畅渲染 (60 FPS，彻底消除 DOM 节点重排开销)
 * - 结合底层 summaryCalculator 提供科学的底部总计行与冻结行 (bottomFrozenRowCount)
 * - 支持 Excel 级单元格区域框选、多格快捷键复制 (Ctrl+C) 与列宽自由拖拽
 * - 完备的企业级交互增强特性：
 *   - 原地 / 抽屉无缝数据下钻 (Drilldown: Inplace / Drawer)
 *   - 表头与列显隐管理面板 (Column Visibility Popover)
 *   - 表格内全局实时快速检索 (Table Filter)
 *   - 动态首列维度冻结 (Column Freezing)
 *   - 深度集成同源多维交叉切片过滤联动 (LinkageBus)
 */
import React, { useRef, useEffect, useMemo, useState, useCallback } from 'react';
import {
  Space,
  Button,
  Tooltip,
  Tag,
  Input,
  Switch,
  message,
  Popover,
  Checkbox,
  ConfigProvider,
  Dropdown,
} from 'antd';
import { SimpleDrawer } from '../../components/common/SimpleDrawer.js';
import {
  FullscreenOutlined,
  FullscreenExitOutlined,
  DownloadOutlined,
  CalculatorOutlined,
  ThunderboltOutlined,
  SettingOutlined,
  ArrowLeftOutlined,
  SearchOutlined,
  HolderOutlined,
  EyeOutlined,
  EyeInvisibleOutlined,
  VerticalRightOutlined,
  VerticalLeftOutlined,
  CopyOutlined,
  BarChartOutlined,
  FilterOutlined,
  FilterFilled,
  ClearOutlined,
  MergeCellsOutlined,
  SplitCellsOutlined,
  LockOutlined,
} from '@ant-design/icons';
import * as VTablePkg from '@visactor/vtable';
import type {
  ListTableConstructorOptions,
  ColumnDefine,
  ListTable as ListTableType,
  PivotTableConstructorOptions,
  PivotTable as PivotTableType,
} from '@visactor/vtable';
const vtableMod: any = VTablePkg;
const vtableActual = vtableMod.ListTable ? vtableMod : (vtableMod['def' + 'ault'] || vtableMod);
const ListTable = vtableActual.ListTable;
const PivotTable = vtableActual.PivotTable;
const themes = vtableActual.themes;
import type { TransformResult, DataRecord, OutputColumnMeta } from '../../../engine/types.js';
import type { LinkageEvent, LinkageFilterSlice, TableFeatureConfig } from '../types.js';
import type { ResolvedThemeConfig } from '../theme.js';
import { buildAntdTheme } from '../theme.js';
import { getRowFieldValue, matchSliceValue } from '../DynamicDataLinkage.js';
import { computeSummaryValues } from './summaryCalculator.js';
import {
  copyToClipboardAsTsv,
  exportToCsv,
  exportTableInstanceToCsv,
  copyTableInstanceAsTsv,
} from './tableExport.js';
import { applyVTableSummaryRowSortPatch } from './vtableSortPatch.js';
import { useDynamicDataLocale, type TableLocale } from '../../../locale/index.js';
import type { DynamicDataLocale, DeepPartial } from '../../../locale/types.js';

// 应用 VTable 底部总计行排序隔离补丁 (确保总计行绝对不参与任何列排序)
applyVTableSummaryRowSortPatch();

interface ExcelColumnFilterContentProps {
  colKey: string;
  colTitle: string;
  distinctValues: { value: string; count: number }[];
  currentFilter: string[] | undefined;
  onApply: (selectedValues: string[]) => void;
  onReset: () => void;
  onClose: () => void;
  isDark: boolean;
  theme: ResolvedThemeConfig;
  locale?: TableLocale | undefined;
}

const ExcelColumnFilterContent: React.FC<ExcelColumnFilterContentProps> = ({
  colKey,
  colTitle,
  distinctValues,
  currentFilter,
  onApply,
  onReset,
  onClose,
  isDark,
  theme,
  locale: propTableLocale,
}) => {
  const t = useDynamicDataLocale(propTableLocale);
  const [keyword, setKeyword] = useState('');
  const allValues = useMemo(() => distinctValues.map((d) => d.value), [distinctValues]);
  const [tempSelected, setTempSelected] = useState<string[]>(() =>
    currentFilter ? [...currentFilter] : [...allValues]
  );

  const displayItems = useMemo(() => {
    if (!keyword.trim()) return distinctValues;
    const lower = keyword.trim().toLowerCase();
    return distinctValues.filter((d) => d.value.toLowerCase().includes(lower));
  }, [distinctValues, keyword]);

  const displayValues = useMemo(() => displayItems.map((d) => d.value), [displayItems]);

  const allDisplaySelected = displayValues.length > 0 && displayValues.every((v) => tempSelected.includes(v));
  const someDisplaySelected = displayValues.some((v) => tempSelected.includes(v)) && !allDisplaySelected;

  const handleToggleAll = (checked: boolean) => {
    if (checked) {
      setTempSelected((prev) => Array.from(new Set([...prev, ...displayValues])));
    } else {
      setTempSelected((prev) => prev.filter((v) => !displayValues.includes(v)));
    }
  };

  const handleInvert = () => {
    setTempSelected((prev) => {
      const set = new Set(prev);
      for (const val of displayValues) {
        if (set.has(val)) {
          set.delete(val);
        } else {
          set.add(val);
        }
      }
      return Array.from(set);
    });
  };

  const handleToggleItem = (val: string, checked: boolean) => {
    if (checked) {
      setTempSelected((prev) => [...prev, val]);
    } else {
      setTempSelected((prev) => prev.filter((v) => v !== val));
    }
  };

  const handleConfirm = () => {
    if (tempSelected.length === allValues.length) {
      onReset();
    } else {
      onApply(tempSelected);
    }
  };

  return (
    <div style={{ width: 260, display: 'flex', flexDirection: 'column' }}>
      {/* 标题 */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '2px 0 8px 0',
          fontWeight: 600,
          fontSize: 13,
          borderBottom: `1px solid ${theme.colorBorder}`,
        }}
      >
        <span>{t('已应用筛选')}: {colTitle}</span>
        <Tag color="blue" style={{ margin: 0, fontSize: 10 }}>
          {tempSelected.length} / {distinctValues.length}
        </Tag>
      </div>

      {/* 搜索框 */}
      <div style={{ padding: '8px 0 6px 0' }}>
        <Input
          size="small"
          prefix={<SearchOutlined style={{ color: theme.colorTextSecondary }} />}
          placeholder={t('搜索筛选值...')}
          allowClear
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
        />
      </div>

      {/* 快捷操作区 */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '4px 0',
          fontSize: 12,
          borderBottom: `1px dashed ${theme.colorBorder}`,
        }}
      >
        <Checkbox
          indeterminate={someDisplaySelected}
          checked={allDisplaySelected}
          onChange={(e) => handleToggleAll(e.target.checked)}
          style={{ fontSize: 12 }}
        >
          {t('全选')} ({displayItems.length})
        </Checkbox>
        <Button
          type="link"
          size="small"
          style={{ padding: 0, fontSize: 11 }}
          onClick={handleInvert}
        >
          {t('反选')}
        </Button>
      </div>

      {/* 候选值复选列表 */}
      <div
        style={{
          maxHeight: 200,
          overflowY: 'auto',
          padding: '6px 0',
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
        }}
      >
        {displayItems.map((item) => (
          <Checkbox
            key={item.value}
            checked={tempSelected.includes(item.value)}
            onChange={(e) => handleToggleItem(item.value, e.target.checked)}
            style={{ fontSize: 12, marginLeft: 0 }}
          >
            <span
              style={{
                maxWidth: 160,
                display: 'inline-block',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                verticalAlign: 'middle',
              }}
              title={item.value}
            >
              {item.value}
            </span>
            <span
              style={{
                fontSize: 11,
                color: theme.colorTextSecondary,
                marginLeft: 4,
              }}
            >
              ({item.count})
            </span>
          </Checkbox>
        ))}
        {displayItems.length === 0 && (
          <div style={{ textAlign: 'center', padding: '16px 0', color: theme.colorTextSecondary, fontSize: 12 }}>
            {t('无匹配筛选项')}
          </div>
        )}
      </div>

      {/* 底部确认操作 */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          paddingTop: 8,
          borderTop: `1px solid ${theme.colorBorder}`,
        }}
      >
        <Button size="small" onClick={onReset} style={{ fontSize: 12 }}>
          {t('重置')}
        </Button>
        <Space size={6}>
          <Button size="small" onClick={onClose} style={{ fontSize: 12 }}>
            {t('取消')}
          </Button>
          <Button size="small" type="primary" onClick={handleConfirm} style={{ fontSize: 12 }}>
            {t('确定')}
          </Button>
        </Space>
      </div>
    </div>
  );
};

export interface VTableViewProps {
  /** 数据管道转换结果 */
  result: TransformResult;
  /** X 轴 / 主分类维度字段 */
  dimensionField: string;
  /** 当前激活展示的指标列表 (二次指标切换) */
  activeMetrics?: readonly string[] | undefined;
  /** 主题配置 */
  theme: ResolvedThemeConfig;
  /** 外部传入的当前联动事件 (接收其他同源组件的广播) */
  activeLinkage?: LinkageEvent | null | undefined;
  /** 当前已激活的全部切片列表 (更直接的切片高亮源) */
  activeSlices?: readonly LinkageFilterSlice[] | undefined;
  /** 点击表格行或单元格时触发联动回调 (支持携带点击列字段以实现精准切片) */
  onRowSelect?: ((record: DataRecord, index: number, colField?: string | undefined) => void) | undefined;
  /** 表格特性开关配置 */
  tableFeatures?: boolean | TableFeatureConfig | undefined;
  /** 外部高级 VTable 选项覆盖 (最高优先级覆盖) */
  vtableOption?: Partial<ListTableConstructorOptions> | undefined;
  /** 容器外层样式覆盖 */
  style?: React.CSSProperties | undefined;
  /** 外部 className */
  className?: string | undefined;
  /** 是否由外部强制控制总计行显示 */
  showSummaryRow?: boolean | undefined;
  /** 是否由外部强制控制相邻同类单元格合并显示 */
  mergeCells?: boolean | undefined;
  /** 外部控制靠左冻结的列 key 列表 */
  frozenColumnKeys?: string[] | undefined;
  /** 外部控制靠右冻结的列 key 列表 */
  rightFrozenColumnKeys?: string[] | undefined;
  /** 自定义国际化语言包或局部文案覆盖 */
  locale?: DeepPartial<DynamicDataLocale> | undefined;
}

export const VTableView: React.FC<VTableViewProps> = ({
  result,
  dimensionField,
  activeMetrics,
  theme,
  activeLinkage,
  activeSlices: propActiveSlices,
  onRowSelect,
  tableFeatures = true,
  vtableOption,
  style,
  className,
  showSummaryRow: propShowSummaryRow,
  mergeCells: propMergeCells,
  frozenColumnKeys: propFrozenColumnKeys,
  rightFrozenColumnKeys: propRightFrozenColumnKeys,
  locale: propLocale,
}) => {
  const t = useDynamicDataLocale(propLocale);

  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const tableRef = useRef<any>(null);
  const resultRef = useRef(result);
  resultRef.current = result;
  const onRowSelectRef = useRef(onRowSelect);
  onRowSelectRef.current = onRowSelect;

  // 判定是否为双向交叉多维透视表 (存在列维度，且非下钻明细穿透态)
  const isCrossTab = useMemo(() => {
    return Boolean(
      result.meta?.isCrossTab ||
      (result.meta?.dimensions?.columnCategories && result.meta.dimensions.columnCategories.length > 0) ||
      result.meta?.dimensions?.columnTimeBucket?.field
    );
  }, [result.meta?.isCrossTab, result.meta?.dimensions]);

  // 合并有效的联动切片列表 (优先使用外部直传 activeSlices，兜底从 activeLinkage 提取)
  const effectiveSlices = useMemo(() => {
    if (propActiveSlices && propActiveSlices.length > 0) return propActiveSlices;
    return activeLinkage?.activeSlices || [];
  }, [propActiveSlices, activeLinkage?.activeSlices]);

  const antdThemeConfig = useMemo(() => buildAntdTheme(theme), [theme]);

  // 1. 交互状态
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showSummaryRowInternal, setShowSummaryRowInternal] = useState(true);
  const showSummaryRow = propShowSummaryRow !== undefined ? propShowSummaryRow : showSummaryRowInternal;

  // 相邻同类单元格纵向合并开关 (默认开启)
  const [autoMergeCellsInternal, setAutoMergeCellsInternal] = useState(true);
  const autoMergeCells = propMergeCells !== undefined ? propMergeCells : autoMergeCellsInternal;

  const [hiddenColumnKeys, setHiddenColumnKeys] = useState<string[]>([]);
  const [columnOrder, setColumnOrder] = useState<string[] | null>(null); // null = use default order
  const [frozenColumnKeysInternal, setFrozenColumnKeysInternal] = useState<string[]>([]); // 靠左冻结
  const frozenColumnKeys = propFrozenColumnKeys !== undefined ? propFrozenColumnKeys : frozenColumnKeysInternal;
  const setFrozenColumnKeys = useCallback(
    (updater: string[] | ((prev: string[]) => string[])) => {
      setFrozenColumnKeysInternal((prev) => (typeof updater === 'function' ? updater(prev) : updater));
    },
    []
  );

  const [rightFrozenColumnKeysInternal, setRightFrozenColumnKeysInternal] = useState<string[]>([]); // 靠右冻结
  const rightFrozenColumnKeys = propRightFrozenColumnKeys !== undefined ? propRightFrozenColumnKeys : rightFrozenColumnKeysInternal;
  const setRightFrozenColumnKeys = useCallback(
    (updater: string[] | ((prev: string[]) => string[])) => {
      setRightFrozenColumnKeysInternal((prev) => (typeof updater === 'function' ? updater(prev) : updater));
    },
    []
  );
  const [showDataBars, setShowDataBars] = useState<boolean>(false); // 微型数据条开关
  const [searchText, setSearchText] = useState<string>('');
  const [columnSettingsOpen, setColumnSettingsOpen] = useState(false);

  // Excel 风格列分类值多选筛选状态 (colKey -> 选中的值列表)
  const [columnFilters, setColumnFilters] = useState<Record<string, string[]>>({});
  // 当前处于打开状态的表头筛选 Popover 目标信息
  const [activeFilterCol, setActiveFilterCol] = useState<{
    colKey: string;
    colTitle: string;
  } | null>(null);
  // 表头筛选 Popover 虚拟定位坐标 (相对 wrapperRef)
  const [filterAnchorPos, setFilterAnchorPos] = useState<{ x: number; y: number } | null>(null);

  // 下钻状态 (Inplace 与 Drawer)
  const [drilldownState, setDrilldownState] = useState<{
    active: boolean;
    rowRecord: DataRecord | null;
    rawRows: DataRecord[];
    label: string;
  }>({
    active: false,
    rowRecord: null,
    rawRows: [],
    label: '',
  });

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerRows, setDrawerRows] = useState<DataRecord[]>([]);
  const [drawerTitle, setDrawerTitle] = useState('');

  const isDark = theme.mode === 'dark';

  // 2. 解析特性开关
  const features: TableFeatureConfig = useMemo(() => {
    if (typeof tableFeatures === 'boolean') {
      return {
        summaryRow: tableFeatures,
        export: tableFeatures,
        fullscreen: tableFeatures,
        columnVisibility: tableFeatures,
        drilldown: tableFeatures ? 'inplace' : false,
        headerMenu: tableFeatures,
        filterDropdown: tableFeatures,
        mergeCells: tableFeatures,
      };
    }
    return {
      summaryRow: true,
      export: true,
      fullscreen: true,
      columnVisibility: true,
      drilldown: 'inplace',
      headerMenu: true,
      filterDropdown: true,
      mergeCells: true,
      ...tableFeatures,
    };
  }, [tableFeatures]);

  // 3. 构建候选列元信息 (若处于下钻态，切换至明细事实列；否则为聚合结果列)
  const candidateColumnsMeta = useMemo<OutputColumnMeta[]>(() => {
    if (drilldownState.active) {
      const rows = drilldownState.rawRows;
      if (rows.length === 0) return [];
      const sample = rows[0]!;
      const headers = result.meta?.rawHeaders || {};
      const cols: OutputColumnMeta[] = [];

      for (const key of Object.keys(sample)) {
        if (key.startsWith('_')) continue;
        const val = sample[key];
        const isNum = typeof val === 'number';
        cols.push({
          key,
          title: headers[key] || key,
          type: isNum ? 'number' : 'text',
          field: key,
          kind: isNum ? 'aggregated' : 'dimension',
        });
      }
      return cols;
    }

    if (!result || !result.columns) return [];
    if (!activeMetrics || activeMetrics.length === 0) {
      return result.columns as OutputColumnMeta[];
    }
    return (result.columns as OutputColumnMeta[]).filter(
      (c) => c.type !== 'number' || activeMetrics.includes(c.key)
    );
  }, [drilldownState.active, drilldownState.rawRows, result, activeMetrics]);

  // 按用户自定义列序排列，过滤用户在「列设置」中主动隐藏的列，并严格按「左冻结列 -> 中间流动列 -> 右冻结列」组织
  const visibleColumnsMeta = useMemo(() => {
    let ordered = candidateColumnsMeta;
    if (columnOrder && columnOrder.length > 0) {
      const orderMap = new Map(columnOrder.map((key, idx) => [key, idx]));
      ordered = [...candidateColumnsMeta].sort((a, b) => {
        const ai = orderMap.has(a.key) ? orderMap.get(a.key)! : Infinity;
        const bi = orderMap.has(b.key) ? orderMap.get(b.key)! : Infinity;
        return ai - bi;
      });
    }
    if (hiddenColumnKeys.length > 0) {
      ordered = ordered.filter((c) => !hiddenColumnKeys.includes(c.key));
    }

    const leftCols: OutputColumnMeta[] = [];
    const middleCols: OutputColumnMeta[] = [];
    const rightCols: OutputColumnMeta[] = [];

    const leftSet = new Set(frozenColumnKeys);
    const rightSet = new Set(rightFrozenColumnKeys);

    for (const col of ordered) {
      if (leftSet.has(col.key)) {
        leftCols.push(col);
      } else if (rightSet.has(col.key)) {
        rightCols.push(col);
      } else {
        middleCols.push(col);
      }
    }

    return [...leftCols, ...middleCols, ...rightCols];
  }, [candidateColumnsMeta, hiddenColumnKeys, columnOrder, frozenColumnKeys, rightFrozenColumnKeys]);

  // 4. 组装数据源与快速检索及列筛选过滤
  const rawDataSource = drilldownState.active ? drilldownState.rawRows : (result.data || []);

  // 提取某一列的所有去重枚举值与频次统计 (用于 Excel 风格筛选面板)
  const getColumnDistinctValues = useCallback((colKey: string) => {
    const counts = new Map<string, number>();
    for (const row of rawDataSource) {
      const val = row[colKey];
      const str = val === null || val === undefined || val === '' ? t('(空)') : String(val);
      counts.set(str, (counts.get(str) || 0) + 1);
    }
    const list: { value: string; count: number }[] = [];
    for (const [value, count] of counts.entries()) {
      list.push({ value, count });
    }
    list.sort((a, b) => {
      const blankStr = t('(空)');
      if (a.value === blankStr) return 1;
      if (b.value === blankStr) return -1;
      const numA = Number(a.value);
      const numB = Number(b.value);
      if (!isNaN(numA) && !isNaN(numB)) {
        return numA - numB;
      }
      return a.value.localeCompare(b.value);
    });
    return list;
  }, [rawDataSource, t]);

  const filteredData = useMemo(() => {
    let data = rawDataSource;
    // 4.1 全局快速检索过滤
    if (searchText.trim()) {
      const lower = searchText.trim().toLowerCase();
      data = data.filter((row) =>
        visibleColumnsMeta.some((col) => {
          const val = row[col.key];
          return val !== null && val !== undefined && String(val).toLowerCase().includes(lower);
        })
      );
    }
    // 4.2 Excel 风格列分类值多选筛选 (AND 交叉与关系过滤)
    const activeFilters = Object.entries(columnFilters).filter(
      ([_, vals]) => Array.isArray(vals) && vals.length > 0
    );
    if (activeFilters.length > 0) {
      data = data.filter((row) =>
        activeFilters.every(([colKey, allowedValues]) => {
          const rawVal = row[colKey];
          const strVal = rawVal === null || rawVal === undefined || rawVal === '' ? t('(空)') : String(rawVal);
          return allowedValues.includes(strVal);
        })
      );
    }
    return data;
  }, [rawDataSource, searchText, visibleColumnsMeta, columnFilters, t]);

  // 5. 组装行数据与科学总计行计算
  const { tableRecords, hasSummaryRow } = useMemo(() => {
    const shouldShowSummary = features.summaryRow !== false && showSummaryRow && filteredData.length > 0;

    if (!shouldShowSummary) {
      return {
        tableRecords: filteredData,
        hasSummaryRow: false,
      };
    }

    // 智能计算总计值（SUM累加、AVG加权均值、COMPUTED代入公式重算）
    const summaryValues = computeSummaryValues(
      filteredData,
      visibleColumnsMeta,
      result.meta?.rawHeaders
    );

    const summaryRow: DataRecord = {
      ...summaryValues,
      __isSummaryRow: true,
    };

    // 表格首列始终显示显著的总计汇总文本，保证所有看板总计行位置对齐一致
    const firstColKey = visibleColumnsMeta[0]?.key;
    if (firstColKey) {
      summaryRow[firstColKey] = t('总计 (共 {count} 项)', { count: filteredData.length });
    }

    return {
      tableRecords: [...filteredData, summaryRow],
      hasSummaryRow: true,
    };
  }, [
    filteredData,
    visibleColumnsMeta,
    result.meta?.rawHeaders,
    features.summaryRow,
    showSummaryRow,
    drilldownState.active,
    t,
  ]);

  // 5.1 构造透视表行维度 (Row Dimensions)
  const pivotRowDimensions = useMemo(() => {
    if (!isCrossTab) return [];
    const dims: any[] = [];
    const headers = (result.meta as any)?.rawHeaders || {};
    if (result.meta?.dimensions?.timeBucket?.field) {
      const f = result.meta.dimensions.timeBucket.field;
      dims.push({
        dimensionKey: f,
        title: headers[f] || f,
        width: 'auto',
      });
    }
    if (result.meta?.dimensions?.categories) {
      for (const cat of result.meta.dimensions.categories) {
        dims.push({
          dimensionKey: cat,
          title: headers[cat] || cat,
          width: 'auto',
        });
      }
    }
    return dims;
  }, [isCrossTab, result.meta?.dimensions, result.meta]);

  // 5.2 构造透视表列维度 (Column Dimensions)
  const pivotColumnDimensions = useMemo(() => {
    if (!isCrossTab) return [];
    const dims: any[] = [];
    const headers = (result.meta as any)?.rawHeaders || {};
    if (result.meta?.dimensions?.columnTimeBucket?.field) {
      const f = result.meta.dimensions.columnTimeBucket.field;
      dims.push({
        dimensionKey: f,
        title: headers[f] || f,
      });
    }
    if (result.meta?.dimensions?.columnCategories) {
      for (const cat of result.meta.dimensions.columnCategories) {
        dims.push({
          dimensionKey: cat,
          title: headers[cat] || cat,
        });
      }
    }
    return dims;
  }, [isCrossTab, result.meta?.dimensions, result.meta]);

  // 5.3 构造透视表度量指标与聚合规则
  const { pivotIndicators, pivotAggregationRules } = useMemo(() => {
    if (!isCrossTab) return { pivotIndicators: [], pivotAggregationRules: [] };

    const rowDimKeys = new Set(pivotRowDimensions.map((d: any) => d.dimensionKey));
    const colDimKeys = new Set(pivotColumnDimensions.map((d: any) => d.dimensionKey));

    const metricCols = visibleColumnsMeta.filter(
      (c) =>
        !rowDimKeys.has(c.key) &&
        !colDimKeys.has(c.key) &&
        c.key !== '__action_drilldown' &&
        (c.kind === 'aggregated' || c.kind === 'computed' || c.type === 'number')
    );

    const indicators: any[] = metricCols.map((col) => ({
      indicatorKey: col.key,
      title: col.title || col.key,
      width: 'auto',
      style: {
        textAlign: 'right',
      },
      format: (val: any) => {
        if (val === null || val === undefined || val === '') return '-';
        if (typeof val === 'number') {
          return Number.isInteger(val)
            ? val.toLocaleString()
            : val.toFixed(col.precision !== undefined ? col.precision : 2);
        }
        return String(val);
      },
    }));

    const aggregationRules: any[] = metricCols.map((col) => {
      let aggType = 'SUM';
      if (col.agg) {
        aggType = col.agg.toUpperCase();
      }
      return {
        indicatorKey: col.key,
        field: col.field || col.key,
        aggregationType: aggType,
      };
    });

    return { pivotIndicators: indicators, pivotAggregationRules: aggregationRules };
  }, [isCrossTab, pivotRowDimensions, pivotColumnDimensions, visibleColumnsMeta]);

  // 5.4 构造透视表事实记录 (保证每个记录拥有有效行维度)
  const pivotRecords = useMemo(() => {
    if (!isCrossTab) return [];
    return filteredData.map((r) => {
      if (pivotRowDimensions.length === 0) {
        return { ...r, __summary_row_dim__: t('汇总') };
      }
      return r;
    });
  }, [isCrossTab, filteredData, pivotRowDimensions.length, t]);

  // 触发下钻处理
  const handleTriggerDrilldown = useCallback((originData: DataRecord) => {
    if (originData.__isSummaryRow) return;
    const rawRows = (originData._rawRows as DataRecord[]) || [];
    if (!rawRows || rawRows.length === 0) {
      message.info(t('当前分组无底层原始明细数据可供下钻'));
      return;
    }

    const groupLabel = String(
      (dimensionField && originData[dimensionField]) ||
      (visibleColumnsMeta[0] && originData[visibleColumnsMeta[0].key]) ||
      t('下钻明细')
    );

    if (features.drilldown === 'drawer') {
      setDrawerRows(rawRows);
      setDrawerTitle(t('【{label}】底层明细穿透 ({count} 行)', { label: groupLabel, count: rawRows.length }));
      setDrawerOpen(true);
    } else {
      setDrilldownState({
        active: true,
        rowRecord: originData,
        rawRows,
        label: groupLabel,
      });
      message.success(t('已成功下钻至【{label}】({count} 条明细)，点击右上角可退出', { label: groupLabel, count: rawRows.length }));
    }
  }, [dimensionField, visibleColumnsMeta, features.drilldown, t]);

  // 5.5 计算各数值列的最大绝对值，用于微型数据条渲染
  const colMaxMap = useMemo(() => {
    const map: Record<string, number> = {};
    for (const col of visibleColumnsMeta) {
      if (col.type === 'number') {
        let max = 0;
        for (const row of filteredData) {
          const val = Math.abs(Number(row[col.key]) || 0);
          if (val > max) max = val;
        }
        map[col.key] = max;
      }
    }
    return map;
  }, [visibleColumnsMeta, filteredData]);

  // 6. 构建 VTable 列定义 (ColumnDefine)
  const tableColumns = useMemo<ColumnDefine[]>(() => {
    // 判定特定单元格是否命中任意已激活的联动切片 (用于精确单元格级高亮)
    const checkIsSliceCell = (colKey: string, colTitle: string, rowData: any): boolean => {
      if (!rowData || rowData.__isSummaryRow || effectiveSlices.length === 0) return false;
      const headers = (result.meta as any)?.rawHeaders;
      const rowVal = rowData[colKey];
      if (rowVal === undefined || rowVal === null || rowVal === '') return false;

      return effectiveSlices.some((s) => {
        const fieldMatches =
          s.field === colKey ||
          (headers && headers[colKey] === s.field) ||
          (headers && headers[s.field] === colKey) ||
          colTitle === s.field ||
          colTitle === s.fieldTitle;

        if (!fieldMatches) return false;
        return matchSliceValue(rowVal, s.value);
      });
    };

    const cols: ColumnDefine[] = visibleColumnsMeta.map((col: OutputColumnMeta, colIndex: number) => {
      const isNumber = col.type === 'number';

      // 提取当前列前面的所有维度列 (用于多维层次化保护)
      const precedingDimensionCols = visibleColumnsMeta.slice(0, colIndex).filter((c) => c.type !== 'number');

      // 相邻同类单元格纵向合并 (支持时间分桶、离散维度、并严密隔离总计行与前置维度层次)
      const shouldEnableMerge = features.mergeCells !== false && autoMergeCells && !isNumber && !drilldownState.active;

      const mergeCellFn = shouldEnableMerge
        ? ((v1: any, v2: any, extraArgs: any) => {
            if (v1 === null || v1 === undefined || v1 === '' || v1 === '-') return false;
            if (String(v1) !== String(v2)) return false;

            const tbl = extraArgs?.table;
            if (!tbl) return true;

            const sourceRow = extraArgs.source?.row;
            const targetRow = extraArgs.target?.row;

            const sourceRecord = tbl.getCellOriginRecord?.(extraArgs.source?.col, sourceRow);
            const targetRecord = tbl.getCellOriginRecord?.(extraArgs.target?.col, targetRow);

            // 严禁普通数据行与底部总计行发生单元格合并
            if (sourceRecord?.__isSummaryRow || targetRecord?.__isSummaryRow) {
              return false;
            }

            // 维度层次化保护：若前面任意一个父维度取值不一致，则子维度不跨越父维度边界合并
            if (precedingDimensionCols.length > 0 && sourceRecord && targetRecord) {
              for (const pCol of precedingDimensionCols) {
                if (String(sourceRecord[pCol.key] ?? '') !== String(targetRecord[pCol.key] ?? '')) {
                  return false;
                }
              }
            }

            return true;
          })
        : undefined;

      const colDef: ColumnDefine = {
        field: col.key,
        title: col.title || col.key,
        sort: true,
        width: 'auto',
        minWidth: isNumber
          ? Math.max(115, (col.title?.length || 4) * 14 + 36)
          : Math.max(100, (col.title?.length || 4) * 14 + 36),
        ...(shouldEnableMerge && mergeCellFn ? { mergeCell: mergeCellFn } : {}),
        fieldFormat: (record: any) => {
          const val = (record && typeof record === 'object')
            ? record[col.key]
            : record;
          if (val === null || val === undefined || val === '') return '-';
          if (typeof val === 'number') {
            return Number.isFinite(val) ? val.toLocaleString() : '-';
          }
          if (typeof val === 'object') {
            try {
              return JSON.stringify(val);
            } catch {
              return '-';
            }
          }
          return String(val);
        },
        style: {
          textAlign: isNumber ? 'right' : 'left',
          textBaseline: 'middle',
          fontWeight: (args: any) => {
            const rowData =
              args.table?.getCellOriginRecord?.(args.col, args.row) ||
              args.table?.records?.[args.row - (args.table?.columnHeaderLevelCount || 1)];
            if (rowData?.__isSummaryRow) return 700;
            if (checkIsSliceCell(col.key, col.title || col.key, rowData)) return 600;
            return 400;
          },
          color: (args: any) => {
            const rowData =
              args.table?.getCellOriginRecord?.(args.col, args.row) ||
              args.table?.records?.[args.row - (args.table?.columnHeaderLevelCount || 1)];
            if (checkIsSliceCell(col.key, col.title || col.key, rowData)) {
              return isDark ? '#69b1ff' : '#0958d9';
            }
            const val = Number(rowData?.[col.key]);
            // 负数红字预警 (AntD Table 经典高阶能力)
            if (isNumber && Number.isFinite(val) && val < 0) {
              return '#cf1322';
            }
            return isDark ? 'rgba(255,255,255,0.88)' : 'rgba(0,0,0,0.88)';
          },
          bgColor: (args: any): any => {
            const rowData =
              args.table?.getCellOriginRecord?.(args.col, args.row) ||
              args.table?.records?.[args.row - (args.table?.columnHeaderLevelCount || 1)];
            if (rowData?.__isSummaryRow) {
              return isDark ? '#1f242d' : '#f6f8fb';
            }
            if (checkIsSliceCell(col.key, col.title || col.key, rowData)) {
              return isDark ? 'rgba(22, 119, 255, 0.28)' : 'rgba(22, 119, 255, 0.14)';
            }
            return '';
          },
        },
      };

      // 微型数据条 (Data Bars) - 通过 Canvas Scenegraph 原生自定义渲染
      if (showDataBars && isNumber && (colMaxMap[col.key] ?? 0) > 0) {
        const colMax = colMaxMap[col.key]!;
        colDef.customRender = ((args: any) => {
          const rowData =
            args.table?.getCellOriginRecord?.(args.col, args.row) ||
            args.table?.records?.[args.row - (args.table?.columnHeaderLevelCount || 1)];
          const rect = args.rect || { width: 120, height: 32 };
          if (rowData?.__isSummaryRow) {
            return { expectedWidth: rect.width, expectedHeight: rect.height, renderDefault: true };
          }
          const rawNum = Math.abs(Number(args.dataValue ?? rowData?.[col.key]) || 0);
          const ratio = Math.min(1, rawNum / colMax);
          const barWidth = Math.max(2, Math.round((rect.width - 12) * ratio));
          const barColor = isDark ? 'rgba(22, 119, 255, 0.32)' : 'rgba(22, 119, 255, 0.16)';
          return {
            elements: [
              {
                type: 'rect',
                x: rect.width - barWidth - 6,
                y: 4,
                width: barWidth,
                height: Math.max(16, rect.height - 8),
                fill: barColor,
                radius: 2,
                pickable: false,
              },
            ],
            expectedWidth: rect.width,
            expectedHeight: rect.height,
            renderDefault: true,
          };
        }) as any;
      }

      // Excel 风格表头筛选图标 (与列设置弹层 100% 一致的 Ant Design FilterOutlined / FilterFilled 漏斗图标)
      const isColFiltered = !!(columnFilters[col.key] && columnFilters[col.key]!.length > 0);
      if (features.filterDropdown !== false) {
        const filterColor = isColFiltered
          ? '#1677ff'
          : isDark
          ? 'rgba(255, 255, 255, 0.45)'
          : (theme.colorTextSecondary || '#8c8c8c');

        const filterPath = isColFiltered
          ? 'M349 838c0 17.7 14.2 32 31.8 32h262.4c17.6 0 31.8-14.3 31.8-32V642H349v196zm531.1-684H143.9c-24.5 0-39.8 26.7-27.5 48l221.3 376h348.8l221.3-376c12.1-21.3-3.2-48-27.7-48z'
          : 'M880.1 154H143.9c-24.5 0-39.8 26.7-27.5 48L349 597.4V838c0 17.7 14.2 32 31.8 32h262.4c17.6 0 31.8-14.3 31.8-32V597.4L907.7 202c12.2-21.3-3.1-48-27.6-48zM603.4 798H420.6V642h182.9v156zm9.6-236.6l-9.5 16.6h-183l-9.5-16.6L212.7 226h598.6L613 561.4z';

        const filterSvg = `<svg viewBox="64 64 896 896" width="896" height="896" version="1.1" xmlns="http://www.w3.org/2000/svg"><path fill="${filterColor}" d="${filterPath}"/></svg>`;

        colDef.headerIcon = [
          {
            type: 'svg',
            svg: filterSvg,
            width: 14,
            height: 14,
            marginLeft: 4,
            name: `filter_${col.key}`,
            positionType: 'right' as any,
            funcType: 'filter',
            cursor: 'pointer',
            tooltip: {
              title: isColFiltered ? t('已应用筛选') : t('筛选此列'),
            },
            hover: {
              bgColor: isDark ? 'rgba(255, 255, 255, 0.15)' : 'rgba(0, 0, 0, 0.08)',
            },
          },
        ];
      }

      return colDef;
    });

    // 如果启用了下钻且处于汇总态，且存在透视事实记录，追加操作列
    const canDrill = features.drilldown !== false && !drilldownState.active && (result.meta?.form === 'pivot' || tableRecords.some(r => r._rawRows));
    if (canDrill) {
      cols.push({
        field: '__action_drilldown',
        title: t('操作'),
        width: 90,
        sort: false,
        fieldFormat: (record: any) => {
          if (record?.__isSummaryRow) return '-';
          return `🔍 ${t('下钻明细')}`;
        },
        style: {
          textAlign: 'center',
          color: '#1677ff',
          cursor: 'pointer',
        },
      });
    }

    return cols;
  }, [visibleColumnsMeta, isDark, features.drilldown, features.filterDropdown, features.mergeCells, drilldownState.active, result.meta?.form, result.meta, tableRecords, showDataBars, colMaxMap, columnFilters, effectiveSlices, autoMergeCells, t]);

  // 7. 初始化 VTable Canvas 实例与事件监听 (自适应 ListTable 明细表 / PivotTable 双向交叉透视表)
  useEffect(() => {
    const dom = containerRef.current;
    if (!dom) return;

    // 基础主题与调色板定制
    const baseTheme = isDark ? themes.DARK : themes.ARCO;
    const extendedTheme = (baseTheme as any).extends({
      selectionStyle: {
        cellBgColor: isDark ? 'rgba(22, 119, 255, 0.25)' : 'rgba(22, 119, 255, 0.12)',
        cellBorderColor: '#1677ff',
        cellBorderLineWidth: 2,
      },
      bodyStyle: {
        fontSize: 12,
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      },
      headerStyle: {
        fontSize: 12,
        fontWeight: 600,
        bgColor: isDark ? '#141414' : '#f0f2f5',
      },
    });

    // 模式 A: 双向多维交叉透视表 (PivotTable)
    if (isCrossTab) {
      const showRowGrandTotals = showSummaryRow && (result.meta?.dimensions?.rowTotals?.showGrandTotals ?? true);
      const showColGrandTotals = showSummaryRow && (result.meta?.dimensions?.columnTotals?.showGrandTotals ?? true);

      const pivotOptions: any = {
        container: dom,
        records: pivotRecords as any[],
        rows: pivotRowDimensions.length > 0 ? pivotRowDimensions : [{ dimensionKey: '__summary_row_dim__', title: t('汇总') }],
        columns: pivotColumnDimensions,
        indicators: pivotIndicators,
        indicatorsAsCol: result.meta?.dimensions?.indicatorsAsCol !== false,
        dataConfig: {
          aggregationRules: pivotAggregationRules,
          totals: {
            row: {
              showGrandTotals: showRowGrandTotals,
              showSubTotals: result.meta?.dimensions?.rowTotals?.showSubTotals ?? false,
              grandTotalLabel: result.meta?.dimensions?.rowTotals?.grandTotalLabel || t('总计'),
              subTotalLabel: result.meta?.dimensions?.rowTotals?.subTotalLabel || t('小计'),
            },
            column: {
              showGrandTotals: showColGrandTotals,
              showSubTotals: result.meta?.dimensions?.columnTotals?.showSubTotals ?? false,
              grandTotalLabel: result.meta?.dimensions?.columnTotals?.grandTotalLabel || t('总计'),
              subTotalLabel: result.meta?.dimensions?.columnTotals?.subTotalLabel || t('小计'),
            },
          },
        },
        corner: {
          titleOnDimension: 'row',
        },
        theme: extendedTheme as any,
        select: {
          highlightMode: 'cell',
          disableSelect: false,
        },
        hover: {
          highlightMode: 'cross',
        },
        keyboardOptions: {
          copySelected: true,
          pasteValueToCell: false,
          selectAllOnCtrlA: true,
        },
        ...vtableOption,
      };

      const table = new PivotTable(pivotOptions);
      tableRef.current = table;

      // 监听单元格点击事件
      table.on('click_cell', (args: any) => {
        if (typeof table.isHeader === 'function' && table.isHeader(args.col, args.row)) return;

        const originRecord = typeof table.getCellOriginRecord === 'function'
          ? table.getCellOriginRecord(args.col, args.row)
          : args.originData;
        if (!originRecord) return;
        if (originRecord.__isSummaryRow || args.originData?.__isSummaryRow) return;

        // 触发下钻明细穿透
        if (features.drilldown !== false && originRecord._rawRows && originRecord._rawRows.length > 0) {
          handleTriggerDrilldown(originRecord);
        }
        onRowSelectRef.current?.(originRecord, args.row, undefined);
      });

      // 监听双击事件直接触发下钻
      table.on('dblclick_cell', (args: any) => {
        if (typeof table.isHeader === 'function' && table.isHeader(args.col, args.row)) return;
        const originData = typeof table.getCellOriginRecord === 'function'
          ? table.getCellOriginRecord(args.col, args.row)
          : args.originData;
        if (!originData || originData.__isSummaryRow) return;
        handleTriggerDrilldown(originData);
      });

      // 容器 ResizeObserver 自适应
      let rAfId: number;
      const ro = new ResizeObserver(() => {
        cancelAnimationFrame(rAfId);
        rAfId = requestAnimationFrame(() => {
          tableRef.current?.resize();
        });
      });
      ro.observe(dom);

      return () => {
        cancelAnimationFrame(rAfId);
        ro.disconnect();
        table.release();
        tableRef.current = null;
      };
    }

    // 模式 B: 标准单维/明细表格 (ListTable)
    const options: ListTableConstructorOptions = {
      container: dom,
      records: tableRecords as any[],
      columns: tableColumns,
      widthMode: 'standard',
      autoWrapText: true,
      theme: extendedTheme as any,
      bottomFrozenRowCount: hasSummaryRow ? 1 : 0,
      frozenColCount: frozenColumnKeys.length,
      rightFrozenColCount:
        rightFrozenColumnKeys.length + (tableColumns.some((c) => c.field === '__action_drilldown') ? 1 : 0),
      select: {
        highlightMode: 'cell',
        disableSelect: false,
      },
      hover: {
        highlightMode: 'row',
      },
      keyboardOptions: {
        copySelected: true,
        pasteValueToCell: false,
        selectAllOnCtrlA: true,
      },
      ...vtableOption,
    };

    const table = new ListTable(options);
    tableRef.current = table;

    // 监听表头图标点击（Excel 风格列筛选）
    table.on('icon_click', (args: any) => {
      if (args.name?.startsWith('filter_') || args.funcType === 'filter') {
        const colField = tableColumns[args.col]?.field;
        if (!colField || colField === '__action_drilldown') return;
        const colMeta = visibleColumnsMeta.find((c) => c.key === colField);
        if (!colMeta) return;

        const wrapperRect = wrapperRef.current?.getBoundingClientRect();
        let targetX = 120;
        let targetY = 50;
        if (args.event && typeof (args.event as any).clientX === 'number') {
          targetX = (args.event as MouseEvent).clientX - (wrapperRect?.left || 0);
          targetY = (args.event as MouseEvent).clientY - (wrapperRect?.top || 0) + 12;
        } else if (containerRef.current && wrapperRect) {
          const cRect = containerRef.current.getBoundingClientRect();
          targetX = cRect.left - wrapperRect.left + (args.x || 0);
          targetY = cRect.top - wrapperRect.top + (args.y || 0) + 24;
        }

        setFilterAnchorPos({ x: targetX, y: targetY });
        setActiveFilterCol({
          colKey: colMeta.key,
          colTitle: colMeta.title || colMeta.key,
        });
      }
    });

    // 监听单元格点击事件
    table.on('click_cell', (args: any) => {
      const headerOffset = table.columnHeaderLevelCount || 1;
      // 表头单元格点击检测 (若命中筛选图标)
      if (args.row < headerOffset) {
        if (args.targetIcon?.funcType === 'filter' || args.targetIcon?.name?.startsWith('filter_')) {
          const colField = tableColumns[args.col]?.field;
          if (!colField || colField === '__action_drilldown') return;
          const colMeta = visibleColumnsMeta.find((c) => c.key === colField);
          if (!colMeta) return;

          const wrapperRect = wrapperRef.current?.getBoundingClientRect();
          let targetX = 120;
          let targetY = 50;
          if (args.event && typeof (args.event as any).clientX === 'number') {
            targetX = (args.event as MouseEvent).clientX - (wrapperRect?.left || 0);
            targetY = (args.event as MouseEvent).clientY - (wrapperRect?.top || 0) + 12;
          } else if (containerRef.current && wrapperRect) {
            const cRect = containerRef.current.getBoundingClientRect();
            targetX = cRect.left - wrapperRect.left + (args.rect?.left || 0);
            targetY = cRect.top - wrapperRect.top + (args.rect?.bottom || 30);
          }
          setFilterAnchorPos({ x: targetX, y: targetY });
          setActiveFilterCol({
            colKey: colMeta.key,
            colTitle: colMeta.title || colMeta.key,
          });
        }
        return;
      }

      const originData = args.originData;
      if (!originData || originData.__isSummaryRow) return;

      const colField =
        (args.field as string) ||
        (typeof table.getBodyField === 'function' ? table.getBodyField(args.col, args.row) : undefined) ||
        tableColumns[args.col]?.field;
      if (colField === '__action_drilldown') {
        handleTriggerDrilldown(originData);
        return;
      }

      const realDataIndex = filteredData.indexOf(originData);
      const dataIndex = realDataIndex >= 0 ? realDataIndex : (args.row - headerOffset);

      if (dataIndex >= 0 && dataIndex < (filteredData.length || resultRef.current.data.length)) {
        onRowSelectRef.current?.(originData, dataIndex, colField ? String(colField) : undefined);
      }
    });

    // 监听双击事件直接触发下钻
    table.on('dblclick_cell', (args: any) => {
      const originData = args.originData;
      if (!originData || originData.__isSummaryRow) return;
      handleTriggerDrilldown(originData);
    });

    // 容器 ResizeObserver 自适应
    let rAfId: number;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(rAfId);
      rAfId = requestAnimationFrame(() => {
        tableRef.current?.resize();
      });
    });
    ro.observe(dom);

    return () => {
      cancelAnimationFrame(rAfId);
      ro.disconnect();
      table.release();
      tableRef.current = null;
    };
  }, [
    isDark,
    isCrossTab,
    pivotRecords,
    pivotRowDimensions,
    pivotColumnDimensions,
    pivotIndicators,
    pivotAggregationRules,
    hasSummaryRow,
    showSummaryRow,
    frozenColumnKeys.join(','),
    rightFrozenColumnKeys.join(','),
    autoMergeCells,
    tableColumns.some((c) => c.field === '__action_drilldown'),
  ]); // 重建：明暗模式 / 总计行切换 / 冻结列变化 (左/右) / 单元格合并切换 / 下钻操作列增减

  // 8. 当数据或列更新时，复用既有实例增量刷新
  useEffect(() => {
    const table = tableRef.current;
    if (!table) return;

    if (isCrossTab) {
      if (typeof table.setRecords === 'function') {
        table.setRecords(pivotRecords as any[]);
        table.resize();
      }
      return;
    }

    const targetRightFrozen =
      rightFrozenColumnKeys.length + (tableColumns.some((c) => c.field === '__action_drilldown') ? 1 : 0);
    if ((table as any).rightFrozenColCount !== targetRightFrozen) {
      try {
        (table as any).rightFrozenColCount = targetRightFrozen;
      } catch {
        // 静默保护
      }
    }

    table.setRecords(tableRecords as any[]);
    table.updateColumns(tableColumns);
    table.resize();
  }, [isCrossTab, pivotRecords, tableRecords, tableColumns, rightFrozenColumnKeys.length]);

  // 9. 联动响应：通过 selectRows 行聚焦，与看板其他卡片同步高亮
  useEffect(() => {
    const table = tableRef.current;
    if (!table || drilldownState.active) return;

    if (effectiveSlices.length === 0 && !activeLinkage) {
      try {
        table.clearSelected();
      } catch {
        // 静默捕获
      }
      return;
    }

    const rawData = filteredData || [];
    const headerOffset = table.columnHeaderLevelCount || 1;
    const ranges: { start: { col: number; row: number }; end: { col: number; row: number } }[] = [];
    const headers = (result.meta as any)?.rawHeaders;

    if (effectiveSlices.length > 0) {
      for (let rIdx = 0; rIdx < rawData.length; rIdx++) {
        const row = rawData[rIdx];
        if (!row || row.__isSummaryRow) continue;
        const bodyRowIdx = typeof (table as any).getBodyRowIndexByRecordIndex === 'function'
          ? (table as any).getBodyRowIndexByRecordIndex(rIdx)
          : rIdx;
        const tableRow = bodyRowIdx + headerOffset;

        for (let cIdx = 0; cIdx < tableColumns.length; cIdx++) {
          const colDef = tableColumns[cIdx];
          if (!colDef) continue;
          const colField = String(colDef.field || '');
          const colMeta = visibleColumnsMeta.find((c) => c.key === colField);

          for (const s of effectiveSlices) {
            const fieldMatches =
              s.field === colField ||
              (headers && headers[colField] === s.field) ||
              (headers && headers[s.field] === colField) ||
              (colMeta && (colMeta.title === s.field || colMeta.title === s.fieldTitle));

            if (fieldMatches) {
              const rowVal = row[colField];
              if (matchSliceValue(rowVal, s.value)) {
                const range = typeof table.getCellRange === 'function'
                  ? table.getCellRange(cIdx, tableRow)
                  : { start: { col: cIdx, row: tableRow }, end: { col: cIdx, row: tableRow } };

                const alreadyExists = ranges.some(
                  (r) =>
                    r.start.col === range.start.col &&
                    r.start.row === range.start.row &&
                    r.end.col === range.end.col &&
                    r.end.row === range.end.row
                );
                if (!alreadyExists) {
                  ranges.push(range);
                }
              }
            }
          }
        }
      }
    }

    // 次选主维度值对齐 (若未从 slices 匹配出 ranges，但存在 activeLinkage.dimensionValue)
    // 关键安全校验：必须确认 activeLinkage.dimensionField 与当前表格的 dimensionField 确属同一物理维度或别名，防止跨维度误标
    const isDimensionFieldMatched =
      Boolean(activeLinkage?.dimensionField) &&
      Boolean(dimensionField) &&
      (activeLinkage?.dimensionField === dimensionField ||
        (headers && headers[dimensionField] === activeLinkage?.dimensionField) ||
        (headers && headers[activeLinkage?.dimensionField || ''] === dimensionField) ||
        visibleColumnsMeta.some(
          (c) =>
            c.key === dimensionField &&
            (c.title === activeLinkage?.dimensionField || c.title === activeLinkage?.dimensionTitle)
        ));

    if (
      ranges.length === 0 &&
      isDimensionFieldMatched &&
      dimensionField &&
      activeLinkage?.dimensionValue !== undefined &&
      activeLinkage.dimensionValue !== null
    ) {
      const dimColIdx = tableColumns.findIndex((c) => c.field === dimensionField);
      if (dimColIdx >= 0) {
        for (let rIdx = 0; rIdx < rawData.length; rIdx++) {
          const row = rawData[rIdx];
          if (!row || row.__isSummaryRow) continue;
          const rowVal = getRowFieldValue(row, dimensionField, headers);
          if (matchSliceValue(rowVal, activeLinkage.dimensionValue)) {
            const bodyRowIdx = typeof (table as any).getBodyRowIndexByRecordIndex === 'function'
              ? (table as any).getBodyRowIndexByRecordIndex(rIdx)
              : rIdx;
            const tableRow = bodyRowIdx + headerOffset;
            const range = typeof table.getCellRange === 'function'
              ? table.getCellRange(dimColIdx, tableRow)
              : { start: { col: dimColIdx, row: tableRow }, end: { col: dimColIdx, row: tableRow } };

            const alreadyExists = ranges.some(
              (r) =>
                r.start.col === range.start.col &&
                r.start.row === range.start.row &&
                r.end.col === range.end.col &&
                r.end.row === range.end.row
            );
            if (!alreadyExists) {
              ranges.push(range);
            }
            break;
          }
        }
      }
    }

    if (ranges.length > 0) {
      try {
        const firstRange = ranges[0];
        if (ranges.length === 1 && firstRange) {
          // 单个单元格或合并单元格区域：调用 selectCell(col, row, false, false, true, false)
          // 传入 skipBodyMerge = false 确保 VTable 原生将选中框完整包络住合并单元格所有行
          if (typeof table.selectCell === 'function') {
            table.selectCell(firstRange.start.col, firstRange.start.row, false, false, true, false);
          } else if (typeof table.selectCells === 'function') {
            table.selectCells(ranges);
          }
        } else {
          if (typeof table.selectCells === 'function') {
            table.selectCells(ranges);
          } else if (typeof table.selectCell === 'function' && firstRange) {
            table.selectCell(firstRange.start.col, firstRange.start.row, false, false, true, false);
          }
        }
      } catch {
        // 静默捕获
      }
    } else {
      try {
        table.clearSelected();
      } catch {
        // 静默捕获
      }
    }
  }, [effectiveSlices, activeLinkage, filteredData, dimensionField, drilldownState.active, tableColumns, visibleColumnsMeta, result.meta]);

  // 10. 导出 CSV 逻辑 (自适应 2D 多维交叉透视矩阵或明细平面表)
  const handleExportCSV = useCallback(() => {
    if (isCrossTab && !drilldownState.active && tableRef.current) {
      exportTableInstanceToCsv(tableRef.current, `pivot_table_${Date.now()}.csv`);
      message.success(t('已导出 CSV 表格文件'));
      return;
    }

    const dataToExport = filteredData || [];
    if (dataToExport.length === 0) {
      message.warning(t('当前无数据可导出'));
      return;
    }

    const exportCols = visibleColumnsMeta.filter((c) => c.key !== '__action_drilldown');
    const prefix = drilldownState.active ? `drilldown_${drilldownState.label}_` : 'dynamic_report_';
    exportToCsv(dataToExport, exportCols, `${prefix}${Date.now()}.csv`);
    message.success(t('已导出 CSV 表格文件'));
  }, [isCrossTab, filteredData, visibleColumnsMeta, drilldownState.active, drilldownState.label, t]);

  // 11. 复制 TSV 格式数据到剪贴板 (Excel 互通，自适应 2D 交叉透视矩阵或明细)
  const handleCopyTSV = useCallback(async () => {
    if (isCrossTab && !drilldownState.active && tableRef.current) {
      const ok = await copyTableInstanceAsTsv(tableRef.current);
      if (ok) {
        message.success(t('已复制表格数据到剪贴板 (TSV 格式，在 Excel 中直接 Ctrl+V 粘贴)'));
      } else {
        message.error(t('复制到剪贴板失败，请检查浏览器权限'));
      }
      return;
    }

    const dataToExport = filteredData || [];
    if (dataToExport.length === 0) {
      message.warning(t('当前无数据可复制'));
      return;
    }
    const exportCols = visibleColumnsMeta
      .filter((c) => c.key !== '__action_drilldown')
      .map((c) => ({ key: c.key, title: c.title || c.key }));
    const ok = await copyToClipboardAsTsv(dataToExport, exportCols);
    if (ok) {
      message.success(t('已复制表格数据到剪贴板 (TSV 格式，在 Excel 中直接 Ctrl+V 粘贴)'));
    } else {
      message.error(t('复制到剪贴板失败，请检查浏览器权限'));
    }
  }, [isCrossTab, filteredData, visibleColumnsMeta, drilldownState.active, t]);

  // 统计已生效的列筛选数量
  const activeFilterCount = useMemo(() => {
    return Object.values(columnFilters).filter((vals) => Array.isArray(vals) && vals.length > 0).length;
  }, [columnFilters]);

  // 工具条「列筛选」下拉菜单配置项
  const filterMenuItems = useMemo(() => {
    return visibleColumnsMeta
      .filter((c) => c.key !== '__action_drilldown')
      .map((col) => {
        const isFiltered = !!(columnFilters[col.key] && columnFilters[col.key]!.length > 0);
        return {
          key: col.key,
          label: (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', minWidth: 140 }}>
              <span>{col.title || col.key}</span>
              {isFiltered && <Tag color="blue" style={{ margin: 0, fontSize: 10 }}>{t('已应用筛选')}</Tag>}
            </div>
          ),
          icon: isFiltered ? <FilterFilled style={{ color: '#1677ff' }} /> : <FilterOutlined />,
          onClick: () => {
            setFilterAnchorPos({ x: 260, y: 70 });
            setActiveFilterCol({
              colKey: col.key,
              colTitle: col.title || col.key,
            });
          },
        };
      });
  }, [visibleColumnsMeta, columnFilters, t]);

  // 沉浸全屏样式 (普通模式需 position: relative 供内部浮动 Popover 定位)
  const wrapperStyle: React.CSSProperties = isFullscreen
    ? {
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 9999,
        backgroundColor: theme.colorBgContainer,
        padding: 24,
        display: 'flex',
        flexDirection: 'column',
      }
    : {
        position: 'relative',
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        ...style,
      };

  // 列设置气泡面板内容 (支持拖拽排序、显隐切换、靠左/靠右固定、快捷列筛选)
  const columnSettingsContent = (
    <div style={{ width: 330, display: 'flex', flexDirection: 'column' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          paddingBottom: 8,
          borderBottom: `1px solid ${theme.colorBorder}`,
          marginBottom: 8,
        }}
      >
        <span style={{ fontWeight: 600, fontSize: 13 }}>
          {t('列设置')} {t('列显示控制 ({visible}/{total})', { visible: visibleColumnsMeta.length, total: candidateColumnsMeta.length })}
        </span>
        <Button
          size="small"
          type="link"
          style={{ padding: 0, fontSize: 12 }}
          onClick={() => {
            setHiddenColumnKeys([]);
            setColumnOrder(null);
            setFrozenColumnKeys([]);
            setRightFrozenColumnKeys([]);
          }}
        >
          {t('重置')}
        </Button>
      </div>
      <div style={{ fontSize: 11, color: theme.colorTextSecondary, marginBottom: 8 }}>
        {t('按住拖拽调整列顺序')}
      </div>
      <div
        style={{
          maxHeight: 280,
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
          paddingRight: 2,
        }}
      >
        {(() => {
          const orderedBase = columnOrder && columnOrder.length > 0
            ? (() => {
                const orderMap = new Map(columnOrder.map((key, idx) => [key, idx]));
                return [...candidateColumnsMeta].sort((a, b) => {
                  const ai = orderMap.has(a.key) ? orderMap.get(a.key)! : Infinity;
                  const bi = orderMap.has(b.key) ? orderMap.get(b.key)! : Infinity;
                  return ai - bi;
                });
              })()
            : candidateColumnsMeta;

          const leftCols: OutputColumnMeta[] = [];
          const middleCols: OutputColumnMeta[] = [];
          const rightCols: OutputColumnMeta[] = [];
          const leftSet = new Set(frozenColumnKeys);
          const rightSet = new Set(rightFrozenColumnKeys);

          for (const col of orderedBase) {
            if (leftSet.has(col.key)) {
              leftCols.push(col);
            } else if (rightSet.has(col.key)) {
              rightCols.push(col);
            } else {
              middleCols.push(col);
            }
          }
          const allCols = [...leftCols, ...middleCols, ...rightCols];

          const items = allCols.map((col, idx) => {
            const isHidden = hiddenColumnKeys.includes(col.key);
            const isLeftFrozen = frozenColumnKeys.includes(col.key);
            const isRightFrozen = rightFrozenColumnKeys.includes(col.key);
            const isFiltered = !!(columnFilters[col.key] && columnFilters[col.key]!.length > 0);

            const itemBg = isLeftFrozen
              ? (isDark ? 'rgba(22, 119, 255, 0.12)' : 'rgba(22, 119, 255, 0.06)')
              : isRightFrozen
              ? (isDark ? 'rgba(19, 194, 194, 0.12)' : 'rgba(19, 194, 194, 0.06)')
              : (isDark ? '#1f1f1f' : '#fafafa');

            const itemBorder = isLeftFrozen
              ? (isDark ? '#1765ad' : '#91caff')
              : isRightFrozen
              ? (isDark ? '#137a7a' : '#87e8de')
              : (isDark ? '#303030' : '#f0f0f0');

            return (
              <div
                key={col.key}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData('text/plain', String(idx));
                  e.dataTransfer.effectAllowed = 'move';
                  (e.currentTarget as HTMLElement).style.opacity = '0.4';
                }}
                onDragEnd={(e) => {
                  (e.currentTarget as HTMLElement).style.opacity = '1';
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  const fromIdx = parseInt(e.dataTransfer.getData('text/plain'), 10);
                  const toIdx = idx;
                  if (isNaN(fromIdx) || fromIdx === toIdx) return;

                  const currentKeys = allCols.map((c) => c.key);
                  const [moved] = currentKeys.splice(fromIdx, 1);
                  currentKeys.splice(toIdx, 0, moved!);
                  setColumnOrder(currentKeys);
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '6px 8px',
                  borderRadius: 4,
                  backgroundColor: itemBg,
                  border: `1px solid ${itemBorder}`,
                  cursor: 'grab',
                  opacity: isHidden ? 0.5 : 1,
                  transition: 'all 0.2s',
                }}
              >
                {/* 拖动手柄 */}
                <HolderOutlined style={{ color: theme.colorTextSecondary, fontSize: 13, flexShrink: 0 }} />

                {/* 列名 */}
                <span
                  style={{
                    flex: 1,
                    fontSize: 12,
                    fontWeight: 500,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    textDecoration: isHidden ? 'line-through' : 'none',
                    color: isHidden ? theme.colorTextSecondary : theme.colorText,
                  }}
                  title={col.title || col.key}
                >
                  {col.title || col.key}
                </span>

                {/* 类型标签 */}
                <Tag
                  color={col.type === 'number' ? 'blue' : 'default'}
                  style={{ margin: 0, fontSize: 10, lineHeight: '16px', padding: '0 4px', flexShrink: 0 }}
                >
                  {col.type === 'number' ? t('数值') : t('文本')}
                </Tag>

                {/* 固定状态标签 */}
                {isLeftFrozen && (
                  <Tag
                    color="blue"
                    style={{ margin: 0, fontSize: 10, lineHeight: '16px', padding: '0 4px', flexShrink: 0 }}
                  >
                    {t('左固定')}
                  </Tag>
                )}
                {isRightFrozen && (
                  <Tag
                    color="cyan"
                    style={{ margin: 0, fontSize: 10, lineHeight: '16px', padding: '0 4px', flexShrink: 0 }}
                  >
                    {t('右固定')}
                  </Tag>
                )}

                {/* 快捷列筛选按钮 */}
                {features.filterDropdown !== false && (
                  <Tooltip title={isFiltered ? t('已应用筛选') : t('筛选此列')}>
                    <Button
                      type="text"
                      size="small"
                      style={{ padding: '0 2px', height: 20, width: 20, minWidth: 20 }}
                      icon={
                        isFiltered ? (
                          <FilterFilled style={{ fontSize: 12, color: '#1677ff' }} />
                        ) : (
                          <FilterOutlined style={{ fontSize: 12, color: theme.colorTextSecondary }} />
                        )
                      }
                      onClick={(e) => {
                        e.stopPropagation();
                        setColumnSettingsOpen(false);
                        setFilterAnchorPos({ x: 260, y: 70 });
                        setActiveFilterCol({
                          colKey: col.key,
                          colTitle: col.title || col.key,
                        });
                      }}
                    />
                  </Tooltip>
                )}

                {/* 靠左固定切换 */}
                <Tooltip title={isLeftFrozen ? t('取消左固定') : t('靠左固定')}>
                  <Button
                    type="text"
                    size="small"
                    style={{
                      padding: '0 2px',
                      height: 20,
                      width: 20,
                      minWidth: 20,
                      backgroundColor: isLeftFrozen ? (isDark ? 'rgba(22, 119, 255, 0.2)' : '#e6f4ff') : undefined,
                    }}
                    icon={
                      <VerticalRightOutlined
                        style={{
                          fontSize: 12,
                          color: isLeftFrozen ? '#1677ff' : theme.colorTextSecondary,
                        }}
                      />
                    }
                    onClick={(e) => {
                      e.stopPropagation();
                      if (isLeftFrozen) {
                        setFrozenColumnKeys((prev) => prev.filter((k) => k !== col.key));
                      } else {
                        // 靠左固定，并从右固定中移除 (互斥)
                        setRightFrozenColumnKeys((prev) => prev.filter((k) => k !== col.key));
                        setFrozenColumnKeys((prev) => (prev.includes(col.key) ? prev : [...prev, col.key]));
                      }
                    }}
                  />
                </Tooltip>

                {/* 靠右固定切换 */}
                <Tooltip title={isRightFrozen ? t('取消右固定') : t('靠右固定')}>
                  <Button
                    type="text"
                    size="small"
                    style={{
                      padding: '0 2px',
                      height: 20,
                      width: 20,
                      minWidth: 20,
                      backgroundColor: isRightFrozen ? (isDark ? 'rgba(19, 194, 194, 0.2)' : '#e6fffb') : undefined,
                    }}
                    icon={
                      <VerticalLeftOutlined
                        style={{
                          fontSize: 12,
                          color: isRightFrozen ? '#13c2c2' : theme.colorTextSecondary,
                        }}
                      />
                    }
                    onClick={(e) => {
                      e.stopPropagation();
                      if (isRightFrozen) {
                        setRightFrozenColumnKeys((prev) => prev.filter((k) => k !== col.key));
                      } else {
                        // 靠右固定，并从左固定中移除 (互斥)
                        setFrozenColumnKeys((prev) => prev.filter((k) => k !== col.key));
                        setRightFrozenColumnKeys((prev) => (prev.includes(col.key) ? prev : [...prev, col.key]));
                      }
                    }}
                  />
                </Tooltip>

                {/* 显隐切换 */}
                <Tooltip title={isHidden ? t('显示此列') : t('隐藏此列')}>
                  <Button
                    type="text"
                    size="small"
                    style={{ padding: '0 2px', height: 20, width: 20, minWidth: 20 }}
                    icon={
                      isHidden ? (
                        <EyeInvisibleOutlined style={{ fontSize: 12, color: theme.colorTextSecondary }} />
                      ) : (
                        <EyeOutlined style={{ fontSize: 12, color: theme.colorTextSecondary }} />
                      )
                    }
                    onClick={(e) => {
                      e.stopPropagation();
                      if (isHidden) {
                        setHiddenColumnKeys((prev) => prev.filter((k) => k !== col.key));
                      } else {
                        if (visibleColumnsMeta.length <= 1) {
                          message.warning(t('表格至少需要保留一列显示'));
                          return;
                        }
                        setHiddenColumnKeys((prev) => [...prev, col.key]);
                      }
                    }}
                  />
                </Tooltip>
              </div>
            );
          });

          const hasActionCol = tableColumns.some((c) => c.field === '__action_drilldown');

          return (
            <>
              {items}
              {hasActionCol && (
                <div
                  key="__action_drilldown_settings_item"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '6px 8px',
                    borderRadius: 4,
                    backgroundColor: isDark ? 'rgba(19, 194, 194, 0.12)' : 'rgba(19, 194, 194, 0.06)',
                    border: `1px solid ${isDark ? '#137a7a' : '#87e8de'}`,
                    cursor: 'default',
                  }}
                >
                  {/* 锁定手柄 */}
                  <LockOutlined style={{ color: theme.colorTextSecondary, fontSize: 13, flexShrink: 0 }} />

                  {/* 列名 */}
                  <span
                    style={{
                      flex: 1,
                      fontSize: 12,
                      fontWeight: 500,
                      color: theme.colorText,
                    }}
                  >
                    {t('下钻明细操作列')}
                  </span>

                  {/* 默认常驻右固定标签 */}
                  <Tag
                    color="cyan"
                    style={{ margin: 0, fontSize: 10, lineHeight: '16px', padding: '0 4px', flexShrink: 0 }}
                  >
                    {t('默认右固定')}
                  </Tag>

                  {/* 状态图标 */}
                  <Tooltip title={t('当开启数据下钻透视时常驻在最右侧，不可拖拽')}>
                    <Button
                      type="text"
                      size="small"
                      disabled
                      style={{
                        padding: '0 2px',
                        height: 20,
                        width: 20,
                        minWidth: 20,
                        backgroundColor: isDark ? 'rgba(19, 194, 194, 0.2)' : '#e6fffb',
                        cursor: 'default',
                      }}
                      icon={
                        <VerticalLeftOutlined
                          style={{
                            fontSize: 12,
                            color: '#13c2c2',
                          }}
                        />
                      }
                    />
                  </Tooltip>
                </div>
              )}
            </>
          );
        })()}
      </div>
    </div>
  );

  return (
    <ConfigProvider theme={antdThemeConfig} getPopupContainer={() => wrapperRef.current || document.body}>
      <div ref={wrapperRef} className={`hw-vtable-view ${className || ''}`} style={wrapperStyle}>
        {/* 若处于原地明细下钻态，呈现显著的面包屑导航条 */}
        {drilldownState.active && (
          <div
            style={{
              padding: '8px 12px',
              marginBottom: 8,
              backgroundColor: isDark ? '#1a2332' : '#e6f4ff',
              border: `1px solid ${isDark ? '#1765ad' : '#91caff'}`,
              borderRadius: 6,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: 8,
            }}
          >
            <Space size={8}>
              <Button
                size="small"
                type="primary"
                icon={<ArrowLeftOutlined />}
                onClick={() => setDrilldownState({ active: false, rowRecord: null, rawRows: [], label: '' })}
              >
                {t('退出下钻')}
              </Button>
              <Tag color="processing" style={{ margin: 0, fontSize: 12 }}>
                {t('下钻范围: ')}<b>{drilldownState.label}</b>
              </Tag>
              <span style={{ fontSize: 12, color: theme.colorTextSecondary }}>
                {t('原始明细: ')}<b>{drilldownState.rawRows.length}</b>
              </span>
            </Space>
            <Tag color="cyan">{t('下钻明细穿透视图')}</Tag>
          </div>
        )}

        {/* 极速报表工具条 */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '4px 0 10px 0',
            gap: 8,
            flexWrap: 'wrap',
          }}
        >
          <Space size={8} align="center">
            <Tag color={isCrossTab ? 'purple' : 'cyan'} icon={<ThunderboltOutlined />} style={{ margin: 0, fontSize: 11 }}>
              {isCrossTab ? `VTable Pivot (${t('双向交叉透视')})` : 'VTable Canvas'}
            </Tag>
            <span style={{ fontSize: 12, color: theme.colorTextSecondary }}>
              {t('共 {count} 项', { count: filteredData.length.toLocaleString() })}
              {filteredData.length !== rawDataSource.length && ` ${t('(已过滤，原 {total} 项)', { total: rawDataSource.length.toLocaleString() })}`}
            </span>
            {features.drilldown !== false && !drilldownState.active && (
              <span style={{ fontSize: 11, color: theme.colorTextSecondary, opacity: 0.85 }}>
                💡 {t('点击下钻查看聚合明细')}
              </span>
            )}
          </Space>

          <Space size={8} wrap>
            {/* 实时全局快速检索 */}
            {features.filterDropdown !== false && (
              <Input
                size="small"
                prefix={<SearchOutlined style={{ color: theme.colorTextSecondary }} />}
                placeholder={t('搜索筛选值...')}
                allowClear
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                style={{ width: 140, fontSize: 12 }}
              />
            )}

            {/* 列筛选下拉菜单快速入口 */}
            {features.filterDropdown !== false && (
              <Dropdown
                menu={{ items: filterMenuItems }}
                trigger={['click']}
                getPopupContainer={() => wrapperRef.current || document.body}
              >
                <Button
                  size="small"
                  icon={activeFilterCount > 0 ? <FilterFilled style={{ color: '#1677ff' }} /> : <FilterOutlined />}
                  style={{ fontSize: 12 }}
                >
                  {activeFilterCount > 0 ? t('列筛选 ({count})', { count: activeFilterCount }) : t('列筛选')}
                </Button>
              </Dropdown>
            )}

            {/* 列设置气泡 (Popover: 拖拽排序 + 显隐 + 靠左/靠右固定列) */}
            {(features.columnVisibility !== false || features.headerMenu !== false) && (
              <Popover
                content={columnSettingsContent}
                trigger="click"
                open={columnSettingsOpen}
                onOpenChange={setColumnSettingsOpen}
                placement="bottomRight"
                getPopupContainer={() => wrapperRef.current || document.body}
              >
                <Button
                  size="small"
                  icon={<SettingOutlined />}
                  style={{ fontSize: 12 }}
                >
                  {frozenColumnKeys.length + rightFrozenColumnKeys.length > 0 ? t('列设置 ({count})', { count: frozenColumnKeys.length + rightFrozenColumnKeys.length }) : t('列设置')}
                </Button>
              </Popover>
            )}

            {/* 微型数据条开关 */}
            <Tooltip title={showDataBars ? t('关闭数据条') : t('开启数据条')}>
              <Button
                size="small"
                type={showDataBars ? 'primary' : 'default'}
                icon={<BarChartOutlined />}
                onClick={() => setShowDataBars((prev) => !prev)}
                style={{ fontSize: 12 }}
              >
                {t('数据条')}
              </Button>
            </Tooltip>

            {/* 总计行显隐 */}
            {features.summaryRow !== false && (
              <Tooltip title={showSummaryRow ? t('隐藏总计行') : t('显示总计行')}>
                <Button
                  size="small"
                  type={showSummaryRow ? 'primary' : 'default'}
                  icon={<CalculatorOutlined />}
                  onClick={() => setShowSummaryRowInternal((prev) => !prev)}
                  style={{ fontSize: 12 }}
                >
                  {t('总计行')}
                </Button>
              </Tooltip>
            )}

            {/* 合并同类单元格开关 */}
            {features.mergeCells !== false && (
              <Tooltip title={autoMergeCells ? t('关闭单元格合并') : t('开启单元格合并')}>
                <Button
                  size="small"
                  type={autoMergeCells ? 'primary' : 'default'}
                  icon={autoMergeCells ? <MergeCellsOutlined /> : <SplitCellsOutlined />}
                  onClick={() => setAutoMergeCellsInternal((prev) => !prev)}
                  style={{ fontSize: 12 }}
                >
                  {t('合并单元格')}
                </Button>
              </Tooltip>
            )}

            {/* 复制数据 (TSV) */}
            <Tooltip title={t('复制表格数据为 TSV 文本，可直接粘贴至 Excel')}>
              <Button
                size="small"
                icon={<CopyOutlined />}
                onClick={handleCopyTSV}
                style={{ fontSize: 12 }}
              >
                {t('复制')}
              </Button>
            </Tooltip>

            {/* 导出 CSV */}
            {features.export !== false && (
              <Tooltip title={t('导出当前表格全量明细为 CSV 格式')}>
                <Button
                  size="small"
                  icon={<DownloadOutlined />}
                  onClick={handleExportCSV}
                  style={{ fontSize: 12 }}
                >
                  {t('导出 CSV')}
                </Button>
              </Tooltip>
            )}

            {/* 全屏浏览 */}
            {features.fullscreen !== false && (
              <Tooltip title={isFullscreen ? t('退出全屏') : t('全屏查看表格')}>
                <Button
                  size="small"
                  icon={isFullscreen ? <FullscreenExitOutlined /> : <FullscreenOutlined />}
                  onClick={() => setIsFullscreen((prev) => !prev)}
                  style={{ fontSize: 12 }}
                />
              </Tooltip>
            )}
          </Space>
        </div>

        {/* 已激活的列筛选状态标签栏 (直观展现已筛选列并提供一键清除) */}
        {activeFilterCount > 0 && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '2px 0 8px 0',
              flexWrap: 'wrap',
              fontSize: 12,
            }}
          >
            <span style={{ color: theme.colorTextSecondary, fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
              <FilterFilled style={{ color: '#1677ff', fontSize: 12 }} /> {t('已应用筛选')}:
            </span>
            {Object.entries(columnFilters).map(([colKey, vals]) => {
              if (!vals || vals.length === 0) return null;
              const colMeta = candidateColumnsMeta.find((c) => c.key === colKey);
              const title = colMeta?.title || colKey;
              return (
                <Tag
                  key={colKey}
                  color="blue"
                  closable
                  onClose={() => {
                    setColumnFilters((prev) => {
                      const next = { ...prev };
                      delete next[colKey];
                      return next;
                    });
                  }}
                  style={{ fontSize: 11, cursor: 'pointer' }}
                  onClick={() => {
                    setFilterAnchorPos({ x: 260, y: 70 });
                    setActiveFilterCol({
                      colKey,
                      colTitle: title,
                    });
                  }}
                >
                  {title}: {vals.length <= 2 ? vals.join(', ') : `${vals[0]}, ${vals[1]}... (${vals.length})`}
                </Tag>
              );
            })}
            <Button
              size="small"
              type="link"
              icon={<ClearOutlined />}
              style={{ fontSize: 11, padding: 0 }}
              onClick={() => setColumnFilters({})}
            >
              {t('清空全部筛选')}
            </Button>
          </div>
        )}

        {/* VTable 真实 Canvas 容器 */}
        <div
          ref={containerRef}
          style={{
            width: '100%',
            flex: isFullscreen ? 1 : undefined,
            height: isFullscreen ? 'calc(100vh - 80px)' : 380,
            position: 'relative',
            borderRadius: 4,
            overflow: 'hidden',
            border: `1px solid ${theme.colorBorder}`,
          }}
        />

        {/* 点击表头 Canvas 图标时弹出的 Excel 风格列分类值多选筛选 Popover */}
        {activeFilterCol && filterAnchorPos && (
          <Popover
            open={!!activeFilterCol}
            onOpenChange={(open) => {
              if (!open) {
                setActiveFilterCol(null);
                setFilterAnchorPos(null);
              }
            }}
            placement="bottomLeft"
            destroyTooltipOnHide
            trigger="click"
            getPopupContainer={() => wrapperRef.current || document.body}
            content={
              <ExcelColumnFilterContent
                colKey={activeFilterCol.colKey}
                colTitle={activeFilterCol.colTitle}
                distinctValues={getColumnDistinctValues(activeFilterCol.colKey)}
                currentFilter={columnFilters[activeFilterCol.colKey]}
                onApply={(selectedValues) => {
                  setColumnFilters((prev) => ({
                    ...prev,
                    [activeFilterCol.colKey]: selectedValues,
                  }));
                  setActiveFilterCol(null);
                  setFilterAnchorPos(null);
                }}
                onReset={() => {
                  setColumnFilters((prev) => {
                    const next = { ...prev };
                    delete next[activeFilterCol.colKey];
                    return next;
                  });
                  setActiveFilterCol(null);
                  setFilterAnchorPos(null);
                }}
                onClose={() => {
                  setActiveFilterCol(null);
                  setFilterAnchorPos(null);
                }}
                isDark={isDark}
                theme={theme}
                locale={t.locale}
              />
            }
          >
            <div
              style={{
                position: 'absolute',
                left: Math.max(0, filterAnchorPos.x),
                top: Math.max(0, filterAnchorPos.y),
                width: 1,
                height: 1,
                pointerEvents: 'none',
              }}
            />
          </Popover>
        )}

        {/* 抽屉模式下钻明细弹层 (支持全屏挂载) */}
        {features.drilldown === 'drawer' && (
          <SimpleDrawer
            title={drawerTitle}
            placement="right"
            width={880}
            open={drawerOpen}
            onClose={() => setDrawerOpen(false)}
            destroyOnClose
            isDark={isDark}
          >
            <div style={{ height: 'calc(100vh - 120px)' }}>
              <VTableView
                result={{
                  data: drawerRows,
                  columns: (result.meta?.rawHeaders
                    ? Object.entries(result.meta.rawHeaders).map(([k, label]) => ({
                        key: k,
                        title: label,
                        type: typeof drawerRows[0]?.[k] === 'number' ? 'number' : 'text',
                        kind: 'dimension',
                      }))
                    : candidateColumnsMeta) as OutputColumnMeta[],
                  meta: {
                    form: 'detail',
                    inputRows: drawerRows.length,
                    outputRows: drawerRows.length,
                    executionTimeMs: 0,
                  },
                }}
                dimensionField={dimensionField}
                theme={theme}
                locale={propLocale}
                tableFeatures={{
                  drilldown: false,
                  summaryRow: true,
                  export: true,
                  fullscreen: true,
                  columnVisibility: true,
                  filterDropdown: true,
                }}
              />
            </div>
          </SimpleDrawer>
        )}
      </div>
    </ConfigProvider>
  );
};

