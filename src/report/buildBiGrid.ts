/**
 * 公共矩阵构建入口与 Univer 格式转换器 (buildBiGrid.ts)
 * 纯数据层，无 Univer / DOM / UI 依赖。
 * 1. 统一调度分组投影器 (projectGroupedReport) 与交叉透视投影器 (projectPivotReport)
 * 2. 将 BiGridModel 导出为 Univer 工作表纯 JSON 数据结构
 */
import type { DataRecord, DynamicTransformConfig } from '../engine/types.js';
import type { BiGridModel } from './types.js';
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

/**
 * 将 BiGridModel 转换为符合 Univer IWorksheetData 规范的纯 JSON 数据结构
 */
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
    if (typeof val === 'number') {
      cellType = 2;
    } else if (typeof val === 'boolean') {
      cellType = 3;
    } else if (val === null || val === undefined) {
      val = '';
      cellType = 1;
    } else {
      val = String(val);
      cellType = 1;
    }

    cellData[cell.row]![cell.col] = {
      v: val,
      t: cellType,
      custom: {
        role: cell.role,
        metricId: cell.metricId,
        field: cell.field,
        agg: cell.agg,
        displayText: cell.displayText,
        originalValue: cell.value,
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
  };
}
