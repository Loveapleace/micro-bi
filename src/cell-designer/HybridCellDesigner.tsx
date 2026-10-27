import React, { useState, useMemo, useEffect, useRef, forwardRef, useImperativeHandle, useCallback } from 'react';
import {
  Space,
  Typography,
  InputNumber,
  Select,
  Checkbox,
  Button,
  Tag,
  Divider,
  Segmented,
  Tooltip,
  message,
  Alert,
  theme,
} from 'antd';
import {
  CalendarOutlined,
  AppstoreOutlined,
  TableOutlined,
  EyeOutlined,
  EditOutlined,
} from '@ant-design/icons';
import type { DataRecord, DynamicTransformConfig, TimeGranularity } from '../engine/types.js';
import type { CellTemplateDocumentV1, CellDefinition, LayoutRule, StyleRule, PresentationRules, AdvancedCellUpdate } from '../report-template/types.js';
import { compilePanelToCellTemplate } from '../report-template/panelToTemplateAdapter.js';
import { normalizeHybridAxes, preserveSavedAxisOrder, readHybridAxes } from '../report-template/hybridAxes.js';
import { validateCellTemplateDocument } from '../report-template/validator.js';
import { addStaticSpanDesignMerges } from '../report-template/staticSpans.js';
import { captureHybridPreviewMerges, mergeRetainedHybridConfig, rebindHybridMergeConfig } from './hybridMergeState.js';
import { expandCellDrivenTemplate } from '../report-template/cellExpansionEngine.js';
import { compileCellReport, type CompileCellReportResult } from '../report-template/compileCellReport.js';
import { generateTemplateCellId } from '../report-template/identity.js';
import { attachUniverDesignerEvents } from './univerEvents.js';
import { emptyPresentationRules } from '../report-template/presentationTypes.js';
import { applyPresentationRules } from '../report-template/presentationRules.js';
import { HybridHistory, isHybridHistoryCommand } from './hybridHistory.js';
import { syncDocumentFromWorkbookSnapshot } from './syncWorkbookToTemplate.js';
import { applyHybridFormatPreset, collectHybridExtras, mergeHybridCells, mergeHybridLayoutRules, preserveHybridDocumentMetadata, readHybridFormatPreset, readHybridRowTotals, type HybridFormatPreset } from './hybridTemplateState.js';
import { CellAdvancedSettings } from './CellAdvancedSettings.js';
import { bindSourceHistory, type FUniver } from '../univer/adapter.js';
import {
  useRegisteredDatasets,
  useDatasetData,
  getRegisteredDataset,
  getCachedDatasetData,
  type RegisteredDataset,
} from '../core/datasetRegistry.js';
import { UniverPreview, type UniverPreviewRef } from '../univer/UniverPreview.js';
import type { BiGridModel } from '../report/types.js';
import type { FieldItem } from './CellInspector.js';

const { Text } = Typography;

export interface HybridCellDesignerProps {
  initialConfig?: DynamicTransformConfig | undefined;
  initialDocument?: CellTemplateDocumentV1 | undefined;
  datasetId?: string | undefined;
  datasets?: readonly RegisteredDataset[] | undefined;
  rawDataset?: readonly DataRecord[] | undefined;
  height?: string | number | undefined;
  onSave?: ((report: CompileCellReportResult) => void) | undefined;
  onCancel?: (() => void) | undefined;
  onEjectToFreeDesigner?: ((template: CellTemplateDocumentV1) => void) | undefined;
  isDark?: boolean | undefined;
}

export interface HybridCellDesignerRef {
  getTemplate: () => CellTemplateDocumentV1;
  validateAndGetReport: () => Promise<CompileCellReportResult>;
}

export const HybridCellDesigner = forwardRef<HybridCellDesignerRef, HybridCellDesignerProps>(
  function HybridCellDesigner(
    {
      initialConfig,
      initialDocument,
      datasetId,
      datasets,
      rawDataset,
      height = '100%',
      onSave,
      onCancel,
      onEjectToFreeDesigner,
      isDark = false,
    },
    ref
  ) {
    const univerPreviewRef = useRef<UniverPreviewRef>(null);

    // 1. 数据集列表与当前选中数据集
    const registered = useRegisteredDatasets();
    const candidateDatasets = datasets || registered;
    const [selectedDatasetId, setSelectedDatasetId] = useState<string>(
      initialDocument?.regions?.[0]?.datasetId ||
      initialConfig?.datasetId ||
      datasetId ||
      candidateDatasets[0]?.id ||
      'default'
    );

    const activeDataset = useMemo(() => {
      return (
        candidateDatasets.find((d) => d.id === selectedDatasetId) ||
        getRegisteredDataset(selectedDatasetId)
      );
    }, [candidateDatasets, selectedDatasetId]);

    const resolvedDataset = useDatasetData(activeDataset, { enabled: rawDataset === undefined });
    const activeData = rawDataset ?? resolvedDataset.data;
    const dataLoading = rawDataset === undefined && resolvedDataset.loading;
    const dataError = rawDataset === undefined ? resolvedDataset.error : null;
    const { token } = theme.useToken();
    const chromeColor = isDark ? '#f0f0f0' : token.colorText;

    // 2. 字段库提取
    const fieldItems = useMemo<FieldItem[]>(() => {
      const headers = (resolvedDataset.headers || activeDataset?.headers || {}) as Record<string, string>;
      const keys = new Set<string>();

      Object.keys(headers).forEach((k) => keys.add(k));
      if (activeData.length > 0 && activeData[0]) {
        Object.keys(activeData[0]).forEach((k) => keys.add(k));
      }

      return Array.from(keys).map((k) => {
        const sampleVal = activeData[0]?.[k];
        let typeStr: string = typeof sampleVal;
        if (typeof sampleVal === 'number') typeStr = 'number';
        else if (sampleVal instanceof Date || (typeof sampleVal === 'string' && /^\d{4}-\d{2}/.test(sampleVal))) {
          typeStr = 'date';
        }
        return {
          key: k,
          label: headers[k] || k,
          type: typeStr,
          sample: sampleVal,
        };
      });
    }, [activeDataset, activeData, resolvedDataset.headers]);

    // 3. 维度与度量配置状态（完全对齐图二结构）
    const [mode, setMode] = useState<'design' | 'preview'>('design');
    const [switchingView, setSwitchingView] = useState(false);

    // 行维度（纵向展开）
    const [rowTimeField, setRowTimeField] = useState<string | undefined>(undefined);
    const [rowGranularity, setRowGranularity] = useState<TimeGranularity>('day');
    const [rowCustomDays, setRowCustomDays] = useState<number>(7);
    const [rowCategories, setRowCategories] = useState<string[]>([]);

    // 透视列维度（横向展开）
    const [colTimeField, setColTimeField] = useState<string | undefined>(undefined);
    const [colGranularity, setColGranularity] = useState<TimeGranularity>('month');
    const [colCategories, setColCategories] = useState<string[]>([]);

    // 统计度量指标
    const [selectedMeasures, setSelectedMeasures] = useState<string[]>([]);
    const [measureAggs, setMeasureAggs] = useState<Record<string, 'sum' | 'count' | 'avg' | 'max' | 'min'>>({});
    const [measureFormats, setMeasureFormats] = useState<Record<string, string>>({});

    // 汇总与合并选项
    const [showRowTotal, setShowRowTotal] = useState<boolean>(false);
    const [enableGroupMerge, setEnableGroupMerge] = useState<boolean>(true);

    // 用户额外驱动的自由单元格列表（包含文字、公式、样式，绝不污染系统受控字段）
    const [extraCustomCells, setExtraCustomCells] = useState<CellDefinition[]>([]);
    const [extraLayoutRules, setExtraLayoutRules] = useState<LayoutRule[]>([]);
    const [presentationModel, setPresentationModel] = useState<PresentationRules>(()=>structuredClone(initialDocument?.presentationRules || emptyPresentationRules()));
    const [visualStyleRules, setVisualStyleRules] = useState<StyleRule[]>(()=>structuredClone(initialDocument?.styleRules || []));
    const [designSize, setDesignSize] = useState({ rows: initialDocument?.sheets[0]?.rowCount ?? 25,
      columns: initialDocument?.sheets[0]?.columnCount ?? 15 });
    const [retainedMergeConfig, setRetainedMergeConfig] = useState(() => {
      const retained = initialDocument?.hybridConfig?.version === 2 ? initialDocument.hybridConfig.retainedMergeConfig : undefined;
      return mergeRetainedHybridConfig(retained, initialDocument?.mergeConfig);
    });
    const [disabledLayoutIds, setDisabledLayoutIds] = useState<string[]>(() => initialDocument?.hybridConfig?.version === 2 ? initialDocument.hybridConfig.disabledLayoutRuleIds || [] : []);
    const [layoutAnchor, setLayoutAnchor] = useState<{
      row: number;
      col: number;
      includeTitle: boolean;
      titleRow: number;
      titleCol: number;
    }>({
      row: initialDocument?.regions?.[0]?.anchor?.row ?? 2,
      col: initialDocument?.regions?.[0]?.anchor?.column ?? 0,
      includeTitle: initialDocument?.cells ? initialDocument.cells.some((c) => c.id === 'title') : true,
      titleRow: initialDocument?.cells.find((c) => c.id === 'title')?.position.row ?? 0,
      titleCol: initialDocument?.cells.find((c) => c.id === 'title')?.position.column ?? 0,
    });
    const layoutAnchorRef = useRef(layoutAnchor);
    layoutAnchorRef.current = layoutAnchor;
    const [univerAPI, setUniverAPI] = useState<FUniver | null>(null);
    const [advancedModalOpen, setAdvancedModalOpen] = useState(false);
    const [selectedCellForAdvanced, setSelectedCellForAdvanced] = useState<CellDefinition | null>(null);

    const extraCustomCellsRef = useRef(extraCustomCells);
    extraCustomCellsRef.current = extraCustomCells;
    const extraLayoutRulesRef = useRef(extraLayoutRules);
    extraLayoutRulesRef.current = extraLayoutRules;
    const modeRef = useRef(mode);
    modeRef.current = mode;

    // 自动判定报表原型形态
    const isCrossTab = Boolean(colTimeField || (colCategories && colCategories.length > 0));
    const hasRowDims = Boolean(rowTimeField || (rowCategories && rowCategories.length > 0));
    const deducedArchetype: 'pivot' | 'grouped' | 'detail' = isCrossTab
      ? 'pivot'
      : hasRowDims
      ? 'grouped'
      : 'detail';

    // 字段辅助过滤
    const timeFields = useMemo(() => {
      return fieldItems.filter((f) => f.type === 'date' || f.type === 'time');
    }, [fieldItems]);

    const rowTimeOptions = useMemo(() => {
      return timeFields.map((f) => ({
        value: f.key,
        label: (
          <span>
            {f.label}{' '}
            <Tag color="blue" style={{ fontSize: 10, margin: 0, padding: '0 4px', lineHeight: '16px' }}>
              时间
            </Tag>
          </span>
        ),
      }));
    }, [timeFields]);

    const colTimeOptions = useMemo(() => {
      return timeFields.map((f) => ({
        value: f.key,
        label: (
          <span>
            {f.label}{' '}
            <Tag color="purple" style={{ fontSize: 10, margin: 0, padding: '0 4px', lineHeight: '16px' }}>
              时间
            </Tag>
          </span>
        ),
      }));
    }, [timeFields]);

    const categoryOptions = useMemo(() => {
      return fieldItems.map((f) => ({
        value: f.key,
        label: (
          <span>
            {f.label}{' '}
            {f.type !== 'number' && (
              <Tag color="orange" style={{ fontSize: 10, margin: 0, padding: '0 4px', lineHeight: '16px' }}>
                文本
              </Tag>
            )}
          </span>
        ),
      }));
    }, [fieldItems]);

    // 追踪上一次的数据集 ID 与初始化反向解析状态
    const prevDatasetIdRef = useRef<string | undefined>(undefined);
    const isInitializedRef = useRef<boolean>(false);

    useEffect(() => {
      if (dataLoading || dataError || !fieldItems || fieldItems.length === 0) return;

      const datasetChanged = prevDatasetIdRef.current !== selectedDatasetId;
      prevDatasetIdRef.current = selectedDatasetId;

      const fieldKeySet = new Set(fieldItems.map((f) => f.key));
      const numericFields = fieldItems.filter((f) => f.type === 'number');
      const dateFields = fieldItems.filter((f) => f.type === 'date' || f.type === 'time');
      const textFields = fieldItems.filter((f) => f.type !== 'number' && f.type !== 'date' && f.type !== 'time');

      // 1. 若为二次编辑且传入了 initialDocument，优先反向还原用户历史保存的全部配置
      if (!isInitializedRef.current && initialDocument && initialDocument.cells && initialDocument.cells.length > 0) {
        isInitializedRef.current = true;
        const docCells = initialDocument.cells;
        const savedAxes = readHybridAxes(initialDocument);
        const rowTime = savedAxes.rowAxes.find((a) => a.kind === 'time');
        const colTime = savedAxes.columnAxes.find((a) => a.kind === 'time');
        const parsedRowTime = rowTime?.fieldKey;
        const parsedColTime = colTime?.fieldKey;
        const parsedRowGran = rowTime?.timeBucket?.granularity || 'day';
        const parsedColGran = colTime?.timeBucket?.granularity || 'month';
        const parsedRowCats = savedAxes.rowAxes.filter((a) => a.kind === 'category').map((a) => a.fieldKey);
        const parsedColCats = savedAxes.columnAxes.filter((a) => a.kind === 'category').map((a) => a.fieldKey);
        setRowTimeField(parsedRowTime);
        setRowGranularity(parsedRowGran);
        setRowCustomDays(rowTime?.timeBucket?.customIntervalDays || 7);
        setRowCategories(parsedRowCats);
        setColTimeField(parsedColTime);
        setColGranularity(parsedColGran);
        setColCategories(parsedColCats);

        // 反解度量格与明细格
        const measCells = docCells.filter(
          (c) => c.content.kind === 'field' && (c.content.role === 'measure' || c.content.role === 'detail-column')
        );
        const parsedMeasures: string[] = [];
        const parsedAggs: Record<string, 'sum' | 'count' | 'avg' | 'max' | 'min'> = {};
        const parsedFormats: Record<string, string> = {};

        for (const mc of measCells) {
          const fKey = (mc.content as any).fieldKey || (mc.content as any).fieldId;
          if (fKey && !parsedMeasures.includes(fKey)) {
            parsedMeasures.push(fKey);
            const op = (mc.content as any).operation;
            if (op && ['sum', 'count', 'avg', 'max', 'min'].includes(op)) {
              parsedAggs[fKey] = op;
            }
            const fmt = (mc.content as any).format;
            if (fmt) {
              parsedFormats[fKey] = fmt;
            }
          }
        }
        if (parsedMeasures.length > 0) {
          setSelectedMeasures(parsedMeasures);
          setMeasureAggs(parsedAggs);
          setMeasureFormats(parsedFormats);
        }

        // 反解行总计与合并策略
        const hasRowTotal = readHybridRowTotals(initialDocument);
        setShowRowTotal(hasRowTotal);

        const hasMergePolicy = initialDocument.hybridConfig?.version === 2 ? initialDocument.hybridConfig.enableGroupMerge : Boolean(
          initialDocument.mergeConfig?.policies?.some((p) => p.kind === 'group-span' && p.enabled !== false)
        );
        setEnableGroupMerge(
          initialDocument.mergeConfig?.policies ? hasMergePolicy : true
        );

        const initAnchorRow = initialDocument.regions?.[0]?.anchor?.row ?? 2;
        const initAnchorCol = initialDocument.regions?.[0]?.anchor?.column ?? 0;
        const initHasTitle = initialDocument.cells.some((c) => c.id === 'title');
        setLayoutAnchor({
          row: initAnchorRow,
          col: initAnchorCol,
          includeTitle: initHasTitle,
          titleRow: initialDocument.cells.find((c) => c.id === 'title')?.position.row ?? 0,
          titleCol: initialDocument.cells.find((c) => c.id === 'title')?.position.column ?? 0,
        });

        // 提取历史用户在空白区域添加的额外自由单元格与自定义布局规则
        const baseArchetype = parsedColCats.length > 0 || parsedColTime ? 'pivot' : parsedRowCats.length > 0 || parsedRowTime ? 'grouped' : 'detail';
        const baseHeaders: Record<string, string> = {};
        fieldItems.forEach((f) => {
          baseHeaders[f.key] = f.label;
        });
        const basePanelTemplate = compilePanelToCellTemplate(
          {
            datasetId: selectedDatasetId,
            headers: baseHeaders,
            dimensions: {
              timeBucket: parsedRowTime ? { field: parsedRowTime, granularity: parsedRowGran } : undefined,
              categories: parsedRowCats,
              columnTimeBucket: parsedColTime ? { field: parsedColTime, granularity: parsedColGran } : undefined,
              columnCategories: parsedColCats,
            },
            columns: (parsedMeasures.length > 0 ? parsedMeasures : ['val']).map((k) => ({
              type: 'aggregated' as const,
              field: k,
              agg: parsedAggs[k] || 'sum',
              label: k,
            })),
          },
          selectedDatasetId,
          {
            archetype: baseArchetype,
            datasetName: activeDataset?.name,
            showRowTotals: hasRowTotal,
            enableGroupMerge: initialDocument.mergeConfig?.policies ? hasMergePolicy : true,
            anchorRow: initAnchorRow,
            anchorCol: initAnchorCol,
            includeTitle: initHasTitle,
            titlePosition: initialDocument.cells.find((c) => c.id === 'title')?.position,
            formats: parsedFormats,
            rowAxes: savedAxes.rowAxes,
            columnAxes: savedAxes.columnAxes,
          }
        );

        const restoredExtras = collectHybridExtras(initialDocument, basePanelTemplate, [], basePanelTemplate);
        setExtraCustomCells([...restoredExtras, ...(initialDocument.hybridConfig?.version === 2 ? initialDocument.hybridConfig.retainedCells || [] : [])]);

        const defaultLayoutRuleKeys = new Set(
          basePanelTemplate.layoutRules.map(
            (r) => `${r.kind}:${r.range?.startRow},${r.range?.startColumn},${r.range?.endRow},${r.range?.endColumn}`
          )
        );
        const restoredRules = (initialDocument.layoutRules || []).filter((r) => {
          const key = `${r.kind}:${r.range?.startRow},${r.range?.startColumn},${r.range?.endRow},${r.range?.endColumn}`;
          return !defaultLayoutRuleKeys.has(key);
        });
        setExtraLayoutRules(restoredRules);
        return;
      }

      if (datasetChanged) {
        // 跨数据源智能分配：
        // 1. 若有时间字段，优先作为透视列维度（月份透视）
        const firstDate = dateFields[0];
        if (firstDate) {
          setColTimeField(firstDate.key);
          setColGranularity('month');
          setRowTimeField(undefined);
        } else {
          setColTimeField(undefined);
          setRowTimeField(undefined);
        }

        // 2. 文本字段作为行分类维度
        const firstText = textFields[0];
        const firstField = fieldItems[0];
        if (firstText) {
          setRowCategories([firstText.key]);
        } else if (firstField) {
          setRowCategories([firstField.key]);
        } else {
          setRowCategories([]);
        }
        setColCategories([]);

        // 3. 数值字段默认选为度量指标
        if (numericFields.length > 0) {
          setSelectedMeasures(numericFields.slice(0, 2).map((f) => f.key));
        } else {
          setSelectedMeasures(fieldItems.slice(0, 2).map((f) => f.key));
        }
      } else {
        // 校验并清洗残留的无效 key
        if (rowTimeField && !fieldKeySet.has(rowTimeField)) setRowTimeField(undefined);
        if (colTimeField && !fieldKeySet.has(colTimeField)) setColTimeField(undefined);
        setRowCategories((prev) => prev.filter((k) => fieldKeySet.has(k)));
        setColCategories((prev) => prev.filter((k) => fieldKeySet.has(k)));
        setSelectedMeasures((prev) => {
          const valid = prev.filter((k) => fieldKeySet.has(k));
          if (valid.length === 0) {
            return numericFields.length > 0
              ? numericFields.slice(0, 2).map((f) => f.key)
              : fieldItems.slice(0, 2).map((f) => f.key);
          }
          return valid;
        });
      }
    }, [selectedDatasetId, fieldItems, dataLoading, dataError]);

    // 4.1 单向即时编译生成面板基准受控模板
    const panelGeneratedTemplate = useMemo<CellTemplateDocumentV1>(() => {
      const headersMap: Record<string, string> = {};
      fieldItems.forEach((f) => {
        headersMap[f.key] = f.label;
      });

      const measureColumns = selectedMeasures.map((mKey) => {
        const f = fieldItems.find((item) => item.key === mKey);
        const customAgg = measureAggs[mKey];
        const isNum = f?.type === 'number';
        const defaultAgg = isNum ? 'sum' : 'count';
        return {
          type: 'aggregated' as const,
          field: mKey,
          agg: customAgg || defaultAgg,
          label: f?.label || mKey,
        };
      });

      const finalMeasureCols =
        measureColumns.length > 0
          ? measureColumns
          : [
              {
                type: 'aggregated' as const,
                field: fieldItems[0]?.key || 'val',
                agg: 'sum' as const,
                label: fieldItems[0]?.label || '汇总值',
              },
            ];

      const transformConfig: DynamicTransformConfig = {
        datasetId: selectedDatasetId,
        headers: headersMap,
        dimensions: {
          timeBucket: rowTimeField
            ? {
                field: rowTimeField,
                granularity: rowGranularity,
                customIntervalDays: rowCustomDays,
              }
            : undefined,
          categories: rowCategories,
          columnTimeBucket: colTimeField
            ? {
                field: colTimeField,
                granularity: colGranularity,
              }
            : undefined,
          columnCategories: colCategories,
        },
        columns: finalMeasureCols,
      };

      const axes = normalizeHybridAxes(transformConfig);
      const saved = initialDocument ? readHybridAxes(initialDocument) : { rowAxes: [], columnAxes: [] };
      return compilePanelToCellTemplate(transformConfig, selectedDatasetId, {
        archetype: deducedArchetype,
        rowAxes: preserveSavedAxisOrder(axes.rowAxes, saved.rowAxes),
        columnAxes: preserveSavedAxisOrder(axes.columnAxes, saved.columnAxes),
        datasetName: activeDataset?.name,
        showRowTotals: showRowTotal,
        enableGroupMerge: enableGroupMerge,
        formats: Object.fromEntries(fieldItems.map((f) => [f.key, measureFormats[f.key] || (f.type === 'number' ? 'decimal2' : 'integer')])),
        anchorRow: layoutAnchor.row,
        anchorCol: layoutAnchor.col,
        includeTitle: layoutAnchor.includeTitle,
        titlePosition: { row: layoutAnchor.titleRow, column: layoutAnchor.titleCol },
      });
    }, [
      selectedDatasetId,
      fieldItems,
      rowTimeField,
      rowGranularity,
      rowCustomDays,
      rowCategories,
      colTimeField,
      colGranularity,
      colCategories,
      selectedMeasures,
      measureAggs,
      measureFormats,
      showRowTotal,
      enableGroupMerge,
      layoutAnchor,
      deducedArchetype,
      activeDataset,
    ]);

    const panelGeneratedTemplateRef = useRef(panelGeneratedTemplate);
    panelGeneratedTemplateRef.current = panelGeneratedTemplate;
    const knownPanelCellsRef = useRef(new Map([...(initialDocument?.cells || []),
      ...(initialDocument?.hybridConfig?.version === 2 ? initialDocument.hybridConfig.retainedCells || [] : [])].map((c) => [c.id, c])));
    for (const c of panelGeneratedTemplate.cells) knownPanelCellsRef.current.set(c.id, c);

    // 4.2 双层模板合成引擎：将受控数据区域与用户额外单元格深度融合（受控指标字段受保护，空白格放开驱动）
    const currentTemplate = useMemo<CellTemplateDocumentV1>(() => {
      const mergedCells = mergeHybridCells(panelGeneratedTemplate, extraCustomCells, [...knownPanelCellsRef.current.values()]);
      const primaryRegionId = panelGeneratedTemplate.regions?.[0]?.id || 'region-1';
      const mergedLayoutRules = mergeHybridLayoutRules(panelGeneratedTemplate, extraLayoutRules).filter((r) => !disabledLayoutIds.includes(r.id));

      // 4. 合成动态合并规则 (mergeConfig.policies)
      const sheetId = panelGeneratedTemplate.sheets?.[0]?.id || 'sheet-1';
      const retained = rebindHybridMergeConfig(retainedMergeConfig, [...knownPanelCellsRef.current.values()], panelGeneratedTemplate);
      let activePolicies = [
        ...(panelGeneratedTemplate.mergeConfig?.policies || []).map((p) => {
          const saved = retained?.policies.find((old) => old.id === p.id && old.enabled === false);
          return saved ? { ...p, enabled: false } : p;
        }),
        ...(retained?.policies || []).filter((p) => !p.id.startsWith('merge-policy-')),
      ];

      for (const mc of mergedCells) {
        const policyKind = mc.mergePolicy || (mc.content as any)?.mergePolicy;
        if (!policyKind || policyKind === 'default') {
          continue;
        }

        // 移除原有指向该 templateCellId 的规则
        activePolicies = activePolicies.filter(
          (p) => !(p.target.kind === 'template-cell' && (p.target as any).templateCellId === mc.id)
        );

        const isMeasure = (mc.content as any)?.role === 'measure';
        const isColumn = (mc.content as any)?.role === 'column-dimension';
        const subject = isMeasure ? 'metric-value' : isColumn ? 'column-member-label' : 'row-member-label';
        const direction = isColumn ? 'horizontal' : 'vertical';

        if (policyKind === 'none') {
          activePolicies.push({
            id: `user-policy-${mc.id}`,
            sheetId,
            regionId: mc.regionId || primaryRegionId,
            target: {
              kind: 'template-cell',
              templateCellId: mc.id,
              subject,
            },
            kind: 'group-span',
            direction,
            enabled: false,
            boundary: 'parent-group',
            source: 'user',
            sequence: 1,
          });
        } else if (policyKind === 'group-span') {
          activePolicies.push({
            id: `user-policy-${mc.id}`,
            sheetId,
            regionId: mc.regionId || primaryRegionId,
            target: {
              kind: 'template-cell',
              templateCellId: mc.id,
              subject,
            },
            kind: 'group-span',
            direction,
            enabled: enableGroupMerge,
            boundary: 'parent-group',
            source: 'user',
            sequence: 1,
          });
        } else if (policyKind === 'adjacent-equal') {
          activePolicies.push({
            id: `user-policy-${mc.id}`,
            sheetId,
            regionId: mc.regionId || primaryRegionId,
            target: {
              kind: 'template-cell',
              templateCellId: mc.id,
              subject,
            },
            kind: 'adjacent-equal',
            direction,
            compareBy: 'typed-value',
            mergeNulls: false,
            mergeUndefined: false,
            mergeEmptyStrings: false,
            allowMeasures: true,
            boundary: 'parent-group',
            enabled: true,
            source: 'user',
            sequence: 1,
          });
        }
      }

      const cellIds = new Set(mergedCells.map((c) => c.id));
      activePolicies = activePolicies.filter((p) => p.target.kind !== 'template-cell' || cellIds.has(p.target.templateCellId));
      const policyIds = new Set(activePolicies.map((p) => p.id));
      const mergedMergeConfig: any = {
        capability: 'template-merge-v1',
        identityVersion: 1,
        legacyFallback: 'explicit-only',
        policies: [...new Map(activePolicies.map((p) => [p.id, p])).values()],
        suppressions: (retained?.suppressions || []).filter((s) => policyIds.has(s.policyId)),
      };

      return { ...preserveHybridDocumentMetadata({
        ...panelGeneratedTemplate,
        sheets: panelGeneratedTemplate.sheets.map((s, i) => i === 0 ? { ...s, rowCount: designSize.rows, columnCount: designSize.columns } : s),
        cells: mergedCells,
        layoutRules: mergedLayoutRules,
        mergeConfig: mergedMergeConfig,
        ...(panelGeneratedTemplate.hybridConfig?.version === 2 ? { hybridConfig: { ...panelGeneratedTemplate.hybridConfig,
          retainedMergeConfig: retained, disabledLayoutRuleIds: disabledLayoutIds,
          retainedCells: extraCustomCells.filter((c) => c.panelOwner && c.content.kind === 'field' && !mergedCells.some((m) => m.id === c.id)) } } : {}),
      }, initialDocument), presentationRules: presentationModel, styleRules: visualStyleRules,
        templateRevision: Math.max(panelGeneratedTemplate.templateRevision, presentationModel.revision+1) };
    }, [panelGeneratedTemplate, extraCustomCells, extraLayoutRules, retainedMergeConfig, disabledLayoutIds, enableGroupMerge, initialDocument, designSize, presentationModel, visualStyleRules]);

    const currentTemplateRef = useRef(currentTemplate);
    currentTemplateRef.current = currentTemplate;

    const editState = { rowTimeField, rowGranularity, rowCustomDays, rowCategories, colTimeField, colGranularity,
      colCategories, selectedMeasures, measureAggs, measureFormats, showRowTotal, enableGroupMerge,
      extraCustomCells, extraLayoutRules, retainedMergeConfig, disabledLayoutIds, layoutAnchor, designSize, presentationModel, visualStyleRules };
    type EditSnapshot = typeof editState & { document: CellTemplateDocumentV1; canvasMode: 'design' | 'preview';
      sheetSizes: { id: string; rows: number; columns: number }[] };
    const editStateRef = useRef(editState);
    editStateRef.current = editState;
    const restoreEditRef = useRef<(s: EditSnapshot) => void>(() => {});
    const sourceHistoryRef = useRef<HybridHistory<EditSnapshot> | null>(null);
    if (!sourceHistoryRef.current) sourceHistoryRef.current = new HybridHistory((s) => restoreEditRef.current(s));
    const historyBridgeRef = useRef<ReturnType<typeof bindSourceHistory>>(undefined);
    const flushRef = useRef<() => void>(() => {});
    const pendingBeforeRef = useRef<EditSnapshot | undefined>(undefined);
    const historyTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const captureEdit = useCallback((): EditSnapshot => {
      const workbook = univerPreviewRef.current?.getWorkbookSnapshot();
      return { ...editStateRef.current,
        extraCustomCells: extraCustomCellsRef.current, extraLayoutRules: extraLayoutRulesRef.current,
        document: currentTemplateRef.current, canvasMode: modeRef.current,
        sheetSizes: Object.entries(workbook?.sheets || {}).map(([id, raw]) => ({ id,
          rows: (raw as any).rowCount, columns: (raw as any).columnCount })) };
    }, []);
    const finishSourceEdit = useCallback(() => {
      if (historyTimerRef.current) clearTimeout(historyTimerRef.current);
      historyTimerRef.current = undefined;
      const before = pendingBeforeRef.current;
      if (!before) return;
      pendingBeforeRef.current = undefined;
      flushRef.current();
      sourceHistoryRef.current?.commit(before, captureEdit());
      historyBridgeRef.current?.sync();
    }, [captureEdit]);
    const beginSourceEdit = useCallback((flush = true) => {
      finishSourceEdit();
      if (flush) flushRef.current();
      pendingBeforeRef.current = structuredClone(captureEdit());
    }, [captureEdit, finishSourceEdit]);
    const scheduleSourceEdit = useCallback(() => {
      if (historyTimerRef.current) clearTimeout(historyTimerRef.current);
      historyTimerRef.current = setTimeout(finishSourceEdit, 0);
    }, [finishSourceEdit]);
    const runSourceEdit = (change: () => void) => { beginSourceEdit(); change(); scheduleSourceEdit(); };

    const templateErrors = useMemo(() => validateCellTemplateDocument(currentTemplate, fieldItems.map((f) => f.key)).diagnostics
      .filter((d) => d.severity === 'error'), [currentTemplate, fieldItems]);

    // 5. 根据当前 mode (design vs preview) 构造 Univer 渲染矩阵
    const currentGrid = useMemo<BiGridModel>(() => {
      if (mode === 'preview') {
        if (templateErrors.length) return { type: 'detail', rowCount: 25, colCount: 15, cells: [], merges: [], bindings: [] };
        try {
          const { grid } = expandCellDrivenTemplate(currentTemplate, activeData || []);
          return grid;
        } catch (e) {
          console.warn('[HybridCellDesigner] 展开预览计算异常:', e);
        }
      }

      // 设计态：展现模板占位符与格式
      const cells: any[] = [];
      const merges: any[] = [];

      for (const c of currentTemplate.cells) {
        let display = '';
        let cellBgColor = c.style?.backgroundColor;
        let cellColor = c.style?.color;

        if (c.content.kind === 'field') {
          const role = c.content.role;
          const expand = c.content.expand;
          const arrow = expand === 'down' ? ' ↓' : expand === 'right' ? ' →' : '';
          const op = c.content.operation;
          const opLabel =
            role === 'measure' && op && op !== 'sum'
              ? ` (${op.toUpperCase()})`
              : '';
          const cellMergePolicy = c.mergePolicy || (c.content as any)?.mergePolicy;
          const mergeLabel =
            cellMergePolicy === 'none'
              ? ' [平铺]'
              : cellMergePolicy === 'adjacent-equal'
              ? ' [同值合]'
              : cellMergePolicy === 'group-span'
              ? ' [合]'
              : '';
          display = `{${c.content.displayName || c.content.fieldKey}${opLabel}${mergeLabel}${arrow}}`;

          if (!cellBgColor) {
            if (role === 'row-dimension') {
              cellBgColor = '#e6f7ff';
              cellColor = '#0050b3';
            } else if (role === 'column-dimension') {
              cellBgColor = '#f9f0ff';
              cellColor = '#531dab';
            } else if (role === 'measure') {
              cellBgColor = '#fff7e6';
              cellColor = '#d46b08';
            } else {
              cellBgColor = '#f0f5ff';
              cellColor = '#1d39c4';
            }
          }
        } else if (c.content.kind === 'sheet-formula') {
          display = String(c.content.formula ?? '');
        } else if (c.content.kind === 'literal') {
          display = String(c.content.value ?? '');
        }

        const cellFmtOpts = (c.content as any)?.formatOptions || (c as any).formatOptions;
        const cellTooltip = cellFmtOpts?.tooltip || (c.content as any)?.tooltip;

        cells.push({
          row: c.position.row,
          col: c.position.column,
          value: c.content.kind === 'sheet-formula' ? c.content.formula : display,
          displayText: display,
          role: 'custom',
          tooltip: cellTooltip,
          style: {
            fontFamily: c.style?.fontFamily,
            fontSize: c.style?.fontSize,
            bold: c.style?.bold ?? (c.content.kind === 'field'),
            italic: c.style?.italic,
            color: cellColor,
            align: c.style?.textAlign ?? (c.content.kind === 'field' && c.content.role === 'measure' ? 'right' : undefined),
            verticalAlign: c.style?.verticalAlign ?? 'middle',
            bgColor: cellBgColor,
            wrapText: c.style?.wrapText,
          },
        });
      }

      for (const rule of currentTemplate.layoutRules) {
        if (rule.kind === 'merge' && rule.range) {
          merges.push({
            startRow: rule.range.startRow,
            endRow: rule.range.endRow,
            startCol: rule.range.startColumn,
            endCol: rule.range.endColumn,
          });
        }
      }

      const colWidths = Object.fromEntries(
        (currentTemplate.layoutRules || [])
          .filter((r) => r.kind === 'column-width' && r.index !== undefined && r.size !== undefined)
          .map((r) => [r.index!, r.size!])
      );
      const rowHeights = Object.fromEntries(
        (currentTemplate.layoutRules || [])
          .filter((r) => r.kind === 'row-height' && r.index !== undefined && r.size !== undefined)
          .map((r) => [r.index!, r.size!])
      );

      const maxR = currentTemplate.cells.reduce((max, c) => Math.max(max, c.position.row + 2), designSize.rows);
      const maxC = currentTemplate.cells.reduce((max, c) => Math.max(max, c.position.column + 2), designSize.columns);

      const design = addStaticSpanDesignMerges(currentTemplate, {
        type: 'detail',
        rowCount: maxR,
        colCount: maxC,
        cells,
        merges,
        bindings: [],
        colWidths,
        rowHeights,
      });
      return applyPresentationRules(currentTemplate, design, [], { conditions:false }).grid;
    }, [currentTemplate, mode, activeData, templateErrors, designSize]);

    const currentGridRef = useRef<BiGridModel | undefined>(undefined);
    currentGridRef.current = currentGrid;

    type RenderedState = { grid: BiGridModel; template: CellTemplateDocumentV1; panel: CellTemplateDocumentV1; mode: 'design' | 'preview' };
    const gridStatesRef = useRef(new WeakMap<BiGridModel, RenderedState>());
    gridStatesRef.current.set(currentGrid, { grid: currentGrid, template: currentTemplate, panel: panelGeneratedTemplate, mode });
    const renderedStateRef = useRef<RenderedState | undefined>(undefined);
    const handleGridApplied = useCallback((grid: BiGridModel) => {
      renderedStateRef.current = gridStatesRef.current.get(grid);
      if (univerPreviewRef.current?.getUniverAPI()) (univerPreviewRef.current.getUniverAPI() as any).__biSourceHistoryReplay = false;
      historyBridgeRef.current?.sync();
    }, []);

    restoreEditRef.current = (s) => {
      const api = univerPreviewRef.current?.getUniverAPI();
      if (api) {
        (api as any).__biSourceHistoryReplay = true;
        // 同一视图恢复真实边界，避免连续插入/撤销只移动业务格却不断增加空白行列。
        // 不同视图的投影尺寸由当前数据重新计算，不用设计态尺寸截断预览。
        if (s.canvasMode === modeRef.current) {
          const workbook = api.getActiveWorkbook();
          for (const size of s.sheetSizes) {
            const sheet = workbook?.getSheetBySheetId(size.id);
            if (size.rows > 0) sheet?.setRowCount(size.rows);
            if (size.columns > 0) sheet?.setColumnCount(size.columns);
          }
        }
      }
      renderedStateRef.current = undefined; // 回放完成前禁止把旧画布再采集进新源。
      currentTemplateRef.current = s.document;
      editStateRef.current = s;
      extraCustomCellsRef.current = s.extraCustomCells; extraLayoutRulesRef.current = s.extraLayoutRules;
      layoutAnchorRef.current = s.layoutAnchor;
      setRowTimeField(s.rowTimeField); setRowGranularity(s.rowGranularity); setRowCustomDays(s.rowCustomDays);
      setRowCategories(s.rowCategories); setColTimeField(s.colTimeField); setColGranularity(s.colGranularity);
      setColCategories(s.colCategories); setSelectedMeasures(s.selectedMeasures); setMeasureAggs(s.measureAggs);
      setMeasureFormats(s.measureFormats); setShowRowTotal(s.showRowTotal); setEnableGroupMerge(s.enableGroupMerge);
      setExtraCustomCells(s.extraCustomCells); setExtraLayoutRules(s.extraLayoutRules);
      setRetainedMergeConfig(s.retainedMergeConfig); setDisabledLayoutIds(s.disabledLayoutIds); setLayoutAnchor(s.layoutAnchor);
      setDesignSize(s.designSize); setPresentationModel(s.presentationModel); setVisualStyleRules(s.visualStyleRules);
    };

    // 6. 全量快照同步管道：在保存或切换视图前，深度抓取画布上的自由输入、样式与合并选区
    const flushCanvasToTemplate = useCallback(() => {
      const snapshot = univerPreviewRef.current?.getWorkbookSnapshot();
      if (!snapshot) return;

      const rendered = renderedStateRef.current;
      if (!rendered || rendered.mode !== modeRef.current) return;
      if (rendered.mode === 'preview') {
        const captured = captureHybridPreviewMerges(rendered.template, snapshot, rendered.grid);
        const extras = collectHybridExtras(captured, rendered.panel, extraCustomCellsRef.current, panelGeneratedTemplateRef.current, rendered.template);
        const prior = currentTemplateRef.current.hybridConfig?.version === 2 ? currentTemplateRef.current.hybridConfig.retainedMergeConfig : undefined;
        const retained = mergeRetainedHybridConfig(prior, captured.mergeConfig);
        if (captured.hybridConfig?.version === 2) captured.hybridConfig = { ...captured.hybridConfig, retainedMergeConfig: retained };
        currentTemplateRef.current = { ...currentTemplateRef.current, cells: mergeHybridCells(panelGeneratedTemplateRef.current, extras, [...knownPanelCellsRef.current.values()]), mergeConfig: captured.mergeConfig, layoutRules: captured.layoutRules,
          hybridConfig: captured.hybridConfig };
        extraCustomCellsRef.current = extras;
        const defaultIds = new Set(rendered.panel.layoutRules.map((r) => r.id));
        const layouts = captured.layoutRules.filter((r) => !defaultIds.has(r.id));
        extraLayoutRulesRef.current = layouts;
        editStateRef.current = { ...editStateRef.current, extraCustomCells: extras, extraLayoutRules: layouts,
          retainedMergeConfig: retained, disabledLayoutIds: captured.hybridConfig?.version === 2 ? captured.hybridConfig.disabledLayoutRuleIds || [] : editStateRef.current.disabledLayoutIds };
        setExtraCustomCells(extras);
        setRetainedMergeConfig(retained);
        if (captured.hybridConfig?.version === 2) setDisabledLayoutIds(captured.hybridConfig.disabledLayoutRuleIds || []);
        setExtraLayoutRules(layouts);
        return;
      }
      const syncedDoc = syncDocumentFromWorkbookSnapshot(
        rendered.template,
        snapshot,
        'design',
        rendered.grid
      );
      const newExtras = collectHybridExtras(
        syncedDoc, rendered.panel, extraCustomCellsRef.current, panelGeneratedTemplateRef.current, rendered.template
      );
      if(JSON.stringify(syncedDoc.styleRules)!==JSON.stringify(editStateRef.current.visualStyleRules))setVisualStyleRules(syncedDoc.styleRules);

      const defaultRuleKeys = new Set(
        rendered.panel.layoutRules.map(
          (r) => `${r.kind}:${r.range?.startRow},${r.range?.startColumn},${r.range?.endRow},${r.range?.endColumn}`
        )
      );
      const newExtraRules = syncedDoc.layoutRules.filter((r) => {
        const key = `${r.kind}:${r.range?.startRow},${r.range?.startColumn},${r.range?.endRow},${r.range?.endColumn}`;
        return !defaultRuleKeys.has(key);
      });
      const mergeKey = (r: LayoutRule) => JSON.stringify(r.range);
      const activeMergeKeys = new Set(syncedDoc.layoutRules.filter((r) => r.kind === 'merge').map(mergeKey));
      const removed = rendered.template.layoutRules.filter((r) => r.kind === 'merge' && !activeMergeKeys.has(mergeKey(r))).map((r) => r.id);
      const disabled = [...new Set([...(currentTemplateRef.current.hybridConfig?.version === 2 ? currentTemplateRef.current.hybridConfig.disabledLayoutRuleIds || [] : []), ...removed])];

      // Ref 同步推进，保证本次保存直接读到 F2 快照，而非等待下一次 React 批处理。
      currentTemplateRef.current = {
        ...currentTemplateRef.current,
        styleRules: syncedDoc.styleRules,
        cells: mergeHybridCells(panelGeneratedTemplateRef.current, newExtras, [...knownPanelCellsRef.current.values()]),
        layoutRules: mergeHybridLayoutRules(panelGeneratedTemplateRef.current, newExtraRules).filter((r) => !disabled.includes(r.id)),
        ...(currentTemplateRef.current.hybridConfig?.version === 2 ? { hybridConfig: { ...currentTemplateRef.current.hybridConfig, disabledLayoutRuleIds: disabled } } : {}),
      };
      extraCustomCellsRef.current = newExtras;
      extraLayoutRulesRef.current = newExtraRules;
      editStateRef.current = { ...editStateRef.current, extraCustomCells: newExtras, extraLayoutRules: newExtraRules, disabledLayoutIds: disabled, visualStyleRules: syncedDoc.styleRules };
      setExtraCustomCells(newExtras);
      setExtraLayoutRules(newExtraRules);
      setDisabledLayoutIds(disabled);
    }, []);
    flushRef.current = flushCanvasToTemplate;

    useEffect(() => {
      if (!univerAPI) return;
      const api = univerAPI as any;
      const bridge = bindSourceHistory(univerAPI, sourceHistoryRef.current!);
      historyBridgeRef.current = bridge;
      bridge?.sync();
      let activeCommand: string | undefined;
      const before = api.addEvent(api.Event.BeforeCommandExecute, (event: any) => {
        if (activeCommand || api.__isProgrammaticWrite || api.__biTransaction || api.__biSourceHistoryReplay ||
            !isHybridHistoryCommand(event.id, event.type)) return;
        activeCommand = event.id;
        beginSourceEdit(false);
      });
      const after = api.addEvent(api.Event.CommandExecuted, (event: any) => {
        if (event.id !== activeCommand) return;
        activeCommand = undefined;
        scheduleSourceEdit();
      });
      const undo = api.addEvent(api.Event.BeforeUndo, finishSourceEdit);
      const redo = api.addEvent(api.Event.BeforeRedo, finishSourceEdit);
      return () => {
        if (historyTimerRef.current) clearTimeout(historyTimerRef.current);
        before.dispose(); after.dispose(); undo.dispose(); redo.dispose(); bridge?.dispose();
        historyBridgeRef.current = undefined;
      };
    }, [univerAPI, beginSourceEdit, scheduleSourceEdit, finishSourceEdit]);

    useEffect(() => {
      pendingBeforeRef.current = undefined;
      sourceHistoryRef.current?.reset(); historyBridgeRef.current?.sync();
    }, [selectedDatasetId]);

    const advancedPreviewGrid = useMemo(()=>advancedModalOpen ? expandCellDrivenTemplate(currentTemplate,activeData).grid : undefined,[advancedModalOpen,currentTemplate,activeData]);

    // 7. 挂载 Univer 画布原生事件监听，支持自由单元格驱动、行列结构平移与受控格防篡改保护
    useEffect(() => {
      const api = univerAPI || univerPreviewRef.current?.getUniverAPI();
      if (!api) return;

      const dispose = attachUniverDesignerEvents(api, {
        onDoubleClicked: (pos) => {
          if (modeRef.current !== 'design') return;
          flushCanvasToTemplate();
          const target = currentTemplateRef.current.cells.find(
            (c) => c.sheetId === (pos.sheetId || 'sheet-1') && c.position.row === pos.row && c.position.column === pos.column
          ) || { id: generateTemplateCellId(), sheetId: pos.sheetId || 'sheet-1', regionId: currentTemplateRef.current.regions[0]?.id,
            position: { row: pos.row, column: pos.column }, content: { kind: 'literal' as const, value: '' }, parents: { row: 'none', column: 'none' } };
          setSelectedCellForAdvanced(target);
          setAdvancedModalOpen(true);
        },
        onCellEdited: (edit) => {
          if (modeRef.current !== 'design') return;
          const { row, column, sheetId, value, formula } = edit;
          const targetSheetId = sheetId || 'sheet-1';

          // 核心保护：若为受控字段或向导配置格，严格禁止将其覆写为静态纯文本并立即恢复原值
          const managedCell = panelGeneratedTemplateRef.current.cells.find(
            (c) =>
              (c.sheetId || 'sheet-1') === targetSheetId &&
              c.position.row === row &&
              c.position.column === column
          );

          if (managedCell && managedCell.content.kind !== 'literal') {
            message.info('该单元格为系统受控指标/维度格，字段绑定受保护；您可在空白区域自由录入文本与公式。');

            // 提取该受控单元格的标准原值与显示文本进行还原
            const targetOriginalCell = currentGridRef.current?.cells?.find(
              (c) => c.row === row && c.col === column
            );
            const origDisplay =
              targetOriginalCell?.value ??
              targetOriginalCell?.displayText ??
              `{${(managedCell.content as any).displayName || (managedCell.content as any).fieldKey || ''}}`;

            // 调度异步恢复以确保在 Univer 自身事件流完成后精准回滚画布单元格
            setTimeout(() => {
              try {
                const activeWb = api.getActiveWorkbook?.();
                const ws = targetSheetId
                  ? activeWb?.getSheetBySheetId?.(targetSheetId) || activeWb?.getActiveSheet?.()
                  : activeWb?.getActiveSheet?.();
                const cellRange = ws?.getRange?.(row, column);
                if (cellRange) {
                  (api as any).__isProgrammaticWrite = true;
                  (globalThis as any).__isBiProgrammaticWrite = true;
                  try {
                    if (typeof cellRange.setFormula === 'function') {
                      cellRange.setFormula('');
                    }
                    cellRange.setValue?.({
                      v: origDisplay,
                      t: typeof origDisplay === 'number' ? 2 : 1,
                    });
                  } finally {
                    setTimeout(() => {
                      (api as any).__isProgrammaticWrite = false;
                      (globalThis as any).__isBiProgrammaticWrite = false;
                    }, 50);
                  }
                }
              } catch (err) {
                console.warn('[HybridCellDesigner] 恢复单元格原值异常:', err);
              }
            }, 0);

            // 只拒绝本次内容编辑；已有格式、条件、父格及合并覆盖仍归属于此源格。
            return;
          }

          const strVal = String(value ?? '').trim();
          const isFormula = Boolean(formula || strVal.startsWith('='));

          const existingCell = currentTemplateRef.current.cells.find((c) => c.sheetId === targetSheetId && c.position.row === row && c.position.column === column);
          if ((value === null || value === undefined || value === '') && !formula && !existingCell?.staticSpan && !existingCell?.panelOwner) {
            setExtraCustomCells((prev) =>
              prev.filter((c) => !(c.sheetId === targetSheetId && c.position.row === row && c.position.column === column))
            );
            return;
          }

          const updatedCell: CellDefinition = {
            ...existingCell,
            id: existingCell?.id || generateTemplateCellId(`c-${targetSheetId}-${row}-${column}`),
            literalOverride: Boolean(existingCell?.panelOwner) || existingCell?.literalOverride,
            sheetId: targetSheetId,
            position: { row, column },
            content: isFormula
              ? { kind: 'sheet-formula', formula: formula || strVal }
              : { ...existingCell?.content, kind: 'literal', value: value ?? '' },
            parents: existingCell?.parents || { row: 'none', column: 'none' },
          };

          setExtraCustomCells((prev) => {
            const remaining = prev.filter(
              (c) => !(c.sheetId === targetSheetId && c.position.row === row && c.position.column === column)
            );
            return [...remaining, updatedCell];
          });
        },
        onRowsRemoved: (e) => {
          if (modeRef.current !== 'design') return;
          const { startIndex, count } = e;
          if (count <= 0) return;
          setDesignSize((prev) => ({ ...prev, rows: Math.max(1, prev.rows - count) }));

          // 1. 平移与更新向导锚点与标题
          const prevAnchor = layoutAnchorRef.current;
          let newRow = prevAnchor.row;
          let newIncludeTitle = prevAnchor.includeTitle;
          const titleRow = prevAnchor.titleRow;

          if (prevAnchor.includeTitle && startIndex <= titleRow && startIndex + count > titleRow) {
            newIncludeTitle = false;
          }

          if (startIndex + count <= prevAnchor.row) {
            newRow = Math.max(0, prevAnchor.row - count);
          } else if (startIndex <= prevAnchor.row) {
            newRow = Math.max(0, startIndex);
          }

          setLayoutAnchor({
            ...prevAnchor,
            row: newRow,
            col: prevAnchor.col,
            includeTitle: newIncludeTitle,
            titleRow: titleRow >= startIndex ? Math.max(startIndex, titleRow - count) : titleRow,
          });

          // 2. 平移与清洗自由单元格
          setExtraCustomCells((prev) =>
            prev
              .filter((c) => !(c.position.row >= startIndex && c.position.row < startIndex + count))
              .map((c) => {
                if (c.position.row >= startIndex + count) {
                  return {
                    ...c,
                    position: {
                      ...c.position,
                      row: c.position.row - count,
                    },
                  };
                }
                return c;
              })
          );

          // 3. 平移与清洗额外布局规则
          setExtraLayoutRules((prev) =>
            prev
              .filter((rule) => {
                if (rule.kind === 'row-height' && rule.index !== undefined) {
                  return !(rule.index >= startIndex && rule.index < startIndex + count);
                }
                return true;
              })
              .map((rule) => {
                if (rule.kind === 'row-height' && rule.index !== undefined && rule.index >= startIndex + count) {
                  return { ...rule, index: rule.index - count };
                }
                if (rule.kind === 'merge' && rule.range) {
                  const r = { ...rule.range };
                  if (r.startRow >= startIndex + count) {
                    r.startRow -= count;
                    r.endRow -= count;
                  } else if (r.endRow >= startIndex) {
                    r.endRow = Math.max(r.startRow, r.endRow - count);
                  }
                  return { ...rule, range: r };
                }
                return rule;
              })
          );
        },
        onRowsInserted: (e) => {
          if (modeRef.current !== 'design') return;
          const { startIndex, count } = e;
          if (count <= 0) return;
          setDesignSize((prev) => ({ ...prev, rows: prev.rows + count }));

          const prevAnchor = layoutAnchorRef.current;
          let newRow = prevAnchor.row;
          if (startIndex <= prevAnchor.row) {
            newRow = prevAnchor.row + count;
          }

          setLayoutAnchor((prev) => ({
            ...prev,
            row: newRow,
            titleRow: prev.titleRow >= startIndex ? prev.titleRow + count : prev.titleRow,
          }));

          setExtraCustomCells((prev) =>
            prev.map((c) => {
              if (c.position.row >= startIndex) {
                return {
                  ...c,
                  position: {
                    ...c.position,
                    row: c.position.row + count,
                  },
                };
              }
              return c;
            })
          );

          setExtraLayoutRules((prev) =>
            prev.map((rule) => {
              if (rule.kind === 'row-height' && rule.index !== undefined && rule.index >= startIndex) {
                return { ...rule, index: rule.index + count };
              }
              if (rule.kind === 'merge' && rule.range) {
                const r = { ...rule.range };
                if (r.startRow >= startIndex) {
                  r.startRow += count;
                  r.endRow += count;
                } else if (r.endRow >= startIndex) {
                  r.endRow += count;
                }
                return { ...rule, range: r };
              }
              return rule;
            })
          );
        },
        onColumnsRemoved: (e) => {
          if (modeRef.current !== 'design') return;
          const { startIndex, count } = e;
          if (count <= 0) return;
          setDesignSize((prev) => ({ ...prev, columns: Math.max(1, prev.columns - count) }));

          const prevAnchor = layoutAnchorRef.current;
          let newCol = prevAnchor.col;
          if (startIndex + count <= prevAnchor.col) {
            newCol = Math.max(0, prevAnchor.col - count);
          } else if (startIndex <= prevAnchor.col) {
            newCol = Math.max(0, startIndex);
          }

          setLayoutAnchor((prev) => ({
            ...prev,
            col: newCol,
            includeTitle: prev.includeTitle && !(prev.titleCol >= startIndex && prev.titleCol < startIndex + count),
            titleCol: prev.titleCol >= startIndex ? Math.max(startIndex, prev.titleCol - count) : prev.titleCol,
          }));

          setExtraCustomCells((prev) =>
            prev
              .filter((c) => !(c.position.column >= startIndex && c.position.column < startIndex + count))
              .map((c) => {
                if (c.position.column >= startIndex + count) {
                  return {
                    ...c,
                    position: {
                      ...c.position,
                      column: c.position.column - count,
                    },
                  };
                }
                return c;
              })
          );

          setExtraLayoutRules((prev) =>
            prev
              .filter((rule) => {
                if (rule.kind === 'column-width' && rule.index !== undefined) {
                  return !(rule.index >= startIndex && rule.index < startIndex + count);
                }
                return true;
              })
              .map((rule) => {
                if (rule.kind === 'column-width' && rule.index !== undefined && rule.index >= startIndex + count) {
                  return { ...rule, index: rule.index - count };
                }
                if (rule.kind === 'merge' && rule.range) {
                  const r = { ...rule.range };
                  if (r.startColumn >= startIndex + count) {
                    r.startColumn -= count;
                    r.endColumn -= count;
                  } else if (r.endColumn >= startIndex) {
                    r.endColumn = Math.max(r.startColumn, r.endColumn - count);
                  }
                  return { ...rule, range: r };
                }
                return rule;
              })
          );
        },
        onColumnsInserted: (e) => {
          if (modeRef.current !== 'design') return;
          const { startIndex, count } = e;
          if (count <= 0) return;
          setDesignSize((prev) => ({ ...prev, columns: prev.columns + count }));

          const prevAnchor = layoutAnchorRef.current;
          let newCol = prevAnchor.col;
          if (startIndex <= prevAnchor.col) {
            newCol = prevAnchor.col + count;
          }

          setLayoutAnchor((prev) => ({
            ...prev,
            col: newCol,
            titleCol: prev.titleCol >= startIndex ? prev.titleCol + count : prev.titleCol,
          }));

          setExtraCustomCells((prev) =>
            prev.map((c) => {
              if (c.position.column >= startIndex) {
                return {
                  ...c,
                  position: {
                    ...c.position,
                    column: c.position.column + count,
                  },
                };
              }
              return c;
            })
          );

          setExtraLayoutRules((prev) =>
            prev.map((rule) => {
              if (rule.kind === 'column-width' && rule.index !== undefined && rule.index >= startIndex) {
                return { ...rule, index: rule.index + count };
              }
              if (rule.kind === 'merge' && rule.range) {
                const r = { ...rule.range };
                if (r.startColumn >= startIndex) {
                  r.startColumn += count;
                  r.endColumn += count;
                } else if (r.endColumn >= startIndex) {
                  r.endColumn += count;
                }
                return { ...rule, range: r };
              }
              return rule;
            })
          );
        },
      });

      return () => {
        dispose();
      };
    }, [univerAPI]);

    const handleSaveAdvancedSettings = (updated: AdvancedCellUpdate) => {
      if (!selectedCellForAdvanced) return;
      beginSourceEdit();
      const { presentationRules: newRules, visualStyleRules: newStyles, ...cellUpdate } = updated;
      if(newRules)setPresentationModel(newRules);
      if(newStyles)setVisualStyleRules(newStyles);
      const { row, column } = selectedCellForAdvanced.position;

      // 1. 同步格式与聚合操作到左侧控制面板
      const targetFmt = updated.formatOptions?.format || (updated.content as any)?.formatOptions?.format || (updated.content as any)?.format;
      const targetOp = (updated.content as any)?.operation;
      const fieldKey =
        (selectedCellForAdvanced.content as any)?.fieldKey ||
        (selectedCellForAdvanced.content as any)?.fieldId;

      if (fieldKey) {
        if (targetFmt !== undefined) {
          setMeasureFormats((prev) => {
            const next = { ...prev };
            if (targetFmt) next[fieldKey] = targetFmt;
            else delete next[fieldKey];
            return next;
          });
        }
        if (targetOp && ['sum', 'count', 'avg', 'max', 'min'].includes(targetOp)) {
          setMeasureAggs((prev) => ({ ...prev, [fieldKey]: targetOp }));
        }
      }

      // 2. 单格属性保存到 extras，普通样式和条件规则分别通过源状态原子提交。
      const prevContent = (selectedCellForAdvanced.content || {}) as any;
      const updatedContent = (updated.content || {}) as any;
      const mergedFmtOpts = updated.formatOptions || updatedContent?.formatOptions;
      const mergedMergePolicy = updated.mergePolicy || (updated as any)?.content?.mergePolicy || mergedFmtOpts?.mergePolicy || selectedCellForAdvanced.mergePolicy;
      const mergedContent = {
        ...prevContent,
        ...updatedContent,
        formatOptions: mergedFmtOpts,
        tooltip: updatedContent?.tooltip || (updated as any)?.tooltip,
        mergePolicy: mergedMergePolicy,
      };

      const updatedCell: CellDefinition = {
        ...selectedCellForAdvanced,
        ...cellUpdate,
        style: {
          ...(selectedCellForAdvanced.style || {}),
          ...(updated.style || {}),
        },
        parents: updated.parents !== undefined ? updated.parents : selectedCellForAdvanced.parents,
        formatOptions: mergedFmtOpts,
        mergePolicy: mergedMergePolicy,
        content: mergedContent as any,
      };

      setExtraCustomCells((prev) => {
        const remaining = prev.filter(
          (c) => !(c.sheetId === selectedCellForAdvanced.sheetId && c.position.row === row && c.position.column === column)
        );
        return [...remaining, updatedCell];
      });

      setAdvancedModalOpen(false);
      scheduleSourceEdit();
      message.success(`已更新单元格 [R${row + 1}C${column + 1}] 的高级属性`);
    };

    const handleModeChange = async (newMode: 'design' | 'preview') => {
      if (switchingView || mode === newMode) return;
      setSwitchingView(true);
      try {
        await univerPreviewRef.current?.waitForFormulaSettled();
        finishSourceEdit();
        flushCanvasToTemplate();
        setMode(newMode);
      } finally { setSwitchingView(false); }
    };

    const handleMeasureFormatChange = (fieldKey: string, format: HybridFormatPreset) => {
      beginSourceEdit();
      setMeasureFormats((prev) => ({ ...prev, [fieldKey]: format }));
      setExtraCustomCells((prev) => prev.map((c) => c.content.kind === 'field' && c.content.fieldKey === fieldKey
        ? applyHybridFormatPreset(c, format) : c));
      scheduleSourceEdit();
    };

    const handleMeasureAggChange = (fieldKey: string, operation: 'sum' | 'count' | 'avg' | 'max' | 'min') => {
      beginSourceEdit();
      setMeasureAggs((prev) => ({ ...prev, [fieldKey]: operation }));
      setExtraCustomCells((prev) => prev.map((c) => c.content.kind === 'field' && c.content.fieldKey === fieldKey
        ? { ...c, content: { ...c.content, operation } } : c));
      scheduleSourceEdit();
    };

    // 8. 对外暴露 Ref 接口
    useImperativeHandle(
      ref,
      () => ({
        getTemplate: () => {
          finishSourceEdit();
          flushCanvasToTemplate();
          return currentTemplateRef.current;
        },
        validateAndGetReport: async (): Promise<CompileCellReportResult> => {
          if (dataLoading || dataError) throw new Error(dataLoading ? '数据源正在加载，请完成后再保存' : `数据源加载失败：${dataError?.message}`);
          try {
            await univerPreviewRef.current?.waitForFormulaSettled();
          } catch (e) {
            console.warn('[HybridCellDesigner] waitForFormulaSettled error ignored:', e);
          }
          flushCanvasToTemplate();
          const doc = currentTemplateRef.current;
          return compileCellReport(doc, activeData, { availableFields: fieldItems.map((f) => f.key) });
        },
      }),
      [activeData, flushCanvasToTemplate, fieldItems, dataLoading, dataError, finishSourceEdit]
    );

    return (
      <div
        style={{
          display: 'flex',
          width: '100%',
          height,
          backgroundColor: isDark ? '#141414' : '#f5f5f5',
          overflow: 'hidden',
        }}
      >
        {/* 左侧：400px 控制台面板（按照图二卡片结构） */}
        <div
          style={{
            width: 400,
            minWidth: 400,
            maxWidth: 400,
            height: '100%',
            backgroundColor: isDark ? '#1f1f1f' : '#ffffff',
            borderRight: '1px solid #e8e8e8',
            display: 'flex',
            flexDirection: 'column',
            boxSizing: 'border-box',
          }}
        >
          {/* 顶部标题与数据源切换 */}
          <div style={{ padding: '12px 16px', borderBottom: '1px solid #f0f0f0' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <Space size={6}>
                <TableOutlined style={{ color: '#1677ff', fontSize: 16 }} />
                <Text strong style={{ fontSize: 14, color: chromeColor }}>
                  向导配置面板
                </Text>
              </Space>
              {isCrossTab ? (
                <Tag color="purple" style={{ margin: 0, fontWeight: 500, borderRadius: 10, padding: '0 8px' }}>
                  双向交叉透视
                </Tag>
              ) : hasRowDims ? (
                <Tag color="blue" style={{ margin: 0, fontWeight: 500, borderRadius: 10, padding: '0 8px' }}>
                  层级分组统计
                </Tag>
              ) : (
                <Tag color="default" style={{ margin: 0, borderRadius: 10, padding: '0 8px' }}>
                  明细清单流水
                </Tag>
              )}
            </div>
            <Select
              size="small"
              style={{ width: '100%' }}
              value={selectedDatasetId}
              onChange={(val) => setSelectedDatasetId(val)}
              options={candidateDatasets.map((ds) => {
                const count = Array.isArray(ds.data)
                  ? ds.data.length
                  : getCachedDatasetData(ds.id)?.data?.length || 0;
                return {
                  label: `${ds.name || ds.id} (${count} 条)`,
                  value: ds.id,
                };
              })}
            />
          </div>

          {/* 中间表单区域（图二两张彩色卡片 + 度量卡片） */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px' }}>
            {/* 模块 1: 行维度 (纵向向下展开) 蓝色卡片 */}
            <div
              style={{
                backgroundColor: '#f8faff',
                border: '1px solid #d6e4ff',
                borderRadius: 8,
                padding: '10px 12px',
                marginBottom: 12,
              }}
            >
              <div style={{ marginBottom: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <Tag
                  style={{
                    margin: 0,
                    fontSize: 12,
                    fontWeight: 600,
                    backgroundColor: '#e6f4ff',
                    color: '#0958d9',
                    border: '1px solid #91caff',
                    borderRadius: 4,
                    padding: '1px 8px',
                  }}
                >
                  行维度 (纵向展开)
                </Tag>
                <Text type="secondary" style={{ fontSize: 11 }}>
                  沿纵向向下排布
                </Text>
              </div>

              {/* 行时间周期 */}
              <div style={{ marginBottom: 8 }}>
                <Space size={4} style={{ marginBottom: 4 }}>
                  <CalendarOutlined style={{ color: '#1677ff' }} />
                  <Text strong style={{ fontSize: 12 }}>
                    行时间周期:
                  </Text>
                </Space>
                <Space.Compact block>
                  <Select
                    size="small"
                    placeholder={timeFields.length > 0 ? '选择时间字段 (可选)' : '暂无时间类型字段'}
                    notFoundContent="暂无时间类型字段"
                    allowClear
                    style={{ width: '60%' }}
                    value={rowTimeField}
                    onChange={(val) => runSourceEdit(() => setRowTimeField(val))}
                    options={rowTimeOptions}
                  />
                  <Select
                    size="small"
                    disabled={!rowTimeField}
                    style={{ width: '40%' }}
                    value={rowGranularity}
                    onChange={(val) => runSourceEdit(() => setRowGranularity(val as TimeGranularity))}
                    options={[
                      { value: 'hour', label: '时' },
                      { value: 'day', label: '日' },
                      { value: 'week', label: '周' },
                      { value: 'month', label: '月' },
                      { value: 'quarter', label: '季' },
                      { value: 'year', label: '年' },
                      { value: 'custom', label: '自定义天数' },
                    ]}
                  />
                </Space.Compact>
                {rowGranularity === 'custom' && rowTimeField && (
                  <div style={{ marginTop: 4 }}>
                    <Space size={6}>
                      <Text type="secondary" style={{ fontSize: 11 }}>
                        自定义天数:
                      </Text>
                      <InputNumber
                        size="small"
                        min={1}
                        max={365}
                        value={rowCustomDays}
                        onChange={(v) => runSourceEdit(() => setRowCustomDays(v || 7))}
                        addonAfter="天"
                      />
                    </Space>
                  </div>
                )}
              </div>

              {/* 行分类维度 */}
              <div>
                <Space size={4} style={{ marginBottom: 4 }}>
                  <AppstoreOutlined style={{ color: '#1677ff' }} />
                  <Text strong style={{ fontSize: 12 }}>
                    行分类维度:
                  </Text>
                </Space>
                <Select
                  size="small"
                  mode="multiple"
                  allowClear
                  maxTagCount="responsive"
                  placeholder="选择行分组分类字段 (如车间/类别)"
                  style={{ width: '100%' }}
                  value={rowCategories}
                  onChange={(vals) => runSourceEdit(() => setRowCategories(vals))}
                  options={categoryOptions}
                />
                <Text type="secondary" style={{ fontSize: 11, display: 'block', marginTop: 2 }}>
                  (支持多选，按所选顺序逐层向下嵌套分组)
                </Text>
              </div>
            </div>

            {/* 模块 2: 透视列维度 (横向向右展开) 紫色卡片 */}
            <div
              style={{
                backgroundColor: '#faf8fe',
                border: '1px solid #efdbff',
                borderRadius: 8,
                padding: '10px 12px',
                marginBottom: 12,
              }}
            >
              <div style={{ marginBottom: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <Tag
                  style={{
                    margin: 0,
                    fontSize: 12,
                    fontWeight: 600,
                    backgroundColor: '#f9f0ff',
                    color: '#531dab',
                    border: '1px solid #d3adf7',
                    borderRadius: 4,
                    padding: '1px 8px',
                  }}
                >
                  透视列维度 (横向展开)
                </Tag>
                <Text type="secondary" style={{ fontSize: 11 }}>
                  列头横向矩阵展开
                </Text>
              </div>

              {/* 列时间周期 */}
              <div style={{ marginBottom: 8 }}>
                <Space size={4} style={{ marginBottom: 4 }}>
                  <CalendarOutlined style={{ color: '#722ed1' }} />
                  <Text strong style={{ fontSize: 12 }}>
                    列时间周期:
                  </Text>
                </Space>
                <Space.Compact block>
                  <Select
                    size="small"
                    placeholder={timeFields.length > 0 ? '选择透视时间字段' : '暂无时间类型字段'}
                    notFoundContent="暂无时间类型字段"
                    allowClear
                    style={{ width: '60%' }}
                    value={colTimeField}
                    onChange={(val) => runSourceEdit(() => setColTimeField(val))}
                    options={colTimeOptions}
                  />
                  <Select
                    size="small"
                    disabled={!colTimeField}
                    style={{ width: '40%' }}
                    value={colGranularity}
                    onChange={(val) => runSourceEdit(() => setColGranularity(val as TimeGranularity))}
                    options={[
                      { value: 'hour', label: '时' },
                      { value: 'day', label: '日' },
                      { value: 'week', label: '周' },
                      { value: 'month', label: '月' },
                      { value: 'quarter', label: '季' },
                      { value: 'year', label: '年' },
                    ]}
                  />
                </Space.Compact>
              </div>

              {/* 列分类维度 */}
              <div>
                <Space size={4} style={{ marginBottom: 4 }}>
                  <AppstoreOutlined style={{ color: '#722ed1' }} />
                  <Text strong style={{ fontSize: 12 }}>
                    列分类维度:
                  </Text>
                </Space>
                <Select
                  size="small"
                  mode="multiple"
                  allowClear
                  maxTagCount="responsive"
                  placeholder="选择列透视分类字段 (如产品类型/状态)"
                  style={{ width: '100%' }}
                  value={colCategories}
                  onChange={(vals) => runSourceEdit(() => setColCategories(vals))}
                  options={categoryOptions}
                />
                {(colTimeField ? 1 : 0) + colCategories.length > 2 ? (
                  <Text type="warning" style={{ fontSize: 11, display: 'block', marginTop: 2 }}>
                    ⚠️ 已配置多个列透视维度，建议精简以防列数膨胀
                  </Text>
                ) : (
                  <Text type="secondary" style={{ fontSize: 11, display: 'block', marginTop: 2 }}>
                    (配置后自动开启双向交叉透视)
                  </Text>
                )}
              </div>
            </div>

            {/* 模块 3: 统计度量与展示指标卡片 */}
            <div
              style={{
                backgroundColor: '#fffdf6',
                border: '1px solid #ffe58f',
                borderRadius: 8,
                padding: '10px 12px',
                marginBottom: 12,
              }}
            >
              <div style={{ marginBottom: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <Tag
                  style={{
                    margin: 0,
                    fontSize: 12,
                    fontWeight: 600,
                    backgroundColor: '#fffbe6',
                    color: '#d46b08',
                    border: '1px solid #ffd591',
                    borderRadius: 4,
                    padding: '1px 8px',
                  }}
                >
                  统计度量指标
                </Tag>
                <Space size={6}>
                  <Button
                    type="link"
                    size="small"
                    style={{ padding: 0, fontSize: 11 }}
                    onClick={() => runSourceEdit(() => setSelectedMeasures(fieldItems.map((f) => f.key)))}
                  >
                    全选
                  </Button>
                  <Divider type="vertical" style={{ margin: '0 2px' }} />
                  <Button
                    type="link"
                    size="small"
                    style={{ padding: 0, fontSize: 11 }}
                    onClick={() => runSourceEdit(() => setSelectedMeasures([]))}
                  >
                    清空
                  </Button>
                </Space>
              </div>

              <Checkbox.Group
                value={selectedMeasures}
                onChange={(vals) => runSourceEdit(() => setSelectedMeasures(vals as string[]))}
                style={{ width: '100%' }}
              >
                <Space direction="vertical" style={{ width: '100%' }} size={4}>
                  {fieldItems.map((f) => {
                    const isNum = f.type === 'number';
                    const currentAgg = measureAggs[f.key] || (isNum ? 'sum' : 'count');
                    const measureCell = currentTemplate.cells.find((c) => c.content.kind === 'field' &&
                      c.content.fieldKey === f.key && !c.id.startsWith('meas-rowtotal-') &&
                      (c.content.role === 'measure' || c.content.role === 'detail-column'));
                    const currentFmt = measureCell ? readHybridFormatPreset(measureCell) : measureFormats[f.key] || (isNum ? 'decimal2' : 'integer');
                    const isChecked = selectedMeasures.includes(f.key);
                    return (
                      <div
                        key={f.key}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '2px 4px',
                          borderRadius: 4,
                          backgroundColor: isChecked ? '#fff7e6' : 'transparent',
                        }}
                      >
                        <Checkbox value={f.key} style={{ fontSize: 12 }}>
                          <span>{f.label}</span>
                          <span style={{ fontSize: 10, color: '#8c8c8c', marginLeft: 4 }}>({f.key})</span>
                        </Checkbox>
                        <Space size={4}>
                          <Select
                            size="small"
                            style={{ width: 68 }}
                            value={currentAgg}
                            disabled={!isChecked}
                            onChange={(aggVal) =>
                              handleMeasureAggChange(f.key, aggVal)
                            }
                            options={[
                              { value: 'sum', label: '求和' },
                              { value: 'count', label: '计数' },
                              { value: 'avg', label: '平均' },
                              { value: 'max', label: '最大' },
                              { value: 'min', label: '最小' },
                            ]}
                          />
                          <Select
                            size="small"
                            style={{ width: 85 }}
                            value={currentFmt}
                            disabled={!isChecked}
                            onChange={(fmtVal) =>
                              handleMeasureFormatChange(f.key, fmtVal as HybridFormatPreset)
                            }
                            options={[
                              { value: 'decimal2', label: '两位小数' },
                              { value: 'integer', label: '千分整数' },
                              { value: 'currency', label: '金额 (¥)' },
                              { value: 'percent', label: '百分比' },
                              { value: 'number', label: '常规数值' },
                              ...(currentFmt === 'custom' ? [{ value: 'custom', label: '自定义', disabled: true }] : []),
                            ]}
                          />
                        </Space>
                      </div>
                    );
                  })}
                </Space>
              </Checkbox.Group>
            </div>

            {/* 模块 4: 汇总与合并选项卡片 (来自模式二高价值特性) */}
            <div
              style={{
                backgroundColor: '#f6ffed',
                border: '1px solid #b7eb8f',
                borderRadius: 8,
                padding: '10px 12px',
                marginBottom: 0,
              }}
            >
              <div style={{ marginBottom: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <Tag
                  style={{
                    margin: 0,
                    fontSize: 12,
                    fontWeight: 600,
                    backgroundColor: '#d9f7be',
                    color: '#389e0d',
                    border: '1px solid #95de64',
                    borderRadius: 4,
                    padding: '1px 8px',
                  }}
                >
                  汇总与合并选项
                </Tag>
                <Text type="secondary" style={{ fontSize: 11 }}>
                  工业排版增强
                </Text>
              </div>
              <Space direction="vertical" style={{ width: '100%' }} size={6}>
                {isCrossTab && (
                  <Checkbox
                    checked={showRowTotal}
                    onChange={(e) => runSourceEdit(() => setShowRowTotal(e.target.checked))}
                    style={{ fontSize: 12 }}
                  >
                    <span>开启行总计</span>
                    <span style={{ fontSize: 11, color: '#8c8c8c', marginLeft: 4 }}>
                      (各分类水平总计)
                    </span>
                  </Checkbox>
                )}
                <Checkbox
                  checked={enableGroupMerge}
                  onChange={(e) => runSourceEdit(() => {
                    setEnableGroupMerge(e.target.checked);
                    if (e.target.checked) setRetainedMergeConfig((prev) => prev ? { ...prev,
                      policies: prev.policies.filter((p) => !p.id.startsWith('merge-policy-')),
                      suppressions: prev.suppressions.filter((sup) => !sup.policyId.startsWith('merge-policy-')) } : prev);
                  })}
                  style={{ fontSize: 12 }}
                >
                  <span>同类项单元格合并</span>
                    <span style={{ fontSize: 11, color: '#8c8c8c', marginLeft: 4 }}>
                      (取消合并后仅保留首格值)
                  </span>
                </Checkbox>
              </Space>
            </div>
          </div>
        </div>

        {/* 右侧：Univer 主画布与双模视口 */}
        <div
          style={{
            flex: 1,
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
          {/* 右侧工具栏 */}
          <div
            style={{
              height: 48,
              minHeight: 48,
              padding: '0 16px',
              backgroundColor: isDark ? '#1f1f1f' : '#ffffff',
              borderBottom: '1px solid #e8e8e8',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <Space size={10}>
              <Text strong style={{ fontSize: 13, color: chromeColor }}>
                {currentTemplate.title}
              </Text>
              <Tag color="cyan" style={{ margin: 0 }}>
                {activeDataset?.name || selectedDatasetId}
              </Tag>
              <Text type="secondary" style={{ fontSize: 11, color: isDark ? '#bfbfbf' : undefined }}>
                行维度 {currentTemplate.hybridConfig?.version === 2 ? currentTemplate.hybridConfig.rowAxes.length : 0} 级 · 列维度 {currentTemplate.hybridConfig?.version === 2 ? currentTemplate.hybridConfig.columnAxes.length : 0} 级
              </Text>
            </Space>

            <Space size={12}>
              {/* 视角切换 Segmented 控件 */}
              <Segmented
                size="small"
                disabled={switchingView}
                value={mode}
                onChange={(val) => handleModeChange(val as 'design' | 'preview')}
                options={[
                  {
                    label: '模板设计态 (结构)',
                    value: 'design',
                    icon: <EditOutlined />,
                  },
                  {
                    label: '动态展开预览 (数据)',
                    value: 'preview',
                    icon: <EyeOutlined />,
                  },
                ]}
              />
            </Space>
          </div>

          {dataLoading && <Alert type="info" showIcon message="正在加载数据源，请稍候；加载完成后可预览和保存" />}
          {dataError && <Alert type="error" showIcon message={`数据源加载失败：${dataError.message}`} action={<Button size="small" onClick={() => void resolvedDataset.refresh()}>重试加载</Button>} />}
          {!dataLoading && !dataError && templateErrors.length > 0 && <Alert type="error" showIcon message="配置尚未通过校验，预览和保存已阻止" description={templateErrors.map((d) => d.message).join('；')} />}
          {/* 右侧 Univer 画布容器 */}
          <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
            <UniverPreview
              ref={univerPreviewRef}
              onReady={setUniverAPI}
              onGridApplied={handleGridApplied}
              initialGrid={currentGrid}
              syncGridStyles
              fitGridSize
              height="100%"
            />
          </div>
        </div>

        {/* 单元格高级属性配置弹窗 (双击受控格或任意模板格时触发) */}
        {advancedModalOpen && (
          <CellAdvancedSettings
            open={advancedModalOpen}
            cell={selectedCellForAdvanced}
            document={currentTemplate}
            fields={fieldItems}
            previewGrid={advancedPreviewGrid}
            onSave={handleSaveAdvancedSettings}
            onCancel={() => setAdvancedModalOpen(false)}
          />
        )}
      </div>
    );
  }
);

HybridCellDesigner.displayName = 'HybridCellDesigner';
