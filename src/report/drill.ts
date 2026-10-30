import type { DataRecord, HeaderMapping } from '../engine/types.js';
import { formatTimeBucket } from '../engine/bucketing.js';
import { matchesRegionFilter } from '../report-template/regionFilter.js';
import { encodeMemberValue, decodeMemberValue } from '../report-template/identity.js';
import type { CellDefinition, CellTemplateDocumentV1 } from '../report-template/types.js';
import type { BiGridModel } from './types.js';
import type { DrillCellContext, DrillMember, DrillScope, DrillTarget, PublishedDrillIndex } from './drillTypes.js';
import type { DrillRule } from './drillTypes.js';
import { hybridAxisKey } from '../report-template/hybridAxes.js';

export interface DrillPathMember { field: string; memberKey: string; sourceCellId?: string; recordId?: unknown; recordKey?: string; memberValue?: unknown }
export function hashDrillValue(text: string): string {
  let a=2166136261,b=5381;
  for(let i=0;i<text.length;i++){const n=text.charCodeAt(i);a=Math.imul(a^n,16777619);b=Math.imul(b,33)^n;}
  return (a>>>0).toString(36)+(b>>>0).toString(36);
}
/** 指纹描述事实内容，不能用渲染时间冒充数据版本。 */
export function dataSnapshotFingerprint(records: readonly DataRecord[]): string {
  return hashDrillValue(records.map(r=>JSON.stringify(Object.keys(r).sort().map(k=>[k,encodeMemberValue(r[k])]))).join('\n'));
}
export const drillCellKey=(sheetId:string,row:number,column:number)=>JSON.stringify([sheetId,row,column]);
export const drillSourceIdentity=(cell:CellDefinition)=>cell.panelOwner?.semanticKey||hybridAxisKey(cell);
export function drillRuleMatchesCell(rule:DrillRule,cell:CellDefinition):boolean {
  return rule.sheetId===cell.sheetId&&(rule.cellId===cell.id||Boolean(rule.semanticKey&&rule.semanticKey===drillSourceIdentity(cell)));
}
export function createDrillCellContext(doc: CellTemplateDocumentV1, cell: CellDefinition, row: readonly DrillPathMember[]=[], column: readonly DrillPathMember[]=[], baseValue?: unknown,localTimeZone?:string): DrillCellContext | undefined {
  if(!doc.drillRules?.some(r=>r.enabled))return undefined;
  const region=doc.regions.find(r=>r.id===cell.regionId)||doc.regions[0];
  if(!region)return undefined;
  let reason=cell.content.kind==='sheet-formula'?'此工作表公式可能引用多个范围，暂不支持自动明细':undefined;
  const members:DrillMember[]=[...row,...column].map(p=>{
    const source=doc.cells.find(c=>c.id===p.sourceCellId);
    const content=source?.content;
    if(content?.kind==='field'&&content.operation==='list'){
      if(!p.recordKey)reason='此明细没有稳定主键，无法精确定位记录';
      return {field:p.field,memberKey:encodeMemberValue(p.recordId),recordKey:p.recordKey};
    }
    return {field:p.field,memberKey:p.memberKey,...(content?.kind==='field'&&content.timeBucket?{bucket:{...content.timeBucket,timezone:content.timeBucket.timezone||localTimeZone||Intl.DateTimeFormat().resolvedOptions().timeZone}}:{})};
  });
  return {sourceCellId:cell.id,scope:{datasetId:region.datasetId,regionId:region.id,filters:region.filters,members},baseValue,reason};
}
export function matchesDrillScope(record: DataRecord, scope: DrillScope): boolean {
  return createDrillScopeMatcher(scope)(record);
}
export function createDrillScopeMatcher(scope:DrillScope):(record:DataRecord)=>boolean {
  const localZone=Intl.DateTimeFormat().resolvedOptions().timeZone;
  const members=scope.members.map(m=>({...m,bucket:m.bucket?.timezone===localZone?{...m.bucket,timezone:undefined}:m.bucket}));
  return record=>{
  if(!scope.filters.every(filter=>matchesRegionFilter(record,filter)))return false;
  return members.every(m=>{
    const value=record[m.recordKey||m.field];
    return encodeMemberValue(m.bucket?formatTimeBucket(value,{field:m.field,...m.bucket}):value)===m.memberKey;
  });
  };
}
export function compileDrillIndex(doc:CellTemplateDocumentV1,grids:readonly {sheetId:string;grid:BiGridModel}[],fingerprint:string,dataRevision:string|number=fingerprint):PublishedDrillIndex|undefined {
  const rules=doc.drillRules?.filter(r=>r.enabled);
  if(!rules?.length)return undefined;
  const index:PublishedDrillIndex={revision:hashDrillValue(JSON.stringify([doc.templateRevision,rules,fingerprint])),fingerprint,dataRevision,scopes:{},cells:{},merges:[]};
  for(const {sheetId,grid} of grids){
    const byPosition=new Map<string,DrillTarget>();
    for(const cell of grid.cells){
      const ctx=cell.drillContext;
      const source=doc.cells.find(c=>c.id===cell.sourceCellId&&c.sheetId===sheetId);
      const rule=source?rules.find(r=>drillRuleMatchesCell(r,source)):undefined;
      if(!rule||!ctx)continue;
      if(rule.datasetId&&rule.datasetId!==ctx.scope.datasetId)continue;
      if(rule.field&&(source?.content.kind!=='field'||source.content.fieldKey!==rule.field))continue;
      const scopeId=hashDrillValue(JSON.stringify(ctx.scope));if(!index.scopes[scopeId])index.scopes[scopeId]=structuredClone(ctx.scope);
      const target:DrillTarget={id:hashDrillValue(JSON.stringify([sheetId,ctx.sourceCellId,scopeId])),sheetId,row:cell.row,column:cell.col,sourceCellId:ctx.sourceCellId,
        scopeId,value:cell.value,baseValue:ctx.baseValue,label:source?.content.kind==='field'?source.content.displayName||source.content.fieldKey:source?.content.kind==='business-formula'?source.content.displayName||'公式指标':'明细',rule:structuredClone(rule),reason:ctx.reason,publicationRevision:''};
      index.cells[drillCellKey(sheetId,cell.row,cell.col)]=target;byPosition.set(`${cell.row}:${cell.col}`,target);
    }
    const cellRows=new Map<number,typeof grid.cells>();
    for(const c of grid.cells){const row=cellRows.get(c.row)||[];row.push(c);cellRows.set(c.row,row);}
    for(const range of grid.merges){
      const master=byPosition.get(`${range.startRow}:${range.startCol}`);if(!master)continue;
      const origin=grid.mergeOrigins?.find(m=>m.range.startRow===range.startRow&&m.range.startCol===range.startCol&&m.range.endRow===range.endRow&&m.range.endCol===range.endCol);
      const target={...master};
      if(origin?.origin!=='group-span'){
        const signature=JSON.stringify(index.scopes[master.scopeId]);
        for(let row=range.startRow;row<=range.endRow&&!target.reason;row++)if(cellRows.get(row)?.some(c=>c.col>=range.startCol&&c.col<=range.endCol&&c.sourceCellId&&c.role!=='custom'&&(!c.drillContext||JSON.stringify(c.drillContext.scope)!==signature||c.sourceCellId!==master.sourceCellId)))target.reason='此合并包含不同业务范围或指标，请取消合并后查看各格明细';
      }
      index.merges.push({...range,sheetId,target});
    }
  }
  index.revision=hashDrillValue(JSON.stringify([dataRevision,rules,index.cells,index.merges]));
  for(const target of [...Object.values(index.cells),...index.merges.map(m=>m.target)])target.publicationRevision=index.revision;
  return index;
}
export function resolveDrillTarget(index:PublishedDrillIndex|undefined,sheetId:string,row:number,column:number):DrillTarget|undefined {
  if(!index)return undefined;
  return index.merges.find(m=>m.sheetId===sheetId&&row>=m.startRow&&row<=m.endRow&&column>=m.startCol&&column<=m.endCol)?.target||index.cells[drillCellKey(sheetId,row,column)];
}
export function drillScopeLabel(scope:DrillScope,headers?:HeaderMapping):string {
  return scope.members.map(m=>`${m.recordKey?'记录ID':headers?.[m.field]||m.field}=${String(decodeMemberValue(m.memberKey)??'空值')}`).join(' · ')||'当前报表全部有效范围';
}
