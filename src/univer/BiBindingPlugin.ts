/**
 * Univer 业务语义绑定与结构变动插件 (BiBindingPlugin.ts)
 * 遵循 Section 8, 9, 13:
 * 1. 拦截 Univer 工作表结构变更命令（行列插入/删除/移动）并按工作表隔离平移 ReportBinding 逻辑坐标 (MBI-04)
 * 2. 监听单元格修改事件（SetRangeValuesCommand），命中业务单元格时标记 manual-override 并保留人工输入
 * 3. 采用不可变状态更新产生下一份绑定，杜绝直接修改外部对象
 */
import type { ReportBinding, SheetId } from '../report/types.js';
import type { FUniver } from './adapter.js';

export interface BiBindingManagerOptions {
  bindings?: ReportBinding[] | undefined;
  onBindingsChange?: ((bindings: ReportBinding[]) => void) | undefined;
  onManualOverride?: ((bindingId: string, override: { v?: unknown; f?: string }) => void) | undefined;
}

export class BiBindingManager {
  public static isProgrammaticWrite = false;
  private _bindings: ReportBinding[] = [];
  private _onBindingsChange?: ((bindings: ReportBinding[]) => void) | undefined;
  private _onManualOverride?: ((bindingId: string, override: { v?: unknown; f?: string }) => void) | undefined;
  private _disposers: Array<() => void> = [];

  constructor(options: BiBindingManagerOptions = {}) {
    this._bindings = options.bindings ? [...options.bindings] : [];
    this._onBindingsChange = options.onBindingsChange;
    this._onManualOverride = options.onManualOverride;
  }

  public setBindings(bindings: ReportBinding[]): void {
    this._bindings = [...bindings];
  }

  public getBindings(): ReportBinding[] {
    return [...this._bindings];
  }

  /**
   * 挂载至 Univer Facade API 并监听命令总线 (支持 addEvent 与 onCommandExecuted)
   */
  public attach(univerAPI: FUniver): void {
    this.dispose();

    try {
      const handler = (event: any) => {
        if (BiBindingManager.isProgrammaticWrite || (univerAPI as any)?.__isProgrammaticWrite) return;
        this._handleCommand(event);
      };

      if (typeof (univerAPI as any).addEvent === 'function' && (univerAPI as any).Event?.CommandExecuted) {
        const disposable = (univerAPI as any).addEvent((univerAPI as any).Event.CommandExecuted, handler);
        if (disposable && typeof disposable.dispose === 'function') {
          this._disposers.push(() => disposable.dispose());
        }
      } else if (typeof (univerAPI as any).onCommandExecuted === 'function') {
        const disposable = (univerAPI as any).onCommandExecuted(handler);
        if (typeof disposable === 'function') {
          this._disposers.push(disposable);
        } else if (disposable && typeof disposable.dispose === 'function') {
          this._disposers.push(() => disposable.dispose());
        }
      }
    } catch (e) {
      console.warn('[BiBindingManager] 注册 CommandExecuted 监听失败:', e);
    }
  }

  public dispose(): void {
    for (const d of this._disposers) {
      try {
        d();
      } catch {
        // ignore
      }
    }
    this._disposers = [];
  }

  private _handleCommand(event: any): void {
    if (!event) return;
    // Univer onCommandExecuted 回调参数既可能直接是 CommandInfo ({ id, params })，也可能包裹在 { commandInfo: { id, params } } (MBI-04)
    const commandInfo = event.commandInfo || event;
    const { id, params } = commandInfo;
    if (!id) return;

    const cmd = String(id).toLowerCase();
    // 忽略 mutation，仅响应真正的 command，避免同一编辑重复触发两次回调 (DT-18)
    if (cmd.includes('mutation')) {
      return;
    }

    const sheetId = params?.subUnitId || params?.sheetId || params?.unitId;

    // 1. 行插入
    if (cmd.includes('insert-row')) {
      const rowIndex = params?.range?.startRow ?? params?.rowIndex ?? 0;
      const count = params?.range ? params.range.endRow - params.range.startRow + 1 : params?.count ?? 1;
      this._shiftRows(sheetId, rowIndex, count);
    }
    // 2. 行删除
    else if (cmd.includes('remove-row') || cmd.includes('delete-row')) {
      const rowIndex = params?.range?.startRow ?? params?.rowIndex ?? 0;
      const count = params?.range ? params.range.endRow - params.range.startRow + 1 : params?.count ?? 1;
      this._removeRows(sheetId, rowIndex, count);
    }
    // 3. 列插入
    else if (cmd.includes('insert-col')) {
      const colIndex = params?.range?.startColumn ?? params?.columnIndex ?? 0;
      const count = params?.range ? params.range.endColumn - params.range.startColumn + 1 : params?.count ?? 1;
      this._shiftCols(sheetId, colIndex, count);
    }
    // 4. 列删除
    else if (cmd.includes('remove-col') || cmd.includes('delete-col')) {
      const colIndex = params?.range?.startColumn ?? params?.columnIndex ?? 0;
      const count = params?.range ? params.range.endColumn - params.range.startColumn + 1 : params?.count ?? 1;
      this._removeCols(sheetId, colIndex, count);
    }
    // 5. 单元格值变动（人工覆盖）
    else if (cmd.includes('set-range-values')) {
      this._checkManualOverride(params);
    }
  }

  private _shiftRows(targetSheetId: string | undefined, startRow: number, count: number): void {
    let changed = false;
    const nextBindings = this._bindings.map((b) => {
      if (targetSheetId && b.target.sheetId && b.target.sheetId !== targetSheetId) {
        return b;
      }
      if (b.target.row >= startRow) {
        changed = true;
        return {
          ...b,
          target: {
            ...b.target,
            row: b.target.row + count,
          },
        };
      }
      return b;
    });

    if (changed) {
      this._bindings = nextBindings;
      this._onBindingsChange?.(nextBindings);
    }
  }

  private _removeRows(targetSheetId: string | undefined, startRow: number, count: number): void {
    const endRow = startRow + count - 1;
    let changed = false;
    const remaining: ReportBinding[] = [];

    for (const b of this._bindings) {
      if (targetSheetId && b.target.sheetId && b.target.sheetId !== targetSheetId) {
        remaining.push(b);
        continue;
      }
      if (b.target.row >= startRow && b.target.row <= endRow) {
        changed = true; // 被删除
      } else if (b.target.row > endRow) {
        changed = true;
        remaining.push({
          ...b,
          target: {
            ...b.target,
            row: b.target.row - count,
          },
        });
      } else {
        remaining.push(b);
      }
    }

    if (changed) {
      this._bindings = remaining;
      this._onBindingsChange?.(this._bindings);
    }
  }

  private _shiftCols(targetSheetId: string | undefined, startCol: number, count: number): void {
    let changed = false;
    const nextBindings = this._bindings.map((b) => {
      if (targetSheetId && b.target.sheetId && b.target.sheetId !== targetSheetId) {
        return b;
      }
      if (b.target.column >= startCol) {
        changed = true;
        return {
          ...b,
          target: {
            ...b.target,
            column: b.target.column + count,
          },
        };
      }
      return b;
    });

    if (changed) {
      this._bindings = nextBindings;
      this._onBindingsChange?.(nextBindings);
    }
  }

  private _removeCols(targetSheetId: string | undefined, startCol: number, count: number): void {
    const endCol = startCol + count - 1;
    let changed = false;
    const remaining: ReportBinding[] = [];

    for (const b of this._bindings) {
      if (targetSheetId && b.target.sheetId && b.target.sheetId !== targetSheetId) {
        remaining.push(b);
        continue;
      }
      if (b.target.column >= startCol && b.target.column <= endCol) {
        changed = true;
      } else if (b.target.column > endCol) {
        changed = true;
        remaining.push({
          ...b,
          target: {
            ...b.target,
            column: b.target.column - count,
          },
        });
      } else {
        remaining.push(b);
      }
    }

    if (changed) {
      this._bindings = remaining;
      this._onBindingsChange?.(this._bindings);
    }
  }

  private _checkManualOverride(params: any): void {
    if (!params) return;
    const sheetId: SheetId = params.subUnitId || params.sheetId || params.unitId || 'sheet-1';

    // 1. Univer command 格式: params.range + params.value (DT-18, RX-14)
    if (params.range && params.value !== undefined) {
      const startRow = params.range.startRow;
      const startCol = params.range.startColumn;
      const endRow = params.range.endRow !== undefined ? params.range.endRow : startRow;
      const endCol = params.range.endColumn !== undefined ? params.range.endColumn : startCol;
      const rawVal = params.value;
      let changed = false;
      const nextBindings = this._bindings.map((b) => {
        if (sheetId && b.target.sheetId && b.target.sheetId !== sheetId) {
          return b;
        }
        if (
          b.target.row < startRow ||
          b.target.row > endRow ||
          b.target.column < startCol ||
          b.target.column > endCol
        ) {
          return b;
        }

        let extracted: { v: any; f?: string } | null = null;
        if (typeof rawVal === 'object' && rawVal !== null && !Array.isArray(rawVal)) {
          const rowObj = rawVal[b.target.row] ?? rawVal[b.target.row - startRow];
          if (rowObj && typeof rowObj === 'object' && !('v' in rawVal) && !('f' in rawVal)) {
            const cell = rowObj[b.target.column] ?? rowObj[b.target.column - startCol];
            if (cell !== undefined) {
              extracted = cell && typeof cell === 'object' ? { v: cell.v, f: cell.f ?? undefined } : { v: cell };
            }
          } else if ('v' in rawVal || 'f' in rawVal) {
            if (b.target.row === startRow && b.target.column === startCol) {
              extracted = { v: rawVal.v, f: rawVal.f ?? undefined };
            }
          }
        } else if (Array.isArray(rawVal)) {
          const relR = b.target.row - startRow;
          const relC = b.target.column - startCol;
          if (relR >= 0 && relR < rawVal.length) {
            const rowArr = rawVal[relR];
            if (Array.isArray(rowArr) && relC >= 0 && relC < rowArr.length) {
              const cell = rowArr[relC];
              extracted = cell && typeof cell === 'object' && ('v' in cell || 'f' in cell)
                ? { v: cell.v, f: cell.f ?? undefined }
                : { v: cell };
            }
          }
        } else if (b.target.row === startRow && b.target.column === startCol) {
          extracted = { v: rawVal };
        }

        if (extracted !== null) {
          changed = true;
          this._onManualOverride?.(b.id, extracted);
          return {
            ...b,
            state: 'manual-override' as const,
          };
        }
        return b;
      });

      if (changed) {
        this._bindings = nextBindings;
        this._onBindingsChange?.(nextBindings);
      }
      return;
    }

    // 2. 兼容批量或 matrix 格式: params.cellValue
    if (params.cellValue) {
      let changed = false;
      const nextBindings = this._bindings.map((b) => {
        if (sheetId && b.target.sheetId && b.target.sheetId !== sheetId) {
          return b;
        }
        const rowVal = params.cellValue[b.target.row];
        if (rowVal && typeof rowVal === 'object') {
          const rawCell = rowVal[b.target.column];
          if (rawCell !== undefined) {
            changed = true;
            this._onManualOverride?.(b.id, {
              v: rawCell?.v,
              f: rawCell?.f,
            });
            return {
              ...b,
              state: 'manual-override' as const,
            };
          }
        }
        return b;
      });

      if (changed) {
        this._bindings = nextBindings;
        this._onBindingsChange?.(nextBindings);
      }
    }
  }
}
