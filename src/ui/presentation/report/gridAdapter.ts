/**
 * 报表网格适配器 (gridAdapter.ts)
 * 纯展示层映射，将 PublishedSheet 转换为 VTable ListTable 的构造配置。
 * 遵循 Section 11.3:
 * - 关闭 VTable 自动业务表头 (showHeader: false)；工作簿表头、标题和总计均作为模型中的真实单元格渲染。
 * - 0 基逻辑坐标精准映射到 VTable records 与 customMergeCell。
 */
import type { ColumnDefine, ListTableConstructorOptions } from '@visactor/vtable';
import type { PublishedSheet, PublishedCellStyle, PublishedCell } from '../../../report/types.js';
import { mapPublishedStyleToVTable } from './styleAdapter.js';

export interface VTableReportGridConfig {
  columns: ColumnDefine[];
  records: Record<string, unknown>[];
  customMergeCell: { range: { start: { col: number; row: number }; end: { col: number; row: number } } }[];
  options: Partial<ListTableConstructorOptions>;
}

export function adaptPublishedSheetToVTable(
  sheet: PublishedSheet,
  styles: Record<string, PublishedCellStyle> = {}
): VTableReportGridConfig {
  const rowCount = Math.max(sheet.rowCount, 1);
  const colCount = Math.max(sheet.colCount, 1);

  // 1. 建立单元格坐标索引
  const cellIndex = new Map<string, PublishedCell>();
  for (const cell of sheet.cells) {
    cellIndex.set(`${cell.r},${cell.c}`, cell);
  }

  // 2. 生成 records
  const records: Record<string, unknown>[] = [];
  for (let r = 0; r < rowCount; r++) {
    const rowObj: Record<string, unknown> = { _rowIndex: r };
    for (let c = 0; c < colCount; c++) {
      const cell = cellIndex.get(`${r},${c}`);
      const val = cell
        ? cell.displayText !== undefined
          ? cell.displayText
          : cell.v !== null && cell.v !== undefined
          ? cell.v
          : ''
        : '';
      rowObj[`col_${c}`] = val;
    }
    records.push(rowObj);
  }

  // 3. 生成 columns
  const columns: ColumnDefine[] = [];
  for (let c = 0; c < colCount; c++) {
    const colWidth = sheet.colWidths?.[c] ?? sheet.defaultColWidth ?? 100;
    columns.push({
      field: `col_${c}`,
      title: '', // 无自动表头，统一由第一行真实单元格充当
      width: colWidth,
      style: (args: any) => {
        const r = args.row;
        const cell = cellIndex.get(`${r},${c}`);
        if (cell?.styleId && styles[cell.styleId]) {
          return mapPublishedStyleToVTable(styles[cell.styleId]) as any;
        }
        return {
          textAlign: 'left',
          textBaseline: 'middle',
          fontSize: 12,
        };
      },
    });
  }

  // 4. 生成 customMergeCell
  const customMergeCell = (sheet.merges || []).map((m) => ({
    range: {
      start: { col: m.startCol, row: m.startRow },
      end: { col: m.endCol, row: m.endRow },
    },
  }));

  // 5. 组合 VTable 选项
  const options: Partial<ListTableConstructorOptions> = {
    showHeader: false, // 遵循 Section 11.3：关闭默认业务表头，真实单元格渲染
    frozenRowCount: sheet.frozenRowCount ?? 0,
    frozenColCount: sheet.frozenColCount ?? 0,
    defaultRowHeight: sheet.defaultRowHeight ?? 28,
    keyboardOptions: {
      copySelected: true,
      pasteValueToCell: false,
      selectAllOnCtrlA: true,
    },
    menu: {
      contextMenuItems: ['copy'],
    },
  };

  return {
    columns,
    records,
    customMergeCell,
    options,
  };
}
