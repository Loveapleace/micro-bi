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
  rawRecords: Record<string, unknown>[];
  customMergeCell: {
    range: { start: { col: number; row: number }; end: { col: number; row: number } };
    text: string;
    style?: any;
  }[];
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
  const rawRecords: Record<string, unknown>[] = [];
  for (let r = 0; r < rowCount; r++) {
    const rowObj: Record<string, unknown> = { _rowIndex: r };
    const rawRow: Record<string, unknown> = { _rowIndex: r };
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
      rawRow[`col_${c}`] = cell?.v ?? null;
    }
    records.push(rowObj);
    rawRecords.push(rawRow);
  }

  // 3. 生成 columns
  const columns: ColumnDefine[] = [];
  for (let c = 0; c < colCount; c++) {
    const colWidth = sheet.colWidths?.[c] ?? sheet.defaultColWidth ?? 100;
    columns.push({
      field: `col_${c}`,
      fieldFormat: (record: any) => records[record._rowIndex]?.[`col_${c}`] ?? '',
      title: '', // 无自动表头，统一由第一行真实单元格充当
      width: colWidth,
      tooltip: (args: any) => {
        const r = args.row;
        const cell = cellIndex.get(`${r},${c}`);
        if (cell?.tooltip) {
          return {
            content: cell.tooltip,
          };
        }
        return undefined;
      },
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
          padding: [4,6,4,6],
        };
      },
    } as any);
  }

  // 4. 生成 customMergeCell
  const customMergeCell = (sheet.merges || []).map((m) => {
    const startCol = Math.min(m.startCol, m.endCol);
    const endCol = Math.max(m.startCol, m.endCol);
    const startRow = Math.min(m.startRow, m.endRow);
    const endRow = Math.max(m.startRow, m.endRow);

    if (startCol < 0 || startRow < 0 || endCol >= colCount || endRow >= rowCount) {
      console.warn(
        `[gridAdapter] 合并区域超出工作表边界: (${startRow},${startCol}) -> (${endRow},${endCol}), 当前容量: ${rowCount}x${colCount}`
      );
    }

    const value = records[startRow]?.[`col_${startCol}`];
    const text = value === null || value === undefined ? '' : String(value);

    const masterCell = cellIndex.get(`${startRow},${startCol}`);
    const style = masterCell?.styleId && styles[masterCell.styleId]
      ? (mapPublishedStyleToVTable(styles[masterCell.styleId]) as any)
      : undefined;

    return {
      range: {
        start: { col: startCol, row: startRow },
        end: { col: endCol, row: endRow },
      },
      text,
      ...(style ? { style } : {}),
    };
  });

  // 5. 组合 VTable 选项
  const options: Partial<ListTableConstructorOptions> = {
    showHeader: false, // 遵循 Section 11.3：关闭默认业务表头，真实单元格渲染
    enableLineBreak: true,
    frozenRowCount: sheet.frozenRowCount ?? 0,
    frozenColCount: sheet.frozenColCount ?? 0,
    defaultRowHeight: sheet.defaultRowHeight ?? 28,
    rowHeightConfig: Object.entries(sheet.rowHeights||{}).map(([row,height])=>({key:Number(row),height})),
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
    rawRecords,
    customMergeCell,
    options,
  };
}

export function publishedSheetToTsv(sheet:PublishedSheet,mode:'display'|'raw',range?:{start:{row:number;col:number};end:{row:number;col:number}}):string {
  const cells=new Map(sheet.cells.map(c=>[`${c.r}:${c.c}`,c]));
  const startRow=range?Math.min(range.start.row,range.end.row):0,endRow=range?Math.max(range.start.row,range.end.row):sheet.rowCount-1;
  const startCol=range?Math.min(range.start.col,range.end.col):0,endCol=range?Math.max(range.start.col,range.end.col):sheet.colCount-1;
  const quote=(v:unknown)=>{const s=String(v??'');return /[\t\r\n"]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s;};
  const rows:string[]=[];for(let r=startRow;r<=endRow;r++){const values:string[]=[];for(let c=startCol;c<=endCol;c++){const cell=cells.get(`${r}:${c}`);values.push(quote(mode==='raw'?cell?.v:cell?.displayText??cell?.v));}rows.push(values.join('\t'));}return rows.join('\r\n');
}
