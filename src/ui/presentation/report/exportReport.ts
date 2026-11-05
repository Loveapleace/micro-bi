import * as VTablePkg from '@visactor/vtable';
import type { PublishedReport } from '../../../report/types.js';
import { adaptPublishedSheetToVTable } from './gridAdapter.js';
import { exportTableInstanceToExcel } from '../table/tableExport.js';
import { registerPixelFontTable } from '../table/exportFontMetrics.js';

/** 导出完整筛选结果；显示分页不裁掉总计或其他页面，样式和合并继续交给官方插件。 */
export async function exportPublishedSheet(report: PublishedReport, sheetId: string, signal?: AbortSignal): Promise<void> {
  const sheet = report.sheets.find(s => s.id === sheetId);
  if (!sheet || signal?.aborted) return;
  const sdk: any = (VTablePkg as any).ListTable ? VTablePkg : (VTablePkg as any).default;
  const container = document.createElement('div');
  container.style.cssText = 'position:fixed;left:-100000px;top:0;width:1000px;height:500px;pointer-events:none';
  document.body.appendChild(container);
  const grid = adaptPublishedSheetToVTable(sheet, report.styles);
  let table: any;
  const cancel = () => { if (table && !table.isReleased) table.release(); };
  try {
    table = new sdk.ListTable(container, { ...grid.options, columns: grid.columns, records: grid.rawRecords, customMergeCell: grid.customMergeCell });
    registerPixelFontTable(table);
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) { cancel(); return; }
    await exportTableInstanceToExcel(table, `${report.title || '报表'}.xlsx`);
  }
  finally { signal?.removeEventListener('abort', cancel); cancel(); container.remove(); }
}
