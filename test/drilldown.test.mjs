import test from 'node:test';
import assert from 'node:assert/strict';
import { compilePanelToCellTemplate, compileCellReport } from '../dist/esm/report-template/index.js';
import { dataSnapshotFingerprint, matchesDrillScope, resolveDrillTarget, compileDrillIndex } from '../dist/esm/report/drill.js';
import { DrillSession, createLocalDrillQuery } from '../dist/esm/report/drillSession.js';
import { sourceOnlyWorkbookSnapshot } from '../dist/esm/report/runtimeSheets.js';
import { expandCellDrivenTemplate } from '../dist/esm/report-template/cellExpansionEngine.js';
import { createAdvancedCellDraft, buildAdvancedCellUpdate } from '../dist/esm/cell-designer/advancedCellState.js';
import { preserveHybridDocumentMetadata } from '../dist/esm/cell-designer/hybridTemplateState.js';
import { syncDocumentFromWorkbookSnapshot } from '../dist/esm/cell-designer/syncWorkbookToTemplate.js';
import { formatTimeBucket } from '../dist/esm/engine/bucketing.js';
import { adaptPublishedSheetToVTable } from '../dist/esm/ui/presentation/report/gridAdapter.js';

const facts=[
 {id:1,team:'A',part:'X',day:'2026-08-01',qty:600,defect:6},
 {id:2,team:'A',part:'Y',day:'2026-08-02',qty:300,defect:9},
 {id:3,team:'A',part:'X',day:'2026-09-01',qty:300,defect:3},
 {id:4,team:'A',part:'Y',day:'2026-09-02',qty:300,defect:0},
 {id:5,team:'B',part:'X',day:'2026-08-01',qty:700,defect:7},
 {id:6,team:'B',part:'Y',day:'2026-08-02',qty:500,defect:5},
 {id:7,team:'B',part:'X',day:'2026-09-01',qty:500,defect:10},
 {id:8,team:'B',part:'Y',day:'2026-09-02',qty:300,defect:6},
];
const fields=['id','team','part','day','qty','defect'].map(key=>({key,type:key==='qty'||key==='defect'||key==='id'?'number':'text'}));
function template(pivot=true,categories=['team']){
 const d=compilePanelToCellTemplate({datasetId:'drill-fixture',dimensions:{categories,...(pivot?{columnTimeBucket:{field:'day',granularity:'month',timezone:'UTC'}}:{})},columns:[{type:'aggregated',field:'qty',agg:'sum'}]},'drill-fixture',{showRowTotals:true});
 d.drillRules=d.cells.filter(c=>c.content.kind==='field').map(c=>({cellId:c.id,sheetId:c.sheetId,field:c.content.fieldKey,enabled:true,columns:['id','qty'],pageSize:2}));return d;
}
function compile(doc,rows=facts){const c=compileCellReport(doc,rows);assert.equal(c.valid,true,JSON.stringify(c.diagnostics));return c.publication;}
const targets=r=>Object.values(r.drillIndex.cells);
const ids=(r,t,rows=facts)=>rows.filter(x=>matchesDrillScope(x,r.drillIndex.scopes[t.scopeId])).map(x=>x.id).sort((a,b)=>a-b);
const byIds=(r,expected,source,rows=facts)=>targets(r).find(t=>(!source||t.sourceCellId===source)&&JSON.stringify(ids(r,t,rows))===JSON.stringify(expected));
const query=createLocalDrillQuery(()=>({records:facts,headers:{id:'工单',qty:'交付数'}}));
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('DR-01 grouped drill uses the full group path and exact record ids',()=>{
 const r=compile(template(false));const t=byIds(r,[1,2,3,4],'meas-qty');assert.ok(t);assert.equal(t.value,1500);
 const nested=compile(template(false,['team','part']));assert.equal(byIds(nested,[1,3],'meas-qty').value,900);
});
test('DR-02 pivot intersection retains both axes, row totals omit only the column member',()=>{
 const r=compile(template());const t=byIds(r,[1,2],'meas-qty');assert.ok(t);assert.equal(t.value,900);
 assert.equal(byIds(r,[1,2,3,4],'meas-rowtotal-qty').value,1500);
 assert.equal(r.drillIndex.scopes[t.scopeId].members.length,2);
});
test('DR-03 grouped grand scope respects region filters',()=>{
 const d=template(false);const source=d.cells.find(c=>c.id==='meas-qty');
 d.cells.push({...source,id:'grand-qty',panelOwner:undefined,position:{row:22,column:0},parents:{row:'none',column:'none'},content:{...source.content,metricId:'metric-grand-qty',expand:'none'}});
 d.drillRules.push({...d.drillRules.find(r=>r.cellId===source.id),cellId:'grand-qty'});
 d.regions[0].filters=[{field:'part',operator:'eq',value:'X'}];const r=compile(d);
 assert.equal(byIds(r,[1,3,5,7],'grand-qty').value,2100);
});
test('DR-04 typed dimension keys preserve numeric and string 1 for dimensions and metrics',()=>{
 const rows=[{id:1,team:1,qty:10},{id:2,team:'1',qty:20},{id:3,team:false,qty:30},{id:4,team:0,qty:40},{id:5,team:null,qty:50},{id:6,team:'',qty:60}];
 const d=template(false);const r=compile(d,rows);
 for(const record of rows)assert.ok(byIds(r,[record.id],undefined,rows));
 const g=expandCellDrivenTemplate(d,rows).grid;
 const ones=g.cells.filter(c=>c.role==='dimension-member'&&(c.value===1||c.value==='1'));assert.equal(new Set(ones.map(c=>c.rowPath[0].typedMemberKey)).size,2);
});
test('DR-05 time zones change the actual aggregation and drill slice at month boundary',()=>{
 const rows=[{id:1,team:'A',day:'2026-08-31T16:30:00Z',qty:10},{id:2,team:'A',day:'2026-09-01T01:00:00Z',qty:20}];
 const d=template();const utc=compile(d,rows);assert.ok(byIds(utc,[1],'meas-qty',rows)||targets(utc).some(t=>t.sourceCellId==='meas-qty'&&ids(utc,t,rows).join()==='1'));
 for(const c of d.cells)if(c.content.kind==='field'&&c.content.timeBucket)c.content.timeBucket.timezone='Asia/Shanghai';
 for(const a of d.hybridConfig.columnAxes)if(a.timeBucket)a.timeBucket.timezone='Asia/Shanghai';
 const sh=compile(d,rows);assert.ok(targets(sh).some(t=>t.sourceCellId==='meas-qty'&&ids(sh,t,rows).join()==='1,2'));
 assert.equal(formatTimeBucket(rows[0].day,{field:'day',granularity:'day',timezone:'UTC'}),'2026-08-31');
 assert.equal(formatTimeBucket(rows[0].day,{field:'day',granularity:'day',timezone:'Asia/Shanghai'}),'2026-09-01');
});
test('DR-06 custom display keys preserve their real noncontiguous time membership',()=>{
 const rows=[{id:1,team:'A',day:'2025-08-01',qty:10},{id:2,team:'A',day:'2026-08-03',qty:20},{id:3,team:'A',day:'2026-09-01',qty:30}];
 const d=template();for(const c of d.cells)if(c.content.kind==='field'&&c.content.timeBucket)c.content.timeBucket.format='MM';
 for(const a of d.hybridConfig.columnAxes)if(a.timeBucket)a.timeBucket.format='MM';
 const r=compile(d,rows);assert.ok(targets(r).some(t=>t.sourceCellId==='meas-qty'&&ids(r,t,rows).join()==='1,2'));
});
test('DR-07 fingerprints are data content versions, independent of render time',()=>{
 const d=template();const first=compileCellReport(d,facts),second=compileCellReport(d,structuredClone(facts));
 assert.equal(first.stamp.dataRevisions['drill-fixture'],second.stamp.dataRevisions['drill-fixture']);
 assert.equal(first.publication.drillIndex.revision,second.publication.drillIndex.revision);
 assert.notEqual(dataSnapshotFingerprint(facts),dataSnapshotFingerprint([...facts,{id:9,qty:200}]));
});
test('DR-08 disabled rules add no publication interaction index',()=>{
 const d=template();d.drillRules.forEach(r=>r.enabled=false);assert.equal(compile(d).drillIndex,undefined);
});
test('DR-09 native data label editing and conditional text never become query predicates',()=>{
 const d=template();d.presentationRules={version:1,revision:1,ruleSets:[{id:'conditional',order:0,target:{sheetId:'sheet-1',cellId:'meas-qty'},rules:[{id:'low',name:'显示低产',enabled:true,order:0,stopIfTrue:true,predicate:{kind:'comparison',left:{kind:'current'},operator:'eq',right:{kind:'literal',value:900}},text:'低产'}]}]};
 const r=compile(d);const t=byIds(r,[1,2],'meas-qty');const cell=r.sheets[0].cells.find(c=>c.r===t.row&&c.c===t.column);assert.equal(cell.v,900);assert.equal(cell.displayText,'低产');assert.deepEqual(ids(r,t),[1,2]);
 assert.equal(r.drillIndex.scopes[t.scopeId].members.some(m=>m.memberKey.includes('低产')),false);
});
test('DR-10 grid reordering and newly added pivot members preserve scopes without modifying source',()=>{
 const d=template();const before=JSON.stringify(d);for(const rows of [[...facts].reverse(),[...facts,{id:9,team:'C',part:'X',day:'2026-10-01',qty:200}]]){
 const r=compile(d,rows);assert.ok(targets(r).some(t=>t.sourceCellId==='meas-qty'&&ids(r,t,rows).join()==='1,2'));}
 assert.equal(JSON.stringify(d),before);
 const empty=compile(d,[]);assert.equal(targets(empty).filter(t=>!t.reason).length,0);
 assert.ok(byIds(compile(d),[1,2],'meas-qty'));
});
test('DR-11 manual merges across scopes are blocked and unmerge preserves source rules',()=>{
 const d=template();const g=expandCellDrivenTemplate(d,facts).grid;const metric=g.cells.filter(c=>c.sourceCellId==='meas-qty');const a=metric[0],b=metric.find(c=>c.row!==a.row);
 const range={startRow:Math.min(a.row,b.row),endRow:Math.max(a.row,b.row),startCol:a.col,endCol:a.col};
 const index=compileDrillIndex(d,[{sheetId:'sheet-1',grid:{...g,merges:[range],mergeOrigins:[{origin:'manual-instance',ruleId:'manual',range}]}}],dataSnapshotFingerprint(facts));
 assert.match(resolveDrillTarget(index,'sheet-1',a.row,a.col).reason,/不同业务范围/);
 const normal=compileDrillIndex(d,[{sheetId:'sheet-1',grid:g}],dataSnapshotFingerprint(facts));assert.equal(resolveDrillTarget(normal,'sheet-1',a.row,a.col).reason,undefined);
});
test('DR-12 role-owned advanced changes persist only current source drill rule',()=>{
 const d=template();const cell=d.cells.find(c=>c.id==='meas-qty');const draft=createAdvancedCellDraft(d,cell);draft.drill.enabled=false;draft.dirty.drill=true;
 const update=buildAdvancedCellUpdate(d,cell,draft,{fields});assert.equal(update.drillRules.find(r=>r.cellId===cell.id).enabled,false);
 assert.equal(preserveHybridDocumentMetadata({...d,drillRules:undefined},d).drillRules,d.drillRules);
 assert.deepEqual(buildAdvancedCellUpdate(d,cell,createAdvancedCellDraft(d,cell),{fields}),{});
});
test('DR-13 temporary sheets are stripped from snapshots and cannot create template cells',()=>{
 const d=template();const snapshot={sheetOrder:['sheet-1','runtime'],activeSheetId:'runtime',sheets:{'sheet-1':{cellData:{}},runtime:{custom:{biRuntimeDetail:true},cellData:{0:{0:{v:'sensitive-detail'}}}}}};
 const clean=sourceOnlyWorkbookSnapshot(snapshot);assert.deepEqual(clean.sheetOrder,['sheet-1']);assert.equal(clean.activeSheetId,'sheet-1');assert.ok(snapshot.sheets.runtime);
 const synced=syncDocumentFromWorkbookSnapshot(d,snapshot,'preview');assert.equal(synced.cells.some(c=>c.sheetId==='runtime'),false);
});
test('DR-14 local query pages exact records and checks data fingerprint',async()=>{
 const r=compile(template(false));const t=byIds(r,[1,2,3,4],'meas-qty');const request={target:t,scope:r.drillIndex.scopes[t.scopeId],dataRevision:r.drillIndex.dataRevision,fingerprint:r.drillIndex.fingerprint,page:2,pageSize:2};
 const result=await query(request,new AbortController().signal);assert.deepEqual(result.records.map(r=>r.id),[3,4]);assert.equal(result.total,4);
 await assert.rejects(query({...request,fingerprint:'stale'},new AbortController().signal),/数据已变化/);
});
test('DR-15 session opens, reuses, pages and closes runtime sheets without mutating publication',async()=>{
 const r=compile(template(false)),before=JSON.stringify(r);const session=new DrillSession();session.configure(r.drillIndex,query);
 const target=byIds(r,[1,2,3,4],'meas-qty'),id=session.open(target);await tick();
 assert.equal(session.getSnapshot().tabs[0].status,'ready');assert.equal(session.open(target),id);assert.equal(session.getSnapshot().tabs.length,1);
 session.page(id,2);await tick();assert.equal(session.getSnapshot().tabs[0].request.page,2);assert.ok(session.getSnapshot().tabs[0].sheet.cells.some(c=>c.r===3&&c.c===0&&c.v===3));
 session.close(id);assert.equal(session.getSnapshot().tabs.length,0);assert.equal(session.getSnapshot().activeSheetId,'sheet-1');assert.equal(JSON.stringify(r),before);session.dispose();
});
test('DR-16 late responses cannot reopen closed sheets or cross source revisions',async()=>{
 const r=compile(template());let resolve;const session=new DrillSession();let signal;
 session.configure(r.drillIndex,(_request,s)=>{signal=s;return new Promise(r=>{resolve=r;});});
 const id=session.open(byIds(r,[1,2],'meas-qty'));session.close(id);assert.equal(signal.aborted,true);
 resolve({records:[],total:0,fingerprint:r.drillIndex.fingerprint});await tick();assert.equal(session.getSnapshot().tabs.length,0);
 session.configure(r.drillIndex,query);session.open(byIds(r,[1,2],'meas-qty'));session.configure(compile(template(),[...facts].reverse()).drillIndex,query);await tick();assert.equal(session.getSnapshot().tabs.length,0);session.dispose();
});
test('DR-17 query errors stay in a retryable tab, version mismatch is not displayed as valid detail',async()=>{
 const r=compile(template());const session=new DrillSession();session.configure(r.drillIndex,async()=>({records:[],total:0,fingerprint:'other'}));
 const id=session.open(byIds(r,[1,2],'meas-qty'));await tick();assert.equal(session.getSnapshot().tabs[0].status,'error');assert.match(session.getSnapshot().tabs[0].error,/版本不一致/);
 session.configure(r.drillIndex,query);session.retry(id);await tick();assert.equal(session.getSnapshot().tabs[0].status,'ready');session.dispose();
});
test('DR-18 runtime tab limit evicts and aborts only owned tabs',async()=>{
 const r=compile(template());const session=new DrillSession(1);session.configure(r.drillIndex,query);
 const one=session.open(byIds(r,[1,2],'meas-qty'));const two=session.open(byIds(r,[3,4],'meas-qty'));await tick();assert.notEqual(one,two);assert.deepEqual(session.getSnapshot().tabs.map(t=>t.id),[two]);session.dispose();
});

test('DR-19 stale queued cell events cannot open a new data revision',()=>{
 const old=compile(template()),fresh=compile(template(),[...facts].reverse());const session=new DrillSession();session.configure(fresh.drillIndex,query);
 assert.equal(session.open(byIds(old,[1,2],'meas-qty')),undefined);assert.equal(session.getSnapshot().tabs.length,0);session.dispose();
});
test('DR-20 delayed A never takes focus or overwrites a completed B sheet',async()=>{
 const r=compile(template());let resolveA;const session=new DrillSession();
 session.configure(r.drillIndex,(req,signal)=>req.target.value===900?new Promise(resolve=>{resolveA=()=>query(req,signal).then(resolve);}):query(req,signal));
 const a=session.open(byIds(r,[1,2],'meas-qty')),b=session.open(byIds(r,[3,4],'meas-qty'));await tick();assert.equal(session.getSnapshot().activeSheetId,b);
 await resolveA();await tick();assert.equal(session.getSnapshot().activeSheetId,b);assert.equal(session.getSnapshot().tabs.find(t=>t.id===a).status,'ready');session.dispose();
});
test('DR-21 one worksheet formula cannot be configured to claim a single fact scope',()=>{
 const d=template(),c=d.cells.find(c=>c.id==='meas-qty');c.content={kind:'sheet-formula',formula:'=SUM(C4:D4)'};
 assert.equal(compileCellReport(d,facts).valid,false);
});
test('DR-22 scoped business formula returns original inputs and weighted result',()=>{
 const d=template(),c=d.cells.find(c=>c.id==='meas-qty');c.content={kind:'business-formula',metricId:'weighted',expression:'[SUM(defect)]/[SUM(qty)]',scope:'summary',precision:12,displayName:'加权缺陷率'};
 d.drillRules.find(r=>r.cellId===c.id).field=undefined;
 const r=compile(d),t=byIds(r,[1,2],'meas-qty');assert.ok(t);assert.ok(Math.abs(t.value-15/900)<1e-10);assert.deepEqual(ids(r,t),[1,2]);
});
test('DR-23 two time axes on the same field preserve their own bucket definitions',()=>{
 const d=compilePanelToCellTemplate({datasetId:'drill-fixture',dimensions:{timeBucket:{field:'day',granularity:'month',timezone:'UTC'},categories:['team'],columnTimeBucket:{field:'day',granularity:'day',timezone:'UTC'}},columns:[{type:'aggregated',field:'qty',agg:'sum'}]},'drill-fixture');
 d.drillRules=[{cellId:'meas-qty',sheetId:'sheet-1',field:'qty',enabled:true,columns:['id'],pageSize:20}];
 const r=compile(d);const t=byIds(r,[1],'meas-qty');assert.ok(t);assert.deepEqual(r.drillIndex.scopes[t.scopeId].members.filter(m=>m.bucket).map(m=>m.bucket.granularity).sort(),['day','month']);
});
test('DR-24 missing and invalid dates remain explicit members rather than unfiltered queries',()=>{
 const rows=[{id:1,team:'A',day:null,qty:10},{id:2,team:'A',day:'bad-date',qty:20},{id:3,team:'A',day:'2026-08-01',qty:30}];
 const r=compile(template(),rows);for(const id of [1,2,3])assert.ok(byIds(r,[id],'meas-qty',rows));
});
test('DR-25 semantic row identity retains a dimension rule when grouped layout becomes pivot',()=>{
 const d=template(false),dim=d.cells.find(c=>c.content.kind==='field'&&c.content.role==='row-dimension');
 const empty={...d,drillRules:[]},fresh=createAdvancedCellDraft(empty,dim);fresh.drill.enabled=true;fresh.dirty.drill=true;
 const rule=buildAdvancedCellUpdate(empty,dim,fresh,{fields}).drillRules[0];
 const pivot=template();pivot.drillRules=[rule];const r=compile(pivot);assert.ok(byIds(r,[1,2,3,4]));
});
test('DR-26 publication rules and predicates are isolated from later source mutations',()=>{
 const d=template();d.regions[0].filters=[{field:'team',operator:'eq',value:'A'}];const r=compile(d);const before=JSON.stringify(r);
 d.drillRules[0].pageSize=100;d.regions[0].filters[0].value='B';assert.equal(JSON.stringify(r),before);
});
test('DR-27 invalid timezone and pagination cannot pass source validation',()=>{
 const d=template();d.drillRules[0].pageSize=0;assert.equal(compileCellReport(d,facts).valid,false);
 d.drillRules[0].pageSize=50;d.cells.find(c=>c.content.timeBucket).content.timeBucket.timezone='Invalid/Nowhere';assert.equal(compileCellReport(d,facts).valid,false);
});
test('DR-28 timezone-aware custom daily buckets remain correct around DST',()=>{
 const config={field:'day',granularity:'custom',customIntervalDays:1,timezone:'America/New_York'};
 assert.equal(formatTimeBucket('2026-03-08T04:30:00Z',config),'2026-03-07');
 assert.equal(formatTimeBucket('2026-03-08T07:30:00Z',config),'2026-03-08');
 const week={field:'day',granularity:'week',timezone:'UTC',weekStartsOn:1};assert.match(formatTimeBucket('2026-08-02T12:00:00Z',week),/^2026-07-27/);
});

test('DR-29 column total and grand total use their actual parent scopes',()=>{
 const d=template(),source=d.cells.find(c=>c.id==='meas-qty');
 for(const [id,parent]of [['column-grand',{row:'none',column:source.parents.column}],['all-grand',{row:'none',column:'none'}]]){
   d.cells.push({...source,id,panelOwner:undefined,position:{row:id==='column-grand'?22:25,column:2},parents:parent,content:{...source.content,metricId:id,expand:'none'}});
   d.drillRules.push({cellId:id,sheetId:'sheet-1',field:'qty',enabled:true,columns:['id'],pageSize:20});
 }
 const r=compile(d);assert.equal(byIds(r,[1,2,5,6],'column-grand').value,2100);assert.equal(byIds(r,[1,2,3,4,5,6,7,8],'all-grand').value,3500);
});
test('DR-30 every point inside a group-span dimension merge resolves to the parent group',()=>{
 const r=compile(template(true,['team','part']));const merge=r.drillIndex.merges.find(m=>m.target.sourceCellId==='cell-row-team'&&ids(r,m.target).join()==='1,2,3,4');
 assert.ok(merge);const target=resolveDrillTarget(r.drillIndex,merge.sheetId,merge.endRow,merge.endCol);assert.equal(target.reason,undefined);assert.deepEqual(ids(r,target),[1,2,3,4]);
});

test('DR-31 instance overrides retain original fact scope and distinguish effective value',()=>{
 const d=template();const original=compile(d),target=byIds(original,[1,2],'meas-qty');const grid=expandCellDrivenTemplate(d,facts).grid;
 const binding=grid.bindings.find(b=>b.target.row===target.row&&b.target.column===target.column);
 d.instanceOverrides=[{instanceKey:binding.instanceKey,templateCellId:'meas-qty',originalBaseValue:900,overrideValue:999,dataRevision:'fixture-v1',status:'active'}];
 const r=compile(d),overridden=byIds(r,[1,2],'meas-qty');assert.equal(overridden.value,999);assert.equal(overridden.baseValue,900);assert.deepEqual(ids(r,overridden),[1,2]);
});

test('DR-32 frozen detail headers and body share the published row-height contract',()=>{
 const sheet={id:'detail',name:'明细',rowCount:5,colCount:1,defaultRowHeight:26,frozenRowCount:3,cells:[{r:3,c:0,v:'first-record'}],merges:[]};
 const plain=adaptPublishedSheetToVTable(sheet).options;assert.equal(plain.rowHeightConfig,undefined);assert.equal(plain.defaultRowHeight,26);
 const sized=adaptPublishedSheetToVTable({...sheet,rowHeights:{0:40}}).options;
 assert.equal(sized.customComputeRowHeight({row:0}),40);assert.equal(sized.customComputeRowHeight({row:3}),26);
});
