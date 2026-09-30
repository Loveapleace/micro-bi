import React, { useState, useEffect, useMemo, useCallback, useImperativeHandle } from 'react';
import { Row, Col, Space, Button, message, Tooltip } from 'antd';
import {
  CopyOutlined,
  ImportOutlined,
  LineChartOutlined,
  BarChartOutlined,
  PieChartOutlined,
  TableOutlined,
  ThunderboltOutlined,
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
} from '../engine/types.js';
import { profileDataset } from '../engine/profiler.js';
import { transformData } from '../engine/pipeline.js';
import { validateTransformConfig, type ConfigValidationResult } from '../engine/validator.js';
import { convertColumnsToAggregated, convertColumnsToFixed, formatAggregatedLabel } from '../engine/modeAdapter.js';
import { FieldProfilerList } from './components/FieldProfilerList.js';
import { DimensionConfigComponent } from './components/DimensionConfig.js';
import { ColumnConfigList } from './components/ColumnConfigList.js';
import { FormulaEditorModal } from './components/FormulaEditorModal.js';
import { LivePreviewTable } from './components/LivePreviewTable.js';
import { ImportConfigModal } from './components/ImportConfigModal.js';
import { useDynamicDataLocale, DynamicDataLocaleContext } from '../locale/index.js';

export const DynamicDataConfigPanel = React.forwardRef<
  DynamicDataConfigPanelRef,
  DynamicDataConfigPanelProps
>(function DynamicDataConfigPanel(
  {
    data,
    headers,
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

  // 1. 字段类型探测与用户覆盖
  const effectiveHeaders = headers ?? value?.headers ?? defaultValue?.headers;
  const [fieldOverrides, setFieldOverrides] = useState<Record<string, FieldDataType>>({});

  const fields: readonly FieldMeta[] = useMemo(() => {
    return profileDataset(data, {
      headers: effectiveHeaders,
      userOverrides: { ...value?.fields, ...fieldOverrides },
      sampleLimit,
    });
  }, [data, effectiveHeaders, value?.fields, fieldOverrides, sampleLimit]);

  // 2. 核心受控与内部配置状态（统一为聚合透视与明细自适应模型）
  const [internalConfig, setInternalConfig] = useState<DynamicTransformConfig>(() => {
    if (value) return value;
    if (defaultValue) return defaultValue;
    return {
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
        columns: initialCols,
      });
    }
  }, [fields, activeConfig]);

  const updateConfig = (next: DynamicTransformConfig) => {
    const nextWithHeaders = effectiveHeaders && !next.headers ? { ...next, headers: effectiveHeaders } : next;
    if (!value) {
      setInternalConfig(nextWithHeaders);
    }
    onChange?.(nextWithHeaders);
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

  // 4. 实时试算与输出
  const transformResult: TransformResult = useMemo(() => {
    try {
      const runConfig: DynamicTransformConfig =
        effectiveHeaders && !activeConfig.headers
          ? { ...activeConfig, headers: effectiveHeaders }
          : activeConfig;
      return transformData(data, runConfig);
    } catch {
      return {
        data: [],
        columns: [],
        meta: {
          inputRows: data.length,
          outputRows: 0,
          executionTimeMs: 0,
        },
      };
    }
  }, [data, activeConfig, effectiveHeaders]);

  const onTransformResultRef = React.useRef(onTransformResult);
  onTransformResultRef.current = onTransformResult;

  useEffect(() => {
    onTransformResultRef.current?.(transformResult);
  }, [transformResult]);

  // 5. 暴露给外部宿主组件的 Ref 实例方法 (getConfig / validateAndGetConfig / getTransformResult / resetConfig)
  const getEffectiveConfig = useCallback((): DynamicTransformConfig => {
    return effectiveHeaders && !activeConfig.headers
      ? { ...activeConfig, headers: effectiveHeaders }
      : activeConfig;
  }, [activeConfig, effectiveHeaders]);

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
    }),
    [getEffectiveConfig, handleValidateAndGetConfig, handleGetTransformResult, handleResetConfig]
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
      (activeConfig.dimensions?.categories && activeConfig.dimensions.categories.length > 0)
    );

    if (hasDimensions && f.type === 'number') {
      const newAggCol: ColumnConfig = {
        type: 'aggregated',
        field: f.key,
        agg: 'sum',
        label: `${t('求和')}(${f.label || f.key})`,
      };
      updateConfig({
        ...activeConfig,
        columns: [...activeConfig.columns, newAggCol],
      });
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
    if (!data || data.length === 0) return undefined;
    const firstRow = data[0];
    if (!firstRow) return undefined;
    const base: DataRecord = { ...firstRow };
    if (effectiveHeaders) {
      for (const [k, lbl] of Object.entries(effectiveHeaders)) {
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
  }, [data, effectiveHeaders, transformResult.data]);

  // 维度变更处理
  const handleDimensionsChange = (dims: DynamicTransformConfig['dimensions']) => {
    const hadDimensions = Boolean(
      activeConfig.dimensions?.timeBucket?.field ||
      (activeConfig.dimensions?.categories && activeConfig.dimensions.categories.length > 0) ||
      (activeConfig.dimensions?.columnCategories && activeConfig.dimensions.columnCategories.length > 0) ||
      activeConfig.dimensions?.columnTimeBucket?.field
    );
    const hasDimensions = Boolean(
      dims?.timeBucket?.field ||
      (dims?.categories && dims.categories.length > 0) ||
      (dims?.columnCategories && dims.columnCategories.length > 0) ||
      dims?.columnTimeBucket?.field
    );

    // 智能模式自适应转换：
    let nextColumns = activeConfig.columns;
    if (!hadDimensions && hasDimensions) {
      nextColumns = convertColumnsToAggregated(activeConfig.columns, fields, effectiveHeaders);
    } else if (hadDimensions && !hasDimensions) {
      nextColumns = convertColumnsToFixed(activeConfig.columns, fields);
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
        {/* 顶部工具栏：常用分析模板与可选的高级工具 */}
        {(showQuickPresets || showDslTools) && (
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: 8,
              marginBottom: 12,
              padding: '8px 12px',
              backgroundColor: '#fafafa',
              borderRadius: 6,
              border: '1px solid #f0f0f0',
            }}
          >
            {showQuickPresets && (
              <Space size={6} wrap align="center">
                <span style={{ fontSize: 13, fontWeight: 600, color: '#262626' }}>
                  {t('常用分析模板：')}
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
          <Col xs={24} sm={8} md={6} lg={5}>
            <FieldProfilerList
              fields={fields}
              onFieldTypeChange={handleFieldTypeChange}
              onQuickAddColumn={handleQuickAddColumn}
            />
          </Col>

          {/* 右侧：转换配置与实时预览区 */}
          <Col xs={24} sm={16} md={18} lg={19}>
            {/* 维度与时间分桶（未设置时展示全量明细，设置后自动开启分组透视） */}
            <DimensionConfigComponent
              {...(activeConfig.dimensions !== undefined ? { dimensions: activeConfig.dimensions } : {})}
              availableFields={fields}
              onChange={handleDimensionsChange}
            />

            {/* 列与度量配置 */}
            <ColumnConfigList
              columns={activeConfig.columns}
              availableFields={fields}
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
