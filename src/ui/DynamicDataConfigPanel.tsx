import React, { useState, useEffect, useMemo, useCallback, useImperativeHandle } from 'react';
import { Row, Col, Space, Button, message, Tooltip, Tag, Divider, Select, Spin, Alert } from 'antd';
import {
  CopyOutlined,
  ImportOutlined,
  LineChartOutlined,
  BarChartOutlined,
  PieChartOutlined,
  TableOutlined,
  ThunderboltOutlined,
  CalendarOutlined,
  ProfileOutlined,
  DatabaseOutlined,
  CodeOutlined,
  InfoCircleOutlined,
  ReloadOutlined,
  CloudDownloadOutlined,
} from '@ant-design/icons';
import type { DataRecord } from '../types.js';
import type { DynamicDataConfigPanelProps, DynamicDataConfigPanelRef } from './types.js';
import type {
  DynamicTransformConfig,
  FieldMeta,
  FieldDataType,
  ColumnConfig,
  ComputedColumnConfig,
  TransformResult,
  DimensionConfig,
  AggregationFunction,
} from '../engine/types.js';
import { profileDataset } from '../engine/profiler.js';
import { transformData } from '../engine/pipeline.js';
import { validateTransformConfig, type ConfigValidationResult } from '../engine/validator.js';
import { convertColumnsToAggregated, convertColumnsToFixed, formatAggregatedLabel } from '../engine/modeAdapter.js';
import { PIVOT_TEMPLATES } from '../engine/slotMatcher.js';
import { FieldProfilerList } from './components/FieldProfilerList.js';
import { DimensionConfigComponent } from './components/DimensionConfig.js';
import { ColumnConfigList } from './components/ColumnConfigList.js';
import { FormulaEditorModal } from './components/FormulaEditorModal.js';
import { LivePreviewTable } from './components/LivePreviewTable.js';
import { ImportConfigModal } from './components/ImportConfigModal.js';
import { SlotConfirmPopover } from './components/SlotConfirmPopover.js';
import { useDynamicDataLocale, DynamicDataLocaleContext } from '../locale/index.js';
import {
  useRegisteredDatasets,
  resolveDatasetData,
  type RegisteredDataset,
  type DatasetDataLoader,
} from '../core/datasetRegistry.js';

export const DynamicDataConfigPanel = React.forwardRef<
  DynamicDataConfigPanelRef,
  DynamicDataConfigPanelProps
>(function DynamicDataConfigPanel(
  {
    data: propData,
    headers: propHeaders,
    datasetId: propDatasetId,
    datasets: propDatasets,
    onDatasetChange,
    showDatasetSelector = true,
    value,
    defaultValue,
    onChange,
    onTransformResult,
    sampleLimit = 100,
    style,
    className,
    locale: propLocale,
    showQuickPresets = true,
    showDslTools = false,
  },
  ref
) {
  const t = useDynamicDataLocale(propLocale);

  // 1. 多数据源与注册中心响应式接入 (支持直接代码传入 + 注册制多数据源自由切换)
  const registeredDatasets = useRegisteredDatasets();
  const candidateDatasets: readonly RegisteredDataset[] = useMemo(() => {
    if (propDatasets && propDatasets.length > 0) {
      return propDatasets;
    }
    return registeredDatasets;
  }, [propDatasets, registeredDatasets]);

  // 用户是否显式进行了手动数据源切换
  const [userSelectedDatasetId, setUserSelectedDatasetId] = useState<string | undefined>(undefined);

  const [internalDatasetId, setInternalDatasetId] = useState<string | undefined>(() => {
    if (propDatasetId) return propDatasetId;
    if (value?.datasetId) return value.datasetId;
    if (defaultValue?.datasetId) return defaultValue.datasetId;
    if (!propData && candidateDatasets.length > 0) return candidateDatasets[0]?.id;
    return undefined;
  });

  useEffect(() => {
    setUserSelectedDatasetId(undefined);
    if (propDatasetId !== undefined) {
      setInternalDatasetId(propDatasetId);
    }
  }, [propDatasetId]);

  const effectiveDatasetId = userSelectedDatasetId ?? internalDatasetId ?? propDatasetId ?? value?.datasetId ?? defaultValue?.datasetId;

  const selectedRegisteredDataset = useMemo(() => {
    if (!effectiveDatasetId) {
      return undefined;
    }
    return candidateDatasets.find((d) => d.id === effectiveDatasetId);
  }, [effectiveDatasetId, candidateDatasets]);

  // 异步数据集加载状态与缓存快照
  const [resolvedAsyncData, setResolvedAsyncData] = useState<{
    readonly datasetId: string;
    readonly data: readonly DataRecord[];
    readonly headers?: Record<string, string> | undefined;
  } | null>(() => {
    if (selectedRegisteredDataset && Array.isArray(selectedRegisteredDataset.data)) {
      return {
        datasetId: selectedRegisteredDataset.id,
        data: selectedRegisteredDataset.data,
        headers: selectedRegisteredDataset.headers as Record<string, string> | undefined,
      };
    }
    if (Array.isArray(propData)) {
      return {
        datasetId: '__direct_data__',
        data: propData,
        headers: propHeaders,
      };
    }
    return null;
  });

  const [isDatasetLoading, setIsDatasetLoading] = useState<boolean>(() => {
    if (selectedRegisteredDataset && typeof selectedRegisteredDataset.data === 'function') {
      return true;
    }
    if (typeof propData === 'function') {
      return true;
    }
    return false;
  });
  const [datasetError, setDatasetError] = useState<Error | null>(null);

  const loadActiveDataset = useCallback(
    async (forceRefresh = false) => {
      // 1. 优先使用选中的注册数据集 (Mode B)
      if (selectedRegisteredDataset) {
        const ds = selectedRegisteredDataset;
        if (Array.isArray(ds.data)) {
          setResolvedAsyncData({
            datasetId: ds.id,
            data: ds.data,
            headers: ds.headers as Record<string, string> | undefined,
          });
          setIsDatasetLoading(false);
          setDatasetError(null);
          return;
        }
        if (typeof ds.data === 'function') {
          setIsDatasetLoading(true);
          setDatasetError(null);
          try {
            const res = await resolveDatasetData(ds, { forceRefresh });
            setResolvedAsyncData({
              datasetId: ds.id,
              data: res.data,
              headers: res.headers as Record<string, string> | undefined,
            });
            if (forceRefresh) {
              message.success(t('数据源数据刷新成功'));
            }
          } catch (err) {
            const errorObj = err instanceof Error ? err : new Error(String(err));
            setDatasetError(errorObj);
            message.error(t('数据源加载失败') + ': ' + errorObj.message);
          } finally {
            setIsDatasetLoading(false);
          }
          return;
        }
      }

      // 2. 否则使用直接传入的 propData (Mode A)
      if (propData) {
        if (Array.isArray(propData)) {
          setResolvedAsyncData({
            datasetId: '__direct_data__',
            data: propData,
            headers: propHeaders,
          });
          setIsDatasetLoading(false);
          setDatasetError(null);
          return;
        }
        if (typeof propData === 'function') {
          setIsDatasetLoading(true);
          setDatasetError(null);
          try {
            const res = await (propData as DatasetDataLoader)();
            let finalData: readonly DataRecord[] = [];
            let finalHeaders: Record<string, string> | undefined = propHeaders;
            if (Array.isArray(res)) {
              finalData = res;
            } else if (res && typeof res === 'object' && Array.isArray((res as any).data)) {
              finalData = (res as any).data;
              finalHeaders = (res as any).headers || propHeaders;
            }
            setResolvedAsyncData({
              datasetId: '__direct_data__',
              data: finalData,
              headers: finalHeaders,
            });
            if (forceRefresh) {
              message.success(t('数据源数据刷新成功'));
            }
          } catch (err) {
            const errorObj = err instanceof Error ? err : new Error(String(err));
            setDatasetError(errorObj);
            message.error(t('数据源加载失败') + ': ' + errorObj.message);
          } finally {
            setIsDatasetLoading(false);
          }
          return;
        }
      }

      setResolvedAsyncData(null);
      setIsDatasetLoading(false);
      setDatasetError(null);
    },
    [selectedRegisteredDataset, propData, propHeaders, t]
  );

  useEffect(() => {
    loadActiveDataset(false);
  }, [loadActiveDataset]);

  // 数据集流转优先级：
  // 1. 若异步加载已完成，优先使用解析后的真实事实数据
  // 2. 若当前数据集为静态数组，使用静态数组
  // 3. 兜底为空数组 []
  const effectiveData: readonly DataRecord[] = useMemo(() => {
    if (resolvedAsyncData) {
      return resolvedAsyncData.data;
    }
    if (selectedRegisteredDataset && Array.isArray(selectedRegisteredDataset.data)) {
      return selectedRegisteredDataset.data;
    }
    if (Array.isArray(propData)) {
      return propData;
    }
    return [];
  }, [resolvedAsyncData, selectedRegisteredDataset, propData]);

  const effectiveHeaders: Record<string, string> | undefined = useMemo(() => {
    if (resolvedAsyncData?.headers) {
      return resolvedAsyncData.headers;
    }
    if (selectedRegisteredDataset?.headers) {
      return selectedRegisteredDataset.headers as Record<string, string>;
    }
    if (propHeaders) return propHeaders;
    if (value?.headers) return value.headers;
    if (defaultValue?.headers) return defaultValue.headers;
    return undefined;
  }, [resolvedAsyncData, selectedRegisteredDataset, propHeaders, value?.headers, defaultValue?.headers]);

  // 2. 字段类型探测与用户覆盖
  const [fieldOverrides, setFieldOverrides] = useState<Record<string, FieldDataType>>({});

  const fields: readonly FieldMeta[] = useMemo(() => {
    return profileDataset(effectiveData, {
      headers: effectiveHeaders,
      userOverrides: { ...value?.fields, ...fieldOverrides },
      sampleLimit,
    });
  }, [effectiveData, effectiveHeaders, value?.fields, fieldOverrides, sampleLimit]);

  // 3. 核心受控与内部配置状态（统一为聚合透视与明细自适应模型）
  const [internalConfig, setInternalConfig] = useState<DynamicTransformConfig>(() => {
    if (value) return value;
    if (defaultValue) return defaultValue;
    return {
      ...(effectiveDatasetId ? { datasetId: effectiveDatasetId } : {}),
      columns: [],
      ...(effectiveHeaders ? { headers: effectiveHeaders } : {}),
    };
  });

  const activeConfig = value || internalConfig;
  const hasInitializedRef = React.useRef(false);

  // 当外部 data 传入且 columns 为空时，智能初始化若干固定列 (仅初始化一次，避免死循环)
  useEffect(() => {
    if (!hasInitializedRef.current && activeConfig.columns.length === 0 && fields.length > 0) {
      hasInitializedRef.current = true;
      const initialCols: ColumnConfig[] = fields.slice(0, 5).map((f) => ({
        type: 'fixed',
        field: f.key,
        label: f.label,
      }));
      updateConfig({
        ...activeConfig,
        ...(effectiveDatasetId ? { datasetId: effectiveDatasetId } : {}),
        columns: initialCols,
      });
    }
  }, [fields, activeConfig, effectiveDatasetId]);

  const updateConfig = (next: DynamicTransformConfig) => {
    const activeDatasetId = next.datasetId ?? effectiveDatasetId;
    const nextWithMeta: DynamicTransformConfig = {
      ...next,
      ...(activeDatasetId ? { datasetId: activeDatasetId } : {}),
      headers: effectiveHeaders && !next.headers ? effectiveHeaders : next.headers,
    };
    if (!value) {
      setInternalConfig(nextWithMeta);
    }
    onChange?.(nextWithMeta);
  };

  // 3. 动态列公式弹窗状态与导入弹窗状态
  const [formulaModalOpen, setFormulaModalOpen] = useState(false);
  const [editingComputedCol, setEditingComputedCol] = useState<ComputedColumnConfig | undefined>();
  const [importModalOpen, setImportModalOpen] = useState(false);

  // 一键复制当前配置 JSON
  const handleCopyConfig = async () => {
    try {
      const json = JSON.stringify(activeConfig, null, 2);
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(json);
        message.success(t('已复制 DSL 配置到剪贴板'));
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = json;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
        message.success(t('已复制 DSL 配置到剪贴板'));
      }
    } catch {
      message.warning(t('复制失败，请检查浏览器权限'));
      console.log('[DynamicDataTransformConfig]', JSON.stringify(activeConfig, null, 2));
    }
  };

  // 确认导入新配置
  const handleImportConfig = (newConfig: DynamicTransformConfig) => {
    updateConfig(newConfig);
    setImportModalOpen(false);
  };

  // 一键套用分析模板 (趋势分析、对比排行、全量明细、占比分析)
  const handleApplyQuickPreset = (presetType: 'trend' | 'ranking' | 'detail' | 'share') => {
    const timeField = fields.find((f) => f.type === 'time')?.key;
    const textField = fields.find((f) => f.type === 'text')?.key;
    const numberFields = fields.filter((f) => f.type === 'number');

    let nextDimensions: DimensionConfig | undefined = undefined;
    let nextColumns: ColumnConfig[] = [];

    if (presetType === 'trend') {
      // 趋势分析：优先选取时间字段聚合，度量求和
      if (timeField) {
        nextDimensions = {
          timeBucket: { field: timeField, granularity: 'month', customIntervalDays: 7 },
          ...(textField ? { categories: [textField] } : {}),
        };
      } else if (textField) {
        nextDimensions = { categories: [textField] };
      }
      if (numberFields.length > 0) {
        nextColumns = numberFields.map((f) => ({
          type: 'aggregated',
          field: f.key,
          agg: 'sum',
          label: formatAggregatedLabel(f.label, 'sum'),
        }));
      } else {
        nextColumns = fields.slice(0, 5).map((f) => ({ type: 'fixed', field: f.key, label: f.label }));
      }
    } else if (presetType === 'ranking') {
      // 对比排行：按分类类别分组，度量求和
      const categoryField = textField || fields[0]?.key;
      if (categoryField) {
        nextDimensions = { categories: [categoryField] };
      }
      if (numberFields.length > 0) {
        nextColumns = numberFields.map((f) => ({
          type: 'aggregated',
          field: f.key,
          agg: 'sum',
          label: formatAggregatedLabel(f.label, 'sum'),
        }));
      } else {
        nextColumns = fields.slice(0, 5).map((f) => ({ type: 'fixed', field: f.key, label: f.label }));
      }
    } else if (presetType === 'share') {
      // 占比分析：按分类类别分组，取首个核心度量求和
      const categoryField = textField || fields[0]?.key;
      if (categoryField) {
        nextDimensions = { categories: [categoryField] };
      }
      const primaryNum = numberFields[0] || fields[1] || fields[0];
      if (primaryNum) {
        nextColumns = [{
          type: 'aggregated',
          field: primaryNum.key,
          agg: 'sum',
          label: formatAggregatedLabel(primaryNum.label, 'sum'),
        }];
      }
    } else {
      // 全量明细：清除所有分组维度，展示前 8 个原始固定列
      nextDimensions = undefined;
      nextColumns = fields.slice(0, 8).map((f) => ({
        type: 'fixed',
        field: f.key,
        label: f.label,
      }));
    }

    updateConfig({
      ...activeConfig,
      dimensions: nextDimensions,
      columns: nextColumns,
    });
    message.success(t('已套用分析预设模板'));
  };

  // 一键应用语义槽位透视模板 (带置信度与槽位推断)
  const handleApplySlotConfig = (newConfig: DynamicTransformConfig) => {
    updateConfig(newConfig);
    message.success(t('已套用透视分析预设模板'));
  };

  // 4. 实时试算与输出
  const transformResult: TransformResult = useMemo(() => {
    try {
      const runConfig: DynamicTransformConfig =
        effectiveHeaders && !activeConfig.headers
          ? { ...activeConfig, headers: effectiveHeaders }
          : activeConfig;
      return transformData(effectiveData, runConfig);
    } catch {
      return {
        data: [],
        columns: [],
        meta: {
          inputRows: effectiveData.length,
          outputRows: 0,
          executionTimeMs: 0,
        },
      };
    }
  }, [effectiveData, activeConfig, effectiveHeaders]);

  const onTransformResultRef = React.useRef(onTransformResult);
  onTransformResultRef.current = onTransformResult;

  useEffect(() => {
    onTransformResultRef.current?.(transformResult);
  }, [transformResult]);

  // 切换数据源处理
  const handleDatasetSelect = useCallback(
    async (newId: string) => {
      if (newId === '__direct_data__') {
        setUserSelectedDatasetId(undefined);
        setInternalDatasetId(undefined);
        onDatasetChange?.(undefined as unknown as string, undefined as unknown as RegisteredDataset);
        message.success(t('已切换至数据源: {name}', { name: t('代码直接传入数据源') }));
        setFieldOverrides({});

        let directRecords: readonly DataRecord[] = [];
        let directHeaders = propHeaders;
        if (Array.isArray(propData)) {
          directRecords = propData;
        } else if (typeof propData === 'function') {
          setIsDatasetLoading(true);
          setDatasetError(null);
          try {
            const res = await resolveDatasetData(propData);
            directRecords = res.data;
            if (res.headers) directHeaders = res.headers as Record<string, string>;
            setResolvedAsyncData({
              datasetId: '__direct_data__',
              data: res.data,
              headers: res.headers as Record<string, string> | undefined,
            });
          } catch (err) {
            const errorObj = err instanceof Error ? err : new Error(String(err));
            setDatasetError(errorObj);
            message.error(`${t('数据源加载失败')}: ${errorObj.message}`);
          } finally {
            setIsDatasetLoading(false);
          }
        }

        const newFields = profileDataset(directRecords, { headers: directHeaders, sampleLimit });
        const newFieldKeys = new Set(newFields.map((f) => f.key));

        let nextDims: DimensionConfig | undefined = undefined;
        if (activeConfig.dimensions) {
          const origDims = activeConfig.dimensions;
          const timeBucket = origDims.timeBucket && newFieldKeys.has(origDims.timeBucket.field) ? origDims.timeBucket : undefined;
          const categories = origDims.categories ? origDims.categories.filter((c) => newFieldKeys.has(c)) : undefined;
          const finalCategories = categories && categories.length > 0 ? categories : undefined;
          const columnTimeBucket = origDims.columnTimeBucket && newFieldKeys.has(origDims.columnTimeBucket.field) ? origDims.columnTimeBucket : undefined;
          const columnCategories = origDims.columnCategories ? origDims.columnCategories.filter((c) => newFieldKeys.has(c)) : undefined;
          const finalColumnCategories = columnCategories && columnCategories.length > 0 ? columnCategories : undefined;

          if (timeBucket || finalCategories || columnTimeBucket || finalColumnCategories) {
            nextDims = {
              ...(timeBucket ? { timeBucket } : {}),
              ...(finalCategories ? { categories: finalCategories } : {}),
              ...(columnTimeBucket ? { columnTimeBucket } : {}),
              ...(finalColumnCategories ? { columnCategories: finalColumnCategories } : {}),
            };
          }
        }

        let nextCols = activeConfig.columns.filter((c) => {
          if (c.type === 'fixed' || c.type === 'aggregated') {
            return newFieldKeys.has(c.field);
          }
          return true;
        });

        if (nextCols.length === 0 && newFields.length > 0) {
          nextCols = newFields.slice(0, Math.min(5, newFields.length)).map((f) => ({
            type: 'fixed' as const,
            field: f.key,
            label: f.label,
          }));
        }

        updateConfig({
          ...activeConfig,
          datasetId: undefined,
          dimensions: nextDims,
          columns: nextCols,
          headers: propHeaders,
        });
        return;
      }

      setUserSelectedDatasetId(newId);
      setInternalDatasetId(newId);
      const targetDs = candidateDatasets.find((d) => d.id === newId);
      if (targetDs) {
        onDatasetChange?.(newId, targetDs);
        message.success(t('已切换至数据源: {name}', { name: targetDs.name }));
      }
      setFieldOverrides({});

      // 切换数据源时进行配置自适应流转：
      if (targetDs?.defaultConfig) {
        updateConfig({
          ...targetDs.defaultConfig,
          datasetId: newId,
          headers: targetDs.headers || targetDs.defaultConfig.headers,
        });
        return;
      }

      let targetData: readonly DataRecord[] = [];
      let targetHeaders: Record<string, string> | undefined = targetDs?.headers as Record<string, string> | undefined;
      if (targetDs) {
        if (Array.isArray(targetDs.data)) {
          targetData = targetDs.data;
        } else if (typeof targetDs.data === 'function') {
          setIsDatasetLoading(true);
          setDatasetError(null);
          try {
            const res = await resolveDatasetData(targetDs);
            targetData = res.data;
            if (res.headers) targetHeaders = res.headers as Record<string, string>;
            setResolvedAsyncData({
              datasetId: newId,
              data: res.data,
              headers: res.headers as Record<string, string> | undefined,
            });
          } catch (err) {
            const errorObj = err instanceof Error ? err : new Error(String(err));
            setDatasetError(errorObj);
            message.error(`${t('数据源加载失败')}: ${errorObj.message}`);
          } finally {
            setIsDatasetLoading(false);
          }
        }
      }

      const newFields = profileDataset(targetData, { headers: targetHeaders, sampleLimit });
      const newFieldKeys = new Set(newFields.map((f) => f.key));

      // 清理不属于新数据源的维度
      let nextDims: DimensionConfig | undefined = undefined;
      if (activeConfig.dimensions) {
        const origDims = activeConfig.dimensions;
        const timeBucket = origDims.timeBucket && newFieldKeys.has(origDims.timeBucket.field) ? origDims.timeBucket : undefined;
        const categories = origDims.categories ? origDims.categories.filter((c) => newFieldKeys.has(c)) : undefined;
        const finalCategories = categories && categories.length > 0 ? categories : undefined;
        const columnTimeBucket = origDims.columnTimeBucket && newFieldKeys.has(origDims.columnTimeBucket.field) ? origDims.columnTimeBucket : undefined;
        const columnCategories = origDims.columnCategories ? origDims.columnCategories.filter((c) => newFieldKeys.has(c)) : undefined;
        const finalColumnCategories = columnCategories && columnCategories.length > 0 ? columnCategories : undefined;

        if (timeBucket || finalCategories || columnTimeBucket || finalColumnCategories) {
          nextDims = {
            ...(timeBucket ? { timeBucket } : {}),
            ...(finalCategories ? { categories: finalCategories } : {}),
            ...(columnTimeBucket ? { columnTimeBucket } : {}),
            ...(finalColumnCategories ? { columnCategories: finalColumnCategories } : {}),
          };
        }
      }

      // 过滤有效列
      let nextCols = activeConfig.columns.filter((c) => {
        if (c.type === 'fixed' || c.type === 'aggregated') {
          return newFieldKeys.has(c.field);
        }
        return true;
      });

      // 若有效列为空，自动从新数据源提取前 5 个字段
      if (nextCols.length === 0 && newFields.length > 0) {
        const hasDimensions = Boolean(nextDims);
        if (hasDimensions) {
          const numFields = newFields.filter((f) => f.type === 'number');
          if (numFields.length > 0) {
            nextCols = numFields.slice(0, 4).map((f) => ({
              type: 'aggregated',
              field: f.key,
              agg: 'sum',
              label: f.label,
            }));
          } else {
            nextCols = newFields.slice(0, 5).map((f) => ({
              type: 'fixed',
              field: f.key,
              label: f.label,
            }));
          }
        } else {
          nextCols = newFields.slice(0, 5).map((f) => ({
            type: 'fixed',
            field: f.key,
            label: f.label,
          }));
        }
      }

      updateConfig({
        ...activeConfig,
        datasetId: newId,
        headers: targetHeaders || {},
        dimensions: nextDims,
        columns: nextCols,
      });
    },
    [candidateDatasets, activeConfig, sampleLimit, onDatasetChange, t]
  );

  // 5. 暴露给外部宿主组件的 Ref 实例方法 (getConfig / validateAndGetConfig / getTransformResult / resetConfig / getDatasetId / getDataset / setDatasetId)
  const getEffectiveConfig = useCallback((): DynamicTransformConfig => {
    const base =
      effectiveHeaders && !activeConfig.headers
        ? { ...activeConfig, headers: effectiveHeaders }
        : activeConfig;
    return {
      ...base,
      ...(effectiveDatasetId ? { datasetId: effectiveDatasetId } : {}),
    };
  }, [activeConfig, effectiveDatasetId, effectiveHeaders]);

  const handleValidateAndGetConfig = useCallback((): ConfigValidationResult => {
    const current = getEffectiveConfig();
    return validateTransformConfig(current, fields);
  }, [getEffectiveConfig, fields]);

  const handleGetTransformResult = useCallback((): TransformResult => {
    return transformResult;
  }, [transformResult]);

  const handleResetConfig = useCallback(() => {
    const initial = defaultValue || {
      columns: [],
      ...(effectiveHeaders ? { headers: effectiveHeaders } : {}),
    };
    setFieldOverrides({});
    if (!value) {
      setInternalConfig(initial);
    }
    onChange?.(initial);
  }, [defaultValue, effectiveHeaders, value, onChange]);

  useImperativeHandle(
    ref,
    () => ({
      getConfig: getEffectiveConfig,
      validateAndGetConfig: handleValidateAndGetConfig,
      getTransformResult: handleGetTransformResult,
      resetConfig: handleResetConfig,
      getDatasetId: () => effectiveDatasetId,
      getDataset: () => selectedRegisteredDataset,
      setDatasetId: (id: string) => handleDatasetSelect(id),
      refreshDataset: () => loadActiveDataset(true),
      isDatasetLoading: () => isDatasetLoading,
    }),
    [
      getEffectiveConfig,
      handleValidateAndGetConfig,
      handleGetTransformResult,
      handleResetConfig,
      effectiveDatasetId,
      selectedRegisteredDataset,
      handleDatasetSelect,
      loadActiveDataset,
      isDatasetLoading,
    ]
  );

  // 处理字段类型手动覆盖
  const handleFieldTypeChange = (fieldKey: string, newType: FieldDataType) => {
    const nextOverrides = {
      ...fieldOverrides,
      [fieldKey]: newType,
    };
    setFieldOverrides(nextOverrides);
    updateConfig({
      ...activeConfig,
      fields: nextOverrides,
    });
  };

  // 左侧快捷添加字段到右侧
  const handleQuickAddColumn = (f: FieldMeta) => {
    const hasDimensions = Boolean(
      activeConfig.dimensions?.timeBucket?.field ||
      (activeConfig.dimensions?.categories && activeConfig.dimensions.categories.length > 0) ||
      activeConfig.dimensions?.columnTimeBucket?.field ||
      (activeConfig.dimensions?.columnCategories && activeConfig.dimensions.columnCategories.length > 0)
    );

    if (hasDimensions) {
      if (f.type === 'number') {
        const isRatio =
          f.key.includes('ratio') ||
          f.key.includes('rate') ||
          f.label.includes('%') ||
          f.label.includes('率');
        const agg: AggregationFunction = isRatio ? 'avg' : 'sum';
        const newAggCol: ColumnConfig = {
          type: 'aggregated',
          field: f.key,
          agg,
          label: formatAggregatedLabel(f.label || f.key, agg),
        };
        updateConfig({
          ...activeConfig,
          columns: [...activeConfig.columns, newAggCol],
        });
      } else {
        // 策略 A: 透视模式下快捷添加文本列，自动升格为计数 (COUNT) 指标
        const newAggCol: ColumnConfig = {
          type: 'aggregated',
          field: f.key,
          agg: 'count',
          label: formatAggregatedLabel(f.label || f.key, 'count'),
        };
        updateConfig({
          ...activeConfig,
          columns: [...activeConfig.columns, newAggCol],
        });
      }
    } else {
      const newFixedCol: ColumnConfig = {
        type: 'fixed',
        field: f.key,
        label: f.label,
      };
      updateConfig({
        ...activeConfig,
        columns: [...activeConfig.columns, newFixedCol],
      });
    }
  };

  // 保存动态计算列
  const handleSaveComputedCol = (col: ComputedColumnConfig) => {
    let nextCols: ColumnConfig[];
    if (editingComputedCol) {
      const idx = activeConfig.columns.indexOf(editingComputedCol);
      nextCols = [...activeConfig.columns];
      if (idx !== -1) {
        nextCols[idx] = col;
      } else {
        nextCols.push(col);
      }
    } else {
      nextCols = [...activeConfig.columns, col];
    }
    updateConfig({
      ...activeConfig,
      columns: nextCols,
    });
    setFormulaModalOpen(false);
  };

  // 构建用于公式试算的 sampleRow，注入表头中文标签别名与宏度量键名
  const modalSampleRow: DataRecord | undefined = useMemo(() => {
    if (!effectiveData || effectiveData.length === 0) return undefined;
    const firstRow = effectiveData[0];
    if (!firstRow) return undefined;
    const base: DataRecord = { ...firstRow };
    if (effectiveHeaders) {
      for (const [k, lbl] of Object.entries(effectiveHeaders) as Array<[string, string]>) {
        if (k in base && !(lbl in base)) {
          base[lbl] = base[k];
        }
      }
    }
    if (transformResult.data.length > 0 && transformResult.data[0]) {
      Object.assign(base, transformResult.data[0]);
    }
    for (const [k, v] of Object.entries(firstRow)) {
      if (typeof v === 'number') {
        base[`SUM(${k})`] = v;
        base[`AVG(${k})`] = v;
        base[`MIN(${k})`] = v;
        base[`MAX(${k})`] = v;
        base[`COUNT(${k})`] = 1;

        base[`sum(${k})`] = v;
        base[`avg(${k})`] = v;
        base[`min(${k})`] = v;
        base[`max(${k})`] = v;
        base[`count(${k})`] = 1;

        const lbl = effectiveHeaders?.[k];
        if (lbl) {
          base[`SUM(${lbl})`] = v;
          base[`AVG(${lbl})`] = v;
          base[`MIN(${lbl})`] = v;
          base[`MAX(${lbl})`] = v;
          base[`COUNT(${lbl})`] = 1;
        }
      }
    }
    return base;
  }, [effectiveData, effectiveHeaders, transformResult.data]);

  // 维度变更处理与智能模式自适应流转 (Morphing State Machine)
  const handleDimensionsChange = (dims: DynamicTransformConfig['dimensions']) => {
    const formerDims = [
      activeConfig.dimensions?.timeBucket?.field,
      ...(activeConfig.dimensions?.categories || []),
      activeConfig.dimensions?.columnTimeBucket?.field,
      ...(activeConfig.dimensions?.columnCategories || []),
    ].filter(Boolean) as string[];

    const currentDims = [
      dims?.timeBucket?.field,
      ...(dims?.categories || []),
      dims?.columnTimeBucket?.field,
      ...(dims?.columnCategories || []),
    ].filter(Boolean) as string[];

    const hadDimensions = formerDims.length > 0;
    const hasDimensions = currentDims.length > 0;

    // 智能模式自适应转换：
    let nextColumns = activeConfig.columns;
    if (!hadDimensions && hasDimensions) {
      nextColumns = convertColumnsToAggregated(activeConfig.columns, fields, {
        headers: effectiveHeaders,
        excludeFields: currentDims,
      });
    } else if (hadDimensions && !hasDimensions) {
      nextColumns = convertColumnsToFixed(activeConfig.columns, fields, {
        headers: effectiveHeaders,
        prependFormerDimensions: formerDims,
      });
    }

    updateConfig({
      ...activeConfig,
      dimensions: dims,
      columns: nextColumns,
    });
  };

  return (
    <DynamicDataLocaleContext.Provider value={t.locale}>
      <div className={className} style={{ position: 'relative', ...style }}>
        {/* 数据源选择与模式栏 (支持直接代码传入 + 注册制多数据源动态切换) */}
        {showDatasetSelector !== false && (
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: 12,
              marginBottom: 12,
              padding: '10px 14px',
              backgroundColor: '#f1f5f9',
              borderRadius: 8,
              border: '1px solid #cbd5e1',
            }}
          >
            <Space size={10} align="center" wrap>
              <Space size={6} align="center">
                <DatabaseOutlined style={{ color: '#1677ff', fontSize: 16 }} />
                <span style={{ fontSize: 13, fontWeight: 600, color: '#1e293b' }}>
                  {t('数据源')}:
                </span>
              </Space>

              {candidateDatasets.length > 0 ? (
                <Space size={8} align="center" wrap>
                  <Select
                    value={effectiveDatasetId ?? (propData ? '__direct_data__' : null)}
                    onChange={handleDatasetSelect}
                    style={{ minWidth: 280 }}
                    placeholder={t('请选择分析数据源')}
                    optionLabelProp="label"
                  >
                    {propData && (
                      <Select.Option key="__direct_data__" value="__direct_data__" label={t('代码直接传入数据源')}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                          <Space size={6}>
                            <CodeOutlined style={{ color: '#52c41a' }} />
                            <span style={{ fontWeight: 500 }}>{t('代码直接传入数据源')}</span>
                          </Space>
                          {typeof propData === 'function' ? (
                            <Tag color="orange" style={{ margin: 0, fontSize: 11 }}>{t('动态拉取')}</Tag>
                          ) : (
                            <Tag color="green" style={{ margin: 0, fontSize: 11 }}>Direct Code</Tag>
                          )}
                        </div>
                      </Select.Option>
                    )}
                    {candidateDatasets.map((ds) => {
                      const isAsync = typeof ds.data === 'function';
                      return (
                        <Select.Option key={ds.id} value={ds.id} label={ds.name}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                            <Space size={4}>
                              {isAsync && <CloudDownloadOutlined style={{ color: '#1677ff' }} />}
                              <span style={{ fontWeight: 500 }}>{ds.name}</span>
                            </Space>
                            <Space size={4}>
                              {ds.tag && (
                                <Tag color="blue" style={{ margin: 0, fontSize: 11 }}>
                                  {ds.tag}
                                </Tag>
                              )}
                              {isAsync ? (
                                <Tag color="orange" style={{ margin: 0, fontSize: 11 }}>
                                  {t('动态拉取')}
                                </Tag>
                              ) : (
                                <span style={{ fontSize: 11, color: '#64748b' }}>({ds.data.length} 条)</span>
                              )}
                            </Space>
                          </div>
                        </Select.Option>
                      );
                    })}
                  </Select>

                  {selectedRegisteredDataset ? (
                    <Space size={6} wrap align="center">
                      <Tag color="cyan" style={{ margin: 0, fontSize: 11 }}>
                        {selectedRegisteredDataset.id}
                      </Tag>
                      {typeof selectedRegisteredDataset.data === 'function' && (
                        <Tag color="processing" icon={<CloudDownloadOutlined />} style={{ margin: 0, fontSize: 11 }}>
                          {t('动态拉取')}
                        </Tag>
                      )}
                      <Tag color="default" style={{ margin: 0, fontSize: 11 }}>
                        {t('共 {count} 条事实记录', { count: effectiveData.length })}
                      </Tag>
                      {typeof selectedRegisteredDataset.data === 'function' && (
                        <Button
                          size="small"
                          type="text"
                          icon={<ReloadOutlined spin={isDatasetLoading} />}
                          loading={isDatasetLoading}
                          onClick={() => {
                            void loadActiveDataset(true);
                          }}
                          title={t('刷新数据')}
                          style={{ padding: '0 6px', height: 22, fontSize: 12, color: '#1677ff' }}
                        >
                          {t('刷新数据')}
                        </Button>
                      )}
                      {selectedRegisteredDataset.description && (
                        <Tooltip title={selectedRegisteredDataset.description}>
                          <InfoCircleOutlined style={{ color: '#94a3b8', fontSize: 13, cursor: 'pointer' }} />
                        </Tooltip>
                      )}
                    </Space>
                  ) : propData ? (
                    <Space size={6} wrap align="center">
                      <Tag color="green" style={{ margin: 0, fontSize: 11 }}>
                        {t('代码直接传入数据源')}
                      </Tag>
                      {typeof propData === 'function' && (
                        <Tag color="processing" icon={<CloudDownloadOutlined />} style={{ margin: 0, fontSize: 11 }}>
                          {t('动态拉取')}
                        </Tag>
                      )}
                      <Tag color="default" style={{ margin: 0, fontSize: 11 }}>
                        {t('共 {count} 条事实记录', { count: effectiveData.length })}
                      </Tag>
                      {typeof propData === 'function' && (
                        <Button
                          size="small"
                          type="text"
                          icon={<ReloadOutlined spin={isDatasetLoading} />}
                          loading={isDatasetLoading}
                          onClick={() => {
                            void loadActiveDataset(true);
                          }}
                          title={t('刷新数据')}
                          style={{ padding: '0 6px', height: 22, fontSize: 12, color: '#1677ff' }}
                        >
                          {t('刷新数据')}
                        </Button>
                      )}
                    </Space>
                  ) : null}
                </Space>
              ) : (
                <Space size={8} align="center">
                  <Tag color="geekblue" style={{ margin: 0, fontSize: 12, padding: '2px 8px' }}>
                    <CodeOutlined style={{ marginRight: 4 }} />
                    {t('代码直接传入数据源')}
                  </Tag>
                  {typeof propData === 'function' && (
                    <Tag color="processing" icon={<CloudDownloadOutlined />} style={{ margin: 0, fontSize: 11 }}>
                      {t('动态拉取')}
                    </Tag>
                  )}
                  <Tag color="default" style={{ margin: 0, fontSize: 11 }}>
                    {t('共 {count} 条事实记录', { count: effectiveData.length })}
                  </Tag>
                  {typeof propData === 'function' && (
                    <Button
                      size="small"
                      type="text"
                      icon={<ReloadOutlined spin={isDatasetLoading} />}
                      loading={isDatasetLoading}
                      onClick={() => {
                        void loadActiveDataset(true);
                      }}
                      title={t('刷新数据')}
                      style={{ padding: '0 6px', height: 22, fontSize: 12, color: '#1677ff' }}
                    >
                      {t('刷新数据')}
                    </Button>
                  )}
                </Space>
              )}
            </Space>

            <Space size={6}>
              <Tag color="purple" style={{ margin: 0, fontSize: 11 }}>
                {t('已探查 {count} 个字段', { count: fields.length })}
              </Tag>
            </Space>
          </div>
        )}

        {/* 数据源异步拉取异常提示与重试 */}
        {datasetError && (
          <Alert
            type="error"
            showIcon
            message={t('数据源加载失败')}
            description={datasetError.message}
            action={
              <Button size="small" danger onClick={() => { void loadActiveDataset(true); }}>
                {t('重试')}
              </Button>
            }
            style={{ marginBottom: 12 }}
          />
        )}

        <Spin spinning={isDatasetLoading} tip={t('正在获取数据源数据...')}>
          {/* 顶部工具栏：常用分析模板与可选的高级工具 */}
          {(showQuickPresets || showDslTools) && (
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: 10,
                marginBottom: 12,
                padding: '10px 14px',
                background: 'linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%)',
                borderRadius: 8,
                border: '1px solid #e2e8f0',
                boxShadow: '0 1px 2px rgba(0, 0, 0, 0.02)',
              }}
            >
              {showQuickPresets && (
                <Space size={10} wrap align="center">
                  {/* 1. 双向交叉透视模板组 */}
                  <Space size={6} align="center">
                    <Tag
                      color="purple"
                      style={{
                        margin: 0,
                        fontWeight: 600,
                        fontSize: 11,
                        borderRadius: 4,
                        padding: '1px 8px',
                      }}
                    >
                      {t('智能透视推荐')}
                    </Tag>
                    {PIVOT_TEMPLATES[0] && (
                      <SlotConfirmPopover
                        template={PIVOT_TEMPLATES[0]}
                        fields={fields}
                        onApplyConfig={handleApplySlotConfig}
                      >
                        <Button
                          size="small"
                          style={{
                            borderColor: '#d3adf7',
                            color: '#722ed1',
                            backgroundColor: '#ffffff',
                            fontWeight: 500,
                          }}
                          icon={<CalendarOutlined style={{ color: '#722ed1' }} />}
                        >
                          {t('月度趋势透视')}
                        </Button>
                      </SlotConfirmPopover>
                    )}
                    {PIVOT_TEMPLATES[1] && (
                      <SlotConfirmPopover
                        template={PIVOT_TEMPLATES[1]}
                        fields={fields}
                        onApplyConfig={handleApplySlotConfig}
                      >
                        <Button
                          size="small"
                          style={{
                            borderColor: '#d3adf7',
                            color: '#722ed1',
                            backgroundColor: '#ffffff',
                            fontWeight: 500,
                          }}
                          icon={<ProfileOutlined style={{ color: '#722ed1' }} />}
                        >
                          {t('多指标综合体检')}
                        </Button>
                      </SlotConfirmPopover>
                    )}
                  </Space>

                  <Divider type="vertical" style={{ height: 18, borderColor: '#cbd5e1', margin: '0 4px' }} />

                  {/* 2. 基础单向分析模板组 */}
                  <Space size={6} align="center">
                    <span style={{ fontSize: 12, color: '#64748b', fontWeight: 500 }}>
                      {t('经典单向模板')}:
                    </span>
                    <Button
                      size="small"
                      icon={<LineChartOutlined style={{ color: '#1677ff' }} />}
                      onClick={() => handleApplyQuickPreset('trend')}
                    >
                      {t('趋势分析 (按时间)')}
                    </Button>
                    <Button
                      size="small"
                      icon={<BarChartOutlined style={{ color: '#52c41a' }} />}
                      onClick={() => handleApplyQuickPreset('ranking')}
                    >
                      {t('对比排行 (按类别)')}
                    </Button>
                    <Button
                      size="small"
                      icon={<PieChartOutlined style={{ color: '#fa8c16' }} />}
                      onClick={() => handleApplyQuickPreset('share')}
                    >
                      {t('占比分析 (单指标)')}
                    </Button>
                    <Button
                      size="small"
                      icon={<TableOutlined style={{ color: '#722ed1' }} />}
                      onClick={() => handleApplyQuickPreset('detail')}
                    >
                      {t('明细清单 (原始行)')}
                    </Button>
                  </Space>
                </Space>
              )}

              {showDslTools && (
                <Space size={8}>
                  <Button
                    size="small"
                    icon={<CopyOutlined />}
                    onClick={handleCopyConfig}
                  >
                    {t('复制配置 (JSON)')}
                  </Button>
                  <Button
                    size="small"
                    icon={<ImportOutlined />}
                    onClick={() => setImportModalOpen(true)}
                  >
                    {t('导入配置')}
                  </Button>
                </Space>
              )}
            </div>
          )}

          <Row gutter={[12, 12]}>
            {/* 左侧：字段探查区 */}
            <Col xs={24} sm={8} md={7} lg={6}>
              <FieldProfilerList
                fields={fields}
                onFieldTypeChange={handleFieldTypeChange}
                onQuickAddColumn={handleQuickAddColumn}
              />
            </Col>

            {/* 右侧：转换配置与实时预览区 */}
            <Col xs={24} sm={16} md={17} lg={18}>
              {/* 维度与时间分桶（未设置时展示全量明细，设置后自动开启分组透视） */}
              <DimensionConfigComponent
                {...(activeConfig.dimensions !== undefined ? { dimensions: activeConfig.dimensions } : {})}
                availableFields={fields}
                headers={effectiveHeaders}
                onChange={handleDimensionsChange}
              />

              {/* 列与度量配置 */}
              <ColumnConfigList
                columns={activeConfig.columns}
                availableFields={fields}
                hasDimensions={Boolean(
                  activeConfig.dimensions?.timeBucket?.field ||
                  (activeConfig.dimensions?.categories && activeConfig.dimensions.categories.length > 0) ||
                  activeConfig.dimensions?.columnTimeBucket?.field ||
                  (activeConfig.dimensions?.columnCategories && activeConfig.dimensions.columnCategories.length > 0)
                )}
                onChange={(columns) => updateConfig({ ...activeConfig, columns })}
                onOpenFormulaModal={(col) => {
                  setEditingComputedCol(col);
                  setFormulaModalOpen(true);
                }}
              />

              {/* 实时预览表格 */}
              <LivePreviewTable result={transformResult} config={activeConfig} />
            </Col>
          </Row>
        </Spin>

        {/* 公式编辑器 Modal */}
        <FormulaEditorModal
          open={formulaModalOpen}
          {...(editingComputedCol !== undefined ? { initialValue: editingComputedCol } : {})}
          availableFields={fields}
          {...(modalSampleRow !== undefined ? { sampleRow: modalSampleRow } : {})}
          onOk={handleSaveComputedCol}
          onCancel={() => setFormulaModalOpen(false)}
        />

        {/* DSL 转换配置导入 Modal (含数据合法性校验) */}
        <ImportConfigModal
          open={importModalOpen}
          onOk={handleImportConfig}
          onCancel={() => setImportModalOpen(false)}
          availableFields={fields}
          currentConfig={activeConfig}
        />
      </div>
    </DynamicDataLocaleContext.Provider>
  );
});

DynamicDataConfigPanel.displayName = 'DynamicDataConfigPanel';
