import test from 'node:test';
import assert from 'node:assert/strict';
import { compilePanelToCellTemplate, compileCellReport, getCellCapabilities } from '../dist/esm/report-template/index.js';
import { createAdvancedCellDraft, buildAdvancedCellUpdate, validateAdvancedCellUpdate, changeMetricAggregation } from '../dist/esm/cell-designer/advancedCellState.js';
import { numberFormatOptions } from '../dist/esm/report/numberFormat.js';
import { syncDocumentFromWorkbookSnapshot } from '../dist/esm/cell-designer/syncWorkbookToTemplate.js';
import { targetForCell } from '../dist/esm/report-template/presentationTypes.js';
import { adaptPublishedSheetToVTable } from '../dist/esm/ui/presentation/report/gridAdapter.js';
import { setPresentation } from './helpers/presentation.mjs';

const fields=[{key:'team',type:'text'},{key:'qty',type:'number'},{key:'day',type:'date'}];
const context={fields};
const facts=[{team:'A',day:'2026-08-01',qty:600},{team:'B',day:'2026-08-02',qty:1200}];
const panel=()=>compilePanelToCellTemplate({datasetId:'facts',dimensions:{categories:['team'],columnTimeBucket:{field:'day',granularity:'day'}},columns:[{type:'aggregated',field:'qty',agg:'sum'}]},'facts',{showRowTotals:true});
const source=(d,id='meas-qty')=>d.cells.find(c=>c.id===id);
function apply(d,c,update){const {visualStyleRules,presentationRules,...patch}=update;return {...d,cells:d.cells.map(x=>x.id===c.id?{...x,...patch}:x),styleRules:visualStyleRules||d.styleRules,presentationRules:presentationRules||d.presentationRules};}
function edit(d,c,fn){const draft=createAdvancedCellDraft(d,c);fn(draft);return apply(d,c,buildAdvancedCellUpdate(d,c,draft,context));}
function rowStyle(d,c,style={backgroundColor:'#ABCDEF'}){return edit(d,c,s=>{s.rowStyleEnabled=true;s.dirty.rowStyleEnabled=true;s.style.style=style;s.dirty.style=true;});}
function publish(d,rows=facts){const result=compileCellReport(d,rows,{availableFields:fields.map(f=>f.key)});assert.equal(result.valid,true,JSON.stringify(result.diagnostics));return result.publication;}
function nativeFormat(d,c,pattern){
  const g={cells:[{row:c.position.row,col:c.position.column,value:`{${c.id}}`,sourceCellId:c.id,role:'custom',style:{format:c.content.formatOptions?.numberFormat||c.content.format}}],merges:[],bindings:[]};
  const snapshot={sheets:{[c.sheetId]:{cellData:{[c.position.row]:{[c.position.column]:{v:`{${c.id}}`,s:{n:{pattern}},custom:{biProjection:true}}}}}}};
  return syncDocumentFromWorkbookSnapshot(d,snapshot,'design',g);
}

test('AO-01 role-owned sections keep static content and generated headers distinct',()=>{
  const d=panel(),cap=c=>getCellCapabilities(c,context);
  assert.deepEqual(cap(source(d,'title')).tabs.map(t=>t.key),['content','merge']);
  const header=d.cells.find(c=>c.id.startsWith('hdr-'));assert.deepEqual(cap(header).tabs,[]);assert.deepEqual(cap(header).advancedFormatKeys,[]);assert.equal(cap(header).canEditConditions,false);assert.equal(cap(header).canStyleRow,false);
  for(const role of ['row-dimension','column-dimension']){const dim=d.cells.find(c=>c.content.role===role);assert.equal(cap(dim).tabs[0].label,'维度设置');assert.deepEqual(cap(dim).advancedFormatKeys,['emptyDisplay']);}
  assert.equal(cap(source(d)).tabs[0].label,'指标设置');assert.equal(cap(source(d,'meas-rowtotal-qty')).tabs[0].label,'汇总设置');
});

test('AO-02 a numeric dimension never inherits metric aggregation or scaling permissions',()=>{
  const d=compilePanelToCellTemplate({datasetId:'facts',dimensions:{categories:['qty']},columns:[{type:'aggregated',field:'qty',agg:'sum'}]},'facts');
  const dim=d.cells.find(c=>c.content.role==='row-dimension'),metric=source(d);
  assert.deepEqual(getCellCapabilities(dim,context).advancedFormatKeys,['emptyDisplay']);assert.equal(getCellCapabilities(dim,context).canEditAggregation,false);
  assert.deepEqual(getCellCapabilities(metric,context).advancedFormatKeys,['emptyDisplay','scale']);assert.equal(getCellCapabilities(metric,context).canEditAggregation,true);
});

test('AO-03 ordinary format keys and raw style DTOs are refused at the advanced save boundary',()=>{
  const d=panel(),c=source(d);
  for(const [key,value]of Object.entries({numberFormat:'0.00%',format:'percent',precision:3,useGrouping:false,prefix:'￥',suffix:'件',negativeFormat:'bracket',zeroDisplay:'dash'})){
    const s=createAdvancedCellDraft(d,c);s.format[key]=value;s.dirtyFormat=[key];assert.throws(()=>buildAdvancedCellUpdate(d,c,s,context),/Excel 工具栏/);
  }
  assert.throws(()=>validateAdvancedCellUpdate(d,c,{content:{...c.content,format:'percent'}},context),/Excel 工具栏/);
  assert.throws(()=>validateAdvancedCellUpdate(d,c,{style:{bold:true}},context),/Excel 工具栏/);
});

test('AO-04 toolbar format cannot be silently deleted by a partial advanced format object',()=>{
  const d=panel(),c=source(d);c.content.formatOptions={numberFormat:'0.000%',scale:1000};
  assert.throws(()=>validateAdvancedCellUpdate(d,c,{formatOptions:{emptyDisplay:'无'}},context),/Excel 工具栏/);
  const next=edit(d,c,s=>{s.format.emptyDisplay='无';s.dirtyFormat=['emptyDisplay'];});assert.equal(source(next).content.formatOptions.numberFormat,'0.000%');assert.equal(source(next).content.formatOptions.scale,1000);
});

test('AO-05 row style creates a separate rule and reads itself rather than a toolbar cell rule',()=>{
  let d=panel();const c=source(d);d.styleRules.push({id:'native',sheetId:c.sheetId,targetId:c.id,target:targetForCell(c),scope:'template-cell',priority:0,style:{color:'#123456'}});
  const normal=structuredClone(d.styleRules[0]);d=rowStyle(d,c,{backgroundColor:'#ABCDEF'});
  assert.deepEqual(d.styleRules.find(r=>r.id==='native'),normal);assert.equal(d.styleRules.filter(r=>r.scope==='row').length,1);
  const draft=createAdvancedCellDraft(d,source(d));assert.equal(draft.rowStyleEnabled,true);assert.deepEqual(draft.style.style,{backgroundColor:'#ABCDEF'});assert.equal(draft.style.scope,'row');
});

test('AO-06 disabling and reenabling row styling retains its settings, IDs, normal styles and conditions',()=>{
  let d=panel();setPresentation(d,source(d).id,{operator:'gt',threshold:1000,text:'高'});d=rowStyle(d,source(d));
  const rule=structuredClone(d.styleRules.find(r=>r.scope==='row')),conditions=JSON.stringify(d.presentationRules);
  d=edit(d,source(d),s=>{s.rowStyleEnabled=false;s.dirty.rowStyleEnabled=true;});assert.equal(d.styleRules.find(r=>r.id===rule.id).enabled,false);assert.deepEqual(d.styleRules.find(r=>r.id===rule.id).style,rule.style);assert.equal(JSON.stringify(d.presentationRules),conditions);
  const saved=JSON.parse(JSON.stringify(d)),draft=createAdvancedCellDraft(saved,source(saved));assert.equal(draft.rowStyleEnabled,false);assert.deepEqual(draft.style.style,rule.style);
  d=edit(saved,source(saved),s=>{s.rowStyleEnabled=true;s.dirty.rowStyleEnabled=true;});assert.equal(d.styleRules.find(r=>r.id===rule.id).enabled,true);assert.equal(d.styleRules.filter(r=>r.scope==='row').length,1);
});

test('AO-07 row, toolbar-cell and conditional styles keep their defined precedence without changing values',()=>{
  let d=panel();const c=source(d);d=rowStyle(d,c,{color:'#008000',backgroundColor:'#ABCDEF'});
  d.styleRules.push({id:'native',sheetId:c.sheetId,targetId:c.id,target:targetForCell(c),scope:'template-cell',priority:10,style:{color:'#123456'}});
  setPresentation(d,c.id,{operator:'gt',threshold:1000,style:{color:'#CF1322',backgroundColor:'#FFF1F0'},text:'高'});
  const p=publish(d),low=p.sheets[0].cells.find(c=>c.v===600&&c.role==='metric-value'),high=p.sheets[0].cells.find(c=>c.v===1200&&c.role==='metric-value');
  assert.equal(p.styles[low.styleId].color,'#123456');assert.equal(p.styles[low.styleId].bgColor,'#ABCDEF');assert.equal(high.displayText,'高');assert.equal(high.v,1200);assert.equal(p.styles[high.styleId].color,'#CF1322');
});

test('AO-08 row styling follows added and removed dynamic columns, sorting and restored data without mutating source',()=>{
  const d=panel(),styled=rowStyle(d,source(d)),saved=JSON.parse(JSON.stringify(styled)),before=JSON.stringify(saved),base=publish(saved);
  for(const rows of [[...facts,{team:'C',day:'2026-08-03',qty:200}],[...facts].reverse(),facts.slice(1),[],facts]){
    const p=publish(saved,rows),sheet=p.sheets[0],table=adaptPublishedSheetToVTable(sheet,p.styles);
    for(const c of sheet.cells.filter(c=>c.role==='metric-value')){assert.equal(p.styles[c.styleId].bgColor,'#ABCDEF');assert.equal(table.records[c.r][table.columns[c.c].field],c.displayText);assert.equal(table.rawRecords[c.r][table.columns[c.c].field],c.v);}
    assert.equal(JSON.stringify(saved),before);
  }
  assert.deepEqual(publish(saved).sheets,base.sheets);
});

test('AO-09 changing aggregation rebinds row and cell styles and totals without changing dimension identity',()=>{
  let d=compilePanelToCellTemplate({datasetId:'facts',dimensions:{categories:['qty'],columnTimeBucket:{field:'day',granularity:'day'}},columns:[{type:'aggregated',field:'qty',agg:'sum'}]},'facts',{showRowTotals:true});
  d=rowStyle(d,source(d));const c=source(d);d.styleRules.push({id:'native',sheetId:c.sheetId,targetId:c.id,target:targetForCell(c),scope:'template-cell',priority:4,style:{bold:true}});
  const next=changeMetricAggregation(d,'qty','avg',context);assert.equal(next.cells.find(c=>c.content.role==='row-dimension').content.operation,'group');assert.equal(source(next).content.operation,'avg');assert.equal(source(next,'meas-rowtotal-qty').content.operation,'avg');assert.ok(next.styleRules.every(r=>r.target.operation==='avg'));assert.equal(publish(next).sheets.length,1);
});

test('AO-10 one toolbar number-format edit owns prefix, suffix, zero, date and negative formatting',()=>{
  let d=panel();const c=source(d);c.content.formatOptions={prefix:'旧前缀',suffix:'旧单位',zeroDisplay:'dash',negativeFormat:'bracket',dateFormat:'YYYY',scale:1000,emptyDisplay:'缺数据'};
  d=nativeFormat(d,c,'0.0"千件"');const fmt=source(d).content.formatOptions;
  for(const k of ['prefix','suffix','zeroDisplay','negativeFormat','dateFormat'])assert.equal(fmt[k],undefined,k);
  assert.equal(fmt.scale,1000);assert.equal(fmt.emptyDisplay,'缺数据');assert.equal(publish(d).sheets[0].cells.find(c=>c.v===600&&c.role==='metric-value').displayText,'0.6千件');
  assert.equal(numberFormatOptions('General').suffix,undefined);
});

test('AO-11 only actual blanks get a placeholder; numeric zero and boolean false keep their values',()=>{
  const d=panel(),c=source(d);const next=edit(d,c,s=>{s.format.emptyDisplay='缺数据';s.dirtyFormat=['emptyDisplay'];});
  const p=publish(next),zero=p.sheets[0].cells.find(c=>c.v===0&&c.role==='metric-value');assert.ok(zero);assert.notEqual(zero.displayText,'缺数据');
  const dim=d.cells.find(c=>c.content.role==='row-dimension'),rows=[{...facts[0],team:null},{...facts[1],team:false}];
  const dn=edit(d,dim,s=>{s.format.emptyDisplay='缺数据';s.dirtyFormat=['emptyDisplay'];}),q=publish(dn,rows);assert.ok(q.sheets[0].cells.some(c=>c.v===false&&c.displayText!=='缺数据'));
});

test('AO-12 static edits keep only content and range permissions and do not touch business rule trees',()=>{
  const d=panel(),c=source(d,'title');c.staticSpan.merge=false;c.staticSpan.suppressions=['cancelled-group'];const rules=JSON.stringify(d.mergeConfig);
  const next=edit(d,c,s=>{s.text='新标题';s.dirty.text=true;});assert.equal(source(next,'title').content.value,'新标题');assert.equal(source(next,'title').staticSpan.merge,false);assert.deepEqual(source(next,'title').staticSpan.suppressions,['cancelled-group']);assert.equal(JSON.stringify(next.mergeConfig),rules);assert.deepEqual(getCellCapabilities(c,context).tabs.map(t=>t.key),['content','merge']);
});

test('AO-13 headers reject business conditions and every role applies without manufacturing defaults',()=>{
  const d=panel(),header=d.cells.find(c=>c.id.startsWith('hdr-'));
  assert.throws(()=>validateAdvancedCellUpdate(d,header,{presentationRules:{version:1,revision:1,ruleSets:[]}},context),/条件规则/);
  const before=JSON.stringify(d);for(const c of d.cells)assert.deepEqual(buildAdvancedCellUpdate(d,c,createAdvancedCellDraft(d,c),context),{});assert.equal(JSON.stringify(d),before);
});

test('AO-14 formula results and detail columns expose result-based business settings without aggregation controls',()=>{
  const d=panel(),c={...source(d),id:'formula',content:{kind:'sheet-formula',formula:'=SUM(C4:D4)'}};
  const cap=getCellCapabilities(c,{grid:{cells:[{sourceCellId:'formula',value:1800}]}});assert.equal(cap.tabs[0].label,'结果设置');assert.equal(cap.canEditAggregation,false);assert.deepEqual(cap.advancedFormatKeys,['emptyDisplay','scale']);
  const detail=compilePanelToCellTemplate({datasetId:'facts',dimensions:{},columns:[{type:'aggregated',field:'qty',agg:'sum'}]},'facts').cells.find(c=>c.content.kind==='field');const dc=getCellCapabilities(detail,context);assert.equal(dc.tabs[0].label,'明细设置');assert.equal(dc.canEditAggregation,false);assert.deepEqual(dc.advancedFormatKeys,['emptyDisplay','scale']);
});

test('AO-15 advanced row edits cannot remove toolbar rules or alter a different source row rule',()=>{
  let d=panel(),c=source(d),other=d.cells.find(c=>c.content.role==='row-dimension');d=rowStyle(d,c);d=rowStyle(d,other,{backgroundColor:'#FFFFFF'});
  const changed=structuredClone(d.styleRules);changed.find(r=>r.targetId===other.id).style.color='#FF0000';assert.throws(()=>validateAdvancedCellUpdate(d,c,{visualStyleRules:changed},context),/当前源格/);
  d.styleRules.push({id:'native',sheetId:c.sheetId,targetId:c.id,target:targetForCell(c),scope:'template-cell',priority:4,style:{bold:true}});assert.throws(()=>validateAdvancedCellUpdate(d,c,{visualStyleRules:d.styleRules.filter(r=>r.id!=='native')},context),/Excel 工具栏/);
});

test('AO-16 worksheet formulas keep their numeric inputs when business scaling and toolbar units are combined',()=>{
  let d=panel();const m=source(d);d=edit(d,m,s=>{s.format.scale=1000;s.dirtyFormat=['scale'];});d=nativeFormat(d,source(d),'0.0"千件"');
  d.cells.push({id:'sum',sheetId:'sheet-1',position:{row:12,column:9},parents:{row:'none',column:'none'},content:{kind:'sheet-formula',formula:'=SUM(C4:D4)'}});
  const p=publish(d),f=p.sheets[0].cells.find(c=>c.formula==='=SUM(C4:D4)');assert.equal(f.v,600);assert.ok(p.sheets[0].cells.some(c=>c.v===600&&c.displayText==='0.6千件'));
});
