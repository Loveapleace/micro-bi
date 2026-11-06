import type { ColumnDefine, ListTable, ListTableConstructorOptions } from '@visactor/vtable';
import type { PublishedCell, PublishedCellStyle, PublishedSheet } from '../../../report/types.js';
import { adaptPublishedSheetToVTable, type VTableReportGridConfig } from './gridAdapter.js';
import { registerPixelFontTable } from '../table/exportFontMetrics.js';
import type { CanvasViewport } from './canvasViewport.js';

type Point = { col: number; row: number };
type Range = { start: Point; end: Point };
type Selection = { start?: string | undefined; end?: string | undefined };
type Position = { left: number; top: number; selection: Selection[] };
const identity = (cell: PublishedCell) => cell.bindingId || cell.sourceCellId
  ? JSON.stringify([cell.sourceCellId || '', cell.bindingId || '']) : undefined;
function at(sheet: PublishedSheet, point: Point): string | undefined {
  const merge = sheet.merges.find(m => point.row >= m.startRow && point.row <= m.endRow && point.col >= m.startCol && point.col <= m.endCol);
  const cell = sheet.cells.find(c => c.r === (merge?.startRow ?? point.row) && c.c === (merge?.startCol ?? point.col));
  return cell ? identity(cell) : undefined;
}
function locate(sheet: PublishedSheet, id: string | undefined): Point | undefined {
  if (!id) return;
  const cells = sheet.cells.filter(c => identity(c) === id);
  return cells.length === 1 ? { row: cells[0]!.r, col: cells[0]!.c } : undefined;
}

/** One native instance per mounted viewport; callbacks always delegate to the current grid. */
export class ReportTableRuntime {
  table: ListTable | null = null;
  private grid: VTableReportGridConfig | undefined;
  private sheet: PublishedSheet | undefined;
  private key = '';
  private signature = '';
  private columns: ColumnDefine[] = [];
  private positions = new Map<string, Position>();
  private viewport: CanvasViewport | undefined;
  private revision = 0;
  private disposed = false;
  constructor(
    private create: (options: ListTableConstructorOptions) => ListTable,
    private options: (options: ListTableConstructorOptions) => ListTableConstructorOptions = value => value,
    private created: (table: ListTable) => void = () => {},
    private released: () => void = () => {},
  ) {}

  updateViewport(viewport: CanvasViewport | undefined): void {
    const before = this.viewport; this.viewport = viewport;
    const table = this.table;
    if (!table || table.isReleased || !viewport) return;
    if (!before || before.width !== viewport.width || before.height !== viewport.height) table.resize();
    if (Math.abs((table.pixelRatio || 1) - viewport.pixelRatio) >= 0.0001) table.setPixelRatio(viewport.pixelRatio);
  }

  private remember(): void {
    if (!this.table || !this.sheet) return;
    this.positions.set(this.key, { left: this.table.scrollLeft, top: this.table.scrollTop,
      selection: this.table.getSelectedCellRanges().map(range => ({ start: at(this.sheet!, range.start), end: at(this.sheet!, range.end) })) });
  }

  apply(reportId: string, sheet: PublishedSheet | undefined, styles: Record<string, PublishedCellStyle>, sortingEnabled = false): ListTable | null {
    if (this.disposed) return null;
    const revision = ++this.revision;
    this.remember();
    if (!sheet) { this.clear(); return null; }
    const key = JSON.stringify([reportId, sheet.id]);
    const grid = adaptPublishedSheetToVTable(sheet, styles, sortingEnabled);
    const signature = JSON.stringify([sheet.colCount, sheet.defaultColWidth, sheet.colWidths, sheet.defaultRowHeight,
      sheet.rowHeights, sheet.frozenRowCount, sheet.frozenColCount,
      grid.customMergeCell.map(merge => [merge.range, merge.text, merge.style, Boolean(merge.customRender)]),
      grid.columns.map(c => [Boolean((c as any).customRender),Boolean((c as any).icon)])]);
    const structureChanged = signature !== this.signature;
    this.grid = grid; this.sheet = sheet; this.key = key;
    if (!this.table || structureChanged) this.columns = grid.columns.map((column, index) => ({ ...column,
      fieldFormat: (record: any) => (this.grid!.columns[index] as any).fieldFormat(record),
      style: (args: any) => (this.grid!.columns[index] as any).style(args),
      ...((column as any).icon ? {icon:(args:any)=>(this.grid!.columns[index] as any).icon(args)} : {}),
      ...((column as any).customRender ? { customRender: (args: any) => (this.grid!.columns[index] as any).customRender?.(args) } : {}),
    } as ColumnDefine));
    const options = this.options({ ...grid.options, columns: this.columns, records: grid.rawRecords,
      customMergeCell: grid.customMergeCell, widthMode: 'standard', autoFillWidth: true, pixelRatio: this.viewport?.pixelRatio || 1 });
    const restore = () => {
      const table = this.table;
      if (!table || this.disposed || revision !== this.revision) return;
      table.clearSelected();
      const position = this.positions.get(key);
      table.setScrollLeft(position?.left || 0); table.setScrollTop(position?.top || 0);
      const ranges: Range[] = (position?.selection || []).flatMap(selection => {
        const start = locate(sheet, selection.start), end = locate(sheet, selection.end);
        return start && end ? [{ start: { row: Math.min(start.row, end.row), col: Math.min(start.col, end.col) },
          end: { row: Math.max(start.row, end.row), col: Math.max(start.col, end.col) } }] : [];
      });
      if (ranges.length) table.selectCells(ranges);
    };
    if (!this.table) {
      this.table = this.create(options); registerPixelFontTable(this.table); this.created(this.table);
    } else if (structureChanged) {
      void Promise.resolve(this.table.updateOption(options)).then(restore).catch(error => {
        if (!this.disposed && revision === this.revision) console.error('[ReportTableRuntime] 更新布局失败:', error);
      });
    } else this.table.setRecords(grid.rawRecords);
    this.signature = signature; restore();
    return this.table;
  }

  retainViews(reportId: string, sheets: readonly PublishedSheet[]): void {
    const keys = new Set(sheets.map(sheet => JSON.stringify([reportId, sheet.id])));
    for (const key of this.positions.keys()) if (!keys.has(key)) this.positions.delete(key);
  }

  private clear(): void {
    if (this.table) { const table = this.table; this.table = null; table.release(); this.released(); }
    this.grid = undefined; this.sheet = undefined; this.signature = '';
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true; this.revision++; this.clear(); this.positions.clear();
  }
}
