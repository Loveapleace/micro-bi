/**
 * 报表编译器 (compileReport.ts)
 * 遵循 Section 10:
 * 1. 从 Univer 工作簿 (FWorkbook) 或纯快照 (IWorkbookData) 提取有效工作表、单元格与合并区域
 * 2. 规范化样式并生成去重后的样式字典 (PublishedCellStyle)
 * 3. 提取最终计算值 (value) 与展示文本 (displayText)
 * 4. 校验发布模型并产出结构化诊断 (ReportDiagnostic)
 */
import type { IWorkbookData, IStyleData, Nullable } from '@univerjs/core';
import type {
  PublishedReport,
  PublishedSheet,
  PublishedCell,
  PublishedCellStyle,
  ReportDiagnostic,
  ReportCellMerge,
  BindingRole,
} from '../report/types.js';
import { validatePublishedReport } from '../report/validator.js';

export interface CompileReportOptions {
  reportId?: string | undefined;
  title?: string | undefined;
  datasetVersion?: string | undefined;
}

export interface CompileReportResult {
  publication: PublishedReport;
  diagnostics: ReportDiagnostic[];
}

function mapUniverStyleToPublishedStyle(
  s: Nullable<IStyleData>
): PublishedCellStyle | undefined {
  if (!s) return undefined;

  const style: PublishedCellStyle = {};

  if (s.ff) style.fontFamily = s.ff;
  if (s.fs) style.fontSize = s.fs;
  if (s.bl === 1) style.bold = true;
  if (s.it === 1) style.italic = true;
  if (s.ul?.s === 1) style.underline = true;
  if (s.st?.s === 1) style.strikethrough = true;
  if (s.cl?.rgb) style.color = s.cl.rgb;
  if (s.bg?.rgb) style.bgColor = s.bg.rgb;

  // 对齐：1: 左, 2: 中, 3: 右
  if (s.ht === 1) style.align = 'left';
  else if (s.ht === 2) style.align = 'center';
  else if (s.ht === 3) style.align = 'right';

  // 垂直对齐：1: 顶, 2: 中, 3: 底
  if (s.vt === 1) style.verticalAlign = 'top';
  else if (s.vt === 2) style.verticalAlign = 'middle';
  else if (s.vt === 3) style.verticalAlign = 'bottom';

  // 换行：1: 溢出, 2: 换行, 3: 截断
  if (s.tb === 2) style.wrapText = true;

  // 边框映射
  if (s.bd) {
    style.border = {
      ...(s.bd.t?.cl?.rgb ? { top: { color: s.bd.t.cl.rgb, style: 'thin' } } : {}),
      ...(s.bd.b?.cl?.rgb ? { bottom: { color: s.bd.b.cl.rgb, style: 'thin' } } : {}),
      ...(s.bd.l?.cl?.rgb ? { left: { color: s.bd.l.cl.rgb, style: 'thin' } } : {}),
      ...(s.bd.r?.cl?.rgb ? { right: { color: s.bd.r.cl.rgb, style: 'thin' } } : {}),
    };
  }

  return style;
}

export function compileReport(
  source: unknown,
  options: CompileReportOptions = {}
): CompileReportResult {
  const diagnostics: ReportDiagnostic[] = [];

  let snapshot: Partial<IWorkbookData>;
  let fWorkbook: any = null;

  // 区分传入的是 FWorkbook 实例还是 IWorkbookData 快照
  if (source && typeof (source as any).save === 'function') {
    fWorkbook = source;
    snapshot = fWorkbook.save();
  } else if (source && typeof source === 'object') {
    snapshot = source as Partial<IWorkbookData>;
  } else {
    diagnostics.push({
      severity: 'error',
      code: 'DATA_NOT_READY',
      message: '编译器未接收到有效的工作簿实例或快照数据',
    });
    return {
      publication: {
        version: '1.0',
        id: options.reportId || 'report-empty',
        createdAt: new Date().toISOString(),
        sheets: [],
        styles: {},
        diagnostics,
      },
      diagnostics,
    };
  }

  // 1. 解析样式字典
  const rawStyles = snapshot.styles || {};
  const styles: Record<string, PublishedCellStyle> = {};

  for (const [key, s] of Object.entries(rawStyles)) {
    if (s && typeof s === 'object') {
      const mapped = mapUniverStyleToPublishedStyle(s as IStyleData);
      if (mapped) {
        styles[key] = mapped;
      }
    }
  }

  // 2. 解析各工作表
  const sheets: PublishedSheet[] = [];
  const rawSheets = snapshot.sheets || {};
  const sheetOrder = snapshot.sheetOrder || Object.keys(rawSheets);

  for (const sheetId of sheetOrder) {
    const rawSheet = rawSheets[sheetId];
    if (!rawSheet) continue;

    const rowHeights: Record<number, number> = {};
    if (rawSheet.rowData) {
      for (const [rStr, rVal] of Object.entries(rawSheet.rowData)) {
        if (rVal && typeof (rVal as any).h === 'number') {
          rowHeights[Number(rStr)] = (rVal as any).h;
        }
      }
    }

    const colWidths: Record<number, number> = {};
    if (rawSheet.columnData) {
      for (const [cStr, cVal] of Object.entries(rawSheet.columnData)) {
        if (cVal && typeof (cVal as any).w === 'number') {
          colWidths[Number(cStr)] = (cVal as any).w;
        }
      }
    }

    const merges: ReportCellMerge[] = (rawSheet.mergeData || []).map((m) => ({
      startRow: m.startRow,
      endRow: m.endRow,
      startCol: m.startColumn,
      endCol: m.endColumn,
    }));

    // 解析单元格
    const cells: PublishedCell[] = [];
    const cellData = rawSheet.cellData || {};

    let maxRow = 0;
    let maxCol = 0;

    // MBI-11: 将合并区域纳入有效尺寸范围计算，并校验合并范围合法性
    for (const m of merges) {
      if (m.endRow > maxRow) maxRow = m.endRow;
      if (m.endCol > maxCol) maxCol = m.endCol;
      if (m.startRow > m.endRow || m.startCol > m.endCol) {
        diagnostics.push({
          severity: 'error',
          code: 'BINDING_INVALID',
          message: `工作表 ${sheetId} 存在坐标倒置的非法合并区域 [${m.startRow}:${m.startCol} ~ ${m.endRow}:${m.endCol}]`,
          sheetId,
        });
      }
    }

    for (const [rStr, cols] of Object.entries(cellData)) {
      const r = Number(rStr);
      if (!cols) continue;

      let rowHasValidCell = false;
      for (const [cStr, rawCellObj] of Object.entries(cols as Record<string, any>)) {
        if (!rawCellObj) continue;
        const rawCell = rawCellObj as any;

        // 排除已删除或全空单元格
        if (
          rawCell.v === undefined &&
          rawCell.f === undefined &&
          rawCell.s === undefined &&
          rawCell.p === undefined &&
          !rawCell.custom
        ) {
          continue;
        }

        rowHasValidCell = true;
        const c = Number(cStr);
        if (c > maxCol) maxCol = c;

        let v: string | number | boolean | null = null;
        if (rawCell.v !== undefined && rawCell.v !== null) {
          v = rawCell.v as any;
        }

        let displayText: string | undefined = undefined;
        // 若有活跃的 FWorkbook 实例，尝试读取精准的数字格式化文本
        if (fWorkbook && typeof fWorkbook.getSheetBySheetId === 'function') {
          try {
            const ws = fWorkbook.getSheetBySheetId(sheetId);
            if (ws) {
              const range = ws.getRange(r, c);
              const dv = range?.getDisplayValue?.();
              if (dv !== undefined && dv !== null && dv !== '') {
                displayText = String(dv);
              }
            }
          } catch {
            // fallback
          }
        }

        // 仅当单元格值未发生外部修改时才采纳 custom.displayText (DT-20)
        if (displayText === undefined && rawCell.custom?.displayText !== undefined) {
          const original = rawCell.custom.originalValue;
          if (original !== undefined && v !== original) {
            displayText = v !== null ? String(v) : '';
          } else {
            displayText = String(rawCell.custom.displayText);
          }
        }

        if (displayText === undefined && v !== null) {
          displayText = String(v);
        }

        const cell: PublishedCell = {
          r,
          c,
          v,
          ...(displayText !== undefined ? { displayText } : {}),
          ...(rawCell.f ? { formula: rawCell.f } : {}),
          ...(typeof rawCell.s === 'string' ? { styleId: rawCell.s } : {}),
          ...(rawCell.custom?.role ? { role: rawCell.custom.role as BindingRole } : {}),
        };

        cells.push(cell);
      }
      if (rowHasValidCell && r > maxRow) {
        maxRow = r;
      }
    }

    const freezeObj = rawSheet.freeze as any;
    sheets.push({
      id: sheetId,
      name: rawSheet.name || `Sheet_${sheetId}`,
      hidden: rawSheet.hidden === 1,
      rowCount: Math.max(maxRow + 1, 1),
      colCount: Math.max(maxCol + 1, 1),
      cells,
      merges,
      rowHeights,
      colWidths,
      defaultRowHeight: rawSheet.defaultRowHeight || 28,
      defaultColWidth: rawSheet.defaultColumnWidth || 100,
      frozenRowCount: freezeObj?.ySplit ?? freezeObj?.rowCount ?? 0,
      frozenColCount: freezeObj?.xSplit ?? freezeObj?.colCount ?? 0,
    });
  }

  const publication: PublishedReport = {
    version: '1.0',
    id: options.reportId || snapshot.id || 'report-1',
    ...(options.title ? { title: options.title } : {}),
    createdAt: new Date().toISOString(),
    ...(options.datasetVersion ? { datasetVersion: options.datasetVersion } : {}),
    sheets,
    styles,
    diagnostics,
  };

  const validation = validatePublishedReport(publication);
  diagnostics.push(...validation.issues);

  return {
    publication,
    diagnostics,
  };
}
