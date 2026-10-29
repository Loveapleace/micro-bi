/**
 * 公共矩阵构建入口与 Univer 格式转换器 (buildBiGrid.ts)
 * 纯数据层，无 Univer / DOM / UI 依赖。
 * 1. 统一调度分组投影器 (projectGroupedReport) 与交叉透视投影器 (projectPivotReport)
 * 2. 将 BiGridModel 导出为 Univer 工作表纯 JSON 数据结构
 */
import type { DataRecord, DynamicTransformConfig } from '../engine/types.js';
import type { BiGridModel, PublishedCellStyle } from './types.js';
import { normalizeAxes } from './normalizeAxes.js';
import { projectGroupedReport } from './groupedProjector.js';
import { projectPivotReport } from './pivotProjector.js';
import { cellStyleToUniver } from './cellStyle.js';

export function buildBiGrid(
  config: DynamicTransformConfig,
  records: readonly DataRecord[],
  options: {
    analysisId?: string | undefined;
    sheetId?: string | undefined;
    rawHeaders?: Record<string, string> | undefined;
  } = {}
): BiGridModel {
  const axes = normalizeAxes(config, options.rawHeaders);

  if (axes.isCrossTab) {
    return projectPivotReport(records, axes, options);
  }

  return projectGroupedReport(records, axes, options);
}

/** 格式名称到 Excel / Univer 标准数字格式模式串的映射 (MBI-ADV-01) */
export function toExcelPattern(format?: string): string | undefined {
  if (!format || format === 'default') return undefined;
  switch (format) {
    case 'currency':
      return '¥#,##0.00';
    case 'percent':
    case 'percentage':
      return '0.00%';
    case 'number':
      return '#,##0.00';
    case 'integer':
      return '#,##0';
    case 'decimal2':
      return '0.00';
    default:
      return format;
  }
}

/** 纯数据样式转换；保持原始数值供公式计算，数字格式由工作表负责。 */
export function publishedStyleToUniver(style: PublishedCellStyle): Record<string, unknown> {
  const pat = toExcelPattern(style.format);
  return {...cellStyleToUniver(style),n:{pattern:pat||'General'}};
}

/** 将 BiGridModel 转换为符合 Univer IWorksheetData 规范的纯 JSON 数据结构。 */
export function biGridToUniverWorksheetData(
  grid: BiGridModel,
  options: {
    sheetId?: string | undefined;
    name?: string | undefined;
  } = {}
) {
  const sheetId = options.sheetId || 'sheet-1';
  const name = options.name || '工作表1';

  const cellData: Record<number, Record<number, Record<string, unknown>>> = {};

  for (const cell of grid.cells) {
    if (!cellData[cell.row]) {
      cellData[cell.row] = {};
    }

    const val = cell.value ?? null;
    const cellType = typeof val === 'number' ? 2 : typeof val === 'boolean' ? 3 : 1;

    cellData[cell.row]![cell.col] = {
      v: val,
      t: cellType,
      ...(cell.formula ? { f: cell.formula } : {}),
      ...(cell.style ? { s: publishedStyleToUniver(cell.style) } : {}),
      custom: {
        biProjection: true,
        displaySource: cell.displaySource,
        role: cell.role,
        metricId: cell.metricId,
        field: cell.field,
        agg: cell.agg,
        displayText: cell.displayText,
        originalValue: cell.value,
        tooltip: cell.tooltip,
      },
    };
  }

  const mergeData = grid.merges.map((m) => ({
    startRow: m.startRow,
    endRow: m.endRow,
    startColumn: m.startCol,
    endColumn: m.endCol,
  }));

  return {
    id: sheetId,
    name,
    rowCount: grid.rowCount,
    columnCount: grid.colCount,
    defaultRowHeight: grid.defaultRowHeight ?? 24,
    defaultColumnWidth: 100,
    cellData,
    mergeData,
    ...(grid.colWidths ? { columnData: Object.fromEntries(Object.entries(grid.colWidths).map(([i, w]) => [i, { w }])) } : {}),
    ...(grid.rowHeights ? { rowData: Object.fromEntries(Object.entries(grid.rowHeights).map(([i, h]) => [i, { h }])) } : {}),
  };
}
