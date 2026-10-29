import test from 'node:test';
import assert from 'node:assert/strict';
import {compilePanelToCellTemplate} from '../dist/esm/report-template/panelToTemplateAdapter.js';
import {isGuidedSourceDocument} from '../dist/esm/report-template/guidedSource.js';
import {guidedDataRanges,guidedCellProtected,protectGuidedSnapshot,shouldBlockGuidedCommand,attachGuidedEditingGuard} from '../dist/esm/cell-designer/guidedEditing.js';
import {syncDocumentFromWorkbookSnapshot} from '../dist/esm/cell-designer/syncWorkbookToTemplate.js';
import {biGridToUniverWorksheetData} from '../dist/esm/report/buildBiGrid.js';
const panel=()=>compilePanelToCellTemplate({datasetId:'facts',dimensions:{categories:['shop'],columnTimeBucket:{field:'day',granularity:'day'}},columns:['qty','bad'].map(field=>({type:'aggregated',field,agg:'sum'}))},'facts');
const cell=d=>d.cells.find(c=>c.content.kind==='field'&&c.content.fieldKey==='qty');
const selection=(row,col=0)=>({sheetId:'sheet-1',startRow:row,endRow:row,startColumn:col,endColumn:col});
const design=d=>({type:'detail',rowCount:25,colCount:15,bindings:[],merges:[],cells:d.cells.map(c=>({row:c.position.row,col:c.position.column,value:c.content.kind==='literal'?c.content.value:`{${c.id}}`,displayText:c.content.kind==='literal'?String(c.content.value):`{${c.id}}`,sourceCellId:c.id,regionId:c.regionId,role:'custom',style:{}}))});
test('GE-01 guided reader requires the mode3 source descriptor, not a recognizable matrix',()=>{
  const d=panel();assert.equal(isGuidedSourceDocument(d),true);assert.equal(isGuidedSourceDocument({...d,hybridConfig:{version:1,showRowTotals:true}}),true);delete d.hybridConfig;assert.equal(isGuidedSourceDocument(d),false);assert.equal(isGuidedSourceDocument({documentType:'cell-template',schemaVersion:'2.0',cells:[]}),false);
});
test('GE-02 malformed and unsupported guided capabilities are not converted',()=>{
  for(const patch of [{hybridConfig:{version:1}},{schemaVersion:'1.0'},{capabilitiesVersion:'cell-v2'},{regions:[]},null])assert.equal(isGuidedSourceDocument(patch===null?null:{...panel(),...patch}),false);
});
test('GE-03 complete prototype data rectangle is protected while the title and notes remain editable',()=>{
  const d=panel(),ranges=guidedDataRanges(d),q=cell(d);assert.equal(ranges.length,1);assert.ok(guidedCellProtected(d,q.position.row,q.position.column));assert.equal(guidedCellProtected(d,0,0),false);assert.equal(guidedCellProtected(d,12,10),false);assert.equal(guidedCellProtected(d,q.position.row,q.position.column,'other'),false);
});
test('GE-04 unbound gaps inside generated data are protected too',()=>{
  const d=panel(),r=guidedDataRanges(d)[0],positions=new Set(d.cells.map(c=>`${c.position.row}:${c.position.column}`));let blank;
  for(let row=r.startRow;row<=r.endRow;row++)for(let col=r.startColumn;col<=r.endColumn;col++)if(!positions.has(`${row}:${col}`))blank=[row,col];
  assert.ok(blank);assert.equal(guidedCellProtected(d,...blank),true);
});
test('GE-05 native value writes and paste intersecting a data cell are blocked',()=>{
  const d=panel(),q=cell(d),s=selection(q.position.row,q.position.column);for(const id of ['sheet.command.set-range-values','sheet.command.paste','sheet.command.cut','sheet.command.clear-selection-content'])assert.equal(shouldBlockGuidedCommand(d,'design',{id},s),true);
  assert.equal(shouldBlockGuidedCommand(d,'design',{id:'sheet.mutation.set-range-values',params:{cellValue:{[q.position.row]:{[q.position.column]:{v:999}}}}},selection(0)),true);
});
test('GE-06 static title/note text can still be edited',()=>{
  const d=panel();assert.equal(shouldBlockGuidedCommand(d,'design',{id:'sheet.command.set-range-values'},selection(0)),false);assert.equal(shouldBlockGuidedCommand(d,'design',{id:'sheet.command.paste'},selection(12,10)),false);
});
test('GE-07 operations on another sheet do not inherit this region range',()=>{
  const d=panel();assert.equal(shouldBlockGuidedCommand(d,'design',{id:'sheet.command.paste',params:{sheetId:'other',range:selection(3,2)}},selection(3,2)),false);
});
test('GE-08 insert before the whole data block is safe, insert within the prototype is blocked',()=>{
  const d=panel(),r=guidedDataRanges(d)[0];assert.equal(shouldBlockGuidedCommand(d,'design',{id:'sheet.command.insert-row-before'},selection(r.startRow)),false);assert.equal(shouldBlockGuidedCommand(d,'design',{id:'sheet.command.insert-row-before'},selection(r.startRow+1)),true);assert.equal(shouldBlockGuidedCommand(d,'design',{id:'sheet.command.insert-col-before'},selection(r.startRow,r.startColumn+1)),true);
});
test('GE-09 removing a data header/column is blocked, static rows and columns can be removed',()=>{
  const d=panel(),r=guidedDataRanges(d)[0];assert.equal(shouldBlockGuidedCommand(d,'design',{id:'sheet.command.remove-row'},selection(r.startRow)),true);assert.equal(shouldBlockGuidedCommand(d,'design',{id:'sheet.command.remove-row'},selection(r.endRow+3)),false);assert.equal(shouldBlockGuidedCommand(d,'design',{id:'sheet.command.remove-col'},selection(0,r.endColumn+3)),false);
});
test('GE-10 preview content/structure/style commands are read-only, selection and merge intent remain available',()=>{
  const d=panel(),s=selection(12,10);for(const id of ['sheet.command.set-range-values','sheet.command.paste','sheet.command.insert-row-before','sheet.command.set-style'])assert.equal(shouldBlockGuidedCommand(d,'preview',{id},s),true);for(const id of ['sheet.operation.set-selections','sheet.command.unmerge-cells'])assert.equal(shouldBlockGuidedCommand(d,'preview',{id},s),false);
});
test('GE-11 design style patches use the same protected cells without changing their values',()=>{
  const d=panel(),q=cell(d),s=selection(q.position.row,q.position.column);assert.equal(shouldBlockGuidedCommand(d,'design',{id:'sheet.command.set-style'},s),false);assert.equal(shouldBlockGuidedCommand(d,'design',{id:'sheet.mutation.set-range-values',params:{value:{0:{0:{s:{fs:18}}}}}},s),false);
  assert.equal(shouldBlockGuidedCommand(d,'design',{id:'sheet.mutation.set-range-values',params:{cellValue:{3:{1:{s:{fs:18,bl:1}}}},trigger:'sheet.command.set-style'}},s),false);
  assert.equal(shouldBlockGuidedCommand(d,'preview',{id:'sheet.mutation.set-range-values',params:{cellValue:{3:{1:{s:{fs:18}}}}}},s),true);
  assert.equal(shouldBlockGuidedCommand(d,'design',{id:'sheet.mutation.set-range-values',params:{cellValue:{[q.position.row]:{[q.position.column]:{s:{fs:18},v:999}}},trigger:'sheet.command.set-style'}},s),true);
});
test('GE-12 adding/removing worksheets cannot escape the guided single-report editor',()=>{
  for(const id of ['sheet.command.insert-sheet','sheet.command.remove-sheet','sheet.command.rename-sheet','sheet.command.set-worksheet-name','sheet.mutation.set-worksheet-hidden','sheet.command.set-worksheet-row-count'])assert.equal(shouldBlockGuidedCommand(panel(),'design',{id},selection(0)),true);
  const d=panel(),q=cell(d);for(const id of ['sheet.command.insert-range-move-down','sheet.command.delete-range-move-left'])assert.equal(shouldBlockGuidedCommand(d,'design',{id},selection(q.position.row,q.position.column)),true);
});
test('GE-13 snapshot defense preserves data header/field content, normal style changes and static notes',()=>{
  const d=panel(),g=design(d),snapshot={sheets:{'sheet-1':biGridToUniverWorksheetData(g)}};const q=cell(d),before=g.cells.find(c=>c.sourceCellId===q.id).value;
  snapshot.sheets['sheet-1'].cellData[q.position.row][q.position.column]={v:'非法字段',f:'=999',s:{fs:18}};snapshot.sheets['sheet-1'].cellData[12]={10:{v:'静态备注'}};
  const repaired=protectGuidedSnapshot(snapshot,d,g,'design');assert.equal(repaired.sheets['sheet-1'].cellData[q.position.row][q.position.column].v,before);assert.equal(repaired.sheets['sheet-1'].cellData[q.position.row][q.position.column].f,null);assert.equal(repaired.sheets['sheet-1'].cellData[q.position.row][q.position.column].s.fs,18);assert.equal(repaired.sheets['sheet-1'].cellData[12][10].v,'静态备注');assert.equal(snapshot.sheets['sheet-1'].cellData[q.position.row][q.position.column].v,'非法字段');
});
test('GE-14 repaired snapshots do not turn data-area gaps into free formula cells',()=>{
  const d=panel(),g=design(d),r=guidedDataRanges(d)[0],positions=new Set(d.cells.map(c=>`${c.position.row}:${c.position.column}`));let pos;
  for(let row=r.startRow;row<=r.endRow;row++)for(let col=r.startColumn;col<=r.endColumn;col++)if(!positions.has(`${row}:${col}`))pos=[row,col];
  const snapshot={sheets:{'sheet-1':biGridToUniverWorksheetData(g)}};snapshot.sheets['sheet-1'].cellData[pos[0]]||={};snapshot.sheets['sheet-1'].cellData[pos[0]][pos[1]]={v:999,f:'=999'};
  const saved=syncDocumentFromWorkbookSnapshot(d,protectGuidedSnapshot(snapshot,d,g,'design'),'design',g);assert.equal(saved.cells.some(c=>c.position.row===pos[0]&&c.position.column===pos[1]),false);
});
test('GE-15 SDK guard cancels F2/paste commands, allows static editing and source projection, disposes listeners',()=>{
  const handlers=new Map(),d=panel(),q=cell(d);let current=selection(q.position.row,q.position.column),mode='design',blocked=0;
  const api={Event:{BeforeSheetEditStart:'edit',BeforeClipboardPaste:'paste',BeforeCommandExecute:'command'},addEvent:(name,fn)=>{handlers.set(name,fn);return{dispose:()=>handlers.delete(name)};},getActiveWorkbook:()=>({getActiveSheet:()=>({getSheetId:()=>current.sheetId,getSelection:()=>({getActiveRange:()=>({getRange:()=>current})})})})};
  const dispose=attachGuidedEditingGuard(api,()=>({panel:d,mode}),()=>blocked++),event={row:q.position.row,column:q.position.column,eventType:0,cancel:false};handlers.get('edit')(event);assert.equal(event.cancel,true);const pasted={cancel:false};handlers.get('paste')(pasted);assert.equal(pasted.cancel,true);
  const double={...event,eventType:3,cancel:false};handlers.get('edit')(double);assert.equal(double.cancel,false);
  api.__biTransaction=true;const projected={...event,cancel:false};handlers.get('edit')(projected);assert.equal(projected.cancel,false);api.__biTransaction=false;
  current=selection(0);const title={row:0,column:0,cancel:false};handlers.get('edit')(title);assert.equal(title.cancel,false);mode='preview';const preview={row:0,column:0,cancel:false};handlers.get('edit')(preview);assert.equal(preview.cancel,true);assert.equal(blocked,3);dispose();assert.equal(handlers.size,0);
});
test('GE-16 standalone free editor and reducer are no longer public entry points',async()=>{
  const api=await import('../dist/esm/cell-designer/index.js');assert.equal('CellReportDesigner' in api,false);assert.equal('CellInspector' in api,false);assert.equal('ReportWizardModal' in api,false);assert.equal('designerReducer' in api,false);assert.equal(typeof api.HybridCellDesigner,'object');
});

test('GE-17 native merge mutations retain data values/formulas, allow unmerge style patches and keep static Excel behavior',()=>{
  const handlers=new Map(),d=panel(),q=cell(d);let mode='design';
  const api={Event:{BeforeCommandExecute:'command'},addEvent:(name,fn)=>{handlers.set(name,fn);return{dispose:()=>handlers.delete(name)};},getActiveWorkbook:()=>({getActiveSheet:()=>({getSheetId:()=>q.sheetId,getSelection:()=>({getActiveRange:()=>({getRange:()=>selection(q.position.row,q.position.column)})})})})};
  let blocked=0;const dispose=attachGuidedEditingGuard(api,()=>({panel:d,mode}),()=>blocked++);
  const mergeCommand={id:'sheet.command.add-worksheet-merge',params:{selections:[selection(q.position.row,q.position.column)]}};handlers.get('command')(mergeCommand);assert.equal(mergeCommand.params.defaultMerge,true);
  const staticMerge={id:mergeCommand.id,params:{selections:[selection(12,10)]}};handlers.get('command')(staticMerge);assert.equal(staticMerge.params.defaultMerge,undefined);
  const event={id:'sheet.mutation.set-range-values',params:{subUnitId:q.sheetId,trigger:'sheet.command.add-worksheet-merge',cellValue:{[q.position.row]:{[q.position.column]:{v:null,f:null,p:null,s:{bl:1}}},12:{10:null}}}};
  handlers.get('command')(event);assert.deepEqual(event.params.cellValue[q.position.row][q.position.column],{s:{bl:1}});assert.equal(event.params.cellValue[12][10],null);assert.equal(blocked,0);
  mode='preview';const unmerge={id:event.id,params:{trigger:'sheet.command.remove-worksheet-merge',cellValue:{12:{10:{s:{fs:18}}}}}};handlers.get('command')(unmerge);assert.deepEqual(unmerge.params.cellValue[12][10],{s:{fs:18}});assert.equal(blocked,0);
  const ordinary={id:event.id,params:{cellValue:{12:{10:{v:999}}}}};handlers.get('command')(ordinary);assert.equal(ordinary.cancel,true);assert.equal(blocked,1);dispose();
});

test('GE-18 readonly preview accepts identified formula results without allowing formula or style replacement',()=>{
  const d=panel(),s=selection(0),result={id:'sheet.mutation.set-range-values',params:{cellValue:{23:{13:{v:1350,t:2}}},sourceFormulaData:{23:{13:{f:'=SUM(C4:D4)'}}}}};
  assert.equal(shouldBlockGuidedCommand(d,'preview',result,s),false);
  assert.equal(shouldBlockGuidedCommand(d,'preview',{...result,params:{...result.params,sourceFormulaData:{}}},s),true);
  for(const extra of [{f:'=999'},{p:{}},{s:{fs:18}}])assert.equal(shouldBlockGuidedCommand(d,'preview',{...result,params:{...result.params,cellValue:{23:{13:{v:1350,...extra}}}}},s),true);
});

test('GE-19 multi-cell paste beginning above data is canceled before it overlaps generated headers',()=>{
  const handlers=new Map(),d=panel();let blocked=0;
  const api={Event:{BeforeClipboardPaste:'paste'},addEvent:(name,fn)=>{handlers.set(name,fn);return{dispose:()=>handlers.delete(name)};},getActiveWorkbook:()=>({getActiveSheet:()=>({getSheetId:()=> 'sheet-1',getSelection:()=>({getActiveRange:()=>({getRange:()=>selection(0)})})})})};
  const dispose=attachGuidedEditingGuard(api,()=>({panel:d,mode:'design'}),()=>blocked++),paste={text:'row1\nrow2\nrow3\nrow4',cancel:false};handlers.get('paste')(paste);assert.equal(paste.cancel,true);assert.equal(blocked,1);const title={text:'title',cancel:false};handlers.get('paste')(title);assert.equal(title.cancel,false);dispose();
});
