import test from 'node:test';
import assert from 'node:assert/strict';
import { compilePanelToCellTemplate, compileCellReport, getCellCapabilities, canOpenCellAdvancedSettings, conditionOperators, dateComparable, getOperandValueType } from '../dist/esm/report-template/index.js';
import { createAdvancedCellDraft, buildAdvancedCellUpdate, validateAdvancedCellUpdate, changeMetricAggregation } from '../dist/esm/cell-designer/advancedCellState.js';
import { targetForCell } from '../dist/esm/report-template/presentationTypes.js';
import { setPresentation } from './helpers/presentation.mjs';
import { extractStyleFromUniver, syncDocumentFromWorkbookSnapshot } from '../dist/esm/cell-designer/syncWorkbookToTemplate.js';
import { publishedStyleToUniver } from '../dist/esm/report/buildBiGrid.js';
import { attachUniverDesignerEvents } from '../dist/esm/cell-designer/univerEvents.js';

const fields=[{key:'team',type:'string'},{key:'code',type:'string'},{key:'rank',type:'number'},{key:'day',type:'date'},{key:'qty',type:'number'},{key:'active',type:'boolean'}];
const facts=[{id:'a',team:'甲',code:'0012',rank:1,day:'2026-08-01 08:30:00',qty:600,active:true},{id:'b',team:'乙',code:'0000',rank:2,day:'2026-08-03 09:00:00',qty:1200,active:false}];
const panel=(dimensions={categories:['team']},columns=[{type:'aggregated',field:'qty',agg:'sum'}])=>compilePanelToCellTemplate({datasetId:'facts',dimensions,columns},'facts');
const field=(d,key,role)=>d.cells.find(c=>c.content.kind==='field'&&c.content.fieldKey===key&&(!role||c.content.role===role));
const context={fields};
function apply(d,c,update){const {presentationRules,visualStyleRules,...patch}=update;return {...d,cells:d.cells.map(x=>x.id===c.id?{...x,...patch}:x),presentationRules:presentationRules||d.presentationRules,styleRules:visualStyleRules||d.styleRules};}
function format(d,c,key,value){const s=createAdvancedCellDraft(d,c);s.format[key]=value;s.dirtyFormat=[key];return buildAdvancedCellUpdate(d,c,s,context);}
function toolbarFormat(d,c,pattern){
  const grid={cells:[{row:c.position.row,col:c.position.column,sourceCellId:c.id,value:`{${c.id}}`,role:'custom',style:{format:c.content.formatOptions?.numberFormat||c.content.format}}],merges:[],bindings:[]};
  const snapshot={sheets:{[c.sheetId]:{cellData:{[c.position.row]:{[c.position.column]:{v:`{${c.id}}`,s:{n:{pattern}},custom:{biProjection:true}}}}}}};
  return syncDocumentFromWorkbookSnapshot(d,snapshot,'design',grid);
}
function literal(d,value='备注',position={row:12,column:9}){const c={id:'static-note',sheetId:'sheet-1',regionId:'region-1',position,parents:{row:'none',column:'none'},content:{kind:'literal',value}};d.cells.push(c);return c;}
function rule(d,c,predicate,text='命中'){d.presentationRules={version:1,revision:0,ruleSets:[{id:'typed-set',order:0,target:targetForCell(c),rules:[{id:'typed-rule',name:'typed',enabled:true,order:0,predicate,text,stopIfTrue:true}]}]};}
const compare=(type,operator,right)=>({kind:'comparison',valueType:type,left:{kind:'current'},operator,right:{kind:'literal',value:right,...(type==='date'?{valueType:'date'}:{})}});

test('AC-01 numeric classification stays a dimension and cannot use indicator scaling',()=>{
  const d=panel({categories:['rank']}),cap=getCellCapabilities(field(d,'rank'),context);assert.equal(cap.role,'dimension');assert.equal(cap.valueType,'number');assert.equal(cap.canEditAggregation,false);assert.equal(cap.formatKeys.includes('scale'),false);assert.equal(cap.numericFormats.includes('percent'),false);
});
test('AC-02 COUNT of text is a numeric measure with only a valid source aggregation',()=>{
  const d=panel({categories:['team']},[{type:'aggregated',field:'code',agg:'count'}]),cap=getCellCapabilities(field(d,'code'),context);assert.equal(cap.valueType,'number');assert.deepEqual(cap.aggregations,['count']);assert.ok(cap.formatKeys.includes('precision'));
});
test('AC-03 time axes use toolbar date display without changing time bucket or parents',()=>{
  const d=panel({columnTimeBucket:{field:'day',granularity:'day'}}),c=field(d,'day'),cap=getCellCapabilities(c,context);assert.equal(cap.role,'time-dimension');assert.ok(cap.formatKeys.includes('dateFormat'));assert.equal(cap.formatKeys.includes('precision'),false);assert.ok(cap.mergePolicies.includes('group-span'));
  assert.throws(()=>format(d,c,'dateFormat','YYYY年MM月'),/Excel 工具栏/);
  const next=toolbarFormat(d,c,'yyyy"年"mm"月"').cells.find(x=>x.id===c.id);assert.deepEqual(next.content.timeBucket,c.content.timeBucket);assert.deepEqual(next.parents,c.parents);assert.equal(next.content.expand,'right');
});
test('AC-04 numeric, text and boolean detail columns use values rather than aggregation roles',()=>{
  const d=panel({},['qty','code','active'].map(field=>({type:'aggregated',field,agg:'count'})));
  for(const [key,type]of [['qty','number'],['code','text'],['active','boolean']]){const cap=getCellCapabilities(field(d,key),context);assert.equal(cap.role,'detail');assert.equal(cap.valueType,type);assert.equal(cap.canEditAggregation,false);assert.equal(cap.formatKeys.includes('precision'),type==='number');}
});
test('AC-05 formula results have no selectable aggregation and respect evaluated result type',()=>{
  const d=panel(),c=literal(d);c.content={kind:'sheet-formula',formula:'="0012"'};let cap=getCellCapabilities(c,{grid:{cells:[{sourceCellId:c.id,value:'0012'}]}});assert.equal(cap.role,'formula');assert.equal(cap.valueType,'text');assert.equal(cap.canEditAggregation,false);
  c.content={kind:'business-formula',metricId:'ratio',expression:'SUM(qty)/COUNT(qty)',scope:'summary'};cap=getCellCapabilities(c);assert.equal(cap.valueType,'number');assert.equal(cap.canEditLiteral,false);
});
test('AC-06 generated headers and arbitrary-position static content have different permissions',()=>{
  const d=panel(),header=d.cells.find(c=>c.id.startsWith('hdr-')),note=literal(d,'说明',{row:8,column:7});assert.equal(getCellCapabilities(header).role,'header');assert.equal(getCellCapabilities(header).canEditLiteral,false);assert.equal(getCellCapabilities(note).canFollowRange,true);assert.equal(getCellCapabilities(d.cells.find(c=>c.id==='title')).role,'static');
  assert.equal(getCellCapabilities(note,{contentReadOnly:true}).canEditLiteral,false);
});
test('AC-07 totals inherit calculation and static numeric cells can retain a span',()=>{
  const d=panel({columnCategories:['team']},[{type:'aggregated',field:'qty',agg:'sum'}]);const total={...field(d,'qty'),id:'meas-rowtotal-qty'};assert.equal(getCellCapabilities(total,context).role,'total');assert.equal(getCellCapabilities(total,context).canEditAggregation,false);assert.equal(getCellCapabilities(literal(d,2026)).canFollowRange,true);
});
test('AC-08 opening and applying without edits is a true source no-op',()=>{
  const d=panel(),c=field(d,'qty'),before=JSON.stringify(d),s=createAdvancedCellDraft(d,c);s.dirty.style=true;assert.deepEqual(buildAdvancedCellUpdate(d,c,s,context),{});assert.equal(JSON.stringify(d),before);assert.equal(d.styleRules.length,0);
});
test('AC-09 style-only saves do not inject numeric defaults or replace format metadata',()=>{
  const d=panel(),c=field(d,'team');c.content.formatOptions={emptyDisplay:'无',tooltip:'现有备注'};const s=createAdvancedCellDraft(d,c);s.style.style.color='#1677FF';s.rowStyleEnabled=true;s.dirty.style=true;s.dirty.rowStyleEnabled=true;const u=buildAdvancedCellUpdate(d,c,s,context);assert.equal(u.content,undefined);assert.equal(u.formatOptions,undefined);assert.equal(u.visualStyleRules.length,1);assert.equal(u.visualStyleRules[0].scope,'row');assert.deepEqual(c.content.formatOptions,{emptyDisplay:'无',tooltip:'现有备注'});
});
test('AC-10 date formatting changes labels while keeping two distinct daily members',()=>{
  const d=panel({columnTimeBucket:{field:'day',granularity:'day'}}),c=field(d,'day'),next=toolbarFormat(d,c,'yyyy"年"mm"月"'),r=compileCellReport(next,facts);assert.equal(r.valid,true,JSON.stringify(r.diagnostics));assert.ok(r.publication.sheets[0].cells.some(c=>c.v==='2026-08-01'&&c.displayText==='2026年08月'));assert.ok(r.publication.sheets[0].cells.some(c=>c.v==='2026-08-03'&&c.displayText==='2026年08月'));assert.equal(next.hybridConfig.columnAxes[0].timeBucket.granularity,'day');
});
test('AC-11 empty-display changes keep text dimension leading zeroes and text zero',()=>{
  const d=panel({categories:['code']}),c=field(d,'code'),next=apply(d,c,format(d,c,'emptyDisplay','无'));const r=compileCellReport(next,[...facts,{...facts[0],id:'c',code:'0'}]);assert.equal(r.valid,true);for(const code of ['0012','0000','0'])assert.ok(r.publication.sheets[0].cells.some(c=>c.v===code&&c.displayText===code),code);
});
test('AC-12 numeric scaling and units change display while raw values and totals remain numeric',()=>{
  const d=panel(),c=field(d,'qty'),scaled=apply(d,c,format(d,c,'scale',1000)),next=toolbarFormat(scaled,field(scaled,'qty'),'0.0"千件"'),r=compileCellReport(next,facts);assert.equal(r.valid,true);assert.ok(r.publication.sheets[0].cells.some(c=>c.v===600&&c.displayText==='0.6千件'));assert.equal(facts.reduce((s,r)=>s+r.qty,0),1800);
});
test('AC-13 unsupported format patches are rejected at the shared save boundary',()=>{
  const d=panel(),text=field(d,'team'),measure=field(d,'qty');assert.throws(()=>format(d,text,'precision',2),/不支持/);assert.throws(()=>format(d,measure,'dateFormat','YYYY-MM-DD'),/不支持/);const n=panel({categories:['rank']});assert.throws(()=>format(n,field(n,'rank'),'scale',1000),/不支持/);
  assert.throws(()=>format(d,measure,'tooltip','未接通的备注'),/不支持/);
  assert.throws(()=>validateAdvancedCellUpdate(d,measure,{content:{...measure.content,tooltip:'未接通的备注'}},context),/字段/);
});
test('AC-14 source fields, parents, formula and row/column placement cannot be changed via DTO',()=>{
  const d=panel(),c=field(d,'qty');for(const patch of [{id:'other'},{parents:{row:'none',column:'none'}},{position:{row:99,column:9}},{content:{...c.content,fieldKey:'team'}},{content:{...c.content,expand:'right'}}])assert.throws(()=>validateAdvancedCellUpdate(d,c,patch,context),/结构|绑定|字段/);
  const f=literal(d);f.content={kind:'sheet-formula',formula:'=1+1'};assert.throws(()=>validateAdvancedCellUpdate(d,f,{content:{...f.content,formula:'=999'}},context),/公式/);
  const protectedNote=literal(d,'受保护标签');assert.throws(()=>validateAdvancedCellUpdate(d,protectedNote,{content:{kind:'literal',value:'覆盖数据区'}},{...context,contentReadOnly:true}),/不能/);
});
test('AC-15 explicit aggregation changes retain and rebind own style and condition targets',()=>{
  const d=panel(),c=field(d,'qty');d.styleRules=[{id:'styled',sheetId:c.sheetId,targetId:c.id,target:targetForCell(c),scope:'template-cell',priority:0,style:{fontSize:18}}];setPresentation(d,c.id,{operator:'gt',threshold:0,text:'有产出'});const s=createAdvancedCellDraft(d,c);s.operation='avg';s.dirty.operation=true;const u=buildAdvancedCellUpdate(d,c,s,context),next=apply(d,c,u),r=compileCellReport(next,[facts[0],{...facts[0],id:'c',qty:200}]);assert.equal(u.visualStyleRules[0].target.operation,'avg');assert.equal(u.presentationRules.ruleSets[0].target.operation,'avg');assert.equal(r.valid,true,JSON.stringify(r.diagnostics));assert.ok(r.publication.sheets[0].cells.some(c=>c.v===400&&c.displayText==='有产出'));
});
test('AC-16 dimensions, formulas and totals cannot be converted into independent aggregates',()=>{
  const d=panel(),dim=field(d,'team'),total={...field(d,'qty'),id:'meas-rowtotal-qty'};for(const c of [dim,total])assert.throws(()=>validateAdvancedCellUpdate(d,c,{content:{...c.content,operation:'avg'}},context),/聚合/);
});
test('AC-17 static content edits keep toolbar styles, span cancellation and every existing merge rule',()=>{
  const d=panel(),c=literal(d);c.style={color:'#1677FF',fontSize:18};c.staticSpan={id:'note-span',enabled:true,regionId:'region-1',scope:'report',repeat:'once',placement:'template',rowOffset:0,height:1,includeTotals:true,merge:false,suppressions:['cancelled-member']};const before=JSON.stringify(d.layoutRules),s=createAdvancedCellDraft(d,c);s.text='新说明';s.dirty.text=true;const next=apply(d,c,buildAdvancedCellUpdate(d,c,s,context));assert.deepEqual(next.cells.find(x=>x.id===c.id).staticSpan,c.staticSpan);assert.deepEqual(next.cells.find(x=>x.id===c.id).style,c.style);assert.equal(JSON.stringify(next.layoutRules),before);
});
test('AC-18 condition operators and referenced operand types follow actual left values',()=>{
  assert.ok(conditionOperators('text').includes('contains'));assert.equal(conditionOperators('text').includes('gt'),false);assert.ok(conditionOperators('date').includes('between'));assert.equal(conditionOperators('number').includes('contains'),false);assert.equal(conditionOperators('boolean').includes('gt'),false);const d=panel(),c=field(d,'qty');assert.equal(getOperandValueType({kind:'field',field:'code',agg:'count'},c,d,context),'number');assert.equal(getOperandValueType({kind:'field',field:'code'},c,d,context),'text');assert.equal(getOperandValueType({kind:'current',basis:'text'},c,d,context),'text');
});
test('AC-19 typed date comparisons execute in publication without changing original dates',()=>{
  const d=panel({},[{type:'aggregated',field:'day',agg:'count'},{type:'aggregated',field:'qty',agg:'sum'}]),c=field(d,'day');rule(d,c,compare('date','gte','2026-08-02 00:00:00'),'较晚');const r=compileCellReport(d,facts);assert.equal(r.valid,true,JSON.stringify(r.diagnostics));const dates=r.publication.sheets[0].cells.filter(c=>typeof c.v==='string'&&/^2026-08/.test(c.v));assert.equal(dates.filter(c=>c.displayText==='较晚').length,1);assert.equal(dates.find(c=>c.displayText==='较晚').v,facts[1].day);
});
test('AC-20 typed invalid date, inverse interval and numeric/text mismatch block publishing',()=>{
  for(const p of [compare('date','gt','2026-02-30'),{...compare('date','between','2026-08-03'),upper:{kind:'literal',value:'2026-08-01',valueType:'date'}}]){const d=panel({timeBucket:{field:'day',granularity:'day'}});rule(d,field(d,'day'),p);assert.equal(compileCellReport(d,facts).valid,false);}
  const d=panel(),c=field(d,'qty');rule(d,c,compare('number','contains','6'));assert.equal(compileCellReport(d,facts).valid,false);
  rule(d,c,{...compare('number','in',[]),right:{kind:'metric',metricId:c.content.metricId}});assert.equal(compileCellReport(d,facts).valid,false);
});
test('AC-21 date comparator handles calendar buckets, timezones and invalid values deterministically',()=>{
  assert.equal(dateComparable('2026-Q3'),dateComparable('2026-07-01'));assert.equal(dateComparable('2026-08'),dateComparable('2026-08-01'));assert.equal(dateComparable('2026-08-03 (第1周)'),dateComparable('2026-08-03'));assert.equal(dateComparable('2026-08-01T08:00:00+08:00'),dateComparable('2026-08-01T00:00:00Z'));assert.equal(dateComparable('2026-02-30'),undefined);assert.equal(dateComparable('0012'),undefined);
});
test('AC-22 boolean conditions and text replacements preserve boolean calculation values',()=>{
  const d=panel({},[{type:'aggregated',field:'active',agg:'count'}]),c=field(d,'active');rule(d,c,compare('boolean','eq',true),'启用');const r=compileCellReport(d,facts);assert.equal(r.valid,true);assert.ok(r.publication.sheets[0].cells.some(c=>c.v===true&&c.displayText==='启用'));assert.ok(r.publication.sheets[0].cells.some(c=>c.v===false));
});
test('AC-23 unknown empty data retains equality rules and accepts data when it arrives',()=>{
  const d=panel({},[{type:'aggregated',field:'code',agg:'count'}]),c=field(d,'code');rule(d,c,compare('unknown','eq','0012'));assert.equal(compileCellReport(d,[],{availableFields:fields.map(f=>f.key)}).valid,true);const r=compileCellReport(d,facts);assert.equal(r.valid,true,JSON.stringify(r.diagnostics));assert.ok(r.publication.sheets[0].cells.some(c=>c.v==='0012'&&c.displayText==='命中'));
});
test('AC-24 JSON save, additions, sorting, deletion and restore retain typed rules and source',()=>{
  const d=panel({},[{type:'aggregated',field:'day',agg:'count'}]),c=field(d,'day');rule(d,c,compare('date','gt','2026-08-02'));const saved=JSON.parse(JSON.stringify(d)),before=JSON.stringify(saved),base=compileCellReport(saved,facts);for(const rows of [[...facts,{...facts[0],id:'c',day:'2026-08-04'}],[...facts].reverse(),facts.slice(1),[],facts]){const r=compileCellReport(saved,rows,{availableFields:fields.map(f=>f.key)});assert.equal(r.valid,true,JSON.stringify(r.diagnostics));assert.equal(JSON.stringify(saved),before);}assert.deepEqual(compileCellReport(saved,facts).publication.sheets[0].cells,base.publication.sheets[0].cells);
});
test('AC-25 textual detail IDs preserve zeroes through VTable publication and harmless format changes',()=>{
  const d=panel({},[{type:'aggregated',field:'code',agg:'count'}]),c=field(d,'code'),next=apply(d,c,format(d,c,'emptyDisplay','N/A')),r=compileCellReport(next,[...facts,{...facts[0],id:'c',code:'0'}]);assert.equal(r.valid,true);for(const code of ['0012','0000','0'])assert.ok(r.publication.sheets[0].cells.some(c=>c.v===code&&c.displayText===code),code);
});

test('AC-26 shared metric edits update derived totals while leaving the same-field dimension and total format intact',()=>{
  const d=compilePanelToCellTemplate({datasetId:'facts',dimensions:{categories:['qty'],columnTimeBucket:{field:'day',granularity:'day'}},columns:[{type:'aggregated',field:'qty',agg:'sum'}]},'facts',{showRowTotals:true}),total=d.cells.find(c=>c.id==='meas-rowtotal-qty');
  total.content.formatOptions={precision:3,suffix:'总计'};d.styleRules=[{id:'total-style',sheetId:'sheet-1',targetId:total.id,target:targetForCell(total),scope:'template-cell',priority:0,style:{bold:true}}];
  const next=changeMetricAggregation(d,'qty','avg',context);assert.equal(field(next,'qty','row-dimension').content.operation,'group');assert.equal(field(next,'qty','measure').content.operation,'avg');assert.equal(next.cells.find(c=>c.id===total.id).content.operation,'avg');assert.deepEqual(next.cells.find(c=>c.id===total.id).content.formatOptions,total.content.formatOptions);assert.equal(next.styleRules[0].target.operation,'avg');assert.deepEqual(next.mergeConfig,d.mergeConfig);
});

test('AC-27 quarter and week display formats use the period start without changing membership',()=>{
  for(const granularity of ['quarter','week']){const d=panel({columnTimeBucket:{field:'day',granularity}}),c=field(d,'day'),next=toolbarFormat(d,c,'yyyy"年"mm"月"dd"日"'),r=compileCellReport(next,facts);assert.equal(r.valid,true);const headers=r.publication.sheets[0].cells.filter(c=>typeof c.v==='string'&&/^2026-(?:Q|\d)/.test(c.v));assert.ok(headers.length);assert.ok(headers.every(c=>/^2026年\d{2}月\d{2}日$/.test(c.displayText)),JSON.stringify(headers));assert.equal(next.hybridConfig.columnAxes[0].timeBucket.granularity,granularity);}
});

test('AC-28 same-field typed rules validate selected roles rather than a different source role',()=>{
  const d=panel({categories:['team']},[{type:'aggregated',field:'team',agg:'count'}]),c=field(d,'team','measure');rule(d,c,compare('number','gt',0));d.presentationRules.ruleSets[0].target={...targetForCell(c),kind:'field',roles:['data']};const r=compileCellReport(d,facts);assert.equal(r.valid,true,JSON.stringify(r.diagnostics));assert.ok(r.publication.sheets[0].cells.some(c=>c.v===1&&c.displayText==='命中'));assert.ok(r.publication.sheets[0].cells.some(c=>c.v==='甲'&&c.displayText==='甲'));
  d.presentationRules.ruleSets[0].target.roles=['data','dimension'];assert.equal(compileCellReport(d,facts).valid,false);d.presentationRules.ruleSets[0].rules[0].predicate={...compare('text','contains','1'),left:{kind:'current',basis:'text'}};assert.equal(compileCellReport(d,facts).valid,true);
});

test('AC-29 blank sources have no advanced settings while zero, false and empty-result bindings remain configurable',()=>{
  const d=panel(),c=literal(d);
  assert.equal(canOpenCellAdvancedSettings(undefined),false);
  assert.equal(canOpenCellAdvancedSettings(null),false);
  for(const value of [null,undefined,'','   ','\n\t']){
    c.content={kind:'literal',value};
    c.style={backgroundColor:'#FFF1F0'};
    c.staticSpan={...createAdvancedCellDraft(d,c).staticSpan,enabled:true,merge:false};
    assert.equal(canOpenCellAdvancedSettings(c),false);
  }
  for(const value of [0,false,'0','0012','备注']){c.content={kind:'literal',value};assert.equal(canOpenCellAdvancedSettings(c),true);}
  c.content={kind:'sheet-formula',formula:'=""'};assert.equal(canOpenCellAdvancedSettings(c),true);
  c.content={kind:'business-formula',metricId:'empty',expression:'SUM(qty)',scope:'summary'};assert.equal(canOpenCellAdvancedSettings(c),true);
  assert.equal(canOpenCellAdvancedSettings(field(d,'team')),true);
  assert.equal(canOpenCellAdvancedSettings(field(d,'qty')),true);
});

test('AC-30 static cells omit empty fallback editing without dropping existing format, rules or merge intent',()=>{
  const d=panel(),c=literal(d,'说明');
  c.content.formatOptions={emptyDisplay:'历史文案',tooltip:'原备注'};
  c.staticSpan={...createAdvancedCellDraft(d,c).staticSpan,enabled:true,merge:false,suppressions:['cancelled-member']};
  setPresentation(d,field(d,'qty').id,{operator:'gt',threshold:0,text:'有产出'});
  assert.deepEqual(getCellCapabilities(c,context).formatKeys,[]);
  assert.throws(()=>format(d,c,'emptyDisplay','无'),/不支持/);
  assert.throws(()=>format(d,c,'tooltip','未接通的备注'),/不支持/);
  const draft=createAdvancedCellDraft(d,c);draft.text='修改内容';draft.dirty.text=true;
  const next=apply(d,c,buildAdvancedCellUpdate(d,c,draft,context)),updated=next.cells.find(x=>x.id===c.id);
  assert.equal(updated.content.value,'修改内容');assert.equal(updated.content.formatOptions.emptyDisplay,'历史文案');assert.equal(updated.content.formatOptions.tooltip,'原备注');
  assert.deepEqual(updated.staticSpan,c.staticSpan);assert.deepEqual(next.presentationRules,d.presentationRules);
  assert.equal(getCellCapabilities(field(d,'team'),context).formatKeys.includes('emptyDisplay'),true);
  c.content={kind:'literal',value:0};delete c.content.formatOptions;
  const cap=getCellCapabilities(c,context);assert.equal(cap.valueType,'number');assert.deepEqual(cap.formatKeys,[]);assert.deepEqual(cap.numericFormats,[]);
});

test('AC-31 Univer boolean snapshots retain source types and do not turn static false into a numeric cell',()=>{
  for(const [v,t,expected]of [[0,3,false],[1,3,true],[0,2,0],[1,2,1],[false,3,false]]){
    const d=panel(),c=literal(d,false);
    const next=syncDocumentFromWorkbookSnapshot(d,{sheets:{'sheet-1':{cellData:{12:{9:{v,t}}}}}},'design');
    const saved=next.cells.find(x=>x.id===c.id);
    assert.equal(saved.content.value,expected);
    assert.equal(canOpenCellAdvancedSettings(saved),true);
    assert.equal(getCellCapabilities(saved,context).valueType,typeof expected==='boolean'?'boolean':'number');
    assert.deepEqual(getCellCapabilities(saved,context).numericFormats,[]);
  }
});

test('AC-32 native edit commands decode typed boolean payloads while keeping numeric zero',()=>{
  const listeners=new Map(),edits=[];
  const api={Event:{CommandExecuted:'command'},addEvent(name,fn){listeners.set(name,fn);return{dispose:()=>listeners.delete(name)};}};
  const dispose=attachUniverDesignerEvents(api,{onCellEdited:e=>edits.push(e)});
  for(const [payload,value]of [[{v:0,t:3},false],[{v:1,t:3},true],[{v:0,t:2},0]]){
    for(const params of [
      {range:{startRow:12,startColumn:9},value:payload},
      {range:{startRow:12,startColumn:9},value:{12:{9:payload}}},
      {range:{startRow:12,startColumn:9},value:[[payload]]},
      {cellValue:{12:{9:payload}}},
    ]){
      listeners.get('command')({id:'sheet.command.set-range-values',params:{...params,subUnitId:'sheet-1'}});
      assert.equal(edits.at(-1).value,value);assert.equal(edits.at(-1).row,12);assert.equal(edits.at(-1).column,9);
    }
  }
  dispose();assert.equal(listeners.size,0);
});

test('AC-33 static advanced edits accept only content and span while retaining existing source metadata',()=>{
  const d=panel(),c=literal(d,'说明'),draft=createAdvancedCellDraft(d,c);
  draft.style.style.color='#1677FF';draft.dirty.style=true;
  assert.throws(()=>buildAdvancedCellUpdate(d,c,draft,context),/Excel 工具栏/);
  assert.throws(()=>validateAdvancedCellUpdate(d,c,{style:{fontSize:20}},context),/Excel 工具栏/);
  assert.throws(()=>validateAdvancedCellUpdate(d,c,{presentationRules:{version:1,revision:1,ruleSets:[]}},context),/条件规则/);
  const allowed=createAdvancedCellDraft(d,c);allowed.text='新说明';allowed.dirty.text=true;
  allowed.staticSpan={...allowed.staticSpan,enabled:true,merge:false};allowed.dirty.staticSpan=true;
  const update=buildAdvancedCellUpdate(d,c,allowed,context);
  assert.equal(update.content.value,'新说明');assert.equal(update.staticSpan.merge,false);
  assert.equal('visualStyleRules' in update,false);assert.equal('presentationRules' in update,false);
});

test('AC-34 native toolbar wrapping persists through projection, source save and VTable publication',()=>{
  let d=panel();const c=literal(d,'较长的静态说明文字，用于验证工具栏的自动换行保存');
  c.staticSpan={...createAdvancedCellDraft(d,c).staticSpan,enabled:true,merge:false,suppressions:['cancelled-member']};
  let projectedStyle={fontSize:18,align:'center',wrapText:false};
  for(const [tb,wrapText]of [[3,true],[1,false],[2,false]]){
    const grid={cells:[{row:12,col:9,sourceCellId:c.id,value:c.content.value,role:'custom',style:projectedStyle}],merges:[],bindings:[]};
    const snapshot={sheets:{'sheet-1':{cellData:{12:{9:{v:c.content.value,s:{tb,fs:18,ht:2},custom:{biProjection:true}}}}}}};
    d=JSON.parse(JSON.stringify(syncDocumentFromWorkbookSnapshot(d,snapshot,'design',grid)));
    const r=compileCellReport(d,facts);assert.equal(r.valid,true,JSON.stringify(r.diagnostics));
    const cell=r.publication.sheets[0].cells.find(x=>x.v===c.content.value),style=r.publication.styles[cell.styleId];
    assert.equal(style.wrapText,wrapText);assert.equal(publishedStyleToUniver(style).tb,wrapText?3:2);
    assert.equal(d.cells.find(x=>x.id===c.id).staticSpan.merge,false);
    assert.deepEqual(d.cells.find(x=>x.id===c.id).staticSpan.suppressions,['cancelled-member']);
    projectedStyle={...projectedStyle,wrapText};
  }
  assert.equal(extractStyleFromUniver({tb:3}).wrapText,true);
  assert.equal(extractStyleFromUniver({tb:2}).wrapText,false);
});
