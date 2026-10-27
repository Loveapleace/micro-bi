/**
 * 模板实例化与展开核心 (expandTemplate.ts)
 * 纯数据层，无 Univer / DOM / UI 依赖。
 * 将 CellTemplateDocumentV1 与事实记录展开为 BiGridModel 与实例映射。
 */
import type { DataRecord } from '../engine/types.js';
import type {
  BiGridModel,
  BiGridCell,
  ReportCellMerge,
  ReportBinding,
  PublishedCellStyle,
} from '../report/types.js';
import type {
  NormalizedAxes,
  NormalizedDimension,
  NormalizedMetric,
} from '../report/normalizeAxes.js';
import { projectGroupedReport } from '../report/groupedProjector.js';
import { projectPivotReport } from '../report/pivotProjector.js';
import { createReportBinding } from '../report/bindings.js';
import type {
  CellTemplateDocumentV1,
  NormalizedRegionPlan,
  CellStyleDefinition,
  TemplateDiagnostic,
} from './types.js';
import { buildInstanceKey, parseInstanceKey, encodeMemberValue, encodeMemberTuple, decodeMemberTuple, computeBindingSignature } from './identity.js';
import { resolveTemplateMerges } from './mergeResolver.js';
import { expandCellDrivenTemplate } from './cellExpansionEngine.js';
import { applyRegionFilters } from './regionFilter.js';
import { evaluateArithmetic } from './arithmeticEval.js';
import { evaluateSheetFormula } from './sheetFormulaEvaluator.js';
import { applyPresentationRules } from './presentationRules.js';
import { activeStaticSpans, applyStaticSpans, prepareStaticSpanTemplate } from './staticSpans.js';

function toPublishedStyle(style?: CellStyleDefinition): PublishedCellStyle {
  if (!style) return {};
  const res: PublishedCellStyle = {};
  if (style.fontFamily !== undefined) res.fontFamily = style.fontFamily;
  if (style.fontSize !== undefined) res.fontSize = style.fontSize;
  if (style.bold !== undefined) res.bold = style.bold;
  if (style.italic !== undefined) res.italic = style.italic;
  if (style.color !== undefined) res.color = style.color;
  if (style.backgroundColor !== undefined) res.bgColor = style.backgroundColor;
  if (style.textAlign !== undefined) res.align = style.textAlign;
  if (style.verticalAlign !== undefined) res.verticalAlign = style.verticalAlign;
  return res;
}

function mergePublishedStyles(base?: PublishedCellStyle, incoming?: PublishedCellStyle): PublishedCellStyle | undefined {
  if (!base && !incoming) return undefined;
  if (!base) return incoming;
  if (!incoming) return base;
  const merged = { ...base };
  for (const [k, v] of Object.entries(incoming)) {
    if (v !== undefined) {
      (merged as any)[k] = v;
    }
  }
  return merged;
}

function colLetterToIndex(colStr: string): number {
  let col = 0;
  for (let i = 0; i < colStr.length; i++) {
    col = col * 26 + (colStr.toUpperCase().charCodeAt(i) - 64);
  }
  return col - 1;
}

function formatValue(value: number, format?: string): string | undefined {
  if (!format || !Number.isFinite(value)) return undefined;
  if (format === 'percent') return `${(value * 100).toFixed(2)}%`;
  if (format === 'number') return value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (format === 'currency') return `¥${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return undefined;
}

export interface ExpandTemplateResult {
  grid: BiGridModel;
  recordCount: number;
  filteredCount: number;
  diagnostics?: TemplateDiagnostic[];
}

/**
 * 应用区域级事实过滤（统一实现，见 regionFilter.ts，兼容原有导出签名）
 */
export { applyRegionFilters } from './regionFilter.js';

/**
 * 将 NormalizedRegionPlan 转换为共用执行引擎所需的 NormalizedAxes
 */
export function planToNormalizedAxes(plan: NormalizedRegionPlan): NormalizedAxes {
  const rowAxes: NormalizedDimension[] = plan.rowDimensions.map((dim, idx) => {
    if (dim.timeBucket) {
      return {
        id: `row-time-${idx}-${dim.fieldKey}`,
        field: dim.fieldKey,
        alias: `__row_time_${idx}_${dim.fieldKey}__`,
        label: dim.displayName,
        axis: 'row',
        isTime: true,
        timeConfig: {
          field: dim.fieldKey,
          granularity: dim.timeBucket.granularity,
          format: dim.timeBucket.granularity === 'month' ? 'YYYY-MM' : 'YYYY-MM-DD',
        },
      };
    }
    return {
      id: `row-cat-${idx}-${dim.fieldKey}`,
      field: dim.fieldKey,
      alias: dim.fieldKey,
      label: dim.displayName,
      axis: 'row',
      isTime: false,
    };
  });

  const colAxes: NormalizedDimension[] = plan.columnDimensions.map((dim, idx) => {
    if (dim.timeBucket) {
      return {
        id: `col-time-${idx}-${dim.fieldKey}`,
        field: dim.fieldKey,
        alias: `__col_time_${idx}_${dim.fieldKey}__`,
        label: dim.displayName,
        axis: 'col',
        isTime: true,
        timeConfig: {
          field: dim.fieldKey,
          granularity: dim.timeBucket.granularity,
          format: dim.timeBucket.granularity === 'month' ? 'YYYY-MM' : 'YYYY-MM-DD',
        },
      };
    }
    return {
      id: `col-cat-${idx}-${dim.fieldKey}`,
      field: dim.fieldKey,
      alias: dim.fieldKey,
      label: dim.displayName,
      axis: 'col',
      isTime: false,
    };
  });

  const metrics: NormalizedMetric[] = plan.measures.map((m) => {
    if (m.expression) {
      return {
        id: m.metricId,
        label: m.displayName,
        kind: 'computed',
        expression: m.expression,
        scope: m.scope || 'summary',
        precision: m.precision ?? 2,
      };
    }
    return {
      id: m.metricId,
      field: m.fieldKey,
      label: m.displayName,
      kind: 'aggregated',
      agg: m.operation as any,
    };
  });

  const isCrossTab = plan.layoutKind === 'pivot';

  return {
    isCrossTab,
    indicatorsAsCol: plan.metricDirection === 'columns',
    executionForm: isCrossTab ? 'pivot' : (rowAxes.length > 0 ? 'summary' : 'detail'),
    rowAxes,
    colAxes,
    metrics,
    rowTotals: {
      showGrandTotals: plan.rowTotals?.showGrandTotals ?? true,
      showSubTotals: plan.rowTotals?.showSubTotals ?? false,
      grandTotalLabel: plan.rowTotals?.label || '总计',
    },
    colTotals: {
      showGrandTotals: plan.columnTotals?.showGrandTotals ?? true,
      showSubTotals: plan.columnTotals?.showSubTotals ?? false,
      grandTotalLabel: plan.columnTotals?.label || '总计',
    },
    rawHeaders: {},
  };
}

/**
 * 明细区域展开器
 */
export function projectDetailReport(
  records: readonly DataRecord[],
  plan: NormalizedRegionPlan,
  options: { analysisId?: string; sheetId?: string; diagnostics?: TemplateDiagnostic[] } = {}
): BiGridModel {
  const analysisId = options.analysisId || 'analysis-detail';
  const sheetId = options.sheetId || plan.sheetId || 'sheet-1';

  const cells: BiGridCell[] = [];
  const bindings: ReportBinding[] = [];
  const merges: ReportCellMerge[] = [];

  const anchorRow = plan.anchor?.row ?? 0;
  const anchorCol = plan.anchor?.column ?? 0;

  // 校验明细记录主键唯一性与存在性 (DCR-08, RC-17, RC-18)
  const seenIds = new Set<string>();
  records.forEach((rec) => {
    const rawKey = rec.id ?? rec._id ?? rec.key;
    if (rawKey === undefined || rawKey === null) {
      options.diagnostics?.push({
        severity: 'error',
        code: 'ERR_DETAIL_MISSING_PRIMARY_KEY',
        message: `Detail record missing primary key (id, _id, or key).`,
        sheetId,
      });
      return;
    }
    const keyStr = encodeMemberValue(rawKey);
    if (seenIds.has(keyStr)) {
      options.diagnostics?.push({
        severity: 'error',
        code: 'ERR_DETAIL_DUPLICATE_PRIMARY_KEY',
        message: `Duplicate record primary key "${keyStr}" detected in detail records.`,
        sheetId,
      });
    }
    seenIds.add(keyStr);
  });

  // 1. 表头行 (anchorRow)
  plan.detailColumns.forEach((col, colIdx) => {
    const c = anchorCol + colIdx;
    cells.push({
      row: anchorRow,
      col: c,
      value: col.displayName,
      role: 'dimension-header',
      style: { bold: true, align: 'center', bgColor: '#fafafa' },
    });
    bindings.push(
      createReportBinding({
        analysisId,
        datasetId: plan.datasetId,
        sheetId,
        row: anchorRow,
        column: c,
        role: 'dimension-header',
        field: col.fieldKey,
      })
    );
  });

  // 2. 数据行
  records.forEach((rec, recIdx) => {
    const r = anchorRow + 1 + recIdx;
    const primaryKeyVal = rec.id ?? rec._id ?? rec.key;
    const recordId =
      primaryKeyVal !== undefined && primaryKeyVal !== null
        ? encodeMemberValue(primaryKeyVal)
        : String(recIdx);

    plan.detailColumns.forEach((col, colIdx) => {
      const c = anchorCol + colIdx;
      const rawVal = rec[col.fieldKey];
      const safeVal: string | number | boolean | null =
        rawVal === null || rawVal === undefined
          ? null
          : typeof rawVal === 'string' || typeof rawVal === 'number' || typeof rawVal === 'boolean'
          ? rawVal
          : JSON.stringify(rawVal);

      let displayText = safeVal === null ? '' : String(safeVal);
      if (col.format === 'percent' && typeof safeVal === 'number') {
        displayText = `${(safeVal * 100).toFixed(2)}%`;
      }

      cells.push({
        row: r,
        col: c,
        value: safeVal,
        displayText,
        role: 'metric-value',
        style: { align: typeof safeVal === 'number' ? 'right' : 'left' },
      });

      const binding = createReportBinding({
        analysisId,
        datasetId: plan.datasetId,
        sheetId,
        row: r,
        column: c,
        role: 'metric-value',
        field: col.fieldKey,
      });

      (binding as any).instanceKey = buildInstanceKey({
        templateCellId: col.templateCellId,
        regionId: plan.regionId,
        rowPath: recordId,
        columnPath: '__NONE__',
        metricId: col.fieldKey,
        role: 'detail-column',
      });

      bindings.push(binding);
    });
  });

  const rowCount = anchorRow + 1 + records.length;
  const colCount = anchorCol + plan.detailColumns.length;

  return {
    type: 'detail',
    rowCount: Math.max(rowCount, 20),
    colCount: Math.max(colCount, 10),
    cells,
    merges,
    bindings,
  };
}

/**
 * 完整模板展开主入口
 */
export function expandCellTemplate(
  doc: CellTemplateDocumentV1,
  plan: NormalizedRegionPlan,
  rawDataset: readonly DataRecord[]
): ExpandTemplateResult {
  if (!plan.layoutKind || doc.schemaVersion === '2.0' || doc.capabilitiesVersion === 'cell-expansion-v2') {
    const res = expandCellDrivenTemplate(doc, rawDataset, { sheetId: plan.sheetId });
    return {
      grid: res.grid,
      recordCount: res.recordCount,
      filteredCount: res.filteredCount,
      diagnostics: res.diagnostics,
    };
  }

  if (activeStaticSpans(doc, plan.sheetId).length) {
    const base = expandCellTemplate({ ...prepareStaticSpanTemplate(doc), presentationRules: undefined, styleRules: [] }, plan, rawDataset);
    const definitions = [...plan.rowDimensions, ...plan.columnDimensions, ...plan.detailColumns];
    const bindings = base.grid.bindings.map((b) => {
      const targetId = (b as any).templateCellId || (b.semantic.metricId ? plan.measures.find((m) => m.metricId === b.semantic.metricId)?.templateCellId :
        definitions.find((d) => d.fieldKey === b.semantic.field)?.templateCellId);
      return { ...b, templateCellId: targetId, regionId: plan.regionId };
    });
    const spanned = applyStaticSpans(doc, { ...base.grid, bindings }, { sheetId: plan.sheetId });
    const presentation = applyPresentationRules(doc, spanned.grid, rawDataset, { sheetId: plan.sheetId });
    return { ...base, grid: presentation.grid, diagnostics: [...(base.diagnostics || []), ...spanned.diagnostics, ...presentation.diagnostics] };
  }

  const filtered = applyRegionFilters(rawDataset, plan.filters);
  let baseGrid: BiGridModel;
  const diagnostics: TemplateDiagnostic[] = [];

  const analysisId = `analysis-${plan.regionId}`;
  const sheetId = plan.sheetId || 'sheet-1';

  if (plan.layoutKind === 'detail') {
    baseGrid = projectDetailReport(filtered, plan, { analysisId, sheetId, diagnostics });
  } else if (plan.layoutKind === 'grouped') {
    const axes = planToNormalizedAxes(plan);
    baseGrid = projectGroupedReport(filtered, axes, { analysisId, sheetId });
  } else {
    // pivot
    const axes = planToNormalizedAxes(plan);
    baseGrid = projectPivotReport(filtered, axes, { analysisId, sheetId });
  }

  // 分组、透视投影器从原点生成；模板锚点由这一层统一平移。
  if (plan.layoutKind !== 'detail' && (plan.anchor.row || plan.anchor.column)) {
    const { row, column } = plan.anchor;
    baseGrid = {
      ...baseGrid,
      rowCount: baseGrid.rowCount + row,
      colCount: baseGrid.colCount + column,
      cells: baseGrid.cells.map((c) => ({ ...c, row: c.row + row, col: c.col + column })),
      bindings: baseGrid.bindings.map((b) => ({ ...b, target: { ...b.target, row: b.target.row + row, column: b.target.column + column } })),
      merges: baseGrid.merges.map((m) => ({ startRow: m.startRow + row, endRow: m.endRow + row, startCol: m.startCol + column, endCol: m.endCol + column })),
    };
  }

  // 模板样式按业务身份应用于展开后的成员和指标，坐标变化不会改变目标。
  const definitions = new Map(doc.cells.map((c) => [c.id, c]));
  for (const cell of baseGrid.cells) {
    const templateId = cell.metricId
      ? plan.measures.find((m) => m.metricId === cell.metricId)?.templateCellId
      : [...plan.rowDimensions, ...plan.columnDimensions, ...plan.detailColumns].find((d) => d.fieldKey === cell.field)?.templateCellId;
    const definition = templateId ? definitions.get(templateId) : undefined;
    if (!definition) continue;
    const style = { ...cell.style, ...toPublishedStyle(definition.style) };
    const format = definition.content.format;
    if (typeof cell.value === 'number' && format) {
      cell.displayText = formatValue(cell.value, format) ?? cell.displayText;
      style.format = format === 'percent' ? '0.00%' : format === 'number' ? '#,##0.00' : format === 'currency' ? '¥#,##0.00' : format;
    }
    if (Object.keys(style).length) cell.style = style;
  }

  const cellMap = new Map<string, BiGridCell>();
  for (const c of baseGrid.cells) {
    cellMap.set(`${c.row},${c.col}`, c);
  }

  // 记录每个单元格展开后的纯事实基线值，供实例覆盖消费及连续人工编辑保存使用 (R3-01)
  for (const b of baseGrid.bindings) {
    const c = cellMap.get(`${b.target.row},${b.target.column}`);
    if (c) {
      (b as any).originalValue = c.value;
    }
  }

  // 自由单元格与自定义公式展开及碰撞检测
  for (const cell of doc.cells || []) {
    if (cell.sheetId === sheetId && !cell.regionId) {
      const posKey = `${cell.position.row},${cell.position.column}`;
      if (cellMap.has(posKey)) {
        diagnostics.push({
          severity: 'error',
          code: 'ERR_REGION_CELL_COLLISION',
          message: `Free cell "${cell.id}" at (${cell.position.row}, ${cell.position.column}) collides with expanded region data cell.`,
          targetId: cell.id,
          sheetId: cell.sheetId,
        });
        continue;
      }

      let safeVal: string | number | boolean | null = null;
      let displayText = '';

      if (cell.content.kind === 'literal') {
        const litVal = cell.content.value;
        safeVal =
          litVal === null || litVal === undefined
            ? null
            : typeof litVal === 'string' || typeof litVal === 'number' || typeof litVal === 'boolean'
            ? litVal
            : String(litVal);
        displayText = String(safeVal ?? '');
      } else if (cell.content.kind === 'sheet-formula') {
        const formula = (cell.content as any).formula?.trim() || '';
        const evalRes = evaluateSheetFormula(
          formula,
          (row, col) => {
            const targetVal =
              cellMap.get(`${row},${col}`)?.value ??
              (doc.cells.find((dc) => dc.sheetId === sheetId && dc.position.row === row && dc.position.column === col)?.content.kind === 'literal'
                ? (doc.cells.find((dc) => dc.sheetId === sheetId && dc.position.row === row && dc.position.column === col)?.content as any).value
                : null);
            return targetVal;
          },
          cell.position.row,
          cell.position.column
        );
        safeVal = evalRes.value;
        displayText = String(evalRes.value ?? '');
        if (evalRes.error && evalRes.error !== 'ERR_UNSUPPORTED_SHEET_FORMULA') {
          diagnostics.push({
            severity: 'warning',
            code: evalRes.error,
            message: `Formula evaluation note in cell "${cell.id}": ${formula} (${evalRes.error})`,
            targetId: cell.id,
            sheetId: cell.sheetId,
          });
        }
      }

      cellMap.set(posKey, {
        row: cell.position.row,
        col: cell.position.column,
        value: safeVal,
        displayText,
        role: 'custom',
        style: cell.style ? {
          bold: cell.style.bold,
          italic: cell.style.italic,
          color: cell.style.color,
          bgColor: cell.style.backgroundColor,
          align: cell.style.textAlign,
          verticalAlign: cell.style.verticalAlign,
        } : undefined,
      });
    }
  }

  function checkPathMatch(
    parsedTupleStr: string,
    bindingPath: readonly any[],
    docCells: any[]
  ): { matched: boolean; schemaMismatch?: boolean } {
    // 1. 直等匹配 (全量带字段签名，或 JSON.stringify)
    const withFieldStr = encodeMemberTuple(
      (bindingPath || []).map((p: any) => (p.field ? `${p.field}=${p.memberKey}` : p.memberKey))
    );
    if (parsedTupleStr === withFieldStr || parsedTupleStr === JSON.stringify(bindingPath)) {
      return { matched: true };
    }

    // 2. 解码 parsedTupleStr 项与 bindingPath 对应
    const decoded = decodeMemberTuple(parsedTupleStr);
    const bindingKeys = (bindingPath || []).map((p: any) => p.memberKey);
    const bindingFields = (bindingPath || []).map((p: any) => p.field);

    // 检查 decoded 是否携带显式字段
    let hasExplicitFields = false;
    let fieldMatches = true;
    for (let i = 0; i < decoded.length; i++) {
      const val = decoded[i];
      if (typeof val === 'string') {
        const eqIdx = val.indexOf('=');
        if (eqIdx > 0) {
          const potentialField = val.slice(0, eqIdx);
          const isKnownField =
            bindingFields[i] === potentialField ||
            docCells.some(
              (c: any) => c.content?.fieldKey === potentialField || c.id === potentialField
            );
          if (isKnownField) {
            hasExplicitFields = true;
            if (bindingFields[i] !== potentialField) {
              fieldMatches = false;
            }
          }
        }
      }
    }

    if (hasExplicitFields) {
      if (!fieldMatches) {
        return { matched: false };
      }
      const decodedVals = decoded.map((val) => {
        if (typeof val === 'string' && val.includes('=')) {
          return val.slice(val.indexOf('=') + 1);
        }
        return val;
      });
      const matched =
        decodedVals.length === bindingKeys.length &&
        decodedVals.every((v, i) => String(v) === String(bindingKeys[i]));
      return { matched };
    }

    // 3. 匹配成员路径
    const valuesMatch =
      decoded.length === bindingKeys.length &&
      decoded.every((v, i) => String(v) === String(bindingKeys[i]));

    if (!valuesMatch) {
      return { matched: false };
    }

    // 成员值相同！检查该轴的字段是否发生过更名或替换 (R4-I3, R4-08)
    for (const p of bindingPath || []) {
      const dimCell = docCells.find(
        (c: any) =>
          c.content?.kind === 'field' && (c.content.fieldKey === p.field || c.id === p.field)
      );
      if (dimCell && dimCell.id !== p.field && dimCell.id !== dimCell.content?.fieldKey) {
        // 只有当 dimCell.id 在数据集中确实作为已知字段存在时（表明该单元格是以原字段名命名的），才视作字段更名变更
        const sampleRecord = rawDataset[0];
        const isOriginalField =
          sampleRecord && typeof sampleRecord === 'object' && dimCell.id in sampleRecord;
        if (isOriginalField) {
          return { matched: false, schemaMismatch: true };
        }
      }
    }

    return { matched: true };
  }

  // 消费 instanceOverrides (人工覆盖)
  for (const override of doc.instanceOverrides || []) {
    if (override.status && override.status !== 'active') continue;
    const parsed = parseInstanceKey(override.instanceKey);
    if (!parsed) {
      diagnostics.push({
        severity: 'error',
        code: 'ERR_INVALID_INSTANCE_KEY',
        message: `Invalid instance key: "${override.instanceKey}"`,
        targetId: override.templateCellId,
      });
      continue;
    }

    let matchedCount = 0;
    let schemaMismatchDetected = false;
    for (const b of baseGrid.bindings) {
      const matchMetric = parsed.metricId === b.semantic.metricId;
      const rowRes = checkPathMatch(parsed.rowPath, b.semantic.rowPath, doc.cells || []);
      const colRes = checkPathMatch(parsed.columnPath, b.semantic.columnPath, doc.cells || []);
      if (rowRes.schemaMismatch || colRes.schemaMismatch) {
        schemaMismatchDetected = true;
      }
      const matchRow = rowRes.matched;
      const matchCol = colRes.matched;
      const matchTemplate =
        !override.templateCellId ||
        plan.measures.find((m) => m.metricId === b.semantic.metricId)?.templateCellId ===
          override.templateCellId ||
        override.templateCellId === (b as any).templateCellId;
      const matchRegion = !parsed.regionId || parsed.regionId === plan.regionId;
      const bRoleStr = b.semantic.role as string;
      const matchRole =
        !parsed.role ||
        parsed.role === bRoleStr ||
        (parsed.role === 'measure' && bRoleStr === 'metric-value') ||
        (parsed.role === 'metric-value' && bRoleStr === 'measure');

      if (matchMetric && matchRow && matchCol && matchTemplate && matchRegion && matchRole) {
        matchedCount++;
        const targetCell = cellMap.get(`${b.target.row},${b.target.column}`);
        if (targetCell) {
          const immutableBase = (b as any).originalValue ?? targetCell.value;
          if (override.originalBaseValue !== undefined && immutableBase !== override.originalBaseValue) {
            diagnostics.push({
              severity: 'warning',
              code: 'ERR_INSTANCE_OVERRIDE_CONFLICT',
              message: `Instance override conflict: original base value ${override.originalBaseValue} does not match current base value ${immutableBase}`,
              targetId: override.templateCellId,
            });
          }
          targetCell.value = override.overrideValue;
          const def = definitions.get(override.templateCellId);
          const fmt = def?.content.format;
          if (typeof override.overrideValue === 'number' && fmt) {
            targetCell.displayText = formatValue(override.overrideValue, fmt) ?? String(override.overrideValue);
          } else {
            targetCell.displayText = String(override.overrideValue ?? '');
          }
        }
      }
    }

    if (matchedCount === 0) {
      if (schemaMismatchDetected) {
        diagnostics.push({
          severity: 'warning',
          code: 'ERR_OVERRIDE_SCHEMA_MISMATCH',
          message: `Legacy instance override "${override.instanceKey}" cannot be applied because dimension field schema changed. Migration required.`,
          targetId: override.templateCellId,
        });
      } else {
        diagnostics.push({
          severity: 'warning',
          code: 'ERR_ORPHANED_INSTANCE',
          message: `Instance override "${override.instanceKey}" cannot be matched to any member in current dataset.`,
          targetId: override.templateCellId,
        });
      }
    }
  }

  const resolved = resolveTemplateMerges(doc, plan, baseGrid, { sheetId });
  if (resolved.diagnostics.length > 0) {
    diagnostics.push(...resolved.diagnostics);
  }
  const activeMerges = resolved.merges;

  const finalGrid: BiGridModel = {
    ...baseGrid,
    cells: Array.from(cellMap.values()),
    merges: activeMerges,
    mergeOrigins: resolved.resolvedDetails,
    rowCount: Math.max(baseGrid.rowCount, 25),
    colCount: Math.max(baseGrid.colCount, 15),
    colWidths: Object.fromEntries(
      (doc.layoutRules || [])
        .filter((r) => r.sheetId === sheetId && r.kind === 'column-width' && r.index !== undefined && r.size !== undefined)
        .map((r) => [r.index!, r.size!])
    ),
    rowHeights: Object.fromEntries(
      (doc.layoutRules || [])
        .filter((r) => r.sheetId === sheetId && r.kind === 'row-height' && r.index !== undefined && r.size !== undefined)
        .map((r) => [r.index!, r.size!])
    ),
  };

  const presentation = applyPresentationRules(doc, finalGrid, rawDataset, { sheetId });
  diagnostics.push(...presentation.diagnostics);
  return {
    grid: presentation.grid,
    recordCount: rawDataset.length,
    filteredCount: filtered.length,
    diagnostics,
  };
}
