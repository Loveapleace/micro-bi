import test from 'node:test';
import assert from 'node:assert/strict';
import { createDetailReportTemplate, compileCellReport } from '../dist/esm/report-template/index.js';
import { biGridToUniverWorksheetData, spreadsheetCellValue } from '../dist/esm/report/buildBiGrid.js';
import { formatExcelValue } from '../dist/esm/report/numberFormat.js';

const preset = () => ({datasetId:'history-source',title:'车间历史记录',timeField:'$time',
  fields:[{key:'$time',label:'时间'},{key:'温度'},{key:'运行状态'},{key:'备注'}]});

test('HISTORY-01 a history seed uses controlled detail columns in the selected variable order',()=>{
  const doc=createDetailReportTemplate(preset());
  assert.equal(doc.regions[0].datasetId,'history-source');
  assert.equal(doc.title,'车间历史记录');
  const fields=doc.cells.filter(c=>c.content.kind==='field');
  assert.deepEqual(fields.map(c=>c.content.fieldKey),['$time','温度','运行状态','备注']);
  assert.ok(fields.every(c=>c.content.role==='detail-column'&&c.content.operation==='list'));
  assert.ok(!JSON.stringify(doc).includes('GVAR'));
});

test('HISTORY-02 complete history facts preserve numbers, zero, false and text when compiled',()=>{
  const doc=createDetailReportTemplate(preset());
  const facts=[{$time:new Date('2026-11-02T01:02:03Z'),温度:0,运行状态:false,备注:'00123'},
    {$time:new Date('2026-11-02T02:02:03Z'),温度:23.5,运行状态:true,备注:'=1+1'}];
  const before=JSON.stringify(doc),result=compileCellReport(doc,facts);
  assert.equal(result.valid,true);
  const sheet=result.publication.sheets[0];
  assert.equal(sheet.rowCount,5);
  assert.equal(sheet.cells.find(c=>c.r===3&&c.c===1).v,0);
  assert.equal(sheet.cells.find(c=>c.r===3&&c.c===2).v,false);
  assert.equal(sheet.cells.find(c=>c.r===3&&c.c===3).v,'00123');
  assert.equal(sheet.cells.find(c=>c.r===4&&c.c===3).v,'=1+1');
  assert.match(sheet.cells.find(c=>c.r===3&&c.c===0).displayText,/2026-11-02.*02:03/);
  assert.equal(JSON.stringify(doc),before);
});

test('HISTORY-03 empty, restored and reordered source data do not rewrite the history template',()=>{
  const doc=createDetailReportTemplate(preset()),copy=JSON.stringify(doc);
  const empty=compileCellReport(doc,[]);assert.equal(empty.valid,true);
  const facts=[{$time:new Date('2026-11-02T00:00:00Z'),温度:1,运行状态:false,备注:''},{$time:new Date('2026-11-03T00:00:00Z'),温度:2,运行状态:true,备注:''}];
  const compiled=compileCellReport(JSON.parse(copy),facts.reverse());
  assert.equal(compiled.valid,true);assert.equal(compiled.publication.sheets[0].cells.find(c=>c.r===3&&c.c===1).v,2);
  assert.equal(JSON.stringify(doc),copy);
});

test('HISTORY-04 invalid seed fields fail before any source binding is published',()=>{
  assert.throws(()=>createDetailReportTemplate({...preset(),fields:[]}),/字段/);
  assert.throws(()=>createDetailReportTemplate({...preset(),fields:[{key:'温度'},{key:'温度'}]}),/重复/);
  assert.throws(()=>createDetailReportTemplate({...preset(),timeField:'missing'}),/时间字段/);
});

test('HISTORY-05 native Excel projection uses date serials and retains matching presentation metadata',()=>{
  const value=new Date(2026,10,2,10,20,30),stamp=value.getTime(),pattern='yyyy-mm-dd hh:mm:ss';
  const sheet=biGridToUniverWorksheetData({type:'detail',rowCount:1,colCount:1,bindings:[],merges:[],cells:[{row:0,col:0,value,displayText:'2026-11-02 10:20:30',style:{format:pattern}}]});
  const cell=sheet.cellData[0][0];
  assert.equal(typeof cell.v,'number');assert.equal(cell.t,2);assert.equal(cell.custom.originalValue,cell.v);
  assert.equal(formatExcelValue(cell.v,pattern),'2026-11-02 10:20:30');assert.equal(value.getTime(),stamp);
  assert.equal(spreadsheetCellValue(false),false);assert.equal(spreadsheetCellValue(0),0);
  assert.equal(spreadsheetCellValue('2026-11-02'),'2026-11-02');assert.equal(spreadsheetCellValue(new Date('bad')),null);
});
