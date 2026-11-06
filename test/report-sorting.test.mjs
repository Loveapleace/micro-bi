import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {compilePanelToCellTemplate}=require('../dist/cjs/report-template/panelToTemplateAdapter.js');
const {expandCellDrivenTemplate}=require('../dist/cjs/report-template/cellExpansionEngine.js');
const {compileCellReport}=require('../dist/cjs/report-template/compileCellReport.js');
const {createReportSortEngine,compareReportSortValues,sortSliceId}=require('../dist/cjs/report/reportSort.js');
const {projectReportSheet}=require('../dist/cjs/report/viewProjection.js');
const {adaptPublishedSheetToVTable}=require('../dist/cjs/ui/presentation/report/gridAdapter.js');
const {encodeMemberValue}=require('../dist/cjs/report-template/identity.js');
const facts=[
  {id:'a11',region:'华东',workshop:'A',day:'2026-11-03',qty:80,defects:3},
  {id:'a12',region:'华东',workshop:'A',day:'2026-12-03',qty:200,defects:5},
  {id:'b11',region:'华东',workshop:'B',day:'2026-11-02',qty:120,defects:4},
  {id:'b12',region:'华东',workshop:'B',day:'2026-12-02',qty:50,defects:2},
  {id:'c11',region:'华南',workshop:'C',day:'2026-11-01',qty:90,defects:1},
  {id:'c12',region:'华南',workshop:'C',day:'2026-12-01',qty:300,defects:6},
  {id:'d11',region:'华南',workshop:'D',day:'2026-11-04',qty:100,defects:5},
  {id:'d12',region:'华南',workshop:'D',day:'2026-12-04',qty:40,defects:1},
];
function document(kind='pivot',operation='sum'){
  return compilePanelToCellTemplate({datasetId:'s',dimensions:kind==='detail'?{}:{categories:['region','workshop'],...(kind==='pivot'?{columnTimeBucket:{field:'day',granularity:'month'}}:{})},columns:kind==='detail'
    ?['id','workshop','day','qty'].map(field=>({type:'fixed',field})):[{type:'aggregated',field:'qty',agg:operation,label:'交付件数'},{type:'aggregated',field:'defects',agg:'sum',label:'缺陷件数'}]},'s',{archetype:kind,showRowTotals:true});
}
function rule(doc,{field='workshop',axis='row',order='desc',by='metric',metricField='qty',sliceField,sliceValue}={}){
  const {catalog}=createReportSortEngine(doc,facts);
  const target=catalog.targets.find(target=>target.field===field&&target.axis===axis);
  assert.ok(target,`target ${axis}:${field}`);
  const metric=catalog.metrics.find(metric=>doc.cells.find(cell=>cell.id===metric.sourceCellId)?.content.fieldKey===metricField);
  const sliceTarget=sliceField&&catalog.targets.find(target=>target.field===sliceField&&target.axis===(axis==='row'?'column':'row'));
  return {targetId:target.id,by,order,...(by==='metric'?{metricId:metric.id}:{}),...(sliceTarget?{slice:[{targetId:sliceTarget.id,memberKey:encodeMemberValue(sliceValue)}]}:{})};
}
const workshops=grid=>grid.cells.filter(cell=>cell.sourceCellId==='cell-row-workshop'||cell.sourceCellId==='cell-sec-workshop').sort((a,b)=>a.row-b.row).map(cell=>cell.value);
const columns=grid=>grid.cells.filter(cell=>cell.sourceCellId==='cell-col-day').sort((a,b)=>a.col-b.col).map(cell=>cell.value);

test('SRT-01 detail sorting uses explicit priorities and moves complete records',()=>{
  const doc=document('detail'),catalog=createReportSortEngine(doc,facts).catalog;
  const target=field=>catalog.targets.find(target=>target.field===field).id;
  const rules=[{targetId:target('workshop'),by:'value',order:'asc'},{targetId:target('qty'),by:'value',order:'desc'}];
  const result=compileCellReport(doc,facts,{sortRules:rules});assert.equal(result.valid,true);
  const idSource=doc.cells.find(cell=>cell.content.fieldKey==='id').id;
  assert.deepEqual(result.publication.sheets[0].cells.filter(cell=>cell.sourceCellId===idSource).sort((a,b)=>a.r-b.r).map(cell=>cell.v),['a12','a11','b11','b12','c12','c11','d11','d12']);
  assert.deepEqual(facts.map(record=>record.id),['a11','a12','b11','b12','c11','c12','d11','d12']);
});
test('SRT-02 grouped metric sorting stays inside each parent and keeps merged blocks intact',()=>{
  const doc=document('grouped'),sort=rule(doc);
  const grid=expandCellDrivenTemplate(doc,facts,{sortRules:[sort]}).grid;
  assert.deepEqual(workshops(grid),['A','B','C','D']);
  const asc=expandCellDrivenTemplate(doc,facts,{sortRules:[{...sort,order:'asc'}]}).grid;
  assert.deepEqual(workshops(asc),['B','A','D','C']);
  assert.deepEqual(asc.cells.filter(c=>c.sourceCellId==='cell-pri-region').map(c=>c.value),['华东','华南']);
});
test('SRT-03 a pivot slice sorts entire row member blocks using that month',()=>{
  const doc=document(),sort=rule(doc,{sliceField:'day',sliceValue:'2026-11'});
  const result=compileCellReport(doc,facts,{sortRules:[sort]});assert.equal(result.valid,true);
  const grid=expandCellDrivenTemplate(doc,facts,{sortRules:[sort]}).grid;
  assert.deepEqual(workshops(grid),['B','A','D','C']);
  for(const id of ['cell-row-workshop','cell-row-region'])assert.ok(grid.merges.some(merge=>grid.cells.find(c=>c.row===merge.startRow&&c.col===merge.startCol)?.sourceCellId===id));
  assert.deepEqual(columns(grid),['2026-11','2026-12']);
  const metricValues=grid.cells.filter(c=>c.sourceCellId==='meas-qty').map(c=>c.value).sort((a,b)=>a-b);
  assert.deepEqual(metricValues,[40,50,80,90,100,120,200,300]);
});
test('SRT-04 outer-group and column-member sorting are independent',()=>{
  const doc=document(),outer=rule(doc,{field:'region'}),month=rule(doc,{axis:'column',field:'day',by:'value'});
  const grid=expandCellDrivenTemplate(doc,facts,{sortRules:[outer,month]}).grid;
  assert.deepEqual(grid.cells.filter(c=>c.sourceCellId==='cell-row-region').map(c=>c.value),['华南','华东']);
  assert.deepEqual(columns(grid),['2026-12','2026-11']);
});
test('SRT-05 column metric sorting can use a complete row prefix',()=>{
  const doc=document(),sort=rule(doc,{axis:'column',field:'day',sliceField:'region',sliceValue:'华东',order:'asc'});
  assert.deepEqual(columns(expandCellDrivenTemplate(doc,facts,{sortRules:[sort]}).grid),['2026-11','2026-12']);
  assert.equal(createReportSortEngine(doc,facts,[sort]).issues.length,0);
});
test('SRT-06 removed reference members stay dormant and reapply after data recovery',()=>{
  const doc=document(),sort=rule(doc,{sliceField:'day',sliceValue:'2026-11'});
  const reduced=facts.filter(row=>row.day.includes('-12-'));
  assert.equal(createReportSortEngine(doc,reduced,[sort]).issues[0].code,'WARN_SORT_SLICE_MISSING');
  assert.deepEqual(workshops(expandCellDrivenTemplate(doc,reduced,{sortRules:[sort]}).grid),['A','B','C','D']);
  assert.deepEqual(workshops(expandCellDrivenTemplate(doc,facts,{sortRules:[sort]}).grid),['B','A','D','C']);
  assert.equal(createReportSortEngine(doc,[],[sort]).issues.length,0);
});
test('SRT-07 data insertion, deletion and fact reordering preserve semantic identities',()=>{
  const doc=document(),sort=rule(doc,{sliceField:'day',sliceValue:'2026-11'}),saved=JSON.parse(JSON.stringify(sort));
  const next=[...facts.filter(row=>row.workshop!=='A'),{id:'e',region:'华东',workshop:'E',day:'2026-11-29',qty:900,defects:1}].reverse();
  assert.deepEqual(workshops(expandCellDrivenTemplate(doc,next,{sortRules:[saved]}).grid),['E','B','D','C']);
  assert.equal(createReportSortEngine(doc,next,[saved]).issues.length,0);
});
test('SRT-08 renamed fields, changed granularity and changed aggregation invalidate only the sort rule',()=>{
  const doc=document(),sort=rule(doc,{sliceField:'day',sliceValue:'2026-11'});
  const renamed=structuredClone(doc);renamed.cells.find(c=>c.id==='cell-row-workshop').content.fieldKey='renamed';
  assert.equal(createReportSortEngine(renamed,facts,[sort]).issues[0].code,'WARN_SORT_TARGET');
  const granularity=structuredClone(doc);granularity.cells.find(c=>c.id==='cell-col-day').content.timeBucket.granularity='day';
  assert.equal(createReportSortEngine(granularity,facts,[sort]).issues[0].code,'WARN_SORT_SLICE');
  const aggregate=structuredClone(doc);aggregate.cells.find(c=>c.id==='meas-qty').content.operation='avg';
  assert.equal(createReportSortEngine(aggregate,facts,[sort]).issues[0].code,'WARN_SORT_METRIC');
});
test('SRT-09 custom display captions do not change a sort target identity',()=>{
  const doc=document(),sort=rule(doc),changed=structuredClone(doc);
  changed.cells.find(c=>c.id==='cell-row-workshop').content.displayName='承制车间';
  changed.cells.find(c=>c.id==='meas-qty').content.displayName='数量';
  assert.equal(createReportSortEngine(changed,facts,[sort]).issues.length,0);
});
test('SRT-10 default rules save/reopen and an explicit empty runtime list clears defaults',()=>{
  const doc=document(),sort=rule(doc,{sliceField:'day',sliceValue:'2026-11'});doc.defaultSortRules=[sort];
  const reopened=JSON.parse(JSON.stringify(doc));
  assert.deepEqual(workshops(expandCellDrivenTemplate(reopened,facts).grid),['B','A','D','C']);
  assert.deepEqual(workshops(expandCellDrivenTemplate(reopened,facts,{sortRules:[]}).grid),['A','B','C','D']);
  assert.deepEqual(reopened.defaultSortRules,[sort]);
});
test('SRT-11 comparison keeps nulls last in both directions and treats zero as numeric',()=>{
  for(const order of ['asc','desc']){assert.equal(compareReportSortValues(null,0,order),1);assert.equal(compareReportSortValues('',0,order),1);}
  assert.ok(compareReportSortValues(2,10,'asc')<0);assert.ok(compareReportSortValues('车间2','车间10','asc')<0);
});
test('SRT-12 publish only genuine sortable headers and native icons follow projected coordinates',()=>{
  const doc=document(),sort=rule(doc,{sliceField:'day',sliceValue:'2026-11'}),result=compileCellReport(doc,facts,{sortRules:[sort]});
  const sheet=result.publication.sheets[0];assert.ok(sheet.sortHeaders.length>0);
  const title=sheet.cells.find(cell=>cell.sourceCellId==='title');assert.equal(sheet.sortHeaders.some(h=>h.row===title.r&&h.column===title.c),false);
  const month=sheet.cells.find(cell=>cell.sourceCellId==='cell-col-day'&&cell.v==='2026-11');
  const header=sheet.sortHeaders.find(h=>h.row===month.r&&h.column===month.c);assert.ok(header.related);
  assert.deepEqual(header.related.slice,sort.slice);
  const projection=projectReportSheet(result.publication,sheet.id,Array.from({length:sheet.rowCount},(_,i)=>i),[0,1,2,month.c]);
  const projected=projection.sheets[0],projectedHeader=projected.sortHeaders.find(h=>h.preset.targetId===header.preset.targetId);
  assert.ok(projectedHeader);
  const adapter=adaptPublishedSheetToVTable(projected,result.publication.styles,true);
  assert.equal(adapter.columns[projectedHeader.column].icon({row:projectedHeader.row,col:projectedHeader.column})[0].name,'bi-report-sort');
  const value=projected.cells.find(cell=>cell.sourceCellId==='meas-qty');
  assert.equal(adapter.columns[value.c].icon({row:value.r,col:value.c}).length,0);
});
test('SRT-13 average and business ratio sorting use the same aggregation as report cells',()=>{
  const doc=document('grouped','avg');
  const rows=[{id:'a',region:'华东',workshop:'A',qty:1000,defects:5},{id:'a2',region:'华东',workshop:'A',qty:0,defects:5},{id:'b',region:'华东',workshop:'B',qty:600,defects:7}];
  const avg=rule(doc);assert.deepEqual(workshops(expandCellDrivenTemplate(doc,rows,{sortRules:[avg]}).grid),['B','A']);
  doc.cells.push({id:'ratio',sheetId:'sheet-1',regionId:'region-1',position:{row:3,column:5},parents:{row:'cell-sec-workshop',column:'none'},content:{kind:'business-formula',metricId:'ratio',scope:'summary',expression:'[SUM(defects)]/[SUM(qty)]'}});
  const engine=createReportSortEngine(doc,rows),target=engine.catalog.targets.find(t=>t.field==='workshop'),metric=engine.catalog.metrics.find(m=>m.sourceCellId==='ratio');
  assert.deepEqual(workshops(expandCellDrivenTemplate(doc,rows,{sortRules:[{targetId:target.id,by:'metric',metricId:metric.id,order:'desc'}]}).grid),['B','A']);
});
test('SRT-14 time member comparison is chronological even with custom labels',()=>{
  const doc=document();doc.cells.find(c=>c.id==='cell-col-day').content.timeBucket.format='MM/YYYY';
  const engine=createReportSortEngine(doc,facts),target=engine.catalog.targets.find(t=>t.axis==='column');
  const rows=[{...facts[0],day:'2025-12-01'},{...facts[2],day:'2026-01-01'}];
  assert.deepEqual(columns(expandCellDrivenTemplate(doc,rows,{sortRules:[{targetId:target.id,by:'value',order:'asc'}]}).grid),['12/2025','01/2026']);
});
test('SRT-15 typed slice identities and same-field row/column targets remain distinct',()=>{
  const doc=compilePanelToCellTemplate({dimensions:{categories:['workshop'],columnCategories:['workshop']},columns:[{type:'aggregated',field:'qty',agg:'sum'}]},'s',{archetype:'pivot'});
  const rows=[{id:'a',workshop:1,qty:10},{id:'b',workshop:'1',qty:20}];
  const {catalog}=createReportSortEngine(doc,rows);
  assert.notEqual(catalog.targets.find(t=>t.axis==='row').id,catalog.targets.find(t=>t.axis==='column').id);
  assert.equal(new Set(catalog.slices.filter(s=>s.axis==='column').map(s=>sortSliceId(s.members))).size,2);
});

test('SRT-16 grouped generated metric headers use their metric region when the label is unbound',()=>{
  const doc=document('grouped'),published=compileCellReport(doc,facts).publication,sheet=published.sheets[0];
  const cell=sheet.cells.find(cell=>cell.sourceCellId==='hdr-m-qty');assert.ok(cell);
  const header=sheet.sortHeaders.find(header=>header.row===cell.r&&header.column===cell.c);
  assert.equal(header?.preset.by,'metric');
  assert.equal(published.sortCatalog.targets.find(target=>target.id===header.preset.targetId).field,'workshop');
  assert.equal(published.sortCatalog.metrics.find(metric=>metric.id===header.preset.metricId).sourceCellId,'meas-qty');
});

test('SRT-17 sorting recomputes repeated formulas while custom text and cancelled merges remain intact',()=>{
  const doc=compilePanelToCellTemplate({datasetId:'s',dimensions:{categories:['workshop'],columnTimeBucket:{field:'day',granularity:'month'}},
    columns:[{type:'aggregated',field:'qty',agg:'sum'},{type:'aggregated',field:'defects',agg:'sum'}]},'s');
  doc.cells.push({id:'custom-header',sheetId:'sheet-1',regionId:'region-1',position:{row:2,column:3},parents:{row:null,column:null},content:{kind:'literal',value:'自定义'}},
    {id:'formula',sheetId:'sheet-1',regionId:'region-1',position:{row:4,column:3},parents:{row:null,column:null},content:{kind:'sheet-formula',formula:'=C5*10'}});
  const policy=doc.mergeConfig.policies.find(policy=>policy.target.templateCellId==='cell-pri-workshop'||policy.target.templateCellId==='cell-row-workshop');policy.enabled=false;
  const sort=rule(doc,{sliceField:'day',sliceValue:'2026-11'}),before=JSON.stringify(doc);
  const result=compileCellReport(doc,facts,{sortRules:[sort]});assert.equal(result.valid,true,JSON.stringify(result.diagnostics));
  const sheet=result.publication.sheets[0],header=sheet.cells.find(c=>c.sourceCellId==='custom-header');
  assert.equal(header.v,'自定义');assert.equal(sheet.sortHeaders.some(h=>h.row===header.r&&h.column===header.c),false);
  assert.equal(sheet.merges.some(m=>m.startRow<=header.r&&m.endRow>=header.r&&m.startCol<=header.c&&m.endCol>=header.c),false);
  assert.equal(sheet.merges.some(m=>sheet.cells.find(c=>c.r===m.startRow&&c.c===m.startCol)?.sourceCellId===policy.target.templateCellId),false);
  for(const formula of sheet.cells.filter(c=>c.sourceCellId==='formula')){
    const referenced=/^=([A-Z]+)(\d+)\*10$/.exec(formula.formula);assert.ok(referenced);
    const col=referenced[1].split('').reduce((n,c)=>n*26+c.charCodeAt(0)-64,0)-1;
    assert.equal(formula.v,sheet.cells.find(c=>c.r===Number(referenced[2])-1&&c.c===col).v*10);
  }
  assert.equal(JSON.stringify(doc),before);
});
test('SRT-18 conditional replacement does not change numeric ordering or metric styles',()=>{
  const doc=document('grouped'),qty=doc.cells.find(c=>c.id==='meas-qty');qty.style={...qty.style,color:'#A61D24',fontSize:18};
  doc.presentationRules={version:1,revision:1,ruleSets:[{id:'r',order:0,target:{sheetId:'sheet-1',cellId:qty.id},rules:[{id:'positive',name:'positive',enabled:true,order:0,stopIfTrue:true,
    predicate:{kind:'comparison',left:{kind:'current'},operator:'gte',right:{kind:'literal',value:0}},text:'告警'}]}]};
  const sort=rule(doc,{order:'asc'}),result=compileCellReport(doc,facts,{sortRules:[sort]});assert.equal(result.valid,true);
  const cells=result.publication.sheets[0].cells.filter(c=>c.sourceCellId===qty.id).sort((a,b)=>a.r-b.r);
  assert.deepEqual(cells.map(c=>c.v),[170,280,140,390]);assert.ok(cells.every(c=>c.displayText==='告警'));
  assert.ok(cells.every(c=>result.publication.styles[c.styleId].fontSize===18&&result.publication.styles[c.styleId].color==='#A61D24'));
});
test('SRT-19 sorting refreshes drill coordinates and keeps the corresponding fact scope',()=>{
  const {matchesDrillScope}=require('../dist/cjs/report/drill.js'),doc=document(),qty=doc.cells.find(c=>c.id==='meas-qty');
  doc.drillRules=[{enabled:true,cellId:qty.id,sheetId:'sheet-1',datasetId:'s',field:'qty',columns:['id','workshop','day','qty'],pageSize:50}];
  const sort=rule(doc,{sliceField:'day',sliceValue:'2026-11'}),normal=compileCellReport(doc,facts).publication,sorted=compileCellReport(doc,facts,{sortRules:[sort]}).publication;
  assert.notEqual(normal.drillIndex.revision,sorted.drillIndex.revision);
  for(const target of Object.values(sorted.drillIndex.cells)){
    const scoped=facts.filter(fact=>matchesDrillScope(fact,sorted.drillIndex.scopes[target.scopeId]));
    assert.equal(target.value,scoped.reduce((s,f)=>s+f.qty,0));
    assert.equal(sorted.sheets[0].cells.find(cell=>cell.r===target.row&&cell.c===target.column).v,target.value);
  }
});
