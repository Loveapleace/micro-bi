import type { FUniver } from '../univer/adapter.js';
import type { DrillSession } from '../report/drillSession.js';
import type { PublishedSheet } from '../report/types.js';

/** 只操作当前桥接器拥有的Sheet，不按名称识别/删除用户工作表。 */
export function attachUniverDrillSheets(api:FUniver,session:DrillSession,afterWrite:()=>void,onError:(message:string)=>void):()=>void{
  const a=api as any,owned=new Map<string,PublishedSheet>();
  const ids:Set<string>=a.__biRuntimeSheetIds||new Set();a.__biRuntimeSheetIds=ids;
  let active=true,writing=false;
  const transaction=(fn:()=>void)=>{
    const previous=a.__isProgrammaticWrite;writing=true;a.__isProgrammaticWrite=true;
    try{fn();}finally{a.__isProgrammaticWrite=previous;writing=false;afterWrite();}
  };
  const mainId=api.getActiveWorkbook()?.getActiveSheet()?.getSheetId();
  const render=()=>{
    if(!active||writing)return;
    const workbook=api.getActiveWorkbook();if(!workbook)return;
    const snapshot=session.getSnapshot();
    try{transaction(()=>{
      for(const id of owned.keys())if(!snapshot.tabs.some(t=>t.id===id)){
        const sheet=workbook.getSheetBySheetId(id);if(sheet){if(workbook.getActiveSheet()?.getSheetId()===id&&mainId)workbook.setActiveSheet(mainId);workbook.deleteSheet(sheet);}
        owned.delete(id);ids.delete(id);
      }
      for(const tab of snapshot.tabs){
        const prior=owned.get(tab.id);if(prior===tab.sheet)continue;
        let sheet=workbook.getSheetBySheetId(tab.id);
        const cellData:Record<number,Record<number,unknown>>={};
        for(const c of tab.sheet.cells){cellData[c.r]||={};cellData[c.r]![c.c]={v:c.v,t:typeof c.v==='number'?2:typeof c.v==='boolean'?3:1,...(c.r===2?{s:{bl:1,bg:{rgb:'#edf3ff'}}}:{})};}
        if(!sheet){
          ids.add(tab.id);
          const name=`${tab.sheet.name.replace(/[\\/?*\[\]:]/g,' ').slice(0,20)} ${tab.id.slice(9)}`;
          sheet=workbook.insertSheet(name,{sheet:{id:tab.id,name,rowCount:Math.max(25,tab.sheet.rowCount),columnCount:Math.max(5,tab.sheet.colCount),defaultColumnWidth:150,defaultRowHeight:26,cellData,freeze:{startRow:3,startColumn:0,ySplit:3,xSplit:0},custom:{biRuntimeDetail:true}} as any});
        }else{
          const rows=Math.max(prior?.rowCount||0,tab.sheet.rowCount),cols=Math.max(prior?.colCount||0,tab.sheet.colCount);
          sheet.setRowCount(Math.max(25,rows));sheet.setColumnCount(Math.max(5,cols));
          sheet.getRange(0,0,rows,cols).setValues(Array.from({length:rows},(_,r)=>Array.from({length:cols},(_,c)=>(cellData[r]?.[c]||{v:null}) as any)));
        }
        owned.set(tab.id,tab.sheet);
      }
      const desired=snapshot.activeSheetId||mainId;
      if(desired&&workbook.getSheetBySheetId(desired)&&workbook.getActiveSheet()?.getSheetId()!==desired)workbook.setActiveSheet(desired);
    });}catch(error){onError(error instanceof Error?error.message:'明细工作表创建失败');}
  };
  const unsubscribe=session.subscribe(render);
  const listener=a.addEvent(a.Event.CommandExecuted,()=>{
    if(!active||writing||a.__isProgrammaticWrite)return;
    const id=api.getActiveWorkbook()?.getActiveSheet()?.getSheetId();
    if(id&&session.getSnapshot().activeSheetId!==id)session.activate(id);
  });
  render();
  return()=>{
    active=false;unsubscribe();listener.dispose();
    try{transaction(()=>{const workbook=api.getActiveWorkbook();if(!workbook)return;for(const id of owned.keys()){
      const sheet=workbook.getSheetBySheetId(id);if(sheet){if(mainId)workbook.setActiveSheet(mainId);workbook.deleteSheet(sheet);}ids.delete(id);
    }owned.clear();});}catch{/* SDK会话已关闭时由实例销毁回收。 */}
  };
}
