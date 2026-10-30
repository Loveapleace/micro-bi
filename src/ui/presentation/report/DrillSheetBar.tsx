import React from 'react';
import type { DrillTab } from '../../../report/drillTypes.js';
import type { DrillSession } from '../../../report/drillSession.js';

const buttonStyle:React.CSSProperties={border:'1px solid #d9d9d9',borderRadius:4,background:'#fff',padding:'3px 9px',cursor:'pointer'};
export function DrillSheetBar({tab,session}:{tab:DrillTab|undefined;session:DrillSession}){
  if(!tab)return null;
  const pages=Math.max(1,Math.ceil(tab.total/tab.request.pageSize));
  return <div data-drill-sheet={tab.id} role="region" aria-label="明细工作表操作" style={{padding:'6px 10px',display:'flex',alignItems:'center',gap:10,flexWrap:'wrap',borderBottom:'1px solid #e8e8e8',fontSize:12,background:'#f5f8ff'}}>
    <span role={tab.status==='error'?'alert':'status'}>{tab.status==='loading'?'正在加载明细…':tab.status==='error'?tab.error:`第 ${tab.request.page} / ${pages} 页，共 ${tab.total} 条；当前页最多 ${tab.request.pageSize} 条`}</span>
    {tab.status==='ready'&&<span title={`数据版本：${String(tab.request.dataRevision)}`}>与主报表数据一致</span>}
    {!Object.is(tab.request.target.value,tab.request.target.baseValue)&&<span style={{color:'#ad6800'}}>此格数值已覆盖为 {String(tab.request.target.value??'空值')}，原计算值 {String(tab.request.target.baseValue??'空值')}；明细展示原始记录</span>}
    {tab.status==='error'?<button style={buttonStyle} onClick={()=>session.retry(tab.id)}>重试明细</button>:<>
      <button style={buttonStyle} disabled={tab.status==='loading'||tab.request.page<=1} onClick={()=>session.page(tab.id,tab.request.page-1)}>上一页</button>
      <button style={buttonStyle} disabled={tab.status==='loading'||tab.request.page>=pages} onClick={()=>session.page(tab.id,tab.request.page+1)}>下一页</button>
    </>}
    <button style={buttonStyle} onClick={()=>session.activate(tab.origin.sheetId)}>返回主报表</button>
    <button style={buttonStyle} onClick={()=>session.close(tab.id)}>关闭明细</button>
  </div>;
}
