import type { DataRecord, HeaderMapping } from '../engine/types.js';
import type { PublishedCell, PublishedSheet } from './types.js';
import type { DrillPage, DrillQuery, DrillRequest, DrillTab, DrillTarget, PublishedDrillIndex } from './drillTypes.js';
import { dataSnapshotFingerprint, drillScopeLabel, createDrillScopeMatcher } from './drill.js';

export interface DrillSnapshot { tabs: readonly DrillTab[]; activeSheetId?: string | undefined }
let nextSheet=0;
const primitive=(value:unknown):string|number|boolean|null=>value==null?null:typeof value==='string'||typeof value==='number'||typeof value==='boolean'?value:value instanceof Date?value.toISOString():JSON.stringify(value);
export function drillPageToSheet(id:string,request:DrillRequest,page?:DrillPage,error?:string):PublishedSheet {
  const fields=request.target.rule.columns.length?request.target.rule.columns:[...new Set([...Object.keys(page?.headers||{}),...(page?.records||[]).flatMap(r=>Object.keys(r))])];
  const cells:PublishedCell[]=[{r:0,c:0,v:`${request.target.label}明细`,displayText:`${request.target.label}明细`},
    {r:1,c:0,v:page?drillScopeLabel(request.scope,page.headers):'正在核对明细范围…',displayText:page?drillScopeLabel(request.scope,page.headers):'正在核对明细范围…'}];
  if(!page)cells.push({r:2,c:0,v:error||'正在加载明细…',displayText:error||'正在加载明细…'});
  else{
    fields.forEach((field,c)=>{const label=page.headers?.[field]||field;cells.push({r:2,c,v:label,displayText:label});});
    page.records.forEach((record,i)=>fields.forEach((field,c)=>{const v=primitive(record[field]);cells.push({r:i+3,c,v,displayText:v==null?'':String(v)});}));
    if(!page.records.length)cells.push({r:3,c:0,v:'当前范围暂无明细',displayText:'当前范围暂无明细'});
  }
  return {id,name:`${request.target.label}明细`,rowCount:Math.max(5,(page?.records.length||0)+3),colCount:Math.max(1,fields.length),cells,merges:[],defaultColWidth:150,defaultRowHeight:26,frozenRowCount:3};
}
export function createLocalDrillQuery(load:(datasetId:string)=>Promise<{records:readonly DataRecord[];headers?:HeaderMapping|undefined}>|{records:readonly DataRecord[];headers?:HeaderMapping|undefined}):DrillQuery {
  const cache=new Map<string,readonly DataRecord[]>();
  return async(request,signal)=>{
    const source=await load(request.scope.datasetId);
    if(signal.aborted)throw new Error('查询已取消');
    const fingerprint=dataSnapshotFingerprint(source.records);
    if(fingerprint!==request.fingerprint)throw new Error('数据已变化，请刷新主报表后重新打开明细');
    const key=fingerprint+JSON.stringify(request.scope);
    let matching=cache.get(key);
    if(!matching){matching=source.records.filter(createDrillScopeMatcher(request.scope));if(cache.size>=8)cache.delete(cache.keys().next().value!);cache.set(key,matching);}
    const start=(request.page-1)*request.pageSize;
    return {records:matching.slice(start,start+request.pageSize),total:matching.length,headers:source.headers,fingerprint};
  };
}

/** 运行时会话不进入源模板、publication或用户撤销栈。 */
export class DrillSession {
  private index:PublishedDrillIndex|undefined;
  private query:DrillQuery|undefined;
  private snapshot:DrillSnapshot={tabs:[]};
  private listeners=new Set<()=>void>();
  private requests=new Map<string,AbortController>();
  private epoch=0;
  constructor(private readonly maxTabs=5){}
  getSnapshot=():DrillSnapshot=>this.snapshot;
  subscribe=(listener:()=>void):(()=>void)=>{this.listeners.add(listener);return()=>{this.listeners.delete(listener);};};
  private publish(next:DrillSnapshot):void{this.snapshot=next;this.listeners.forEach(fn=>fn());}
  configure(index:PublishedDrillIndex|undefined,query:DrillQuery):void{
    if(this.index?.revision!==index?.revision){this.clear();}
    this.index=index;this.query=query;
  }
  activate(sheetId:string):void{if(this.snapshot.activeSheetId!==sheetId)this.publish({...this.snapshot,activeSheetId:sheetId});}
  open(target:DrillTarget):string|undefined{
    if(target.reason||!this.index||!this.query||target.publicationRevision!==this.index.revision)return undefined;
    const scope=this.index.scopes[target.scopeId];if(!scope)return undefined;
    const existing=this.snapshot.tabs.find(t=>t.key===target.id);
    if(existing){this.activate(existing.id);return existing.id;}
    if(this.snapshot.tabs.length>=this.maxTabs)this.close(this.snapshot.tabs[0]!.id);
    const id=`bi-drill-${++nextSheet}`;
    const request:DrillRequest={target,scope,dataRevision:this.index.dataRevision,fingerprint:this.index.fingerprint,page:1,pageSize:target.rule.pageSize};
    const tab:DrillTab={id,key:target.id,origin:{sheetId:target.sheetId,row:target.row,column:target.column},request,status:'loading',sheet:drillPageToSheet(id,request),total:0};
    this.publish({tabs:[...this.snapshot.tabs,tab],activeSheetId:id});void this.load(id,request);return id;
  }
  page(id:string,page:number):void{
    const tab=this.snapshot.tabs.find(t=>t.id===id);if(!tab||!Number.isInteger(page)||page<1||tab.status==='loading')return;
    if(tab.status==='ready'&&page>Math.max(1,Math.ceil(tab.total/tab.request.pageSize)))return;
    const request={...tab.request,page};this.update(id,{request,status:'loading',error:undefined});void this.load(id,request);
  }
  retry(id:string):void{const tab=this.snapshot.tabs.find(t=>t.id===id);if(tab&&tab.status!=='loading'){this.update(id,{status:'loading',error:undefined});void this.load(id,tab.request);}}
  private update(id:string,patch:Partial<DrillTab>):void{this.publish({...this.snapshot,tabs:this.snapshot.tabs.map(t=>t.id===id?{...t,...patch}:t)});}
  private async load(id:string,request:DrillRequest):Promise<void>{
    this.requests.get(id)?.abort();const controller=new AbortController(),epoch=this.epoch;this.requests.set(id,controller);
    try{
      const page=await this.query!(request,controller.signal);
      if(controller.signal.aborted||epoch!==this.epoch||this.requests.get(id)!==controller||!this.snapshot.tabs.some(t=>t.id===id))return;
      if(page.fingerprint!==request.fingerprint)throw new Error('明细与主报表的数据版本不一致，请刷新后重试');
      if(page.records.length>request.pageSize||!Number.isInteger(page.total)||page.total<page.records.length)throw new Error('明细分页响应无效');
      this.update(id,{status:'ready',total:page.total,sheet:drillPageToSheet(id,request,page),error:undefined});
    }catch(error){
      if(!controller.signal.aborted&&epoch===this.epoch&&this.snapshot.tabs.some(t=>t.id===id)){
        const message=error instanceof Error?error.message:'明细查询失败';this.update(id,{status:'error',error:message,sheet:drillPageToSheet(id,request,undefined,message)});
      }
    }finally{if(this.requests.get(id)===controller)this.requests.delete(id);}
  }
  close(id:string):void{
    const tab=this.snapshot.tabs.find(t=>t.id===id);if(!tab)return;
    this.requests.get(id)?.abort();this.requests.delete(id);
    this.publish({tabs:this.snapshot.tabs.filter(t=>t.id!==id),activeSheetId:this.snapshot.activeSheetId===id?tab.origin.sheetId:this.snapshot.activeSheetId});
  }
  clear():void{
    this.epoch++;this.requests.forEach(c=>c.abort());this.requests.clear();
    if(this.snapshot.tabs.length||this.snapshot.activeSheetId)this.publish({tabs:[]});
  }
  dispose():void{this.clear();this.listeners.clear();this.index=undefined;this.query=undefined;}
}
