/**
 * 模板动态合并解析器 (mergeResolver.ts)
 * 纯函数实现，无 Univer / DOM / UI 依赖。
 * 遵循 Section 6, 7, 8, 9 规范：
 * 1. 统一决议顺序：静态/人工合并 > 分组覆盖 (group-span) > 相邻同值 (adjacent-equal)
 * 2. 身份隔离：区分父组、维度成员与度量，不跨越总计/小计/边界
 * 3. 例外过滤：支持 group-context 与 instance-cells 局部取消
 * 4. 矩形防重叠与去重，单格范围 (1x1) 不输出 merge
 */
import type { BiGridModel, ReportCellMerge, ReportBinding } from '../report/types.js';
import type {
  CellTemplateDocumentV1,
  NormalizedRegionPlan,
  DynamicMergePolicy,
  MergeSuppression,
  TemplateDiagnostic,
} from './types.js';
import {
  buildGroupContextKey,
  parseInstanceKey,
  encodeMemberTuple,
  computeBindingSignature,
} from './identity.js';

export interface ResolvedMergeMetadata {
  ruleId: string;
  origin: 'static-layout' | 'manual-instance' | 'group-span' | 'adjacent-equal';
  targetCellId?: string | undefined;
  groupContextKey?: string | undefined;
  range: ReportCellMerge;
}

export interface ResolveTemplateMergesResult {
  merges: ReportCellMerge[];
  diagnostics: TemplateDiagnostic[];
  resolvedDetails: ResolvedMergeMetadata[];
}

/**
 * 判断两个矩形是否发生重叠或相交
 */
export function isRangeOverlapping(a: ReportCellMerge, b: ReportCellMerge): boolean {
  return !(
    a.endRow < b.startRow ||
    a.startRow > b.endRow ||
    a.endCol < b.startCol ||
    a.startCol > b.endCol
  );
}

/**
 * 格式化范围为字符串用于去重
 */
function rangeKey(r: ReportCellMerge): string {
  return `${r.startRow}:${r.endRow}:${r.startCol}:${r.endCol}`;
}

/**
 * 统一解析所有模板合并规则与动态合并策略
 */
export function resolveTemplateMerges(
  doc: CellTemplateDocumentV1,
  plan: NormalizedRegionPlan,
  baseGrid: BiGridModel,
  options: {
    sheetId?: string | undefined;
  } = {}
): ResolveTemplateMergesResult {
  const sheetId = options.sheetId || plan.sheetId || 'sheet-1';
  const diagnostics: TemplateDiagnostic[] = [];
  const resolvedDetails: ResolvedMergeMetadata[] = [];
  const finalMerges: ReportCellMerge[] = [];
  const seenRangeKeys = new Set<string>();

  // -------------------------------------------------------------------------
  // 1. 处理静态与人工合并 (来自 doc.layoutRules)
  // -------------------------------------------------------------------------
  const layoutMergeRules = (doc.layoutRules || []).filter(
    (r) => r.sheetId === sheetId && r.kind === 'merge' && r.range
  );

  const anchorRow = plan.anchor?.row ?? 0;

  for (const rule of layoutMergeRules) {
    const range = rule.range!;
    const isHeaderRegion =
      range.startRow < anchorRow ||
      !baseGrid.bindings.some(
        (b) =>
          b.target.row >= range.startRow &&
          b.target.row <= range.endRow &&
          b.target.column >= range.startColumn &&
          b.target.column <= range.endColumn &&
          b.semantic.role !== 'custom'
      );

    if (isHeaderRegion) {
      // 表头固定合并 (如 A1:H1 标题)
      let endCol = range.endColumn;
      if (rule.id === 'merge-title') {
        const gridMaxCol = baseGrid.cells.reduce((m, c) => Math.max(m, c.col), 0);
        if (gridMaxCol > 0) {
          endCol = gridMaxCol;
        }
      }
      const merge: ReportCellMerge = {
        startRow: range.startRow,
        endRow: range.endRow,
        startCol: range.startColumn,
        endCol,
      };
      if (merge.startRow !== merge.endRow || merge.startCol !== merge.endCol) {
        const k = rangeKey(merge);
        if (!seenRangeKeys.has(k)) {
          seenRangeKeys.add(k);
          finalMerges.push(merge);
          resolvedDetails.push({
            ruleId: rule.id,
            origin: 'static-layout',
            range: merge,
          });
        }
      }
      continue;
    }

    // 数据区手动规则：通过语义签名动态定位
    let selector = rule.semanticSelector;
    if (!selector) {
      const covered = baseGrid.bindings.filter(
        (b) =>
          b.target.row >= range.startRow &&
          b.target.row <= range.endRow &&
          b.target.column >= range.startColumn &&
          b.target.column <= range.endColumn
      );
      const master = covered.find(
        (b) => b.target.row === range.startRow && b.target.column === range.startColumn
      );
      if (master && covered.length > 0) {
        selector = {
          masterSignature: computeBindingSignature(master),
          coveredSignatures: covered.map(computeBindingSignature),
          metricDirection: plan.metricDirection || 'rows',
        };
        if (!Object.isFrozen(rule)) {
          rule.semanticSelector = selector;
        }
      }
    }

    if (!selector) {
      const merge: ReportCellMerge = {
        startRow: range.startRow,
        endRow: range.endRow,
        startCol: range.startColumn,
        endCol: range.endColumn,
      };
      if (merge.startRow !== merge.endRow || merge.startCol !== merge.endCol) {
        const k = rangeKey(merge);
        if (!seenRangeKeys.has(k)) {
          seenRangeKeys.add(k);
          finalMerges.push(merge);
          resolvedDetails.push({
            ruleId: rule.id,
            origin: 'manual-instance',
            range: merge,
          });
        }
      }
      continue;
    }

    // 指标方向一致性检查
    const currentMetricDir = plan.metricDirection || 'rows';
    if (selector.metricDirection && selector.metricDirection !== currentMetricDir) {
      diagnostics.push({
        severity: 'error',
        code: 'ERR_MERGE_LAYOUT_CONFLICT',
        message: `Layout merge rule "${rule.id}" was created for metricDirection="${selector.metricDirection}", but current is "${currentMetricDir}".`,
        targetId: rule.id,
      });
      continue;
    }

    const coveredSignatures = selector.coveredSignatures || [];
    if (coveredSignatures.length === 0) {
      continue;
    }

    const matchedBindings = baseGrid.bindings.filter((b) =>
      coveredSignatures.includes(computeBindingSignature(b))
    );

    if (matchedBindings.length === 0) {
      diagnostics.push({
        severity: 'warning',
        code: 'ERR_MERGE_ORPHANED',
        message: `Layout merge rule "${rule.id}" could not find covered members in dataset.`,
        targetId: rule.id,
      });
      continue;
    }

    if (matchedBindings.length < coveredSignatures.length) {
      diagnostics.push({
        severity: 'warning',
        code: 'ERR_MERGE_MEMBER_MISSING',
        message: `Layout merge rule "${rule.id}" could not be relocated because some covered members are missing.`,
        targetId: rule.id,
      });
      continue;
    }

    const minR = Math.min(...matchedBindings.map((b) => b.target.row));
    const maxR = Math.max(...matchedBindings.map((b) => b.target.row));
    const minC = Math.min(...matchedBindings.map((b) => b.target.column));
    const maxC = Math.max(...matchedBindings.map((b) => b.target.column));

    const expectedArea = (maxR - minR + 1) * (maxC - minC + 1);
    if (matchedBindings.length !== expectedArea) {
      diagnostics.push({
        severity: 'error',
        code: 'ERR_MERGE_LAYOUT_NON_CONTIGUOUS',
        message: `Layout merge rule "${rule.id}" resolved to non-contiguous cells after data layout change.`,
        targetId: rule.id,
      });
      continue;
    }

    if (minR !== maxR || minC !== maxC) {
      const merge: ReportCellMerge = { startRow: minR, endRow: maxR, startCol: minC, endCol: maxC };
      const k = rangeKey(merge);
      if (!seenRangeKeys.has(k)) {
        seenRangeKeys.add(k);
        finalMerges.push(merge);
        resolvedDetails.push({
          ruleId: rule.id,
          origin: 'manual-instance',
          range: merge,
        });
      }
    }
  }

  // -------------------------------------------------------------------------
  // 2. 处理动态合并策略 (mergeConfig.policies)
  // -------------------------------------------------------------------------
  const hasDynamicConfig = Boolean(doc.mergeConfig && doc.mergeConfig.policies);

  // 兼容老版本：若没有 mergeConfig 且无 layoutRules，维持原 grouped 投影器合并
  if (!hasDynamicConfig) {
    if (!doc.layoutRules && plan.layoutKind === 'grouped') {
      for (const m of baseGrid.merges) {
        if (m.startRow !== m.endRow || m.startCol !== m.endCol) {
          const k = rangeKey(m);
          if (!seenRangeKeys.has(k)) {
            seenRangeKeys.add(k);
            finalMerges.push(m);
          }
        }
      }
    }
    return {
      merges: finalMerges,
      diagnostics,
      resolvedDetails,
    };
  }

  const policies = (doc.mergeConfig?.policies || []).filter(
    (p) => p.sheetId === sheetId && p.regionId === plan.regionId && p.enabled
  );
  const suppressions = doc.mergeConfig?.suppressions || [];

  // 构建抑制集合
  const suppressedGroupContexts = new Set<string>();
  const suppressedCellKeys = new Set<string>();

  for (const s of suppressions) {
    if (s.scope === 'group-context' && s.groupContextKey) {
      suppressedGroupContexts.add(s.groupContextKey);
    } else if (s.scope === 'instance-cells' && Array.isArray(s.cellKeys)) {
      for (const ck of s.cellKeys) {
        suppressedCellKeys.add(ck);
      }
    }
  }

  // 辅助映射：templateCellId -> field
  const templateCellFieldMap = new Map<string, { fieldId: string; axis: 'row' | 'column' }>();
  for (const rd of plan.rowDimensions) {
    templateCellFieldMap.set(rd.templateCellId, { fieldId: rd.fieldId, axis: 'row' });
  }
  for (const cd of plan.columnDimensions) {
    templateCellFieldMap.set(cd.templateCellId, { fieldId: cd.fieldId, axis: 'column' });
  }

  // -------------------------------------------------------------------------
  // 2.1 分组覆盖 (group-span)
  // -------------------------------------------------------------------------
  const groupSpanPolicies = policies.filter((p): p is DynamicMergePolicy & { kind: 'group-span' } => p.kind === 'group-span');

  for (const policy of groupSpanPolicies) {
    if (policy.target.kind === 'template-cell') {
      const targetCellId = policy.target.templateCellId;
      const dimInfo = templateCellFieldMap.get(targetCellId);
      if (!dimInfo) continue;

      const { fieldId, axis } = dimInfo;

      // 遍历 baseGrid.merges 中的候选范围，定位匹配该维度的成员块
      for (const candidate of baseGrid.merges) {
        // 单格范围不合并
        if (candidate.startRow === candidate.endRow && candidate.startCol === candidate.endCol) {
          continue;
        }

        // 查找主格处的 binding
        const masterBinding = baseGrid.bindings.find(
          (b) => b.target.row === candidate.startRow && b.target.column === candidate.startCol
        );
        if (!masterBinding) continue;

        // 验证主格是否为目标维度的成员标签
        let isMatch = false;
        let memberTuple: string[] = [];

        if (axis === 'row' && (masterBinding.semantic.role === 'dimension-member' || masterBinding.semantic.role === 'dimension-header')) {
          const path = masterBinding.semantic.rowPath || [];
          const matchedItem = path.find((p) => p.field === fieldId);
          if (matchedItem) {
            isMatch = true;
            memberTuple = path.map((p) => p.memberKey);
          }
        } else if (axis === 'column' && (masterBinding.semantic.role === 'dimension-member' || masterBinding.semantic.role === 'dimension-header')) {
          const path = masterBinding.semantic.columnPath || [];
          const matchedItem = path.find((p) => p.field === fieldId);
          if (matchedItem) {
            isMatch = true;
            memberTuple = path.map((p) => p.memberKey);
          }
        }

        if (!isMatch) continue;

        // 计算此成员块的 GroupContextKey
        const groupContextKey = buildGroupContextKey({
          regionId: plan.regionId,
          axis,
          fieldId,
          memberPath: encodeMemberTuple(memberTuple),
        });

        // 检查是否被用户取消例外排除
        if (suppressedGroupContexts.has(groupContextKey)) {
          continue;
        }

        // 检查是否与更高优先级的静态/人工合并重叠
        const conflictsWithManual = finalMerges.some((m) => isRangeOverlapping(m, candidate));
        if (conflictsWithManual) {
          continue;
        }

        const k = rangeKey(candidate);
        if (!seenRangeKeys.has(k)) {
          seenRangeKeys.add(k);
          finalMerges.push(candidate);
          resolvedDetails.push({
            ruleId: policy.id,
            origin: 'group-span',
            targetCellId,
            groupContextKey,
            range: candidate,
          });
        }
      }
    } else if (policy.target.kind === 'region-label') {
      const subject = policy.target.subject;
      // 总计/小计标签合并
      for (const candidate of baseGrid.merges) {
        if (candidate.startRow === candidate.endRow && candidate.startCol === candidate.endCol) {
          continue;
        }
        const masterBinding = baseGrid.bindings.find(
          (b) => b.target.row === candidate.startRow && b.target.column === candidate.startCol
        );
        if (!masterBinding) continue;

        let isMatch = false;
        if (
          (subject === 'row-total-label' && masterBinding.semantic.role === 'grand-total') ||
          (subject === 'row-subtotal-label' && masterBinding.semantic.role === 'subtotal')
        ) {
          isMatch = true;
        }

        if (isMatch) {
          const conflictsWithManual = finalMerges.some((m) => isRangeOverlapping(m, candidate));
          if (!conflictsWithManual) {
            const k = rangeKey(candidate);
            if (!seenRangeKeys.has(k)) {
              seenRangeKeys.add(k);
              finalMerges.push(candidate);
              resolvedDetails.push({
                ruleId: policy.id,
                origin: 'group-span',
                range: candidate,
              });
            }
          }
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // 2.2 相邻同值 (adjacent-equal)
  // -------------------------------------------------------------------------
  const adjacentEqualPolicies = policies.filter(
    (p): p is DynamicMergePolicy & { kind: 'adjacent-equal' } => p.kind === 'adjacent-equal'
  );

  function isSameParentGroup(
    b1: ReportBinding,
    b2: ReportBinding,
    axis: 'row' | 'column',
    targetFieldKey?: string
  ): boolean {
    const path1 = axis === 'row' ? b1.semantic.rowPath : b1.semantic.columnPath;
    const path2 = axis === 'row' ? b2.semantic.rowPath : b2.semantic.columnPath;
    // 双方均无路径（如自由明细格）视为同组；仅一方有路径时无法确认同组，保守视为不同组，
    // 避免相邻同值合并跨越父组边界。
    if (!path1 || !path2) {
      return (!path1 || path1.length === 0) && (!path2 || path2.length === 0);
    }
    const idx1 = targetFieldKey ? path1.findIndex((p) => p.field === targetFieldKey) : path1.length - 1;
    const idx2 = targetFieldKey ? path2.findIndex((p) => p.field === targetFieldKey) : path2.length - 1;
    const len = Math.min(idx1 >= 0 ? idx1 : path1.length - 1, idx2 >= 0 ? idx2 : path2.length - 1);
    if (len <= 0) return true;
    for (let i = 0; i < len; i++) {
      if (path1[i]?.field !== path2[i]?.field || path1[i]?.memberKey !== path2[i]?.memberKey) {
        return false;
      }
    }
    return true;
  }

  const isCellSuppressed = (b: ReportBinding) => {
    const coordKey = `${b.target.row}:${b.target.column}`;
    const instKey = (b as any).instanceKey;
    return suppressedCellKeys.has(coordKey) || (instKey && suppressedCellKeys.has(instKey));
  };

  for (const policy of adjacentEqualPolicies) {
    if (policy.target.kind !== 'template-cell') continue;
    const targetCellId = policy.target.templateCellId;
    const direction = policy.direction;

    // EQ-11: 未开启 allowMeasures 时，度量值单元格不合并
    if (policy.target.subject === 'metric-value' && !policy.allowMeasures) {
      continue;
    }

    const targetCell = doc.cells.find((c) => c.id === targetCellId);
    const targetFieldKey =
      (targetCell?.content as any)?.fieldKey || (targetCell?.content as any)?.fieldId;
    const targetMetricId = (targetCell?.content as any)?.metricId;
    const isMeasure = (targetCell?.content as any)?.role === 'measure';

    // EQ-11: 未开启 allowMeasures 时，度量值单元格不合并
    if (isMeasure && !policy.allowMeasures) {
      continue;
    }

    // 筛选目标单元格生成的逻辑格候选 (排除表头)
    const targetBindings = baseGrid.bindings.filter((b) => {
      if (b.semantic.role === 'dimension-header' || b.semantic.role === 'metric-header') {
        return false;
      }
      const instKey = (b as any).instanceKey;
      if (instKey) {
        const parsed = parseInstanceKey(instKey);
        if (parsed?.templateCellId === targetCellId) return true;
      }
      if (targetMetricId && b.semantic.metricId) {
        return b.semantic.metricId === targetMetricId;
      }
      if (targetFieldKey) {
        return (
          b.semantic.field === targetFieldKey ||
          (b.semantic.rowPath && b.semantic.rowPath.some((p) => p.field === targetFieldKey)) ||
          (b.semantic.columnPath && b.semantic.columnPath.some((p) => p.field === targetFieldKey))
        );
      }
      return false;
    });

    if (direction === 'vertical') {
      // 纵向按列分组扫描连续段
      const colsMap = new Map<number, ReportBinding[]>();
      for (const b of targetBindings) {
        const colList = colsMap.get(b.target.column) || [];
        colList.push(b);
        colsMap.set(b.target.column, colList);
      }

      for (const [colIdx, colBindings] of colsMap.entries()) {
        colBindings.sort((a, b) => a.target.row - b.target.row);

        let runStart = 0;
        while (runStart < colBindings.length) {
          const firstBinding = colBindings[runStart]!;
          if (isCellSuppressed(firstBinding)) {
            runStart++;
            continue;
          }

          const firstCell = baseGrid.cells.find(
            (c) => c.row === firstBinding.target.row && c.col === colIdx
          );
          if (!firstCell) {
            runStart++;
            continue;
          }

          // EQ-06 / EQ-07: 默认空值不合并
          if (firstCell.value === null && !policy.mergeNulls) {
            runStart++;
            continue;
          }
          if (firstCell.value === undefined && !policy.mergeUndefined) {
            runStart++;
            continue;
          }
          if (firstCell.value === '' && !policy.mergeEmptyStrings) {
            runStart++;
            continue;
          }
          // EQ-10: NaN 与 Infinity 不参与合并
          if (typeof firstCell.value === 'number' && (!isFinite(firstCell.value) || isNaN(firstCell.value))) {
            runStart++;
            continue;
          }

          let runEnd = runStart;
          while (runEnd + 1 < colBindings.length) {
            const nextBinding = colBindings[runEnd + 1]!;
            if (isCellSuppressed(nextBinding)) break;

            const nextCell = baseGrid.cells.find(
              (c) => c.row === nextBinding.target.row && c.col === colIdx
            );
            if (!nextCell) break;

            // 必须物理连续 (EQ-03, EQ-04)
            if (nextBinding.target.row !== colBindings[runEnd]!.target.row + 1) break;

            // 父组边界限制 (EQ-01, EQ-12)
            if (policy.boundary === 'parent-group') {
              if (firstBinding.semantic.rowPath && firstBinding.semantic.rowPath.length > 0) {
                if (!isSameParentGroup(firstBinding, nextBinding, 'row', targetFieldKey)) {
                  break;
                }
              } else {
                const parentRowId = targetCell?.parents?.row;
                if (parentRowId) {
                  const parentRowCell = doc.cells.find((c) => c.id === parentRowId);
                  const parentRowField =
                    (parentRowCell?.content as any)?.fieldKey || (parentRowCell?.content as any)?.fieldId;
                  if (parentRowField) {
                    const pBinding1 = baseGrid.bindings.find(
                      (b) =>
                        b.target.row === firstBinding.target.row &&
                        b.semantic.field === parentRowField &&
                        b.semantic.role !== 'dimension-header' &&
                        b.semantic.role !== 'metric-header'
                    );
                    const pBinding2 = baseGrid.bindings.find(
                      (b) =>
                        b.target.row === nextBinding.target.row &&
                        b.semantic.field === parentRowField &&
                        b.semantic.role !== 'dimension-header' &&
                        b.semantic.role !== 'metric-header'
                    );
                    if (pBinding1 && pBinding2) {
                      const pCell1 = baseGrid.cells.find(
                        (c) => c.row === pBinding1.target.row && c.col === pBinding1.target.column
                      );
                      const pCell2 = baseGrid.cells.find(
                        (c) => c.row === pBinding2.target.row && c.col === pBinding2.target.column
                      );
                      if (pCell1 && pCell2 && pCell1.value !== pCell2.value) {
                        break;
                      }
                    }
                  }
                }
              }
            }

            // 类型化实际值相等比较 (EQ-05)
            if (firstCell.value !== nextCell.value) break;

            // 空值设置
            if (firstCell.value === null && !policy.mergeNulls) break;
            if (firstCell.value === undefined && !policy.mergeUndefined) break;
            if (firstCell.value === '' && !policy.mergeEmptyStrings) break;

            // EQ-13: 条件格式背景色不同时在样式边界分段
            if (firstCell.style?.bgColor !== nextCell.style?.bgColor) break;

            runEnd++;
          }

          if (runEnd > runStart) {
            const candidateMerge: ReportCellMerge = {
              startRow: colBindings[runStart]!.target.row,
              endRow: colBindings[runEnd]!.target.row,
              startCol: colIdx,
              endCol: colIdx,
            };

            const overlaps = finalMerges.some((m) => isRangeOverlapping(m, candidateMerge));
            if (!overlaps) {
              const k = rangeKey(candidateMerge);
              if (!seenRangeKeys.has(k)) {
                seenRangeKeys.add(k);
                finalMerges.push(candidateMerge);
                resolvedDetails.push({
                  ruleId: policy.id,
                  origin: 'adjacent-equal',
                  targetCellId,
                  range: candidateMerge,
                });
              }
            }
          }

          runStart = runEnd + 1;
        }
      }
    } else if (direction === 'horizontal') {
      // 横向按行分组扫描连续段
      const rowsMap = new Map<number, ReportBinding[]>();
      for (const b of targetBindings) {
        const rowList = rowsMap.get(b.target.row) || [];
        rowList.push(b);
        rowsMap.set(b.target.row, rowList);
      }

      for (const [rowIdx, rowBindings] of rowsMap.entries()) {
        rowBindings.sort((a, b) => a.target.column - b.target.column);

        let runStart = 0;
        while (runStart < rowBindings.length) {
          const firstBinding = rowBindings[runStart]!;
          if (isCellSuppressed(firstBinding)) {
            runStart++;
            continue;
          }

          const firstCell = baseGrid.cells.find(
            (c) => c.row === rowIdx && c.col === firstBinding.target.column
          );
          if (!firstCell) {
            runStart++;
            continue;
          }

          // EQ-06 / EQ-07: 默认空值不合并
          if (firstCell.value === null && !policy.mergeNulls) {
            runStart++;
            continue;
          }
          if (firstCell.value === undefined && !policy.mergeUndefined) {
            runStart++;
            continue;
          }
          if (firstCell.value === '' && !policy.mergeEmptyStrings) {
            runStart++;
            continue;
          }
          // EQ-10: NaN 与 Infinity 不参与合并
          if (typeof firstCell.value === 'number' && (!isFinite(firstCell.value) || isNaN(firstCell.value))) {
            runStart++;
            continue;
          }

          let runEnd = runStart;
          while (runEnd + 1 < rowBindings.length) {
            const nextBinding = rowBindings[runEnd + 1]!;
            if (isCellSuppressed(nextBinding)) break;

            const nextCell = baseGrid.cells.find(
              (c) => c.row === rowIdx && c.col === nextBinding.target.column
            );
            if (!nextCell) break;

            if (nextBinding.target.column !== rowBindings[runEnd]!.target.column + 1) break;

            // 父组边界限制
            if (policy.boundary === 'parent-group') {
              if (firstBinding.semantic.columnPath && firstBinding.semantic.columnPath.length > 0) {
                if (!isSameParentGroup(firstBinding, nextBinding, 'column', targetFieldKey)) {
                  break;
                }
              } else {
                const parentColId = targetCell?.parents?.column;
                if (parentColId) {
                  const parentColCell = doc.cells.find((c) => c.id === parentColId);
                  const parentColField =
                    (parentColCell?.content as any)?.fieldKey || (parentColCell?.content as any)?.fieldId;
                  if (parentColField) {
                    const pBinding1 = baseGrid.bindings.find(
                      (b) =>
                        b.target.column === firstBinding.target.column &&
                        b.semantic.field === parentColField &&
                        b.semantic.role !== 'dimension-header' &&
                        b.semantic.role !== 'metric-header'
                    );
                    const pBinding2 = baseGrid.bindings.find(
                      (b) =>
                        b.target.column === nextBinding.target.column &&
                        b.semantic.field === parentColField &&
                        b.semantic.role !== 'dimension-header' &&
                        b.semantic.role !== 'metric-header'
                    );
                    if (pBinding1 && pBinding2) {
                      const pCell1 = baseGrid.cells.find(
                        (c) => c.row === pBinding1.target.row && c.col === pBinding1.target.column
                      );
                      const pCell2 = baseGrid.cells.find(
                        (c) => c.row === pBinding2.target.row && c.col === pBinding2.target.column
                      );
                      if (pCell1 && pCell2 && pCell1.value !== pCell2.value) {
                        break;
                      }
                    }
                  }
                }
              }
            }

            if (firstCell.value !== nextCell.value) break;

            if (firstCell.value === null && !policy.mergeNulls) break;
            if (firstCell.value === undefined && !policy.mergeUndefined) break;
            if (firstCell.value === '' && !policy.mergeEmptyStrings) break;

            // EQ-13: 条件格式背景色不同时分段
            if (firstCell.style?.bgColor !== nextCell.style?.bgColor) break;

            runEnd++;
          }

          if (runEnd > runStart) {
            const candidateMerge: ReportCellMerge = {
              startRow: rowIdx,
              endRow: rowIdx,
              startCol: rowBindings[runStart]!.target.column,
              endCol: rowBindings[runEnd]!.target.column,
            };

            const overlaps = finalMerges.some((m) => isRangeOverlapping(m, candidateMerge));
            if (!overlaps) {
              const k = rangeKey(candidateMerge);
              if (!seenRangeKeys.has(k)) {
                seenRangeKeys.add(k);
                finalMerges.push(candidateMerge);
                resolvedDetails.push({
                  ruleId: policy.id,
                  origin: 'adjacent-equal',
                  targetCellId,
                  range: candidateMerge,
                });
              }
            }
          }

          runStart = runEnd + 1;
        }
      }
    }
  }

  return {
    merges: finalMerges,
    diagnostics,
    resolvedDetails,
  };
}
