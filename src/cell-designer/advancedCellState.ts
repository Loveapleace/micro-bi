import type { AdvancedCellUpdate, CellDefinition, CellFormatOptions, CellMergePolicyKind, CellTemplateDocumentV1, PresentationRules, StaticSpanConfig, StyleRule, VisualStyleAction } from '../report-template/types.js';
import { getCellCapabilities, type CapabilityContext } from '../report-template/cellCapabilities.js';
import { emptyPresentationRules, targetForCell } from '../report-template/presentationTypes.js';
import { validatePresentationRules, visualStyleForCell } from '../report-template/presentationRules.js';
import type { DrillRule } from '../report/drillTypes.js';
import { drillRuleMatchesCell, drillSourceIdentity } from '../report/drill.js';

export interface AdvancedCellDraft {
  format: CellFormatOptions;
  text: string;
  operation: string | undefined;
  mergePolicy: CellMergePolicyKind;
  staticSpan: StaticSpanConfig;
  style: VisualStyleAction;
  rowStyleEnabled:boolean;
  rules: PresentationRules;
  drill: DrillRule;
  dirtyFormat: (keyof CellFormatOptions)[];
  dirty: Partial<Record<'text' | 'operation' | 'mergePolicy' | 'staticSpan' | 'style' | 'rowStyleEnabled' | 'rules' | 'drill', boolean>>;
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
/** 面板和高级配置共用；同字段维度保持group，派生总计继承指标口径并保留外观。 */
export function changeMetricAggregation(doc: CellTemplateDocumentV1, fieldKey: string, operation: string, context: CapabilityContext = {}): CellTemplateDocumentV1 {
  const source=doc.cells.find(c=>c.content.kind==='field'&&c.content.fieldKey===fieldKey&&c.content.role==='measure'&&!c.id.startsWith('meas-rowtotal-'));
  if(!source||!getCellCapabilities(source,context).aggregations.includes(operation as any))throw new Error('当前指标来源不支持此聚合方式');
  const changed=new Map<string,CellDefinition>();
  const cells=doc.cells.map(c=>{
    if(c.content.kind!=='field'||c.content.fieldKey!==fieldKey||!['measure','total'].includes(c.content.role)||c.content.operation===operation)return c;
    changed.set(c.id,c);return {...c,content:{...c.content,operation:operation as any}};
  });
  const rebind=(target:any)=>{
    const old=target&&changed.get(target.cellId);
    return old&&target.kind!=='field'&&(!target.operation||target.operation===(old.content as any).operation)?{...target,operation}:target;
  };
  const styles=doc.styleRules.map(r=>({...r,target:rebind(r.target)}));
  const rules=doc.presentationRules||emptyPresentationRules();
  const sets=rules.ruleSets.map(s=>({...s,target:rebind(s.target)}));
  return {...doc,cells,styleRules:same(styles,doc.styleRules)?doc.styleRules:styles,presentationRules:same(sets,rules.ruleSets)?rules:{...rules,revision:rules.revision+1,ruleSets:sets}};
}
export function cellFormatOptions(cell: CellDefinition): CellFormatOptions {
  const c = cell.content as any;
  const options = { ...(c.formatOptions || cell.formatOptions || {}) };
  for (const key of ['numberFormat','format','precision','useGrouping','scale','prefix','suffix','negativeFormat','emptyDisplay','zeroDisplay','dateFormat','tooltip'] as const)
    if (!(key in options) && c[key] !== undefined) options[key] = c[key];
  return options;
}
export function createAdvancedCellDraft(doc: CellTemplateDocumentV1, cell: CellDefinition): AdvancedCellDraft {
  const normal = visualStyleForCell(doc,cell,'row');
  const area = doc.layoutRules.find(r=>r.sheetId===cell.sheetId&&r.kind==='merge'&&r.range?.startRow===cell.position.row&&r.range.startColumn===cell.position.column)?.range;
  const policy = doc.mergeConfig?.policies.find(p=>p.target.kind==='template-cell'&&p.target.templateCellId===cell.id);
  return {
    format: structuredClone(cellFormatOptions(cell)), text: cell.content.kind==='literal'?String(cell.content.value??''):'', operation:(cell.content as any).operation,
    mergePolicy: cell.mergePolicy || (cell.content as any).mergePolicy || (cellFormatOptions(cell) as any).mergePolicy || (policy ? !policy.enabled?'none':policy.kind==='group-span'?'group-span':policy.kind==='adjacent-equal'?'adjacent-equal':'default' : 'default'),
    staticSpan: structuredClone(cell.staticSpan || {id:`span-${cell.id}`,enabled:false,regionId:cell.regionId||doc.regions.find(r=>r.sheetId===cell.sheetId)?.id||'',scope:'report',placement:'template',repeat:'once',rowOffset:0,height:area?area.endRow-area.startRow+1:1,includeTotals:true,merge:true,suppressions:[],templateRange:area}),
    style: {scope:'row',regionId:normal?.regionId,presetId:normal?.presetId,style:structuredClone(normal?.style||{}),reset:normal?.reset,noFill:normal?.noFill,rowColumns:normal?.rowColumns},
    rowStyleEnabled:Boolean(normal&&normal.enabled!==false),
    rules: structuredClone(doc.presentationRules||emptyPresentationRules()), dirtyFormat:[],dirty:{},
    drill: structuredClone(doc.drillRules?.find(r=>drillRuleMatchesCell(r,cell))||{cellId:cell.id,sheetId:cell.sheetId,field:cell.content.kind==='field'?cell.content.fieldKey:undefined,semanticKey:drillSourceIdentity(cell),datasetId:doc.regions.find(r=>r.id===cell.regionId)?.datasetId,enabled:false,columns:[],pageSize:50}),
  };
}

/** 只提交实际编辑；未打开的格式、样式、取消合并意图和静态元数据不会被默认值覆盖。 */
export function buildAdvancedCellUpdate(doc: CellTemplateDocumentV1, cell: CellDefinition, draft: AdvancedCellDraft, context: CapabilityContext = {}): AdvancedCellUpdate {
  const initial = createAdvancedCellDraft(doc,cell);
  const update: AdvancedCellUpdate = {};
  let content = cell.content as any;
  const patchContent = (patch: object) => { content={...content,...patch};update.content=content; };
  const keys = draft.dirtyFormat.filter(k=>!same(draft.format[k],initial.format[k]));
  if(keys.length){
    const format={...initial.format};
    for(const key of keys)(format as any)[key]=draft.format[key];
    update.formatOptions=format;patchContent({formatOptions:format});
  }
  if(draft.dirty.text && draft.text!==initial.text){patchContent({value:draft.text});update.literalOverride=cell.literalOverride||Boolean(cell.panelOwner);}
  if(draft.dirty.operation && draft.operation!==initial.operation)patchContent({operation:draft.operation});
  if(draft.dirty.mergePolicy && draft.mergePolicy!==initial.mergePolicy){
    update.mergePolicy=draft.mergePolicy;patchContent({mergePolicy:draft.mergePolicy});
  }
  if(draft.dirty.staticSpan && !same(draft.staticSpan,initial.staticSpan))update.staticSpan={...draft.staticSpan,templateRange:{startRow:cell.position.row,startColumn:cell.position.column,endRow:cell.position.row+draft.staticSpan.height-1,endColumn:Math.max(cell.position.column,draft.staticSpan.templateRange?.endColumn??cell.position.column)}};
  const rowStyleChanged=draft.dirty.style&&!same(draft.style,initial.style)||draft.dirty.rowStyleEnabled&&draft.rowStyleEnabled!==initial.rowStyleEnabled;
  if(rowStyleChanged){
    if(!getCellCapabilities(cell,context).canStyleRow)throw new Error('此单元格的样式请使用 Excel 工具栏调整');
    const normal=visualStyleForCell(doc,cell,'row'),a=draft.style;
    if(a.scope!=='row')throw new Error('普通单元格样式请使用 Excel 工具栏调整');
    const rule:StyleRule={id:normal?.id||`row-style-${cell.id}`,sheetId:cell.sheetId,targetId:cell.id,target:targetForCell(cell),scope:'row',enabled:draft.rowStyleEnabled,style:structuredClone(a.style),priority:normal?.priority??doc.styleRules.length,
      regionId:a.regionId||cell.regionId||doc.regions.find(r=>r.sheetId===cell.sheetId)?.id,presetId:a.presetId,reset:a.reset,noFill:a.noFill,rowColumns:a.rowColumns};
    update.visualStyleRules=[...doc.styleRules.filter(r=>r.id!==rule.id),rule];
  }
  if(draft.dirty.rules && !same(draft.rules,initial.rules))update.presentationRules={...draft.rules,revision:draft.rules.revision+1};
  if(draft.dirty.drill&&!same(draft.drill,initial.drill))update.drillRules=[...(doc.drillRules||[]).filter(r=>!drillRuleMatchesCell(r,cell)),{...draft.drill,cellId:cell.id,sheetId:cell.sheetId}];
  // 显式修改聚合是同一源的口径编辑，已有自身规则随新口径重新绑定，其他源保持原身份。
  if(draft.dirty.operation && draft.operation!==initial.operation){
    const rebind=(target:any)=>target?.cellId===cell.id&&target.kind!=='field'?{...target,operation:draft.operation}:target;
    const styles=update.visualStyleRules||doc.styleRules;
    const nextStyles=styles.map(r=>({...r,target:rebind(r.target)}));
    if(!same(styles,nextStyles))update.visualStyleRules=nextStyles;
    const rules=update.presentationRules||doc.presentationRules||emptyPresentationRules();
    const nextRules={...rules,ruleSets:rules.ruleSets.map(s=>({...s,target:rebind(s.target)}))};
    if(!same(rules,nextRules))update.presentationRules={...nextRules,revision:update.presentationRules?.revision??rules.revision+1};
  }
  return validateAdvancedCellUpdate(doc,cell,update,context);
}

/** UI和实际源提交共用同一权限检查；不能通过隐藏控件或构造更新修改绑定/父格/公式。 */
export function validateAdvancedCellUpdate(doc: CellTemplateDocumentV1, cell: CellDefinition, update: AdvancedCellUpdate, context: CapabilityContext = {}): AdvancedCellUpdate {
  const cap=getCellCapabilities(cell,context),base=cellFormatOptions(cell),incoming=update.content as any,original=cell.content as any;
  if(update.drillRules&&!same(update.drillRules,doc.drillRules)){
    if(!cap.canDrill)throw new Error('此单元格不支持自动明细下钻');
    const others=(rules:DrillRule[])=>rules.filter(r=>!drillRuleMatchesCell(r,cell));
    if(!same(others(update.drillRules),others(doc.drillRules||[])))throw new Error('只能修改当前源格的明细下钻');
    const rule=update.drillRules.find(r=>drillRuleMatchesCell(r,cell));
    if(rule&&(!Number.isInteger(rule.pageSize)||rule.pageSize<1||rule.pageSize>100||!Array.isArray(rule.columns)||rule.columns.some(k=>context.fields&&!context.fields.some(f=>f.key===k))))throw new Error('明细字段或分页条数无效');
  }
  if('style' in update&&!same(update.style,cell.style))throw new Error('普通单元格样式请使用 Excel 工具栏调整');
  if(update.visualStyleRules&&!same(update.visualStyleRules,doc.styleRules)){
    if(!cap.canStyleRow)throw new Error('此单元格的样式请使用 Excel 工具栏调整');
    // 改口径只允许原样保留普通样式并重绑自身口径；不能借此增删工具栏样式。
    const aggregationChanged=cap.canEditAggregation&&incoming?.operation!==undefined&&incoming.operation!==original.operation;
    const normal=(rules:StyleRule[])=>rules.filter(r=>r.scope!=='row').map(r=>({...r,target:aggregationChanged&&r.target?.cellId===cell.id&&r.target.kind!=='field'?{...r.target,operation:incoming.operation}:r.target}));
    if(!same(normal(update.visualStyleRules),normal(doc.styleRules)))throw new Error('普通单元格样式请使用 Excel 工具栏调整');
    const unrelatedRows=(rules:StyleRule[])=>rules.filter(r=>r.scope==='row'&&r.targetId!==cell.id&&r.target?.cellId!==cell.id);
    if(!same(unrelatedRows(update.visualStyleRules),unrelatedRows(doc.styleRules)))throw new Error('高级配置只能修改当前源格的整行样式');
  }
  if(!cap.canEditConditions){
    if(update.presentationRules&&!same(update.presentationRules,doc.presentationRules))throw new Error('此单元格的高级配置不提供条件规则');
  }
  for(const key of ['id','sheetId','regionId','position','parents','panelOwner'] as const)
    if(key in update&&!same(update[key],cell[key]))throw new Error('数据结构由左侧面板维护，不能通过高级配置修改绑定或位置');
  if(incoming)for(const key of Object.keys(incoming)){
    if(same(incoming[key],original[key]))continue;
    if(!['value','operation','format','formatOptions','mergePolicy'].includes(key))throw new Error('字段、公式与展开结构由原配置维护');
    if(key==='value'&&!cap.canEditLiteral)throw new Error('生成的数据内容不能在高级配置中改写');
    if(key==='operation'&&(!cap.canEditAggregation||!cap.aggregations.includes(incoming[key])))throw new Error('当前单元格不支持该聚合方式');
  }
  const format='formatOptions' in update?update.formatOptions||{}:incoming&&'formatOptions' in incoming?incoming.formatOptions||{}:undefined;
  if(format)for(const key of new Set([...Object.keys(base),...Object.keys(format)]) as Set<keyof CellFormatOptions>){
    if(same(format[key],base[key]))continue;
    if(!cap.formatKeys.includes(key))throw new Error(`${cap.label}不支持此显示属性：${key}`);
    if(!cap.advancedFormatKeys.includes(key))throw new Error(`不支持在高级配置中修改${key}，请使用 Excel 工具栏`);
    const value=format[key];
    if(key==='scale'&&value!==undefined&&(typeof value!=='number'||!Number.isFinite(value)||value<=0))throw new Error('显示缩放必须大于0');
    if(key==='emptyDisplay'&&value!==undefined&&typeof value!=='string')throw new Error('空值显示应为文字');
  }
  if(incoming&&'format' in incoming&&!same(incoming.format,original.format))throw new Error('数字格式请使用 Excel 工具栏调整');
  const policy=update.mergePolicy||incoming?.mergePolicy;
  if(policy && policy!==createAdvancedCellDraft(doc,cell).mergePolicy&&!cap.mergePolicies.includes(policy))throw new Error('当前单元格不支持此动态合并方式');
  if('staticSpan' in update&&!same(update.staticSpan,cell.staticSpan)&&!cap.canFollowRange)throw new Error('范围跟随只适用于数据区外的静态内容');
  const next={...doc,styleRules:update.visualStyleRules||doc.styleRules,presentationRules:update.presentationRules||doc.presentationRules,cells:doc.cells.map(c=>c.id===cell.id?{...c,...update,content:incoming||c.content}:c)};
  const errors=validatePresentationRules(next,context.fields?.map(f=>f.key),context).filter(d=>d.severity==='error');
  if(errors.length)throw new Error(errors.map(e=>e.message).join('；'));
  return update;
}
