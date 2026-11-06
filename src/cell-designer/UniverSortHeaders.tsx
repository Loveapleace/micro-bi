import React, {useEffect, useRef, useState} from 'react';
import {Button, Tooltip, theme} from 'antd';
import {SortAscendingOutlined, SortDescendingOutlined, SwapOutlined} from '@ant-design/icons';
import type {FUniver} from '../univer/adapter.js';
import type {ReportSortHeader} from '../report/sortTypes.js';

/** Render only visible header controls, using the public range geometry/viewport and lifecycle events. */
export function UniverSortHeaders({api,headers,sheetId,disabled,onOpen}:{
  api:FUniver|null;headers:readonly ReportSortHeader[];sheetId:string;disabled?:boolean|undefined;
  onOpen:(header:ReportSortHeader,anchor:{left:number;top:number})=>void;
}){
  const root=useRef<HTMLDivElement>(null),{token}=theme.useToken();
  const [visible,setVisible]=useState<{header:ReportSortHeader;left:number;top:number}[]>([]);
  useEffect(()=>{
    if(!api||disabled){setVisible([]);return;}
    const parent=root.current?.parentElement;if(!parent)return;
    let frame=0,closed=false;
    const update=()=>{
      frame=0;if(closed)return;
      try{
        const sheet=api.getActiveWorkbook()?.getActiveSheet();
        if(!sheet||sheet.getSheetId()!==sheetId){setVisible([]);return;}
        const canvas=Array.from(parent.querySelectorAll('canvas')).sort((a,b)=>b.clientHeight-a.clientHeight)[0];
        if(!canvas){setVisible([]);return;}
        const viewports=sheet.getVisibleRangesOfAllViewports(),ranges=[...(viewports?.values()||[])];
        const bounds=canvas.getBoundingClientRect(),host=parent.getBoundingClientRect(),sx=host.width/(parent.clientWidth||1),sy=host.height/(parent.clientHeight||1);
        const cx=bounds.width/(parseFloat(canvas.style.width)||canvas.clientWidth||1),cy=bounds.height/(parseFloat(canvas.style.height)||canvas.clientHeight||1);
        const points=headers.flatMap(header=>{
          if(header.row>=sheet.getMaxRows()||header.column>=sheet.getMaxColumns()||ranges.length&&!ranges.some(range=>header.row>=range.startRow&&header.row<=range.endRow&&header.column>=range.startColumn&&header.column<=range.endColumn))return [];
          const rect=sheet.getRange(header.row,header.column,1,1).getCellRect();
          const left=(bounds.left-host.left+rect.right*cx)/sx-23,top=(bounds.top-host.top+(rect.top+rect.height/2)*cy)/sy-11;
          return left>=0&&top>=0&&left+23<=parent.clientWidth&&top+22<=parent.clientHeight?[{header,left,top}]:[];
        });
        setVisible(points);
      }catch{if(!closed)setVisible([]);}
    };
    const schedule=()=>{if(!closed&&!frame)frame=requestAnimationFrame(update);};
    const events=[api.Event.Scroll,api.Event.SheetZoomChanged,api.Event.SelectionChanged,api.Event.CommandExecuted].map(event=>api.addEvent(event,schedule));
    const observer=new ResizeObserver(schedule);observer.observe(parent);
    schedule();
    return()=>{closed=true;if(frame)cancelAnimationFrame(frame);for(const event of events)event.dispose();observer.disconnect();};
  },[api,headers,sheetId,disabled]);
  return <div ref={root} data-univer-sort-headers style={{position:'absolute',inset:0,pointerEvents:'none',overflow:'hidden',zIndex:1080}}>
    {visible.map(({header,left,top})=><Tooltip key={`${header.row}:${header.column}`} title="排序">
      <Button size="small" type="text" aria-label={`R${header.row+1}C${header.column+1}排序菜单`} data-sort-row={header.row} data-sort-column={header.column}
        icon={header.activeOrder==='asc'?<SortAscendingOutlined/>:header.activeOrder==='desc'?<SortDescendingOutlined/>:<SwapOutlined rotate={90}/>}
        style={{position:'absolute',left,top,width:22,minWidth:22,height:22,padding:0,pointerEvents:'auto',color:header.activeOrder?token.colorPrimary:token.colorTextSecondary,background:token.colorBgContainer}}
        onPointerDown={event=>event.stopPropagation()} onDoubleClick={event=>event.stopPropagation()}
        onClick={event=>{event.stopPropagation();const rect=event.currentTarget.getBoundingClientRect();onOpen(header,{left:rect.right,top:rect.bottom});}}/>
    </Tooltip>)}
  </div>;
}
