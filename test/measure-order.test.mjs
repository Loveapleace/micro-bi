import test from 'node:test';
import assert from 'node:assert/strict';
import { moveMeasure, reconcileMeasureSelection, relocateMeasureCustomizations } from '../dist/esm/cell-designer/measureOrder.js';
import { compilePanelToCellTemplate } from '../dist/esm/report-template/panelToTemplateAdapter.js';
import { collectHybridLayoutOverrides, mergeHybridCells, mergeHybridLayoutRules } from '../dist/esm/cell-designer/hybridTemplateState.js';
import { compileCellReport } from '../dist/esm/report-template/compileCellReport.js';
import { expandCellDrivenTemplate } from '../dist/esm/report-template/cellExpansionEngine.js';
import { indexToColLetter } from '../dist/esm/report-template/sheetFormulaEvaluator.js';

const facts=[{id:'one',team:'A',day:'2026-08-01',a:50,b:5,c:2},{id:'two',team:'B',day:'2026-08-01',a:80,b:4,c:3}];
const config=(kind,order=['a','b','c'])=>({datasetId:'facts',dimensions:kind==='detail'?{}:{categories:['team'],
  ...(kind==='pivot'?{columnTimeBucket:{field:'day',granularity:'day'}}:{})},columns:order.map(field=>({type:'aggregated',field,agg:'sum'}))});
const panel=(kind,order)=>compilePanelToCellTemplate(config(kind,order),'facts',{showRowTotals:kind==='pivot'});
const metric=(doc,key)=>doc.cells.find(cell=>cell.content.kind==='field'&&['measure','detail-column'].includes(cell.content.role)&&cell.content.fieldKey===key);
const formula=(text)=>({id:'user-formula',sheetId:'sheet-1',position:{row:30,column:10},parents:{row:'none',column:'none'},content:{kind:'sheet-formula',formula:text}});
const reordered=(before,nextPanel,extras,layouts=[],data=facts)=>{
  const moved=relocateMeasureCustomizations(before,nextPanel,extras,layouts,data);
  return {...before,hybridConfig:nextPanel.hybridConfig,cells:mergeHybridCells(nextPanel,moved.cells,before.cells),
    layoutRules:mergeHybridLayoutRules(nextPanel,moved.layouts)};
};
const published=(doc,data=facts)=>{const result=compileCellReport(doc,data);assert.equal(result.valid,true,JSON.stringify(result.diagnostics));return result.publication;};
const valuesFor=(report,id)=>report.sheets[0].cells.filter(cell=>cell.sourceCellId===id).map(cell=>cell.v).sort((a,b)=>String(a).localeCompare(String(b)));

test('MO-01 explicit order survives Checkbox registration order, added selections and select-all',()=>{
  const initial=['a','b','c'],sorted=moveMeasure(initial,'a','c');assert.deepEqual(initial,['a','b','c']);assert.deepEqual(sorted,['b','c','a']);
  const added=reconcileMeasureSelection(sorted,['a','b','c','d']);assert.deepEqual(added,['b','c','a','d']);
  const removed=reconcileMeasureSelection(added,['a','c','d']);assert.deepEqual(removed,['c','a','d']);
  assert.deepEqual(reconcileMeasureSelection(removed,['a','b','c','d']),['c','a','d','b']);
  assert.deepEqual(moveMeasure(sorted,'missing','a'),sorted);assert.deepEqual(moveMeasure(sorted,'b','b'),sorted);
});

for(const kind of ['detail','grouped','pivot'])test(`MO-${kind} sorting keeps identities, captions, formats, conditions and dynamic values`,()=>{
  const before=panel(kind),source=metric(before,'a'),caption=before.cells.find(cell=>cell.content.kind==='literal'&&cell.id.endsWith('-a'));
  const extras=[{...source,style:{...source.style,color:'#123456',bold:true},formatOptions:{precision:3,format:'number'},mergePolicy:'none'},
    {...caption,content:{kind:'literal',value:'指标A改名'},literalOverride:true}];
  before.cells=mergeHybridCells(before,extras);
  before.styleRules=[{id:'paint-a',sheetId:'sheet-1',scope:'template-cell',targetId:source.id,style:{italic:true},priority:1}];
  before.presentationRules={version:1,revision:1,ruleSets:[{id:'condition-a',order:0,target:{sheetId:'sheet-1',cellId:source.id},rules:[{
    id:'positive',name:'positive',order:0,enabled:true,stopIfTrue:true,predicate:{kind:'comparison',left:{kind:'current'},operator:'gt',right:{kind:'literal',value:0}},
    style:{scope:'cell',style:{backgroundColor:'#ffeeee'}}}]}]};
  const next=reordered(before,panel(kind,['b','c','a']),extras),saved=JSON.parse(JSON.stringify(next));
  assert.deepEqual(saved.cells.filter(cell=>cell.content.kind==='field'&&['measure','detail-column'].includes(cell.content.role)&&!cell.id.startsWith('meas-rowtotal-')).map(cell=>cell.content.fieldKey),['b','c','a']);
  assert.equal(metric(saved,'a').id,source.id);assert.equal(metric(saved,'a').style.color,'#123456');
  assert.equal(metric(saved,'a').formatOptions.precision,3);assert.equal(metric(saved,'a').mergePolicy,'none');
  assert.equal(saved.cells.find(cell=>cell.id===caption.id).content.value,'指标A改名');assert.deepEqual(saved.styleRules,before.styleRules);assert.deepEqual(saved.presentationRules,before.presentationRules);
  for(const data of [facts,[...facts].reverse(),facts.slice(1),[...facts,{id:'three',team:'C',day:'2026-08-02',a:9,b:3,c:1}],[],facts]){
    const old=published(before,data),after=published(saved,data);for(const key of ['a','b','c'])assert.deepEqual(valuesFor(after,metric(saved,key).id),valuesFor(old,metric(before,key).id));
  }
  if(kind==='detail'){
    assert.equal(metric(saved,'b').parents.row,'none');assert.equal(metric(saved,'a').parents.row,metric(saved,'b').id);
  }
});

test('MO-05 custom column dimensions follow their metric while static title geometry remains fixed',()=>{
  const before=panel('detail'),nextPanel=panel('detail',['b','c','a']);
  const layouts=[{id:'a-width',kind:'column-width',sheetId:'sheet-1',index:0,size:210},{id:'b-width',kind:'column-width',sheetId:'sheet-1',index:1,size:125}];
  const moved=relocateMeasureCustomizations(before,nextPanel,[],layouts,facts);
  assert.deepEqual(moved.layouts.map(rule=>[rule.id,rule.index,rule.size]),[['a-width',2,210],['b-width',0,125]]);
  const next=reordered(before,nextPanel,[],layouts);assert.deepEqual(next.layoutRules.find(rule=>rule.id==='merge-title'),before.layoutRules.find(rule=>rule.id==='merge-title'));
  const sheet=published(next).sheets[0];assert.equal(sheet.colWidths[2],210);assert.equal(sheet.colWidths[0],125);
});

test('MO-06 row dimensions follow vertically arranged pivot metrics',()=>{
  const before=panel('pivot'),nextPanel=panel('pivot',['b','c','a']),row=metric(before,'a').position.row;
  const moved=relocateMeasureCustomizations(before,nextPanel,[],[{id:'a-height',kind:'row-height',sheetId:'sheet-1',index:row,size:42}],facts);
  assert.equal(moved.layouts[0].index,metric(nextPanel,'a').position.row);assert.equal(moved.layouts[0].size,42);
});

test('MO-10 restore/capture retains resized generated columns and custom heights at their own indices',()=>{
  const before=panel('detail'),generated={id:'base-width',kind:'column-width',sheetId:'sheet-1',index:0,size:140};
  before.layoutRules.push(generated);
  const resized={...generated,size:217},height={id:'custom-height',kind:'row-height',sheetId:'sheet-1',index:4,size:41};
  const saved=before.layoutRules.map(rule=>rule===generated?resized:rule);saved.push(height);
  assert.deepEqual(collectHybridLayoutOverrides(JSON.parse(JSON.stringify(saved)),before),[resized,height]);
});

test('MO-07 A1 formulas keep the same metric references, absolute markers and quoted text',()=>{
  const before=panel('detail'),f=formula('=$A$4/B4+LEN("A4")+IF(B4>0,C4,0)');before.cells.push(f);
  const next=reordered(before,panel('detail',['b','c','a']),[f]);
  assert.equal(next.cells.find(cell=>cell.id===f.id).content.formula,'=$C$4/A4+LEN("A4")+IF(A4>0,B4,0)');
  assert.deepEqual(valuesFor(published(next),f.id),valuesFor(published(before),f.id));
});

test('MO-08 continuous ranges relocate; a range split by sorting rejects atomically',()=>{
  const before=panel('detail'),f=formula('=SUM(A4:A5)+SUM(A4:C5)');before.cells.push(f);
  const next=reordered(before,panel('detail',['b','c','a']),[f]);assert.equal(next.cells.find(cell=>cell.id===f.id).content.formula,'=SUM(C4:C5)+SUM(A4:C5)');
  assert.deepEqual(valuesFor(published(next),f.id),valuesFor(published(before),f.id));
  const unsafe={...f,content:{kind:'sheet-formula',formula:'=SUM(A4:B4)'}};before.cells=before.cells.map(cell=>cell.id===f.id?unsafe:cell);const snapshot=JSON.stringify(before);
  assert.throws(()=>relocateMeasureCustomizations(before,panel('detail',['b','c','a']),[unsafe],[],facts),/不再连续/);assert.equal(JSON.stringify(before),snapshot);
});

test('MO-09 pivot formulas relocate repeated group instances instead of only the template row',()=>{
  const before=panel('pivot'),id=metric(before,'a').id,grid=expandCellDrivenTemplate(before,facts).grid;
  const members=grid.cells.filter(cell=>cell.sourceCellId===id&&cell.col===2).sort((a,b)=>a.row-b.row);assert.equal(members.length,2);
  const address=cell=>`${indexToColLetter(cell.col)}${cell.row+1}`,f=formula('='+members.map(address).join('+'));before.cells.push(f);
  const next=reordered(before,panel('pivot',['b','c','a']),[f]),newMembers=expandCellDrivenTemplate(next,facts).grid.cells.filter(cell=>cell.sourceCellId===id&&cell.col===2).sort((a,b)=>a.row-b.row);
  assert.equal(next.cells.find(cell=>cell.id===f.id).content.formula,'='+newMembers.map(address).join('+'));
  assert.deepEqual(valuesFor(published(next),f.id),valuesFor(published(before),f.id));
});
