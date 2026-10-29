/**
 * Univer 实例生命周期与环境适配器 (adapter.ts)
 * 遵循 Section 15:
 * 1. 严格的 SSR / Node.js 保护，杜绝无 DOM 环境自动实例化
 * 2. 封装 createUniver 与 UniverSheetsCorePreset 注册
 * 3. 异步公式计算稳定判定 (waitForFormulaSettled)
 * 4. 实例与事件完整释放清理 (dispose)
 */
import { LocaleType, CommandType, CellValueType, InterceptorEffectEnum, ICommandService, IUndoRedoService, IContextService, IUniverInstanceService,
  EDITOR_ACTIVATED, FOCUSING_SHEET, LifecycleService, LifecycleStages, type IWorkbookData, type Univer } from '@univerjs/core';
import { createUniver } from '@univerjs/presets';
import { UniverSheetsCorePreset, IMenuManagerService, RibbonPosition, type MenuSchemaType, type IMenuSchema } from '@univerjs/preset-sheets-core';
import zhCN from '@univerjs/preset-sheets-core/lib/es/locales/zh-CN.js';
import { INTERCEPTOR_POINT, SheetInterceptorService } from '@univerjs/sheets';
import { EditorSession, EditorSessionClosedError, readyAfterRender, waitForOwnedEvent } from './lifecycle.js';

export type FUniver = ReturnType<typeof createUniver>['univerAPI'];
const instances = new WeakMap<FUniver, {univer:Univer;session:EditorSession;ready:Promise<boolean>}>();
const closedInstances=new WeakSet<FUniver>();
const REPORT_TOOLBAR_MENU = {
  'sheet.command.set-text-rotation':{hidden:true},
  'sheet.command.set-shrink-to-fit':{hidden:true},
};
function restrictWrapMenu(univer:Univer):void{
  const manager=univer.__getInjector().get(IMenuManagerService);
  const visit=(nodes:IMenuSchema[],path:string[])=>{
    for(const node of nodes){
      const next=[...path,node.key],item=node.item;
      if(item?.id==='sheet.command.set-text-wrap'&&'selections' in item&&Array.isArray(item.selections)){
        const replacement={...item,selections:item.selections.filter(s=>s.value!==1)};
        let schema:MenuSchemaType={menuItemFactory:()=>replacement};
        for(const key of [...next].reverse())schema={[key]:schema};
        manager.mergeMenu(schema);return true;
      }
      if(node.children&&visit(node.children,next))return true;
    }return false;
  };
  visit(manager.getMenuByPositionKey(RibbonPosition.START),[RibbonPosition.START]);
}

export function univerSelectionTsv(api: FUniver, mode:'display'|'raw'): string {
  if(closedInstances.has(api))return '';
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
  const owner = instances.get(api);
  if(!owner?.session.ready)return undefined;
  const instance=owner?.univer;
  const unitId = api.getActiveWorkbook()?.getId();
  if (!instance || !unitId) return undefined;
  const injector = instance.__getInjector();
  const commands = injector.get(ICommandService), history = injector.get(IUndoRedoService);
  const context = injector.get(IContextService), units = injector.get(IUniverInstanceService);
  const id = 'micro-bi.mutation.restore-hybrid-source';
  const registration = commands.registerCommand({ id, type: CommandType.MUTATION,
    handler: (_accessor: unknown, params: any) => owner?.session.ready?source.moveTo(params.index):false });
  let closed=false;
  return {
    sync: () => {
      if(closed||!owner?.session.ready||commands.disposed())return;
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
    dispose: () => {if(closed)return;closed=true;registration.dispose();},
  };
}

export const isBrowser =
  typeof window !== 'undefined' &&
  typeof document !== 'undefined' &&
  typeof window.document?.createElement === 'function';

export interface UniverInstanceBundle {
  univer: Univer;
  univerAPI: FUniver;
  session:EditorSession;
  ready:Promise<boolean>;
  beginDispose:()=>void;
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
          disableAutoFocus:true,
          menu:REPORT_TOOLBAR_MENU,
        }),
      ],
    });

    // 如果传入了初始工作簿快照，创建工作簿
    if (options.initialSnapshot) {
      univerAPI.createWorkbook(options.initialSnapshot);
    }
    restrictWrapMenu(univer);
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

    const session=new EditorSession();
    // Ready阶段尚未注册滚动/缩放等渲染控制器；onStage返回后再发布可交互状态。
    const ready=readyAfterRender(session,univer.__getInjector().get(LifecycleService).onStage(LifecycleStages.Rendered));
    instances.set(univerAPI,{univer,session,ready});
    const commandGate=univerAPI.addEvent(univerAPI.Event.BeforeCommandExecute,(event:{id:string;cancel?:boolean})=>{
      if(!session.allowsCommand(event.id))event.cancel=true;
    });
    let disposed=false;

    const dispose = () => {
      if(disposed)return;disposed=true;closedInstances.add(univerAPI);session.close();
      instances.delete(univerAPI);
      try {
        display?.dispose();
        univer.dispose();
      } finally {
        commandGate.dispose();session.dispose();
      }
    };

    return {
      univer,
      univerAPI,
      session,
      ready,
      beginDispose:()=>{closedInstances.add(univerAPI);session.close();},
      dispose,
    };
  } catch (error) {
    console.error('[UniverAdapter] 初始化 Univer 失败:', error);
    return null;
  }
}

/**
 * 等待公式引擎计算完成并落地至单元格 (MBI-09)
 * 使用可释放的calculationResultApplied订阅，并提供超时与会话取消保护。
 */
export async function waitForFormulaSettled(
  univerAPI?: FUniver,
  timeoutMs = 300
): Promise<void> {
  if (!univerAPI) return;
  if(closedInstances.has(univerAPI))throw new EditorSessionClosedError();
  const owner=instances.get(univerAPI);
  if(owner){await owner.session.wait(owner.ready);owner.session.assertActive();}
  const formulaApi=univerAPI.getFormula?.();
  // 当前SDK的onCalculationResultApplied参数是timeout，不是callback。
  // 使用可释放的结果订阅，关闭/通知/超时都立即取消监听和定时器。
  const register=formulaApi?((done:()=>void)=>formulaApi.calculationResultApplied(done)):undefined;
  await waitForOwnedEvent(register,register?timeoutMs:Math.min(timeoutMs,150),owner?.session.signal);
  owner?.session.assertActive();
}
