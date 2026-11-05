/**
 * 正式报表展示组件 (ReportTableView.tsx)
 * 纯展示底座，零 Univer 运行时依赖。
 * 消费 PublishedReport 纯 JSON 数据模型，通过 VTable ListTable 呈现二维报表与工作表切换。
 */
import React, { useRef, useEffect, useState, useMemo, useCallback } from 'react';
import * as VTablePkg from '@visactor/vtable';
import type { ListTable as ListTableType } from '@visactor/vtable';
import type { PublishedReport, SheetId } from '../../../report/types.js';
import { ReportTableRuntime } from './reportTableRuntime.js';
import { observeCanvasViewport, readCanvasViewport } from './canvasViewport.js';
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
  onTableReady?: ((table: ListTableType | null) => void) | undefined;
}

export const ReportTableView: React.FC<ReportTableViewProps> = ({
  report,
  height = 500,
  activeSheetId,
  onActiveSheetChange,
  className,
  style,
  queryDrillDetails,
  onTableReady,
}) => {
  const {session:drillSession,snapshot:drillSnapshot}=useDrillRuntime(report.drillIndex,queryDrillDetails);
  const effectiveReport=useMemo(()=>({...report,sheets:[...report.sheets,...drillSnapshot.tabs.map(t=>t.sheet)]}),[report,drillSnapshot.tabs]);
  const queryMessageRef=useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const runtimeRef = useRef<ReportTableRuntime | null>(null);
  const readyRef = useRef(onTableReady);
  readyRef.current = onTableReady;
  const appliedRef = useRef<{report:PublishedReport;sheetId:string}|null>(null);

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

  // Register native listeners once; resolve targets from the publication currently applied to the canvas.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const runtime = new ReportTableRuntime(options => new ListTable(container, options), options => ({ ...options,
      menu: { ...options.menu, contextMenuItems: (_field: any, row: number, col: number) => {
        const context = appliedRef.current;
        return context && resolveDrillTarget(context.report.drillIndex, context.sheetId, row, col)
          ? [{text:'查看明细',menuKey:'bi-drill-details'}, 'copy'] : ['copy'];
      } },
    }), instance => {
      const openDetails = (col: number, row: number) => {
        const context = appliedRef.current;
        if (!context) return;
        const target = resolveDrillTarget(context.report.drillIndex, context.sheetId, row, col);
        if (!target) return;
        if (target.reason) { if (queryMessageRef.current) queryMessageRef.current.textContent = target.reason; return; }
        // The menu handler finishes in a later task. A reused instance also needs a publication guard.
        setTimeout(() => {
          const current = appliedRef.current;
          if (runtime.table === instance && current?.sheetId === context.sheetId &&
              current?.report.drillIndex?.revision === target.publicationRevision) drillSession.open(target);
        }, 0);
      };
      instance.on('dblclick_cell', ({col,row}:{col:number;row:number}) => openDetails(col,row));
      instance.on('mouseenter_cell', ({col,row}:{col:number;row:number}) => {
        const context = appliedRef.current;
        const target = context && resolveDrillTarget(context.report.drillIndex, context.sheetId, row, col);
        container.title = target ? target.reason || '双击查看明细' : '';
      });
      instance.on('dropdown_menu_click', ({menuKey,col,row}:{menuKey:string;col:number;row:number}) => {
        if (instance.isReleased) return;
        if (menuKey === 'bi-drill-details') openDetails(col,row);
        else if (menuKey === 'copy') void navigator.clipboard?.writeText(instance.getCopyValue() || '').catch(error => console.warn('[ReportTableView] 复制失败:',error));
      });
      readyRef.current?.(instance);
    }, () => {
      readyRef.current?.(null);
    });
    runtimeRef.current = runtime;
    runtime.updateViewport(readCanvasViewport(container));
    const stop = observeCanvasViewport(container, view => runtime.updateViewport(view));
    return () => {
      stop(); appliedRef.current = null; runtime.dispose();
      if (runtimeRef.current === runtime) runtimeRef.current = null;
    };
  }, [drillSession]);

  useEffect(() => {
    appliedRef.current = currentSheet ? { report, sheetId: currentSheet.id } : null;
    if (queryMessageRef.current) queryMessageRef.current.textContent = '';
    if (containerRef.current) containerRef.current.title = '';
    try {
      runtimeRef.current?.apply(report.id, currentSheet || undefined, report.styles || {});
      runtimeRef.current?.retainViews(report.id, visibleSheets);
    } catch (error) { console.error('[ReportTableView] 更新VTable失败:',error); }
  }, [currentSheet, report, visibleSheets]);

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
