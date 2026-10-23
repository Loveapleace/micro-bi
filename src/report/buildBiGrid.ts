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
  return {
    ...(style.fontFamily ? { ff: style.fontFamily } : {}),
    ...(style.fontSize ? { fs: style.fontSize } : {}),
    ...(style.bold !== undefined ? { bl: style.bold ? 1 : 0 } : {}),
    ...(style.italic !== undefined ? { it: style.italic ? 1 : 0 } : {}),
    ...(style.color ? { cl: { rgb: style.color } } : {}),
    ...(style.bgColor ? { bg: { rgb: style.bgColor } } : {}),
    ...(style.align ? { ht: { left: 1, center: 2, right: 3 }[style.align] } : {}),
    ...(style.verticalAlign ? { vt: { top: 1, middle: 2, bottom: 3 }[style.verticalAlign] } : {}),
    ...(style.wrapText !== undefined ? { tb: style.wrapText ? 2 : 1 } : {}),
    ...(pat ? { n: { pattern: pat } } : {}),
  };
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

    let cellType = 1; // 1: String, 2: Number, 3: Boolean
    let val: unknown = cell.value;
    const pat = toExcelPattern(cell.style?.format);

    if (val === null || val === undefined) {
      if (cell.displayText !== undefined && cell.displayText !== '') {
        val = cell.displayText;
      } else {
        val = '';
      }
      cellType = 1;
    } else if (typeof val === 'number') {
      if ((cell as any).hasAdvancedFormat && cell.displayText !== undefined) {
        val = cell.displayText;
        cellType = 1;
      } else if (!pat && cell.displayText !== undefined && cell.displayText !== String(val)) {
        val = cell.displayText;
        cellType = 1;
      } else {
        cellType = 2;
      }
    } else if (typeof val === 'boolean') {
      cellType = 3;
    } else {
      if (cell.displayText !== undefined && cell.displayText !== String(val)) {
        val = cell.displayText;
      } else {
        val = String(val);
      }
      cellType = 1;
    }

    cellData[cell.row]![cell.col] = {
      v: val,
      t: cellType,
      ...(cell.style ? { s: publishedStyleToUniver(cell.style) } : {}),
      custom: {
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
    cellData,
    mergeData,
    ...(grid.colWidths ? { columnData: Object.fromEntries(Object.entries(grid.colWidths).map(([i, w]) => [i, { w }])) } : {}),
    ...(grid.rowHeights ? { rowData: Object.fromEntries(Object.entries(grid.rowHeights).map(([i, h]) => [i, { h }])) } : {}),
  };
}
