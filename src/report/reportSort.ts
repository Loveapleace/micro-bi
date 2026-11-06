import type { DataRecord } from '../engine/types.js';
import { formatTimeBucket } from '../engine/bucketing.js';
import { dateComparable, fieldValueType } from '../report-template/cellCapabilities.js';
import { encodeMemberValue } from '../report-template/identity.js';
import { applyRegionFilters } from '../report-template/regionFilter.js';
import { evaluateCellMetric } from '../report-template/metricValue.js';
import type { CellDefinition, CellTemplateDocumentV1, FieldCellContent } from '../report-template/types.js';
import type { AxisMemberRef, BiGridModel } from './types.js';
import type { ReportSortCatalog, ReportSortHeader, ReportSortIssue, ReportSortMember, ReportSortRule, ReportSortSlice, ReportSortTarget } from './sortTypes.js';

const empty = (value: unknown) => value === null || value === undefined || value === '' || typeof value === 'number' && !Number.isFinite(value);
const collator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' });
export function compareReportSortValues(a: unknown, b: unknown, order: 'asc' | 'desc', type?: string): number {
  if (empty(a) || empty(b)) return empty(a) ? empty(b) ? 0 : 1 : -1;
  if (type === 'date') {
    const aa = dateComparable(a), bb = dateComparable(b);
    if (aa === undefined || bb === undefined) return aa === undefined ? bb === undefined ? 0 : 1 : -1;
    return order === 'asc' ? aa - bb : bb - aa;
  }
  const value = typeof a === 'number' && typeof b === 'number' ? a - b
    : typeof a === 'boolean' && typeof b === 'boolean' ? Number(a) - Number(b) : collator.compare(String(a), String(b));
  return order === 'asc' ? value : -value;
}

export const sortSliceId = (members: readonly ReportSortMember[]) => JSON.stringify(members.map(member => [member.targetId, member.memberKey]));
const bucketIdentity = (content: FieldCellContent) => content.timeBucket ? [content.timeBucket.granularity,
  content.timeBucket.customIntervalDays, content.timeBucket.timezone, content.timeBucket.weekStartsOn, content.timeBucket.format] : null;
const sameRegion = (a: {sheetId: string; regionId?: string | undefined}, b: {sheetId: string; regionId?: string | undefined}) => a.sheetId === b.sheetId && a.regionId === b.regionId;

export function reportSortRuleIssues(catalog:ReportSortCatalog,rules:readonly ReportSortRule[],hasRecords=true):ReportSortIssue[] {
  const targets=new Map(catalog.targets.map(target=>[target.id,target])),metrics=new Map(catalog.metrics.map(metric=>[metric.id,metric]));
  const slices=new Set(catalog.slices.map(slice=>slice.id)),seen=new Set<string>(),issues:ReportSortIssue[]=[];
  for(const rule of rules){
    const target=targets.get(rule.targetId);let issue:Omit<ReportSortIssue,'rule'>|undefined;
    if(!target)issue={code:'WARN_SORT_TARGET',message:'排序字段或分组粒度已变化，请重新选择排序对象'};
    else if(seen.has(rule.targetId))issue={code:'WARN_SORT_DUPLICATE',message:`${target.label} 存在重复排序，请保留一条规则`};
    else if(rule.by==='metric'){
      const metric=rule.metricId&&metrics.get(rule.metricId);
      if(target.axis==='record'||!metric||!sameRegion(target,metric))issue={code:'WARN_SORT_METRIC',message:'排序指标或聚合口径已变化，请重新选择指标'};
      else if(rule.slice?.length){
        const opposite=target.axis==='row'?'column':'row',path=rule.slice.map(item=>targets.get(item.targetId));
        if(path.some((item,i)=>!item||item.axis!==opposite||!sameRegion(item,target)||(i?item.parentId!==path[i-1]?.id:!!item.parentId)))issue={code:'WARN_SORT_SLICE',message:'排序取值范围的维度已变化，请重新选择范围'};
        else if(hasRecords&&!slices.has(sortSliceId(rule.slice)))issue={code:'WARN_SORT_SLICE_MISSING',message:'排序参考成员当前没有数据，规则已保留，恢复数据后自动生效'};
      }
    }
    if(issue)issues.push({rule,...issue});else seen.add(rule.targetId);
  }
  return issues;
}

export function createReportSortEngine(doc: CellTemplateDocumentV1, records: readonly DataRecord[], rules: readonly ReportSortRule[] = doc.defaultSortRules || []) {
  const cells = new Map(doc.cells.map(cell => [cell.id, cell]));
  const regionFacts = new Map<string, readonly DataRecord[]>();
  const factsFor = (regionId?: string) => {
    const key = regionId || '';
    let facts = regionFacts.get(key);
    if (!facts) { facts = applyRegionFilters(records, doc.regions.find(region => region.id === regionId)?.filters || []); regionFacts.set(key, facts); }
    return facts;
  };
  const targets: ReportSortTarget[] = [];
  const targetPaths = new Map<string, unknown[]>();
  const bySource = new Map<string, ReportSortTarget>();
  const targetCells = doc.cells.filter(cell => cell.content.kind === 'field' && (cell.content.role === 'detail-column' ||
    ['row-dimension', 'column-dimension'].includes(cell.content.role) && ['group', 'list'].includes(cell.content.operation)));
  const makeTarget = (cell: CellDefinition, visiting = new Set<string>()): ReportSortTarget | undefined => {
    if (bySource.has(cell.id)) return bySource.get(cell.id);
    if (cell.content.kind !== 'field' || visiting.has(cell.id)) return;
    visiting.add(cell.id);
    const content = cell.content;
    const axis = content.role === 'detail-column' ? 'record' : content.role === 'column-dimension' ? 'column' : 'row';
    const parentCell = axis === 'record' ? undefined : targetCells.find(candidate => candidate.id === cell.parents?.[axis]);
    const parent = parentCell ? makeTarget(parentCell, visiting) : undefined;
    const identityPath = [...(parent ? targetPaths.get(parent.sourceCellId) || [] : []), [cell.id,content.fieldKey,bucketIdentity(content)]];
    targetPaths.set(cell.id,identityPath);
    const id = JSON.stringify(['sort', cell.sheetId, cell.regionId || '', axis, identityPath]);
    const sample = records.find(record => !empty(record[content.fieldKey]))?.[content.fieldKey];
    const target: ReportSortTarget = { id, sheetId: cell.sheetId, regionId: cell.regionId, sourceCellId: cell.id, axis,
      field: content.fieldKey, label: content.displayName || content.fieldKey, valueType: content.timeBucket ? 'date' : fieldValueType(undefined, sample),
      level: parent ? parent.level + 1 : 0, ...(parent ? {parentId: parent.id} : {}) };
    targets.push(target); bySource.set(cell.id, target); return target;
  };
  for (const cell of targetCells) makeTarget(cell);
  const targetById = new Map(targets.map(target => [target.id, target]));
  const metricCells = doc.cells.filter(cell => cell.content.kind === 'business-formula' || cell.content.kind === 'field' &&
    cell.content.role === 'measure' && cell.content.operation !== 'list' && !cell.id.startsWith('meas-rowtotal-'));
  const metrics = metricCells.map(cell => {
    const content = cell.content;
    if (content.kind !== 'field' && content.kind !== 'business-formula') throw new Error('Invalid sort metric');
    const signature = content.kind === 'field' ? [content.fieldKey, content.operation] : [content.expression, content.scope, content.precision];
    return {id: JSON.stringify(['metric', cell.sheetId, cell.regionId || '', cell.id, ...signature]), sourceCellId: cell.id,
      sheetId: cell.sheetId, regionId: cell.regionId, label: content.displayName || (content.kind === 'field' ? content.fieldKey : content.metricId),
      operation: content.kind === 'field' ? content.operation : 'formula'};
  });
  const metricById = new Map(metrics.map(metric => [metric.id, metric]));
  const encodedValues = new WeakMap<DataRecord, Map<string, {key: string; value: unknown}>>();
  const member = (target: ReportSortTarget, record: DataRecord) => {
    let cached = encodedValues.get(record);
    if (!cached) { cached = new Map(); encodedValues.set(record, cached); }
    let result = cached.get(target.id);
    if (!result) {
      const content = cells.get(target.sourceCellId)!.content as FieldCellContent;
      const value = content.timeBucket ? formatTimeBucket(record[target.field], {field:target.field,...content.timeBucket} as any) : record[target.field];
      result = {key:encodeMemberValue(value),value}; cached.set(target.id, result);
    }
    return result;
  };
  const chain = (target: ReportSortTarget): ReportSortTarget[] => {
    const result = [target]; let current = target;
    while (current.parentId && targetById.has(current.parentId)) { current = targetById.get(current.parentId)!; result.unshift(current); }
    return result;
  };
  const slices = new Map<string, ReportSortSlice>();
  for (const target of targets.filter(target => target.axis !== 'record')) {
    const parents = chain(target);
    for (const record of factsFor(target.regionId)) {
      const values = parents.map(parent => member(parent, record));
      const members = parents.map((parent, index) => ({targetId:parent.id,memberKey:values[index]!.key}));
      const id = sortSliceId(members);
      if (!slices.has(id)) slices.set(id, {id, axis:target.axis as 'row'|'column',sheetId:target.sheetId,regionId:target.regionId,
        label:values.map(value => empty(value.value) ? '(空白)' : String(value.value)).join(' / '), members});
    }
  }
  const catalog: ReportSortCatalog = {targets,metrics,slices:[...slices.values()]};
  const issues=reportSortRuleIssues(catalog,rules,records.length>0),invalid=new Set(issues.map(issue=>issue.rule));
  const active=rules.filter(rule=>!invalid.has(rule));
  const byTarget = new Map(active.map(rule => [rule.targetId, rule]));
  const scores = new WeakMap<readonly DataRecord[], Map<ReportSortRule, unknown>>();
  const times = new WeakMap<readonly DataRecord[], Map<string, number|undefined>>();
  function earliest(facts:readonly DataRecord[],target:ReportSortTarget):number|undefined {
    let values=times.get(facts);if(!values){values=new Map();times.set(facts,values);}
    if(values.has(target.id))return values.get(target.id);
    let result:number|undefined;for(const fact of facts){const time=dateComparable(fact[target.field]);if(time!==undefined&&(result===undefined||time<result))result=time;}
    values.set(target.id,result);return result;
  }
  function score(facts: readonly DataRecord[], rule: ReportSortRule): unknown {
    let values = scores.get(facts); if (!values) { values = new Map(); scores.set(facts,values); }
    if (values.has(rule)) return values.get(rule);
    const metric = rule.metricId && metricById.get(rule.metricId);
    const content = metric && cells.get(metric.sourceCellId)?.content;
    const selected = rule.slice?.length ? facts.filter(record => rule.slice!.every(item => member(targetById.get(item.targetId)!,record).key === item.memberKey)) : facts;
    let value: unknown = null;
    if (selected.length && content && (content.kind === 'field' || content.kind === 'business-formula')) {
      try { value = evaluateCellMetric(content, selected); } catch { value = null; }
    }
    values.set(rule,value); return value;
  }
  return {catalog,issues,
    sortRecords(facts: readonly DataRecord[], regionId?: string): readonly DataRecord[] {
      const selected = active.filter(rule => {const t=targetById.get(rule.targetId)!;return t.axis==='record'&&t.regionId===regionId;});
      if (!selected.length) return facts;
      return [...facts].sort((a,b) => {
        for (const rule of selected) {const target=targetById.get(rule.targetId)!;const result=compareReportSortValues(a[target.field],b[target.field],rule.order,target.valueType);if(result)return result;}
        const aKey=a.id??a._id??a.key,bKey=b.id??b._id??b.key;
        return aKey!==undefined&&bKey!==undefined?compareReportSortValues(aKey,bKey,'asc'):0;
      });
    },
    compareMembers(sourceCellId: string, a: unknown, b: unknown, aFacts: readonly DataRecord[], bFacts: readonly DataRecord[]): number | undefined {
      const target = bySource.get(sourceCellId), rule = target && byTarget.get(target.id);
      if (!target || !rule) return;
      if (rule.by === 'metric') return compareReportSortValues(score(aFacts,rule),score(bFacts,rule),rule.order);
      if (target.valueType==='date') {
        return compareReportSortValues(earliest(aFacts,target),earliest(bFacts,target),rule.order);
      }
      return compareReportSortValues(a,b,rule.order,target.valueType);
    },
  };
}

/** Publish actions for genuine generated headers; user titles, custom D3 text and result cells get no action. */
export function reportSortHeaders(doc: CellTemplateDocumentV1, grid: BiGridModel, catalog: ReportSortCatalog, sheetId: string, rules: readonly ReportSortRule[] = doc.defaultSortRules || []): ReportSortHeader[] {
  const sources=new Map(doc.cells.map(cell=>[cell.id,cell]));
  const targets=catalog.targets.filter(target=>target.sheetId===sheetId);
  const targetBySource=new Map(targets.map(target=>[target.sourceCellId,target]));
  const metrics=catalog.metrics.filter(metric=>metric.sheetId===sheetId);
  const deepest=(axis:'row'|'column',regionId?:string)=>targets.filter(target=>target.axis===axis&&target.regionId===regionId).sort((a,b)=>b.level-a.level)[0];
  const path=(refs:readonly AxisMemberRef[]|undefined,axis:'row'|'column',regionId?:string):ReportSortMember[]=>{
    const candidates=targets.filter(target=>target.axis===axis&&target.regionId===regionId).sort((a,b)=>a.level-b.level);
    return (refs||[]).flatMap((ref,index)=>{const target=ref.sourceCellId?targetBySource.get(ref.sourceCellId):candidates.find(t=>t.field===ref.field&&t.level===index);return target?[{targetId:target.id,memberKey:ref.typedMemberKey??ref.memberKey}]:[];});
  };
  const headers:ReportSortHeader[]=[];
  for(const cell of grid.cells){
    const source=cell.sourceCellId&&sources.get(cell.sourceCellId);if(!source)continue;
    const covering=grid.merges.find(merge=>cell.row>=merge.startRow&&cell.row<=merge.endRow&&cell.col>=merge.startCol&&cell.col<=merge.endCol);
    if(covering&&(covering.startRow!==cell.row||covering.startCol!==cell.col))continue;
    let preset:ReportSortRule|undefined,related:ReportSortRule|undefined;
    const own=targetBySource.get(source.id);
    if(own?.axis==='column'){
      preset={targetId:own.id,by:'value',order:'asc'};
      const row=deepest('row',source.regionId),metric=metrics.find(m=>m.regionId===source.regionId);
      if(row&&metric)related={targetId:row.id,by:'metric',metricId:metric.id,order:'desc',slice:path(cell.columnPath,'column',source.regionId)};
    }else if(source.content.kind==='literal'&&source.panelOwner&&source.id!=='title'){
      const semantic=source.panelOwner.semanticKey;
      const key=semantic?.startsWith('label:metric:')?semantic.slice('label:metric:'.length):source.id.startsWith('lbl-metric-')?source.id.slice(11):source.id.startsWith('hdr-m-')?source.id.slice(6):undefined;
      const metric=key?metrics.find(m=>{const c=sources.get(m.sourceCellId)?.content;return c?.kind==='field'&&c.fieldKey===key||c?.kind==='business-formula'&&c.metricId===key;}):undefined;
      if(metric){
        const regionId=source.regionId||metric.regionId;
        const row=deepest('row',regionId),column=deepest('column',regionId),vertical=!!cell.rowPath?.length&&!cell.columnPath?.length&&!!column;
        const target=vertical?column:row;
        if(target)preset={targetId:target.id,by:'metric',metricId:metric.id,order:'desc',slice:path(vertical?cell.rowPath:cell.columnPath,vertical?'row':'column',regionId)};
      }else if(source.id.startsWith('hdr-')){
        const target=targets.find(target=>target.axis!=='column'&&sources.get(target.sourceCellId)?.position.column===source.position.column&&target.regionId===(source.regionId||doc.regions[0]?.id));
        if(target)preset={targetId:target.id,by:'value',order:'asc'};
      }
    }
    if(preset){
      const index=rules.findIndex(rule=>rule.targetId===preset.targetId&&rule.by===preset.by&&rule.metricId===preset.metricId&&sortSliceId(rule.slice||[])===sortSliceId(preset.slice||[]));
      headers.push({row:cell.row,column:cell.col,preset,...(related?{related}:{}),...(index>=0?{activeOrder:rules[index]!.order,...(targets.find(t=>t.id===preset.targetId)?.axis==='record'?{priority:index+1}:{})}:{})});
    }
  }
  return headers;
}

export function sortRuleSummary(rule:ReportSortRule,catalog:ReportSortCatalog):string {
  const target=catalog.targets.find(target=>target.id===rule.targetId);
  if(!target)return '排序字段已变化';
  const metric=catalog.metrics.find(metric=>metric.id===rule.metricId);
  const slice=rule.slice?.length?catalog.slices.find(slice=>slice.id===sortSliceId(rule.slice!))?.label||'暂缺成员':'全部汇总';
  return `${target.axis==='record'?'':target.axis==='row'?'行：':'列：'}${target.label}${rule.by==='metric'?`按${slice} · ${metric?.label||'失配指标'}`:''} ${rule.order==='asc'?'↑':'↓'}`;
}
