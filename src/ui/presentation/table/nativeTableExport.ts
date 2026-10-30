import * as VTablePkg from '@visactor/vtable';
import type { ListTable, PivotTable } from '@visactor/vtable';
import { formatTableValue } from './tableSummary.js';

type ExportableTable = (ListTable | PivotTable) & {
  exportToExcel?: () => Promise<ArrayBuffer | Uint8Array>;
};
const pending = new WeakMap<ExportableTable, Promise<void>>();
const vtableModule: any = VTablePkg;
const tableEvents = vtableModule.TABLE_EVENT_TYPE || vtableModule.default.TABLE_EVENT_TYPE;

/** ExcelJS字符串单元格不作为公式执行；保留前导零、日期文本及原始数值类型。 */
export function formatNativeExcelCell(
  info: {
    table: { getCellOriginValue?: (col: number, row: number) => unknown };
    col: number;
    row: number;
    cellValue: unknown;
  },
  cell: { value: unknown; numFmt?: string },
) {
  const raw = typeof info.table.getCellOriginValue === 'function'
    ? info.table.getCellOriginValue(info.col, info.row)
    : info.cellValue;
  if (raw == null) {
    cell.value = null;
    return cell;
  }
  if (typeof raw === 'number') {
    cell.value = Number.isFinite(raw) ? raw : null;
    return cell;
  }
  if (typeof raw === 'boolean') {
    cell.value = raw;
    return cell;
  }
  cell.value = typeof raw === 'string' ? raw : formatTableValue(raw);
  cell.numFmt = '@';
  return cell;
}

async function ensureExportPlugin(table: ExportableTable): Promise<void> {
  if (table.exportToExcel) return;
  const existing = pending.get(table);
  if (existing) return existing;
  const loading = (async () => {
    const { TableExportPlugin } = await import('@visactor/vtable-plugins');
    if (table.isReleased) throw new Error('表格已关闭，已取消导出');
    const plugin = new TableExportPlugin({
      exportOnIdle: true,
      exportExcelOptions: {
        downloadFile: false,
        skipImageExportCellType: ['image', 'video', 'progressbar', 'sparkline', 'chart', 'custom', 'textWithIcon'],
        formatExcelJSCell: (info, cell) => formatNativeExcelCell(info, cell) as typeof cell,
      },
    });
    plugin.id = 'micro-bi-native-export';
    table.pluginManager.register(plugin);
    // 延迟加载时只初始化本插件，不重新派发表格全局initialized事件。
    plugin.run(undefined, tableEvents.INITIALIZED, table);
  })();
  pending.set(table, loading);
  try {
    await loading;
  } catch (error) {
    pending.delete(table);
    throw error;
  }
}

/** 只在用户导出时加载ExcelJS；基础数据编译与首次展示不加载导出插件。 */
export async function generateTableXlsx(table: ExportableTable): Promise<ArrayBuffer> {
  if (!table || table.isReleased) throw new Error('表格尚未就绪或已经关闭');
  const sortState = () => {
    if (table.isListTable()) {
      const current = (table as ListTable).sortState;
      return JSON.stringify((Array.isArray(current) ? current : current ? [current] : []).map(s => [s.field, s.order]));
    }
    return JSON.stringify(((table as PivotTable).pivotSortState || []).map(s => [s.dimensions, s.order]));
  };
  const records = table.records;
  const columns = table.options.columns;
  const sort = sortState();
  const rows = table.rowCount;
  const assertCurrent = () => {
    if (table.isReleased) throw new Error('表格已关闭，已取消导出');
    if (table.records !== records || table.options.columns !== columns || table.rowCount !== rows || sortState() !== sort) {
      throw new Error('表格数据或排序已变化，请重新导出');
    }
  };
  await ensureExportPlugin(table);
  assertCurrent();
  let result: ArrayBuffer | Uint8Array;
  try {
    result = await table.exportToExcel!();
  } catch (error) {
    assertCurrent();
    throw error;
  }
  assertCurrent();
  return new Uint8Array(result).buffer;
}
