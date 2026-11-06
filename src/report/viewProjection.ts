import type { PublishedReport, PublishedSheet, ReportCellMerge, PublishedCell } from './types.js';
import { drillCellKey, hashDrillValue } from './drill.js';

/** 显示窗口只重映射坐标；原始报表、聚合结果、合并意图和下钻范围保持。 */
export function projectReportSheet(report: PublishedReport, sheetId: string, rows: readonly number[], columns: readonly number[]): PublishedReport {
  const sheet = report.sheets.find(s => s.id === sheetId);
  if (!sheet) return report;
  const rowMap = new Map(rows.map((r, i) => [r, i]));
  const colMap = new Map(columns.map((c, i) => [c, i]));
  const point = (r: number, c: number) => rowMap.has(r) && colMap.has(c) ? { r: rowMap.get(r)!, c: colMap.get(c)! } : undefined;
  const range = (merge: ReportCellMerge): ReportCellMerge | undefined => {
    const rr = rows.filter(r => r >= merge.startRow && r <= merge.endRow).map(r => rowMap.get(r)!);
    const cc = columns.filter(c => c >= merge.startCol && c <= merge.endCol).map(c => colMap.get(c)!);
    if (!rr.length || !cc.length) return;
    return { ...merge, startRow: Math.min(...rr), endRow: Math.max(...rr), startCol: Math.min(...cc), endCol: Math.max(...cc) };
  };
  const cells: PublishedCell[] = sheet.cells.flatMap(cell => { const p = point(cell.r, cell.c); return p ? [{ ...cell, ...p }] : []; });
  const merges = sheet.merges.flatMap(merge => {
    const projected = range(merge);
    if (!projected) return [];
    if (!point(merge.startRow, merge.startCol)) {
      const master = sheet.cells.find(c => c.r === merge.startRow && c.c === merge.startCol);
      if (master) {
        const index = cells.findIndex(c => c.r === projected.startRow && c.c === projected.startCol);
        const carried = { ...master, r: projected.startRow, c: projected.startCol };
        if (index >= 0) cells[index] = carried; else cells.push(carried);
      }
    }
    return [projected];
  });
  const heights = Object.fromEntries(rows.flatMap((r, i) => sheet.rowHeights?.[r] !== undefined ? [[i, sheet.rowHeights[r]]] : []));
  const widths = Object.fromEntries(columns.flatMap((c, i) => sheet.colWidths?.[c] !== undefined ? [[i, sheet.colWidths[c]]] : []));
  const projected: PublishedSheet = { ...sheet, cells, merges, rowCount: rows.length, colCount: columns.length,
    sortHeaders: sheet.sortHeaders?.flatMap(header => {
      const merge=sheet.merges.find(merge=>header.row===merge.startRow&&header.column===merge.startCol);
      const projectedMerge=merge&&range(merge);
      const p=point(header.row,header.column) || (projectedMerge ? {r:projectedMerge.startRow,c:projectedMerge.startCol}:undefined);
      return p?[{...header,row:p.r,column:p.c}]:[];
    }),
    rowHeights: heights, colWidths: widths,
    frozenRowCount: rows.filter(r => r < (sheet.frozenRowCount || 0)).length,
    frozenColCount: columns.filter(c => c < (sheet.frozenColCount || 0)).length };
  let drillIndex = report.drillIndex;
  if (drillIndex) {
    const revision = `${drillIndex.revision}:view:${hashDrillValue(JSON.stringify([sheetId, rows, columns]))}`;
    const targets = Object.values(drillIndex.cells).flatMap(target => {
      if (target.sheetId !== sheetId) return [{ ...target, publicationRevision: revision }];
      const p = point(target.row, target.column);
      return p ? [{ ...target, publicationRevision: revision, row: p.r, column: p.c }] : [];
    });
    const drillMerges = drillIndex.merges.flatMap(merge => {
      if (merge.sheetId !== sheetId) return [{ ...merge, target: { ...merge.target, publicationRevision: revision } }];
      const p = range(merge);
      if (!p) return [];
      const target = { ...merge.target, publicationRevision: revision, row: p.startRow, column: p.startCol };
      targets.push(target);
      return [{ ...merge, ...p, target }];
    });
    drillIndex = { ...drillIndex, revision, cells: Object.fromEntries(targets.map(t => [drillCellKey(t.sheetId, t.row, t.column), t])), merges: drillMerges };
  }
  return { ...report, sheets: report.sheets.map(s => s.id === sheetId ? projected : s), ...(drillIndex ? { drillIndex } : {}) };
}

/** 列身份使用非空表头路径及同名序号，插入其他透视成员时不会按旧列号隐藏新列。 */
export function reportColumns(sheet: PublishedSheet, headerRows?: number) {
  const depth = headerRows ?? (sheet.frozenRowCount || Math.min(1, sheet.rowCount));
  const count = new Map<string, number>();
  return Array.from({ length: sheet.colCount }, (_, column) => {
    const identities: string[] = [];
    const parts = Array.from({ length: depth }, (_, row) => {
      const merge = sheet.merges.find(m => row >= m.startRow && row <= m.endRow && column >= m.startCol && column <= m.endCol);
      if (merge && merge.startCol === 0 && merge.endCol === sheet.colCount - 1 && merge.startRow === merge.endRow) return '';
      const cell = sheet.cells.find(c => c.r === (merge?.startRow ?? row) && c.c === (merge?.startCol ?? column));
      if (cell?.sourceCellId && cell.role === 'custom' && !cell.sourceCellId.startsWith('hdr-')) return '';
      if (cell) identities.push((cell.role === 'custom' ? cell.sourceCellId : cell.bindingId) || cell.sourceCellId || String(cell.v ?? ''));
      return cell?.displayText ?? String(cell?.v ?? '');
    }).filter(Boolean);
    const label = parts.join(' / ') || `列 ${column + 1}`;
    const identity = JSON.stringify(identities.length ? identities : parts);
    const ordinal = count.get(identity) || 0; count.set(identity, ordinal + 1);
    return { index: column, label, key: JSON.stringify([sheet.id, identities.length ? identities : parts, ordinal]) };
  });
}
