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
  Modal,
  Table,
} from 'antd';
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
  LockOutlined,
  DownOutlined,
  FileExcelOutlined,
  TableOutlined,
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
import type { TableFeatureConfig, CellDrillthroughInfo } from '../types.js';
import type { ResolvedThemeConfig } from '../theme.js';
import { buildAntdTheme } from '../theme.js';
import { computeSummaryValues, createPivotAggregationRules } from './summaryCalculator.js';
import { cloneTransformRecord } from '../../../engine/recordMetadata.js';
import {
  copyToClipboardAsTsv,
  exportToCsv,
  exportTableInstanceToCsv,
  copyTableInstanceAsTsv,
  exportToHtmlExcel,
  exportTableInstanceToExcel,
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
    <div
      style={{ width: 260, display: 'flex', flexDirection: 'column' }}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
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

export interface PivotDrillthroughModalProps {
  open: boolean;
  title: string;
  records: DataRecord[];
  rawHeaders?: Record<string, string> | undefined;
  onClose: () => void;
  isDark: boolean;
  theme: ResolvedThemeConfig;
  locale?: TableLocale | undefined;
}

export const PivotDrillthroughModal: React.FC<PivotDrillthroughModalProps> = ({
  open,
  title,
  records,
  rawHeaders = {},
  onClose,
  isDark,
  theme,
  locale: propTableLocale,
}) => {
  const t = useDynamicDataLocale(propTableLocale);
  const [keyword, setKeyword] = useState('');

  // 过滤后的明细记录
  const filteredRecords = useMemo(() => {
    if (!keyword.trim()) return records;
    const lower = keyword.trim().toLowerCase();
    return records.filter((r) =>
      Object.entries(r).some(([k, v]) => {
        if (k.startsWith('_') || k.startsWith('__')) return false;
        return v !== null && v !== undefined && String(v).toLowerCase().includes(lower);
      })
    );
  }, [records, keyword]);

  // 动态提取列定义 (依据底层原始流水字段与 rawHeaders 映射)
  const columns = useMemo(() => {
    if (!records || records.length === 0) return [];
    const keySet = new Set<string>();
    for (const r of records.slice(0, 50)) {
      for (const k of Object.keys(r)) {
        if (!k.startsWith('_') && !k.startsWith('__') && k !== 'children' && k !== 'hierarchyState') {
          keySet.add(k);
        }
      }
    }

    return Array.from(keySet).map((key) => {
      const headerTitle = rawHeaders[key] || key;
      const sampleVal = records.find((r) => r[key] !== null && r[key] !== undefined)?.[key];
      const isNumber = typeof sampleVal === 'number';

      return {
        title: headerTitle,
        dataIndex: key,
        key: key,
        ellipsis: true,
        align: isNumber ? ('right' as const) : ('left' as const),
        sorter: (a: any, b: any) => {
          const va = a[key];
          const vb = b[key];
          if (typeof va === 'number' && typeof vb === 'number') return va - vb;
          return String(va ?? '').localeCompare(String(vb ?? ''));
        },
        render: (val: any) => {
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
      };
    });
  }, [records, rawHeaders]);

  // 复制当前明细为 TSV (带 Excel 文本格式保护)
  const handleCopy = useCallback(async () => {
    if (filteredRecords.length === 0) return;
    const exportCols = columns.map((c) => ({ key: c.key as string, title: String(c.title || c.key) }));
    const ok = await copyToClipboardAsTsv(filteredRecords, exportCols);
    if (ok) {
      message.success(t('已复制表格数据到剪贴板(已注记 Excel 文本格式保护，粘贴不会改变日期格式)'));
    } else {
      message.error(t('复制到剪贴板失败，请检查浏览器权限'));
    }
  }, [filteredRecords, columns, t]);

  // 导出当前明细为 Excel (.xls)
  const handleExport = useCallback(() => {
    if (filteredRecords.length === 0) return;
    const exportCols = columns.map((c) => ({ key: c.key as string, title: String(c.title || c.key) }));
    exportToHtmlExcel(filteredRecords, exportCols, `drillthrough_${Date.now()}.xls`);
    message.success(t('已导出 Excel 工作簿文件 (.xls)'));
  }, [filteredRecords, columns, t]);

  return (
    <Modal
      open={open}
      onCancel={onClose}
      width={1000}
      centered
      destroyOnClose
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingRight: 24, flexWrap: 'wrap' }}>
          <TableOutlined style={{ color: '#1677ff', fontSize: 16 }} />
          <span style={{ fontSize: 14, fontWeight: 600 }}>{t('底层流水穿透')}</span>
          <span style={{ fontSize: 12, color: theme.colorTextSecondary, fontWeight: 400 }}>
            {title}
          </span>
          <Tag color="blue" style={{ margin: 0, fontSize: 11, marginLeft: 4 }}>
            {t('共 {count} 项', { count: filteredRecords.length.toLocaleString() })}
          </Tag>
        </div>
      }
      footer={[
        <Button key="close" type="primary" onClick={onClose}>
          {t('关闭')}
        </Button>,
      ]}
      styles={{
        body: { padding: '16px 20px', maxHeight: '72vh', overflowY: 'auto' },
      }}
    >
      {/* 弹窗顶部操作栏 */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 12,
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <Input
          size="small"
          prefix={<SearchOutlined style={{ color: theme.colorTextSecondary }} />}
          placeholder={t('搜索筛选值...')}
          allowClear
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          style={{ width: 220, fontSize: 12 }}
        />
        <Space size={8}>
          <Tooltip title={t('复制数据 (多格式：HTML + TSV，粘贴到 Excel 原汁原味保留日期与文本格式)')}>
            <Button size="small" icon={<CopyOutlined />} onClick={handleCopy} style={{ fontSize: 12 }}>
              {t('复制数据')}
            </Button>
          </Tooltip>
          <Tooltip title={t('已导出 Excel 工作簿文件 (.xls)')}>
            <Button size="small" icon={<DownloadOutlined />} onClick={handleExport} style={{ fontSize: 12 }}>
              {t('导出 Excel')}
            </Button>
          </Tooltip>
        </Space>
      </div>

      {/* 明细平铺表格 */}
      <Table
        dataSource={filteredRecords}
        columns={columns}
        rowKey={(record, idx) => String(record.id ?? record.device_code ?? record.order_code ?? record.code ?? idx)}
        size="small"
        bordered
        pagination={{
          pageSize: 10,
          showSizeChanger: true,
          pageSizeOptions: ['10', '20', '50'],
          showTotal: (total) => t('共 {count} 项', { count: total.toLocaleString() }),
          size: 'small',
        }}
        scroll={{ x: 'max-content', y: 360 }}
      />
    </Modal>
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
  /** 点击表格行或单元格回调 */
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
  /** 是否由外部强制控制微型数据条显示 */
  showDataBars?: boolean | undefined;
  /** 外部控制靠左冻结的列 key 列表 */
  frozenColumnKeys?: string[] | undefined;
  /** 外部控制靠右冻结的列 key 列表 */
  rightFrozenColumnKeys?: string[] | undefined;
  /** 自定义国际化语言包或局部文案覆盖 */
  locale?: DeepPartial<DynamicDataLocale> | undefined;
  /**
   * 双向交叉透视表单元格穿透下钻回调 (外部扩展入口)
   * - 若外部提供此回调：内部不再弹出默认 Modal，全权交由外部组件自行处理（例如呼出自定义业务抽屉、页面跳转、弹窗增强等）
   * - 若外部未提供此回调：回退到内置的开箱即用 Excel 穿透弹窗
   */
  onCellDrillthrough?: ((info: CellDrillthroughInfo) => void) | undefined;
}

export const VTableView: React.FC<VTableViewProps> = ({
  result,
  dimensionField,
  activeMetrics,
  theme,
  onRowSelect,
  onCellDrillthrough,
  tableFeatures = true,
  vtableOption,
  style,
  className,
  showSummaryRow: propShowSummaryRow,
  mergeCells: propMergeCells,
  showDataBars: propShowDataBars,
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
  const onCellDrillthroughRef = useRef(onCellDrillthrough);
  onCellDrillthroughRef.current = onCellDrillthrough;

  // 单元格双击逻辑兜底计时器
  const lastClickPivotRef = useRef<{ time: number; col: number; row: number }>({ time: 0, col: -1, row: -1 });
  const lastClickListRef = useRef<{ time: number; col: number; row: number }>({ time: 0, col: -1, row: -1 });

  // 判定是否为双向交叉多维透视表 (存在列维度)
  const isCrossTab = useMemo(() => {
    return Boolean(
      result.meta?.isCrossTab ||
      (result.meta?.dimensions?.columnCategories && result.meta.dimensions.columnCategories.length > 0) ||
      result.meta?.dimensions?.columnTimeBucket?.field
    );
  }, [result.meta?.isCrossTab, result.meta?.dimensions]);

  const antdThemeConfig = useMemo(() => buildAntdTheme(theme), [theme]);

  // 1. 交互状态
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showSummaryRowInternal, setShowSummaryRowInternal] = useState(true);
  const showSummaryRow = propShowSummaryRow !== undefined ? propShowSummaryRow : showSummaryRowInternal;
  // 默认合并单元格 (展示态无需切换按钮，始终默认开启合并)
  const autoMergeCells = propMergeCells !== undefined ? propMergeCells : true;

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
  const [showDataBarsInternal, setShowDataBarsInternal] = useState<boolean>(() => {
    if (propShowDataBars !== undefined) return propShowDataBars;
    return false;
  }); // 微型数据条开关
  const showDataBars = propShowDataBars !== undefined ? propShowDataBars : showDataBarsInternal;
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

  const isDark = theme.mode === 'dark';

  // 2. 解析特性开关
  const features: TableFeatureConfig = useMemo(() => {
    if (typeof tableFeatures === 'boolean') {
      return {
        summaryRow: tableFeatures,
        export: tableFeatures,
        fullscreen: tableFeatures,
        columnVisibility: tableFeatures,
        drilldown: tableFeatures,
        headerMenu: tableFeatures,
        filterDropdown: tableFeatures,
        mergeCells: tableFeatures,
        dataBars: tableFeatures,
        columnResize: tableFeatures,
        dragOrder: tableFeatures,
      };
    }
    return {
      summaryRow: true,
      export: true,
      fullscreen: true,
      columnVisibility: true,
      drilldown: true,
      headerMenu: true,
      filterDropdown: true,
      mergeCells: true,
      dataBars: true,
      columnResize: true,
      dragOrder: true,
      ...tableFeatures,
    };
  }, [tableFeatures]);

  const isDataBarsActive = features.dataBars !== false && showDataBars;

  // 3. 构建候选列元信息 (基于结果列与二次激活度量过滤)
  const candidateColumnsMeta = useMemo<OutputColumnMeta[]>(() => {
    if (!result || !result.columns) return [];
    if (!activeMetrics || activeMetrics.length === 0) {
      return result.columns as OutputColumnMeta[];
    }
    return (result.columns as OutputColumnMeta[]).filter(
      (c) => c.type !== 'number' || activeMetrics.includes(c.key)
    );
  }, [result, activeMetrics]);

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
  const rawDataSource: DataRecord[] = (result.data as DataRecord[]) || [];

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
      data = data.filter((row: DataRecord) =>
        visibleColumnsMeta.some((col) => {
          const val = row[col.key];
          return val !== null && val !== undefined && String(val).toLowerCase().includes(lower);
        })
      );
    }
    // 4.2 Excel 风格列分类值多选筛选 (AND 交叉与关系过滤)
    const activeFilters = Object.entries(columnFilters).filter(
      ([_, vals]) => Array.isArray(vals)
    );
    if (activeFilters.length > 0) {
      data = data.filter((row: DataRecord) =>
        activeFilters.every(([colKey, allowedValues]) => {
          const rawVal = row[colKey];
          const strVal = rawVal === null || rawVal === undefined || rawVal === '' ? t('(空)') : String(rawVal);
          return allowedValues.includes(strVal);
        })
      );
    }
    return data;
  }, [rawDataSource, searchText, visibleColumnsMeta, columnFilters, t]);

  // 透视表穿透明细弹窗状态 (Excel 风格单元格穿透)
  const [drillModalState, setDrillModalState] = useState<{
    open: boolean;
    title: string;
    records: DataRecord[];
    rawHeaders: Record<string, string>;
  }>({
    open: false,
    title: '',
    records: [],
    rawHeaders: {},
  });

  const triggerPivotDrillthrough = useCallback(
    (args: any) => {
      if (features.drilldown === false) return;
      const table = tableRef.current;
      if (!table) return;

      if (typeof table.isHeader === 'function' && table.isHeader(args.col, args.row)) return;

      const headerPaths = typeof table.getCellHeaderPaths === 'function'
        ? table.getCellHeaderPaths(args.col, args.row)
        : null;

      // 忽略角头、总计行与小计行
      if (
        (headerPaths as any)?.role === 'grand-total' ||
        (headerPaths as any)?.role === 'sub-total' ||
        (headerPaths as any)?.cellLocation !== 'body'
      ) {
        return;
      }

      const originRecord = typeof table.getCellOriginRecord === 'function'
        ? table.getCellOriginRecord(args.col, args.row)
        : args.originData;
      const firstRecord = Array.isArray(originRecord) ? originRecord[0] : originRecord;

      if (firstRecord?.__isSummaryRow) return;

      // 优先从预聚合记录中提取 _rawRows
      let matchedRawRows: DataRecord[] = [];
      if (Array.isArray(firstRecord?._rawRows) && firstRecord._rawRows.length > 0) {
        matchedRawRows = firstRecord._rawRows;
      } else {
        // 兜底回退：根据多维维度路径从 rawDataSource 过滤匹配
        const rowPaths = (headerPaths as any)?.rowHeaderPaths || [];
        const colPaths = (headerPaths as any)?.colHeaderPaths || [];
        const conditions: { field: string; value: any }[] = [];

        for (const p of rowPaths) {
          if (p.dimensionKey && p.value !== undefined) {
            conditions.push({ field: p.dimensionKey, value: p.value });
          }
        }
        for (const p of colPaths) {
          if (p.dimensionKey && p.value !== undefined) {
            conditions.push({ field: p.dimensionKey, value: p.value });
          }
        }

        if (conditions.length > 0) {
          matchedRawRows = rawDataSource.filter((row: any) =>
            conditions.every((c) => {
              const val = row[c.field];
              return String(val ?? '').startsWith(String(c.value ?? '')) || String(val ?? '') === String(c.value ?? '');
            })
          );
        }
      }

      if (matchedRawRows.length === 0) {
        message.info(t('当前单元格暂无底层流水明细'));
        return;
      }

      // 提取行与列多维标签构造面包屑标题与结构化条件
      const rowPaths = (headerPaths as any)?.rowHeaderPaths || [];
      const colPaths = (headerPaths as any)?.colHeaderPaths || [];
      const labels: string[] = [];
      const rowDimMap: Record<string, any> = {};
      const colDimMap: Record<string, any> = {};
      let indicatorKey: string | undefined;
      let indicatorTitle: string | undefined;

      for (const p of rowPaths) {
        if (p.dimensionKey && p.value !== undefined) {
          labels.push(String(p.value));
          rowDimMap[p.dimensionKey] = p.value;
        }
      }
      for (const p of colPaths) {
        if (p.dimensionKey && p.value !== undefined) {
          labels.push(String(p.value));
          colDimMap[p.dimensionKey] = p.value;
        }
        if (p.indicatorKey) {
          indicatorKey = p.indicatorKey;
          indicatorTitle = p.value;
        }
      }
      const titleStr = labels.length > 0 ? labels.join(' · ') : t('选定单元格');

      const drillInfo: CellDrillthroughInfo = {
        records: matchedRawRows,
        title: titleStr,
        rawHeaders: (result.meta as any)?.rawHeaders || {},
        conditions: {
          rowDimensions: rowDimMap,
          colDimensions: colDimMap,
          indicatorKey,
          indicatorTitle,
          cellValue: typeof table.getCellValue === 'function' ? table.getCellValue(args.col, args.row) : undefined,
        },
        cell: {
          col: args.col,
          row: args.row,
        },
      };

      // 外部扩展优先：若外部注入了 onCellDrillthrough 回调，则全权移交外部处理
      if (typeof onCellDrillthroughRef.current === 'function') {
        onCellDrillthroughRef.current(drillInfo);
        return;
      }

      // 否则保底唤起内部默认的 Excel 风格穿透弹窗
      setDrillModalState({
        open: true,
        title: titleStr,
        records: matchedRawRows,
        rawHeaders: (result.meta as any)?.rawHeaders || {},
      });
    },
    [features.drilldown, rawDataSource, result.meta, t]
  );

  const triggerPivotDrillthroughRef = useRef(triggerPivotDrillthrough);
  triggerPivotDrillthroughRef.current = triggerPivotDrillthrough;

  // 5. 组装主从树形行数据与科学总计行计算
  const { tableRecords, hasSummaryRow, hasTreeHierarchy } = useMemo(() => {
    const isTreeDrilldown = features.drilldown !== false;
    let foundTree = false;

    // 构建主从树形结构 (当某行拥有底层原始流水 _rawRows 且启用了 drilldown 时，将其实例化为 children 树节点)
    const recordsWithTree = filteredData.map((row: DataRecord) => {
      if (row.__isSummaryRow) return row;

      // 若数据自身已有 children 树形定义
      if (Array.isArray(row.children) && row.children.length > 0) {
        foundTree = true;
        return {
          ...row,
          hierarchyState: row.hierarchyState || 'collapse',
        };
      }

      // 若为分组汇总行，且挂载了底层原始流水记录 _rawRows
      if (isTreeDrilldown && Array.isArray(row._rawRows) && row._rawRows.length > 0) {
        foundTree = true;
        const children = row._rawRows.map((child: any, idx: number) => ({
          ...child,
          __isChildRow: true,
          __childIndex: idx,
          __parentRecord: row,
        }));
        return {
          ...row,
          children,
          hierarchyState: 'collapse',
        };
      }

      return row;
    });

    const shouldShowSummary = features.summaryRow !== false && showSummaryRow && filteredData.length > 0;

    if (!shouldShowSummary) {
      return {
        tableRecords: recordsWithTree,
        hasSummaryRow: false,
        hasTreeHierarchy: !isCrossTab && foundTree,
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
      tableRecords: [...recordsWithTree, summaryRow],
      hasSummaryRow: true,
      hasTreeHierarchy: !isCrossTab && foundTree,
    };
  }, [
    isCrossTab,
    filteredData,
    visibleColumnsMeta,
    result.meta?.rawHeaders,
    features.summaryRow,
    features.drilldown,
    showSummaryRow,
    t,
  ]);

  // 5.0.1 识别树形展开的主排序列键名 (优先取首个非数值维度列)
  const primaryTreeColKey = useMemo(() => {
    if (!hasTreeHierarchy) return null;
    const dimCol = visibleColumnsMeta.find((c) => c.type !== 'number');
    return dimCol ? dimCol.key : visibleColumnsMeta[0]?.key;
  }, [hasTreeHierarchy, visibleColumnsMeta]);

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
        drillDown: features.drilldown !== false,
        drillUp: features.drilldown !== false,
      });
    }
    if (result.meta?.dimensions?.categories) {
      for (const cat of result.meta.dimensions.categories) {
        dims.push({
          dimensionKey: cat,
          title: headers[cat] || cat,
          width: 'auto',
          drillDown: features.drilldown !== false,
          drillUp: features.drilldown !== false,
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

  // 5.3 计算各数值列的最大绝对值，用于微型数据条渲染 (支持常规列表与透视表)
  const colMaxMap = useMemo(() => {
    const map: Record<string, number> = {};
    for (const col of visibleColumnsMeta) {
      if (col.type === 'number') {
        let max = 0;
        for (const row of filteredData) {
          const val = Math.abs(
            Number(
              row[col.key] ??
              (col.field ? row[col.field] : undefined) ??
              (col.title ? row[col.title] : undefined)
            ) || 0
          );
          if (val > max) max = val;
        }
        map[col.key] = max;
        if (col.field) map[col.field] = max;
      }
    }
    return map;
  }, [visibleColumnsMeta, filteredData]);

  // 5.4 构造透视表度量指标与聚合规则
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

    const indicators: any[] = metricCols.map((col) => {
      const isNumber = col.type === 'number';
      const colMax = colMaxMap[col.key] ?? (col.field ? colMaxMap[col.field] : undefined) ?? 0;

      const indicatorDef: any = {
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
      };

      // 微型数据条 (Data Bars) - 通过 Canvas Scenegraph 原生自定义渲染
      if (isDataBarsActive && isNumber && colMax > 0) {
        indicatorDef.customRender = (args: any) => {
          const rect = args.rect || { width: 120, height: 32 };
          // 判定是否属于总计/小计单元格，若为汇总格则不渲染数据条
          const role = typeof args.table?.getCellPivotRole === 'function'
            ? args.table.getCellPivotRole(args.col, args.row)
            : null;
          if (
            role?.colRole === 'grand-total' ||
            role?.rowRole === 'grand-total' ||
            role?.colRole === 'sub-total' ||
            role?.rowRole === 'sub-total'
          ) {
            return { expectedWidth: rect.width, expectedHeight: rect.height, renderDefault: true };
          }

          const rawNum = Math.abs(Number(args.dataValue ?? args.value) || 0);
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
        };
      }

      return indicatorDef;
    });

    const aggregationRules = createPivotAggregationRules(metricCols, result.meta?.rawHeaders, result.columns);

    return { pivotIndicators: indicators, pivotAggregationRules: aggregationRules };
  }, [
    isCrossTab,
    pivotRowDimensions,
    pivotColumnDimensions,
    visibleColumnsMeta,
    isDataBarsActive,
    colMaxMap,
    isDark,
    result.columns,
    result.meta?.rawHeaders,
  ]);

  // 5.5 构造透视表事实记录 (保证每个记录拥有有效行维度)
  const pivotRecords = useMemo(() => {
    if (!isCrossTab) return [];
    return filteredData.map((r: DataRecord) => {
      if (pivotRowDimensions.length === 0) {
        return cloneTransformRecord(r, { __summary_row_dim__: t('汇总') });
      }
      return r;
    });
  }, [isCrossTab, filteredData, pivotRowDimensions.length, t]);

  // 6. 构建 VTable 列定义 (ColumnDefine)
  const tableColumns = useMemo<ColumnDefine[]>(() => {
    const cols: ColumnDefine[] = visibleColumnsMeta.map((col: OutputColumnMeta, colIndex: number) => {
      const isNumber = col.type === 'number';

      // 提取当前列前面的所有维度列 (用于多维层次化保护)
      const precedingDimensionCols = visibleColumnsMeta.slice(0, colIndex).filter((c) => c.type !== 'number');

      // 相邻同类单元格纵向合并 (仅在非树形表格下生效，树形主从表由层级缩进承载)
      const shouldEnableMerge = features.mergeCells !== false && autoMergeCells && !isNumber && !hasTreeHierarchy;

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
        ...(hasTreeHierarchy && col.key === primaryTreeColKey ? { tree: true } : {}),
        ...(shouldEnableMerge && mergeCellFn ? { mergeCell: mergeCellFn } : {}),
        fieldFormat: (record: any) => {
          if (record?.__isChildRow) {
            if (col.key === primaryTreeColKey) {
              // 提取子明细行的唯一业务标识 (device_code, device_id, order_code, id, name 等)
              const idCandidates = ['device_code', 'device_id', 'order_code', 'order_id', 'batch_no', 'item_code', 'task_id', 'id', 'code', 'name', 'title', 'part_name'];
              for (const f of idCandidates) {
                if (record[f] !== undefined && record[f] !== null && String(record[f]).trim() !== '') {
                  return String(record[f]);
                }
              }
              if (record[col.key] !== undefined && record[col.key] !== null && String(record[col.key]) !== String(record.__parentRecord?.[col.key])) {
                return String(record[col.key]);
              }
              return `#${(record.__childIndex ?? 0) + 1}`;
            }
          }

          let val = (record && typeof record === 'object')
            ? (record[col.key] !== undefined ? record[col.key] : (col.field ? record[col.field] : undefined))
            : record;

          // 若子行仍未匹配到值，尝试去除聚合包装的字段名或从标题匹配
          if (val === undefined && record?.__isChildRow && typeof record === 'object') {
            const rawFieldName = col.key.replace(/^[A-Z_]+\((.*)\)$/, '$1');
            if (record[rawFieldName] !== undefined) {
              val = record[rawFieldName];
            } else if (col.title && record[col.title] !== undefined) {
              val = record[col.title];
            }
          }

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
          textStick: true,
          textStickBaseOnAlign: true,
          fontWeight: (args: any) => {
            const rowData =
              args.table?.getCellOriginRecord?.(args.col, args.row) ||
              args.table?.records?.[args.row - (args.table?.columnHeaderLevelCount || 1)];
            if (rowData?.__isSummaryRow) return 700;
            if (rowData?.__isChildRow) return 400;
            if (hasTreeHierarchy && !rowData?.__isChildRow) return 600;
            return 400;
          },
          color: (args: any) => {
            const rowData =
              args.table?.getCellOriginRecord?.(args.col, args.row) ||
              args.table?.records?.[args.row - (args.table?.columnHeaderLevelCount || 1)];
            const val = Number(rowData?.[col.key]);
            // 负数红字预警 (AntD Table 经典高阶能力)
            if (isNumber && Number.isFinite(val) && val < 0) {
              return '#cf1322';
            }
            if (rowData?.__isChildRow && !isNumber) {
              return isDark ? 'rgba(255,255,255,0.72)' : 'rgba(0,0,0,0.72)';
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
            if (rowData?.__isChildRow) {
              return isDark ? 'rgba(255, 255, 255, 0.025)' : 'rgba(0, 0, 0, 0.015)';
            }
            return '';
          },
        },
      };

      // 微型数据条 (Data Bars) - 通过 Canvas Scenegraph 原生自定义渲染
      if (isDataBarsActive && isNumber && (colMaxMap[col.key] ?? 0) > 0) {
        const colMax = colMaxMap[col.key]!;
        colDef.customRender = ((args: any) => {
          const rowData =
            args.table?.getCellOriginRecord?.(args.col, args.row) ||
            args.table?.records?.[args.row - (args.table?.columnHeaderLevelCount || 1)];
          const rect = args.rect || { width: 120, height: 32 };
          if (rowData?.__isSummaryRow || rowData?.__isChildRow) {
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
      const isColFiltered = Array.isArray(columnFilters[col.key]);
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

    return cols;
  }, [visibleColumnsMeta, isDark, features.filterDropdown, features.mergeCells, hasTreeHierarchy, primaryTreeColKey, isDataBarsActive, colMaxMap, columnFilters, autoMergeCells, t]);

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
        textStick: true,
        textStickBaseOnAlign: true,
      },
      rowHeaderStyle: {
        textStick: true,
        textStickBaseOnAlign: true,
      },
      headerStyle: {
        fontSize: 12,
        fontWeight: 600,
        bgColor: isDark ? '#141414' : '#f0f2f5',
      },
      frameStyle: {
        borderLineWidth: 0,
        cornerRadius: 0,
        shadowBlur: 0,
        shadowColor: 'transparent',
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
        autoFillWidth: true,
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
        columnHierarchyType: 'grid',
        rowHierarchyType: 'grid',
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
        columnResizeMode: features.columnResize !== false ? 'all' : 'none',
        ...vtableOption,
      };

      const table = new PivotTable(pivotOptions);
      tableRef.current = table;
      (dom as any).__vtable__ = table;

      // 监听单元格点击事件 (行选择与逻辑双击穿透)
      table.on('click_cell', (args: any) => {
        if (typeof table.isHeader === 'function' && table.isHeader(args.col, args.row)) return;

        const headerPaths = typeof table.getCellHeaderPaths === 'function'
          ? table.getCellHeaderPaths(args.col, args.row)
          : null;

        // 过滤总计格与无效格
        if (
          (headerPaths as any)?.role === 'grand-total' ||
          (headerPaths as any)?.role === 'sub-total' ||
          args.originData?.__isSummaryRow
        ) {
          return;
        }

        const originRecord = typeof table.getCellOriginRecord === 'function'
          ? table.getCellOriginRecord(args.col, args.row)
          : args.originData;
        const firstRecord = Array.isArray(originRecord) ? originRecord[0] : originRecord;
        if (firstRecord?.__isSummaryRow) return;

        // 快速双击判定 (400ms 内连续双击同一单元格触发穿透)
        const now = Date.now();
        const timeDiff = now - lastClickPivotRef.current.time;
        const sameCell = lastClickPivotRef.current.col === args.col && lastClickPivotRef.current.row === args.row;
        lastClickPivotRef.current = { time: now, col: args.col, row: args.row };

        if (timeDiff < 400 && sameCell && features.drilldown !== false) {
          triggerPivotDrillthroughRef.current?.(args);
          return;
        }

        onRowSelectRef.current?.(firstRecord || {}, args.row, undefined);
      });

      // 监听单元格原生双击事件 (穿透底层明细流水)
      table.on('dblclick_cell', (args: any) => {
        if (features.drilldown !== false) {
          triggerPivotDrillthroughRef.current?.(args);
        }
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
      autoFillWidth: true,
      autoWrapText: true,
      theme: extendedTheme as any,
      hierarchyIndent: 20,
      hierarchyExpandLevel: 1,
      bottomFrozenRowCount: hasSummaryRow ? 1 : 0,
      frozenColCount: frozenColumnKeys.length,
      rightFrozenColCount: rightFrozenColumnKeys.length,
      columnResizeMode: features.columnResize !== false ? 'all' : 'none',
      dragHeaderMode: features.dragOrder !== false ? 'column' : 'none',
      ...(features.dragOrder !== false
        ? {
            dragOrder: {
              dragHeaderMode: 'column' as const,
              validateDragOrderOnEnd: (source: any, target: any) => {
                const sourceCol = tableColumns[source?.col];
                const targetCol = tableColumns[target?.col];
                if (sourceCol?.field === '__action_drilldown' || targetCol?.field === '__action_drilldown') {
                  return false;
                }
                return true;
              },
            },
          }
        : {}),
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
    (dom as any).__vtable__ = table;

    // 监听表头图标点击（Excel 风格列筛选）
    table.on('icon_click', (args: any) => {
      if (args.name?.startsWith('filter_') || args.funcType === 'filter') {
        const colField = tableColumns[args.col]?.field;
        if (!colField) return;
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
          if (!colField) return;
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

      const realDataIndex = filteredData.indexOf(originData);
      const dataIndex = realDataIndex >= 0 ? realDataIndex : (args.row - headerOffset);

      if (dataIndex >= 0 && dataIndex < (filteredData.length || resultRef.current.data.length)) {
        onRowSelectRef.current?.(originData, dataIndex, colField ? String(colField) : undefined);
      }
    });

    // 监听双击事件：若双击具有子层级的行，快捷展开/折叠该行树节点
    table.on('dblclick_cell', (args: any) => {
      const originData = args.originData;
      if (!originData || originData.__isSummaryRow) return;
      if (hasTreeHierarchy && originData.children && originData.children.length > 0) {
        if (typeof table.toggleHierarchyState === 'function') {
          table.toggleHierarchyState(args.col, args.row);
        }
      }
    });

    // 监听 Canvas 表头直接拖拽排序列换位事件，实时与 React 状态及「列设置」面板同步
    table.on('change_header_position', (args: any) => {
      if (args.movingColumnOrRow === 'column' || (args.source && args.target && args.source.col !== args.target.col)) {
        try {
          const currentCols = (table as any).columns;
          if (Array.isArray(currentCols)) {
            const newKeys = currentCols
              .map((c: any) => c.field || c.key)
              .filter((k: any) => k && k !== '__action_drilldown');
            if (newKeys.length > 0) {
              setColumnOrder((prev) => {
                if (prev && prev.length === newKeys.length && prev.every((v, i) => v === newKeys[i])) {
                  return prev;
                }
                return newKeys;
              });
            }
          }
        } catch {
          // 静默保护
        }
      }
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
    hasTreeHierarchy,
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



  // 10. 导出 CSV 逻辑 (自适应 2D 多维交叉透视矩阵或明细平面表)
  const handleExportCSV = useCallback(() => {
    if (isCrossTab && tableRef.current) {
      exportTableInstanceToCsv(tableRef.current, `pivot_table_${Date.now()}.csv`);
      message.success(t('已导出 CSV 表格文件'));
      return;
    }

    const dataToExport = filteredData || [];
    if (dataToExport.length === 0) {
      message.warning(t('当前无数据可导出'));
      return;
    }

    const exportCols = visibleColumnsMeta;
    exportToCsv(dataToExport, exportCols, `dynamic_report_${Date.now()}.csv`);
    message.success(t('已导出 CSV 表格文件'));
  }, [isCrossTab, filteredData, visibleColumnsMeta, t]);

  // 10.1 导出 Excel (.xls) 逻辑 (推荐：完整保留纯文本日期、分桶格式与数值，防止 Excel 自动篡改)
  const handleExportExcel = useCallback(() => {
    if (isCrossTab && tableRef.current) {
      exportTableInstanceToExcel(tableRef.current, `pivot_table_${Date.now()}.xls`);
      message.success(t('已导出 Excel 工作簿文件 (.xls)'));
      return;
    }

    const dataToExport = filteredData || [];
    if (dataToExport.length === 0) {
      message.warning(t('当前无数据可导出'));
      return;
    }

    const exportCols = visibleColumnsMeta;
    exportToHtmlExcel(dataToExport, exportCols, `dynamic_report_${Date.now()}.xls`);
    message.success(t('已导出 Excel 工作簿文件 (.xls)'));
  }, [isCrossTab, filteredData, visibleColumnsMeta, t]);

  // 11. 复制数据到剪贴板 (双 MIME 格式：HTML + TSV，粘贴到 Excel 原汁原味保留日期与文本格式)
  const handleCopyTSV = useCallback(async () => {
    if (isCrossTab && tableRef.current) {
      const ok = await copyTableInstanceAsTsv(tableRef.current);
      if (ok) {
        message.success(t('已复制表格数据到剪贴板 (已注入 Excel 文本格式保护，粘贴不会改变日期格式)'));
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
    const exportCols = visibleColumnsMeta.map((c) => ({ key: c.key, title: c.title || c.key }));
    const ok = await copyToClipboardAsTsv(dataToExport, exportCols);
    if (ok) {
      message.success(t('已复制表格数据到剪贴板 (已注入 Excel 文本格式保护，粘贴不会改变日期格式)'));
    } else {
      message.error(t('复制到剪贴板失败，请检查浏览器权限'));
    }
  }, [isCrossTab, filteredData, visibleColumnsMeta, t]);

  // 统计已生效的列筛选数量
  const activeFilterCount = useMemo(() => {
    return Object.values(columnFilters).filter((vals) => Array.isArray(vals)).length;
  }, [columnFilters]);

  // 工具条「列筛选」下拉菜单配置项
  const filterMenuItems = useMemo(() => {
    return visibleColumnsMeta.map((col) => {
      const isFiltered = Array.isArray(columnFilters[col.key]);
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
            const isFiltered = Array.isArray(columnFilters[col.key]);

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

          return <>{items}</>;
        })()}
      </div>
    </div>
  );

  return (
    <ConfigProvider theme={antdThemeConfig} getPopupContainer={() => wrapperRef.current || document.body}>
      <div ref={wrapperRef} className={`hw-vtable-view ${className || ''}`} style={wrapperStyle}>
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
            {hasTreeHierarchy && (
              <span style={{ fontSize: 11, color: theme.colorTextSecondary, opacity: 0.85 }}>
                💡 {t('点击行首箭头展开明细流水')}
              </span>
            )}
            {isCrossTab && features.drilldown !== false && (
              <span style={{ fontSize: 11, color: theme.colorTextSecondary, opacity: 0.85 }}>
                💡 {t('双击单元格穿透底层流水')}
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
            {features.dataBars !== false && (
              <Tooltip title={isDataBarsActive ? t('关闭数据条') : t('开启数据条')}>
                <Button
                  size="small"
                  type={isDataBarsActive ? 'primary' : 'default'}
                  icon={<BarChartOutlined />}
                  onClick={() => setShowDataBarsInternal((prev) => !prev)}
                  style={{ fontSize: 12 }}
                >
                  {t('数据条')}
                </Button>
              </Tooltip>
            )}

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

            {/* 导出菜单 (Excel / CSV) */}
            {features.export !== false && (
              <Dropdown
                menu={{
                  items: [
                    {
                      key: 'excel',
                      label: (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span>{t('导出 Excel (.xls)')}</span>
                          <Tag color="success" style={{ margin: 0, fontSize: 10, lineHeight: '16px', padding: '0 4px' }}>
                            {t('推荐/保留格式')}
                          </Tag>
                        </div>
                      ),
                      icon: <FileExcelOutlined style={{ color: '#52c41a' }} />,
                      onClick: handleExportExcel,
                    },
                    {
                      key: 'csv',
                      label: t('导出 CSV (.csv)'),
                      icon: <DownloadOutlined />,
                      onClick: handleExportCSV,
                    },
                  ],
                }}
                trigger={['click']}
                placement="bottomRight"
                getPopupContainer={() => wrapperRef.current || document.body}
              >
                <Tooltip title={t('导出表格数据 (推荐使用 Excel 格式以保留日期与纯文本原貌)')}>
                  <Button
                    size="small"
                    icon={<DownloadOutlined />}
                    style={{ fontSize: 12 }}
                  >
                    {t('导出')} <DownOutlined style={{ fontSize: 10 }} />
                  </Button>
                </Tooltip>
              </Dropdown>
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
              if (!Array.isArray(vals)) return null;
              const colMeta = candidateColumnsMeta.find((c) => c.key === colKey);
              const title = colMeta?.title || colKey;
              const valText =
                vals.length === 0
                  ? t('0项已选(无匹配)')
                  : vals.length <= 2
                  ? vals.join(', ')
                  : `${vals[0]}, ${vals[1]}... (${vals.length})`;
              return (
                <Tag
                  key={colKey}
                  color={vals.length === 0 ? 'orange' : 'blue'}
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
                  {title}: {valText}
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
              console.log('FILTER POPOVER onOpenChange:', open, new Error().stack);
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

        {/* 透视表单元格穿透明细弹窗 (Excel 经典模式) */}
        {drillModalState.open && (
          <PivotDrillthroughModal
            open={drillModalState.open}
            title={drillModalState.title}
            records={drillModalState.records}
            rawHeaders={drillModalState.rawHeaders}
            onClose={() => setDrillModalState((prev) => ({ ...prev, open: false }))}
            isDark={isDark}
            theme={theme}
            locale={t.locale}
          />
        )}
      </div>
    </ConfigProvider>
  );
};

