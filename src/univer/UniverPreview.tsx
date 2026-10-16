/**
 * Univer 配置态预览与编辑器 React 容器 (UniverPreview.tsx)
 * 遵循 Section 13.1, 15:
 * 1. 封装 Univer 实例挂载、工作簿初始化与事件绑定
 * 2. 导出 getWorkbookSnapshot 与 compileReport 句柄供保存调用
 * 3. 严格的组件卸载释放与 React StrictMode 保护
 * 4. MBI-01: 优先从 initialSnapshot 恢复已有工作簿编辑状态
 * 5. MBI-02: 分离实例生命周期与数据刷新生命周期，对未被人工覆盖的业务单元格进行增量数据刷新
 * 6. MBI-05: 初始矩阵生成的绑定自动注册进入管理器
 */
import React, { useRef, useEffect, useImperativeHandle, forwardRef, useState, useMemo } from 'react';
import type { IWorkbookData } from '@univerjs/core';
import { isBrowser, initUniver, waitForFormulaSettled, type FUniver } from './adapter.js';
import { BiBindingManager } from './BiBindingPlugin.js';
import { compileReport, type CompileReportResult } from './compileReport.js';
import type { BiGridModel, ReportBinding } from '../report/types.js';
import { biGridToUniverWorksheetData } from '../report/buildBiGrid.js';

export interface UniverPreviewRef {
  getWorkbookSnapshot: () => any;
  getUniverAPI: () => FUniver | null;
  compileReport: (options?: { reportId?: string; title?: string }) => Promise<CompileReportResult>;
  waitForFormulaSettled: () => Promise<void>;
}

export interface UniverPreviewProps {
  documentId?: string | undefined;
  revision?: number | undefined;
  initialSnapshot?: Partial<IWorkbookData> | undefined;
  initialGrid?: BiGridModel | undefined;
  bindings?: ReportBinding[] | undefined;
  manualOverrides?: Record<string, { v?: unknown; f?: string }> | undefined;
  onBindingsChange?: ((bindings: ReportBinding[]) => void) | undefined;
  onManualOverride?: ((bindingId: string, override: { v?: unknown; f?: string }) => void) | undefined;
  height?: number | string | undefined;
  className?: string | undefined;
  style?: React.CSSProperties | undefined;
}

export const UniverPreview = forwardRef<UniverPreviewRef, UniverPreviewProps>(
  function UniverPreview(
    {
      documentId,
      initialSnapshot,
      initialGrid,
      bindings = [],
      manualOverrides,
      onBindingsChange,
      onManualOverride,
      height = '100%',
      className,
      style,
    },
    ref
  ) {
    const containerRef = useRef<HTMLDivElement>(null);
    const univerAPIRef = useRef<FUniver | null>(null);
    const disposeFnRef = useRef<(() => void) | null>(null);
    const bindingManagerRef = useRef<BiBindingManager | null>(null);
    const [isInitialized, setIsInitialized] = useState(false);
    const lastGridRef = useRef<BiGridModel | undefined>(initialGrid);

    // MBI-05: 若外部 bindings 尚未持久化，自动采用 initialGrid 生成的基础矩阵绑定
    const effectiveBindings = useMemo(() => {
      if (bindings && bindings.length > 0) return bindings;
      return initialGrid?.bindings || [];
    }, [bindings, initialGrid]);

    // MBI-01: 构建初始快照，优先恢复已保存快照，否则由初始矩阵初始化空白工作簿
    const effectiveSnapshot = useMemo(() => {
      if (initialSnapshot) return initialSnapshot;
      if (initialGrid) {
        const sheetData = biGridToUniverWorksheetData(initialGrid, {
          sheetId: 'sheet-1',
          name: '分析工作表',
        });
        return {
          id: documentId || 'workbook-analysis',
          sheetOrder: ['sheet-1'],
          sheets: {
            'sheet-1': sheetData as any,
          },
        };
      }
      return undefined;
    }, [initialSnapshot, initialGrid, documentId]);

    // 实例挂载：独立于数据刷新生命周期 (MBI-18: 独立子容器与微任务异步清理，杜绝 React StrictMode 同步卸载警告与画布丢失)
    useEffect(() => {
      if (!isBrowser || !containerRef.current) return;

      const container = containerRef.current;
      const subContainer = document.createElement('div');
      subContainer.style.width = '100%';
      subContainer.style.height = '100%';
      subContainer.style.position = 'relative';
      container.appendChild(subContainer);

      let isDisposed = false;
      const bundle = initUniver(subContainer, {
        initialSnapshot: effectiveSnapshot,
      });

      if (!bundle) {
        try {
          subContainer.remove();
        } catch {}
        return;
      }

      univerAPIRef.current = bundle.univerAPI;
      disposeFnRef.current = bundle.dispose;

      // 初始化业务绑定管理器 (MBI-04, MBI-05)
      const bm = new BiBindingManager({
        bindings: effectiveBindings,
        ...(onBindingsChange !== undefined ? { onBindingsChange } : {}),
        ...(onManualOverride !== undefined ? { onManualOverride } : {}),
      });
      bm.attach(bundle.univerAPI);
      bindingManagerRef.current = bm;

      // 若首次生成了有效绑定且外部尚无绑定，通知外部持久化
      if (bindings.length === 0 && effectiveBindings.length > 0) {
        onBindingsChange?.(effectiveBindings);
      }

      setIsInitialized(true);

      const localBundle = bundle;
      const localBm = bm;
      const localSubContainer = subContainer;

      return () => {
        if (isDisposed) return;
        isDisposed = true;

        if (bindingManagerRef.current === localBm) {
          bindingManagerRef.current = null;
        }
        if (univerAPIRef.current === localBundle.univerAPI) {
          univerAPIRef.current = null;
        }
        if (disposeFnRef.current === localBundle.dispose) {
          disposeFnRef.current = null;
        }
        setIsInitialized(false);

        localBm.dispose();
        // 延迟至微任务执行 Univer 销毁，避免在 React 渲染批次中同步触发嵌套 root 卸载
        queueMicrotask(() => {
          try {
            localBundle.dispose();
          } catch {}
          try {
            localSubContainer.remove();
          } catch {}
        });
      };
    }, []); // 仅在初次挂载时建立实例 (MBI-02)

    // 同步外部传入的最新 bindings 到管理器中
    useEffect(() => {
      if (bindingManagerRef.current && effectiveBindings) {
        bindingManagerRef.current.setBindings(effectiveBindings);
      }
    }, [effectiveBindings]);

    // MBI-02: 监听配置或数据变动时的增量数据刷新（杜绝销毁实例重建，完整保留用户手工编辑和覆盖）
    useEffect(() => {
      if (!isInitialized || !univerAPIRef.current || !initialGrid) return;
      const oldGrid = lastGridRef.current;
      if (oldGrid === initialGrid) return;
      lastGridRef.current = initialGrid;

      try {
        if (typeof BiBindingManager !== 'undefined') {
          BiBindingManager.isProgrammaticWrite = true;
        }
        if (univerAPIRef.current) {
          (univerAPIRef.current as any).__isProgrammaticWrite = true;
        }
        const activeWorkbook = univerAPIRef.current.getActiveWorkbook();
        const worksheet = activeWorkbook ? activeWorkbook.getActiveSheet() : null;
        if (!worksheet || !activeWorkbook) return;

        const wsInternal = (worksheet as any)._worksheet;
        const matrix = wsInternal?.getCellMatrix?.();
        const oldSnapshot = activeWorkbook.save();
        const sheetId = worksheet.getSheetId?.() || 's1';
        const oldCellData = (oldSnapshot.sheets as any)?.[sheetId]?.cellData || {};

        // 1. 采集旧单元格样式（按业务绑定语义 ID 索引，确保重排后样式跟随业务成员，DT-12, DT-16）
        const styleMap = new Map<string, any>();
        if (oldGrid && oldGrid.bindings) {
          for (const b of oldGrid.bindings) {
            const cell = oldCellData[b.target.row]?.[b.target.column];
            if (cell && cell.s) {
              styleMap.set(b.id, cell.s);
            }
          }
        }

        // 2. 清理旧区域超出新网格范围的单元格，防止删除成员或透视列时残留旧表格残影 (DT-14, DT-17)
        if (oldGrid && matrix) {
          for (let r = 0; r < oldGrid.rowCount; r++) {
            for (let c = 0; c < oldGrid.colCount; c++) {
              if (r >= initialGrid.rowCount || c >= initialGrid.colCount) {
                try {
                  matrix.realDeleteValue(r, c);
                } catch {}
              }
            }
          }
        }

        // 3. 写入新网格并按语义身份迁移人工覆盖和样式 (DT-11, DT-12, DT-13, DT-16)
        for (const cell of initialGrid.cells) {
          const newB = initialGrid.bindings.find(
            (b) => b.target.row === cell.row && b.target.column === cell.col
          );

          let val = cell.value;
          let formula: string | undefined = undefined;

          if (newB && manualOverrides && manualOverrides[newB.id]) {
            const override = manualOverrides[newB.id];
            if (override) {
              if (override.v !== undefined) val = override.v as any;
              if (override.f) formula = override.f;
            }
          }

          const styleId = newB ? styleMap.get(newB.id) : undefined;

          try {
            const range = (worksheet as any).getRange?.(cell.row, cell.col);
            if (formula) {
              range?.setFormula?.(formula);
            } else if (val !== null && val !== undefined) {
              range?.setValue?.(val);
            } else if (matrix) {
              matrix.realDeleteValue(cell.row, cell.col);
            }
          } catch {}

          if (styleId && matrix) {
            try {
              const cur = matrix.getValue(cell.row, cell.col) || {};
              matrix.setValue(cell.row, cell.col, { ...cur, s: styleId });
            } catch {}
          }
        }

        // 4. 重建合并单元格区域 (DT-15)
        const hostProto = Object.getPrototypeOf(initialGrid);
        const expectedMerges = (initialGrid.merges || []).map((m: any) => {
          const obj = Object.create(hostProto);
          obj.startRow = m.startRow;
          obj.endRow = m.endRow;
          obj.startColumn = m.startCol;
          obj.endColumn = m.endCol;
          return obj;
        });
        try {
          wsInternal?.setMergeData?.(expectedMerges);
        } catch {}
      } catch (err) {
        console.warn('[UniverPreview] 增量数据刷新异常:', err);
      } finally {
        if (typeof BiBindingManager !== 'undefined') {
          BiBindingManager.isProgrammaticWrite = false;
        }
        if (univerAPIRef.current) {
          (univerAPIRef.current as any).__isProgrammaticWrite = false;
        }
      }
    }, [isInitialized, initialGrid, effectiveBindings, manualOverrides]);

    useImperativeHandle(
      ref,
      () => ({
        getWorkbookSnapshot: () => {
          if (!univerAPIRef.current) return null;
          const activeWorkbook = univerAPIRef.current.getActiveWorkbook();
          return activeWorkbook ? activeWorkbook.save() : null;
        },
        getUniverAPI: () => univerAPIRef.current,
        waitForFormulaSettled: async () => {
          if (univerAPIRef.current) {
            await waitForFormulaSettled(univerAPIRef.current);
          }
        },
        compileReport: async (options = {}) => {
          if (univerAPIRef.current) {
            await waitForFormulaSettled(univerAPIRef.current);
            const activeWorkbook = univerAPIRef.current.getActiveWorkbook();
            if (activeWorkbook) {
              return compileReport(activeWorkbook, options);
            }
          }
          throw new Error('Univer 实例尚未就绪或工作簿不存在');
        },
      }),
      []
    );

    return (
      <div
        ref={containerRef}
        className={className}
        style={{
          width: '100%',
          height,
          position: 'relative',
          overflow: 'hidden',
          ...style,
        }}
      />
    );
  }
);
