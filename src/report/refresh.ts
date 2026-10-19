/**
 * 报表数据刷新、语义绑定对齐与冲突检测模块 (refresh.ts)
 * 纯数据层，无 Univer / DOM / UI 依赖。
 * 实现：
 * 1. 依据语义身份 (semantic id) 重新对齐旧有绑定与手工覆盖 (manual overrides)
 * 2. 自动区域扩展与手工内容/其他分析区域的碰撞冲突检测 (detectRegionCollision)
 * 3. 产出结构完备的新 ReportAnalysisRegion
 */
import type { DataRecord } from '../engine/types.js';
import type {
  ReportAnalysisRegion,
  ReportRange,
  ReportDiagnostic,
  ReportBinding,
} from './types.js';
import { buildBiGrid } from './buildBiGrid.js';
import { buildBindingIndex } from './bindings.js';

export function detectRegionCollision(
  targetRange: ReportRange,
  existingRanges: readonly ReportRange[]
): boolean {
  for (const r of existingRanges) {
    if (r.sheetId && targetRange.sheetId && r.sheetId !== targetRange.sheetId) {
      continue;
    }
    const overlapRow =
      targetRange.startRow <= r.endRow && targetRange.endRow >= r.startRow;
    const overlapCol =
      targetRange.startCol <= r.endCol && targetRange.endCol >= r.startCol;
    if (overlapRow && overlapCol) {
      return true;
    }
  }
  return false;
}

export interface RefreshAnalysisResult {
  region: ReportAnalysisRegion;
  diagnostics: ReportDiagnostic[];
  newGrid: ReturnType<typeof buildBiGrid>;
}

export function refreshAnalysisRegion(
  region: ReportAnalysisRegion,
  records: readonly DataRecord[],
  options: {
    existingRegions?: readonly ReportAnalysisRegion[];
    rawHeaders?: Record<string, string>;
  } = {}
): RefreshAnalysisResult {
  const diagnostics: ReportDiagnostic[] = [];

  // 1. 基于最新数据生成新的 BI 矩阵
  const newGrid = buildBiGrid(region.config, records, {
    analysisId: region.id,
    sheetId: region.sheetId,
    rawHeaders: options.rawHeaders,
  });

  const anchor = region.anchor || { row: 0, column: 0 };
  const newRange: ReportRange = {
    sheetId: region.sheetId,
    startRow: anchor.row,
    endRow: anchor.row + newGrid.rowCount - 1,
    startCol: anchor.column,
    endCol: anchor.column + newGrid.colCount - 1,
  };

  // 2. 检查与其他区域的碰撞
  if (options.existingRegions && options.existingRegions.length > 0) {
    const otherRanges = options.existingRegions
      .filter((other) => other.id !== region.id && other.range)
      .map((other) => other.range!);

    if (detectRegionCollision(newRange, otherRanges)) {
      diagnostics.push({
        severity: 'warning',
        code: 'REGION_OVERLAP',
        message: `分析区域 ${region.id} 扩展至 [${newRange.startRow}, ${newRange.startCol}] - [${newRange.endRow}, ${newRange.endCol}] 时与其他区域产生重叠`,
        analysisId: region.id,
        sheetId: region.sheetId,
        range: newRange,
      });
    }
  }

  // 3. 语义匹配旧绑定与人工覆盖
  const oldOverrides = { ...(region.archivedOverrides || {}), ...(region.manualOverrides || {}) };
  const updatedOverrides: Record<string, { v?: unknown; f?: string; displayText?: string; baseValue?: unknown }> = {};
  const archivedOverrides: Record<string, { v?: unknown; f?: string; displayText?: string; baseValue?: unknown }> = {};

  // 将新生成的网格坐标加上 anchor 偏移
  const adjustedBindings: ReportBinding[] = newGrid.bindings.map((b) => ({
    ...b,
    target: {
      sheetId: region.sheetId,
      row: b.target.row + anchor.row,
      column: b.target.column + anchor.column,
    },
  }));

  const { bySemantic: newBindingMap } = buildBindingIndex(adjustedBindings);

  // 记录新网格中每个绑定 ID 对应的基础值
  const currentBaseValues: Record<string, unknown> = {};
  for (const b of adjustedBindings) {
    const cell = newGrid.cells.find(
      (c) => c.row === b.target.row - anchor.row && c.col === b.target.column - anchor.column
    );
    if (cell) {
      currentBaseValues[b.id] = cell.value;
    }
  }

  // 迁移匹配的旧覆盖
  for (const [bindingId, override] of Object.entries(oldOverrides)) {
    if (newBindingMap.has(bindingId)) {
      updatedOverrides[bindingId] = override;
      const targetBinding = newBindingMap.get(bindingId)!;
      targetBinding.state = 'manual-override';

      // 检查源值是否变更 (DT-10: BASE_CHANGED)
      const prevBase = override.baseValue ?? region.baseValues?.[bindingId];
      const curBase = currentBaseValues[bindingId];
      if (prevBase !== undefined && curBase !== undefined && prevBase !== curBase) {
        // 固定原有冲突基线，确保下一次未解决的相同刷新仍然能报出冲突诊断 (RT-08 / RX-17)
        updatedOverrides[bindingId] = {
          ...override,
          baseValue: prevBase,
        };
        diagnostics.push({
          severity: 'warning',
          code: 'BASE_CHANGED',
          message: `覆盖单元格 [${bindingId}] 底层源数据已从 ${prevBase} 变为 ${curBase}，产生覆盖基线冲突`,
          analysisId: region.id,
          sheetId: region.sheetId,
        });
      }
    } else {
      archivedOverrides[bindingId] = override;
      diagnostics.push({
        severity: 'info',
        code: 'REFERENCE_MISSING',
        message: `成员或指标已移除，对应人工覆盖 [${bindingId}] 已失效并归档`,
        analysisId: region.id,
        sheetId: region.sheetId,
      });
    }
  }

  const updatedRegion: ReportAnalysisRegion = {
    ...region,
    anchor,
    range: newRange,
    bindings: adjustedBindings,
    manualOverrides: updatedOverrides,
    archivedOverrides,
    baseValues: currentBaseValues,
  };

  return {
    region: updatedRegion,
    diagnostics,
    newGrid,
  };
}
