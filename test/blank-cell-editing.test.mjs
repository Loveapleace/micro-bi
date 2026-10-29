import test from 'node:test';
import assert from 'node:assert/strict';
import { attachUniverDesignerEvents } from '../dist/esm/cell-designer/univerEvents.js';
import { attachGuidedEditingGuard } from '../dist/esm/cell-designer/guidedEditing.js';
import { compilePanelToCellTemplate } from '../dist/esm/report-template/panelToTemplateAdapter.js';

const aliases=[{eventType:3},{eventType:'dblclick'},{inputEvent:{type:'dblclick'}}];
function facade(){
  const handlers=new Map();
  return {handlers,Event:{BeforeSheetEditStart:'edit'},addEvent(name,fn){
    const list=handlers.get(name)||new Set();list.add(fn);handlers.set(name,list);
    return{dispose(){list.delete(fn);if(!list.size)handlers.delete(name);}};
  },emit(event){for(const fn of handlers.get('edit')||[])fn(event);},getActiveWorkbook:()=>({getActiveSheet:()=>({getSheetId:()=> 'sheet-1',getSelection:()=>({getActiveRange:()=>({getRange:()=>({startRow:1,startColumn:0})})})})})};
}

test('BE-01 unhandled blank-cell double clicks retain native editing for every SDK event shape',()=>{
  const api=facade(),positions=[];
  const dispose=attachUniverDesignerEvents(api,{onDoubleClicked:pos=>{positions.push(pos);return false;}});
  for(const alias of aliases){const event={...alias,row:1,column:0,sheetId:'sheet-1',cancel:false};api.emit(event);assert.equal(event.cancel,false);}
  assert.deepEqual(positions,aliases.map(()=>({row:1,column:0,sheetId:'sheet-1'})));
  let calls=0;const event={eventType:3,row:1,column:0,cancel:()=>calls++};api.emit(event);assert.equal(calls,0);
  dispose();assert.equal(api.handlers.size,0);
});

test('BE-02 handled double clicks cancel only after the business callback takes ownership',()=>{
  const api=facade(),order=[];
  attachUniverDesignerEvents(api,{onDoubleClicked:()=>{order.push('handled');return true;}});
  const event={eventType:3,row:3,column:2,cancel:()=>order.push('cancel')};api.emit(event);
  assert.deepEqual(order,['handled','cancel']);
  for(const alias of aliases){const booleanEvent={...alias,row:3,column:2,cancel:false};api.emit(booleanEvent);assert.equal(booleanEvent.cancel,true);}
});

test('BE-03 F2 and character input do not enter the advanced-settings double-click path',()=>{
  const api=facade();let calls=0;
  attachUniverDesignerEvents(api,{onDoubleClicked:()=>{calls++;return true;}});
  for(const eventType of [0,1,2]){const event={eventType,row:1,column:0,cancel:false};api.emit(event);assert.equal(event.cancel,false);}
  assert.equal(calls,0);
  const withoutHandler=facade(),event={eventType:3,row:1,column:0,cancel:false};attachUniverDesignerEvents(withoutHandler);withoutHandler.emit(event);assert.equal(event.cancel,false);
});

test('BE-04 readonly preview remains protected even when a bridge delegates an empty cell to native editing',()=>{
  const api=facade(),panel=compilePanelToCellTemplate({datasetId:'facts',dimensions:{categories:['team']},columns:[{type:'aggregated',field:'qty',agg:'sum'}]},'facts');
  let mode='design',blocked=0;
  const guard=attachGuidedEditingGuard(api,()=>({panel,mode}),()=>blocked++);
  const bridge=attachUniverDesignerEvents(api,{onDoubleClicked:()=>false});
  const design={eventType:3,row:1,column:0,cancel:false};api.emit(design);assert.equal(design.cancel,false);
  mode='preview';for(const alias of aliases){const preview={...alias,row:1,column:0,cancel:false};api.emit(preview);assert.equal(preview.cancel,true);}
  assert.equal(blocked,3);bridge();guard();assert.equal(api.handlers.size,0);
});

test('BE-05 delegating to native editing never clears a cancellation applied by another guard',()=>{
  const api=facade();attachUniverDesignerEvents(api,{onDoubleClicked:()=>false});
  const blocked={eventType:3,row:3,column:1,cancel:true};api.emit(blocked);assert.equal(blocked.cancel,true);
});
