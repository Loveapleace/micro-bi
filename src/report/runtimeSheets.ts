/** 临时明细Sheet仅属于当前会话，不得进入源模板或保存快照。 */
export function sourceOnlyWorkbookSnapshot(snapshot:any,ownedIds:ReadonlySet<string>=new Set()):any{
  if(!snapshot?.sheets)return snapshot;
  const sheets=Object.fromEntries(Object.entries(snapshot.sheets).filter(([id,sheet]:[string,any])=>!ownedIds.has(id)&&sheet?.custom?.biRuntimeDetail!==true));
  const sheetOrder=(snapshot.sheetOrder||Object.keys(sheets)).filter((id:string)=>id in sheets);
  return {...snapshot,sheets,sheetOrder,...(snapshot.activeSheetId&&!sheets[snapshot.activeSheetId]?{activeSheetId:sheetOrder[0]}:{})};
}
