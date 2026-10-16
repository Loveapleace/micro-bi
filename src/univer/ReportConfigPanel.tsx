/**
 * 报表可视化配置面板 (ReportConfigPanel.tsx)
 * 遵循 Section 13:
 * 1. 组合 DynamicDataConfigPanel（负责当前分析区域规则配置）与 UniverPreview（负责配置态类 Excel 画布编辑）
 * 2. 维护 ReportDocument 与各 AnalysisRegion 的完整草稿生命周期
 * 3. 暴露 ReportConfigPanelRef：flush()、validateAndGetReport()、resetDocument()
 */
import React, { useRef, useState, useCallback, useImperativeHandle, forwardRef, useMemo } from 'react';
import type { RegisteredDataset } from '../core/datasetRegistry.js';
import type {
  ReportDocument,
  ReportSaveResult,
  ReportDiagnostic,
  ReportAnalysisRegion,
} from '../report/types.js';
import type { DynamicTransformConfig } from '../engine/types.js';
import type { ConfigValidationResult } from '../engine/validator.js';
import type { DynamicDataLocale, DeepPartial } from '../locale/types.js';
import { validateReportDocument } from '../report/validator.js';
import { DynamicDataConfigPanel } from '../ui/DynamicDataConfigPanel.js';
import type { DynamicDataConfigPanelRef, PreviewSlotContext } from '../ui/types.js';
import { UniverPreview, type UniverPreviewRef } from './UniverPreview.js';
import { buildBiGrid } from '../report/buildBiGrid.js';

export interface ReportConfigPanelProps {
  value?: ReportDocument | undefined;
  defaultValue?: ReportDocument | undefined;
  datasets?: readonly RegisteredDataset[] | undefined;
  datasetId?: string | undefined;
  onChange?: ((document: ReportDocument) => void) | undefined;
  onDiagnostics?: ((issues: readonly ReportDiagnostic[]) => void) | undefined;
  onDatasetChange?: ((datasetId: string, dataset: RegisteredDataset) => void) | undefined;
  height?: number | string | undefined;
  className?: string | undefined;
  style?: React.CSSProperties | undefined;
  theme?: 'light' | 'dark' | undefined;
  locale?: DeepPartial<DynamicDataLocale> | undefined;
  showDatasetSelector?: boolean | undefined;
  showQuickPresets?: boolean | undefined;
  showDslTools?: boolean | undefined;
  showFieldKeys?: boolean | undefined;
}

export interface ReportConfigPanelRef {
  flush: () => Promise<void>;
  validateAndGetReport: () => Promise<ReportSaveResult>;
  resetDocument: () => void;
  getDocument: () => ReportDocument;
  getConfig: () => DynamicTransformConfig;
  getDatasetId: () => string | undefined;
  validateAndGetConfig: () => ConfigValidationResult;
}

export const ReportConfigPanel = forwardRef<ReportConfigPanelRef, ReportConfigPanelProps>(
  function ReportConfigPanel(
    {
      value: propValue,
      defaultValue: propDefaultValue,
      datasets,
      datasetId: propDatasetId,
      onChange,
      onDiagnostics,
      onDatasetChange,
      height = 700,
      className,
      style,
      theme,
      locale,
      showDatasetSelector,
      showQuickPresets,
      showDslTools,
      showFieldKeys,
    },
    ref
  ) {
    const configPanelRef = useRef<DynamicDataConfigPanelRef>(null);
    const univerPreviewRef = useRef<UniverPreviewRef>(null);

    // 内部 Document 状态
    const [internalDoc, setInternalDoc] = useState<ReportDocument>(() => {
      if (propValue) return propValue;
      if (propDefaultValue) return propDefaultValue;
      return {
        version: '1.0',
        id: `report-${Date.now()}`,
        revision: 1,
        title: '新报表',
        activeSheetId: 'sheet-1',
        analyses: [
          {
            id: 'analysis-1',
            sheetId: 'sheet-1',
            anchor: { row: 0, column: 0 },
            config: {
              columns: [],
            },
          },
        ],
      };
    });

    const activeDoc = propValue || internalDoc;

    // 当前操作的主分析区域
    const activeAnalysis: ReportAnalysisRegion = useMemo(() => {
      return (
        activeDoc.analyses[0] || {
          id: 'analysis-1',
          sheetId: 'sheet-1',
          anchor: { row: 0, column: 0 },
          config: { columns: [] },
        }
      );
    }, [activeDoc.analyses]);

    const updateDoc = useCallback(
      (newDoc: ReportDocument) => {
        setInternalDoc(newDoc);
        if (onChange) {
          onChange(newDoc);
        }
      },
      [onChange]
    );

    // 当用户修改当前分析区域的分析规则时更新文档
    const handleAnalysisConfigChange = useCallback(
      (newConfig: DynamicTransformConfig) => {
        const nextAnalyses = activeDoc.analyses.map((a) =>
          a.id === activeAnalysis.id ? { ...a, config: newConfig } : a
        );
        updateDoc({
          ...activeDoc,
          revision: activeDoc.revision + 1,
          analyses: nextAnalyses,
        });
      },
      [activeDoc, activeAnalysis.id, updateDoc]
    );

    // 暴露 Ref 句柄
    useImperativeHandle(
      ref,
      () => ({
        flush: async () => {
          if (univerPreviewRef.current) {
            await univerPreviewRef.current.waitForFormulaSettled();
          }
        },
        getDocument: () => activeDoc,
        getConfig: () => configPanelRef.current?.getConfig() || activeAnalysis.config,
        getDatasetId: () => configPanelRef.current?.getDatasetId() || propDatasetId || activeAnalysis.datasetId,
        validateAndGetConfig: () => {
          if (configPanelRef.current) {
            return configPanelRef.current.validateAndGetConfig();
          }
          return { valid: true, issues: [], parsedConfig: activeAnalysis.config };
        },
        resetDocument: () => {
          const resetDoc: ReportDocument = {
            version: '1.0',
            id: `report-${Date.now()}`,
            revision: 1,
            title: '新报表',
            activeSheetId: 'sheet-1',
            analyses: [
              {
                id: 'analysis-1',
                sheetId: 'sheet-1',
                anchor: { row: 0, column: 0 },
                config: { columns: [] },
              },
            ],
          };
          updateDoc(resetDoc);
        },
        validateAndGetReport: async (): Promise<ReportSaveResult> => {
          const issues: ReportDiagnostic[] = [];

          // 1. 等待公式计算稳定 (MBI-09)
          if (univerPreviewRef.current) {
            await univerPreviewRef.current.waitForFormulaSettled();
          }

          // 2. 校验配置面板规则并同步最新配置
          const configValidation = configPanelRef.current?.validateAndGetConfig();
          if (configValidation && !configValidation.valid) {
            configValidation.issues.forEach((ci) => {
              issues.push({
                severity: ci.severity === 'warning' ? 'warning' : 'error',
                code: (ci as any).code || 'CONFIG_INVALID',
                message: ci.message,
              });
            });
          }

          const latestConfig = configValidation?.parsedConfig || configPanelRef.current?.getConfig() || activeAnalysis.config;
          const currentDatasetId = configPanelRef.current?.getDatasetId() || propDatasetId || activeAnalysis.datasetId;

          // 3. 校验文档结构
          const docValidation = validateReportDocument(activeDoc);
          issues.push(...docValidation.issues);

          // 4. 编译当前 Univer 画布内容为 PublishedReport
          let compiled = null;
          if (univerPreviewRef.current) {
            compiled = await univerPreviewRef.current.compileReport({
              reportId: activeDoc.id,
              ...(activeDoc.title ? { title: activeDoc.title } : {}),
            });
            issues.push(...compiled.diagnostics);
          }

          if (onDiagnostics) {
            onDiagnostics(issues);
          }

          const hasErrors = issues.some((i) => i.severity === 'error');
          if (hasErrors || !compiled) {
            return {
              valid: false,
              issues,
            };
          }

          // 保存工作簿最新快照到文档中
          const snapshot = univerPreviewRef.current?.getWorkbookSnapshot();
          const nextAnalyses = activeDoc.analyses.map((a) =>
            a.id === activeAnalysis.id
              ? { ...a, config: latestConfig, ...(currentDatasetId ? { datasetId: currentDatasetId } : {}) }
              : a
          );
          const finalDoc: ReportDocument = {
            ...activeDoc,
            revision: activeDoc.revision + 1,
            analyses: nextAnalyses,
            workbookSnapshot: snapshot,
            published: compiled.publication,
          };

          return {
            valid: true,
            issues,
            document: finalDoc,
            publication: compiled.publication,
          };
        },
      }),
      [activeDoc, activeAnalysis, propDatasetId, updateDoc, onDiagnostics]
    );

    // 预览区插槽渲染函数：接入 UniverPreview (MBI-01, MBI-03, MBI-05)
    const renderPreviewSlot = useCallback(
      (ctx: PreviewSlotContext) => {
        // MBI-03: 优先消费配置面板已解析完成的 records 与 headers
        const records = ctx.records && ctx.records.length > 0
          ? ctx.records
          : Array.isArray(ctx.dataset?.data)
          ? (ctx.dataset.data as any)
          : [];
        const rawHeaders = ctx.headers || (ctx.dataset?.headers as any) || {};

        const initialGrid = buildBiGrid(ctx.config, records, {
          analysisId: activeAnalysis.id,
          sheetId: activeAnalysis.sheetId,
          rawHeaders,
        });

        // MBI-05: 初始矩阵生成的绑定进入管理器
        const effectiveBindings =
          activeAnalysis.bindings && activeAnalysis.bindings.length > 0
            ? activeAnalysis.bindings
            : initialGrid.bindings;

        return (
          <div
            style={{
              height: 480,
              border: '1px solid #e2e8f0',
              borderRadius: 6,
              overflow: 'hidden',
              marginTop: 12,
            }}
          >
            <UniverPreview
              ref={univerPreviewRef}
              documentId={activeDoc.id}
              revision={activeDoc.revision}
              initialSnapshot={activeDoc.workbookSnapshot as any}
              initialGrid={initialGrid}
              bindings={effectiveBindings}
              manualOverrides={activeAnalysis.manualOverrides}
              onBindingsChange={(newBindings) => {
                const nextAnalyses = activeDoc.analyses.map((a) =>
                  a.id === activeAnalysis.id ? { ...a, bindings: newBindings } : a
                );
                updateDoc({
                  ...activeDoc,
                  analyses: nextAnalyses,
                });
              }}
              onManualOverride={(bindingId, override) => {
                const prevOverrides = activeAnalysis.manualOverrides || {};
                const nextOverrides = {
                  ...prevOverrides,
                  [bindingId]: override,
                };
                const nextAnalyses = activeDoc.analyses.map((a) =>
                  a.id === activeAnalysis.id ? { ...a, manualOverrides: nextOverrides } : a
                );
                updateDoc({
                  ...activeDoc,
                  analyses: nextAnalyses,
                });
              }}
            />
          </div>
        );
      },
      [activeAnalysis, activeDoc, updateDoc]
    );

    return (
      <div className={className} style={{ width: '100%', height, ...style }}>
        <DynamicDataConfigPanel
          ref={configPanelRef}
          value={activeAnalysis.config}
          onChange={handleAnalysisConfigChange}
          {...(datasets !== undefined ? { datasets } : {})}
          {...(propDatasetId !== undefined ? { datasetId: propDatasetId } : {})}
          {...(theme !== undefined ? { theme } : {})}
          {...(locale !== undefined ? { locale } : {})}
          {...(showDatasetSelector !== undefined ? { showDatasetSelector } : {})}
          {...(showQuickPresets !== undefined ? { showQuickPresets } : {})}
          {...(showDslTools !== undefined ? { showDslTools } : {})}
          {...(showFieldKeys !== undefined ? { showFieldKeys } : {})}
          onDatasetChange={(newId, ds) => {
            const nextAnalyses = activeDoc.analyses.map((a) =>
              a.id === activeAnalysis.id ? { ...a, datasetId: newId } : a
            );
            updateDoc({
              ...activeDoc,
              analyses: nextAnalyses,
            });
            onDatasetChange?.(newId, ds);
          }}
          renderPreview={renderPreviewSlot}
        />
      </div>
    );
  }
);

ReportConfigPanel.displayName = 'ReportConfigPanel';
