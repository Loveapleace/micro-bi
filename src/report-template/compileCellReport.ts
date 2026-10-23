/**
 * 纯 TS 单元格报表编译器 (compileCellReport.ts)
 * 零 Univer / DOM / UI 依赖，可直接运行在 Node、Web Worker 或前端展示端。
 * 将 CellTemplateDocumentV1 编译为可供 VTable 直接消费的中性发布模型 PublishedReport。
 */
import type { DataRecord } from '../engine/types.js';
import type {
  PublishedReport,
  PublishedSheet,
  PublishedCell,
  PublishedCellStyle,
  ReportCellMerge,
} from '../report/types.js';
import type {
  CellTemplateDocumentV1,
  RenderStamp,
  TemplateDiagnostic,
} from './types.js';
import { validateCellTemplateDocument } from './validator.js';
import { normalizeCellTemplate } from './normalizeCellTemplate.js';
import { expandCellTemplate } from './expandTemplate.js';
import { expandCellDrivenTemplate } from './cellExpansionEngine.js';

export interface CompileCellReportResult {
  publication: PublishedReport;
  stamp: RenderStamp;
  diagnostics: TemplateDiagnostic[];
  valid: boolean;
}

export function compileCellReport(
  doc: CellTemplateDocumentV1,
  rawDataset: readonly DataRecord[],
  options: {
    compilerVersion?: string;
    dataRevision?: string | number;
    availableFields?: readonly string[];
  } = {}
): CompileCellReportResult {
  const compilerVersion = options.compilerVersion || '1.0.0-cell';
  const dataRevision = options.dataRevision ?? Date.now();
  const createdAt = new Date().toISOString();

  const stamp: RenderStamp = {
    templateRevision: doc.templateRevision || 1,
    // 覆盖全部区域的数据集版本，而非仅第一个区域
    dataRevisions: Object.fromEntries(
      (doc.regions || []).map((r) => [r.datasetId || 'default', dataRevision])
    ),
    compilerVersion,
    renderedAt: Date.now(),
  };

  // 容错规范化（不修改入参）：若模板仅有单一主区域，自动将孤立/未对齐的 policy.regionId 与 cell.regionId 对齐到主区域，并记录 warning 诊断
  const alignDiagnostics: TemplateDiagnostic[] = [];
  const primaryRegId = doc.regions?.[0]?.id;
  if (primaryRegId) {
    const validRegionIds = new Set((doc.regions || []).map((r) => r.id));
    const policies = doc.mergeConfig?.policies;
    let policiesChanged = false;
    let cellsChanged = false;
    const nextPolicies = policies?.map((p) => {
      if (!validRegionIds.has(p.regionId)) {
        policiesChanged = true;
        alignDiagnostics.push({
          severity: 'warning',
          code: 'WARN_POLICY_REGION_REALIGNED',
          message: `Merge policy "${p.id}" regionId realigned to "${primaryRegId}".`,
          targetId: p.id,
        });
        return { ...p, regionId: primaryRegId };
      }
      return p;
    });
    const nextCells = (doc.cells || []).map((c) => {
      if (c.regionId && !validRegionIds.has(c.regionId)) {
        cellsChanged = true;
        alignDiagnostics.push({
          severity: 'warning',
          code: 'WARN_CELL_REGION_REALIGNED',
          message: `Cell "${c.id}" regionId realigned to "${primaryRegId}".`,
          targetId: c.id,
        });
        return { ...c, regionId: primaryRegId };
      }
      return c;
    });
    if (policiesChanged || cellsChanged) {
      doc = {
        ...doc,
        ...(policiesChanged ? { mergeConfig: { ...doc.mergeConfig!, policies: nextPolicies! } } : {}),
        ...(cellsChanged ? { cells: nextCells! } : {}),
      };
    }
  }

  // 数据集字段集（用于字段/公式引用存在性校验）
  const fieldSet = new Set<string>(options.availableFields || []);
  for (const rec of rawDataset || []) {
    for (const k of Object.keys(rec)) fieldSet.add(k);
  }
  const availableFields = Array.from(fieldSet);

  // 1. 结构与语义校验
  const validation = validateCellTemplateDocument(doc, availableFields);
  if (!validation.valid) {
    const emptySheet: PublishedSheet = {
      id: doc.sheets?.[0]?.id || 'sheet-1',
      name: doc.sheets?.[0]?.name || 'Sheet1',
      rowCount: 10,
      colCount: 10,
      cells: [],
      merges: [],
    };
    return {
      publication: {
        version: '1.0',
        id: doc.id,
        title: doc.title,
        createdAt,
        sheets: [emptySheet],
        styles: {},
        diagnostics: validation.diagnostics.map((d) => ({
          severity: d.severity,
          code: d.code,
          message: d.message,
        })),
      },
      stamp,
      diagnostics: validation.diagnostics,
      valid: false,
    };
  }

  // 2. 区域规范化 (若无数据区域，作为纯静态多工作表报表发布, RC-16)
  const plan = normalizeCellTemplate(doc);
  if (!plan) {
    const staticStyles: Record<string, PublishedCellStyle> = {};
    const staticStyleKeyMap = new Map<string, string>();
    let staticStyleCounter = 0;

    function regStaticStyle(style?: PublishedCellStyle): string | undefined {
      if (!style) return undefined;
      const serialized = JSON.stringify(style);
      if (staticStyleKeyMap.has(serialized)) return staticStyleKeyMap.get(serialized);
      staticStyleCounter += 1;
      const sId = `s_${staticStyleCounter}`;
      staticStyleKeyMap.set(serialized, sId);
      staticStyles[sId] = style;
      return sId;
    }

    const sheetsList = doc.sheets && doc.sheets.length > 0 ? doc.sheets : [{ id: 'sheet-1', name: 'Sheet1' }];
    const publishedStaticSheets: PublishedSheet[] = [];

    for (const sheet of sheetsList) {
      const sheetCells: PublishedCell[] = [];
      const sheetCellValueMap = new Map<string, string>();
      for (const cell of doc.cells || []) {
        if (cell.sheetId === sheet.id || (!cell.sheetId && sheet.id === 'sheet-1')) {
          const val = cell.content.kind === 'literal' ? cell.content.value : undefined;
          const safeVal =
            val === null || val === undefined
              ? null
              : typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean'
              ? val
              : String(val);
          const styleId = regStaticStyle(cell.style ? {
            fontFamily: cell.style.fontFamily,
            fontSize: cell.style.fontSize,
            bold: cell.style.bold,
            italic: cell.style.italic,
            color: cell.style.color,
            bgColor: cell.style.backgroundColor,
            align: cell.style.textAlign,
            verticalAlign: cell.style.verticalAlign,
          } : undefined);
          const dText = safeVal === null ? '' : String(safeVal);
          sheetCells.push({
            r: cell.position.row,
            c: cell.position.column,
            v: safeVal,
            displayText: dText,
            styleId,
            role: 'custom',
          });
          sheetCellValueMap.set(`${cell.position.row},${cell.position.column}`, dText);
        }
      }

      const sheetMerges: ReportCellMerge[] = (doc.layoutRules || [])
        .filter((r) => r.sheetId === sheet.id && r.kind === 'merge' && r.range)
        .map((m) => {
          const r = m.range!;
          const text = sheetCellValueMap.get(`${r.startRow},${r.startColumn}`);
          return {
            startRow: r.startRow,
            endRow: r.endRow,
            startCol: r.startColumn,
            endCol: r.endColumn,
            text: text !== undefined ? String(text) : undefined,
          };
        });

      publishedStaticSheets.push({
        id: sheet.id,
        name: sheet.name || sheet.id,
        hidden: sheet.visible === false ? true : undefined,
        rowCount: Math.max(10, ...sheetCells.map((c) => c.r + 1)),
        colCount: Math.max(10, ...sheetCells.map((c) => c.c + 1)),
        cells: sheetCells,
        merges: sheetMerges,
        defaultRowHeight: 28,
        defaultColWidth: 100,
        colWidths: Object.fromEntries(
          (doc.layoutRules || [])
            .filter((r) => r.sheetId === sheet.id && r.kind === 'column-width' && r.index !== undefined && r.size !== undefined)
            .map((r) => [r.index!, r.size!])
        ),
        rowHeights: Object.fromEntries(
          (doc.layoutRules || [])
            .filter((r) => r.sheetId === sheet.id && r.kind === 'row-height' && r.index !== undefined && r.size !== undefined)
            .map((r) => [r.index!, r.size!])
        ),
      });
    }

    return {
      publication: {
        version: '1.0',
        id: doc.id,
        title: doc.title,
        createdAt,
        sheets: publishedStaticSheets,
        styles: staticStyles,
      },
      stamp,
      diagnostics: validation.diagnostics,
      valid: validation.valid,
    };
  }

  // 3. 模板实例化展开
  const { grid, diagnostics: expandDiagnostics } = expandCellTemplate(doc, plan, rawDataset);
  const allDiagnostics: TemplateDiagnostic[] = [...validation.diagnostics, ...alignDiagnostics, ...(expandDiagnostics || [])];

  // 4. 生成去重样式表与单元格数组
  const styles: Record<string, PublishedCellStyle> = {};
  const styleKeyMap = new Map<string, string>();
  let styleCounter = 0;

  function registerStyle(style?: PublishedCellStyle): string | undefined {
    if (!style) return undefined;
    const serialized = JSON.stringify(style);
    if (styleKeyMap.has(serialized)) {
      return styleKeyMap.get(serialized);
    }
    styleCounter += 1;
    const sId = `s_${styleCounter}`;
    styleKeyMap.set(serialized, sId);
    styles[sId] = style;
    return sId;
  }

  const cells: PublishedCell[] = [];
  const cellValueMap = new Map<string, any>();

  for (const c of grid.cells) {
    const posKey = `${c.row},${c.col}`;
    cellValueMap.set(posKey, c.displayText ?? (c.value === null ? '' : String(c.value)));

    const styleId = registerStyle(c.style as PublishedCellStyle | undefined);
    cells.push({
      r: c.row,
      c: c.col,
      v: c.value,
      displayText: c.displayText,
      styleId,
      role: c.role,
      tooltip: c.tooltip,
    });
  }

  // 5. 确保合并单元格提供正确的主格文本
  const merges: ReportCellMerge[] = grid.merges.map((m) => {
    const mainCellText = cellValueMap.get(`${m.startRow},${m.startCol}`);
    return {
      startRow: m.startRow,
      endRow: m.endRow,
      startCol: m.startCol,
      endCol: m.endCol,
      text: mainCellText !== undefined ? String(mainCellText) : undefined,
    };
  });

  // 按实际有效单元格与合并范围动态裁切发布网格尺寸，消除卡片与预览中的冗余空白行列
  const maxCellRow = cells.reduce((max, c) => Math.max(max, c.r), -1);
  const maxCellCol = cells.reduce((max, c) => Math.max(max, c.c), -1);
  const maxMergeRow = merges.reduce((max, m) => Math.max(max, m.endRow), -1);
  const maxMergeCol = merges.reduce((max, m) => Math.max(max, m.endCol), -1);
  const effectiveRowCount = Math.max(maxCellRow, maxMergeRow) >= 0 ? Math.max(maxCellRow, maxMergeRow) + 1 : grid.rowCount;
  const effectiveColCount = Math.max(maxCellCol, maxMergeCol) >= 0 ? Math.max(maxCellCol, maxMergeCol) + 1 : grid.colCount;

  const activeSheet: PublishedSheet = {
    id: plan.sheetId || doc.sheets?.[0]?.id || 'sheet-1',
    name: doc.sheets?.find((s) => s.id === plan.sheetId)?.name || 'Sheet1',
    hidden: doc.sheets?.find((s) => s.id === (plan.sheetId || doc.sheets?.[0]?.id))?.visible === false ? true : undefined,
    rowCount: effectiveRowCount,
    colCount: effectiveColCount,
    cells,
    merges,
    defaultRowHeight: 28,
    defaultColWidth: 100,
    colWidths: Object.fromEntries((doc.layoutRules || []).filter((r) => r.sheetId === plan.sheetId && r.kind === 'column-width' && r.index !== undefined && r.size !== undefined).map((r) => [r.index!, r.size!])),
    rowHeights: Object.fromEntries((doc.layoutRules || []).filter((r) => r.sheetId === plan.sheetId && r.kind === 'row-height' && r.index !== undefined && r.size !== undefined).map((r) => [r.index!, r.size!])),
  };

  const allSheets: PublishedSheet[] = [activeSheet];

  for (const sheet of doc.sheets || []) {
    if (sheet.id === activeSheet.id) continue;

    const hasDataCells =
      (doc.cells || []).some(
        (c) =>
          c.sheetId === sheet.id &&
          (c.content.kind === 'field' || c.content.kind === 'business-formula')
      ) || (doc.regions || []).some((r) => r.sheetId === sheet.id);

    if (hasDataCells) {
      const sheetExpanded = expandCellDrivenTemplate(doc, rawDataset, { sheetId: sheet.id });
      allDiagnostics.push(...sheetExpanded.diagnostics);
      const sGrid = sheetExpanded.grid;
      const sCells: PublishedCell[] = [];
      const sCellValueMap = new Map<string, any>();

      for (const c of sGrid.cells) {
        sCellValueMap.set(
          `${c.row},${c.col}`,
          c.displayText ?? (c.value === null ? '' : String(c.value))
        );
        const styleId = registerStyle(c.style as PublishedCellStyle | undefined);
        sCells.push({
          r: c.row,
          c: c.col,
          v: c.value,
          displayText: c.displayText,
          styleId,
          role: c.role,
          tooltip: c.tooltip,
        });
      }

      const sMerges: ReportCellMerge[] = sGrid.merges.map((m) => {
        const mainCellText = sCellValueMap.get(`${m.startRow},${m.startCol}`);
        return {
          startRow: m.startRow,
          endRow: m.endRow,
          startCol: m.startCol,
          endCol: m.endCol,
          text: mainCellText !== undefined ? String(mainCellText) : undefined,
        };
      });

      const sMaxCellRow = sCells.reduce((max, c) => Math.max(max, c.r), -1);
      const sMaxCellCol = sCells.reduce((max, c) => Math.max(max, c.c), -1);
      const sMaxMergeRow = sMerges.reduce((max, m) => Math.max(max, m.endRow), -1);
      const sMaxMergeCol = sMerges.reduce((max, m) => Math.max(max, m.endCol), -1);
      const sRowCount = Math.max(sMaxCellRow, sMaxMergeRow) >= 0 ? Math.max(sMaxCellRow, sMaxMergeRow) + 1 : sGrid.rowCount;
      const sColCount = Math.max(sMaxCellCol, sMaxMergeCol) >= 0 ? Math.max(sMaxCellCol, sMaxMergeCol) + 1 : sGrid.colCount;

      allSheets.push({
        id: sheet.id,
        name: sheet.name || sheet.id,
        hidden: sheet.visible === false ? true : undefined,
        rowCount: sRowCount,
        colCount: sColCount,
        cells: sCells,
        merges: sMerges,
        defaultRowHeight: 28,
        defaultColWidth: 100,
        colWidths: Object.fromEntries(
          (doc.layoutRules || [])
            .filter(
              (r) =>
                r.sheetId === sheet.id &&
                r.kind === 'column-width' &&
                r.index !== undefined &&
                r.size !== undefined
            )
            .map((r) => [r.index!, r.size!])
        ),
        rowHeights: Object.fromEntries(
          (doc.layoutRules || [])
            .filter(
              (r) =>
                r.sheetId === sheet.id &&
                r.kind === 'row-height' &&
                r.index !== undefined &&
                r.size !== undefined
            )
            .map((r) => [r.index!, r.size!])
        ),
      });
      continue;
    }

    const sheetCells: PublishedCell[] = [];
    const sheetCellValueMap = new Map<string, string>();
    for (const cell of doc.cells || []) {
      if (cell.sheetId === sheet.id) {
        const val = cell.content.kind === 'literal' ? cell.content.value : undefined;
        const safeVal =
          val === null || val === undefined
            ? null
            : typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean'
            ? val
            : String(val);
        const styleId = registerStyle(cell.style ? {
          fontFamily: cell.style.fontFamily,
          fontSize: cell.style.fontSize,
          bold: cell.style.bold,
          italic: cell.style.italic,
          color: cell.style.color,
          bgColor: cell.style.backgroundColor,
          align: cell.style.textAlign,
          verticalAlign: cell.style.verticalAlign,
        } : undefined);
        const dText = safeVal === null ? '' : String(safeVal);
        sheetCells.push({
          r: cell.position.row,
          c: cell.position.column,
          v: safeVal,
          displayText: dText,
          styleId,
          role: 'custom',
        });
        sheetCellValueMap.set(`${cell.position.row},${cell.position.column}`, dText);
      }
    }

    const sheetMerges: ReportCellMerge[] = (doc.layoutRules || [])
      .filter((r) => r.sheetId === sheet.id && r.kind === 'merge' && r.range)
      .map((m) => {
        const r = m.range!;
        const text = sheetCellValueMap.get(`${r.startRow},${r.startColumn}`);
        return {
          startRow: r.startRow,
          endRow: r.endRow,
          startCol: r.startColumn,
          endCol: r.endColumn,
          text: text !== undefined ? String(text) : undefined,
        };
      });

    allSheets.push({
      id: sheet.id,
      name: sheet.name || sheet.id,
      hidden: sheet.visible === false ? true : undefined,
      rowCount: Math.max(10, ...sheetCells.map((c) => c.r + 1)),
      colCount: Math.max(10, ...sheetCells.map((c) => c.c + 1)),
      cells: sheetCells,
      merges: sheetMerges,
      defaultRowHeight: 28,
      defaultColWidth: 100,
    });
  }

  const publication: PublishedReport = {
    version: '1.0',
    id: doc.id,
    title: doc.title,
    createdAt,
    sheets: allSheets,
    styles,
    diagnostics: allDiagnostics.map((d) => ({
      severity: d.severity,
      code: d.code,
      message: d.message,
    })),
  };

  // 所有诊断（含次表 v2 展开）汇总后统一判定有效性
  const isValid = allDiagnostics.every((d) => d.severity !== 'error');

  return {
    publication,
    stamp,
    diagnostics: allDiagnostics,
    valid: isValid,
  };
}
