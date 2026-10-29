import test from 'node:test';
import assert from 'node:assert/strict';
import { compilePanelToCellTemplate, compileCellReport, isEditableGeneratedText, canOpenCellAdvancedSettings } from '../dist/esm/report-template/index.js';
import { guidedCellProtected, guidedCellContentProtected, protectGuidedSnapshot, shouldBlockGuidedCommand, attachGuidedEditingGuard } from '../dist/esm/cell-designer/guidedEditing.js';
import { syncDocumentFromWorkbookSnapshot } from '../dist/esm/cell-designer/syncWorkbookToTemplate.js';
import { collectHybridExtras, mergeHybridCells } from '../dist/esm/cell-designer/hybridTemplateState.js';
import { biGridToUniverWorksheetData } from '../dist/esm/report/buildBiGrid.js';

const config={datasetId:'facts',dimensions:{categories:['team'],columnTimeBucket:{field:'day',granularity:'day'}},columns:['qty','bad'].map(field=>({type:'aggregated',field,agg:'sum'}))};
const panel=(options={})=>compilePanelToCellTemplate(config,'facts',options);
const label=d=>d.cells.find(c=>isEditableGeneratedText(c)&&c.content.value==='指标名称')||d.cells.find(c=>isEditableGeneratedText(c));
const metric=d=>d.cells.find(c=>c.content.kind==='field'&&c.content.role==='measure');
const range=(c)=>({sheetId:c.sheetId,startRow:c.position.row,endRow:c.position.row,startColumn:c.position.column,endColumn:c.position.column});
const design=d=>({type:'detail',rowCount:30,colCount:20,bindings:[],merges:d.layoutRules.filter(r=>r.kind==='merge'&&r.range).map(r=>({startRow:r.range.startRow,endRow:r.range.endRow,startCol:r.range.startColumn,endCol:r.range.endColumn})),cells:d.cells.map(c=>({row:c.position.row,col:c.position.column,value:c.content.kind==='literal'?c.content.value:`{${c.id}}`,sourceCellId:c.id,regionId:c.regionId,role:'custom',style:{}}))});
const snapshot=(d,c,cell)=>{const s={sheets:{[c.sheetId]:biGridToUniverWorksheetData(design(d))}};s.sheets[c.sheetId].cellData[c.position.row][c.position.column]=cell;return s;};
function edit(d,c,value){const grid=design(d),raw=snapshot(d,c,{v:value}),safe=protectGuidedSnapshot(raw,d,grid,'design');return syncDocumentFromWorkbookSnapshot(d,safe,'design',grid);}
function compose(base,synced,extras=[],rendered=base){const next=collectHybridExtras(synced,base,extras,base,rendered);return{doc:{...base,cells:mergeHybridCells(base,next)},extras:next};}
const facts=[{team:'A',day:'2026-08-01',qty:600,bad:5},{team:'A',day:'2026-08-02',qty:750,bad:20},{team:'B',day:'2026-08-01',qty:1200,bad:19}];

test('GL-01 generated captions are native text targets while title, notes and fields retain their own roles',()=>{
  const d=panel();for(const c of d.cells.filter(isEditableGeneratedText)){assert.equal(c.content.kind,'literal');assert.equal(canOpenCellAdvancedSettings(c),false);assert.equal(guidedCellContentProtected(d,c.position.row,c.position.column,c.sheetId),false);}
  const c=label(d);assert.equal(guidedCellProtected(d,c.position.row,c.position.column,c.sheetId),true);
  assert.equal(isEditableGeneratedText(d.cells.find(c=>c.id==='title')),false);assert.equal(canOpenCellAdvancedSettings(d.cells.find(c=>c.id==='title')),true);
  assert.equal(isEditableGeneratedText(metric(d)),false);assert.equal(canOpenCellAdvancedSettings(metric(d)),true);
});

test('GL-02 native command, matrix and array label writes are allowed while bound data remains protected',()=>{
  const d=panel(),c=label(d),q=metric(d),r=c.position.row,k=c.position.column;
  for(const command of [
    {id:'sheet.command.set-range-values',params:{range:range(c),value:{v:'统计项目'}}},
    {id:'sheet.command.set-range-values',params:{range:range(c),value:[[{v:'统计项目'}]]}},
    {id:'sheet.command.set-range-values',params:{range:range(c),value:{[r]:{[k]:{v:'统计项目'}}}}},
    {id:'sheet.mutation.set-range-values',params:{subUnitId:c.sheetId,cellValue:{[r]:{[k]:{v:'统计项目',f:null,p:null}}}}},
  ])assert.equal(shouldBlockGuidedCommand(d,'design',command,range(c)),false);
  assert.equal(shouldBlockGuidedCommand(d,'design',{id:'sheet.command.set-range-values',params:{value:{v:999}}},range(q)),true);
  const mixed={id:'sheet.mutation.set-range-values',params:{subUnitId:c.sheetId,cellValue:{[r]:{[k]:{v:'统计项目'}},[q.position.row]:{[q.position.column]:{v:999}}}}};
  assert.equal(shouldBlockGuidedCommand(d,'design',mixed,range(c)),true);
});

test('GL-03 clearing captions is allowed without allowing a formula to change their semantic kind',()=>{
  const d=panel(),c=label(d);
  assert.equal(shouldBlockGuidedCommand(d,'design',{id:'sheet.command.clear-selection-content'},range(c)),false);
  for(const value of [{f:'=1+1'},{si:'shared-formula'},{v:'=',f:'=SUM(A1:B1)'}])assert.equal(shouldBlockGuidedCommand(d,'design',{id:'sheet.command.set-range-values',params:{range:range(c),value}},range(c)),true);
  assert.equal(shouldBlockGuidedCommand(d,'design',{id:'sheet.command.set-range-values',params:{value:{f:'=1+1'}}},{...range(c),startRow:20,endRow:20,startColumn:10,endColumn:10}),false);
});

test('GL-04 snapshot text overrides preserve identity, parents, style and merge intent',()=>{
  const d=panel(),c=label(d);c.style={color:'#123456'};
  const next=edit(d,c,'自定义指标标题'),n=next.cells.find(x=>x.id===c.id);
  assert.equal(n.content.kind,'literal');assert.equal(n.content.value,'自定义指标标题');assert.equal(n.literalOverride,true);
  assert.deepEqual(n.parents,c.parents);assert.deepEqual(n.panelOwner,c.panelOwner);assert.deepEqual(n.style,c.style);assert.deepEqual([...next.layoutRules].sort((a,b)=>a.id.localeCompare(b.id)),[...d.layoutRules].sort((a,b)=>a.id.localeCompare(b.id)));assert.deepEqual(next.mergeConfig,d.mergeConfig);
});

test('GL-05 rich text and empty captions preserve literal intent including spaces, zero and false',()=>{
  const d=panel(),c=label(d),grid=design(d);
  for(const [cell,expected]of [[{v:null,p:{body:{dataStream:'  项目\n说明  \r\n'}}},'  项目\n说明  '],[{v:''},''],[{v:null},null],[{v:0,t:2},0],[{v:0,t:3},false]]){
    const safe=protectGuidedSnapshot(snapshot(d,c,cell),d,grid,'design'),next=syncDocumentFromWorkbookSnapshot(d,safe,'design',grid),n=next.cells.find(x=>x.id===c.id);
    assert.equal(n.content.kind,'literal');assert.equal(n.content.value,expected);assert.equal(n.literalOverride,true);
    const composed=compose(d,next).doc;assert.equal(composed.cells.find(x=>x.id===c.id).content.value,expected);
  }
});

test('GL-06 formula injection cannot turn a generated caption into a calculator even through a raw snapshot',()=>{
  const d=panel(),c=label(d),grid=design(d);
  for(const cell of [{v:2,f:'=1+1'},{v:2,si:'shared'}]){
    const direct=syncDocumentFromWorkbookSnapshot(d,snapshot(d,c,cell),'design',grid).cells.find(x=>x.id===c.id);
    assert.equal(direct.content.kind,'literal');assert.equal(direct.content.value,c.content.value);
    const safe=protectGuidedSnapshot(snapshot(d,c,cell),d,grid,'design').sheets[c.sheetId].cellData[c.position.row][c.position.column];assert.equal(safe.v,c.content.value);assert.equal(safe.f,null);assert.equal(safe.si,null);
  }
});

test('GL-07 repeated edits and JSON reopen keep the latest caption rather than a prior panel default',()=>{
  const base=panel(),c=label(base);let doc=base,extras=[];
  for(const text of ['统计项目','指标说明','最终标题']){const synced=edit(doc,doc.cells.find(x=>x.id===c.id),text),result=compose(base,synced,extras,doc);doc=result.doc;extras=result.extras;assert.equal(doc.cells.find(x=>x.id===c.id).content.value,text);}
  const saved=JSON.parse(JSON.stringify(doc)),reopened=compose(base,saved).doc;assert.equal(reopened.cells.find(x=>x.id===c.id).content.value,'最终标题');assert.equal(reopened.cells.filter(x=>x.id===c.id).length,1);
});

test('GL-08 metric caption edits follow their semantic identity when an extra row dimension moves the template',()=>{
  const a=panel(),c=a.cells.find(c=>c.panelOwner?.semanticKey==='label:metric:qty');assert.ok(c);
  const saved=compose(a,edit(a,c,'交付数量（件）')).doc,b=compilePanelToCellTemplate({...config,dimensions:{...config.dimensions,categories:['team','part']}},'facts'),extras=collectHybridExtras(saved,a,[],b,a),merged={...b,cells:mergeHybridCells(b,extras)};
  const target=merged.cells.find(c=>c.panelOwner?.semanticKey==='label:metric:qty');assert.ok(target);assert.equal(target.content.value,'交付数量（件）');assert.equal(target.literalOverride,true);
  assert.notDeepEqual(target.position,c.position);
  const result=compileCellReport(merged,facts.map(f=>({...f,part:'P1'})));assert.equal(result.valid,true,JSON.stringify(result.diagnostics));assert.ok(result.publication.sheets[0].cells.some(c=>c.v==='交付数量（件）'));
});

test('GL-09 renamed captions survive fact changes without changing binding, calculation or template source',()=>{
  const base=panel(),c=label(base),d=JSON.parse(JSON.stringify(compose(base,edit(base,c,'业务指标')).doc)),before=JSON.stringify(d),baseBindings=d.cells.filter(c=>c.content.kind==='field');
  for(const rows of [[...facts,{team:'C',day:'2026-09-01',qty:2400,bad:8}],[...facts].reverse(),facts.filter(f=>f.team!=='A'),[],facts]){
    const result=compileCellReport(d,rows);assert.equal(result.valid,true,JSON.stringify(result.diagnostics));assert.ok(result.publication.sheets[0].cells.some(c=>c.v==='业务指标'));assert.equal(JSON.stringify(d),before);assert.deepEqual(d.cells.filter(c=>c.content.kind==='field'),baseBindings);
  }
});

test('GL-10 guard permits typed caption edits and header-only paste while preview and mixed pastes stay readonly',()=>{
  const d=panel(),c=label(d),q=metric(d),handlers=new Map();let current=range(c),mode='design',blocked=0;
  const api={Event:{BeforeSheetEditStart:'edit',BeforeClipboardPaste:'paste'},addEvent:(key,fn)=>{handlers.set(key,fn);return{dispose:()=>handlers.delete(key)};},getActiveWorkbook:()=>({getActiveSheet:()=>({getSheetId:()=>current.sheetId,getSelection:()=>({getActiveRange:()=>({getRange:()=>current})})})})};
  const dispose=attachGuidedEditingGuard(api,()=>({panel:d,mode}),()=>blocked++);
  const editEvent={row:c.position.row,column:c.position.column,eventType:2,cancel:false};handlers.get('edit')(editEvent);assert.equal(editEvent.cancel,false);
  const paste={text:'新标签',cancel:false};handlers.get('paste')(paste);assert.equal(paste.cancel,false);
  current=range(q);const mixed={text:'999',cancel:false};handlers.get('paste')(mixed);assert.equal(mixed.cancel,true);
  current=range(c);mode='preview';const preview={...editEvent,cancel:false};handlers.get('edit')(preview);assert.equal(preview.cancel,true);assert.equal(blocked,2);dispose();assert.equal(handlers.size,0);
});

test('GL-11 a cleared projected caption stays empty, while a partial style-only snapshot keeps its text',()=>{
  const d=panel(),c=label(d),grid=design(d);
  const cleared=protectGuidedSnapshot(snapshot(d,c,{s:{bl:1},custom:{biProjection:true}}),d,grid,'design');
  const changed=syncDocumentFromWorkbookSnapshot(d,cleared,'design',grid),n=changed.cells.find(x=>x.id===c.id);
  assert.equal(n.content.value,null);assert.equal(n.literalOverride,true);assert.equal(compose(d,changed).doc.cells.find(x=>x.id===c.id).content.value,null);
  const nativeCleared=protectGuidedSnapshot(snapshot(d,c,{s:{bl:1}}),d,grid,'design');
  assert.equal(syncDocumentFromWorkbookSnapshot(d,nativeCleared,'design',grid).cells.find(x=>x.id===c.id).content.value,null);
  const partial=snapshot(d,c,{s:{bl:1}});delete partial.sheets[c.sheetId].rowCount;delete partial.sheets[c.sheetId].columnCount;
  const styled=protectGuidedSnapshot(partial,d,grid,'design');
  assert.equal(syncDocumentFromWorkbookSnapshot(d,styled,'design',grid).cells.find(x=>x.id===c.id).content.value,c.content.value);
});
