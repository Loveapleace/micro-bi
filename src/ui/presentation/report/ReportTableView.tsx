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
}

export const ReportTableView: React.FC<ReportTableViewProps> = ({
  report,
  height = 500,
  activeSheetId,
  onActiveSheetChange,
  className,
  style,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const tableInstanceRef = useRef<ListTableType | null>(null);

  // MBI-12: 派生仅可见的工作表列表 (严格过滤 hidden 为 true 的工作表)
  const visibleSheets = useMemo(() => {
    return (report.sheets || []).filter((s) => !s.hidden);
  }, [report.sheets]);

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

  const currentSheetId = activeSheetId && visibleSheets.some((s) => s.id === activeSheetId)
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
      setInternalSheetId(sheetId);
      if (onActiveSheetChange) {
        onActiveSheetChange(sheetId);
      }
    },
    [onActiveSheetChange]
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
      });
      instance.on('dropdown_menu_click', ({ menuKey }: { menuKey: string }) => {
        if (menuKey === 'copy') {
          void navigator.clipboard?.writeText(instance.getCopyValue()).catch((error) => {
            console.warn('[ReportTableView] 复制失败:', error);
          });
        }
      });

      localInstance = instance;
      tableInstanceRef.current = instance;
    } catch (e) {
      console.error('[ReportTableView] 渲染 VTable 失败:', e);
    }

    return () => {
      if (localInstance) {
        try {
          localInstance.release();
        } catch {}
      }
      if (tableInstanceRef.current === localInstance) {
        tableInstanceRef.current = null;
      }
    };
  }, [currentSheet, report.styles]);

  // React布局提交后同步Canvas布局。弹窗开关/外层样式变化时，单次resize可能
  // 留下旧的文字绘制缓存；重建可见单元格而不改写数据、滚动或源配置。
  useEffect(() => {
    const frame=requestAnimationFrame(()=>{
      const table=tableInstanceRef.current;
      if(table){table.resize();table.renderWithRecreateCells();}
    });
    return ()=>cancelAnimationFrame(frame);
  },[height,style,className]);

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
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            height: 32,
            background: '#f8fafc',
            borderTop: '1px solid #e2e8f0',
            padding: '0 8px',
            gap: 4,
          }}
        >
          {visibleSheets.map((sheet) => {
            const isActive = currentSheet && sheet.id === currentSheet.id;
            return (
              <button
                key={sheet.id}
                onClick={() => handleSheetTabClick(sheet.id)}
                style={{
                  height: 24,
                  padding: '0 12px',
                  fontSize: 12,
                  border: isActive ? '1px solid #cbd5e1' : 'none',
                  borderBottom: 'none',
                  borderRadius: '4px 4px 0 0',
                  background: isActive ? '#ffffff' : 'transparent',
                  color: isActive ? '#0f172a' : '#64748b',
                  fontWeight: isActive ? 600 : 400,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                }}
              >
                {sheet.name}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
