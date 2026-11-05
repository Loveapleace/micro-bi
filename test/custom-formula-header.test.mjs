import test from 'node:test';
import assert from 'node:assert/strict';
import { compilePanelToCellTemplate } from '../dist/esm/report-template/panelToTemplateAdapter.js';
import { expandCellDrivenTemplate } from '../dist/esm/report-template/cellExpansionEngine.js';
import { compileCellReport } from '../dist/esm/report-template/compileCellReport.js';
import { shouldOpenCellAdvancedOnDoubleClick, canOpenCellAdvancedSettings } from '../dist/esm/report-template/cellCapabilities.js';
import { offsetSheetFormulaReferences } from '../dist/esm/report-template/sheetFormulaEvaluator.js';
import { relocateMeasureCustomizations } from '../dist/esm/cell-designer/measureOrder.js';
import { mergeHybridCells } from '../dist/esm/cell-designer/hybridTemplateState.js';

const rows=[{id:1,device:'A',day:'2026-11-01',qty:10,speed:120},{id:2,device:'B',day:'2026-11-01',qty:20,speed:20},
  {id:3,device:'A',day:'2026-12-01',qty:30,speed:40},{id:4,device:'B',day:'2026-12-01',qty:40,speed:190}];
const template=(formula='=IF(C5>100,1,2)',header='自定义')=>{
  const doc=compilePanelToCellTemplate({datasetId:'data',dimensions:{categories:['device'],columnTimeBucket:{field:'day',granularity:'month'}},
    columns:['qty','speed'].map(field=>({type:'aggregated',field,agg:'sum'}))},'data');
  doc.cells.push({id:'custom-header',sheetId:'sheet-1',regionId:'region-1',position:{row:2,column:3},content:{kind:'literal',value:header},parents:{row:null,column:null}},
    {id:'custom-formula',sheetId:'sheet-1',regionId:'region-1',position:{row:4,column:3},content:{kind:'sheet-formula',formula},parents:{row:null,column:null}});
  return doc;
};
const covering=(range,r,c)=>range.startRow<=r&&range.endRow>=r&&range.startCol<=c&&range.endCol>=c;

test('CFH-01 worksheet formulas double-click natively; bound metrics, business formulas and static content retain their own entry',()=>{
  const d=template(),f=d.cells.find(c=>c.id==='custom-formula');assert.equal(canOpenCellAdvancedSettings(f),true);assert.equal(shouldOpenCellAdvancedOnDoubleClick(f),false);
  for(const cell of [undefined,{...f,content:{kind:'literal',value:''}},d.cells.find(c=>c.panelOwner?.semanticKey==='label:metric:qty')])assert.equal(shouldOpenCellAdvancedOnDoubleClick(cell),false);
  for(const cell of [d.cells.find(c=>c.id==='custom-header'),d.cells.find(c=>c.id==='meas-speed'),
    {...f,content:{kind:'business-formula',metricId:'b',expression:'[speed]*2',scope:'summary'}}])assert.equal(shouldOpenCellAdvancedOnDoubleClick(cell),true);
});

test('CFH-02 D3 authored text remains visible when D5 grows the time-driver footprint',()=>{
  const doc=template(),snapshot=JSON.stringify(doc),out=expandCellDrivenTemplate(doc,rows.slice(0,1));
  assert.equal(out.grid.cells.find(c=>c.sourceCellId==='custom-header').value,'自定义');
  assert.equal(out.grid.merges.some(m=>covering(m,2,3)),false);
  assert.equal(out.grid.cells.find(c=>c.sourceCellId==='custom-formula').value,1);assert.equal(JSON.stringify(doc),snapshot);
});

test('CFH-03 new/deleted members, reversed facts and JSON reopen preserve the authored header and merge intent',()=>{
  const doc=JSON.parse(JSON.stringify(template())),before=JSON.stringify(doc);
  for(const facts of [rows,[...rows].reverse(),rows.slice(1),[],rows]){
    const result=compileCellReport(doc,facts);assert.equal(result.valid,true,JSON.stringify(result.diagnostics));
    const sheet=result.publication.sheets[0],cell=sheet.cells.find(c=>c.sourceCellId==='custom-header');assert.ok(cell);assert.equal(cell.v,'自定义');
    assert.equal(sheet.merges.some(m=>covering(m,cell.r,cell.c)),false);assert.equal(JSON.stringify(doc),before);
  }
  assert.equal(doc.mergeConfig.policies.find(p=>p.target.templateCellId?.includes('col-day')).enabled,true);
});

test('CFH-09 an explicitly renamed generated caption is also protected from inferred merging',()=>{
  const doc=template(),header=doc.cells.find(c=>c.id==='custom-header');
  header.panelOwner={generator:'hybrid-panel',cellId:header.id,generation:'test'};header.literalOverride=true;
  assert.equal(expandCellDrivenTemplate(doc,rows.slice(0,1)).grid.merges.some(m=>covering(m,2,3)),false);
});

test('CFH-04 clearing the header allows automatic merging again; an explicit cancellation stays cancelled',()=>{
  for(const header of ['',null]){
    const doc=template(undefined,header);assert.equal(expandCellDrivenTemplate(doc,rows.slice(0,1)).grid.merges.some(m=>covering(m,2,3)),true);
    doc.mergeConfig.policies.find(p=>p.target.templateCellId?.includes('col-day')).enabled=false;
    assert.equal(expandCellDrivenTemplate(doc,rows.slice(0,1)).grid.merges.some(m=>covering(m,2,3)),false);
  }
});

test('CFH-05 explicit manual merges retain priority over the inferred-footprint content guard',()=>{
  const doc=template();doc.layoutRules.push({id:'intentional-header-merge',sheetId:'sheet-1',kind:'merge',source:'user',sequence:10,
    range:{startRow:2,endRow:2,startColumn:2,endColumn:3}});
  assert.ok(expandCellDrivenTemplate(doc,rows.slice(0,1)).grid.merges.some(m=>covering(m,2,3)));
});

test('CFH-06 horizontal and vertical formula instances use their own relative references',()=>{
  const doc=template(),out=expandCellDrivenTemplate(doc,rows),formulas=out.grid.cells.filter(c=>c.sourceCellId==='custom-formula').sort((a,b)=>a.row-b.row||a.col-b.col);
  assert.deepEqual(formulas.map(c=>[c.row,c.col,c.formula,c.value]),[[4,3,'=IF(C5>100,1,2)',1],[4,5,'=IF(E5>100,1,2)',2],
    [6,3,'=IF(C7>100,1,2)',2],[6,5,'=IF(E7>100,1,2)',1]]);
  assert.equal(doc.cells.find(c=>c.id==='custom-formula').content.formula,'=IF(C5>100,1,2)');
});

test('CFH-07 absolute and mixed references pin only the declared axis',()=>{
  for(const [reference,values] of [['$C$5',[1,1,1,1]],['C$5',[1,2,1,2]],['$C5',[1,1,2,2]]]){
    const cells=expandCellDrivenTemplate(template(`=IF(${reference}>100,1,2)`),rows).grid.cells.filter(c=>c.sourceCellId==='custom-formula').sort((a,b)=>a.row-b.row||a.col-b.col);
    assert.deepEqual(cells.map(c=>c.value),values,reference);
  }
  assert.equal(offsetSheetFormulaReferences('=SUM(C5:D6)+LEN("C5")+$C5+C$5+$C$5',2,2),'=SUM(E7:F8)+LEN("C5")+$C7+E$5+$C$5');
});

test('CFH-08 an independently positioned footer retains its reference when the region pushes it down',()=>{
  const doc=template();doc.cells.push({id:'footer',sheetId:'sheet-1',regionId:'region-1',position:{row:15,column:8},parents:{row:'none',column:'none'},content:{kind:'sheet-formula',formula:'=C5'}});
  const cell=expandCellDrivenTemplate(doc,rows).grid.cells.find(c=>c.sourceCellId==='footer');assert.ok(cell.row>15);assert.equal(cell.formula,'=C5');assert.equal(cell.value,120);
});

test('CFH-10 metric sorting preserves the authored header and each dependent formula result',()=>{
  const before=template(),next=compilePanelToCellTemplate({datasetId:'data',dimensions:{categories:['device'],columnTimeBucket:{field:'day',granularity:'month'}},
    columns:['speed','qty'].map(field=>({type:'aggregated',field,agg:'sum'}))},'data');
  const extras=before.cells.filter(c=>c.id==='custom-header'||c.id==='custom-formula'),moved=relocateMeasureCustomizations(before,next,extras,[],rows);
  const after={...before,cells:mergeHybridCells(next,moved.cells,before.cells),layoutRules:next.layoutRules};
  assert.equal(after.cells.find(c=>c.id==='custom-formula').content.formula,'=IF(C4>100,1,2)');
  const grid=expandCellDrivenTemplate(after,rows).grid;
  assert.deepEqual(grid.cells.filter(c=>c.sourceCellId==='custom-formula').sort((a,b)=>a.row-b.row||a.col-b.col).map(c=>c.value),[1,2,2,1]);
  assert.equal(grid.merges.some(m=>covering(m,2,3)),false);
});
