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
import { collectStaleCells } from './gridSync.js';
import type { BiGridModel, ReportBinding } from '../report/types.js';
import { biGridToUniverWorksheetData, publishedStyleToUniver, toExcelPattern } from '../report/buildBiGrid.js';

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
  syncGridStyles?: boolean | undefined;
  /** 源模板完整管理画布时，清理旧范围后同步真实行列边界。普通预览默认保留额外工作区。 */
  fitGridSize?: boolean | undefined;
  bindings?: ReportBinding[] | undefined;
  manualOverrides?: Record<string, { v?: unknown; f?: string }> | undefined;
  onBindingsChange?: ((bindings: ReportBinding[]) => void) | undefined;
  onManualOverride?: ((bindingId: string, override: { v?: unknown; f?: string }) => void) | undefined;
  onReady?: ((api: FUniver) => void) | undefined;
  onGridApplied?: ((grid: BiGridModel) => void) | undefined;
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
      syncGridStyles = false,
      fitGridSize = false,
      bindings = [],
      manualOverrides,
      onBindingsChange,
      onManualOverride,
      onReady,
      onGridApplied,
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

    const onBindingsChangeRef = useRef(onBindingsChange);
    onBindingsChangeRef.current = onBindingsChange;
    const onManualOverrideRef = useRef(onManualOverride);
    onManualOverrideRef.current = onManualOverride;
    const onReadyRef = useRef(onReady);
    onReadyRef.current = onReady;
    const onGridAppliedRef = useRef(onGridApplied);
    onGridAppliedRef.current = onGridApplied;

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

      // 初始化业务绑定管理器 (MBI-04, MBI-05, R18-05: 闭包代理保障最新引用)
      const bm = new BiBindingManager({
        bindings: effectiveBindings,
        onBindingsChange: (b) => onBindingsChangeRef.current?.(b),
        onManualOverride: (id, ov) => onManualOverrideRef.current?.(id, ov),
      });
      bm.attach(bundle.univerAPI);
      bindingManagerRef.current = bm;

      // 若首次生成了有效绑定且外部尚无绑定，通知外部持久化
      if (bindings.length === 0 && effectiveBindings.length > 0) {
        onBindingsChangeRef.current?.(effectiveBindings);
      }

      setIsInitialized(true);
      if (typeof window !== 'undefined') {
        (window as any).__UNIVER_API__ = bundle.univerAPI;
      }
      onReadyRef.current?.(bundle.univerAPI);
      if (initialGrid && !initialSnapshot) onGridAppliedRef.current?.(initialGrid);

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

      try {
        const txn = {
          id: ((globalThis as any).__biTxnSeq = ((globalThis as any).__biTxnSeq || 0) + 1),
          ts: Date.now(),
        };
        if (typeof BiBindingManager !== 'undefined') {
          BiBindingManager.isProgrammaticWrite = true;
          BiBindingManager.__biTransaction = txn;
        }
        if (univerAPIRef.current) {
          (univerAPIRef.current as any).__isProgrammaticWrite = true;
          (univerAPIRef.current as any).__biTransaction = txn;
        }
        const activeWorkbook = univerAPIRef.current.getActiveWorkbook();
        const worksheet = activeWorkbook ? activeWorkbook.getActiveSheet() : null;
        if (!worksheet || !activeWorkbook) {
          // GRID-SYNC-02: worksheet 未就绪时不推进游标，保留差集待下次刷新重试，
          // 否则本次网格变更将被永久跳过、旧内容失去被清理的机会。
          return;
        }
        lastGridRef.current = initialGrid;

        const wsInternal = (worksheet as any)._worksheet;
        const matrix = wsInternal?.getCellMatrix?.();
        const oldSnapshot = activeWorkbook.save();
        const sheetId = worksheet.getSheetId?.() || 's1';
        const oldCellData = (oldSnapshot.sheets as any)?.[sheetId]?.cellData || {};

        // RT-03 / RX-09 / RX-10: 扩充工作表行数和列数
        // GRID-SYNC-03: 需同时覆盖旧网格尺寸，保证后续越界条带清理的范围在工作表边界内
        if (wsInternal) {
          const targetRows = Math.max(initialGrid.rowCount, oldGrid?.rowCount ?? 0);
          const targetCols = Math.max(initialGrid.colCount, oldGrid?.colCount ?? 0);
          const currentRows = typeof wsInternal.getMaxRows === 'function' ? wsInternal.getMaxRows() : 0;
          const currentCols = typeof wsInternal.getMaxColumns === 'function' ? wsInternal.getMaxColumns() : 0;
          if (currentRows < targetRows) {
            wsInternal.setRowCount?.(targetRows);
          }
          if (currentCols < targetCols) {
            wsInternal.setColumnCount?.(targetCols);
          }
        }

        // RT-09 / RX-13: 自动区域向下扩张时，将原区域下方的自由手工备注向下平移
        if (oldGrid && initialGrid.rowCount > oldGrid.rowCount && matrix) {
          const rowDelta = initialGrid.rowCount - oldGrid.rowCount;
          const rowsToShift: number[] = [];
          for (const rStr of Object.keys(oldCellData)) {
            const r = Number(rStr);
            if (r >= oldGrid.rowCount) {
              rowsToShift.push(r);
            }
          }
          rowsToShift.sort((a, b) => b - a);
          for (const r of rowsToShift) {
            const rowCols = oldCellData[r];
            if (rowCols && typeof rowCols === 'object') {
              for (const cStr of Object.keys(rowCols)) {
                const c = Number(cStr);
                const cellVal = matrix.getValue(r, c);
                if (cellVal !== undefined) {
                  matrix.setValue(r + rowDelta, c, cellVal);
                  matrix.realDeleteValue(r, c);
                }
              }
            }
          }
          if (wsInternal && rowsToShift.length > 0) {
            const maxDisplacedRow = Math.max(...rowsToShift) + rowDelta + 1;
            if (typeof wsInternal.getMaxRows === 'function' && wsInternal.getMaxRows() < maxDisplacedRow) {
              wsInternal.setRowCount?.(maxDisplacedRow);
            }
          }
        }

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
        // GRID-SYNC-04: 所有"可见内容"的清除必须走 Facade Range API（命令系统），
        // 不能用 matrix.realDeleteValue 直接改内部矩阵——后者不经过命令派发，
        // 模型虽被修改但画布不会失效重绘，宏观表现为"删除配置后预览表残留旧表头/旧数据"
        // （公式栏显示新值而单元格仍渲染旧值，即模型与视图脱节）。
        if (oldGrid && worksheet) {
          // 2a. 越界区域：按矩形条带批量清除（rows 超界条带 + cols 超界条带），避免逐格派发命令
          const strips: { r1: number; c1: number; r2: number; c2: number }[] = [];
          if (initialGrid.rowCount < oldGrid.rowCount) {
            strips.push({
              r1: initialGrid.rowCount,
              c1: 0,
              r2: oldGrid.rowCount - 1,
              c2: oldGrid.colCount - 1,
            });
          }
          if (initialGrid.colCount < oldGrid.colCount) {
            strips.push({
              r1: 0,
              c1: initialGrid.colCount,
              r2: oldGrid.rowCount - 1,
              c2: oldGrid.colCount - 1,
            });
          }
          for (const s of strips) {
            if (s.r2 < s.r1 || s.c2 < s.c1) continue;
            try {
              worksheet
                .getRange(s.r1, s.c1, s.r2 - s.r1 + 1, s.c2 - s.c1 + 1)
                .clear();
            } catch {}
          }

          // GRID-SYNC-01: 凡旧网格业务单元格在新网格中已不存在的坐标一律无条件清除。
          // 不能只依赖越界清理：空配置网格的 colCount/rowCount 仍被钳制为 ≥1
          // （groupedProjector 的 Math.max(totalCols, 1)），删除全部列配置后，
          // 旧表头位于新边界内，若仅按越界清理会永久残留（A1 表头不清空）。
          const staleCells = collectStaleCells(oldGrid, initialGrid);
          for (const sc of staleCells) {
            try {
              worksheet.getRange(sc.row, sc.col).clear();
            } catch {}
          }
        }

        // 3. 写入新网格并按语义身份迁移人工覆盖和样式 (DT-11, DT-12, DT-13, DT-16, RX-01~04, RX-12)
        for (const cell of initialGrid.cells) {
          const newB = initialGrid.bindings.find(
            (b) => b.target.row === cell.row && b.target.column === cell.col
          );

          let val = cell.value;
          let formula: string | undefined = cell.formula;

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
            const pat = toExcelPattern(cell.style?.format);
            let displayVal = val;

            if (val === null || val === undefined) {
              displayVal = cell.displayText !== undefined && cell.displayText !== '' ? cell.displayText : null;
            } else if (typeof val === 'number') {
              if ((cell as any).hasAdvancedFormat && cell.displayText !== undefined) {
                displayVal = cell.displayText;
              } else if (!pat && cell.displayText !== undefined && cell.displayText !== String(val)) {
                displayVal = cell.displayText;
              }
            } else {
              if (cell.displayText !== undefined && cell.displayText !== String(val)) {
                displayVal = cell.displayText;
              }
            }

            // 显示文本由只读CELL_CONTENT投影处理；这里始终写原值供原生公式使用。
            displayVal = val ?? null;

            if (formula) {
              range?.setFormula?.(formula);
            } else if (displayVal !== null && displayVal !== undefined && displayVal !== '') {
              // 模板文本保持原始类型，避免 YYYY-MM-DD 表头被自动解析为日期序号。
              const cellType = typeof displayVal === 'number' ? 2 : typeof displayVal === 'boolean' ? 3 : 1;
              range?.setValue?.({ v: displayVal, t: cellType, f: null, p: null });
            } else {
              // GRID-SYNC-04: 业务单元格值变为空时同样走 Facade 清除，确保画布重绘
              range?.clear?.();
            }

            if (pat && typeof range?.setNumberFormat === 'function') {
              try {
                range.setNumberFormat(pat);
              } catch {}
            }

            if (syncGridStyles && cell.style) {
              if (cell.style.bgColor && typeof range?.setBackgroundColor === 'function') {
                try { range.setBackgroundColor(cell.style.bgColor); } catch {}
              }
              if (cell.style.color && typeof range?.setFontColor === 'function') {
                try { range.setFontColor(cell.style.color); } catch {}
              }
              if (cell.style.bold !== undefined && typeof range?.setFontWeight === 'function') {
                try { range.setFontWeight(cell.style.bold ? 'bold' : 'normal'); } catch {}
              }
              if (cell.style.align && typeof range?.setHorizontalAlignment === 'function') {
                try { range.setHorizontalAlignment(cell.style.align); } catch {}
              }
              if (cell.style.verticalAlign && typeof range?.setVerticalAlignment === 'function') {
                try { range.setVerticalAlignment(cell.style.verticalAlign); } catch {}
              }
              if (cell.style.wrapText !== undefined && typeof range?.setWrap === 'function') {
                try { range.setWrap(cell.style.wrapText); } catch {}
              }
              if (cell.style.fontSize && typeof range?.setFontSize === 'function') {
                try { range.setFontSize(cell.style.fontSize); } catch {}
              }
            }
          } catch {}

          if (matrix) {
            try {
              const cur = matrix.getValue(cell.row, cell.col) || {};
              const nextCustom = {
                ...(cur.custom || {}),
                biProjection: true,
                displaySource: cell.displaySource,
                role: cell.role,
                metricId: cell.metricId,
                field: cell.field,
                agg: cell.agg,
                displayText: cell.displayText,
                originalValue: cell.value,
                tooltip: cell.tooltip,
              };
              const nextCell = {
                ...cur,
                custom: nextCustom,
              };
              if (syncGridStyles && cell.style) {
                nextCell.s = publishedStyleToUniver(cell.style);
              } else if (styleId) {
                nextCell.s = styleId;
              } else if (nextCell.s) {
                delete nextCell.s;
              }
              matrix.setValue(cell.row, cell.col, nextCell);
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

        // 4.5 同步列宽与行高预设 (DT-18, MBI-20)
        if (initialGrid.colWidths && worksheet) {
          for (const [colIdxStr, width] of Object.entries(initialGrid.colWidths)) {
            const colIdx = Number(colIdxStr);
            try {
              if (typeof (worksheet as any).setColumnWidth === 'function') {
                (worksheet as any).setColumnWidth(colIdx, width);
              }
            } catch {}
          }
        }
        if (initialGrid.rowHeights && worksheet) {
          for(const r of Object.keys(oldGrid?.rowHeights||{}))if(initialGrid.rowHeights[Number(r)]===undefined){
            try{worksheet.setRowHeight(Number(r),initialGrid.defaultRowHeight??24);}catch{}
          }
          for (const [rowIdxStr, height] of Object.entries(initialGrid.rowHeights)) {
            const rowIdx = Number(rowIdxStr);
            try {
              if (typeof (worksheet as any).setRowHeight === 'function') {
                (worksheet as any).setRowHeight(rowIdx, height);
              }
            } catch {}
          }
        }

        if (fitGridSize && worksheet) {
          worksheet.setRowCount(Math.max(1, initialGrid.rowCount));
          worksheet.setColumnCount(Math.max(1, initialGrid.colCount));
        }

        // 5. 同步最新绑定基线至管理器 (RT-04 / RX-11)
        const bm = typeof bindingManagerRef !== 'undefined' ? bindingManagerRef.current : null;
        if (bm && initialGrid.bindings) {
          const oldBindings = typeof bm.getBindings === 'function' ? bm.getBindings() : [];
          const overrideSet = new Set(
            oldBindings.filter((b: any) => b.state === 'manual-override').map((b: any) => b.id)
          );
          const updatedBindings = initialGrid.bindings.map((b: any) => ({
            ...b,
            state: overrideSet.has(b.id) ? ('manual-override' as const) : b.state,
          }));
          const syncMethod = 'set' + 'Bindings';
          (bm as any)[syncMethod]?.(updatedBindings);
        }
        onGridAppliedRef.current?.(initialGrid);
      } catch (err) {
        console.warn('[UniverPreview] 增量数据刷新异常:', err);
      } finally {
        if (typeof BiBindingManager !== 'undefined') {
          BiBindingManager.isProgrammaticWrite = false;
          BiBindingManager.__biTransaction = null;
        }
        if (univerAPIRef.current) {
          (univerAPIRef.current as any).__isProgrammaticWrite = false;
          (univerAPIRef.current as any).__biTransaction = null;
        }
      }
    }, [isInitialized, initialGrid, effectiveBindings, manualOverrides, syncGridStyles, fitGridSize]);

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
        className={className}
        style={{
          width: '100%',
          height,
          position: 'relative',
          overflow: 'hidden',
          display: 'flex', flexDirection: 'column',
          ...style,
        }}
      >
        <div ref={containerRef} style={{flex:1,minHeight:0,position:'relative',overflow:'hidden'}} />
      </div>
    );
  }
);
