import test from 'node:test';
import assert from 'node:assert/strict';
import { compilePanelToCellTemplate, compileCellReport } from '../dist/esm/report-template/index.js';
import { queryReportRecords, reportPageRows } from '../dist/esm/ui/presentation/report/queryRecords.js';
import { emptyRuntimeQuery, runtimeFields } from '../dist/esm/report/runtimeQuery.js';
import { projectReportSheet, reportColumns } from '../dist/esm/report/viewProjection.js';
import { fieldErrorPublication, missingReportFields } from '../dist/esm/report/fieldDiagnostics.js';
import { resolveDrillTarget } from '../dist/esm/report/drill.js';
import { hostVariableId, referencedHostVariables, resolveHostVariables } from '../dist/esm/report/hostVariables.js';
import { compareTableValues } from '../dist/esm/ui/presentation/table/tableSummary.js';
import { syncDocumentFromWorkbookSnapshot } from '../dist/esm/cell-designer/syncWorkbookToTemplate.js';

const facts=[{id:'1',team:'A',day:'2026-08-01',qty:10,defect:1,code:'00123'},
  {id:'2',team:'A',day:'2026-08-02',qty:20,defect:4,code:'00456'},
  {id:'3',team:'B',day:'2026-08-01',qty:30,defect:3,code:'00789'}];
const template=(pivot=true)=>compilePanelToCellTemplate({datasetId:'source',dimensions:{categories:['team'],...(pivot?{columnTimeBucket:{field:'day',granularity:'day'}}:{})},
  columns:[{type:'aggregated',field:'qty',agg:'sum'},{type:'aggregated',field:'defect',agg:'sum'}]},'source',{showRowTotals:true});

test('PI-01 native VTable filter and sort consume complete facts without modifying the source',()=>{
  const original=JSON.stringify(facts),query={...emptyRuntimeQuery(),filters:[{id:'f',field:'qty',operator:'gte',value:20}],sort:{field:'qty',order:'desc'}};
  const filtered=queryReportRecords(facts,query);
  assert.deepEqual(filtered.map(r=>r.qty),[30,20]);assert.equal(JSON.stringify(facts),original);
  const result=compileCellReport(template(),filtered);assert.equal(result.valid,true);
  const totals=result.publication.sheets[0].cells.filter(c=>c.role==='grand-total'||c.role==='metric-value');
  assert.ok(totals.some(c=>c.v===30));assert.ok(totals.some(c=>c.v===20));
});
test('PI-02 native filtering respects AND/OR and zero, empty and boolean data',()=>{
  const records=[{n:0,flag:false,text:''},{n:5,flag:true,text:null},{n:10,flag:false,text:'ok'}];
  const query={...emptyRuntimeQuery(),filters:[{id:'a',field:'n',operator:'eq',value:0},{id:'b',field:'flag',operator:'eq',value:'false'}]};
  assert.equal(queryReportRecords(records,query).length,1);
  assert.equal(queryReportRecords(records,{...query,match:'or'}).length,2);
  assert.equal(queryReportRecords(records,{...query,filters:[{id:'e',field:'text',operator:'empty'}]}).length,2);
});
test('PI-03 date ranges work on original Date objects and ISO strings',()=>{
  const records=[{day:new Date('2026-08-01T10:00:00Z')},{day:'2026-08-02T10:00:00Z'}];
  const query={...emptyRuntimeQuery(),filters:[{id:'t',field:'day',operator:'between',value:Date.parse('2026-08-01T00:00:00Z'),upper:'2026-08-01T23:59:59Z'}]};
  assert.equal(queryReportRecords(records,query).length,1);
  assert.equal(runtimeFields([{id:'00123',n:0,day:'2026-08-01'}]).find(f=>f.key==='id').type,'text');
});
test('PI-04 SDK pagination windows keep report headers and do not page facts before aggregation',()=>{
  assert.deepEqual(reportPageRows(9,3,0,2),[0,1,2,3,4]);
  assert.deepEqual(reportPageRows(9,3,1,2),[0,1,2,5,6]);
  assert.deepEqual(reportPageRows(3,3,0,50),[0,1,2]);
});
test('PI-05 member sorting changes grouped and pivot dimensions while preserving totals',()=>{
  const doc=template(),before=JSON.stringify(doc);
  const result=compileCellReport(doc,facts,{memberCompare:(field,a,b)=>field==='team'?compareTableValues(a,b,'desc'):undefined});
  assert.equal(result.valid,true);
  const members=result.publication.sheets[0].cells.filter(c=>c.v==='A'||c.v==='B').sort((a,b)=>a.r-b.r);
  assert.equal(members[0].v,'B');assert.equal(JSON.stringify(doc),before);
  assert.ok(result.publication.sheets[0].cells.some(c=>c.v===30));
});
test('PI-06 clipping a merged group carries its original value and keeps the drill scope',()=>{
  const doc=template();doc.drillRules=[{cellId:'meas-defect',sheetId:'sheet-1',enabled:true,columns:['id','team'],pageSize:20}];
  const compiled=compileCellReport(doc,facts),report=compiled.publication,sheet=report.sheets[0];
  const original=JSON.stringify(report);
  const metric=sheet.cells.find(c=>c.v===1&&c.role==='metric-value');assert.ok(metric);
  const target=resolveDrillTarget(report.drillIndex,sheet.id,metric.r,metric.c);assert.ok(target);
  const rows=[0,1,2,metric.r],columns=Array.from({length:sheet.colCount},(_,i)=>i);
  const projected=projectReportSheet(report,sheet.id,rows,columns);
  const moved=resolveDrillTarget(projected.drillIndex,sheet.id,3,metric.c);assert.ok(moved);
  assert.equal(moved.scopeId,target.scopeId);assert.equal(moved.publicationRevision,projected.drillIndex.revision);
  assert.notEqual(projected.drillIndex.revision,report.drillIndex.revision);
  assert.equal(JSON.stringify(report),original);
  assert.ok(projected.sheets[0].cells.some(c=>c.r===3&&c.c===0&&c.v==='A'));
});
test('PI-07 hiding a merge master column retains the merged value without changing publication',()=>{
  const report={version:'1.0',id:'r',createdAt:'',styles:{},sheets:[{id:'s',name:'s',rowCount:2,colCount:3,cells:[{r:0,c:0,v:'标题'},{r:1,c:0,v:1},{r:1,c:1,v:2},{r:1,c:2,v:3}],merges:[{startRow:0,endRow:0,startCol:0,endCol:2}]}]};
  const next=projectReportSheet(report,'s',[0,1],[1,2]);
  assert.equal(next.sheets[0].cells.find(c=>c.r===0&&c.c===0).v,'标题');
  assert.equal(next.sheets[0].merges[0].endCol,1);assert.equal(report.sheets[0].colCount,3);
});
test('PI-08 column identities follow header paths instead of old column numbers',()=>{
  const sheet={id:'s',name:'s',rowCount:3,colCount:2,frozenRowCount:1,cells:[{r:0,c:0,v:'车间'},{r:0,c:1,v:'2026-08-02'}],merges:[]};
  const original=reportColumns(sheet).find(c=>c.label==='2026-08-02');
  const inserted={...sheet,colCount:3,cells:[{r:0,c:0,v:'车间'},{r:0,c:1,v:'2026-08-01'},{r:0,c:2,v:'2026-08-02'}]};
  assert.equal(reportColumns(inserted).find(c=>c.label==='2026-08-02').key,original.key);
});
test('PI-09 renamed fields are red diagnostics with template geometry retained and no remapping',()=>{
  const doc=template(),before=JSON.stringify(doc),missing=missingReportFields(doc,['team','day','newQty','defect']);
  assert.deepEqual(missing,['qty']);
  const publication=fieldErrorPublication(doc,missing),sheet=publication.sheets[0];
  assert.ok(sheet.cells.some(c=>c.styleId==='missing'&&String(c.v).includes('qty')));
  assert.equal(publication.styles.missing.color,'#CF1322');
  assert.ok(sheet.merges.every(m=>m.endCol<sheet.colCount&&m.endRow<sheet.rowCount));
  assert.equal(JSON.stringify(doc),before);
});
test('PI-10 scalar host variables preserve 0, false, blank and null and never mutate source tokens',()=>{
  const doc=template(false);for(const [i,id]of ['zero','flag','blank','empty'].entries())doc.cells.push({id, sheetId:'sheet-1',position:{row:0,column:3+i},parents:{row:'none',column:'none'},content:{kind:'literal',value:`{{${id}}}`}});
  const original=JSON.stringify(doc),next=resolveHostVariables(doc,{zero:0,flag:false,blank:'',empty:null});
  assert.deepEqual(next.cells.slice(-4).map(c=>c.content.value),[0,false,'',null]);
  assert.equal(JSON.stringify(doc),original);assert.deepEqual(referencedHostVariables(doc),['zero','flag','blank','empty']);
  assert.equal(hostVariableId('{{ address }}'),'address');assert.equal(hostVariableId('text {{address}}'),undefined);
});
test('PI-11 variable numbers take part in sheet formulas and values beginning with equals remain text',()=>{
  const doc=template(false);doc.cells.push(
    {id:'v',sheetId:'sheet-1',position:{row:0,column:3},parents:{row:'none',column:'none'},content:{kind:'literal',value:'{{factor}}'}},
    {id:'f',sheetId:'sheet-1',position:{row:0,column:4},parents:{row:'none',column:'none'},content:{kind:'sheet-formula',formula:'=D1*2'}});
  const before=JSON.stringify(doc),first=compileCellReport(doc,facts,{variableValues:{factor:7}});
  assert.equal(first.valid,true);assert.ok(first.publication.sheets[0].cells.some(c=>c.formula&&c.v===14));
  const text=resolveHostVariables(doc,{factor:'=SUM(1,2)'}).cells.find(c=>c.id==='v');
  assert.equal(text.content.kind,'literal');assert.equal(text.content.value,'=SUM(1,2)');assert.equal(JSON.stringify(doc),before);
});
test('PI-12 missing or removed variable values are visible rather than retaining stale data',()=>{
  const doc=template(false);doc.cells.push({id:'v',sheetId:'sheet-1',position:{row:0,column:3},parents:{row:'none',column:'none'},content:{kind:'literal',value:'{{address}}'}});
  assert.equal(resolveHostVariables(doc,{address:'new'}).cells.at(-1).content.value,'new');
  assert.match(resolveHostVariables(doc,{}).cells.at(-1).content.value,/变量未提供：address/);
  assert.match(resolveHostVariables(doc,{address:undefined}).cells.at(-1).content.value,/变量未提供/);
});
test('PI-13 literal dotted field names use the native SDK without coercing their values',()=>{
  const records=[{'设备.温度':20},{'设备.温度':5}];
  assert.deepEqual(queryReportRecords(records,{...emptyRuntimeQuery(),sort:{field:'设备.温度',order:'asc'}}).map(r=>r['设备.温度']),[5,20]);
});
test('PI-14 host variable tokens are captured as source literals rather than discarded as field placeholders',()=>{
  const doc=template(),snapshot={sheets:{'sheet-1':{cellData:{1:{0:{v:'{{address}}',t:4}}}}}};
  const synced=syncDocumentFromWorkbookSnapshot(doc,snapshot,'design');
  assert.ok(synced.cells.some(c=>c.content.kind==='literal'&&c.content.value==='{{address}}'));
  assert.ok(compileCellReport(synced,facts,{variableValues:{address:'厂区A'}}).publication.sheets[0].cells.some(c=>c.v==='厂区A'));
});
test('PI-15 time range remains an outer AND constraint when other conditions use OR',()=>{
  const query={...emptyRuntimeQuery(),match:'or',timeRange:{field:'day',from:'2026-08-01T00:00:00Z',to:'2026-08-01T23:59:59Z'},
    filters:[{id:'a',field:'team',operator:'eq',value:'A'},{id:'b',field:'team',operator:'eq',value:'B'}]};
  assert.deepEqual(queryReportRecords(facts,query).map(r=>r.id),['1','3']);
});
test('PI-16 incomplete numeric conditions do not accidentally become comparisons against zero',()=>{
  assert.equal(queryReportRecords(facts,{...emptyRuntimeQuery(),filters:[{id:'x',field:'qty',operator:'eq'}]}).length,3);
});
test('PI-17 global variable text and edited captions do not change the identity of a report column',()=>{
  const sheet={id:'s',name:'s',rowCount:4,colCount:1,cells:[{r:0,c:0,v:'厂区A',role:'custom',sourceCellId:'variable-address'},{r:2,c:0,v:'车间',role:'custom',sourceCellId:'hdr-row-name'}],merges:[]};
  const first=reportColumns(sheet,3)[0];
  assert.equal(first.label,'车间');
  const edited={...sheet,cells:[{...sheet.cells[0],v:'厂区B'},{...sheet.cells[1],v:'承制车间'}]};
  assert.equal(reportColumns(edited,3)[0].key,first.key);
});

test('PI-18 compiled pivot columns keep semantic identities when earlier members are inserted',()=>{
  const doc=template();
  const headerRows=Math.min(...doc.cells.filter(c=>c.content.kind==='field'&&c.content.role!=='column-dimension').map(c=>c.position.row));
  const first=compileCellReport(doc,facts).publication.sheets[0];
  const before=reportColumns(first,headerRows).find(c=>c.label.includes('2026-08-02'));
  const next=compileCellReport(doc,[{id:'early',team:'A',day:'2026-07-31',qty:5,defect:0},...facts.slice().reverse()]).publication.sheets[0];
  const after=reportColumns(next,headerRows).find(c=>c.label.includes('2026-08-02'));
  assert.ok(before);assert.ok(after);assert.equal(after.key,before.key);assert.notEqual(after.index,before.index);
});
