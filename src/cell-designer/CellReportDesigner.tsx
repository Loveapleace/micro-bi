import React, {
  useReducer,
  useRef,
  useMemo,
  useEffect,
  useImperativeHandle,
  forwardRef,
  useState,
} from 'react';
import {
  Row,
  Col,
  Space,
  Button,
  Segmented,
  Tag,
  Typography,
  Input,
  List,
  Tooltip,
  message,
  Select,
} from 'antd';
import {
  TableOutlined,
  EyeOutlined,
  UndoOutlined,
  RedoOutlined,
  SearchOutlined,
  DatabaseOutlined,
  PlusCircleOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';

import type { DataRecord } from '../types.js';
import type {
  CellTemplateDocumentV1,
  CellDefinition,
  CellBusinessRole,
  CellDataOperation,
  CellExpandDirection,
} from '../report-template/types.js';
import type { BiGridModel, PublishedReport } from '../report/types.js';
import {
  getRegisteredDataset,
  getCachedDatasetData,
  useRegisteredDatasets,
  type RegisteredDataset,
} from '../core/datasetRegistry.js';
import { compileCellReport, type CompileCellReportResult } from '../report-template/compileCellReport.js';
import { normalizeCellTemplate } from '../report-template/normalizeCellTemplate.js';
import { expandCellTemplate } from '../report-template/expandTemplate.js';
import { expandCellDrivenTemplate } from '../report-template/cellExpansionEngine.js';
import { resolveFieldId } from '../report-template/identity.js';
import {
  designerReducer,
  createInitialDesignerState,
  generateTemplateCellId,
} from './designerReducer.js';
import { attachUniverDesignerEvents } from './univerEvents.js';
import { syncDocumentFromWorkbookSnapshot } from './syncWorkbookToTemplate.js';
import { CellInspector, type FieldItem } from './CellInspector.js';
import { CellAdvancedSettings } from './CellAdvancedSettings.js';
import { ReportWizardModal } from './ReportWizardModal.js';
import { UniverPreview, type UniverPreviewRef } from '../univer/UniverPreview.js';
import type { FUniver } from '../univer/adapter.js';

const { Text } = Typography;

export interface CellReportDesignerRef {
  validateAndGetReport: () => Promise<CompileCellReportResult>;
  getTemplate: () => CellTemplateDocumentV1;
  flush: () => void;
}

export interface CellReportDesignerProps {
  initialDocument: CellTemplateDocumentV1;
  rawDataset?: readonly DataRecord[] | undefined;
  datasetId?: string | undefined;
  datasets?: readonly RegisteredDataset[] | undefined;
  height?: number | string | undefined;
  onSave?: (report: CompileCellReportResult) => void;
  onCancel?: () => void;
}

export const CellReportDesigner = forwardRef<CellReportDesignerRef, CellReportDesignerProps>(
  function CellReportDesigner(
    {
      initialDocument,
      rawDataset,
      datasetId,
      datasets,
      height = '100%',
      onSave,
      onCancel,
    },
    ref
  ) {
    const [state, dispatch] = useReducer(
      designerReducer,
      initialDocument,
      createInitialDesignerState
    );
    const univerPreviewRef = useRef<UniverPreviewRef>(null);
    const stateRef = useRef(state);
    stateRef.current = state;
    const [fieldSearch, setFieldSearch] = useState('');
    const [wizardOpen, setWizardOpen] = useState(false);
    const [univerAPI, setUniverAPI] = useState<FUniver | null>(null);

    // 数据源与字段提取
    const registered = useRegisteredDatasets();
    const candidateDatasets = datasets || registered;
    const [selectedDatasetId, setSelectedDatasetId] = useState<string | undefined>(
      state.document.regions?.[0]?.datasetId || datasetId || candidateDatasets[0]?.id
    );

    const activeDatasetId =
      selectedDatasetId || state.document.regions?.[0]?.datasetId || datasetId || candidateDatasets[0]?.id || 'default';

    const activeDataset = useMemo(() => {
      return (
        candidateDatasets.find((d) => d.id === activeDatasetId) ||
        getRegisteredDataset(activeDatasetId)
      );
    }, [candidateDatasets, activeDatasetId]);

    const activeData = useMemo<readonly DataRecord[]>(() => {
      if (rawDataset !== undefined) return rawDataset;
      if (activeDataset) {
        if (Array.isArray(activeDataset.data)) return activeDataset.data;
        const cached = getCachedDatasetData(activeDataset.id);
        if (cached?.data) return cached.data;
      }
      return [];
    }, [rawDataset, activeDataset]);

    const fieldItems = useMemo<FieldItem[]>(() => {
      const headers = (activeDataset?.headers || {}) as Record<string, string>;
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
    }, [activeDataset, activeData]);

    const filteredFields = useMemo(() => {
      if (!fieldSearch) return fieldItems;
      const q = fieldSearch.toLowerCase();
      return fieldItems.filter(
        (f) => f.key.toLowerCase().includes(q) || f.label.toLowerCase().includes(q)
      );
    }, [fieldItems, fieldSearch]);

    // 挂载 Univer 事件监听 (选区变动与双击，跟随实际 API 就绪生命周期)
    useEffect(() => {
      const api = univerAPI || univerPreviewRef.current?.getUniverAPI();
      if (!api) return;

      const dispose = attachUniverDesignerEvents(api, {
        onSelectCell: (pos) => {
          if (stateRef.current.mode !== 'design') return;
          dispatch({ type: 'SELECT_CELL', position: { row: pos.row, column: pos.column }, sheetId: pos.sheetId });
        },
        onDoubleClicked: state.mode === 'design' ? (pos) => {
          dispatch({ type: 'SELECT_CELL', position: { row: pos.row, column: pos.column }, sheetId: pos.sheetId });
          dispatch({ type: 'OPEN_ADVANCED' });
        } : undefined,
        onCellEdited: (edit) => {
          dispatch({
            type: 'APPLY_NATIVE_CELL_EDIT',
            row: edit.row,
            column: edit.column,
            sheetId: edit.sheetId,
            value: edit.value,
            formula: edit.formula,
          });
        },
        onColumnsInserted: (e) => {
          dispatch({ type: 'INSERT_COLUMNS', sheetId: e.sheetId, startIndex: e.startIndex, count: e.count });
        },
        onColumnsRemoved: (e) => {
          dispatch({ type: 'REMOVE_COLUMNS', sheetId: e.sheetId, startIndex: e.startIndex, count: e.count });
        },
        onRowsInserted: (e) => {
          dispatch({ type: 'INSERT_ROWS', sheetId: e.sheetId, startIndex: e.startIndex, count: e.count });
        },
        onRowsRemoved: (e) => {
          dispatch({ type: 'REMOVE_ROWS', sheetId: e.sheetId, startIndex: e.startIndex, count: e.count });
        },
      });

      return () => {
        dispose();
      };
    }, [univerAPI, state.mode]);

    // 监听全局 Ctrl+Z / Ctrl+Y 撤销与重做快捷键
    useEffect(() => {
      const handleKeyDown = (e: KeyboardEvent) => {
        const activeEl = document.activeElement;
        const isEditingInput =
          activeEl &&
          (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || (activeEl as HTMLElement).isContentEditable);
        if (isEditingInput) return;

        if ((e.ctrlKey || e.metaKey) && !e.altKey) {
          if (e.key.toLowerCase() === 'z') {
            e.preventDefault();
            if (e.shiftKey) {
              if (stateRef.current.future.length > 0) {
                dispatch({ type: 'REDO' });
              }
            } else {
              if (stateRef.current.history.length > 0) {
                dispatch({ type: 'UNDO' });
              }
            }
          } else if (e.key.toLowerCase() === 'y') {
            e.preventDefault();
            if (stateRef.current.future.length > 0) {
              dispatch({ type: 'REDO' });
            }
          }
        }
      };

      window.addEventListener('keydown', handleKeyDown);
      return () => {
        window.removeEventListener('keydown', handleKeyDown);
      };
    }, []);

    // 构建设计态与预览态矩阵
    const isCellDriven =
      state.document.schemaVersion === '2.0' ||
      state.document.capabilitiesVersion === 'cell-expansion-v2' ||
      Boolean(state.document.regions && state.document.regions.length > 0 && state.document.regions[0]?.layoutKind === undefined);

    const currentGrid = useMemo<BiGridModel>(() => {
      if (state.mode === 'preview') {
        try {
          if (isCellDriven) {
            const { grid } = expandCellDrivenTemplate(state.document, activeData || []);
            return grid;
          }
          const plan = normalizeCellTemplate(state.document);
          if (plan) {
            const { grid } = expandCellTemplate(state.document, plan, activeData || []);
            return grid;
          }
        } catch (e) {
          console.warn('[CellReportDesigner] 预览计算异常:', e);
        }
      }

      // 设计态：展现模板占位符与格式
      const cells: any[] = [];
      const merges: any[] = [];

      for (const c of state.document.cells) {
        let display = '';
        let cellBgColor = c.style?.backgroundColor;
        let cellColor = c.style?.color;

        if (c.content.kind === 'field') {
          const role = c.content.role;
          const expand = c.content.expand;
          const arrow = expand === 'down' ? ' ↓' : expand === 'right' ? ' →' : '';
          const opLabel = role === 'measure' && c.content.operation && c.content.operation !== 'sum'
            ? ` (${c.content.operation.toUpperCase()})`
            : '';
          display = `{${c.content.displayName || c.content.fieldKey}${opLabel}${arrow}}`;

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
        } else if (c.content.kind === 'business-formula') {
          display = `=[${c.content.displayName || c.content.metricId}]`;
          if (!cellBgColor) {
            cellBgColor = '#f6ffed';
            cellColor = '#237804';
          }
        } else if (c.content.kind === 'literal') {
          display = String(c.content.value ?? '');
        }

        cells.push({
          row: c.position.row,
          col: c.position.column,
          value: display,
          displayText: display,
          role: 'custom',
          style: {
            fontFamily: c.style?.fontFamily,
            fontSize: c.style?.fontSize,
            bold: c.style?.bold ?? (c.content.kind === 'field' || c.content.kind === 'business-formula'),
            italic: c.style?.italic,
            color: cellColor,
            align: c.style?.textAlign ?? (c.content.kind === 'field' && c.content.role === 'measure' ? 'right' : undefined),
            bgColor: cellBgColor,
          },
        });
      }

      for (const rule of state.document.layoutRules) {
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
        (state.document.layoutRules || [])
          .filter((r) => r.kind === 'column-width' && r.index !== undefined && r.size !== undefined)
          .map((r) => [r.index!, r.size!])
      );
      const rowHeights = Object.fromEntries(
        (state.document.layoutRules || [])
          .filter((r) => r.kind === 'row-height' && r.index !== undefined && r.size !== undefined)
          .map((r) => [r.index!, r.size!])
      );

      return {
        type: 'detail',
        rowCount: 25,
        colCount: 15,
        cells,
        merges,
        bindings: [],
        colWidths,
        rowHeights,
      };
    }, [state.document, state.mode, activeData]);

    // 对外暴露 Ref 接口 (DCR-09: 同步原生编辑与工作簿快照)
    const flushDraft = () => {
      let next = designerReducer(stateRef.current, { type: 'APPLY_DRAFT' });
      const snapshot = univerPreviewRef.current?.getWorkbookSnapshot();
      if (snapshot) {
        const syncedDoc = syncDocumentFromWorkbookSnapshot(
          next.document,
          snapshot,
          stateRef.current.mode,
          currentGrid
        );
        next = {
          ...next,
          document: syncedDoc,
        };
      }
      // 仅通过 reducer 提交到 React 状态，不直接改写 ref（避免绕过 reducer 的状态双写）
      dispatch({ type: 'APPLY_DRAFT' });
      if (snapshot) {
        dispatch({ type: 'SYNC_FROM_SNAPSHOT', snapshot, grid: currentGrid });
      }
      return next.document;
    };
    useImperativeHandle(ref, () => ({
      validateAndGetReport: async () => {
        await univerPreviewRef.current?.waitForFormulaSettled();
        const doc = flushDraft();
        return compileCellReport(doc, activeData);
      },
      getTemplate: () => flushDraft(),
      flush: () => { flushDraft(); },
    }));

    // 字段快速绑定至当前选中的单元格
    const handleQuickBindField = (field: FieldItem) => {
      if (!state.selectedPos) {
        message.info('请先在画布中单击选中目标单元格');
        return;
      }

      const isDate = field.type === 'date';
      const isNum = field.type === 'number';

      let role: CellBusinessRole = 'measure';
      let op: CellDataOperation = 'sum';
      let expand: CellExpandDirection = 'inherit';

      if (isDate) {
        role = 'column-dimension';
        op = 'group';
        expand = 'right';
      } else if (!isNum) {
        role = 'row-dimension';
        op = 'group';
        expand = 'down';
      }

      dispatch({
        type: 'UPDATE_DRAFT_CONTENT',
        content: {
          kind: 'field',
          fieldId: resolveFieldId(field.key),
          fieldKey: field.key,
          role,
          operation: op,
          expand,
          displayName: field.label,
        },
      });
      dispatch({ type: 'APPLY_DRAFT' });
      message.success(`已绑定字段 "${field.label}" 到 R${state.selectedPos.row + 1}C${state.selectedPos.column + 1}`);
    };

    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          height,
          backgroundColor: '#fff',
          borderRadius: 8,
          overflow: 'hidden',
        }}
      >
        {/* 顶部工具栏 */}
        <div
          style={{
            padding: '10px 16px',
            borderBottom: '1px solid #f0f0f0',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            backgroundColor: '#fafafa',
          }}
        >
          <Space size={12}>
            <DatabaseOutlined style={{ color: '#1677ff', fontSize: 18 }} />
            <div>
              <Text strong style={{ fontSize: 15 }}>
                {state.document.title || '单元格报表设计器'}
              </Text>
              <Tag color="cyan" style={{ marginLeft: 8 }}>
                {activeDataset?.name || activeDatasetId} ({activeData.length} 行)
              </Tag>
            </div>
          </Space>

          <Space size={12}>
            {/* 设计态 / 预览态切换 */}
            <Segmented
              value={state.mode}
              onChange={(val) => {
                flushDraft();
                dispatch({ type: 'SET_MODE', mode: val as 'design' | 'preview' });
              }}
              options={[
                { label: '模板设计态', value: 'design', icon: <TableOutlined /> },
                { label: '动态展开预览', value: 'preview', icon: <EyeOutlined /> },
              ]}
            />

            <Space.Compact>
              <Tooltip title="撤销 (Ctrl+Z)">
                <Button
                  size="small"
                  icon={<UndoOutlined />}
                  disabled={state.history.length === 0}
                  onClick={() => dispatch({ type: 'UNDO' })}
                />
              </Tooltip>
              <Tooltip title="重做 (Ctrl+Y)">
                <Button
                  size="small"
                  icon={<RedoOutlined />}
                  disabled={state.future.length === 0}
                  onClick={() => dispatch({ type: 'REDO' })}
                />
              </Tooltip>
            </Space.Compact>

            <Button
              size="small"
              icon={<ThunderboltOutlined style={{ color: '#722ed1' }} />}
              onClick={() => setWizardOpen(true)}
            >
              排版向导
            </Button>

            {onSave && (
              <Button
                type="primary"
                size="small"
                onClick={async () => {
                  await univerPreviewRef.current?.waitForFormulaSettled();
                  const doc = flushDraft();
                  const res = compileCellReport(doc, activeData);
                  onSave(res);
                }}
              >
                保存报表
              </Button>
            )}

            {onCancel && (
              <Button size="small" onClick={onCancel}>
                取消
              </Button>
            )}
          </Space>
        </div>

        <Space wrap style={{ padding: '6px 16px', borderBottom: '1px solid #f0f0f0' }}>
          <Tag color="blue">单元格驱动模式 (v2.0)</Tag>
          <Text type="secondary" style={{ fontSize: 12 }}>
            报表结构由单元格位置、扩展方向与父格依赖共同驱动，无需全局布局/指标方向配置。
          </Text>
          {state.mode === 'preview' && <Text type="secondary">（当前为数据展开预览；编辑单元格请切回模板设计态）</Text>}
        </Space>

        {/* 主编辑工作区：三栏布局 */}
        <div style={{ flex: 1, minHeight: 0 }}>
          <Row style={{ height: '100%' }}>
            {/* 左侧：数据源与字段清单 */}
            <Col
              span={5}
              style={{
                height: '100%',
                borderRight: '1px solid #f0f0f0',
                display: 'flex',
                flexDirection: 'column',
                padding: '12px',
                backgroundColor: '#fcfcfc',
              }}
            >
              <div style={{ marginBottom: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                  <Space size={4}>
                    <DatabaseOutlined style={{ color: '#1677ff' }} />
                    <Text strong style={{ fontSize: 13 }}>
                      数据源
                    </Text>
                  </Space>
                  <Tag color="blue" style={{ margin: 0 }}>
                    {candidateDatasets.length} 个可用
                  </Tag>
                </div>
                <Select
                  size="small"
                  style={{ width: '100%', marginBottom: 10 }}
                  value={activeDatasetId}
                  onChange={(val) => {
                    setSelectedDatasetId(val);
                    dispatch({
                      type: 'UPDATE_REGION',
                      changes: { datasetId: val },
                    });
                  }}
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

              <div style={{ marginBottom: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <Text strong style={{ fontSize: 13 }}>
                  数据集字段库
                </Text>
                <Text type="secondary" style={{ fontSize: 11 }}>
                  共 {fieldItems.length} 个字段
                </Text>
              </div>

              <Input
                size="small"
                prefix={<SearchOutlined />}
                placeholder="搜索字段名称或 key..."
                value={fieldSearch}
                onChange={(e) => setFieldSearch(e.target.value)}
                style={{ marginBottom: 10 }}
              />

              <div style={{ flex: 1, overflowY: 'auto' }}>
                <List
                  size="small"
                  dataSource={filteredFields}
                  renderItem={(item) => (
                    <List.Item
                      style={{
                        padding: '6px 8px',
                        cursor: 'pointer',
                        borderRadius: 4,
                        transition: 'background 0.2s',
                      }}
                      onClick={() => handleQuickBindField(item)}
                    >
                      <div style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                          <Text style={{ fontSize: 12 }}>{item.label}</Text>
                          <div style={{ fontSize: 11, color: '#8c8c8c' }}>{item.key}</div>
                        </div>
                        <Space size={4}>
                          <Tag style={{ fontSize: 10, margin: 0 }}>{item.type}</Tag>
                          <PlusCircleOutlined style={{ color: '#1677ff' }} />
                        </Space>
                      </div>
                    </List.Item>
                  )}
                />
              </div>
            </Col>

            {/* 中间：Univer 画布 */}
            <Col span={14} style={{ height: '100%', position: 'relative' }}>
              <UniverPreview
                ref={univerPreviewRef}
                onReady={setUniverAPI}
                documentId={state.document.id}
                initialGrid={currentGrid}
                syncGridStyles
                height="100%"
              />
            </Col>

            {/* 右侧：单元格基础属性面板 */}
            <Col
              span={5}
              style={{
                height: '100%',
                borderLeft: '1px solid #f0f0f0',
                backgroundColor: '#fff',
              }}
            >
              {(() => {
                const activeCell = state.selectedCell || (state.selectedPos ? {
                  id: generateTemplateCellId(),
                  sheetId: state.document.sheets?.[0]?.id || 'sheet-1',
                  position: state.selectedPos,
                  content: { kind: 'literal' as const, value: '' },
                  parents: { row: 'default' as const, column: 'default' as const },
                } : null);

                const activePolicy = state.document.mergeConfig?.policies?.find(
                  (p) => p.target.kind === 'template-cell' && p.target.templateCellId === activeCell?.id
                );
                return (
                  <CellInspector
                    cell={activeCell}
                    allCells={state.document.cells}
                    fields={fieldItems}
                    defaultRegionId={state.document.regions?.[0]?.id || 'region-1'}
                    datasetName={activeDataset?.name}
                    mergePolicy={activePolicy}
                    draftDirty={state.draftDirty}
                    onUpdateContent={(content) => {
                      dispatch({ type: 'UPDATE_DRAFT_CONTENT', content });
                      dispatch({ type: 'APPLY_DRAFT' });
                    }}
                    onUpdateParents={(parents) => {
                      dispatch({ type: 'UPDATE_DRAFT_PARENTS', parents });
                      dispatch({ type: 'APPLY_DRAFT' });
                    }}
                    onUpdateStyle={(style) => {
                      dispatch({ type: 'UPDATE_DRAFT_STYLE', style });
                      dispatch({ type: 'APPLY_DRAFT' });
                    }}
                    onUpdateMergePolicy={(policy) => {
                      if (policy === null) {
                        if (activePolicy) {
                          dispatch({ type: 'REMOVE_DYNAMIC_MERGE_POLICY', policyId: activePolicy.id });
                        }
                      } else {
                        dispatch({ type: 'SET_DYNAMIC_MERGE_POLICY', policy });
                      }
                      dispatch({ type: 'APPLY_DRAFT' });
                    }}
                    onDelete={() => dispatch({ type: 'DELETE_CELL_BINDING' })}
                    onOpenAdvanced={() => dispatch({ type: 'OPEN_ADVANCED' })}
                  />
                );
              })()}
            </Col>
          </Row>
        </div>

        {/* 高级属性模态框 */}
        <CellAdvancedSettings
          open={state.advancedModalOpen}
          cell={state.selectedCell}
          document={state.document}
          onSave={(updated) => {
            if (updated.parents) dispatch({ type: 'UPDATE_DRAFT_PARENTS', parents: updated.parents });
            if (updated.content) dispatch({ type: 'UPDATE_DRAFT_CONTENT', content: updated.content });
            if (updated.style) dispatch({ type: 'UPDATE_DRAFT_STYLE', style: updated.style });
            dispatch({ type: 'APPLY_DRAFT' });
            dispatch({ type: 'CLOSE_ADVANCED' });
          }}
          onCancel={() => dispatch({ type: 'CLOSE_ADVANCED' })}
        />

        {/* 常用报表排版向导 */}
        <ReportWizardModal
          open={wizardOpen}
          fields={fieldItems}
          datasetId={activeDatasetId}
          datasetName={activeDataset?.name}
          onGenerate={(newDoc) => {
            dispatch({ type: 'LOAD_DOCUMENT', document: newDoc });
            setWizardOpen(false);
            message.success('已自动生成标准报表原型');
          }}
          onCancel={() => setWizardOpen(false)}
        />
      </div>
    );
  }
);
