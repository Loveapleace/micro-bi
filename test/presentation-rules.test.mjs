import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compilePanelToCellTemplate } from '../dist/esm/report-template/panelToTemplateAdapter.js';
import { compileCellReport } from '../dist/esm/report-template/compileCellReport.js';
import { expandCellDrivenTemplate } from '../dist/esm/report-template/cellExpansionEngine.js';
import { normalizeCellTemplate } from '../dist/esm/report-template/normalizeCellTemplate.js';
import { expandCellTemplate } from '../dist/esm/report-template/expandTemplate.js';
import { targetForCell, emptyPresentationRules } from '../dist/esm/report-template/presentationTypes.js';
import { applyPresentationRules, normalizeRuleColor, validatePresentationRules } from '../dist/esm/report-template/presentationRules.js';
import { biGridToUniverWorksheetData, publishedStyleToUniver } from '../dist/esm/report/buildBiGrid.js';
import { adaptPublishedSheetToVTable, publishedSheetToTsv } from '../dist/esm/ui/presentation/report/gridAdapter.js';
import { syncDocumentFromWorkbookSnapshot } from '../dist/esm/cell-designer/syncWorkbookToTemplate.js';
import { HybridHistory } from '../dist/esm/cell-designer/hybridHistory.js';
import { mergeHybridCells, collectHybridExtras } from '../dist/esm/cell-designer/hybridTemplateState.js';
import { setPresentation } from './helpers/presentation.mjs';

const facts=JSON.parse(readFileSync(new URL('./fixtures/presentation-facts.json',import.meta.url),'utf8'));
const clone=structuredClone;
const baseConfig={datasetId:'orders',headers:{order_code:'订单',part_name:'工件',workshop:'车间',output_qty:'交付',defect_count:'缺陷'},dimensions:{},columns:['order_code','part_name','workshop','output_qty'].map(field=>({type:'aggregated',field,agg:field==='output_qty'?'sum':'count'}))};
const detail=()=>compilePanelToCellTemplate(clone(baseConfig),'orders',{formats:{output_qty:'decimal2'}});
const source=(doc,field='output_qty')=>doc.cells.find(c=>c.content.kind==='field'&&c.content.fieldKey===field&&!c.id.startsWith('meas-rowtotal-')&&!c.content.role.endsWith('dimension'));
const value=(n)=>({kind:'literal',value:n});
const cmp=(operator,n,left={kind:'current'})=>({kind:'comparison',left,operator,right:value(n)});
const group=(mode,...children)=>({kind:'group',mode,children});
const rule=(id,predicate,options={})=>({id,name:id,enabled:true,order:0,predicate,stopIfTrue:true,...options});
function configure(doc,rules,field='output_qty'){
  const cell=source(doc,field);doc.presentationRules={version:1,revision:1,ruleSets:[{id:'set-'+cell.id,order:0,target:targetForCell(cell),rules:rules.map((r,i)=>({...r,order:i}))}]};return doc;
}
function statusDoc(){return configure(detail(),[
  rule('low',cmp('lt',700),{text:'低产',style:{scope:'row',style:{color:'#CF1322',backgroundColor:'#FFE6E6'}}}),
  rule('mid',group('and',cmp('gte',700),cmp('lt',1000)),{text:'关注',style:{scope:'cell',style:{color:'#D46B08',backgroundColor:'#FFFBE6'}}}),
  rule('ok',cmp('gte',1000),{text:'正常',style:{scope:'cell',style:{color:'#389E0D',backgroundColor:'#F6FFED'}}}),
]);}
function output(doc,data=facts){const compiled=compileCellReport(doc,data);assert.equal(compiled.valid,true,JSON.stringify(compiled.diagnostics));const grid=expandCellDrivenTemplate(doc,data).grid;return {compiled,grid,sheet:compiled.publication.sheets[0],table:adaptPublishedSheetToVTable(compiled.publication.sheets[0],compiled.publication.styles)};}
const quantities=(grid,doc)=>grid.cells.filter(c=>c.sourceCellId===source(doc).id);
const count=(grid,text)=>grid.cells.filter(c=>c.displayText===text).length;
function staticDoc(values){return {documentType:'cell-template',schemaVersion:'2.0',capabilitiesVersion:'cell-expansion-v2',id:'static',title:'static',templateRevision:1,sheets:[{id:'sheet-1',name:'静态'}],regions:[],cells:values.map((v,i)=>({id:'s'+i,sheetId:'sheet-1',position:{row:i,column:0},content:{kind:'literal',value:v},parents:{row:'none',column:'none'}})),styleRules:[],layoutRules:[],instanceOverrides:[],orphanedEdits:[],presentationRules:emptyPresentationRules()};}

test('CR-01 valid zero-match numeric conditions have no false alert',()=>{
  const doc=detail();setPresentation(doc,source(doc).id,{threshold:90,style:{color:'#CF1322'}});const {grid}=output(doc);assert.equal(grid.ruleStatistics[0].matched,0);assert.equal(quantities(grid,doc).length,13);
});
test('CR-02 threshold1000 matches exactly nine raw values through publication and VTable',()=>{
  const doc=detail();setPresentation(doc,source(doc).id,{threshold:1000,style:{color:'#CF1322'}});const {grid,sheet,compiled,table}=output(doc);
  assert.equal(grid.ruleStatistics[0].matched,9);assert.equal(sheet.cells.filter(c=>compiled.publication.styles[c.styleId]?.color==='#CF1322').length,9);
  assert.equal(table.rawRecords[3].col_3,600);assert.equal(table.columns[3].fieldFormat(table.rawRecords[3]),'600.00');
});
test('CR-03 multiple rules and AND ranges produce5/4/4 without changing numeric total',()=>{
  const doc=statusDoc();const {grid,sheet}=output(doc);assert.deepEqual(['低产','关注','正常'].map(t=>count(grid,t)),[5,4,4]);assert.equal(quantities(grid,doc).reduce((s,c)=>s+c.value,0),10850);assert.equal(sheet.cells.filter(c=>c.c===3&&typeof c.v==='number').reduce((s,c)=>s+c.v,0),10850);
});
test('CR-04 nested OR/AND tree remains intact and uses actual truth values',()=>{
  const doc=configure(detail(),[rule('nested',group('and',group('or',cmp('lt',700),cmp('gte',1200)),cmp('ne',300)),{text:'命中'})]);const {grid}=output(doc);assert.equal(count(grid,'命中'),7);assert.deepEqual(doc.presentationRules,clone(doc.presentationRules));
});
test('CR-05 field references use the same record after sorting',()=>{
  const doc=configure(detail(),[rule('cross',group('and',cmp('lt',700),cmp('gte',10,{kind:'field',field:'defect_count'})),{text:'双条件'})]);
  for(const data of [facts,[...facts].reverse()]){const {grid}=output(doc,data);assert.equal(count(grid,'双条件'),1);assert.equal(grid.cells.find(c=>c.displayText==='双条件').value,450);}
});
test('CR-06 grouped raw-field ambiguity is diagnosed; explicit aggregation works',()=>{
  const doc=compilePanelToCellTemplate({...baseConfig,dimensions:{categories:['workshop']},columns:[{type:'aggregated',field:'output_qty',agg:'sum'}]},'orders');
  configure(doc,[rule('ambiguous',cmp('gt',700,{kind:'field',field:'output_qty'}),{text:'组'})]);assert.equal(compileCellReport(doc,facts).valid,false);
  doc.presentationRules.ruleSets[0].rules[0].predicate.left.agg='avg';assert.equal(output(doc).grid.cells.filter(c=>c.displayText==='组').length,3);
});
test('CR-07 stopped rules are not evaluated; disabling stop allows ordered overrides',()=>{
  const doc=configure(detail(),[rule('first',cmp('gt',0),{text:'一'}),rule('second',cmp('gt',0),{text:'二'})]);let {grid}=output(doc);assert.equal(count(grid,'一'),13);assert.equal(grid.ruleStatistics[1].blocked,13);
  doc.presentationRules.ruleSets[0].rules[0].stopIfTrue=false;grid=output(doc).grid;assert.equal(count(grid,'二'),13);
});
test('CR-08 fixed/template/empty display actions preserve raw numeric value',()=>{
  const doc=detail();source(doc).formatOptions={precision:1,suffix:'件'};configure(doc,[rule('caption',cmp('eq',600),{text:'{fieldLabel}：{formatted} / {value}'})]);let r=output(doc);assert.equal(count(r.grid,'交付：600.0件 / 600'),1);
  doc.presentationRules.ruleSets[0].rules[0].text='';r=output(doc);assert.equal(r.sheet.cells.find(c=>c.r===3&&c.c===3).v,600);assert.equal(r.sheet.cells.find(c=>c.r===3&&c.c===3).displayText,'');
});
test('CR-09 source formulas and workbook raw cells use600 despite low-production display',()=>{
  const doc=statusDoc();doc.cells.push({id:'formula',sheetId:'sheet-1',position:{row:6,column:9},parents:{row:'none',column:'none'},content:{kind:'sheet-formula',formula:'=SUM(D4:D16)'}});
  const {grid,sheet}=output(doc);const workbook=biGridToUniverWorksheetData(grid);assert.equal(workbook.cellData[3][3].v,600);assert.equal(workbook.cellData[3][3].t,2);assert.equal(workbook.cellData[3][3].custom.displayText,'低产');assert.ok(sheet.cells.some(c=>c.v===10850&&c.formula==='=SUM(D4:D16)'));
});
test('CR-10 empty,zero,false and numeric strings have distinct predicates',()=>{
  const doc=staticDoc([null,'',0,false,'0','   ',NaN]);for(const c of doc.cells)doc.presentationRules.ruleSets.push({id:'set-'+c.id,order:doc.presentationRules.ruleSets.length,target:targetForCell(c),rules:[rule('empty-'+c.id,{kind:'comparison',left:{kind:'current'},operator:'empty'},{text:'空'}),rule('zero-'+c.id,cmp('eq',0),{text:'零'})]});
  const values=doc.cells.map(c=>c.content.value),gridInput=expandCellDrivenTemplate(doc,[]).grid;
  doc.cells.forEach((c,i)=>{c.content={kind:'field',fieldId:'f'+i,fieldKey:'f'+i,role:'detail-column',operation:'list',expand:'down'};doc.presentationRules.ruleSets[i].target=targetForCell(c);});
  const grid=applyPresentationRules(doc,gridInput,[]).grid;assert.equal(count(grid,'空'),3);assert.equal(count(grid,'零'),1);assert.equal(grid.cells.find(c=>c.sourceCellId==='s3').value,false);assert.equal(grid.cells.find(c=>c.sourceCellId==='s4').displayText,'0');assert.equal(values[3],false);
});
test('CR-11 comparisons use an explicit display scale, never parsed unit strings',()=>{
  const doc=detail();source(doc).formatOptions={scale:1000,prefix:'约',suffix:'千件',precision:2};configure(doc,[rule('scale',cmp('lt',0.7,{kind:'current',basis:'display-number'}),{text:'小量'})]);assert.equal(count(output(doc).grid,'小量'),5);assert.equal(output(doc).sheet.cells.find(c=>c.r===3&&c.c===3).v,600);
});
test('CR-12 re-evaluation removes old text and row colors on changed threshold/disabled rules',()=>{
  const doc=statusDoc();const old=output(doc).grid;doc.presentationRules.ruleSets[0].rules.forEach(r=>r.enabled=false);const next=applyPresentationRules(doc,old,facts).grid;assert.equal(count(next,'低产'),0);assert.equal(next.cells.some(c=>c.style?.bgColor==='#FFE6E6'),false);assert.equal(next.cells.find(c=>c.row===3&&c.col===3).displayText,'600.00');
});
test('CR-13 green and custom colors round-trip without falling back to red',()=>{
  const doc=detail();setPresentation(doc,source(doc).id,{threshold:1000,style:{color:'#389e0d',backgroundColor:'rgb(12,34,56)'}});const before=output(doc).grid,after=output(clone(doc)).grid;assert.deepEqual(after,before);assert.equal(after.cells.find(c=>c.row===3&&c.col===3).style.color,'#389E0D');assert.equal(after.cells.find(c=>c.row===3&&c.col===3).style.bgColor,'#0C2238');
});
test('CR-14 template direct compile produces display actions without a preceding preview',()=>{
  const doc=statusDoc(),published=compileCellReport(doc,facts);assert.equal(published.valid,true);assert.equal(published.publication.sheets[0].cells.filter(c=>c.displayText==='低产').length,5);
});
test('CR-15 JSON save/reopen keeps every rule/tree/action/id/stop marker',()=>{
  const doc=statusDoc();const saved=clone(doc);assert.deepEqual(saved.presentationRules,doc.presentationRules);assert.deepEqual(output(saved).table.records,output(doc).table.records);
});
test('CR-16 an untouched projected snapshot creates no artificial value/style overrides',()=>{
  const doc=statusDoc();const {grid}=output(doc);const sheet=biGridToUniverWorksheetData(grid);const synced=syncDocumentFromWorkbookSnapshot(doc,{sheets:{'sheet-1':sheet}},'preview',grid);assert.equal(synced.instanceOverrides.length,0);assert.deepEqual(synced.presentationRules,doc.presentationRules);assert.deepEqual(synced.styleRules,doc.styleRules);
});
test('CR-17 raw snapshots keep field bindings while native style deltas become explicit cell rules',()=>{
  const doc=detail(),qty=source(doc);doc.styleRules=[{id:'row',sheetId:'sheet-1',regionId:'region-1',scope:'row',targetId:qty.id,style:{backgroundColor:'#E6F7FF'},priority:0}];
  const design={type:'detail',rowCount:25,colCount:15,cells:doc.cells.map(c=>({row:c.position.row,col:c.position.column,value:c.content.kind==='literal'?c.content.value:'{字段}',displayText:c.content.kind==='literal'?String(c.content.value):'{字段}',role:'custom',sourceCellId:c.id,regionId:c.regionId,style:{}})),bindings:[],merges:[]};
  const projected=applyPresentationRules(doc,design,[],{conditions:false}).grid;let snapshot={sheets:{'sheet-1':biGridToUniverWorksheetData(projected)}};
  let synced=syncDocumentFromWorkbookSnapshot(doc,snapshot,'design',projected);assert.equal(synced.styleRules.length,1);assert.equal(synced.cells.find(c=>c.id===qty.id).style?.backgroundColor,qty.style?.backgroundColor);
  snapshot.sheets['sheet-1'].cellData[qty.position.row][qty.position.column].s={...publishedStyleToUniver(projected.cells.find(c=>c.sourceCellId===qty.id).style),fs:18};
  synced=syncDocumentFromWorkbookSnapshot(doc,snapshot,'design',projected);const native=synced.styleRules.find(r=>r.scope==='template-cell');assert.equal(native.style.fontSize,18);assert.equal(native.style.backgroundColor,undefined);assert.equal(synced.cells.find(c=>c.id===qty.id).content.kind,'field');
});
test('CR-19 data insertion/deletion/reverse recompute conditions without stale positions',()=>{
  const doc=statusDoc();const added=[...facts,{...facts[0],order_code:'NEW',output_qty:321}];assert.equal(count(output(doc,added).grid,'低产'),6);assert.equal(count(output(doc,facts.filter(r=>r.output_qty>=700)).grid,'低产'),0);const a=output(doc,facts).sheet,b=output(doc,[...facts].reverse()).sheet;assert.deepEqual(a.cells.filter(c=>c.c===3&&typeof c.v==='number').map(c=>[c.v,c.displayText]).sort(),b.cells.filter(c=>c.c===3&&typeof c.v==='number').map(c=>[c.v,c.displayText]).sort());
});
test('CR-20 field semantics rebind after detail-to-pivot layout changes rather than by coordinates',()=>{
  const d=statusDoc();const pivot=compilePanelToCellTemplate({...baseConfig,dimensions:{categories:['workshop'],columnTimeBucket:{field:'plan_start_time',granularity:'day'}},columns:[{type:'aggregated',field:'output_qty',agg:'sum'}]},'orders');pivot.presentationRules=d.presentationRules;assert.equal(output(pivot).grid.ruleStatistics[0].targets,15);assert.equal(pivot.presentationRules.ruleSets[0].target.cellId,source(d).id);
});
test('CR-21 temporarily unselected targets retain rules and restore on reselect without leaking',()=>{
  const doc=statusDoc(),qty=source(doc);const fewer=compilePanelToCellTemplate({...baseConfig,columns:baseConfig.columns.filter(c=>c.field!=='output_qty')},'orders');fewer.presentationRules=doc.presentationRules;const r=output(fewer);assert.equal(count(r.grid,'低产'),0);assert.ok(r.compiled.diagnostics.some(d=>d.code==='WARN_RULE_DORMANT'));const restored=clone(doc);assert.equal(count(output(restored).grid,'低产'),5);assert.equal(restored.presentationRules.ruleSets[0].target.cellId,qty.id);
});
test('CR-22 total roles require an explicit target/role selection',()=>{
  const doc=compilePanelToCellTemplate({...baseConfig,dimensions:{categories:['workshop'],columnTimeBucket:{field:'plan_start_time',granularity:'day'}},columns:[{type:'aggregated',field:'output_qty',agg:'sum'}]},'orders',{showRowTotals:true});configure(doc,[rule('status',cmp('gt',0),{text:'数据'})]);let grid=output(doc).grid;assert.equal(grid.cells.some(c=>c.sourceCellId?.startsWith('meas-rowtotal-')&&c.displayText==='数据'),false);doc.presentationRules.ruleSets[0].target.kind='field';doc.presentationRules.ruleSets[0].target.roles=['total'];grid=output(doc).grid;assert.equal(grid.cells.filter(c=>c.displayText==='数据').length,3);
});
test('CR-23 static condition targets are invalid and cannot silently replace static content',()=>{
  const doc=staticDoc([600,1200]);setPresentation(doc,'s0',{threshold:700,text:'低产',style:{color:'#123456'}});const r=compileCellReport(doc,[]);assert.equal(r.valid,false);assert.ok(r.diagnostics.some(d=>d.code==='ERR_STATIC_CONDITION'));const g=expandCellDrivenTemplate(doc,[]).grid;assert.equal(g.cells[0].value,600);assert.equal(g.cells[0].displayText,'600');
});
test('CR-24 per-group static spans retain contextual layout but reject conditional static targets',()=>{
  const doc=compilePanelToCellTemplate({...baseConfig,dimensions:{categories:['workshop']},columns:[{type:'aggregated',field:'output_qty',agg:'sum'}]},'orders');const parent=doc.cells.find(c=>c.content.kind==='field'&&c.content.role==='row-dimension');doc.cells.push({id:'caption',sheetId:'sheet-1',regionId:'region-1',position:{row:9,column:6},parents:{row:'none',column:'none'},content:{kind:'literal',value:'审核'},staticSpan:{id:'span-caption',enabled:true,regionId:'region-1',scope:'report',placement:'before-group',repeat:'row-groups',rowParentId:parent.id,rowOffset:0,height:1,includeTotals:true,merge:false,suppressions:[]}});setPresentation(doc,'caption',{predicate:cmp('gt',4000,{kind:'field',field:'output_qty',agg:'sum'}),text:'{rowLabel}：复核'});assert.equal(compileCellReport(doc,facts).valid,false);doc.presentationRules=emptyPresentationRules();const {grid}=output(doc);const captions=grid.cells.filter(c=>c.sourceCellId==='caption');assert.equal(captions.length,3);assert.ok(captions.every(c=>c.displayText==='审核'));assert.equal(grid.staticSpanInstances.filter(i=>i.templateCellId==='caption').every(i=>!i.merged),true);
});
test('CR-25 identical final status text does not create numeric merges',()=>{
  const doc=statusDoc();const grid=output(doc).grid;const low=quantities(grid,doc).filter(c=>c.displayText==='低产');assert.equal(new Set(low.map(c=>c.value)).size,5);assert.equal(grid.merges.some(m=>m.startCol===3&&m.endRow>m.startRow),false);
});
test('CR-26 display/raw copy and actual VTable raw records preserve two explicit meanings',()=>{
  const doc=statusDoc();const {sheet,table}=output(doc);const range={start:{row:3,col:3},end:{row:3,col:3}};assert.equal(publishedSheetToTsv(sheet,'display',range),'低产');assert.equal(publishedSheetToTsv(sheet,'raw',range),'600');assert.equal(table.rawRecords[3].col_3,600);assert.equal(table.columns[3].fieldFormat(table.rawRecords[3]),'低产');
});
test('CR-27 invalid new presentation rules still fail validation',()=>{
  for(const modify of [d=>d.presentationRules.version=2,d=>d.presentationRules.ruleSets[0].rules[0].predicate.operator='bogus',d=>d.presentationRules.ruleSets[0].rules[0].style.style.color='#XYZ',d=>d.presentationRules.ruleSets[0].rules[0].text='{missing}']){const d=statusDoc();modify(d);assert.equal(compileCellReport(d,facts).valid,false);}
});
test('CR-28 rule revisions refresh publication and bounded diagnostics remain current',()=>{
  const doc=statusDoc();const before=output(doc).sheet;doc.presentationRules.revision++;doc.presentationRules.ruleSets[0].rules[0].text='新低产';const after=output(doc);assert.equal(count(after.grid,'新低产'),5);assert.notDeepEqual(after.sheet.cells,before.cells);assert.ok(after.grid.ruleStatistics.every(s=>s.samples.length<=3));
});
test('CR-29 normal row/cell style targets are independent from conditional text',()=>{
  const doc=detail(),q=source(doc);doc.styleRules=[{id:'normal',sheetId:'sheet-1',regionId:'region-1',targetId:q.id,target:targetForCell(q),scope:'template-cell',style:{backgroundColor:'#123456'},priority:0}];let r=output(doc);assert.equal(r.grid.cells.filter(c=>c.style.bgColor==='#123456').length,13);doc.styleRules[0].scope='row';r=output(doc);assert.equal(r.grid.cells.filter(c=>c.style.bgColor==='#123456').length,52);assert.equal(doc.styleRules.length,1);
});
test('CR-30 five row triggers style20 cells but replace only five quantity texts',()=>{
  const doc=statusDoc();const r=output(doc);assert.equal(r.grid.ruleStatistics[0].affectedCells,20);assert.equal(r.grid.ruleStatistics[0].affectedRows,5);assert.equal(r.grid.cells.filter(c=>c.style.bgColor==='#FFE6E6').length,20);assert.equal(r.sheet.cells.filter(c=>c.displayText==='低产'&&c.c!==3).length,0);
});
test('CR-31 pivot whole-row colors include dynamic columns and row totals but not header rows',()=>{
  const doc=compilePanelToCellTemplate({...baseConfig,dimensions:{categories:['workshop'],columnTimeBucket:{field:'plan_start_time',granularity:'day'}},columns:[{type:'aggregated',field:'output_qty',agg:'sum'}]},'orders',{showRowTotals:true});configure(doc,[rule('all',cmp('gte',0),{style:{scope:'row',style:{backgroundColor:'#112233'}}})]);const r=output(doc);assert.equal(r.grid.cells.filter(c=>c.row===0&&c.style?.bgColor==='#112233').length,0);const totals=r.grid.cells.filter(c=>c.sourceCellId?.startsWith('meas-rowtotal-'));assert.equal(totals.length,3);assert.ok(totals.every(c=>c.style.bgColor==='#112233'));
});
test('CR-32 row footprint excludes reserved columns and far-away free notes',()=>{
  const doc=statusDoc();doc.cells.push({id:'far',sheetId:'sheet-1',position:{row:3,column:20},content:{kind:'literal',value:'独立备注'},parents:{row:'none',column:'none'}});const {grid}=output(doc);assert.equal(grid.cells.find(c=>c.sourceCellId==='far').style?.bgColor,undefined);assert.equal(grid.ruleStatistics[0].affectedCells,20);
});
test('CR-33 partial vertically merged parent remains untouched; complete matching rows color it',()=>{
  const doc=compilePanelToCellTemplate({...baseConfig,dimensions:{categories:['workshop','part_name']},columns:[{type:'aggregated',field:'output_qty',agg:'sum'}]},'orders');configure(doc,[rule('partial',cmp('gt',2000),{style:{scope:'row',style:{backgroundColor:'#FF0000'}}})]);let r=output(doc);const parent=r.grid.cells.find(c=>c.value==='1号五轴切削车间');assert.notEqual(parent.style.bgColor,'#FF0000');assert.ok(r.grid.ruleStatistics[0].skippedMerges>0);doc.presentationRules.ruleSets[0].rules[0].predicate=cmp('gt',0);r=output(doc);assert.equal(r.grid.cells.find(c=>c.value==='1号五轴切削车间').style.bgColor,'#FF0000');
});
test('CR-34 conditional cell specificity wins over row styles; stable order is deterministic',()=>{
  const doc=statusDoc(),order=source(doc,'order_code');doc.presentationRules.ruleSets.push({id:'order-style',order:99,target:targetForCell(order),rules:[rule('blue',{kind:'comparison',left:{kind:'current'},operator:'notEmpty'},{style:{scope:'cell',style:{color:'#0000FF'}}})]});const r=output(doc);assert.equal(r.grid.cells.find(c=>c.row===3&&c.col===0).style.color,'#0000FF');assert.equal(r.grid.cells.find(c=>c.row===3&&c.col===1).style.color,'#CF1322');assert.deepEqual(output(clone(doc)).table.records,r.table.records);
});
test('CR-35 HEX/RGB and explicit reset/no-fill/false values map consistently',()=>{
  assert.equal(normalizeRuleColor('#abc'),'#AABBCC');assert.equal(normalizeRuleColor('rgb(12,34,56)'),'#0C2238');assert.equal(normalizeRuleColor('rgb(999,0,0)'),undefined);
  const doc=detail();configure(doc,[rule('row',cmp('gt',0),{stopIfTrue:false,style:{scope:'row',style:{backgroundColor:'#123456',bold:true}}}),rule('reset',cmp('eq',600),{style:{scope:'cell',style:{bold:false},noFill:true}})]);const r=output(doc);const c=r.grid.cells.find(c=>c.row===3&&c.col===3);assert.equal(c.style.bgColor,undefined);assert.equal(r.table.columns[3].style({row:3}).fontWeight,'normal');assert.equal(biGridToUniverWorksheetData(r.grid).cellData[3][3].s.bl,0);
});
test('CR-36 rule draft edits do not mutate source or grow history until committed',()=>{
  const original=statusDoc(),draft=clone(original);for(let i=0;i<30;i++)draft.presentationRules.ruleSets[0].rules[0].style.style.color='#'+i.toString(16).padStart(6,'0');assert.equal(original.presentationRules.ruleSets[0].rules[0].style.style.color,'#CF1322');let restored;const history=new HybridHistory(s=>restored=s);history.commit(original,draft);assert.equal(history.count,1);history.moveTo(0);assert.deepEqual(restored,original);
});
test('CR-37 color/scope edits round-trip and undo together with all rules',()=>{
  const doc=statusDoc(),next=clone(doc);next.presentationRules.ruleSets[0].rules[0].style.scope='cell';next.presentationRules.ruleSets[0].rules[0].style.style.backgroundColor='#010203';let restored;const h=new HybridHistory(s=>restored=s);h.commit(doc,next);h.moveTo(0);assert.equal(output(restored).grid.ruleStatistics[0].affectedCells,20);h.moveTo(1);assert.equal(output(clone(restored)).grid.ruleStatistics[0].affectedCells,5);assert.equal(output(restored).grid.cells.find(c=>c.row===3&&c.col===3).style.bgColor,'#010203');
});
test('CR-38 disabling row action cleans previous row fill and preserves text/value/merge intent',()=>{
  const doc=statusDoc(),before=output(doc).grid;doc.presentationRules.ruleSets[0].rules[0].style=undefined;const next=applyPresentationRules(doc,before,facts).grid;assert.equal(next.cells.some(c=>c.style.bgColor==='#FFE6E6'),false);assert.equal(count(next,'低产'),5);assert.equal(next.cells.find(c=>c.row===3&&c.col===3).value,600);assert.deepEqual(next.merges,before.merges);
});

test('CR-39 replacement wrap/font resolves shared automatic row heights and removes derived heights on disable',()=>{
  const doc=detail();setPresentation(doc,source(doc).id,{threshold:700,text:'较长的交付状态说明\n第二行',style:{fontSize:24,wrapText:true}});
  const input={type:'detail',rowCount:2,colCount:2,cells:[{row:0,col:0,value:600,displayText:'600',role:'custom',sourceCellId:source(doc).id,style:{}}],bindings:[],merges:[],colWidths:{0:90}};
  const before=applyPresentationRules(doc,input).grid;assert.ok(before.rowHeights[0]>24);assert.equal(biGridToUniverWorksheetData(before).rowData[0].h,before.rowHeights[0]);
  const compiled=compileCellReport(doc,[{...facts[0],output_qty:600}]),table=adaptPublishedSheetToVTable(compiled.publication.sheets[0],compiled.publication.styles);assert.ok(table.options.rowHeightConfig.length>0);for(const h of table.options.rowHeightConfig)assert.equal(h.height,compiled.publication.sheets[0].rowHeights[h.key]);assert.equal(table.options.enableLineBreak,true);assert.deepEqual(table.columns[0].style({row:0}).padding,[4,6,4,6]);
  doc.presentationRules.ruleSets[0].rules[0].enabled=false;const after=applyPresentationRules(doc,before).grid;assert.equal(after.rowHeights[0],undefined);assert.equal(after.cells[0].value,600);
});

test('CR-40 multi-region static row styles require a selected footprint and never paint another region',()=>{
  const doc=detail();doc.regions.push({...clone(doc.regions[0]),id:'region-2'});doc.cells.push({id:'caption',sheetId:'sheet-1',position:{row:3,column:6},parents:{row:'none',column:'none'},content:{kind:'literal',value:'说明'}});
  doc.styleRules=[{id:'row-style',sheetId:'sheet-1',targetId:'caption',scope:'row',priority:0,style:{backgroundColor:'#123456'}}];assert.ok(validatePresentationRules(doc).some(d=>d.code==='ERR_RULE_ROW_RANGE'));
  doc.styleRules[0].regionId='region-2';const input={type:'detail',rowCount:5,colCount:10,cells:[{row:3,col:0,value:'A',role:'custom',sourceCellId:source(doc,'order_code').id,regionId:'region-1'},{row:3,col:7,value:'B',role:'custom',sourceCellId:source(doc,'part_name').id,regionId:'region-2'},{row:3,col:6,value:'说明',role:'custom',sourceCellId:'caption'}],bindings:[],merges:[]};
  const grid=applyPresentationRules(doc,input).grid;assert.equal(grid.cells.find(c=>c.col===0).style?.bgColor,undefined);assert.equal(grid.cells.find(c=>c.col===7).style?.bgColor,'#123456');
});

test('CR-41 obsolete condition fields are ignored at root, cell and content without blocking publication',()=>{
  for(const legacy of [[],null,{unsupported:true},[{operator:'bogus',threshold:'invalid',style:{color:'#XYZ'},text:'旧文案'}]]){
    const doc=detail(),before=clone(doc);delete doc.presentationRules;
    doc.conditionalRules=clone(legacy);source(doc).conditionRules=clone(legacy);source(doc).content.conditionRules=clone(legacy);
    const result=output(doc);
    assert.deepEqual(result.sheet.cells,output(before).sheet.cells);
    assert.equal(result.grid.ruleStatistics.length,0);
    assert.equal(result.compiled.diagnostics.some(d=>d.code==='ERR_UNSUPPORTED_CONDITIONAL_CONFIG'),false);
    assert.deepEqual(doc.conditionalRules,legacy); // 不迁移、不执行，也不改写调用方的旧字段。
  }
});

test('CR-42 obsolete fields do not shadow new rules during save/reopen or suppress their validation',()=>{
  const doc=statusDoc(),before=clone(doc);
  doc.conditionalRules=[{text:'旧文案',operator:'bogus'}];source(doc).conditionRules={unexpected:true};source(doc).content.conditionRules=null;
  const reopened=JSON.parse(JSON.stringify(doc)),result=output(reopened);
  assert.deepEqual(result.sheet.cells,output(before).sheet.cells);
  assert.deepEqual(['低产','关注','正常'].map(t=>count(result.grid,t)),[5,4,4]);
  reopened.presentationRules.ruleSets[0].rules[0].style.style.color='#INVALID';
  assert.equal(compileCellReport(reopened,facts).valid,false);
});
