import type { CellDefinition, CellStyleDefinition, CellTemplateDocumentV1, StyleRule, TemplateDiagnostic } from './types.js';
import type { BiGridCell, BiGridModel, PublishedCellStyle } from '../report/types.js';
import type { PresentationTarget, PresentationRule, RuleOperand, RulePredicate, RuleStatistics, VisualStyleAction } from './presentationTypes.js';
import { emptyPresentationRules } from './presentationTypes.js';
import { decodeMemberValue, parseInstanceKey } from './identity.js';
import { formatTimeBucket } from '../engine/bucketing.js';

const operators = new Set(['gt','gte','lt','lte','eq','ne','between','contains','startsWith','endsWith','in','notIn','empty','notEmpty']);
const key = (c: { row: number; col: number }) => `${c.row}:${c.col}`;
const rangeKey = (r:BiGridModel['merges'][number]) => `${r.startRow}:${r.endRow}:${r.startCol}:${r.endCol}`;
const empty = (v: unknown) => v === null || v === undefined || typeof v === 'string' && !v.trim();
const numeric = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
export function normalizeRuleColor(value: string): string | undefined {
  if(typeof value!=='string')return undefined;
  const text = value.trim();
  if (/^#[\da-f]{6}$/i.test(text)) return text.toUpperCase();
  if (/^#[\da-f]{3}$/i.test(text)) return '#' + [...text.slice(1)].map((c) => c + c).join('').toUpperCase();
  const rgb = /^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/i.exec(text);
  if (rgb && rgb.slice(1).every((n) => +n <= 255)) return '#' + rgb.slice(1).map((n) => (+n).toString(16).padStart(2, '0')).join('').toUpperCase();
  return undefined;
}
export function resolvePresentationTarget(target: PresentationTarget, doc: CellTemplateDocumentV1): CellDefinition[] {
  const sameRegion = (c: CellDefinition) => c.sheetId === target.sheetId && (!target.regionId || c.regionId === target.regionId);
  const family = (role?: string) => role === 'detail-column' || role === 'measure' ? 'data' : role;
  const exact = doc.cells.find((c) => c.id === target.cellId && sameRegion(c));
  if (exact && target.kind !== 'field') return target.field && (exact.content.kind!=='field'||exact.content.fieldKey!==target.field||family(exact.content.role)!==family(target.role)) ? [] : [exact];
  if (!target.field) return [];
  const candidates = doc.cells.filter((c) => sameRegion(c) && c.content.kind === 'field' && c.content.fieldKey === target.field &&
    (target.kind === 'field' || family(c.content.role) === family(target.role)) &&
    (target.kind === 'field' || !c.id.startsWith('meas-rowtotal-')) &&
    (target.kind==='field'||target.role!=='measure'||c.content.role!=='measure'||!target.operation||c.content.operation===target.operation));
  return target.kind === 'field' || candidates.length === 1 ? candidates : [];
}
export function visualStyleForCell(doc:CellTemplateDocumentV1,cell:CellDefinition):StyleRule|undefined {
  return doc.styleRules.filter(r=>['row','template-cell'].includes(r.scope)&&(r.targetId===cell.id||r.target&&resolvePresentationTarget(r.target,doc).some(c=>c.id===cell.id)))
    .sort((a,b)=>(b.scope==='template-cell'?1:0)-(a.scope==='template-cell'?1:0)||b.priority-a.priority||b.id.localeCompare(a.id))[0];
}
export function validatePresentationRules(doc: CellTemplateDocumentV1, fields?: readonly string[]): TemplateDiagnostic[] {
  const out: TemplateDiagnostic[] = [];
  const error = (code: string, message: string, targetId?: string) => out.push({ severity: 'error', code, message, targetId });
  const model = doc.presentationRules || emptyPresentationRules();
  if (model.version !== 1 || !Array.isArray(model.ruleSets) || !Number.isFinite(model.revision)) {
    error('ERR_PRESENTATION_SCHEMA', '条件规则结构不受支持'); return out;
  }
  const ids = new Set<string>();
  let checkReferences = true;
  const fieldSet = new Set([...(fields || []), ...doc.cells.filter(c=>c.content.kind==='field').map(c=>(c.content as any).fieldKey)]);
  const unique = (id: string) => { if (typeof id!=='string'||!id || ids.has(id)) error('ERR_RULE_ID', '规则集和规则ID必须存在且唯一', typeof id==='string'?id:undefined); ids.add(id); };
  const operand = (o: RuleOperand | undefined, id: string) => {
    if (!o || !['current','literal','field','metric'].includes(o.kind)) { error('ERR_RULE_OPERAND','请选择有效的条件来源',id); return; }
    if (checkReferences && o.kind === 'field' && !fieldSet.has(o.field)) error('ERR_RULE_FIELD', `条件字段不存在：${o.field}`, id);
    if (checkReferences && o.kind === 'metric' && !doc.cells.some(c=>(c.content as any).metricId===o.metricId)) error('ERR_RULE_METRIC',`条件指标不存在：${o.metricId}`,id);
    if(o.kind==='current'&&o.basis&&!['value','display-number','text'].includes(o.basis))error('ERR_RULE_BASIS','比较依据无效',id);
    if(o.kind==='field'&&o.agg&&!['sum','avg','min','max','count'].includes(o.agg))error('ERR_RULE_AGG','字段聚合方式无效',id);
    if (o.kind === 'literal' && typeof o.value === 'number' && !Number.isFinite(o.value)) error('ERR_RULE_VALUE','条件数值必须有限',id);
    if(o.kind==='literal'&&o.valueType==='list'&&!Array.isArray(o.value))error('ERR_RULE_LIST','请输入有效JSON值列表',id);
  };
  const predicate = (p: RulePredicate, id: string, depth = 0): void => {
    if (!p || depth > 8) { error('ERR_RULE_TREE','条件树无效或超过8层',id); return; }
    if (p.kind === 'group') {
      if (!['and','or'].includes(p.mode) || !Array.isArray(p.children) || !p.children.length || p.children.length > 50) {error('ERR_RULE_TREE','条件组需包含1～50个条件并选择AND/OR',id);return;}
      p.children.forEach(c=>predicate(c,id,depth+1)); return;
    }
    if (p.kind !== 'comparison' || !operators.has(p.operator)) {error('ERR_RULE_OPERATOR','比较条件无效',id);return;}
    operand(p.left,id);
    if (!['empty','notEmpty'].includes(p.operator)) operand(p.right,id);
    if (p.operator === 'between') operand(p.upper,id);
    if (['gt','gte','lt','lte','between'].includes(p.operator)) {
      for (const o of [p.right,...(p.operator==='between'?[p.upper]:[])]) if(o?.kind==='literal' && !numeric(o.value)) error('ERR_RULE_THRESHOLD','数值比较的阈值必须为数值',id);
      if(p.operator==='between'&&p.right?.kind==='literal'&&p.upper?.kind==='literal'&&numeric(p.right.value)&&numeric(p.upper.value)&&p.right.value>p.upper.value)error('ERR_RULE_RANGE','区间下限不能大于上限',id);
    }
    if (['in','notIn'].includes(p.operator) && p.right?.kind==='literal'&&!Array.isArray(p.right.value)) error('ERR_RULE_LIST','集合条件需要值列表',id);
  };
  const style = (a: VisualStyleAction | undefined, id: string, region?: string) => {
    if(!a)return;
    if(!['cell','row'].includes(a.scope)||!a.style||typeof a.style!=='object')error('ERR_RULE_STYLE','样式动作结构无效',id);
    if(a.presetId&&!['red','orange','green'].includes(a.presetId))error('ERR_RULE_STYLE','样式预设无效',id);
    if(a.noFill!==undefined&&typeof a.noFill!=='boolean'||a.reset!==undefined&&(!Array.isArray(a.reset)||a.reset.some(p=>!['color','backgroundColor','bold','italic'].includes(p))))error('ERR_RULE_STYLE','清除/重置动作无效',id);
    if(a.style?.fontSize!==undefined&&(!numeric(a.style.fontSize)||a.style.fontSize<6||a.style.fontSize>96))error('ERR_RULE_STYLE','字号应在6～96之间',id);
    for(const c of [a.style?.color,a.style?.backgroundColor])if(c!==undefined&&!normalizeRuleColor(c))error('ERR_RULE_COLOR','请选择有效HEX/RGB颜色',id);
    if(a.scope==='row'&&!region&&!a.regionId&&!a.rowColumns)error('ERR_RULE_ROW_RANGE','整行样式需要目标区域或静态列范围',id);
    if(a.regionId&&!doc.regions.some(r=>r.id===a.regionId))error('ERR_RULE_REGION','样式区域不存在',id);
    if(a.rowColumns&&(!Array.isArray(a.rowColumns)||a.rowColumns.length!==2||!a.rowColumns.every(Number.isInteger)||a.rowColumns[0]<0||a.rowColumns[1]<a.rowColumns[0]))error('ERR_RULE_ROW_RANGE','静态整行列范围无效',id);
  };
  for (const set of model.ruleSets) {
    if(!set||typeof set!=='object'){error('ERR_PRESENTATION_SCHEMA','规则集结构无效');continue;}
    unique(set.id);
    if(!set.target||!doc.sheets.some(s=>s.id===set.target.sheetId)||!Array.isArray(set.rules)||!Number.isFinite(set.order)){error('ERR_RULE_TARGET','规则目标或执行顺序无效',set.id);continue;}
    if(set.target.regionId&&!doc.regions.some(r=>r.id===set.target.regionId&&r.sheetId===set.target.sheetId))error('ERR_RULE_REGION','规则目标区域不存在',set.id);
    const sources=resolvePresentationTarget(set.target,doc);
    checkReferences = sources.length > 0;
    if(set.target.kind==='field'&&!set.target.field)error('ERR_RULE_TARGET','同字段目标必须指定字段',set.id);
    if(set.target.roles!==undefined&&(!Array.isArray(set.target.roles)||set.target.roles.some(r=>!['data','total','dimension','header','static'].includes(r))))error('ERR_RULE_ROLE','触发角色无效',set.id);
    if(!sources.length)out.push({severity:'warning',code:'WARN_RULE_DORMANT',message:'目标暂不可用，条件规则已保留并休眠',targetId:set.id});
    for(const r of set.rules){if(!r||typeof r!=='object'){error('ERR_RULE_SCHEMA','规则结构无效',set.id);continue;}unique(r.id);predicate(r.predicate,r.id);style(r.style,r.id,set.target.regionId);
      if(!Number.isFinite(r.order)||typeof r.enabled!=='boolean'||typeof r.stopIfTrue!=='boolean')error('ERR_RULE_SCHEMA','规则顺序/启停/停止标记无效',r.id);
      if(r.text!==undefined){if(typeof r.text!=='string')error('ERR_RULE_TEXT','替换文本必须是字符串',r.id);else for(const t of r.text.matchAll(/\{([^{}]+)\}/g))if(!['value','formatted','fieldLabel','rowLabel','columnLabel'].includes(t[1]!))error('ERR_RULE_TOKEN',`未知文本占位符：${t[1]}`,r.id);}
    }
    style(set.otherwise?.style,set.id,set.target.regionId);
    if(set.otherwise?.text!==undefined&&typeof set.otherwise.text!=='string')error('ERR_RULE_TEXT','默认文本必须为字符串',set.id);
  }
  for(const r of doc.styleRules||[])style({scope:r.scope==='row'?'row':'cell',style:r.style,presetId:r.presetId,noFill:r.noFill,reset:r.reset,rowColumns:r.rowColumns},r.id,r.regionId||doc.cells.find(c=>c.id===r.targetId)?.regionId||(doc.regions.filter(g=>g.sheetId===r.sheetId).length===1?doc.regions.find(g=>g.sheetId===r.sheetId)?.id:undefined));
  return out;
}

/** 只读值上下文求值，动作永不改变value/formula。 */
export function applyPresentationRules(doc: CellTemplateDocumentV1, input: BiGridModel,
  facts: readonly Record<string, any>[] = [], options: { sheetId?: string; conditions?: boolean } = {}): { grid: BiGridModel; diagnostics: TemplateDiagnostic[] } {
  const sheetId=options.sheetId||doc.sheets[0]?.id||'sheet-1';
  const diagnostics:TemplateDiagnostic[]=[];
  const seenDiagnostics=new Set<string>();
  const warn=(code:string,message:string,id:string,severity:'error'|'warning'='warning')=>{const k=code+id;if(!seenDiagnostics.has(k)){seenDiagnostics.add(k);diagnostics.push({severity,code,message,targetId:id,sheetId});}};
  const cells: BiGridCell[] = input.cells.map(c=>({...c,style:{...(c.basePresentationStyle||c.style||{})},basePresentationStyle:{...(c.basePresentationStyle||c.style||{})},
    displayText:c.baseDisplayText!==undefined?c.baseDisplayText:c.displayText,baseDisplayText:c.baseDisplayText!==undefined?c.baseDisplayText:c.displayText,displaySource:'format' as 'format'|'conditional'}));
  const at=new Map(cells.map(c=>[key(c),c]));
  const originByRange=new Map((input.mergeOrigins||[]).map(o=>[rangeKey(o.range),o]));
  const mergeRows=new Map<number,BiGridModel['merges']>();
  for(const m of input.merges)for(let row=m.startRow;row<=m.endRow;row++){const list=mergeRows.get(row)||[];list.push(m);mergeRows.set(row,list);}
  for(const list of mergeRows.values())list.sort((a,b)=>a.startCol-b.startCol);
  const mergeAt=(c:BiGridCell)=>{const list=mergeRows.get(c.row)||[];let lo=0,hi=list.length-1,index=-1;while(lo<=hi){const mid=(lo+hi)>>1;if(list[mid]!.startCol<=c.col){index=mid;lo=mid+1;}else hi=mid-1;}const m=list[index];return m&&c.col<=m.endCol?m:undefined;};
  const bindingAt=new Map(input.bindings.filter(b=>b.target.sheetId===sheetId).map(b=>[`${b.target.row}:${b.target.column}`,b]));
  const byId=new Map(doc.cells.map(c=>[c.id,c]));
  const origin=(c:BiGridCell):CellDefinition|undefined=>{
    if(c.sourceCellId!==undefined)return byId.get(c.sourceCellId);
    const b=bindingAt.get(key(c)) as any;
    return byId.get(c.sourceCellId||b?.templateCellId||parseInstanceKey(b?.instanceKey||'')?.templateCellId||'')||
      doc.cells.find(s=>s.sheetId===sheetId&&s.position.row===c.row&&s.position.column===c.col&&(options.conditions===false||s.content.kind==='literal'&&Object.is(s.content.value,c.value)))||
      doc.cells.find(s=>s.sheetId===sheetId&&c.metricId&&(s.content as any).metricId===c.metricId)||
      doc.cells.find(s=>s.sheetId===sheetId&&s.content.kind==='field'&&s.content.fieldKey===c.field&&
        (c.metricId?s.content.role==='measure':c.rowPath?.length?s.content.role==='row-dimension':s.content.role==='column-dimension'));
  };
  const role=(c:BiGridCell)=>{
    const s=origin(c);
    if(c.role.includes('total')||s?.id.startsWith('meas-rowtotal-')||s?.content.kind==='field'&&s.content.role==='total')return 'total';
    if(s?.content.kind==='field')return s.content.role.endsWith('dimension')?'dimension':'data';
    return s?.content.kind==='literal'?s.id.startsWith('hdr-')?'header':s.id.startsWith('lbl-')?'dimension':'static':'data';
  };
  const cellsBySource=new Map<string,BiGridCell[]>();
  for(const c of cells){const id=origin(c)?.id;if(id){const list=cellsBySource.get(id)||[];list.push(c);cellsBySource.set(id,list);}}
  const region=(c:BiGridCell)=>c.regionId||(bindingAt.get(key(c)) as any)?.regionId||origin(c)?.regionId;
  const bounds=new Map<string,[number,number]>();
  for(const c of cells){const s=origin(c);const r=region(c);if(!r||s?.content.kind!=='field')continue;const b=bounds.get(r);bounds.set(r,b?[Math.min(b[0],c.col),Math.max(b[1],c.col)]:[c.col,c.col]);}
  const merged=(c:BiGridCell)=>{const m=mergeAt(c);return m&&originByRange.get(rangeKey(m))?.origin!=='adjacent-equal'?m:undefined;};
  const contextFacts=(c:BiGridCell):readonly Record<string,any>[]=>{
    if(c.ruleFacts)return c.ruleFacts;
    const paths=[...(c.rowPath||[]),...(c.columnPath||c.colPath||[])];
    return !paths.length?facts:facts.filter(f=>paths.every(p=>{
      const def=doc.cells.find(s=>s.content.kind==='field'&&s.content.fieldKey===p.field&&(s.content as any).timeBucket);
      const bucket=def?.content.kind==='field'?def.content.timeBucket:undefined;
      const val=bucket?formatTimeBucket(f[p.field],{field:p.field,...bucket}):f[p.field];
      const expected=decodeMemberValue(p.memberKey);
      return Object.is(val,expected)||String(val)===p.label||String(val)===String(expected);
    }));
  };
  const getOperand=(o:RuleOperand|undefined,c:BiGridCell):unknown=>{
    if(!o)return undefined;
    if(o.kind==='literal')return o.value;
    if(o.kind==='current'){
      if(o.basis==='text')return c.baseDisplayText??String(c.value??'');
      if(o.basis==='display-number'&&numeric(c.value)){const s=origin(c);const f=(s as any)?.formatOptions||(s?.content as any)?.formatOptions||{};return c.value/(f.scale||1)*(['percent','percentage'].includes(f.format||(s?.content as any)?.format)?100:1);}
      return c.value;
    }
    if(o.kind==='metric'){
      const same=(a:any,b:any)=>JSON.stringify(a||[])===JSON.stringify(b||[]);
      const target=cells.filter(t=>t.metricId===o.metricId&&region(t)===region(c)&&same(t.rowPath,c.rowPath)&&same(t.columnPath||t.colPath,c.columnPath||c.colPath));
      if(target.length!==1)throw new Error('同切片指标引用不唯一或不存在');return target[0]!.value;
    }
    const rows=contextFacts(c);
    if(!o.agg){if(rows.length>1)throw new Error(`字段${o.field}有多条事实，请指定聚合方式`);return rows[0]?.[o.field]??null;}
    if(o.agg==='count')return rows.length;
    const nums=rows.map(r=>r[o.field]).filter(numeric);if(!nums.length)return o.agg==='sum'?0:null;
    if(o.agg==='sum')return nums.reduce((a,b)=>a+b,0);
    if(o.agg==='avg')return nums.reduce((a,b)=>a+b,0)/nums.length;
    return nums.reduce((a,b)=>o.agg==='min'?Math.min(a,b):Math.max(a,b));
  };
  const test=(p:RulePredicate,c:BiGridCell):boolean=>{
    if(p.kind==='group')return p.mode==='and'?p.children.every(x=>test(x,c)):p.children.some(x=>test(x,c));
    const l=getOperand(p.left,c),r=getOperand(p.right,c);
    switch(p.operator){
      case'empty':return empty(l);case'notEmpty':return !empty(l);case'eq':return Object.is(l,r);case'ne':return !Object.is(l,r);
      case'in':return Array.isArray(r)&&r.some(x=>Object.is(x,l));case'notIn':return Array.isArray(r)&&!r.some(x=>Object.is(x,l));
      case'contains':return typeof l==='string'&&typeof r==='string'&&l.includes(r);
      case'startsWith':return typeof l==='string'&&typeof r==='string'&&l.startsWith(r);
      case'endsWith':return typeof l==='string'&&typeof r==='string'&&l.endsWith(r);
    }
    if(!numeric(l)||!numeric(r))return false;
    if(p.operator==='gt')return l>r;if(p.operator==='gte')return l>=r;if(p.operator==='lt')return l<r;if(p.operator==='lte')return l<=r;
    const upper=getOperand(p.upper,c);return p.operator==='between'&&numeric(upper)&&l>=r&&l<=upper;
  };
  const template=(text:string,c:BiGridCell)=>{
    const s=origin(c);const vals:Record<string,string>={value:String(c.value??''),formatted:c.baseDisplayText??String(c.value??''),fieldLabel:(s?.content as any)?.displayName||(s?.content as any)?.fieldKey||'',
      rowLabel:(c.rowPath||[]).map(p=>p.label&&p.label!==p.memberKey?p.label:String(decodeMemberValue(p.memberKey))).join(' / '),columnLabel:(c.columnPath||c.colPath||[]).map(p=>p.label&&p.label!==p.memberKey?p.label:String(decodeMemberValue(p.memberKey))).join(' / ')};
    return text.replace(/\{([^{}]+)\}/g,(_,t:string)=>vals[t]??'');
  };
  type Effect={action:VisualStyleAction;triggers:BiGridCell[];regionId?:string|undefined;id:string;stats?:RuleStatistics|undefined};
  const layers:Effect[][]=[[],[],[],[]];
  for(const r of [...(doc.styleRules||[])].sort((a,b)=>a.priority-b.priority||a.id.localeCompare(b.id))){
    if(r.enabled===false||r.sheetId!==sheetId)continue;
    const sources=r.target?new Set(resolvePresentationTarget(r.target,doc).map(s=>s.id)):new Set([r.targetId]);
    const triggers=['template-cell','row'].includes(r.scope)?[...sources].flatMap(id=>id?cellsBySource.get(id)||[]:[]):cells.filter(c=>r.scope==='sheet'||r.scope==='region'&&region(c)===r.targetId);
    layers[r.scope==='row'?0:1]!.push({action:{scope:r.scope==='row'?'row':'cell',style:r.style,reset:r.reset,noFill:r.noFill,rowColumns:r.rowColumns},triggers,
      regionId:r.regionId,id:r.id});
    const last=layers[r.scope==='row'?0:1]!.at(-1)!;last.regionId=r.regionId||byId.get(r.targetId||'')?.regionId||(doc.regions.filter(g=>g.sheetId===sheetId).length===1?doc.regions.find(g=>g.sheetId===sheetId)?.id:undefined);
  }
  const statistics:RuleStatistics[]=[];
  const affected=new Map<RuleStatistics,Set<string>>();
  if(options.conditions!==false)for(const set of [...(doc.presentationRules?.ruleSets||[])].sort((a,b)=>a.order-b.order||a.id.localeCompare(b.id))){
    if(set.target.sheetId!==sheetId)continue;
    const ids=new Set(resolvePresentationTarget(set.target,doc).map(c=>c.id));
    const targets=[...ids].flatMap(id=>cellsBySource.get(id)||[]).filter(c=>!set.target.roles?.length||set.target.roles.includes(role(c)));
    if(!targets.length)warn('WARN_RULE_DORMANT','当前数据没有目标实例，规则仍保留',set.id);
    const stopped=new Set<string>(),matchedAny=new Set<string>();
    for(const r of [...set.rules].sort((a,b)=>a.order-b.order||a.id.localeCompare(b.id))){
      const stats:RuleStatistics={ruleId:r.id,targets:targets.length,matched:0,applied:0,blocked:0,affectedRows:0,affectedCells:0,skippedMerges:0,samples:[]};statistics.push(stats);
      if(!r.enabled)continue;
      const hits:BiGridCell[]=[];
      for(const c of targets){if(stopped.has(key(c))){stats.blocked++;continue;}let hit=false;try{hit=test(r.predicate,c);}catch(e){warn('ERR_RULE_CONTEXT',String((e as Error).message),r.id,'error');}
        if(stats.samples.length<3)stats.samples.push({row:c.row,col:c.col,value:c.value,formatted:c.baseDisplayText??String(c.value??''),matched:hit});
        if(hit)stats.matched++;
        if(!hit)continue;matchedAny.add(key(c));hits.push(c);stats.applied++;
        if(r.text!==undefined){c.displayText=template(r.text,c);c.displaySource='conditional';let set=affected.get(stats);if(!set){set=new Set();affected.set(stats,set);}set.add(key(c));}
        if(r.stopIfTrue)stopped.add(key(c));
      }
      if(r.style)layers[r.style.scope==='row'?2:3]!.push({action:r.style,triggers:hits,regionId:r.style.regionId||set.target.regionId,id:r.id,stats});
    }
    const fallback=targets.filter(c=>!matchedAny.has(key(c)));
    if(set.otherwise?.text!==undefined)for(const c of fallback){c.displayText=template(set.otherwise.text,c);c.displaySource='conditional';}
    if(set.otherwise?.style)layers[set.otherwise.style.scope==='row'?2:3]!.push({action:set.otherwise.style,triggers:fallback,regionId:set.otherwise.style.regionId||set.target.regionId,id:set.id});
  }
  const pub=(s:CellStyleDefinition):PublishedCellStyle=>({...(s.fontFamily!==undefined?{fontFamily:s.fontFamily}:{}),...(s.fontSize!==undefined?{fontSize:s.fontSize}:{}),
    ...(s.bold!==undefined?{bold:s.bold}:{}),...(s.italic!==undefined?{italic:s.italic}:{}),...(s.color!==undefined?{color:normalizeRuleColor(s.color)||s.color}:{}),
    ...(s.backgroundColor!==undefined?{bgColor:normalizeRuleColor(s.backgroundColor)||s.backgroundColor}:{}),...(s.textAlign?{align:s.textAlign}:{}),...(s.verticalAlign?{verticalAlign:s.verticalAlign}:{}),...(s.wrapText!==undefined?{wrapText:s.wrapText}:{})});

  const paint=(cell:BiGridCell,action:VisualStyleAction,previous=cell.style):PublishedCellStyle=>{
    const style:PublishedCellStyle={...previous,...pub(action.style)};
    for(const reset of action.reset||[]){const prop=reset==='backgroundColor'?'bgColor':reset;const base=cell.basePresentationStyle?.[prop];(style as any)[prop]=base??(prop==='color'?'#262626':prop==='bgColor'?undefined:false);}
    if(action.noFill)delete style.bgColor;
    return style;
  };
  const mark=(stats:RuleStatistics|undefined,c:BiGridCell)=>{if(!stats)return;let list=affected.get(stats);if(!list){list=new Set();affected.set(stats,list);}list.add(key(c));};
  for(const layer of layers){
    const proposals=new Map<string,{range:typeof input.merges[number];master:BiGridCell;base:PublishedCellStyle;styles:Map<string,PublishedCellStyle>;stats:Map<RuleStatistics,Set<string>>}>();
    for(const e of layer){
      const destinations=new Map<string,BiGridCell>(),rows=new Set<number>();
      if(e.action.scope==='cell')for(const c of e.triggers)destinations.set(key(c),c);
      else {
        for(const c of e.triggers){const m=merged(c);for(let row=m?.startRow??c.row;row<=(m?.endRow??c.row);row++)rows.add(row);}
        const b=e.action.rowColumns||bounds.get(e.regionId||region(e.triggers[0]||{row:-1,col:-1} as BiGridCell)||'');
        if(!b&&e.triggers.length)warn('ERR_RULE_ROW_RANGE','整行样式缺少业务区域或静态列范围',e.id,'error');
        if(b)for(const row of rows)for(let col=b[0];col<=b[1];col++){
          const position=row+':'+col;let c=at.get(position);
          if(!c){c={row,col,value:null,displayText:'',role:'custom',style:{},basePresentationStyle:{},regionId:e.regionId,sourceCellId:''};cells.push(c);at.set(position,c);}
          destinations.set(position,c);
        }
      }
      for(const c of destinations.values()){
        const m=merged(c);
        if(e.action.scope==='row'&&m){
          const id=m.startRow+':'+m.endRow+':'+m.startCol+':'+m.endCol;
          let p=proposals.get(id);const master=at.get(m.startRow+':'+m.startCol);if(!master)continue;
          if(!p){p={range:m,master,base:{...master.style},styles:new Map(),stats:new Map()};proposals.set(id,p);}
          p.styles.set(key(c),paint(master,e.action,p.styles.get(key(c))||p.base));
          if(e.stats){let set=p.stats.get(e.stats);if(!set){set=new Set();p.stats.set(e.stats,set);}set.add(key(c));}
        }else{c.style=paint(c,e.action);mark(e.stats,c);}
      }
    }
    for(const p of proposals.values()){
      const m=p.range,styles=[...p.styles.values()];
      const full=p.styles.size===(m.endRow-m.startRow+1)*(m.endCol-m.startCol+1);
      const identical=styles.every(s=>JSON.stringify(s)===JSON.stringify(styles[0]));
      if(full&&identical){
        p.master.style=styles[0]!;
        for(const [position,style] of p.styles){const c=at.get(position);if(c)c.style=style;}
        for(const [stats,positions] of p.stats)for(const position of positions){const c=at.get(position);if(c)mark(stats,c);}
      }else{
        p.master.style=p.base;
        for(const stats of p.stats.keys())stats.skippedMerges++;
      }
    }
  }
  for(const [stats,positions] of affected){stats.affectedCells=positions.size;stats.affectedRows=new Set([...positions].map(k=>k.split(':')[0])).size;}
  for(const stats of statistics)for(const sample of stats.samples)sample.text=at.get(key(sample))?.displayText??String(sample.value??'');
  const merges:BiGridModel['merges']=[],mergeOrigins:NonNullable<BiGridModel['mergeOrigins']>=[];
  for(const m of input.merges){
    const origin=originByRange.get(rangeKey(m));
    if(origin?.origin!=='adjacent-equal'||m.startRow!==m.endRow&&m.startCol!==m.endCol){merges.push(m);if(origin)mergeOrigins.push(origin);continue;}
    const vertical=m.startCol===m.endCol;const start=vertical?m.startRow:m.startCol,end=vertical?m.endRow:m.endCol;
    const signature=(i:number)=>{const c=at.get(vertical?`${i}:${m.startCol}`:`${m.startRow}:${i}`);return JSON.stringify([c?.value,c?.displayText,c?.style]);};
    let from=start;
    const push=(to:number)=>{if(to<=from)return;const range=vertical?{...m,startRow:from,endRow:to}:{...m,startCol:from,endCol:to};merges.push(range);mergeOrigins.push({...origin,range});};
    for(let i=start+1;i<=end;i++)if(signature(i)!==signature(from)){push(i-1);from=i;}
    push(end);
  }
  const defaultRowHeight=input.defaultRowHeight??24;
  const baseRows={...(input.basePresentationRowHeights||input.rowHeights||{})},rowHeights={...baseRows};
  for(const c of cells){
    const text=c.displayText??String(c.value??'');if(!text)continue;
    const font=c.style?.fontSize||12,m=mergeAt(c),start=m?.startRow??c.row,end=m?.endRow??c.row;
    if(m&&(c.row!==start||c.col!==m.startCol))continue;
    let width=0;for(let col=m?.startCol??c.col;col<=(m?.endCol??c.col);col++)width+=input.colWidths?.[col]??100;
    const lines=text.split(/\r?\n/).reduce((n,line)=>n+(c.style?.wrapText?Math.max(1,Math.ceil([...line].reduce((s,ch)=>s+(ch.charCodeAt(0)>255?font:font*0.62),0)/Math.max(16,width-12))):1),0);
    const needed=Math.ceil(lines*font*1.2+8);
    let available=0;const flexible:number[]=[];for(let r=start;r<=end;r++){available+=rowHeights[r]??defaultRowHeight;if(baseRows[r]===undefined)flexible.push(r);}
    if(needed>available&&flexible.length){const extra=Math.ceil((needed-available)/flexible.length);for(const r of flexible)rowHeights[r]=(rowHeights[r]??defaultRowHeight)+extra;}
  }
  return {grid:{...input,cells,merges,mergeOrigins,ruleStatistics:statistics,defaultRowHeight,rowHeights,basePresentationRowHeights:baseRows},diagnostics};
}
