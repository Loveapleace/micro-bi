/**
 * 正式报表展示组件 (ReportTableView.tsx)
 * 纯展示底座，零 Univer 运行时依赖。
 * 消费 PublishedReport 纯 JSON 数据模型，通过 VTable ListTable 呈现二维报表与工作表切换。
 */
import React, { useRef, useEffect, useState, useMemo, useCallback } from 'react';
import * as VTablePkg from '@visactor/vtable';
import type { ListTable as ListTableType } from '@visactor/vtable';
import type { PublishedReport, SheetId } from '../../../report/types.js';
import { adaptPublishedSheetToVTable } from './gridAdapter.js';
import { resolveDrillTarget } from '../../../report/drill.js';
import type { DrillQuery } from '../../../report/drillTypes.js';
import { useDrillRuntime } from './useDrillRuntime.js';
import { DrillSheetBar } from './DrillSheetBar.js';
import { Tabs } from 'antd';

const vtableMod: any = VTablePkg;
const vtableActual = vtableMod.ListTable ? vtableMod : (vtableMod['def' + 'ault'] || vtableMod);
const ListTable = vtableActual.ListTable;

export interface ReportTableViewProps {
  report: PublishedReport;
  height?: number | string | undefined;
  activeSheetId?: SheetId | undefined;
  onActiveSheetChange?: ((sheetId: SheetId) => void) | undefined;
  className?: string | undefined;
  style?: React.CSSProperties | undefined;
  queryDrillDetails?: DrillQuery | undefined;
}

export const ReportTableView: React.FC<ReportTableViewProps> = ({
  report,
  height = 500,
  activeSheetId,
  onActiveSheetChange,
  className,
  style,
  queryDrillDetails,
}) => {
  const {session:drillSession,snapshot:drillSnapshot}=useDrillRuntime(report.drillIndex,queryDrillDetails);
  const effectiveReport=useMemo(()=>({...report,sheets:[...report.sheets,...drillSnapshot.tabs.map(t=>t.sheet)]}),[report,drillSnapshot.tabs]);
  const scrollBySheet=useRef(new Map<string,{left:number;top:number;row?:number;col?:number}>());
  const queryMessageRef=useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const tableInstanceRef = useRef<ListTableType | null>(null);

  // MBI-12: 派生仅可见的工作表列表 (严格过滤 hidden 为 true 的工作表)
  const visibleSheets = useMemo(() => {
    return (effectiveReport.sheets || []).filter((s) => !s.hidden);
  }, [effectiveReport.sheets]);

  // 工作表切换状态：仅从可见工作表中选取
  const [internalSheetId, setInternalSheetId] = useState<string>(() => {
    if (activeSheetId && visibleSheets.some((s) => s.id === activeSheetId)) {
      return activeSheetId;
    }
    return visibleSheets[0]?.id || '';
  });

  // 当外部 activeSheetId 或工作表可见性发生变动时同步校正
  useEffect(() => {
    if (activeSheetId && visibleSheets.some((s) => s.id === activeSheetId)) {
      setInternalSheetId(activeSheetId);
    } else if (!visibleSheets.some((s) => s.id === internalSheetId)) {
      const fallbackId = visibleSheets[0]?.id || '';
      setInternalSheetId(fallbackId);
      onActiveSheetChange?.(fallbackId);
    }
  }, [activeSheetId, visibleSheets, internalSheetId, onActiveSheetChange]);

  const currentSheetId = drillSnapshot.activeSheetId&&visibleSheets.some(s=>s.id===drillSnapshot.activeSheetId)?drillSnapshot.activeSheetId:activeSheetId && visibleSheets.some((s) => s.id === activeSheetId)
    ? activeSheetId
    : internalSheetId;

  const currentSheet = useMemo(() => {
    return (
      visibleSheets.find((s) => s.id === currentSheetId) ||
      visibleSheets[0] ||
      null
    );
  }, [visibleSheets, currentSheetId]);

  const handleSheetTabClick = useCallback(
    (sheetId: string) => {
      drillSession.activate(sheetId);
      setInternalSheetId(sheetId);
      if (onActiveSheetChange) {
        onActiveSheetChange(sheetId);
      }
    },
    [onActiveSheetChange,drillSession]
  );

  // 初始化与更新 VTable 实例
  useEffect(() => {
    if (!containerRef.current) return;

    if (tableInstanceRef.current) {
      tableInstanceRef.current.release();
      tableInstanceRef.current = null;
    }

    if (!currentSheet) return;

    const { columns, rawRecords, customMergeCell, options } = adaptPublishedSheetToVTable(
      currentSheet,
      report.styles || {}
    );

    let localInstance: ListTableType | null = null;
    try {
      const instance = new ListTable(containerRef.current, {
        columns,
        records: rawRecords,
        customMergeCell,
        widthMode: 'standard',
        autoFillWidth: true,
        ...options,
        menu:{...options.menu,contextMenuItems:(_field:any,row:number,col:number)=>resolveDrillTarget(report.drillIndex,currentSheet.id,row,col)?[{text:'查看明细',menuKey:'bi-drill-details'},'copy']:['copy']},
      });
      instance.on('dropdown_menu_click', ({ menuKey }: { menuKey: string }) => {
        if (menuKey === 'copy') {
          void navigator.clipboard?.writeText(instance.getCopyValue()).catch((error) => {
            console.warn('[ReportTableView] 复制失败:', error);
          });
        }
      });

      localInstance = instance;
      const openDetails=(col:number,row:number)=>{
        const target=resolveDrillTarget(report.drillIndex,currentSheet.id,row,col);
        if(!target)return;
        if(target.reason){if(queryMessageRef.current)queryMessageRef.current.textContent=target.reason;return;}
        scrollBySheet.current.set(currentSheet.id,{left:instance.scrollLeft,top:instance.scrollTop,row,col});
        // SDK在pointerup后用timer收尾menuHandler；微任务仍过早，下一任务再切Sheet。
        setTimeout(()=>{if(tableInstanceRef.current===instance)drillSession.open(target);},0);
      };
      instance.on('dblclick_cell',({col,row}:{col:number;row:number})=>openDetails(col,row));
      instance.on('mouseenter_cell',({col,row}:{col:number;row:number})=>{
        const target=resolveDrillTarget(report.drillIndex,currentSheet.id,row,col);
        if(containerRef.current)containerRef.current.title=target?target.reason||'双击查看明细':'';
      });
      instance.on('dropdown_menu_click',(event:{menuKey:string;col:number;row:number})=>{if(event.menuKey==='bi-drill-details')openDetails(event.col,event.row);});
      const position=scrollBySheet.current.get(currentSheet.id);
      if(position){instance.setScrollLeft(position.left);instance.setScrollTop(position.top);if(position.row!==undefined&&position.col!==undefined)instance.selectCell(position.col,position.row);}
      tableInstanceRef.current = instance;
    } catch (e) {
      console.error('[ReportTableView] 渲染 VTable 失败:', e);
    }

    return () => {
      if (localInstance) {
        const previous=scrollBySheet.current.get(currentSheet.id);
        scrollBySheet.current.set(currentSheet.id,{...previous,left:localInstance.scrollLeft,top:localInstance.scrollTop});
        try {
          localInstance.release();
        } catch {}
      }
      if (tableInstanceRef.current === localInstance) {
        tableInstanceRef.current = null;
      }
    };
  }, [currentSheet, report.styles,report.drillIndex,drillSession]);

  // React布局提交后同步Canvas布局。弹窗开关/外层样式变化时，单次resize可能
  // 留下旧的文字绘制缓存；重建可见单元格而不改写数据、滚动或源配置。
  useEffect(() => {
    const frame=requestAnimationFrame(()=>{
      const table=tableInstanceRef.current;
      if(table){table.resize();table.renderWithRecreateCells();}
    });
    return ()=>cancelAnimationFrame(frame);
  },[currentSheet,report.styles,height,style,className]);

  // 监听容器大小变化自动调整
  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver(() => {
      if (tableInstanceRef.current) {
        tableInstanceRef.current.resize();
        tableInstanceRef.current.renderWithRecreateCells();
      }
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  return (
    <div
      className={className}
      style={{
        display: 'flex',
        flexDirection: 'column',
        height,
        border: '1px solid #e2e8f0',
        borderRadius: 6,
        overflow: 'hidden',
        background: '#ffffff',
        ...style,
      }}
    >
      <DrillSheetBar tab={drillSnapshot.tabs.find(t=>t.id===currentSheetId)} session={drillSession}/>
      <div ref={queryMessageRef} role="status" style={{fontSize:12,color:'#ad6800'}}/>
      {/* 报表主网格画布容器 */}
      <div
        ref={containerRef}
        style={{
          flex: 1,
          width: '100%',
          overflow: 'hidden',
          position: 'relative',
        }}
      />

      {/* 暂无可见工作表提示 */}
      {!currentSheet && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100%',
            color: '#94a3b8',
            fontSize: 13,
          }}
        >
          暂无可展示的可见工作表
        </div>
      )}

      {/* 多工作表页签栏 (MBI-12: 仅展示可见工作表页签) */}
      {visibleSheets.length > 1 && (
        <Tabs type="editable-card" size="small" hideAdd animated={false} tabPosition="bottom"
          activeKey={currentSheetId} onChange={handleSheetTabClick} tabBarStyle={{margin:0}}
          style={{flexShrink:0,padding:'0 8px',background:'#f8fafc',borderTop:'1px solid #e2e8f0'}}
          onEdit={(key,action)=>{if(action==='remove'&&typeof key==='string'&&drillSnapshot.tabs.some(t=>t.id===key))drillSession.close(key);}}
          items={visibleSheets.map(sheet=>({key:sheet.id,label:sheet.name,closable:drillSnapshot.tabs.some(t=>t.id===sheet.id)}))}/>
      )}
    </div>
  );
};
