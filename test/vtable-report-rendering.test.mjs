import test from 'node:test';
import assert from 'node:assert/strict';
import { pointsToPixels, pixelsToPoints } from '../dist/esm/report/fontMetrics.js';
import { mapPublishedStyleToVTable } from '../dist/esm/ui/presentation/report/styleAdapter.js';
import { publishedStyleToUniver } from '../dist/esm/report/buildBiGrid.js';
import { applyPresentationRules } from '../dist/esm/report-template/presentationRules.js';
import { createDetailReportTemplate } from '../dist/esm/report-template/detailPreset.js';
import { ReportTableRuntime } from '../dist/esm/ui/presentation/report/reportTableRuntime.js';
import { canvasPixelRatio } from '../dist/esm/ui/presentation/report/canvasViewport.js';
import { registerPixelFontTable } from '../dist/esm/ui/presentation/table/exportFontMetrics.js';
import { formatNativeExcelCell } from '../dist/esm/ui/presentation/table/nativeTableExport.js';

const sheet=(values=['A','B'])=>({id:'s',name:'Report',rowCount:values.length,colCount:1,
  cells:values.map((v,r)=>({r,c:0,v,displayText:v+'!',styleId:'s',sourceCellId:'field',bindingId:'member-'+v})),merges:[],defaultRowHeight:28});
class NativeTable {
  calls={records:0,options:0,release:0,resize:0,density:0};
  selected=[];scrollLeft=0;scrollTop=0;isReleased=false;
  constructor(options){this.options=options;this.records=options.records;this.columns=options.columns;this.pixelRatio=options.pixelRatio;}
  setRecords(records){this.calls.records++;this.records=records;this.scrollLeft=0;this.scrollTop=0;}
  updateOption(options){this.calls.options++;this.options=options;this.columns=options.columns;this.records=options.records;return Promise.resolve();}
  clearSelected(){this.selected=[];}
  selectCells(ranges){this.selected=ranges;}
  getSelectedCellRanges(){return this.selected;}
  setScrollLeft(value){this.scrollLeft=value;}
  setScrollTop(value){this.scrollTop=value;}
  setPixelRatio(value){this.calls.density++;this.pixelRatio=value;}
  resize(){this.calls.resize++;}
  release(){this.calls.release++;this.isReleased=true;}
}
const setup=()=>{const tables=[];const runtime=new ReportTableRuntime(options=>{const table=new NativeTable(options);tables.push(table);return table;});return {runtime,tables};};

test('VT-01 source points round-trip and VTable renders the same size as Univer',()=>{
  for(const size of [8,11,14,18,24,36]){
    const source={fontFamily:'Arial',fontSize:size,align:'center'};
    assert.equal(publishedStyleToUniver(source).fs,size);
    assert.equal(mapPublishedStyleToVTable(source).fontSize,size*96/72);
    assert.ok(Math.abs(pixelsToPoints(pointsToPixels(size))-size)<1e-10);
    assert.equal(source.fontSize,size);
  }
  assert.equal(mapPublishedStyleToVTable().fontSize,44/3);
});

test('VT-02 automatic heights use point-to-pixel metrics and preserve explicit row heights',()=>{
  const doc=createDetailReportTemplate({datasetId:'d',title:'Report',fields:[{key:'qty'}]});
  const grid={type:'detail',rowCount:1,colCount:1,bindings:[],merges:[],defaultRowHeight:24,
    cells:[{row:0,col:0,role:'custom',value:'字号',style:{fontSize:24}}]};
  assert.equal(applyPresentationRules(doc,grid).grid.rowHeights[0],40);
  assert.equal(applyPresentationRules(doc,{...grid,rowHeights:{0:20}}).grid.rowHeights[0],20);
  const normal={...grid,cells:[{...grid.cells[0],style:{fontSize:11}}]};
  assert.equal(applyPresentationRules(doc,normal).grid.rowHeights[0],undefined);
});

test('VT-03 fractional page scale and device DPR determine raster density without integer rounding',()=>{
  assert.equal(canvasPixelRatio(1.5,.875,.875),1.3125);
  assert.equal(canvasPixelRatio(1.25,1,1),1.25);
  assert.equal(canvasPixelRatio(2,1.25,1.25),2.5);
  assert.equal(canvasPixelRatio(2,.5,1),2);
  assert.equal(canvasPixelRatio(3,4,4),4);
});

test('VT-04 repeated values, formats and conditional styles update one native instance',()=>{
  const {runtime,tables}=setup();const original=sheet();runtime.apply('r',original,{s:{fontSize:11,color:'#111111'}});
  const table=tables[0],column=table.columns[0];
  const updated={...sheet(),cells:sheet().cells.map(c=>({...c,displayText:'已更新-'+c.v}))};
  runtime.apply('r',updated,{s:{fontSize:18,color:'#ff0000'}});
  assert.equal(tables.length,1);assert.equal(table.calls.release,0);assert.equal(table.calls.records,1);
  assert.equal(column.fieldFormat(table.records[0]),'已更新-A');
  assert.equal(column.style({row:0}).fontSize,24);assert.equal(column.style({row:0}).color,'#ff0000');
  assert.equal(table.records[0].col_0,'A');runtime.dispose();assert.equal(table.calls.release,1);
});

test('VT-05 row insertion and deletion reuse the data API while layouts use updateOption',async()=>{
  const {runtime,tables}=setup();runtime.apply('r',sheet(),{});
  runtime.apply('r',sheet(['A','B','C']),{});runtime.apply('r',sheet(['C']),{});
  runtime.apply('r',{...sheet(['C']),colWidths:{0:240},merges:[{startRow:0,endRow:0,startCol:0,endCol:0}]},{});
  await Promise.resolve();assert.equal(tables.length,1);assert.equal(tables[0].calls.records,2);assert.equal(tables[0].calls.options,1);
  assert.equal(tables[0].columns[0].width,240);runtime.dispose();
});

test('VT-06 scroll and a selected business cell survive sorting, and deleted identities clear selection',()=>{
  const {runtime,tables}=setup();runtime.apply('r',sheet(),{});const table=tables[0];
  table.selected=[{start:{col:0,row:0},end:{col:0,row:0}}];table.scrollTop=42;
  runtime.apply('r',sheet(['B','A']),{});
  assert.equal(table.scrollTop,42);assert.equal(table.selected[0].start.row,1);
  runtime.apply('r',sheet(['B']),{});assert.deepEqual(table.selected,[]);runtime.dispose();
});

test('VT-07 switching source/detail sheets preserves each scroll position and only unmount releases',async()=>{
  const {runtime,tables}=setup();runtime.apply('r',sheet(),{});const table=tables[0];table.scrollTop=70;
  runtime.apply('r',{...sheet(['X']),id:'detail'},{});assert.equal(table.scrollTop,0);table.scrollTop=14;
  runtime.apply('r',sheet(),{});await Promise.resolve();assert.equal(table.scrollTop,70);assert.equal(tables.length,1);
  runtime.dispose();runtime.dispose();assert.equal(table.calls.release,1);assert.equal(runtime.apply('r',sheet(),{}),null);
});

test('VT-08 density-only updates do not replace data; hidden-to-visible forces a layout refresh',()=>{
  const {runtime,tables}=setup();runtime.updateViewport({width:650,height:400,scaleX:1,scaleY:1,pixelRatio:1.5});runtime.apply('r',sheet(),{});const table=tables[0];
  runtime.updateViewport({width:650,height:400,scaleX:.875,scaleY:.875,pixelRatio:1.3125});
  assert.equal(table.pixelRatio,1.3125);assert.equal(table.calls.records,0);assert.equal(table.calls.resize,0);
  runtime.updateViewport(undefined);runtime.updateViewport({width:650,height:400,scaleX:1,scaleY:1,pixelRatio:1.5});
  assert.equal(table.calls.resize,1);runtime.dispose();
});

test('VT-09 native xlsx keeps source point sizes including repeat callbacks for merged masters',()=>{
  const table={getCellOriginValue:()=>42,getCellRange:()=>({start:{row:0,col:0}}),getCellStyle:()=>({fontSize:24})};
  registerPixelFontTable(table);const cell={value:0,font:{size:24,bold:true}};
  for(let col=0;col<3;col++)formatNativeExcelCell({table,row:0,col,cellValue:42},cell);
  assert.equal(cell.font.size,18);assert.equal(cell.font.bold,true);assert.equal(cell.value,42);
  const ordinary={value:42,font:{size:14}};formatNativeExcelCell({table:{getCellOriginValue:()=>42},row:0,col:0,cellValue:42},ordinary);
  assert.equal(ordinary.font.size,14);
});

test('VT-10 unchanged merge bounds still refresh the master text and merged style',async()=>{
  const {runtime,tables}=setup();const merged={...sheet(),merges:[{startRow:0,endRow:1,startCol:0,endCol:0}]};
  runtime.apply('r',merged,{s:{fontSize:11,color:'#111111'}});
  runtime.apply('r',{...merged,cells:merged.cells.map(c=>({...c,displayText:'新的合并标题'}))},{s:{fontSize:18,color:'#ff0000'}});
  await Promise.resolve();assert.equal(tables.length,1);assert.equal(tables[0].calls.options,1);
  const merge=tables[0].options.customMergeCell[0];assert.equal(merge.text,'新的合并标题');assert.equal(merge.style.fontSize,24);assert.equal(merge.style.color,'#ff0000');runtime.dispose();
});
