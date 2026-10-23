/**
 * 网格差集同步纯工具 (gridSync.ts)
 * 计算旧网格中"新网格已不存在"的业务单元格坐标，供 UniverPreview 增量刷新清理残留。
 * 纯数据层，无 Univer / DOM / React 依赖，可在 Node 测试中直接验证。
 */
import type { BiGridModel } from '../report/types.js';

export interface StaleCellCoord {
  row: number;
  col: number;
}

/**
 * 收集旧网格中不应继续存在的单元格坐标。
 * 规则：旧网格 cells 中任一坐标，若新网格 cells 中不存在同坐标单元格，即为残留。
 *
 * 背景：空配置网格的 colCount/rowCount 仍被钳制为 ≥1（Math.max(totalCols, 1)），
 * 仅按"超出新网格边界"清理时，边界内的旧表头会永久残留（列全部删除后 A1 表头不清空）。
 */
export function collectStaleCells(
  oldGrid: BiGridModel,
  newGrid: BiGridModel
): StaleCellCoord[] {
  const nextCoords = new Set(newGrid.cells.map((c) => `${c.row},${c.col}`));
  const seen = new Set<string>();
  const stale: StaleCellCoord[] = [];
  for (const cell of oldGrid.cells) {
    const key = `${cell.row},${cell.col}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (!nextCoords.has(key)) {
      stale.push({ row: cell.row, col: cell.col });
    }
  }
  return stale;
}
