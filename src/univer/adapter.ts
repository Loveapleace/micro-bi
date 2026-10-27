/**
 * Univer 实例生命周期与环境适配器 (adapter.ts)
 * 遵循 Section 15:
 * 1. 严格的 SSR / Node.js 保护，杜绝无 DOM 环境自动实例化
 * 2. 封装 createUniver 与 UniverSheetsCorePreset 注册
 * 3. 异步公式计算稳定判定 (waitForFormulaSettled)
 * 4. 实例与事件完整释放清理 (dispose)
 */
import { LocaleType, CommandType, CellValueType, InterceptorEffectEnum, ICommandService, IUndoRedoService, IContextService, IUniverInstanceService,
  EDITOR_ACTIVATED, FOCUSING_SHEET, type IWorkbookData, type Univer } from '@univerjs/core';
import { createUniver } from '@univerjs/presets';
import { UniverSheetsCorePreset } from '@univerjs/preset-sheets-core';
import zhCN from '@univerjs/preset-sheets-core/lib/es/locales/zh-CN.js';
import { INTERCEPTOR_POINT, SheetInterceptorService } from '@univerjs/sheets';

export type FUniver = ReturnType<typeof createUniver>['univerAPI'];
const instances = new WeakMap<FUniver, Univer>();

export function univerSelectionTsv(api: FUniver, mode:'display'|'raw'): string {
  const workbook=api.getActiveWorkbook(),sheet=workbook?.getActiveSheet();
  const range=sheet?.getSelection()?.getActiveRange()?.getRange();
  if(!sheet||!range)return '';
  const snapshot=workbook?.save().sheets[sheet.getSheetId()];
  const quote=(v:unknown)=>{const text=String(v??'');return /[\t\r\n"]/.test(text)?'"'+text.replace(/"/g,'""')+'"':text;};
  const lines:string[]=[];
  for(let r=range.startRow;r<=range.endRow;r++){
    const row:string[]=[];for(let c=range.startColumn;c<=range.endColumn;c++)row.push(quote(mode==='display'?sheet.getRange(r,c).getDisplayValue():snapshot?.cellData?.[r]?.[c]?.v));
    lines.push(row.join('\t'));
  }
  return lines.join('\r\n');
}

/** 用SDK公共历史服务注册源快照mutation，原生工具栏与Ctrl+Z/Y共用同一栈。 */
export function bindSourceHistory(api: FUniver, source: { readonly count: number; readonly index: number; moveTo(index: number): boolean }):
  { sync: () => void; dispose: () => void } | undefined {
  const instance = instances.get(api);
  const unitId = api.getActiveWorkbook()?.getId();
  if (!instance || !unitId) return undefined;
  const injector = instance.__getInjector();
  const commands = injector.get(ICommandService), history = injector.get(IUndoRedoService);
  const context = injector.get(IContextService), units = injector.get(IUniverInstanceService);
  const id = 'micro-bi.mutation.restore-hybrid-source';
  const registration = commands.registerCommand({ id, type: CommandType.MUTATION,
    handler: (_accessor: unknown, params: any) => source.moveTo(params.index) });
  return {
    sync: () => {
      history.clearUndoRedo(unitId);
      for (let i = 0; i < source.count; i++) history.pushUndoRedo({ unitID: unitId,
        undoMutations: [{ id, params: { index: i } }], redoMutations: [{ id, params: { index: i + 1 } }] });
      if (!source.count || source.index >= source.count) return;
      // pop操作按焦点取栈；同步期间暂用当前工作簿，随后恢复编辑器/焦点上下文。
      const focused = units.getFocusedUnit()?.getUnitId() ?? null;
      const editing = context.getContextValue(EDITOR_ACTIVATED), sheet = context.getContextValue(FOCUSING_SHEET);
      try {
        context.setContextValue(EDITOR_ACTIVATED, false); context.setContextValue(FOCUSING_SHEET, true);
        if (focused !== unitId) units.focusUnit(unitId);
        for (let i = source.count; i > Math.max(0, source.index); i--) history.popUndoToRedo();
      } finally {
        if (focused !== unitId) units.focusUnit(focused);
        context.setContextValue(EDITOR_ACTIVATED, editing); context.setContextValue(FOCUSING_SHEET, sheet);
      }
    },
    dispose: () => registration.dispose(),
  };
}

export const isBrowser =
  typeof window !== 'undefined' &&
  typeof document !== 'undefined' &&
  typeof window.document?.createElement === 'function';

export interface UniverInstanceBundle {
  univer: Univer;
  univerAPI: FUniver;
  dispose: () => void;
}

export function initUniver(
  container: HTMLElement,
  options: {
    initialSnapshot?: Partial<IWorkbookData> | undefined;
  } = {}
): UniverInstanceBundle | null {
  if (!isBrowser) {
    console.warn('[UniverAdapter] 当前处于非浏览器或 SSR 环境，跳过 Univer 初始化');
    return null;
  }

  try {
    const { univer, univerAPI } = createUniver({
      locale: LocaleType.ZH_CN,
      locales: {
        [LocaleType.ZH_CN]: zhCN as any,
      },
      presets: [
        UniverSheetsCorePreset({
          container,
          header: true,
        }),
      ],
    });

    // 如果传入了初始工作簿快照，创建工作簿
    if (options.initialSnapshot) {
      univerAPI.createWorkbook(options.initialSnapshot);
    }
    // 与SDK数值格式相同的只读呈现投影。工作簿v/f、公式依赖及save快照保持原始类型。
    const display = options.initialSnapshot ? univer.__getInjector().get(SheetInterceptorService).intercept(INTERCEPTOR_POINT.CELL_CONTENT, {
      effect: InterceptorEffectEnum.Value | InterceptorEffectEnum.Style,
      priority: 2000,
      handler: (cell: any, location: any, next: any) => {
        const rendered = next(cell);
        const raw = location.rawData;
        const meta = raw?.custom;
        if (!meta?.biProjection || typeof meta.displayText !== 'string' || !Object.is(raw.v ?? null, meta.originalValue ?? null)) return rendered;
        if(meta.displaySource!=='conditional'&&meta.displayText===String(raw.v??''))return rendered;
        return { ...rendered, v: meta.displayText, t: CellValueType.FORCE_STRING, p: null };
      },
    }) : undefined;

    instances.set(univerAPI, univer);

    const dispose = () => {
      instances.delete(univerAPI);
      display?.dispose();
      try {
        univer.dispose();
      } catch (err) {
        console.warn('[UniverAdapter] 释放实例出现警告:', err);
      }
    };

    return {
      univer,
      univerAPI,
      dispose,
    };
  } catch (error) {
    console.error('[UniverAdapter] 初始化 Univer 失败:', error);
    return null;
  }
}

/**
 * 等待公式引擎计算完成并落地至单元格 (MBI-09)
 * 优先监听公式引擎 onCalculationResultApplied 事件，并提供安全超时保护
 */
export async function waitForFormulaSettled(
  univerAPI?: FUniver,
  timeoutMs = 300
): Promise<void> {
  if (!univerAPI) return;

  try {
    const formulaApi = (univerAPI as any).getFormula?.();
    if (formulaApi && typeof formulaApi.onCalculationResultApplied === 'function') {
      return await new Promise<void>((resolve) => {
        let resolved = false;
        const timer = setTimeout(() => {
          if (!resolved) {
            resolved = true;
            resolve();
          }
        }, timeoutMs);

        try {
          const res = formulaApi.onCalculationResultApplied(() => {
            if (!resolved) {
              resolved = true;
              clearTimeout(timer);
              resolve();
            }
          });
          if (res && typeof res.then === 'function') {
            res
              .then(() => {
                if (!resolved) {
                  resolved = true;
                  clearTimeout(timer);
                  resolve();
                }
              })
              .catch(() => {
                if (!resolved) {
                  resolved = true;
                  clearTimeout(timer);
                  resolve();
                }
              });
          }
        } catch {
          // 若注册失败直接回退定时器
        }
      });
    }
  } catch {
    // fallback
  }

  return new Promise((resolve) => {
    setTimeout(resolve, Math.min(timeoutMs, 150));
  });
}
