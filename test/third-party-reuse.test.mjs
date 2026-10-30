import test from 'node:test';
import assert from 'node:assert/strict';
import * as VTable from '@visactor/vtable';
import { evaluateSheetFormula } from '../dist/esm/report-template/sheetFormulaEvaluator.js';
import { compilePanelToCellTemplate, compileCellReport } from '../dist/esm/report-template/index.js';
import { formatNativeExcelCell, generateTableXlsx } from '../dist/esm/ui/presentation/table/nativeTableExport.js';
import { createSummaryAggregation, compareTableValues } from '../dist/esm/ui/presentation/table/tableSummary.js';

const sdk=VTable.ListTable?VTable:VTable.default;
const originalSort=sdk.data.DataSource.prototype.sort;
await import('../dist/esm/ui/index.js');

test('REUSE-01 importing UI leaves the SDK DataSource prototype unchanged',()=>{
  assert.equal(sdk.data.DataSource.prototype.sort,originalSort);
});
test('REUSE-02 TEXT reuses Excel format patterns for numeric, percent and leading zeros',()=>{
  for(const [formula,expected]of [['=TEXT(1234.5,"#,##0.00")','1,234.50'],['=TEXT(0.125,"0.0%")','12.5%'],['=TEXT(12,"0000")','0012'],['=TEXT(0,"0.00")','0.00'],['=TEXT(12,"")','']]){
    assert.deepEqual(evaluateSheetFormula(formula,()=>null),{value:expected});
  }
});
test('REUSE-03 TEXT supports numeric dates and date text without introducing Univer in the compiler',()=>{
  assert.deepEqual(evaluateSheetFormula('=TEXT(44927,"yyyy-mm-dd")',()=>null),{value:'2023-01-01'});
  assert.deepEqual(evaluateSheetFormula('=TEXT("2026-08-01","yyyy-mm-dd")',()=>null),{value:'2026-08-01'});
});
test('REUSE-04 TEXT retains actual formula errors and permits valid text beginning with #',()=>{
  assert.deepEqual(evaluateSheetFormula('=TEXT(1/0,"0")',()=>null),{value:'#DIV/0!',error:'ERR_DIVIDE_BY_ZERO'});
  assert.deepEqual(evaluateSheetFormula('=TEXT(1/0,"")',()=>null),{value:'#DIV/0!',error:'ERR_DIVIDE_BY_ZERO'});
  assert.equal(evaluateSheetFormula('=TEXT(12,"[broken")',()=>null).error,'ERR_INVALID_SHEET_FORMULA');
  assert.deepEqual(evaluateSheetFormula('=IFERROR(TEXT(12,"[broken"),"fallback")',()=>null),{value:'fallback'});
  assert.deepEqual(evaluateSheetFormula('=TEXT(12,"""#""000")',()=>null),{value:'#012'});
  assert.deepEqual(evaluateSheetFormula('=IFERROR("#tag","fallback")',()=>null),{value:'#tag'});
});
test('REUSE-05 TEXT survives the full template-to-VTable publication path',()=>{
  const doc=compilePanelToCellTemplate({datasetId:'facts',dimensions:{categories:['team']},columns:[{type:'aggregated',field:'qty',agg:'sum'}]},'facts');
  doc.cells.push({id:'formatted',sheetId:'sheet-1',position:{row:20,column:1},parents:{row:'none',column:'none'},content:{kind:'sheet-formula',formula:'=TEXT(1234.5,"#,##0.00")'}});
  const result=compileCellReport(doc,[{team:'A',qty:12}]);assert.equal(result.valid,true,JSON.stringify(result.diagnostics));
  const cell=result.publication.sheets[0].cells.find(c=>c.formula?.startsWith('=TEXT'));
  assert.equal(cell.v,'1,234.50');assert.equal(cell.displayText,'1,234.50');
});
test('REUSE-06 native xlsx callback preserves values and never converts strings into formulas',()=>{
  for(const value of [0,false,'','00123','2026-08','=1+1','+value',null]){
    const cell={value:'formatted',font:{bold:true}};
    const output=formatNativeExcelCell({table:{getCellOriginValue:()=>value},col:0,row:0,cellValue:'formatted'},cell);
    assert.equal(output,cell);assert.equal(output.value,value);assert.equal(output.font.bold,true);
    if(typeof value==='string')assert.equal(output.numFmt,'@');
  }
});
test('REUSE-07 native aggregation rows keep summary values outside sorted records',()=>{
  for (const order of ['asc', 'desc']) {
    assert.equal(compareTableValues(null, undefined, order), 0);
    assert.equal(compareTableValues(undefined, '', order), 0);
    assert.equal(compareTableValues(null, 0, order), 1);
    assert.equal(compareTableValues(0, '', order), -1);
  }
  const records=[{qty:15},{qty:50},{qty:20}],columns=[{field:'qty',sort:compareTableValues,aggregation:createSummaryAggregation(85)}];
  const ds=sdk.data.CachedDataSource.ofArray(records,null,null,columns);
  for(const order of ['asc','desc']){
    ds.sort([{field:'qty',order,orderFn:compareTableValues}]);assert.equal(ds.records.length,3);assert.equal(ds.fieldAggregators[0].value(),85);
  }
  assert.deepEqual(records,[{qty:15},{qty:50},{qty:20}]);
  ds.updateColumns([{field:'qty',sort:compareTableValues,aggregation:createSummaryAggregation(120)}]);
  // 与ListTable.updateColumns相同的公开DataSource刷新步骤。
  ds.processRecords(records);assert.equal(ds.fieldAggregators[0].value(),120);
});

test('REUSE-08 exporting a sorted table ignores circular pointer events in native sort state',async()=>{
  const event={};event.self=event;
  const table={isReleased:false,isListTable:()=>true,records:[{qty:1}],options:{columns:[]},sortState:{field:'qty',order:'asc',event},rowCount:2,exportToExcel:async()=>new Uint8Array([80,75]).buffer};
  assert.deepEqual([...new Uint8Array(await generateTableXlsx(table))],[80,75]);
});
test('REUSE-09 a data change during asynchronous export rejects the stale file',async()=>{
  let resolve;
  const table={isReleased:false,isListTable:()=>true,records:[{qty:1}],options:{columns:[]},rowCount:2,exportToExcel:()=>new Promise(r=>{resolve=r;})};
  const promise=generateTableXlsx(table);await new Promise(r=>setImmediate(r));table.records=[{qty:2}];resolve(new ArrayBuffer(2));
  await assert.rejects(promise,/数据或排序已变化/);
});

test('REUSE-10 closing during native export returns a readable cancellation rather than SDK internals',async()=>{
  const table={isReleased:false,isListTable:()=>true,records:[],options:{columns:[]},rowCount:1};
  table.exportToExcel=async()=>{table.isReleased=true;throw new Error('private model null');};
  await assert.rejects(generateTableXlsx(table),/表格已关闭，已取消导出/);
});
