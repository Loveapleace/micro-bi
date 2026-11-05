import type { CellTemplateDocumentV1 } from '../report-template/types.js';
import type { PublishedReport } from './types.js';
import { parseFormula, extractReferencedFields } from '../engine/formula/parser.js';

function cellFields(cell: CellTemplateDocumentV1['cells'][number]): string[] {
  if (cell.content.kind === 'field') return [cell.content.fieldKey];
  if (cell.content.kind === 'business-formula') {
    try { return [...extractReferencedFields(parseFormula(cell.content.expression))].map(ref => ref.replace(/^(?:SUM|AVG|MIN|MAX|COUNT)\s*\((.+)\)$/i, '$1').trim()); }
    catch { return []; }
  }
  return [];
}

export function missingReportFields(doc: CellTemplateDocumentV1, available: readonly string[]): string[] {
  const fields = new Set(available);
  return [...new Set(doc.cells.flatMap(cell => cellFields(cell).filter(field => !fields.has(field))))];
}

/** 字段失配时展示可定位的模板结构；不猜测新字段，不把错误计算成0。 */
export function fieldErrorPublication(doc: CellTemplateDocumentV1, missing: readonly string[]): PublishedReport {
  const missingSet = new Set(missing);
  return {
    version: '1.0', id: doc.id, title: doc.title, createdAt: new Date().toISOString(),
    styles: { normal: { align: 'general', verticalAlign: 'middle' }, missing: { color: '#CF1322', bgColor: '#FFF1F0', bold: true, align: 'left' } },
    sheets: doc.sheets.map(sheet => {
      const sources = doc.cells.filter(cell => cell.sheetId === sheet.id);
      return { id: sheet.id, name: sheet.name, rowCount: Math.max(1, ...sources.map(c => c.position.row + 1), ...doc.layoutRules.flatMap(r => r.kind === 'merge' && r.sheetId === sheet.id && r.range ? [r.range.endRow + 1] : [])),
        colCount: Math.max(1, ...sources.map(c => c.position.column + 1), ...doc.layoutRules.flatMap(r => r.kind === 'merge' && r.sheetId === sheet.id && r.range ? [r.range.endColumn + 1] : [])),
        defaultColWidth: 160, defaultRowHeight: 28,
        cells: sources.map(cell => {
          const isMissing = cellFields(cell).some(field => missingSet.has(field));
          const value = cell.content.kind === 'literal' ? cell.content.value : cell.content.kind === 'field'
            ? `${isMissing ? '⚠ 字段不存在：' : ''}${cell.content.displayName || cell.content.fieldKey}`
            : cell.content.kind === 'sheet-formula' ? cell.content.formula : cell.content.expression;
          return { r: cell.position.row, c: cell.position.column, v: value ?? null, styleId: isMissing ? 'missing' : 'normal' };
        }),
        merges: doc.layoutRules.flatMap(rule => rule.kind === 'merge' && rule.sheetId === sheet.id && rule.range
          ? [{ startRow: rule.range.startRow, endRow: rule.range.endRow, startCol: rule.range.startColumn, endCol: rule.range.endColumn }] : []),
      };
    }),
  };
}
