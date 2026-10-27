/**
 * Univer SDK 选区与双击事件桥接模块 (univerEvents.ts)
 * 遵循 Section 15.1, 15.2:
 * 1. 监听 SelectionChanged / CellClicked，单击仅更新选区与基础属性面板，不弹窗、不逐格请求数据
 * 2. 拦截 BeforeSheetEditStart 中的双击事件，取消原生单元格编辑器并打开高级属性
 * 3. 键盘 F2 / 字符键入不受误拦截，保留普通单元格与公式输入能力
 */
import type { FUniver } from '../univer/adapter.js';

// 已安装 Univer 版本中 DeviceInputEventType.Dblclick 的取值；升级 SDK 时须复核。
const DBLCLICK_EVENT_TYPE = 3;

export interface CellEditEvent {
  row: number;
  column: number;
  sheetId?: string | undefined;
  value?: any;
  formula?: string | undefined;
}

export interface StructureChangeEvent {
  sheetId?: string | undefined;
  startIndex: number;
  count: number;
}

export interface UniverBridgeOptions {
  onSelectCell?: (pos: { row: number; column: number; sheetId?: string | undefined }) => void;
  onDoubleClicked?: ((pos: { row: number; column: number; sheetId?: string | undefined }) => void) | undefined;
  onCellEdited?: ((change: CellEditEvent) => void) | undefined;
  onColumnsInserted?: ((change: StructureChangeEvent) => void) | undefined;
  onColumnsRemoved?: ((change: StructureChangeEvent) => void) | undefined;
  onRowsInserted?: ((change: StructureChangeEvent) => void) | undefined;
  onRowsRemoved?: ((change: StructureChangeEvent) => void) | undefined;
}

export function attachUniverDesignerEvents(
  univerAPI: FUniver,
  options: UniverBridgeOptions = {}
): () => void {
  const disposers: Array<() => void> = [];

  try {
    const api = univerAPI as any;
    let lastSelection = '';

    // 1. 选区变动监听 (SelectionChanged)
    const handleSelectionChanged = (selection: any) => {
      try {
        let row = 0;
        let column = 0;
        let sheetId: string | undefined;

        if (selection?.selections?.[0] || selection?.range) {
          const range = selection.selections?.[0] || selection.range;
          row = range.startRow ?? 0;
          column = range.startColumn ?? 0;
          sheetId = selection.worksheet?.getSheetId?.();
        } else if (Number.isInteger(selection?.row) && Number.isInteger(selection?.column)) {
          row = selection.row;
          column = selection.column;
          sheetId = selection.worksheet?.getSheetId?.();
        } else if (typeof api.getActiveWorkbook === 'function') {
          const activeSheet = api.getActiveWorkbook()?.getActiveSheet();
          sheetId = activeSheet?.getSheetId?.();
          const activeRange = activeSheet?.getSelection?.()?.getActiveRange?.();
          if (activeRange) {
            row = activeRange.getRow?.() ?? 0;
            column = activeRange.getColumn?.() ?? 0;
          }
        }

        const key = `${sheetId || ''}:${row},${column}`;
        if (key !== lastSelection) {
          lastSelection = key;
          options.onSelectCell?.({ row, column, sheetId });
        }
      } catch (err) {
        console.warn('[UniverDesignerEvents] SelectionChanged 处理异常:', err);
      }
    };

    if (api.Event?.SelectionChanged && typeof api.addEvent === 'function') {
      const d = api.addEvent(api.Event.SelectionChanged, handleSelectionChanged);
      if (d?.dispose) disposers.push(() => d.dispose());
    }
    // 1.0.4 的不同渲染阶段可能尚未接通 SelectionChanged；覆盖鼠标与键盘命令。
    for (const name of [api.Event?.CellClicked, api.Event?.SelectionMoveEnd]) {
      if (!name || typeof api.addEvent !== 'function') continue;
      const d = api.addEvent(name, handleSelectionChanged);
      if (d?.dispose) disposers.push(() => d.dispose());
    }
    if (api.Event?.CommandExecuted && typeof api.addEvent === 'function') {
      const d = api.addEvent(api.Event.CommandExecuted, (event: any) => {
        if (api.__biSourceHistoryReplay) return;
        const cmdInfo = event?.commandInfo || event;
        const cmdId = String(cmdInfo?.id || '').toLowerCase();
        if (cmdId.includes('selection')) {
          handleSelectionChanged(event);
        } else if (
          cmdId === 'sheet.mutation.insert-col' &&
          options.onColumnsInserted
        ) {
          if ((api as any)?.__biTransaction || (api as any)?.__isProgrammaticWrite || (api as any)?.isProgrammaticWrite || (globalThis as any)?.__isBiProgrammaticWrite) {
            return;
          }
          const params = cmdInfo?.params;
          const startCol = params?.range?.startColumn ?? params?.col ?? params?.colIndex ?? 0;
          const endCol = params?.range?.endColumn !== undefined ? params.range.endColumn : (params?.range?.startColumn !== undefined ? params.range.startColumn : (params?.count ? startCol + params.count - 1 : startCol));
          const count = Math.max(1, endCol - startCol + 1);
          const sheetId = params?.subUnitId || params?.sheetId || params?.unitId;
          options.onColumnsInserted({ sheetId, startIndex: startCol, count });
        } else if (
          cmdId === 'sheet.mutation.remove-col' &&
          options.onColumnsRemoved
        ) {
          if ((api as any)?.__biTransaction || (api as any)?.__isProgrammaticWrite || (api as any)?.isProgrammaticWrite || (globalThis as any)?.__isBiProgrammaticWrite) {
            return;
          }
          const params = cmdInfo?.params;
          const startCol = params?.range?.startColumn ?? params?.col ?? params?.colIndex ?? 0;
          const endCol = params?.range?.endColumn !== undefined ? params.range.endColumn : (params?.range?.startColumn !== undefined ? params.range.startColumn : (params?.count ? startCol + params.count - 1 : startCol));
          const count = Math.max(1, endCol - startCol + 1);
          const sheetId = params?.subUnitId || params?.sheetId || params?.unitId;
          options.onColumnsRemoved({ sheetId, startIndex: startCol, count });
        } else if (
          cmdId === 'sheet.mutation.insert-row' &&
          options.onRowsInserted
        ) {
          if ((api as any)?.__biTransaction || (api as any)?.__isProgrammaticWrite || (api as any)?.isProgrammaticWrite || (globalThis as any)?.__isBiProgrammaticWrite) {
            return;
          }
          const params = cmdInfo?.params;
          const startRow = params?.range?.startRow ?? params?.row ?? params?.rowIndex ?? 0;
          const endRow = params?.range?.endRow !== undefined ? params.range.endRow : (params?.range?.startRow !== undefined ? params.range.startRow : (params?.count ? startRow + params.count - 1 : startRow));
          const count = Math.max(1, endRow - startRow + 1);
          const sheetId = params?.subUnitId || params?.sheetId || params?.unitId;
          options.onRowsInserted({ sheetId, startIndex: startRow, count });
        } else if (
          cmdId === 'sheet.mutation.remove-rows' &&
          options.onRowsRemoved
        ) {
          if ((api as any)?.__biTransaction || (api as any)?.__isProgrammaticWrite || (api as any)?.isProgrammaticWrite || (globalThis as any)?.__isBiProgrammaticWrite) {
            return;
          }
          const params = cmdInfo?.params;
          const startRow = params?.range?.startRow ?? params?.row ?? params?.rowIndex ?? 0;
          const endRow = params?.range?.endRow !== undefined ? params.range.endRow : (params?.range?.startRow !== undefined ? params.range.startRow : (params?.count ? startRow + params.count - 1 : startRow));
          const count = Math.max(1, endRow - startRow + 1);
          const sheetId = params?.subUnitId || params?.sheetId || params?.unitId;
          options.onRowsRemoved({ sheetId, startIndex: startRow, count });
        } else if (cmdId.includes('set-range-values') && !cmdId.includes('mutation') && options.onCellEdited) {
          if ((api as any)?.__biTransaction || (api as any)?.__isProgrammaticWrite || (api as any)?.isProgrammaticWrite || (globalThis as any)?.__isBiProgrammaticWrite) {
            return;
          }
          try {
            const params = cmdInfo?.params;
            if (!params) return;
            const sheetId = params.subUnitId || params.sheetId || params.unitId;
            if (params.range && params.value !== undefined) {
              const startRow = params.range.startRow ?? 0;
              const startCol = params.range.startColumn ?? 0;
              const endRow = params.range.endRow !== undefined ? params.range.endRow : startRow;
              const endCol = params.range.endColumn !== undefined ? params.range.endColumn : startCol;
              const rawVal = params.value;

              for (let r = startRow; r <= endRow; r++) {
                for (let c = startCol; c <= endCol; c++) {
                  let val: any = undefined;
                  let formula: string | undefined = undefined;

                  if (typeof rawVal === 'object' && rawVal !== null && !Array.isArray(rawVal)) {
                    const rowObj = rawVal[r] ?? rawVal[r - startRow];
                    if (rowObj && typeof rowObj === 'object' && !('v' in rawVal) && !('f' in rawVal)) {
                      const cell = rowObj[c] ?? rowObj[c - startCol];
                      if (cell !== undefined) {
                        val = typeof cell === 'object' && cell !== null ? cell.v : cell;
                        formula = typeof cell === 'object' && cell !== null ? cell.f : undefined;
                      }
                    } else if ('v' in rawVal || 'f' in rawVal) {
                      if (r === startRow && c === startCol) {
                        val = rawVal.v;
                        formula = rawVal.f;
                      }
                    }
                  } else if (Array.isArray(rawVal)) {
                    const relR = r - startRow;
                    const relC = c - startCol;
                    if (relR >= 0 && relR < rawVal.length) {
                      const rowArr = rawVal[relR];
                      if (Array.isArray(rowArr) && relC >= 0 && relC < rowArr.length) {
                        const cell = rowArr[relC];
                        val = typeof cell === 'object' && cell !== null ? cell.v : cell;
                        formula = typeof cell === 'object' && cell !== null ? cell.f : undefined;
                      }
                    }
                  } else if (r === startRow && c === startCol) {
                    val = rawVal;
                  }

                  if (val !== undefined || formula !== undefined) {
                    options.onCellEdited({
                      row: r,
                      column: c,
                      sheetId,
                      value: val,
                      formula,
                    });
                  }
                }
              }
            } else if (params.cellValue) {
              for (const [rStr, cols] of Object.entries(params.cellValue)) {
                const r = Number(rStr);
                if (cols && typeof cols === 'object') {
                  for (const [cStr, cell] of Object.entries(cols as any)) {
                    const c = Number(cStr);
                    const cellObj = cell as any;
                    options.onCellEdited({
                      row: r,
                      column: c,
                      sheetId,
                      value: cellObj?.v !== undefined ? cellObj.v : cellObj,
                      formula: cellObj?.f,
                    });
                  }
                }
              }
            }
          } catch (err) {
            console.warn('[UniverDesignerEvents] 处理 set-range-values 异常:', err);
          }
        }
      });
      if (d?.dispose) disposers.push(() => d.dispose());
    }

    // 2. 单元格双击与高级编辑拦截 (BeforeSheetEditStart)
    const handleBeforeSheetEditStart = (editEvent: any) => {
      if (!editEvent) return;

      const row = editEvent.row ?? 0;
      const column = editEvent.column ?? 0;
      const sheetId = editEvent.worksheet?.getSheetId?.() || editEvent.sheetId;

      // 已安装 Univer 1.0.4 中 DeviceInputEventType.Dblclick = 3。
      const isDblclick =
        editEvent.eventType === DBLCLICK_EVENT_TYPE ||
        editEvent.eventType === 'dblclick' ||
        editEvent.inputEvent?.type === 'dblclick';

      if (isDblclick && options.onDoubleClicked) {
        // 阻止原生行内文本编辑器弹出
        if (typeof editEvent.cancel === 'function') {
          editEvent.cancel();
        } else editEvent.cancel = true;

        // 仅触发一次打开高级属性
        options.onDoubleClicked?.({ row, column, sheetId });
      }
    };

    if (api.Event?.BeforeSheetEditStart && typeof api.addEvent === 'function') {
      const d = api.addEvent(api.Event.BeforeSheetEditStart, handleBeforeSheetEditStart);
      if (d?.dispose) disposers.push(() => d.dispose());
    }
  } catch (err) {
    console.warn('[UniverDesignerEvents] 注册事件桥接出现警告:', err);
  }

  return () => {
    for (const d of disposers) {
      try {
        d();
      } catch {}
    }
  };
}
